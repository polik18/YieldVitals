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
                    const failures = {};
                    const iters = config.iterations || 1;

                    // [結果 key, UI id, 標籤, 逾時(ms), 執行函式]
                    // 每項獨立執行：任一項失敗只標記該項 N/A，其餘照常完成（舊版會整串中斷並以 0 分計入）
                    const steps = [
                        ['cpu',      'cpu',      'CPU',      config.cpuTime * iters + 10000,  tk => runWithSampling('cpu', runCPUMultiCore, iters, config.cpuTime, tk)],
                        ['string',   'string',   'String',   config.otherTime * iters + 5000, tk => runWithSampling('string', runStringTest, iters, config.otherTime, tk)],
                        ['memory',   'ram',      'RAM',      config.otherTime * iters + 5000, tk => runWithSampling('ram', runRAMTest, iters, config.otherTime, tk)],
                        ['dom',      'dom',      'DOM',      config.otherTime * iters + 5000, tk => runWithSampling('dom', runDOMTest, iters, config.otherTime, tk)],
                        ['canvas2d', 'canvas2d', 'Canvas2D', config.otherTime * iters + 5000, tk => runWithSampling('canvas2d', runCanvas2DTest, iters, config.otherTime, tk)],
                        ['gpu',      'gpu',      'GPU',      config.gpuTimeLimit + 5000,      tk => runWithSampling('gpu', runThreeJSTest, 1, config, tk)],
                        ['crypto',   'crypto',   'Crypto',   config.otherTime * iters + 5000, tk => runWithSampling('crypto', runCryptoTest, iters, config.otherTime, tk)],
                        ['storage',  'storage',  'Storage',  config.otherTime + 10000,        tk => runWithSampling('storage', runStorageTest, 1, config.otherTime, tk)],
                        ['network',  'network',  'Network',  60000,                           tk => runWithSampling('network', runNetworkTest, 3, 0, tk, true)]
                    ];

                    for (const [key, uiId, label, timeoutMs, fn] of steps) {
                        if (isCancelledRun(myRunId)) break;
                        try {
                            results[key] = await runStep(label, myRunId, timeoutMs, fn);
                        } catch (e) {
                            if (isCancelledRun(myRunId)) break;
                            console.warn(`[${label}] failed:`, e);
                            failures[key] = (e && e.message) || String(e);
                            results[key] = null;
                            setStatus(uiId, 'N/A', 'error');
                            document.getElementById(`res-${uiId}`).innerHTML = `<span class="text-red-400">N/A</span>`;
                        }
                    }

                    const failedSummary = steps
                        .filter(([key]) => failures[key])
                        .map(([key, , label]) => `${label}: ${failures[key]}`);
                    if (failedSummary.length > 0 && !isCancelledRun(myRunId)) {
                        showError(failedSummary.join(' | '));
                    }

                    // 結算與渲染（失敗項目以 null 排除，不以 0 分計入）
                    if (!isCancelledRun(myRunId)) {
                        const { finalScore, norms } = calculateFinalScore(results);
                        const normCPU = norms.cpu;
                        const normGPU = norms.gpu;
                        const normDOM = norms.dom;
                        const normMemory = norms.memory;
                        const normStorage = norms.storage;

                        const diag = getDiagnostics(finalScore, normCPU, normGPU, normDOM, normMemory, normStorage);
                        renderResult(finalScore, diag);

                        // 渲染可信度
                        const rel = calculateReliability(results, false, failures);
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
                            failures: failures,
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
