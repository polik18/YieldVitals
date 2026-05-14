import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace hardcoded strings in JS with t() calls
replacements = [
    ("適合手機或輕度測試", "t('mode_quick_desc')"),
    ("標準平衡負載", "t('mode_standard_desc')"),
    ("極限運算壓力測試", "t('mode_extreme_desc')"),
    ("無限循環燒機 (手動停止)", "t('mode_burnin_desc')"),
    ("'等待中'", "t('status_waiting')"),
    ("'測試中...'", "t('status_running')"),
    ("'完成'", "t('status_done')"),
    ("測試過程中發生錯誤，請重試。", "t('error_msg')"),
    ("['運算 (CPU)', '運算 (字串)', '運算 (加密)', '記憶體 (RAM)', '本機存取 (Storage)', '網路 (Network)', '圖形 (DOM)', '圖形 (GPU)']", "t('radar_labels')")
]

for old, new in replacements:
    content = content.replace(old, new)

# Add updateDynamicElements
content += """
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
"""

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
