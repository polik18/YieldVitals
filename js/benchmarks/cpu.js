        const cpuWorkerCode = `
            self.onmessage = function(e) {
                const duration = e.data.duration || 1500;
                const startTime = performance.now();
                let ops = 0;
                let sink = 0; // 累加運算結果並回傳，防止 JS 引擎把迴圈當成無用程式碼刪除（Safari/JSC 實測會灌水 22 倍）
                while (performance.now() - startTime < duration) {
                    let a = Math.random(), b = Math.random(), c = Math.random();
                    for(let i=0; i<1000; i++) {
                        a = (a * b) + c;
                        b = Math.sqrt(a + c);
                        c = Math.sin(b) * Math.cos(a);
                    }
                    sink += a + b + c;
                    ops += 1000;
                }
                const elapsedMs = performance.now() - startTime;
                self.postMessage({ ops, elapsedMs, sink });
            };
        `;

        async function runCPUMultiCore(duration, runId) {
            setStatus('cpu', t('status_running_cpu'), 'running');
            const blob = new Blob([cpuWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            let opsPerSec = 0; // 各 Worker 以自身實際經過時間計算後加總
            const allWorkers = [];

            const promises = Array.from({ length: cores }).map(() => {
                return new Promise((resolve, reject) => {
                    const worker = trackWorker(new Worker(workerUrl));
                    allWorkers.push(worker);
                    worker.onmessage = (e) => {
                        opsPerSec += e.data.ops / (e.data.elapsedMs / 1000);
                        worker.terminate();
                        resolve();
                    };
                    worker.onerror = (err) => {
                        worker.terminate();
                        reject(err);
                    };
                    worker.postMessage({ duration });
                });
            });

            try {
                await Promise.all(promises);
            } catch (e) {
                allWorkers.forEach(w => { try { w.terminate(); } catch (_) {} });
                URL.revokeObjectURL(workerUrl);
                throw e;
            }
            URL.revokeObjectURL(workerUrl);
            if (isCancelledRun(runId)) throw new Error(t('error_cancelled'));

            const scoreInM = (opsPerSec / 1000000).toFixed(2);
            setStatus('cpu', `${scoreInM} M/s`, 'done');
            document.getElementById('res-cpu').innerHTML = `${scoreInM} <span class="text-xs font-normal text-slate-500">M/s</span>`;
            return parseFloat(scoreInM);
        }

        // 2. 字串解析測試 (升級為 Worker)
