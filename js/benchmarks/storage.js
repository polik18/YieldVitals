        const storageWorkerCode = `
            self.onmessage = async function(e) {
                const duration = e.data.duration || 2000;
                try {
                    let totalBytesWritten = 0;
                    const startTime = performance.now();
                    const chunkSize = 1024 * 1024; // 1MB
                    const buffer = new Uint8Array(chunkSize);
                    for (let i = 0; i < chunkSize; i++) buffer[i] = i % 256;

                    // 嘗試使用 OPFS (Origin Private File System) 進行高速 I/O
                    if (navigator.storage && navigator.storage.getDirectory) {
                        try {
                            const root = await navigator.storage.getDirectory();
                            const fileHandle = await root.getFileHandle('bench_test.tmp', { create: true });
                            
                            if (fileHandle.createSyncAccessHandle) {
                                const accessHandle = await fileHandle.createSyncAccessHandle();
                                accessHandle.truncate(0);
                                while (performance.now() - startTime < duration) {
                                    accessHandle.write(buffer, { at: totalBytesWritten });
                                    accessHandle.flush();
                                    totalBytesWritten += chunkSize;
                                }
                                accessHandle.close();
                                await root.removeEntry('bench_test.tmp');
                            } else {
                                throw new Error('No SyncAccessHandle');
                            }
                        } catch(err) {
                            // 降級 IndexedDB
                            await runIDBTest(duration, buffer, startTime);
                            return;
                        }
                    } else {
                        // 降級 IndexedDB
                        await runIDBTest(duration, buffer, startTime);
                        return;
                    }

                    const durationSec = (performance.now() - startTime) / 1000;
                    const mbPerSec = (totalBytesWritten / (1024 * 1024) / durationSec).toFixed(1);
                    self.postMessage({ success: true, score: parseFloat(mbPerSec), method: 'OPFS' });

                } catch (e) {
                    self.postMessage({ success: false, error: e.message });
                }
            };

            async function runIDBTest(duration, buffer, originalStartTime) {
                const startTime = performance.now();
                let totalBytesWritten = 0;
                
                const db = await new Promise((resolve, reject) => {
                    const req = indexedDB.open('BenchDB', 1);
                    req.onupgradeneeded = () => req.result.createObjectStore('store');
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                while (performance.now() - startTime < duration) {
                    await new Promise((resolve, reject) => {
                        const tx = db.transaction('store', 'readwrite');
                        tx.objectStore('store').put(buffer, totalBytesWritten);
                        tx.oncomplete = resolve;
                        tx.onerror = reject;
                    });
                    totalBytesWritten += buffer.length;
                }
                db.close();
                indexedDB.deleteDatabase('BenchDB');

                const durationSec = (performance.now() - originalStartTime) / 1000;
                const mbPerSec = (totalBytesWritten / (1024 * 1024) / durationSec).toFixed(1);
                self.postMessage({ success: true, score: parseFloat(mbPerSec), method: 'IndexedDB' });
            }
        `;

        async function runStorageTest(duration, runId) {
            setStatus('storage', t('status_running_storage'), 'running');
            const blob = new Blob([storageWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl);
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (isCancelledRun(runId)) return reject(new Error(t('error_cancelled')));

                    if (e.data.success) {
                        const mbPerSec = e.data.score;
                        setStatus('storage', `${mbPerSec} MB/s`, 'done');
                        document.getElementById('res-storage').innerHTML = `${mbPerSec} <span class="text-xs font-normal text-slate-500">MB/s</span>`;
                        resolve({ value: mbPerSec, method: e.data.method });
                    } else {
                        reject(new Error(e.data.error));
                    }
                };
                worker.onerror = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    reject(new Error('Storage ' + t('error_worker')));
                };
                worker.postMessage({ duration });
            });
        }

        // 8. 網路測速 (Ping / Download / Upload)
