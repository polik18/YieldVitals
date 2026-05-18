        const ramWorkerCode = `
            self.onmessage = function(e) {
                const duration = e.data.duration || 1000;
                const start = performance.now();
                let cycles = 0;
                while(performance.now() - start < duration) {
                    let arr = new Array(10000).fill(0).map((_, i) => ({ id: i, data: new Array(100).fill('x') }));
                    arr = null; // 觸發 GC
                    cycles++;
                }
                self.postMessage({ cycles, durationSec: duration / 1000 });
            };
        `;

        async function runRAMTest(duration, runId) {
            setStatus('ram', t('status_running_ram'), 'running');
            const blob = new Blob([ramWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl);
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (isCancelledRun(runId)) return reject(new Error(t('error_cancelled')));
                    const score = Math.round(e.data.cycles / e.data.durationSec);
                    setStatus('ram', `${score} cyc/s`, 'done');
                    document.getElementById('res-ram').innerHTML = `${score} <span class="text-xs font-normal text-slate-500">cyc/s</span>`;
                    resolve(score);
                };
                worker.onerror = (err) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    reject(err);
                };
                worker.postMessage({ duration });
            });
        }


        // Canvas 2D 繪圖測試 — OffscreenCanvas Worker (不受 rAF 60fps 天花板限制)
