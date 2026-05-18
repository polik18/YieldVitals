        const cryptoWorkerCode = `
            self.onmessage = async function(e) {
                const duration = e.data.duration || 4000;
                try {
                    const key = await crypto.subtle.generateKey(
                        { name: "AES-GCM", length: 256 },
                        true,
                        ["encrypt", "decrypt"]
                    );
                    const chunkSize = 1024 * 1024; // 1MB
                    const bufferPool = [];
                    for(let i=0; i<4; i++) {
                        const arr = new Uint8Array(chunkSize);
                        const seed = crypto.getRandomValues(new Uint8Array(65536));
                        for (let j = 0; j < arr.length; j += seed.length) {
                            arr.set(seed.subarray(0, Math.min(seed.length, arr.length - j)), j);
                        }
                        bufferPool.push(arr);
                    }

                    let totalEncrypted = 0;
                    const startTime = performance.now();
                    let poolIndex = 0;

                    while (true) {
                        if (performance.now() - startTime > duration) break;

                        const promises = [];
                        for(let i=0; i<8; i++) {
                            const freshIv = crypto.getRandomValues(new Uint8Array(12)); // Fix 1-C: 每次加密使用新 IV
                            promises.push(crypto.subtle.encrypt(
                                { name: "AES-GCM", iv: freshIv }, key, bufferPool[poolIndex]
                            ));
                            poolIndex = (poolIndex + 1) % bufferPool.length;
                        }
                        await Promise.all(promises);
                        totalEncrypted += chunkSize * 8;
                    }

                    const durationSec = (performance.now() - startTime) / 1000;
                    const mbPerSec = (totalEncrypted / (1024 * 1024) / durationSec).toFixed(0);
                    self.postMessage({ success: true, score: parseFloat(mbPerSec) });
                } catch (e) {
                    self.postMessage({ success: false, error: e.message });
                }
            };
        `;

        async function runCryptoTest(duration, runId) {
            setStatus('crypto', t('status_running_crypto'), 'running');
            const blob = new Blob([cryptoWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl);
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (isCancelledRun(runId)) return reject(new Error(t('error_cancelled')));

                    if (e.data.success) {
                        const mbPerSec = e.data.score;
                        setStatus('crypto', `${mbPerSec} MB/s`, 'done');
                        const resEl = document.getElementById('res-crypto');

                        // 不再人工封頂，而是回傳 warning 標記
                        if (mbPerSec > 10000) {
                            resEl.innerHTML = `${mbPerSec} <span class="text-xs font-normal text-primary/60">MB/s</span>`;
                            resEl.classList.replace('text-primary', 'text-yellow-400');
                            document.getElementById('cryptoWarning').classList.remove('hidden');
                            resolve({ value: mbPerSec, warning: '數值異常偏高，可能受瀏覽器快取或硬體加速影響' });
                        } else {
                            resEl.innerHTML = `${mbPerSec} <span class="text-xs font-normal text-primary/60">MB/s</span>`;
                            resolve(mbPerSec);
                        }
                    } else {
                        reject(new Error(e.data.error));
                    }
                };
                worker.onerror = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    reject(new Error('WebCrypto ' + t('error_worker')));
                };
                worker.postMessage({ duration });
            });
        }

        // 7. Storage I/O 測試 (OPFS / IndexedDB Fallback)
