        const stringWorkerCode = `
            self.onmessage = function(e) {
                const duration = e.data.duration || 1000;
                const start = performance.now();
                let ops = 0;
                let sink = 0;
                const objStr = '{"id":1,"val":"testbenchmarkstring"}';
                const baseLen = 500; // 动態長度防止 V8 JIT 過度快取
                const regex = /"val":"([^"]+)"/g;

                while(performance.now() - start < duration) {
                    // 加入動態長度鹽値，防止 JSON.parse 結果被 JIT 完全快取
                    const len = baseLen + (ops % 5);
                    const tail = ',{"id":' + ops + ',"val":"dyn' + (ops % 97) + '"}';
                    const jsonStr = '{"data":[' + (objStr + ',').repeat(len).slice(0, -1) + tail + ']}';
                    const parsed = JSON.parse(jsonStr);
                    const matched = jsonStr.match(regex);
                    sink += parsed.data.length + (matched ? matched.length : 0); // 使用結果，防止被最佳化掉
                    ops++;
                }
                self.postMessage({ ops, durationSec: (performance.now() - start) / 1000, sink });
            };
        `;

        async function runStringTest(duration, runId) {
            setStatus('string', t('status_running_string'), 'running');
            const blob = new Blob([stringWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = trackWorker(new Worker(workerUrl));
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (isCancelledRun(runId)) return reject(new Error(t('error_cancelled')));
                    const scoreK = (e.data.ops / e.data.durationSec / 1000).toFixed(1);
                    setStatus('string', `${scoreK}k ops`, 'done');
                    document.getElementById('res-string').innerHTML = `${scoreK} <span class="text-xs font-normal text-slate-500">k ops</span>`;
                    resolve(parseFloat(scoreK));
                };
                worker.onerror = (err) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    reject(err);
                };
                worker.postMessage({ duration });
            });
        }

        // 3. RAM 記憶體 GC 測試 (升級為 Worker)
        // DOM 重繪測試：以 MessageChannel 讓出主執行緒（setTimeout 巢狀會被瀏覽器強制延遲 ≥4ms，
        // 舊版約一半時間在空等，且各瀏覽器延遲不同）；分母只計算實際工作時間。
        async function runDOMTest(duration, runId) {
            setStatus('dom', t('status_running_dom'), 'running');
            const box = document.getElementById('domSandbox');
            const start = performance.now();
            let ops = 0;
            let workMs = 0;
            const channel = new MessageChannel();

            return new Promise((resolve, reject) => {
                function step() {
                    if (isCancelledRun(runId)) {
                        box.innerHTML = '';
                        channel.port1.close();
                        return reject(new Error(t('error_cancelled')));
                    }
                    // 每個 slice 執行約 8ms 的 DOM 寫入＋強制同步排版，再讓出主執行緒
                    const sliceStart = performance.now();
                    const sliceEnd = sliceStart + 8;
                    let now = sliceStart;
                    while (now < sliceEnd) {
                        box.innerHTML = `<div style="padding:${ops % 10}px;margin:${ops % 5}px"><span>${ops}</span></div>`;
                        box.offsetHeight; // Force synchronous reflow
                        ops++;
                        now = performance.now();
                    }
                    workMs += now - sliceStart;

                    if (now - start < duration) {
                        channel.port2.postMessage(0);
                    } else {
                        box.innerHTML = '';
                        channel.port1.close();
                        const score = Math.round(ops / (workMs / 1000));
                        setStatus('dom', `${score} ops/s`, 'done');
                        document.getElementById('res-dom').innerHTML =
                            `${score} <span class="text-xs font-normal text-slate-500">ops/s</span>`;
                        resolve(score);
                    }
                }
                channel.port1.onmessage = step;
                channel.port2.postMessage(0);
            });
        }

        // 5. Three.js GPU 動態壓力探測
