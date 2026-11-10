        async function runWithSampling(name, testFn, iterations, durationPerIter, runId, isNetwork=false) {
            let results = [];
            let fullResults = [];
            for(let i=0; i<iterations; i++) {
                if (isCancelledRun(runId)) throw new Error(t('error_cancelled'));
                let res = await testFn(durationPerIter, runId);
                const val = resultValue(res);
                if (val !== null) results.push(val);
                fullResults.push(res);
                if (iterations > 1 && i < iterations - 1) {
                    await new Promise(r => setTimeout(r, 100)); // Let CPU breathe
                }
            }
            
            // 非網路項目：沒有任何有效樣本就視為失敗（交給呼叫端標成 N/A，不以 0 分計入）
            if (!isNetwork && results.length === 0) {
                throw new Error(`${name}: N/A`);
            }

            let finalVal = null;
            if (results.length > 0) {
                results.sort((a,b) => a - b);
                finalVal = results[Math.floor(results.length / 2)]; // Median（只取有效樣本）
            }
            
            // UI Update for median
            let unit = '';
            let formattedVal = finalVal;
            if(name === 'cpu') { unit = 'M/s'; formattedVal = Number(finalVal).toFixed(2); }
            if(name === 'string') { unit = 'k ops'; formattedVal = Number(finalVal).toFixed(1); }
            if(name === 'ram') { unit = 'cyc/s'; formattedVal = Math.round(finalVal); }
            if(name === 'dom') { unit = 'ops/s'; formattedVal = Math.round(finalVal); }
            if(name === 'canvas2d') { unit = 'ops/s'; formattedVal = Math.round(finalVal); }
            if(name === 'network') { 
                // Network returns an object with dl, ul, ping
                // 如果有多個結果，計算中位數
                let resObj = fullResults[0];
                
                if (iterations > 1) {
                    const dls = fullResults.map(r => r && r.dl).filter(v => v > 0);
                    const uls = fullResults.map(r => r && r.ul).filter(v => v > 0);
                    const pings = fullResults.map(r => r && r.ping).filter(v => v > 0);
                    
                    if (dls.length > 0) dls.sort((a, b) => a - b);
                    if (uls.length > 0) uls.sort((a, b) => a - b);
                    if (pings.length > 0) pings.sort((a, b) => a - b);
                    
                    resObj = {
                        dl: dls.length > 0 ? dls[Math.floor(dls.length / 2)] : fullResults[0].dl,
                        ul: uls.length > 0 ? uls[Math.floor(uls.length / 2)] : fullResults[0].ul,
                        ping: pings.length > 0 ? pings[Math.floor(pings.length / 2)] : fullResults[0].ping,
                        value: dls.length > 0 ? dls[Math.floor(dls.length / 2)] : (fullResults[0] && fullResults[0].value)
                    };
                }
                
                if (resObj && typeof resObj === 'object' && resObj.dl !== null && resObj.dl > 0) {
                    const dlStr = resObj.dl != null ? resObj.dl : 'N/A';
                    const ulStr = resObj.ul != null ? resObj.ul : 'N/A';
                    const pingStr = resObj.ping != null ? `${resObj.ping} ms${resObj.jitter != null ? ` ± ${resObj.jitter}` : ''}` : 'N/A';
                    setStatus('network', `D: ${dlStr} | U: ${ulStr}`, 'done');
                    document.getElementById('res-network').innerHTML = `
                        <div class="flex flex-col">
                            <span class="text-lg">${dlStr} <span class="text-[10px] text-slate-500">DL</span> / ${ulStr} <span class="text-[10px] text-slate-500">UL</span></span>
                            <span class="text-xs text-slate-500 mt-1">Ping: ${pingStr}</span>
                        </div>
                    `;
                    return resObj;
                } else {
                    // Connection failed or returned zero — show N/A, don't affect score
                    setStatus('network', t('error_network_failed'), 'error');
                    document.getElementById('res-network').innerHTML = `<span class="text-red-400">N/A</span>`;
                    return { value: 0, dl: null, ul: null, ping: null };
                }
            }
            
            if(name !== 'gpu' && name !== 'storage' && name !== 'crypto' && name !== 'network') {
                setStatus(name, `${formattedVal} ${unit}`, 'done');
                document.getElementById(`res-${name}`).innerHTML = `${formattedVal} <span class="text-xs font-normal text-slate-500">${unit}</span>`;
            } else if (name === 'gpu') {
                const gpuRes = fullResults.find(r => r && typeof r === 'object' && resultValue(r) === finalVal);
                const swTag = gpuRes && gpuRes.software ? ' <span class="text-xs font-normal text-yellow-400">(SW)</span>'
                    : (gpuRes && gpuRes.integrated ? ' <span class="text-xs font-normal text-slate-400" title="Integrated GPU">(iGPU)</span>' : '');
                setStatus('gpu', `${Math.floor(finalVal)} Pts`, 'done');
                document.getElementById('res-gpu').innerHTML = `${Math.floor(finalVal)} <span class="text-xs font-normal text-slate-500">Pts</span>${swTag}`;
                // 保留完整 GPU 結果（各階段吞吐量、軟體渲染旗標）供可信度判斷與 JSON 匯出
                if (gpuRes) return gpuRes;
            } else if (name === 'storage') {
                setStatus('storage', `${finalVal} MB/s`, 'done');
                document.getElementById('res-storage').innerHTML = `${finalVal} <span class="text-xs font-normal text-slate-500">MB/s</span>`;
            } else if (name === 'crypto') {
                setStatus('crypto', `${finalVal} MB/s`, 'done');
                let resEl = document.getElementById('res-crypto');
                if (finalVal > 10000) {
                    resEl.innerHTML = `${finalVal} <span class="text-xs font-normal text-primary/60">MB/s</span>`;
                    resEl.classList.replace('text-primary', 'text-yellow-400');
                    document.getElementById('cryptoWarning').classList.remove('hidden');
                } else {
                    resEl.innerHTML = `${finalVal} <span class="text-xs font-normal text-primary/60">MB/s</span>`;
                }
            }
            
            return finalVal;
        }

        // failures: { key: errorMessage }，由 main.js 逐項收集
        function calculateReliability(results, isCancelled, failures = {}) {
            const failedKeys = Object.keys(failures);
            const errorOccurred = failedKeys.length > 0;
            let score = t('rel_high');
            let reason = t('rel_reason_high');
            let colorClass = 'bg-primary';

            if (isCancelled) {
                return { score: t('rel_none'), reason: t('rel_reason_cancelled'), colorClass: 'bg-slate-600' };
            }

            if (errorOccurred) {
                if (failedKeys.includes('cpu') || failedKeys.includes('gpu') || resultValue(results.cpu) === null || resultValue(results.gpu) === null) {
                    score = t('rel_low');
                    reason = t('rel_reason_core_err');
                    colorClass = 'bg-red-500';
                } else {
                    score = t('rel_med');
                    reason = t('rel_reason_sub_err');
                    colorClass = 'bg-yellow-500';
                }
            } else if (results.gpu && typeof results.gpu === 'object' && results.gpu.software) {
                score = t('rel_med');
                reason = t('rel_reason_gpu_sw');
                colorClass = 'bg-yellow-500';
            } else if (results.crypto && typeof results.crypto === 'object' && results.crypto.warning) {
                score = t('rel_med');
                reason = t('rel_reason_crypto_warn');
                colorClass = 'bg-yellow-500';
            }

            return { score, reason, colorClass };
        }

        // 計分權重（Network 不計分）
        const SCORE_WEIGHTS = {
            cpu: 0.25, gpu: 0.20, canvas2d: 0.10, dom: 0.10,
            storage: 0.10, memory: 0.10, string: 0.10, crypto: 0.05
        };

        // 各項正規化分數；失敗/無效項目為 null（不再當成 0 分拉低總分）
        function computeNorms(results) {
            const norms = {};
            Object.keys(SCORE_WEIGHTS).forEach(key => {
                const v = resultValue(results[key]);
                norms[key] = v === null ? null : normalize(v, BENCHMARK_BASELINE[key]);
            });
            return norms;
        }

        function calculateFinalScore(results) {
            const norms = computeNorms(results);

            if (radarChart) {
                // 8 axes，順序需與 radar_labels 一致；失敗項目給 null（雷達圖留空而非畫成 0）
                radarChart.data.datasets[0].data = [
                    norms.cpu, norms.string, norms.crypto, norms.memory,
                    norms.storage, norms.dom, norms.gpu, norms.canvas2d
                ];
                radarChart.update();
            }

            // 總分 = 各項倍率的加權幾何平均再映射（= 未截斷對數分數的加權平均），只計成功項目並重新分配權重。
            // 幾何平均讓單一極端項目無法綁架總分。
            let weightSum = 0, total = 0;
            Object.entries(SCORE_WEIGHTS).forEach(([key, w]) => {
                const s = logScore(resultValue(results[key]), BENCHMARK_BASELINE[key]);
                if (s === null) return;
                total += s * w;
                weightSum += w;
            });
            const finalScore = weightSum > 0 ? Math.round(Math.min(Math.max(total / weightSum, 0), 100)) : 0;
            return { finalScore, norms };
        }

        function getDiagnostics(finalScore, normCPU, normGPU, normDOM, normMemory, normStorage) {
            let webBrowsing = t('fitness_very_smooth');
            let multiTab = t('fitness_very_smooth');
            let web3D = t('fitness_very_smooth');
            let heavyWebApps = t('fitness_very_smooth');

            if (finalScore < 30) {
                webBrowsing = t('fitness_smooth');
                multiTab = t('fitness_stutter');
                web3D = t('fitness_not_rec');
                heavyWebApps = t('fitness_struggle');
            } else if (finalScore < 60) {
                webBrowsing = t('fitness_very_smooth');
                multiTab = t('fitness_smooth');
                web3D = t('fitness_good');
                heavyWebApps = t('fitness_power');
            } else if (finalScore < 85) {
                webBrowsing = t('fitness_very_smooth');
                multiTab = t('fitness_very_smooth');
                web3D = t('fitness_good');
                heavyWebApps = t('fitness_smooth');
            }

            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const allScores = [
                {
                    name: t('cpu_calc'),
                    norm: normCPU,
                    advice: isMobile ? t('advice_mobile_cpu') : t('advice_diy_cpu')
                },
                {
                    name: t('gpu_webgl'),
                    norm: normGPU,
                    // Windows 使用內顯時：先建議指定高效能 GPU（可能已有獨顯卻沒被使用），而非直接建議加裝獨顯
                    advice: isMobile ? t('advice_mobile_gpu')
                        : (usingWindowsIntegratedGPU
                            ? t('advice_gpu_igpu_win').replace('{gpu}', gpuShortName(deviceSpecs.gpuRenderer))
                            : t('advice_diy_gpu'))
                },
                {
                    name: t('dom_layout'),
                    norm: normDOM,
                    advice: isMobile ? t('advice_dom_mobile') : t('advice_dom_pc')
                },
                {
                    name: t('ram_gc'),
                    norm: normMemory,
                    advice: isMobile ? t('advice_mobile_ram') : t('advice_diy_ram')
                },
                {
                    name: t('storage_io'),
                    norm: normStorage,
                    advice: isMobile ? t('advice_mobile_storage') : t('advice_diy_storage')
                }
            ];
            // 失敗項目 (null) 不參與弱點判斷
            const scores = allScores.filter(s => s.norm !== null && s.norm !== undefined);
            scores.sort((a, b) => a.norm - b.norm);
            const weakestLink = scores[0];

            return {
                fitness: { webBrowsing, multiTab, web3D, heavyWebApps },
                weakestLink: weakestLink && weakestLink.norm < 60 ? weakestLink : null
            };
        }

