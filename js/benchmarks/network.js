        // ===== 網路測速（階段 3 重寫）=====
        // 對照 macOS networkQuality 實測修正的問題：
        //  - Ping：舊版把 Cloudflare 伺服器處理時間（Server-Timing 約 25~30ms）也算進延遲 → 偏高 3~7 倍。
        //    改用 Resource Timing (requestStart→responseStart) 扣掉 Server-Timing，取 10 次中位數（排除首次連線）。
        //  - 下載：舊版單一連線，無法跑滿高頻寬。改為多條並行連線、固定時間窗，扣除前段 TCP 爬升期。
        //  - 上傳：舊版只送一次 2MB，延遲主導 → 偏低 4~7 倍。改為多條並行、自適應區塊大小、持續上傳。
        //  - 單位：舊版用 1024² 換算 Mbps（偏低 4.6%），改為 1e6。
        const NETWORK_ENDPOINT = {
            name: 'Cloudflare',
            down: 'https://speed.cloudflare.com/__down',
            up: 'https://speed.cloudflare.com/__up'
        };
        const NET_PING_SAMPLES = 10;
        const NET_STREAMS = 6;            // 並行連線數
        const NET_RAMP_MS = 1000;         // 前 1 秒為 TCP 爬升期，不計入
        const NET_DL_CHUNK = 25000000;    // 每次下載請求大小（bytes）
        const NET_UL_START_CHUNK = 250000;
        const NET_UL_MAX_CHUNK = 16000000;

        function generateAntiCacheParam() {
            return `t=${Date.now()}_${crypto.getRandomValues(new Uint32Array(1))[0]}`;
        }

        function bitsToMbps(bytes, ms) {
            return ms > 0 ? (bytes * 8) / (ms / 1000) / 1e6 : 0;
        }

        // 讀取 Server-Timing 中伺服器端處理時間（cfSpeedEdge + cfSpeedWorker 等，排除 cfL4 描述項）
        // 優先用 Resource Timing 的 serverTiming；WebKit 等未提供時改解析回應標頭（端點已 expose server-timing）
        function serverProcessingMs(entry, headerValue) {
            if (entry && entry.serverTiming && entry.serverTiming.length) {
                return entry.serverTiming.reduce((sum, st) => sum + (st.name.startsWith('cfL4') ? 0 : (st.duration || 0)), 0);
            }
            if (!headerValue) return 0;
            return headerValue.split(',').reduce((sum, part) => {
                const name = part.trim().split(';')[0];
                const m = /dur=([\d.]+)/.exec(part);
                return sum + (m && !name.startsWith('cfL4') ? parseFloat(m[1]) : 0);
            }, 0);
        }

        // 把外部取消（使用者取消 / 步驟逾時）連到本次的 AbortController
        function linkAbort(runId, controller) {
            if (runId && typeof runId === 'object' && runId.signal) {
                if (runId.signal.aborted) controller.abort();
                else runId.signal.addEventListener('abort', () => controller.abort(), { once: true });
            }
        }

        async function measurePing(runId) {
            const samples = [];
            for (let i = 0; i < NET_PING_SAMPLES + 1; i++) {
                if (isCancelledRun(runId)) throw new Error(t('error_cancelled'));
                const url = `${NETWORK_ENDPOINT.down}?bytes=0&${generateAntiCacheParam()}`;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 3000);
                const t0 = performance.now();
                try {
                    const resp = await fetch(url, { cache: 'no-store', signal: controller.signal });
                    await resp.arrayBuffer();
                    const wall = performance.now() - t0;
                    const entry = performance.getEntriesByName(url).pop();
                    let rtt = wall;
                    if (entry && entry.requestStart > 0 && entry.responseStart > 0) {
                        rtt = entry.responseStart - entry.requestStart;
                    }
                    rtt = Math.max(0, rtt - serverProcessingMs(entry, resp.headers.get('server-timing')));
                    if (i > 0) samples.push(rtt); // 第一次含 DNS/TCP/TLS 建立，不計入
                } catch (_) {
                    // 單次失敗略過
                } finally {
                    clearTimeout(timer);
                }
            }
            if (samples.length === 0) throw new Error(`${NETWORK_ENDPOINT.name} unreachable`);
            const sorted = [...samples].sort((a, b) => a - b);
            const ping = sorted[Math.floor(sorted.length / 2)];
            let jitter = 0;
            for (let i = 1; i < samples.length; i++) jitter += Math.abs(samples[i] - samples[i - 1]);
            jitter = samples.length > 1 ? jitter / (samples.length - 1) : 0;
            return { ping: +ping.toFixed(1), jitter: +jitter.toFixed(1) };
        }

        // 下載：NET_STREAMS 條連線持續下載 durationMs；每收到一塊資料就記錄時間，扣掉爬升期後計算
        async function measureDownload(durationMs, runId) {
            const controller = new AbortController();
            linkAbort(runId, controller);
            const start = performance.now();
            const deadline = start + durationMs;
            let bytesAfterRamp = 0;
            let totalBytes = 0;

            const stream = async () => {
                while (performance.now() < deadline && !controller.signal.aborted) {
                    const resp = await fetch(`${NETWORK_ENDPOINT.down}?bytes=${NET_DL_CHUNK}&${generateAntiCacheParam()}`, {
                        cache: 'no-store', signal: controller.signal
                    });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const reader = resp.body.getReader();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const now = performance.now();
                        totalBytes += value.length;
                        if (now - start >= NET_RAMP_MS) bytesAfterRamp += value.length;
                        if (now >= deadline) { controller.abort(); break; }
                    }
                }
            };

            const timer = setTimeout(() => controller.abort(), durationMs + 500);
            await Promise.allSettled(Array.from({ length: NET_STREAMS }, stream));
            clearTimeout(timer);
            if (isCancelledRun(runId)) throw new Error(t('error_cancelled'));

            const end = Math.min(performance.now(), deadline);
            const measuredMs = end - (start + NET_RAMP_MS);
            if (totalBytes === 0 || measuredMs <= 0) throw new Error('Download failed');
            return +bitsToMbps(bytesAfterRamp, measuredMs).toFixed(1);
        }

        // 上傳：NET_STREAMS 條連線持續 POST；區塊大小自適應（單次請求目標 ≥ 400ms），以完成的請求計算
        // 注意：Chromium 以 ArrayBuffer 當 body 上傳會卡在約 300 Mbps（實測），改用 Blob 可跑滿 900+ Mbps
        async function measureUpload(durationMs, runId) {
            const controller = new AbortController();
            linkAbort(runId, controller);
            const payload = new Uint8Array(NET_UL_MAX_CHUNK);
            const seed = crypto.getRandomValues(new Uint8Array(65536));
            for (let i = 0; i < payload.length; i += seed.length) payload.set(seed.subarray(0, Math.min(seed.length, payload.length - i)), i);
            const payloadBlob = new Blob([payload]);

            const start = performance.now();
            const deadline = start + durationMs;
            const done = []; // { s, e, bytes }

            const stream = async () => {
                let chunk = NET_UL_START_CHUNK;
                while (!controller.signal.aborted) {
                    const s = performance.now();
                    if (s >= deadline) break;
                    const resp = await fetch(`${NETWORK_ENDPOINT.up}?${generateAntiCacheParam()}`, {
                        method: 'POST', body: payloadBlob.slice(0, chunk), cache: 'no-store', signal: controller.signal
                    });
                    await resp.arrayBuffer();
                    const e = performance.now();
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    if (e <= deadline) done.push({ s, e, bytes: chunk });
                    if (e - s < 400 && chunk < NET_UL_MAX_CHUNK) chunk = Math.min(chunk * 2, NET_UL_MAX_CHUNK);
                }
            };

            const timer = setTimeout(() => controller.abort(), durationMs + 500);
            await Promise.allSettled(Array.from({ length: NET_STREAMS }, stream));
            clearTimeout(timer);
            if (isCancelledRun(runId)) throw new Error(t('error_cancelled'));

            // 只計入爬升期之後開始、且在時間窗內完成的請求
            const windowStart = start + NET_RAMP_MS;
            const counted = done.filter(d => d.s >= windowStart);
            const use = counted.length >= NET_STREAMS ? counted : done; // 慢速網路請求較少時退回全部
            if (use.length === 0) return null;
            const t0 = Math.min(...use.map(d => d.s));
            const t1 = Math.max(...use.map(d => d.e));
            const bytes = use.reduce((a, d) => a + d.bytes, 0);
            return +bitsToMbps(bytes, t1 - t0).toFixed(1);
        }

        // duration：每個方向的量測時間（ms），由模式決定
        async function runNetworkTest(duration, runId) {
            const dirMs = Math.max(4000, duration || 8000);
            try {
                setStatus('network', `${t('network_pinging')} (${NETWORK_ENDPOINT.name})`, 'running');
                const { ping, jitter } = await measurePing(runId);

                setStatus('network', `${t('network_downloading')} (${NETWORK_ENDPOINT.name})`, 'running');
                const dl = await measureDownload(dirMs, runId);

                setStatus('network', `${t('network_uploading')} (${NETWORK_ENDPOINT.name})`, 'running');
                let ul = null;
                try {
                    ul = await measureUpload(dirMs, runId);
                } catch (e) {
                    if (isCancelledRun(runId)) throw e;
                    console.warn('UL test failed:', e.message);
                }

                return { value: dl, dl, ul, ping, jitter, endpoint: NETWORK_ENDPOINT.name, streams: NET_STREAMS };
            } catch (e) {
                if (isCancelledRun(runId) || e.message === t('error_cancelled')) throw new Error(t('error_cancelled'));
                console.warn(`Network test failed:`, e.message);
                setStatus('network', t('error_network_failed'), 'error');
                document.getElementById('res-network').innerHTML = `N/A`;
                return { value: 0, dl: null, ul: null, ping: null, error: e.message };
            }
        }

