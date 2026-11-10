        // Fallback t() before i18n loads
        if (typeof window.t === 'undefined') { window.t = function(k) { return k; }; }

﻿        let currentRunId = 0; // 取代 isCancelled，使用 runId 防止競態
        let radarChart;
        let reportText = "";
        const cores = navigator.hardwareConcurrency || 4;

        // HTML Escape 工具函式 (防止 XSS 注入)
        function escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        // 取消判斷：runId 可以是數字（整次測試），或 runStep 產生的 token { runId, signal }。
        // token 的 signal 在該步驟逾時時會被 abort，讓仍在背景跑的測試迴圈立即停止。
        function isCancelledRun(runId) {
            if (runId && typeof runId === 'object') {
                return runId.runId !== currentRunId || !!(runId.signal && runId.signal.aborted);
            }
            return runId !== currentRunId;
        }

        // 偵測瀏覽器引擎（各引擎的 JS/DOM/Canvas/儲存實作差異可達數倍，需各自的 baseline）
        // blink = Chrome/Edge/Opera/Brave（桌面與 Android）；gecko = Firefox；webkit = Safari 及所有 iOS 瀏覽器
        function detectEngine() {
            try {
                if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('-moz-appearance', 'none')) return 'gecko';
            } catch (_) {}
            if (navigator.userAgentData || /\b(Chrome|Chromium|Edg)\//.test(navigator.userAgent)) return 'blink';
            if (/AppleWebKit/.test(navigator.userAgent)) return 'webkit';
            return 'blink';
        }
        const browserEngine = detectEngine();

        // 基準天花板設定 (集中管理)
        // Calibrated against real hardware (M4, Core Ultra 7, Ryzen 7600, Snapdragon 8 Gen 3)
        // With hyperbolic norm: at baseline = ~67 score, 2x = ~80, 0.5x = ~50
        // 各引擎參考值（參考機 = Apple M2 Max 12 核，Standard 模式 3 次中位數，tools/calibrate.js，2026-11-10）
        // 參考機在各引擎的每一軸都對應 75 分；其他裝置依相對參考機的倍率計分（見 utils.js normalize）。
        // 同一台機器在不同引擎的原始值可差數倍（如 RAM：WebKit 1037 / Blink 694 / Gecko 183），
        // 因此必須依引擎取 baseline，否則雷達圖會因瀏覽器而非硬體而極端化。
        // 待補：更多裝置（中低階筆電、Windows、Android、iPhone）的校準資料。
        const BENCHMARK_BASELINES = {
            blink:  { cpu: 1020, string: 26.9, memory: 694,  dom: 47445, canvas2d: 154750, gpu: 1000, crypto: 2278, storage: 658,  network: 300 },
            gecko:  { cpu: 737,  string: 19.0, memory: 183,  dom: 22602, canvas2d: 154286, gpu: 1057, crypto: 4285, storage: 3193, network: 300 },
            webkit: { cpu: 362,  string: 20.5, memory: 1037, dom: 17750, canvas2d: 171750, gpu: 1024, crypto: 2488, storage: 1291, network: 300 }
        };
        const BENCHMARK_BASELINE = BENCHMARK_BASELINES[browserEngine] || BENCHMARK_BASELINES.blink;

        // 模式設定: labelKey/descKey 存 i18n key，在執行時再用 t() 取得翻譯（避免定義時 i18n 尚未載入）
        const MODE_SETTINGS = {
            quick:     { gpuTimeLimit: 10000, cpuTime: 500,  otherTime: 350,  iterations: 3, labelKey: 'mode_quick',     descKey: 'mode_quick_desc' },
            standard:  { gpuTimeLimit: 20000,  cpuTime: 600,  otherTime: 400,  iterations: 5, labelKey: 'mode_standard',  descKey: 'mode_standard_desc' },
            extreme:   { gpuTimeLimit: 30000,  cpuTime: 1000, otherTime: 600,  iterations: 5, labelKey: 'mode_extreme',   descKey: 'mode_extreme_desc' },
            stability: { gpuTimeLimit: 20000,  cpuTime: 2000, otherTime: 1500, iterations: 5, labelKey: 'mode_stability', descKey: 'mode_stability_desc' },
            burnin:    { gpuTimeLimit: 120000, cpuTime: 1500, otherTime: 500,  iterations: 10, labelKey: 'mode_burnin',    descKey: 'mode_burnin_desc' }
        };

        function getDeviceSpecs() {
            const specs = {
                userAgent: navigator.userAgent,
                cores: navigator.hardwareConcurrency || t('env_unknown'),
                memory: navigator.deviceMemory ? `${navigator.deviceMemory} GB+` : t('env_unknown_mem'),
                resolution: `${window.screen.width}x${window.screen.height}`,
                pixelRatio: window.devicePixelRatio || 1,
                platform: navigator.platform || t('env_unknown'),
                gpuRenderer: t('env_unknown_gpu')
            };

            try {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                if (gl) {
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    if (debugInfo) {
                        specs.gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                    } else {
                        specs.gpuRenderer = gl.getParameter(gl.RENDERER);
                    }
                }
            } catch (e) { console.warn("Failed to get GPU info"); }

            if (navigator.userAgentData) {
                specs.platform = navigator.userAgentData.platform || specs.platform;
            }
            return specs;
        }

        const deviceSpecs = getDeviceSpecs();


        // 模式切換文字連動
        document.querySelectorAll('input[name="testMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const mode = MODE_SETTINGS[e.target.value];
                const descEl = document.getElementById('modeDesc');
                descEl.textContent = t(mode.descKey);
                if (e.target.value === 'burnin') descEl.className = 'text-purple-400 font-bold';
                else if (e.target.value === 'extreme') descEl.className = 'text-red-400 font-bold';
                else if (e.target.value === 'standard') descEl.className = 'text-yellow-400 font-normal';
                else descEl.className = 'text-primary font-normal';
            });
        });
