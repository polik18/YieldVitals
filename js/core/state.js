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

        // 取消判斷：若 runId 不符合目前執行中的 run，表示已被取消
        function isCancelledRun(runId) { return runId !== currentRunId; }

        // 基準天花板設定 (集中管理)
        // Calibrated against real hardware (M4, Core Ultra 7, Ryzen 7600, Snapdragon 8 Gen 3)
        // With hyperbolic norm: at baseline = ~67 score, 2x = ~80, 0.5x = ~50
        const BENCHMARK_BASELINE = {
            cpu: 900,     // M/s  — M4 ~780, Ryzen 7600 ~900, mid-laptop ~400
            string: 40,   // k ops/s — M4 Chrome ~35k, mid-PC ~20-40k (was 120, way too high)
            memory: 700,  // cyc/s — mid-range ~300-500, M4 ~1100 (was 200, causing 100% cap)
            dom: 4000,    // ops/s — Chrome macOS ~2000-5000 (was 30000, 10x too high)
            gpu: 1500,    // Pts — composite score; mid GPU ~800, high-end ~2000+
            crypto: 3000, // MB/s — x86 AES-NI ~2000-3500, M4 ~3200
            storage: 1500,// MB/s — OPFS NVMe ~1000-3000, mid SSD ~500-1000
            network: 300, // Mbps — typical broadband; highly variable, low weight
            canvas2d: 5000// ops/s — mid Chrome ~2000-4000, M4 ~6000
        };

        // 模式設定: labelKey/descKey 存 i18n key，在執行時再用 t() 取得翻譯（避免定義時 i18n 尚未載入）
        const MODE_SETTINGS = {
            quick:     { gpuMax: 50000,  gpuTimeLimit: 10000,  cpuTime: 1500, otherTime: 1000, labelKey: 'mode_quick',     descKey: 'mode_quick_desc' },
            standard:  { gpuMax: 150000, gpuTimeLimit: 20000,  cpuTime: 3000, otherTime: 2000, labelKey: 'mode_standard',  descKey: 'mode_standard_desc' },
            extreme:   { gpuMax: 500000, gpuTimeLimit: 30000,  cpuTime: 5000, otherTime: 3000, labelKey: 'mode_extreme',   descKey: 'mode_extreme_desc' },
            stability: { gpuMax: 150000, gpuTimeLimit: 20000,  cpuTime: 2000, otherTime: 1500, iterations: 3, labelKey: 'mode_stability', descKey: 'mode_stability_desc' },
            burnin:    { gpuMax: 500000, gpuTimeLimit: 120000, cpuTime: 15000,otherTime: 5000, labelKey: 'mode_burnin',    descKey: 'mode_burnin_desc' }
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
