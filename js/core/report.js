        function generateReportText(results, finalScore, rel, modeLabel, diag) {
            let text = `${t('report_title')} [${t('report_mode')}: ${modeLabel}]\n`;
            text += `=========================\n`;
            text += `${t('report_score')}：${finalScore}\n`;
            text += `${t('report_reliability')}：${rel.score} (${rel.reason})\n\n`;
            text += `${t('report_details')}\n`;
            text += `- ${t('cpu_calc')}: ${results.cpu || 0} M/s\n`;
            text += `- ${t('string_parse')}: ${results.string || 0} k ops\n`;
            text += `- ${t('ram_gc')}: ${results.memory || 0} cyc/s\n`;
            text += `- ${t('dom_layout')}: ${results.dom || 0} ops/s\n`;
            text += `- ${t('canvas2d_render')}: ${results.canvas2d || 0} ops/s\n`;
            
            const valGPU = typeof results.gpu === 'object' ? results.gpu.value : (results.gpu || 0);
            text += `- ${t('gpu_webgl')}: ${valGPU > 0 ? Math.round(valGPU) + ' Pts' : 'N/A'}\n`;
            
            let cryptoVal = typeof results.crypto === 'object' ? results.crypto.value : (results.crypto || 0);
            let cryptoWarn = typeof results.crypto === 'object' && results.crypto.warning ? ' (!)' : '';
            text += `- ${t('crypto_throughput')}: ${cryptoVal} MB/s${cryptoWarn}\n`;
            
            let storageVal = typeof results.storage === 'object' ? results.storage.value : (results.storage || 0);
            text += `- ${t('storage_io')}: ${storageVal} MB/s\n`;
            
            if (results.network) {
                let networkDl = typeof results.network === 'object' ? (results.network.dl || results.network.value) : results.network;
                let networkUl = typeof results.network === 'object' ? results.network.ul : 0;
                let networkPing = typeof results.network === 'object' ? results.network.ping : 0;
                text += `\n${t('report_network')}\n`;
                text += `- ${t('report_network_dl')}: ${networkDl} Mbps\n`;
                text += `- ${t('report_network_ul')}: ${networkUl} Mbps\n`;
                text += `- ${t('report_network_ping')}: ${networkPing} ms\n\n`;
            } else {
                text += `- ${t('network_speed')}: 0 Mbps\n\n`;
            }

            if (diag) {
                text += `[ ${t('advice_fitness').replace('：', '')} ]\n`;
                text += `- ${t('fitness_web')} ${diag.fitness.webBrowsing}\n`;
                text += `- ${t('fitness_tabs')} ${diag.fitness.multiTab}\n`;
                text += `- ${t('fitness_3d')} ${diag.fitness.web3D}\n`;
                text += `- ${t('fitness_heavy')} ${diag.fitness.heavyWebApps}\n\n`;

                text += `[ ${t('advice_bottleneck').replace('：', '')} ]\n`;
                if (diag.weakestLink) {
                    text += `${t('advice_bottleneck_main')} ${diag.weakestLink.name}\n`;
                    text += `${t('expert_advice')} ${diag.weakestLink.advice}\n\n`;
                } else {
                    text += `${t('advice_balanced_desc')}\n\n`;
                }
            }
            
            text += `${t('report_env')}\n`;
            text += `${t('report_os')}: ${deviceSpecs.platform}\n`;
            text += `${t('report_gpu')}: ${deviceSpecs.gpuRenderer}\n`;
            text += `${t('report_ram')}: ${deviceSpecs.memory}\n`;
            text += `${t('report_cores')}: ${deviceSpecs.cores}\n`;
            text += `${t('report_res')}: ${deviceSpecs.resolution}@${deviceSpecs.pixelRatio}x\n`;
            text += `UserAgent: ${deviceSpecs.userAgent}\n`;
            text += `=========================\n`;
            text += `${new Date().toLocaleString()}`;
            return text;
        }

        function renderResult(finalScore, diag) {
            const marker = document.getElementById('scoreMarker');
            const bar = document.getElementById('tierBar');
            const textEl = document.getElementById('tierText');

            bar.style.width = `${finalScore}%`;
            marker.style.left = `${finalScore}%`;
            marker.style.opacity = '1';
            marker.innerHTML = `${finalScore}<div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-primary rotate-45"></div>`;

            textEl.classList.remove('hidden');

            let adviceHTML = `<div class="mt-4 p-4 bg-slate-800/80 rounded-lg text-left">`;
            adviceHTML += `<p class="font-bold text-white mb-2 border-b border-slate-700 pb-1 flex items-center gap-2"><svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> ${t('advice_fitness')}</p>`;
            adviceHTML += `<ul class="text-xs text-slate-300 space-y-1 mb-4">`;
            adviceHTML += `<li><span class="text-slate-500">${t('fitness_web')}</span> ${diag.fitness.webBrowsing}</li>`;
            adviceHTML += `<li><span class="text-slate-500">${t('fitness_tabs')}</span> ${diag.fitness.multiTab}</li>`;
            adviceHTML += `<li><span class="text-slate-500">${t('fitness_3d')}</span> ${diag.fitness.web3D}</li>`;
            adviceHTML += `<li><span class="text-slate-500">${t('fitness_heavy')}</span> ${diag.fitness.heavyWebApps}</li>`;
            adviceHTML += `</ul>`;

            if (diag.weakestLink) {
                adviceHTML += `<p class="font-bold text-yellow-400 mb-1 border-b border-slate-700 pb-1 flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg> ${t('advice_bottleneck')}</p>`;
                adviceHTML += `<p class="text-xs text-slate-300">${t('advice_bottleneck_main')} <span class="text-white font-bold">${diag.weakestLink.name}</span></p>`;
                adviceHTML += `<p class="text-xs text-slate-400 mt-2 bg-black/30 p-2 rounded border border-slate-700">💡 <b>${t('expert_advice')}</b> ${diag.weakestLink.advice}</p>`;
            } else {
                adviceHTML += `<p class="font-bold text-primary mb-1 border-b border-slate-700 pb-1 flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> ${t('advice_balanced')}</p>`;
                adviceHTML += `<p class="text-xs text-slate-300">${t('advice_balanced_desc')}</p>`;
            }

            adviceHTML += `</div>`;
            textEl.innerHTML = adviceHTML;
        }

        // 取消事件纁定
        document.getElementById('cancelBtn').addEventListener('click', () => currentRunId++);
        document.getElementById('fullscreenCancelBtn').addEventListener('click', () => currentRunId++);


            // Trigger initial mode description display
            const initModeEvt = new Event('change');
            document.querySelector('input[name="testMode"]:checked').dispatchEvent(initModeEvt);

            // 初始化 Chart.js (延遲等待 defer 腳本載入)
            async function initChart() {
                let waited = 0;
                while (!window.Chart && waited < 5000) {
                    await new Promise(r => setTimeout(r, 100));
                    waited += 100;
                }
                if (!window.Chart) return;

                // 等待 i18n 載入完成 (radar_labels 必須是陣列)
                waited = 0;
                while (!Array.isArray(t('radar_labels')) && waited < 3000) {
                    await new Promise(r => setTimeout(r, 100));
                    waited += 100;
                }
                if (!Array.isArray(t('radar_labels'))) {
                    console.error("i18n failed to load radar labels");
                    return;
                }

                const ctx = document.getElementById('radarChart').getContext('2d');
                Chart.defaults.color = '#94a3b8';
                radarChart = new Chart(ctx, {
                    type: 'radar',
                    data: {
                        // 標籤順序需與 calculateFinalScore 寫入的 data 陣列順序一致
                        labels: t('radar_labels'),
                        datasets: [{
                            label: t('radar_dataset'),
                            data: [0, 0, 0, 0, 0, 0, 0, 0],
                            backgroundColor: 'rgba(59, 130, 246, 0.25)',
                            borderColor: '#3b82f6',
                            pointBackgroundColor: '#fff',
                            pointBorderColor: '#3b82f6',
                            pointHoverBackgroundColor: '#3b82f6',
                            pointHoverBorderColor: '#fff',
                            pointBorderWidth: 2,
                            pointRadius: 3,
                            borderWidth: 2,
                            tension: 0.3 // 平滑曲線
                        }]
                    },
                    options: {
                        scales: { r: { angleLines: { color: 'rgba(255, 255, 255, 0.1)' }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, pointLabels: { font: { size: 10, family: '"JetBrains Mono", monospace' }, color: '#94a3b8' }, ticks: { display: false, min: 0, max: 100 } } },
                        plugins: { legend: { display: false } },
                        maintainAspectRatio: false
                    }
                });
            }
