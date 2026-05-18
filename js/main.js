            initChart();

            // 複製報告按鈕綁定
            document.getElementById('copyReportBtn').addEventListener('click', async () => {
                if (navigator.clipboard && window.isSecureContext) {
                    try {
                        await navigator.clipboard.writeText(reportText);
                        showToast(t('toast_copy_success'));
                    } catch (err) {
                        showToast(t('toast_copy_fail'));
                    }
                } else {
                    const textArea = document.createElement("textarea");
                    textArea.value = reportText;
                    document.body.appendChild(textArea);
                    textArea.select();
                    try {
                        document.execCommand('copy');
                        showToast(t('toast_copy_success'));
                    } catch (err) {
                        showToast(t('toast_copy_fail'));
                    }
                    document.body.removeChild(textArea);
                }
            });
            
            let lastJsonExport = null;
            document.getElementById('exportJsonBtn').addEventListener('click', () => {
                if (!lastJsonExport) return;
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(lastJsonExport, null, 2));
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", `YieldVitals_Report_${new Date().getTime()}.json`);
                document.body.appendChild(downloadAnchorNode);
                downloadAnchorNode.click();
                downloadAnchorNode.remove();
                showToast(t('toast_json_export'));
            });

            // 主執行流 (具有完整錯誤保護與取消保護)
            document.getElementById('startBtn').addEventListener('click', async function () {
                // Wait up to 3s for deferred scripts to load
                let waited = 0;
                while ((!window.Chart || !window.THREE) && waited < 3000) {
                    await new Promise(r => setTimeout(r, 100));
                    waited += 100;
                }
                const depError = checkDependencies();
                if (depError) return showFatalError(depError);

                const modeValue = document.querySelector('input[name="testMode"]:checked').value;
                const config = MODE_SETTINGS[modeValue];

                try {
                    currentRunId++; // Start a new run
                    const myRunId = currentRunId;
                    resetUI();
                    document.getElementById('exportJsonBtn').classList.add('hidden');
                    setButtonLoading(true);

                    const results = {};
                    let errorOccurred = false;

                    try {
                        let iters = config.iterations || 1;
                        results.cpu = await withTimeout(runWithSampling('cpu', runCPUMultiCore, iters, config.cpuTime, myRunId), config.cpuTime*iters + 10000, 'CPU');
                        results.string = await withTimeout(runWithSampling('string', runStringTest, iters, config.otherTime, myRunId), config.otherTime*iters + 5000, 'String');
                        results.memory = await withTimeout(runWithSampling('ram', runRAMTest, iters, config.otherTime, myRunId), config.otherTime*iters + 5000, 'RAM');
                        results.dom = await withTimeout(runWithSampling('dom', runDOMTest, iters, config.otherTime, myRunId), config.otherTime*iters + 5000, 'DOM');
                        results.canvas2d = await withTimeout(runWithSampling('canvas2d', runCanvas2DTest, iters, config.otherTime, myRunId), config.otherTime*iters + 5000, 'Canvas2D');
                        results.gpu = await withTimeout(runWithSampling('gpu', runThreeJSTest, 1, config, myRunId), config.gpuTimeLimit + 5000, 'GPU');
                        results.crypto = await withTimeout(runWithSampling('crypto', runCryptoTest, iters, config.otherTime, myRunId), config.otherTime*iters + 5000, 'Crypto');
                        results.storage = await withTimeout(runWithSampling('storage', runStorageTest, 1, config.otherTime, myRunId), config.otherTime + 10000, 'Storage');
                        results.network = await withTimeout(runWithSampling('network', runNetworkTest, 3, 0, myRunId, true), 60000, 'Network'); // 改為 3 次迭代，超時 60s
                    } catch (e) {
                        errorOccurred = true;
                        if (e.message !== t('error_cancelled') && e.message !== '使用者取消測試') {
                            showError(e.message);
                        }
                    }

                    // 結算與渲染 (包含被中途腰斬但已有部分分數的狀態)
                    if (!isCancelledRun(myRunId)) {
                        const finalScore = calculateFinalScore(results);
                        const normCPU = normalize(results.cpu || 0, BENCHMARK_BASELINE.cpu);
                        const valGPU = typeof results.gpu === 'object' ? results.gpu.value : (results.gpu || 0);
                        const normGPU = normalize(valGPU, BENCHMARK_BASELINE.gpu);
                        const normDOM = normalize(results.dom || 0, BENCHMARK_BASELINE.dom);
                        const normMemory = normalize(results.memory || 0, BENCHMARK_BASELINE.memory);
                        const valStorage = typeof results.storage === 'object' ? results.storage.value : (results.storage || 0);
                        const normStorage = normalize(valStorage, BENCHMARK_BASELINE.storage);
                        const valNetwork = typeof results.network === 'object' ? results.network.value : (results.network || 0);
                        const normNetwork = normalize(valNetwork, BENCHMARK_BASELINE.network);

                        const diag = getDiagnostics(finalScore, normCPU, normGPU, normDOM, normMemory, normStorage);
                        renderResult(finalScore, diag);

                        // 渲染可信度
                        const rel = calculateReliability(results, false, errorOccurred);
                        const relBox = document.getElementById('reliabilityBox');
                        const relBadge = document.getElementById('reliabilityBadge');
                        const relReason = document.getElementById('reliabilityReason');

                        relBox.classList.remove('hidden');
                        relBadge.textContent = rel.score;
                        relBadge.className = `px-2 py-0.5 rounded text-xs font-bold text-white ${rel.colorClass}`;
                        relReason.textContent = rel.reason;

                        // 產生報告文字並顯示複製按鈕
                        reportText = generateReportText(results, finalScore, rel, t(config.labelKey), diag);
                        document.getElementById('copyReportBtn').classList.remove('hidden');
                        
                        // 準備 JSON 匯出資料
                        lastJsonExport = {
                            timestamp: new Date().toISOString(),
                            mode: t(config.labelKey),
                            score: finalScore,
                            reliability: rel,
                            results: results,
                            environment: {
                                userAgent: navigator.userAgent,
                                cores: cores,
                                resolution: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}x`
                            }
                        };
                        document.getElementById('exportJsonBtn').classList.remove('hidden');
                    }

                } catch (fatalErr) {
                    showError(t("error_fatal") + " " + fatalErr.message);
                } finally {
                    setButtonLoading(false);
                }
            });

        window.updateDynamicElements = function() {
    if (typeof radarChart !== 'undefined' && radarChart) {
        radarChart.data.labels = t('radar_labels');
        radarChart.update();
    }
    
    const selectedMode = document.querySelector('input[name="testMode"]:checked');
    if (selectedMode) {
        const evt = new Event('change');
        selectedMode.dispatchEvent(evt);
    }
    
    const envInfo = document.getElementById('envInfo');
    if (envInfo && typeof getDeviceSpecs === 'function') {
        const specs = getDeviceSpecs();
        envInfo.innerHTML = `
            <div class="grid grid-cols-2 gap-3 mb-3">
                <div class="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700/50 flex flex-col justify-center items-center text-center hover:bg-slate-800/80 transition-colors">
                    <span class="text-[10px] text-slate-500 mb-0.5 uppercase tracking-wider">${t('env_os')}</span>
                    <span class="text-xs font-bold text-slate-200">${escapeHtml(specs.platform)}</span>
                </div>
                <div class="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700/50 flex flex-col justify-center items-center text-center hover:bg-slate-800/80 transition-colors">
                    <span class="text-[10px] text-slate-500 mb-0.5 uppercase tracking-wider">${t('env_mem_cores')}</span>
                    <span class="text-xs font-bold text-slate-200">${escapeHtml(specs.memory)} / ${specs.cores}C</span>
                </div>
                <div class="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700/50 flex flex-col justify-center items-center text-center col-span-2 hover:bg-slate-800/80 transition-colors">
                    <span class="text-[10px] text-slate-500 mb-0.5 uppercase tracking-wider">${t('env_gpu')}</span>
                    <span class="text-xs font-bold text-primary truncate w-full px-2" title="${escapeHtml(specs.gpuRenderer)}">${escapeHtml(specs.gpuRenderer)}</span>
                </div>
            </div>
            <div class="flex justify-between items-center text-[10px] text-slate-600 border-t border-slate-800 pt-3">
                <span>Res: ${specs.resolution} @ ${specs.pixelRatio}x</span>
                <span class="truncate w-1/2 text-right" title="${escapeHtml(specs.userAgent)}">${escapeHtml(specs.userAgent)}</span>
            </div>
        `;
    }
};

// (duplicate updateDynamicElements removed)
