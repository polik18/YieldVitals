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

        function showToast(message) {
            const toast = document.getElementById('toast');
            document.getElementById('toastMsg').textContent = message;
            toast.classList.remove('translate-y-20', 'opacity-0');
            setTimeout(() => {
                toast.classList.add('translate-y-20', 'opacity-0');
            }, 3000);
        }

        function setStatus(id, text, state = 'idle') {
            const el = document.getElementById(`item-${id}`);
            const val = el.querySelector('.value');
            const ind = el.querySelector('.indicator');

            el.classList.remove('opacity-50');
            val.className = 'text-right w-24 value';
            ind.className = 'w-2 h-2 rounded-full indicator transition-all';
            val.textContent = text;

            if (state === 'running') {
                val.classList.add('text-primary', 'animate-pulse');
                ind.classList.add('bg-yellow-400', 'animate-ping');
            } else if (state === 'done') {
                val.classList.add('text-white');
                ind.classList.add('bg-primary');
            } else if (state === 'error') {
                val.classList.add('text-red-400');
                ind.classList.add('bg-red-500');
            } else {
                el.classList.add('opacity-50');
                ind.classList.add('bg-slate-600');
            }
        }

        function setButtonLoading(isLoading) {
            const btn = document.getElementById('startBtn');
            const icon = btn.querySelector('.btn-icon');
            const text = btn.querySelector('.btn-text');
            const cancelBtn = document.getElementById('cancelBtn');
            const modeInputs = document.querySelectorAll('input[name="testMode"]');

            if (isLoading) {
                btn.disabled = true;
                icon.innerHTML = `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" class="opacity-25"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>`;
                icon.classList.add('animate-spin');
                text.textContent = t('status_running');
                btn.classList.replace('bg-primary', 'bg-slate-700');
                cancelBtn.classList.remove('hidden');
                modeInputs.forEach(input => input.disabled = true);
            } else {
                btn.disabled = false;
                icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>`;
                icon.classList.remove('animate-spin');
                text.textContent = t('btn_retest');
                btn.classList.replace('bg-slate-700', 'bg-primary');
                cancelBtn.classList.add('hidden');
                modeInputs.forEach(input => input.disabled = false);
            }
        }

        function resetUI() {
            // 清空列表狀態
            ['cpu', 'string', 'ram', 'dom', 'canvas2d', 'gpu', 'crypto', 'storage', 'network'].forEach(id => {
                setStatus(id, t('status_waiting'), 'idle');
                document.getElementById(`res-${id}`).innerHTML = `-- <span class="text-xs font-normal text-slate-500"></span>`;
            });
            document.getElementById('res-crypto').classList.remove('text-yellow-400');
            document.getElementById('cryptoWarning').classList.add('hidden');

            // 隱藏錯誤與報告按鈕
            hideError();
            document.getElementById('reliabilityBox').classList.add('hidden');
            document.getElementById('copyReportBtn').classList.add('hidden');

            // 關閉 GPU 殘留
            const container = document.getElementById('threeContainer');
            if (container) {
                container.classList.add('hidden');
                container.classList.remove('flex');
                const canvas = container.querySelector('canvas');
                if (canvas) container.removeChild(canvas);
            }

            // 清空 DOM 沙盒
            document.getElementById('domSandbox').innerHTML = '';

            // 重設天梯與文字
            document.getElementById('tierBar').style.width = '0%';
            document.getElementById('scoreMarker').style.opacity = '0';
            const tierText = document.getElementById('tierText');
            tierText.classList.add('hidden');
            tierText.innerHTML = '';

            // 重設雷達圖
            if (radarChart) {
                radarChart.data.datasets[0].data = [0, 0, 0, 0, 0, 0, 0, 0];
                radarChart.update();
            }
        }

        function showError(message) {
            const errDiv = document.getElementById('globalError');
            errDiv.textContent = `⚠️ ${t('error_msg')}: ${message}`;
            errDiv.classList.remove('-translate-y-full');
            // 掃描並標記失敗項目
            ['cpu', 'string', 'ram', 'dom', 'canvas2d', 'gpu', 'crypto', 'storage', 'network'].forEach(id => {
                const el = document.getElementById(`item-${id}`);
                if (el.querySelector('.indicator').classList.contains('bg-yellow-400')) {
                    setStatus(id, t('status_error') || 'Error', 'error');
                }
            });
        }

        function hideError() {
            document.getElementById('globalError').classList.add('-translate-y-full');
        }

        function showFatalError(msg) {
            resetUI();
            showError(msg);
            document.getElementById('startBtn').disabled = true;
            document.getElementById('startBtn').classList.replace('bg-primary', 'bg-slate-700');
            document.querySelector('.btn-text').textContent = t('error_env');
        }

        function checkDependencies() {
            if (!window.Chart) return t('error_chart_load');
            if (!window.THREE) return t('error_three_load');
            return null;
        }

        function withTimeout(promise, ms, label) {
            return Promise.race([
                promise,
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`${label} ${t('error_timeout')} (${ms}ms)`)), ms);
                })
            ]);
        }

        // Hyperbolic saturation normalization: score = 100 * ratio / (ratio + 0.5)
        // This is a Michaelis-Menten curve — smooth, never extreme, no log instability.
        // At baseline (ratio=1.0) → 67,  at 2x → 80,  at 0.5x → 50,  at 0.25x → 33
        // Much gentler than sigmoid — avoids the "all-zeros or all-100s" radar problem.
        function normalize(value, baseline) {
            if (!value || value <= 0) return 0;
            const ratio = value / baseline;
            const score = 100 * ratio / (ratio + 0.5);
            return Math.round(Math.min(Math.max(score, 0), 100));
        }

        function supportsWebGL() {
            try {
                const canvas = document.createElement('canvas');
                return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
            } catch (e) { return false; }
        }

        // cancelBtn listeners moved to DOMContentLoaded

        // 1. CPU 多核心測試 (Worker)
        const cpuWorkerCode = `
            self.onmessage = function(e) {
                const duration = e.data.duration || 1500;
                const startTime = performance.now();
                let ops = 0;
                while (performance.now() - startTime < duration) {
                    let a = Math.random(), b = Math.random(), c = Math.random();
                    for(let i=0; i<1000; i++) {
                        a = (a * b) + c;
                        b = Math.sqrt(a + c);
                        c = Math.sin(b) * Math.cos(a);
                    }
                    ops += 1000;
                }
                self.postMessage(ops);
            };
        `;

        async function runCPUMultiCore(duration, runId) {
            setStatus('cpu', t('status_running_cpu'), 'running');
            const blob = new Blob([cpuWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            let totalOps = 0;
            const allWorkers = [];

            const promises = Array.from({ length: cores }).map(() => {
                return new Promise((resolve, reject) => {
                    const worker = new Worker(workerUrl);
                    allWorkers.push(worker);
                    worker.onmessage = (e) => {
                        totalOps += e.data;
                        worker.terminate();
                        resolve();
                    };
                    worker.onerror = (err) => {
                        worker.terminate();
                        reject(err);
                    };
                    worker.postMessage({ duration });
                });
            });

            try {
                await Promise.all(promises);
            } catch (e) {
                allWorkers.forEach(w => { try { w.terminate(); } catch (_) {} });
                URL.revokeObjectURL(workerUrl);
                throw e;
            }
            URL.revokeObjectURL(workerUrl);
            if (isCancelledRun(runId)) throw new Error(t('error_cancelled'));

            const durationSec = duration / 1000;
            const scoreInM = (totalOps / durationSec / 1000000).toFixed(2);
            setStatus('cpu', `${scoreInM} M/s`, 'done');
            document.getElementById('res-cpu').innerHTML = `${scoreInM} <span class="text-xs font-normal text-slate-500">M/s</span>`;
            return parseFloat(scoreInM);
        }

        // 2. 字串解析測試 (升級為 Worker)
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
        const canvas2dWorkerCode = `
            self.onmessage = function(e) {
                const duration = e.data.duration || 1000;
                const useOffscreen = typeof OffscreenCanvas !== 'undefined';
                let ops = 0;
                const start = performance.now();

                if (useOffscreen) {
                    const canvas = new OffscreenCanvas(800, 600);
                    const ctx = canvas.getContext('2d');
                    while (performance.now() - start < duration) {
                        for (let i = 0; i < 100; i++) {
                            // Deterministic values prevent JIT over-optimisation
                            ctx.fillStyle = 'hsl(' + ((ops * 7 + i * 37) % 360) + ',85%,55%)';
                            ctx.beginPath();
                            ctx.arc(
                                (ops * 13 + i * 79) % 800,
                                (ops * 17 + i * 53) % 600,
                                8 + (i % 42),
                                0, Math.PI * 2
                            );
                            ctx.fill();
                        }
                        ops++;
                    }
                    const durationSec = (performance.now() - start) / 1000;
                    self.postMessage({ ops, durationSec, method: 'OffscreenCanvas' });
                } else {
                    // Fallback: pure computation (pixel math without canvas)
                    let sum = 0;
                    while (performance.now() - start < duration) {
                        for (let i = 0; i < 100; i++) {
                            const x = (ops * 13 + i * 79) % 800;
                            const y = (ops * 17 + i * 53) % 600;
                            sum += Math.sqrt(x * x + y * y);
                        }
                        ops++;
                    }
                    const durationSec = (performance.now() - start) / 1000;
                    self.postMessage({ ops, durationSec, sum, method: 'Fallback' });
                }
            };
        `;

        async function runCanvas2DTest(duration, runId) {
            setStatus('canvas2d', t('status_running_canvas2d'), 'running');
            const blob = new Blob([canvas2dWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl);
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (isCancelledRun(runId)) return reject(new Error(t('error_cancelled')));
                    // ops × 100 draws per op, normalised to per-second
                    const score = Math.round((e.data.ops * 100) / e.data.durationSec);
                    setStatus('canvas2d', `${score} ops/s`, 'done');
                    document.getElementById('res-canvas2d').innerHTML =
                        `${score} <span class="text-xs font-normal text-slate-500">ops/s</span>`;
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

        // 4. DOM 重繪測試 — setTimeout 批次迴圈 (不受 rAF 60fps 天花板限制)
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
        async function runThreeJSTest(config, runId) {
            if (!supportsWebGL()) {
                setStatus('gpu', t('error_no_webgl'), 'error');
                document.getElementById('res-gpu').innerHTML = `N/A`;
                return 0; // 不拋錯，讓後續能結算
            }

            setStatus('gpu', t('status_running_gpu'), 'running');
            const container = document.getElementById('threeContainer');
            const fpsEl = document.getElementById('fpsCounter');
            const gpuStatusEl = document.getElementById('gpuStatus');
            container.classList.remove('hidden');

            return new Promise(async (resolve, reject) => {
                let renderer, scene, camera;
                let rafHandle = null;
                
                let scorePhase1 = 0;
                let scorePhase2 = 0;
                let scorePhase3 = 0;

                let disposables = [];

                const cleanup = () => {
                    if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
                    if (renderer) {
                        renderer.dispose();
                        if (renderer.domElement.parentNode === container) {
                            container.removeChild(renderer.domElement);
                        }
                    }
                    disposables.forEach(d => { if (d.dispose) d.dispose(); });
                    container.classList.add('hidden');
                };

                try {
                    // Use already-captured GPU renderer string to detect Apple ANGLE/Metal
                    // This is more reliable than parsing the User-Agent string.
                    const gpuStr = (typeof deviceSpecs !== 'undefined' && deviceSpecs.gpuRenderer) || '';
                    const isAppleMetal = /ANGLE Metal|Apple M\d/i.test(gpuStr) || /Mac/.test(navigator.platform);

                    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
                    renderer.setSize(window.innerWidth, window.innerHeight);
                    // Apple Metal: cap pixel ratio at 1 to prevent VRAM exhaustion / context loss
                    renderer.setPixelRatio(isAppleMetal ? 1 : (window.devicePixelRatio > 1 ? 1.5 : 1));
                    // Disable shadow maps on Apple ANGLE to avoid Metal driver instability
                    renderer.shadowMap.enabled = !isAppleMetal;
                    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
                    container.appendChild(renderer.domElement);

                    renderer.domElement.addEventListener('webglcontextlost', function (event) {
                        event.preventDefault();
                        cleanup();
                        reject(new Error('WebGL 記憶體耗盡或驅動崩潰'));
                    });

                    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
                    
                    const timePerPhase = config.gpuTimeLimit / 3;

                    const runPhase = (phaseName, initFn, frameFn) => {
                        return new Promise((phaseResolve) => {
                            if (scene) {
                                while(scene.children.length > 0){ scene.remove(scene.children[0]); }
                            }
                            scene = new THREE.Scene();
                            scene.fog = new THREE.FogExp2(0x000000, 0.002);
                            
                            initFn(scene, camera);
                            
                            let frames = 0;
                            let lastTime = performance.now();
                            const startTime = performance.now();
                            let baselineFPS = 0;
                            let dropCount = 0;
                            let warmupDone = false;
                            
                            function animate() {
                                if (isCancelledRun(runId)) {
                                    return phaseResolve('cancelled');
                                }
                                
                                const now = performance.now();
                                frameFn(scene, camera, now);
                                renderer.render(scene, camera);
                                frames++;
                                
                                if (now - lastTime >= 250) {
                                    let currentFPS = Math.round((frames * 1000) / (now - lastTime));
                                    fpsEl.textContent = `${currentFPS} FPS`;
                                    
                                    if (!warmupDone) {
                                        gpuStatusEl.textContent = `${phaseName} - Vsync...`;
                                        if (now - startTime > 500) {
                                            baselineFPS = currentFPS;
                                            warmupDone = true;
                                        }
                                    } else {
                                        let isMaxedOut = false;
                                        if (currentFPS < baselineFPS * 0.85 || currentFPS < 30) {
                                            dropCount++;
                                        } else {
                                            dropCount = 0;
                                            isMaxedOut = !frameFn.increaseLoad();
                                        }
                                        
                                        gpuStatusEl.textContent = `${phaseName} | ${frameFn.getStatus()} | ${baselineFPS} FPS`;
                                        
                                        if (dropCount >= 3 || isMaxedOut || (now - startTime > timePerPhase)) {
                                            return phaseResolve(frameFn.getScore());
                                        }
                                    }
                                    frames = 0;
                                    lastTime = now;
                                }
                                rafHandle = requestAnimationFrame(animate);
                            }
                            rafHandle = requestAnimationFrame(animate);
                        });
                    };

                    // === PHASE 1: The Swarm ===
                    let p1Instances = 1000;
                    let p1Max = config.gpuMax;
                    let p1Mesh, p1Dummy;
                    const p1Frame = (scene, camera, now) => {
                        p1Mesh.rotation.y += 0.005;
                        p1Mesh.rotation.x += 0.002;
                    };
                    p1Frame.increaseLoad = () => {
                        p1Instances += 3000;
                        if (p1Instances > p1Max) return false;
                        p1Mesh.count = p1Instances;
                        return true;
                    };
                    p1Frame.getStatus = () => `${t('status_gpu_p1')} ${(p1Instances / 1000).toFixed(1)}k`;
                    p1Frame.getScore = () => p1Instances;

                    let res = await runPhase('Ph.1/3', (s, c) => {
                        const ambientLight = new THREE.AmbientLight(0x404040);
                        s.add(ambientLight);
                        const dirLight = new THREE.DirectionalLight(0x0abab5, 1);
                        dirLight.position.set(1, 1, 1);
                        s.add(dirLight);

                        const geometry = new THREE.IcosahedronGeometry(1, 0);
                        const material = new THREE.MeshPhongMaterial({ color: 0x222222, specular: 0x0abab5, shininess: 50, emissive: 0x050505 });
                        disposables.push(geometry, material);
                        p1Mesh = new THREE.InstancedMesh(geometry, material, p1Max);
                        p1Dummy = new THREE.Object3D();
                        for (let i = 0; i < p1Max; i++) {
                            p1Dummy.position.set((Math.random() - 0.5) * 400, (Math.random() - 0.5) * 400, (Math.random() - 0.5) * 400);
                            p1Dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
                            p1Dummy.scale.setScalar(Math.random() * 2 + 0.5);
                            p1Dummy.updateMatrix();
                            p1Mesh.setMatrixAt(i, p1Dummy.matrix);
                        }
                        p1Mesh.count = p1Instances;
                        s.add(p1Mesh);
                        c.position.set(0, 0, 150);
                        c.lookAt(0,0,0);
                    }, p1Frame);
                    if (res === 'cancelled') { cleanup(); return reject(new Error(t('error_cancelled'))); }
                    scorePhase1 = res;

                    // === PHASE 2: The Void (Fragment Shader) ===
                    let p2Uniforms;
                    let p2Iters = 20;
                    const p2Frame = (scene, camera, now) => {
                        p2Uniforms.uTime.value = now / 1000;
                    };
                    p2Frame.increaseLoad = () => {
                        p2Iters += 15;
                        p2Uniforms.uIters.value = p2Iters;
                        return true;
                    };
                    p2Frame.getStatus = () => `${t('status_gpu_p2')} ${p2Iters}`;
                    p2Frame.getScore = () => p2Iters;

                    res = await runPhase('Ph.2/3', (s, c) => {
                        c.position.set(0, 0, 1);
                        c.lookAt(0,0,0);
                        p2Uniforms = {
                            uTime: { value: 0 },
                            uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                            uIters: { value: p2Iters }
                        };
                        const mat = new THREE.ShaderMaterial({
                            uniforms: p2Uniforms,
                            vertexShader: `
                                varying vec2 vUv;
                                void main() {
                                    vUv = uv;
                                    gl_Position = vec4(position, 1.0);
                                }
                            `,
                            fragmentShader: `
                                uniform float uTime;
                                uniform vec2 uResolution;
                                uniform float uIters;
                                varying vec2 vUv;
                                void main() {
                                    vec2 p = (vUv - 0.5) * 2.0;
                                    p.x *= uResolution.x / uResolution.y;
                                    float iters = uIters;
                                    vec3 col = vec3(0.0);
                                    vec2 z = p;
                                    for(float i=0.0; i<500.0; i++) {
                                        if (i >= iters) break;
                                        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + vec2(0.35 + sin(uTime*0.1)*0.1, 0.4);
                                        if (length(z) > 2.0) {
                                            float c = i / iters;
                                            col = vec3(c*0.8, c*0.2, c*1.0);
                                            break;
                                        }
                                        z += vec2(sin(z.y*10.0)*0.01, cos(z.x*10.0)*0.01);
                                    }
                                    gl_FragColor = vec4(col, 1.0);
                                }
                            `
                        });
                        const geom = new THREE.PlaneGeometry(2, 2);
                        disposables.push(geom, mat);
                        const plane = new THREE.Mesh(geom, mat);
                        s.add(plane);
                    }, p2Frame);
                    if (res === 'cancelled') { cleanup(); return reject(new Error(t('error_cancelled'))); }
                    scorePhase2 = res;

                    // === PHASE 3: The Core (Dynamic Shadows & Lights) ===
                    let p3Lights = [];
                    let p3LightCount = 1;
                    let p3Mesh;
                    const p3Frame = (scene, camera, now) => {
                        p3Mesh.rotation.y = now / 2000;
                        p3Mesh.rotation.x = now / 3000;
                        const t = now / 1000;
                        for(let i=0; i<p3Lights.length; i++){
                            if(i < p3LightCount) {
                                p3Lights[i].position.x = Math.sin(t + i*2) * 30;
                                p3Lights[i].position.z = Math.cos(t + i*2) * 30;
                                p3Lights[i].position.y = Math.sin(t*2 + i) * 10 + 10;
                            }
                        }
                    };
                    p3Frame.increaseLoad = () => {
                        if (p3LightCount >= p3Lights.length) {
                            const c = new THREE.Color();
                            c.setHSL(Math.random(), 1, 0.5);
                            const l = new THREE.PointLight(c, 1, 80);
                            l.castShadow = true;
                            l.shadow.mapSize.width = 256; 
                            l.shadow.mapSize.height = 256;
                            p3Lights.push(l);
                            scene.add(l);
                        }
                        p3LightCount++;
                        return true;
                    };
                    p3Frame.getStatus = () => `${t('status_gpu_p3')} ${p3LightCount}`;
                    p3Frame.getScore = () => p3LightCount;

                    res = await runPhase('Ph.3/3', (s, c) => {
                        c.position.set(0, 40, 80);
                        c.lookAt(0, 0, 0);

                        const floorMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.2, metalness: 0.8 });
                        const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMat);
                        floor.rotation.x = -Math.PI / 2;
                        floor.position.y = -15;
                        floor.receiveShadow = true;
                        
                        const knotGeom = new THREE.TorusKnotGeometry(10, 3, 200, 32);
                        const knotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 1.0 });
                        p3Mesh = new THREE.Mesh(knotGeom, knotMat);
                        p3Mesh.castShadow = true;
                        p3Mesh.receiveShadow = true;
                        
                        disposables.push(floorMat, knotGeom, knotMat, floor.geometry);
                        s.add(floor);
                        s.add(p3Mesh);

                        p3Lights = [];
                        for(let i=0; i<p3LightCount; i++) {
                            const c = new THREE.Color();
                            c.setHSL(i/p3LightCount, 1, 0.5);
                            const l = new THREE.PointLight(c, 1, 80);
                            l.castShadow = true;
                            l.shadow.mapSize.width = 256;
                            l.shadow.mapSize.height = 256;
                            p3Lights.push(l);
                            s.add(l);
                        }
                    }, p3Frame);
                    if (res === 'cancelled') { cleanup(); return reject(new Error(t('error_cancelled'))); }
                    scorePhase3 = res;

                    cleanup();

                    // Unified GPU score: Phase1=geometry throughput, Phase2=shader complexity, Phase3=light count
                    // Scale each to roughly 0-1000 range before weighting
                    const p1Score = Math.min(scorePhase1 / config.gpuMax, 1) * 1000; // 0-1000
                    const p2Score = Math.min(scorePhase2 / 200, 1) * 1000;           // 200 iters = max
                    const p3Score = Math.min(scorePhase3 / 30, 1) * 1000;            // 30 lights = max
                    const unifiedScore = Math.round(p1Score * 0.5 + p2Score * 0.3 + p3Score * 0.2);
                    
                    setStatus('gpu', `${unifiedScore} Pts`, 'done');
                    document.getElementById('res-gpu').innerHTML = `${unifiedScore} <span class="text-xs font-normal text-slate-500">Pts</span>`;
                    
                    resolve({ value: unifiedScore, onePercentLow: unifiedScore });

                } catch (e) {
                    cleanup();
                    reject(e);
                }
            });
        }

        // 6. WebCrypto 加解密測試 (升級為 Worker 且解決 JIT/快取問題)
        const cryptoWorkerCode = `
            self.onmessage = async function(e) {
                const duration = e.data.duration || 4000;
                try {
                    const key = await crypto.subtle.generateKey(
                        { name: "AES-GCM", length: 256 },
                        true,
                        ["encrypt", "decrypt"]
                    );
                    const chunkSize = 1024 * 1024; // 1MB
                    const bufferPool = [];
                    for(let i=0; i<4; i++) {
                        const arr = new Uint8Array(chunkSize);
                        const seed = crypto.getRandomValues(new Uint8Array(65536));
                        for (let j = 0; j < arr.length; j += seed.length) {
                            arr.set(seed.subarray(0, Math.min(seed.length, arr.length - j)), j);
                        }
                        bufferPool.push(arr);
                    }

                    let totalEncrypted = 0;
                    const startTime = performance.now();
                    let poolIndex = 0;

                    while (true) {
                        if (performance.now() - startTime > duration) break;

                        const promises = [];
                        for(let i=0; i<8; i++) {
                            const freshIv = crypto.getRandomValues(new Uint8Array(12)); // Fix 1-C: 每次加密使用新 IV
                            promises.push(crypto.subtle.encrypt(
                                { name: "AES-GCM", iv: freshIv }, key, bufferPool[poolIndex]
                            ));
                            poolIndex = (poolIndex + 1) % bufferPool.length;
                        }
                        await Promise.all(promises);
                        totalEncrypted += chunkSize * 8;
                    }

                    const durationSec = (performance.now() - startTime) / 1000;
                    const mbPerSec = (totalEncrypted / (1024 * 1024) / durationSec).toFixed(0);
                    self.postMessage({ success: true, score: parseFloat(mbPerSec) });
                } catch (e) {
                    self.postMessage({ success: false, error: e.message });
                }
            };
        `;

        async function runCryptoTest(duration, runId) {
            setStatus('crypto', t('status_running_crypto'), 'running');
            const blob = new Blob([cryptoWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl);
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (isCancelledRun(runId)) return reject(new Error(t('error_cancelled')));

                    if (e.data.success) {
                        const mbPerSec = e.data.score;
                        setStatus('crypto', `${mbPerSec} MB/s`, 'done');
                        const resEl = document.getElementById('res-crypto');

                        // 不再人工封頂，而是回傳 warning 標記
                        if (mbPerSec > 10000) {
                            resEl.innerHTML = `${mbPerSec} <span class="text-xs font-normal text-primary/60">MB/s</span>`;
                            resEl.classList.replace('text-primary', 'text-yellow-400');
                            document.getElementById('cryptoWarning').classList.remove('hidden');
                            resolve({ value: mbPerSec, warning: '數值異常偏高，可能受瀏覽器快取或硬體加速影響' });
                        } else {
                            resEl.innerHTML = `${mbPerSec} <span class="text-xs font-normal text-primary/60">MB/s</span>`;
                            resolve(mbPerSec);
                        }
                    } else {
                        reject(new Error(e.data.error));
                    }
                };
                worker.onerror = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    reject(new Error('WebCrypto ' + t('error_worker')));
                };
                worker.postMessage({ duration });
            });
        }

        // 7. Storage I/O 測試 (OPFS / IndexedDB Fallback)
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
        async function runNetworkTest(duration, runId) {
            try {
                let pings = [];
                // 1. Ping Test — use speed.cloudflare.com (CORS-friendly, 0-byte payload = pure RTT)
                setStatus('network', t('network_pinging'), 'running');
                for (let i = 0; i < 5; i++) {
                    if (isCancelledRun(runId)) return Promise.reject(new Error(t('error_cancelled')));
                    const pStart = performance.now();
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    try {
                        // 防緩存：多重時間戳 + 隨機數
                        const noCacheParam = `t=${Date.now()}_r${Math.random().toString(36).substr(2)}_${crypto.getRandomValues(new Uint32Array(1))[0]}`;
                        const resp = await fetch(`https://speed.cloudflare.com/__down?bytes=0&${noCacheParam}`, {
                            method: 'HEAD',
                            cache: 'no-store',
                            signal: controller.signal,
                            headers: {
                                'Cache-Control': 'no-cache, no-store, must-revalidate',
                                'Pragma': 'no-cache'
                            }
                        });
                        pings.push(performance.now() - pStart);
                    } catch(e) {}
                    clearTimeout(timeoutId);
                }
                pings.sort((a, b) => a - b);
                const ping = pings.length >= 3 ? Math.round(pings[Math.floor(pings.length / 2)]) : (pings[0] ? Math.round(pings[0]) : null);

                // 2. Download Test — use larger file for fast connections (>100Mbps)
                setStatus('network', t('network_downloading'), 'running');
                
                // 根據 Ping 動態調整文件大小和超時
                const adaptiveParams = {
                    high: { dlSize: 5000000, dlTimeout: 45000, ulSize: 500000, ulTimeout: 20000 },
                    medium: { dlSize: 25000000, dlTimeout: 30000, ulSize: 1000000, ulTimeout: 15000 },
                    low: { dlSize: 100000000, dlTimeout: 20000, ulSize: 3000000, ulTimeout: 10000 }
                };
                let latencyLevel = 'medium';
                if (ping !== null) {
                    latencyLevel = ping > 500 ? 'high' : ping > 100 ? 'medium' : 'low';
                }
                const params = adaptiveParams[latencyLevel];
                const dlSize = selectedMode === 'quick' ? Math.min(params.dlSize, 25000000) : params.dlSize;
                
                let dlStart = performance.now();
                const dlController = new AbortController();
                const dlTimeoutId = setTimeout(() => dlController.abort(), params.dlTimeout);
                let dlMbps = 0;
                let receivedLength = 0;
                try {
                    // 防緩存：多重時間戳 + 隨機數
                    const noCacheParam = `t=${Date.now()}_r${Math.random().toString(36).substr(2)}_${crypto.getRandomValues(new Uint32Array(1))[0]}`;
                    const dlResp = await fetch(
                        `https://speed.cloudflare.com/__down?bytes=${dlSize}&${noCacheParam}`,
                        {
                            cache: 'no-store',
                            signal: dlController.signal,
                            headers: {
                                'Cache-Control': 'no-cache, no-store, must-revalidate',
                                'Pragma': 'no-cache'
                            }
                        }
                    );
                    if (!dlResp.ok) throw new Error(`DL HTTP ${dlResp.status}`);
                    
                    // 取得預期大小
                    let expectedSize = dlSize;
                    const contentLength = dlResp.headers.get('content-length');
                    if (contentLength) {
                        expectedSize = parseInt(contentLength, 10);
                    }
                    
                    const reader = dlResp.body.getReader();
                    while(true) {
                        if (isCancelledRun(runId)) { dlController.abort(); return Promise.reject(new Error(t('error_cancelled'))); }
                        const {done, value} = await reader.read();
                        if (done) break;
                        receivedLength += value.length;
                    }
                    
                    // 驗證數據完整性
                    const completionRate = receivedLength / expectedSize;
                    if (completionRate < 0.9) {
                        console.warn(`DL completion: ${(completionRate*100).toFixed(1)}%, data may be incomplete`);
                    }
                    
                    const dlDurationSec = (performance.now() - dlStart) / 1000;
                    dlMbps = parseFloat(((receivedLength * 8) / (1024 * 1024) / dlDurationSec).toFixed(1));
                } catch(e) {
                    if (e.name === 'AbortError' && receivedLength > 0) {
                        const dlDurationSec = (performance.now() - dlStart) / 1000;
                        dlMbps = parseFloat(((receivedLength * 8) / (1024 * 1024) / dlDurationSec).toFixed(1));
                    } else {
                        console.error('DL test failed:', e.message);
                        dlMbps = null;
                    }
                }
                clearTimeout(dlTimeoutId);

                // 3. Upload Test
                setStatus('network', t('network_uploading'), 'running');
                const ulSize = selectedMode === 'quick' ? params.ulSize * 0.3 : params.ulSize;
                
                // 生成更好的隨機數據
                const ulData = new Uint8Array(ulSize);
                const seedBuffer = crypto.getRandomValues(new Uint8Array(4096));
                for(let i = 0; i < ulSize; i += 4096) {
                    ulData.set(seedBuffer.subarray(0, Math.min(4096, ulSize - i)), i);
                }
                
                let ulStart = performance.now();
                const ulController = new AbortController();
                const ulTimeoutId = setTimeout(() => ulController.abort(), params.ulTimeout);
                let ulMbps = 0;
                try {
                    // 防緩存：多重時間戳 + 隨機數
                    const noCacheParam = `t=${Date.now()}_r${Math.random().toString(36).substr(2)}_${crypto.getRandomValues(new Uint32Array(1))[0]}`;
                    const ulResp = await fetch(`https://speed.cloudflare.com/__up?${noCacheParam}`, {
                        method: 'POST',
                        body: ulData,
                        cache: 'no-store',
                        signal: ulController.signal,
                        headers: {
                            'Cache-Control': 'no-cache, no-store, must-revalidate',
                            'Pragma': 'no-cache',
                            'Content-Type': 'application/octet-stream'
                        }
                    });
                    if (ulResp.ok) {
                        const ulDurationSec = (performance.now() - ulStart) / 1000;
                        ulMbps = parseFloat(((ulSize * 8) / (1024 * 1024) / ulDurationSec).toFixed(1));
                    } else {
                        console.error(`UL HTTP ${ulResp.status}`);
                    }
                } catch(e) {
                    console.error('UL test failed:', e.message);
                }
                clearTimeout(ulTimeoutId);

                return { value: dlMbps, dl: dlMbps, ul: ulMbps, ping: ping };
            } catch (e) {
                if (e.message === t('error_cancelled') || e.message === '使用者取消測試') throw e;
                setStatus('network', t('error_network_failed'), 'error');
                document.getElementById('res-network').innerHTML = `N/A`;
                return { value: 0, dl: null, ul: null, ping: null, error: '無法連線測試節點' };
            }
        }


        async function runWithSampling(name, testFn, iterations, durationPerIter, runId, isNetwork=false) {
            let results = [];
            let fullResults = [];
            for(let i=0; i<iterations; i++) {
                if (isCancelledRun(runId)) throw new Error(t('error_cancelled'));
                let res = await testFn(durationPerIter, runId);
                let val = (typeof res === 'object') ? (res.value || res.score || res) : res;
                results.push(val);
                fullResults.push(res);
                if (iterations > 1 && i < iterations - 1) {
                    await new Promise(r => setTimeout(r, 100)); // Let CPU breathe
                }
            }
            
            let finalVal;
            if (iterations === 1) finalVal = results[0];
            else {
                results.sort((a,b) => a - b);
                if (isNetwork) {
                    let sum = results.reduce((a,b) => a+b, 0);
                    finalVal = sum / iterations;
                } else {
                    finalVal = results[Math.floor(iterations/2)]; // Median
                }
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
                    const pingStr = resObj.ping != null ? `${resObj.ping} ms` : 'N/A';
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
                setStatus('gpu', `${Math.floor(finalVal)} Pts`, 'done');
                document.getElementById('res-gpu').innerHTML = `${Math.floor(finalVal)} <span class="text-xs font-normal text-slate-500">Pts</span>`;
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

        function calculateReliability(results, isCancelled, errorOccurred) {
            let score = t('rel_high');
            let reason = t('rel_reason_high');
            let colorClass = 'bg-primary';

            if (isCancelled) {
                return { score: t('rel_none'), reason: t('rel_reason_cancelled'), colorClass: 'bg-slate-600' };
            }

            if (errorOccurred) {
                if (!results.cpu || !results.gpu || (typeof results.gpu === 'object' ? results.gpu.value === undefined : results.gpu === undefined)) {
                    score = t('rel_low');
                    reason = t('rel_reason_core_err');
                    colorClass = 'bg-red-500';
                } else {
                    score = t('rel_med');
                    reason = t('rel_reason_sub_err');
                    colorClass = 'bg-yellow-500';
                }
            } else if (results.crypto && typeof results.crypto === 'object' && results.crypto.warning) {
                score = t('rel_med');
                reason = t('rel_reason_crypto_warn');
                colorClass = 'bg-yellow-500';
            }

            return { score, reason, colorClass };
        }

        function calculateFinalScore(results) {
            const valCrypto = typeof results.crypto === 'object' ? results.crypto.value : (results.crypto || 0);
            const valGPU = typeof results.gpu === 'object' ? results.gpu.value : (results.gpu || 0);
            const valStorage = typeof results.storage === 'object' ? results.storage.value : (results.storage || 0);
            const valNetwork = typeof results.network === 'object' ? results.network.value : (results.network || 0);

            // 8 項獨立正規化
            const normCPU = normalize(results.cpu || 0, BENCHMARK_BASELINE.cpu);
            const normString = normalize(results.string || 0, BENCHMARK_BASELINE.string);
            const normMemory = normalize(results.memory || 0, BENCHMARK_BASELINE.memory); // Fixed RAM key to memory
            const normDOM = normalize(results.dom || 0, BENCHMARK_BASELINE.dom);
            const normCanvas2D = normalize(results.canvas2d || 0, BENCHMARK_BASELINE.canvas2d);
            const normGPU = normalize(valGPU, BENCHMARK_BASELINE.gpu);
            const normCrypto = normalize(valCrypto, BENCHMARK_BASELINE.crypto);
            const normStorage = normalize(valStorage, BENCHMARK_BASELINE.storage);
            const normNetwork = normalize(valNetwork, BENCHMARK_BASELINE.network);

            if (radarChart) {
                // 8 axes (Network excluded from radar — shown separately as info)
                radarChart.data.datasets[0].data = [normCPU, normString, normCrypto, normMemory, normStorage, normDOM, normGPU, normCanvas2D];
                radarChart.update();
            }

            // 7 項硬體加權計分 (Network 不計分)
            return Math.round(
                normCPU * 0.25 +
                normGPU * 0.20 +
                normCanvas2D * 0.10 +
                normDOM * 0.10 +
                normStorage * 0.10 +
                normMemory * 0.10 +
                normString * 0.10 +
                normCrypto * 0.05
            );
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
            const scores = [
                {
                    name: t('cpu_calc'),
                    norm: normCPU,
                    advice: isMobile ? t('advice_mobile_cpu') : t('advice_diy_cpu')
                },
                {
                    name: t('gpu_webgl'),
                    norm: normGPU,
                    advice: isMobile ? t('advice_mobile_gpu') : t('advice_diy_gpu')
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
            scores.sort((a, b) => a.norm - b.norm);
            const weakestLink = scores[0];

            return {
                fitness: { webBrowsing, multiTab, web3D, heavyWebApps },
                weakestLink: weakestLink.norm < 60 ? weakestLink : null
            };
        }

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

        window.addEventListener('DOMContentLoaded', () => {
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
