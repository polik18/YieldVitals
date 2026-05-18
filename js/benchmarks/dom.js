        const stringWorkerCode = `
            self.onmessage = function(e) {
                const duration = e.data.duration || 1000;
                const start = performance.now();
                let ops = 0;
                const objStr = '{"id":1,"val":"testbenchmarkstring"}';
                const baseLen = 500; // 动態長度防止 V8 JIT 過度快取
                const regex = /"val":"([^"]+)"/g;

                while(performance.now() - start < duration) {
                    // 加入動態長度鹽値，防止 JSON.parse 結果被 JIT 完全快取
                    const len = baseLen + (ops % 5);
                    const tail = ',{"id":' + ops + ',"val":"dyn' + (ops % 97) + '"}';
                    const jsonStr = '{"data":[' + (objStr + ',').repeat(len).slice(0, -1) + tail + ']}';
                    JSON.parse(jsonStr);
                    jsonStr.match(regex);
                    ops++;
                }
                self.postMessage({ ops, durationSec: duration / 1000 });
            };
        `;

        async function runStringTest(duration, runId) {
            setStatus('string', t('status_running_string'), 'running');
            const blob = new Blob([stringWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl);
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
        async function runDOMTest(duration, runId) {
            setStatus('dom', t('status_running_dom'), 'running');
            const box = document.getElementById('domSandbox');
            const start = performance.now();
            let ops = 0;

            return new Promise((resolve, reject) => {
                function step() {
                    if (isCancelledRun(runId)) {
                        box.innerHTML = '';
                        return reject(new Error(t('error_cancelled')));
                    }
                    // 每個 task slice 執行 4ms 的 DOM 重繪，再 yield 給瀏覽器
                    const sliceEnd = performance.now() + 4;
                    while (performance.now() < sliceEnd) {
                        box.innerHTML = `<div style="padding:${ops % 10}px;margin:${ops % 5}px"><span>${ops}</span></div>`;
                        box.offsetHeight; // Force synchronous reflow
                        ops++;
                    }

                    if (performance.now() - start < duration) {
                        setTimeout(step, 0); // Yield, then continue
                    } else {
                        box.innerHTML = '';
                        const durationSec = (performance.now() - start) / 1000;
                        const score = Math.round(ops / durationSec);
                        setStatus('dom', `${score} ops/s`, 'done');
                        document.getElementById('res-dom').innerHTML =
                            `${score} <span class="text-xs font-normal text-slate-500">ops/s</span>`;
                        resolve(score);
                    }
                }
                setTimeout(step, 0);
            });
        }

        // 5. Three.js GPU 動態壓力探測
