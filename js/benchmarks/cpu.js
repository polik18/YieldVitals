        const cpuWorkerCode = `
            self.onmessage = function(e) {
                const duration = e.data.duration || 1500;
                const startTime = performance.now();
                let ops = 0;
                while (performance.now() - startTime < duration) {
                    let a = Math.random(), b = Math.random(), c = Math.random();
                    for(let i=0; i<1000; i++) {
                        a = (a * b) + c;
                        b = Math.sqrt(a + c);
                        c = Math.sin(b) * Math.cos(a);
                    }
                    ops += 1000;
                }
                self.postMessage(ops);
            };
        `;

        async function runCPUMultiCore(duration, runId) {
            setStatus('cpu', t('status_running_cpu'), 'running');
            const blob = new Blob([cpuWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            let totalOps = 0;
            const allWorkers = [];

            const promises = Array.from({ length: cores }).map(() => {
                return new Promise((resolve, reject) => {
                    const worker = new Worker(workerUrl);
                    allWorkers.push(worker);
                    worker.onmessage = (e) => {
                        totalOps += e.data;
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

            const durationSec = duration / 1000;
            const scoreInM = (totalOps / durationSec / 1000000).toFixed(2);
            setStatus('cpu', `${scoreInM} M/s`, 'done');
            document.getElementById('res-cpu').innerHTML = `${scoreInM} <span class="text-xs font-normal text-slate-500">M/s</span>`;
            return parseFloat(scoreInM);
        }

        // 2. 字串解析測試 (升級為 Worker)
