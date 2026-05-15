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
        const BENCHMARK_BASELINE = {
            cpu: 800,      // M/s 
            string: 1200,  // k ops/s
            memory: 200,   // cyc/s
            dom: 30000,    // ops/s
            gpu: 300000,   // objs
            crypto: 4000,  // MB/s
            storage: 800,  // MB/s
            network: 1000, // Mbps
            canvas2d: 8000 // ops/s
        };

        // 模式設定 (分級策略)
        const MODE_SETTINGS = {
            quick: { gpuMax: 50000, gpuTimeLimit: 10000, cpuTime: 1500, otherTime: 1000, label: '快速', desc: '適合手機或輕度測試' },
            standard: { gpuMax: 150000, gpuTimeLimit: 20000, cpuTime: 3000, otherTime: 2000, label: '標準', desc: '適合一般筆電或桌機' },
            extreme: { gpuMax: 500000, gpuTimeLimit: 30000, cpuTime: 5000, otherTime: 3000, label: '極限', desc: '適合高階桌機 (不建議手機使用)' },
            stability: { gpuMax: 150000, gpuTimeLimit: 20000, cpuTime: 2000, otherTime: 1500, iterations: 3, label: '穩定', desc: '多次取樣，減少波動與系統干擾' },
            burnin: { gpuMax: 500000, gpuTimeLimit: 120000, cpuTime: 15000, otherTime: 5000, label: '燒機', desc: '長時間壓力測試 (測量散熱與穩定度)' }
        };

        function getDeviceSpecs() {
            const specs = {
                userAgent: navigator.userAgent,
                cores: navigator.hardwareConcurrency || '未知',
                memory: navigator.deviceMemory ? `${navigator.deviceMemory} GB+` : '未知/受限',
                resolution: `${window.screen.width}x${window.screen.height}`,
                pixelRatio: window.devicePixelRatio || 1,
                platform: navigator.platform || '未知',
                gpuRenderer: '未知 (無 WebGL 權限)'
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
            } catch (e) { console.warn("無法取得 GPU 資訊"); }

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
                descEl.textContent = mode.desc;
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
                text.textContent = '評測執行中...';
                btn.classList.replace('bg-primary', 'bg-slate-700');
                cancelBtn.classList.remove('hidden');
                modeInputs.forEach(input => input.disabled = true);
            } else {
                btn.disabled = false;
                icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>`;
                icon.classList.remove('animate-spin');
                text.textContent = '重新測試';
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
            errDiv.textContent = `⚠️ 測試中斷: ${message}`;
            errDiv.classList.remove('-translate-y-full');
            // 掃描並標記失敗項目
            ['cpu', 'string', 'ram', 'dom', 'canvas2d', 'gpu', 'crypto', 'storage', 'network'].forEach(id => {
                const el = document.getElementById(`item-${id}`);
                if (el.querySelector('.indicator').classList.contains('bg-yellow-400')) {
                    setStatus(id, '失敗/中斷', 'error');
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
            document.querySelector('.btn-text').textContent = '環境錯誤無法執行';
        }

        function checkDependencies() {
            if (!window.Chart) return 'Chart.js 載入失敗，無法顯示圖表。請檢查網路連線。';
            if (!window.THREE) return 'Three.js 載入失敗，無法執行圖形測試。請檢查網路連線。';
            return null;
        }

        function withTimeout(promise, ms, label) {
            return Promise.race([
                promise,
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`${label} 測試逾時 (${ms}ms)`)), ms);
                })
            ]);
        }

        function normalize(value, baseline) {
            return Math.min((value / baseline) * 100, 100);
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
            setStatus('cpu', '全核運算中...', 'running');
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
            if (isCancelledRun(runId)) throw new Error('使用者取消測試');

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
            setStatus('string', '解析中...', 'running');
            const blob = new Blob([stringWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl);
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (isCancelledRun(runId)) return reject(new Error('使用者取消測試'));
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
            setStatus('ram', '分配中...', 'running');
            const blob = new Blob([ramWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl);
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (isCancelledRun(runId)) return reject(new Error('使用者取消測試'));
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


        // Canvas 2D 繪圖測試
        async function runCanvas2DTest(duration, runId) {
            setStatus('canvas2d', '繪製中...', 'running');
            const box = document.getElementById('domSandbox');
            const canvas = document.createElement('canvas');
            canvas.width = 800; canvas.height = 600;
            box.appendChild(canvas);
            const ctx = canvas.getContext('2d');
            const start = performance.now();
            let frames = 0;

            return new Promise((resolve, reject) => {
                function step() {
                    if (isCancelledRun(runId)) return reject(new Error('使用者取消測試'));
                    for (let i = 0; i < 100; i++) {
                        ctx.fillStyle = `hsl(${Math.random() * 360}, 100%, 50%)`;
                        ctx.beginPath();
                        ctx.arc(Math.random() * 800, Math.random() * 600, Math.random() * 50, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    frames++;
                    if (performance.now() - start < duration) {
                        requestAnimationFrame(step);
                    } else {
                        box.innerHTML = '';
                        const durationSec = duration / 1000;
                        const score = Math.round((frames * 100) / durationSec);
                        resolve(score);
                    }
                }
                requestAnimationFrame(step);
            });
        }
        // 4. DOM 重繪測試 (分段執行以防卡死)
        async function runDOMTest(duration, runId) {
            setStatus('dom', '重繪中...', 'running');
            const box = document.getElementById('domSandbox');
            const start = performance.now();
            let ops = 0;

            return new Promise((resolve, reject) => {
                function step() {
                    if (isCancelledRun(runId)) return reject(new Error('使用者取消測試'));

                    // 每幀執行 50 次重繪
                    for (let i = 0; i < 50; i++) {
                        box.innerHTML = `<div style="padding:${ops % 10}px"><span>${ops}</span></div>`;
                        box.offsetHeight; // Force Layout Thrashing
                        ops++;
                    }

                    if (performance.now() - start < duration) {
                        requestAnimationFrame(step);
                    } else {
                        box.innerHTML = '';
                        const durationSec = duration / 1000;
                        const score = Math.round(ops / durationSec);
                        setStatus('dom', `${score} ops/s`, 'done');
                        document.getElementById('res-dom').innerHTML = `${score} <span class="text-xs font-normal text-slate-500">ops/s</span>`;
                        resolve(score);
                    }
                }
                requestAnimationFrame(step);
            });
        }

        // 5. Three.js GPU 動態壓力探測
        async function runThreeJSTest(config, runId) {
            if (!supportsWebGL()) {
                setStatus('gpu', '不支援 WebGL', 'error');
                document.getElementById('res-gpu').innerHTML = `N/A`;
                return 0; // 不拋錯，讓後續能結算
            }

            setStatus('gpu', '渲染探測中...', 'running');
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
                    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
                    renderer.setSize(window.innerWidth, window.innerHeight);
                    renderer.setPixelRatio(window.devicePixelRatio > 1 ? 1.5 : 1);
                    renderer.shadowMap.enabled = true;
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
                    p1Frame.getStatus = () => `幾何實體: ${(p1Instances / 1000).toFixed(1)}k`;
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
                    if (res === 'cancelled') { cleanup(); return reject(new Error('使用者取消測試')); }
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
                    p2Frame.getStatus = () => `分形著色: ${p2Iters} 疊代`;
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
                    if (res === 'cancelled') { cleanup(); return reject(new Error('使用者取消測試')); }
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
                    p3Frame.getStatus = () => `PBR 動態陰影: ${p3LightCount} 盞`;
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
                    if (res === 'cancelled') { cleanup(); return reject(new Error('使用者取消測試')); }
                    scorePhase3 = res;

                    cleanup();

                    const unifiedScore = (scorePhase1 / 1000) * 0.8 + (scorePhase2 * 0.5) + (scorePhase3 * 1.5);
                    
                    setStatus('gpu', `${Math.floor(unifiedScore)} Pts`, 'done');
                    document.getElementById('res-gpu').innerHTML = `${Math.floor(unifiedScore)} <span class="text-xs font-normal text-slate-500">Pts</span>`;
                    
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
            setStatus('crypto', 'AES-GCM 加速中...', 'running');
            const blob = new Blob([cryptoWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl);
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (isCancelledRun(runId)) return reject(new Error('使用者取消測試'));

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
                    reject(new Error('WebCrypto Worker 執行失敗'));
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
            setStatus('storage', '讀寫測試中...', 'running');
            const blob = new Blob([storageWorkerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const worker = new Worker(workerUrl);
                worker.onmessage = (e) => {
                    worker.terminate();
                    URL.revokeObjectURL(workerUrl);
                    if (isCancelledRun(runId)) return reject(new Error('使用者取消測試'));

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
                    reject(new Error('Storage Worker 執行失敗'));
                };
                worker.postMessage({ duration });
            });
        }

        // 8. 網路下載測速 (Network Fetch)
        async function runNetworkTest(duration, runId) {
            try {
                let pings = [];
                // 1. Ping Test
                setStatus('network', t('network_pinging'), 'running');
                for (let i = 0; i < 5; i++) {
                    if (isCancelledRun(runId)) return Promise.reject(new Error('使用者取消測試'));
                    let pStart = performance.now();
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    try {
                        await fetch(`https://cloudflare.com/cdn-cgi/trace?t=${Date.now()}`, { method: 'GET', cache: 'no-store', signal: controller.signal });
                        pings.push(performance.now() - pStart);
                    } catch(e) {}
                    clearTimeout(timeoutId);
                }
                pings.sort((a,b) => a - b);
                const ping = pings.length >= 3 ? Math.round(pings[Math.floor(pings.length/2)]) : (pings[0] ? Math.round(pings[0]) : 0);

                // 2. Download Test
                setStatus('network', t('network_downloading'), 'running');
                const selectedMode = document.querySelector('input[name="testMode"]:checked')?.value;
                const dlSize = selectedMode === 'quick' ? 5000000 : 25000000;
                let dlStart = performance.now();
                const dlController = new AbortController();
                const dlTimeoutId = setTimeout(() => dlController.abort(), 8000);
                let dlMbps = 0;
                let receivedLength = 0;
                try {
                    const dlResp = await fetch(`https://speed.cloudflare.com/__down?bytes=${dlSize}&t=${Date.now()}`, { cache: 'no-store', signal: dlController.signal });
                    if (!dlResp.ok) throw new Error('DL Fetch failed');
                    const reader = dlResp.body.getReader();
                    while(true) {
                        if (isCancelledRun(runId)) { dlController.abort(); return Promise.reject(new Error('使用者取消測試')); }
                        const {done, value} = await reader.read();
                        if (done) break;
                        receivedLength += value.length;
                    }
                    const dlDurationSec = (performance.now() - dlStart) / 1000;
                    dlMbps = parseFloat(((receivedLength * 8) / (1024 * 1024) / dlDurationSec).toFixed(1));
                } catch(e) {
                    if (e.name === 'AbortError' && receivedLength > 0) {
                        const dlDurationSec = (performance.now() - dlStart) / 1000;
                        dlMbps = parseFloat(((receivedLength * 8) / (1024 * 1024) / dlDurationSec).toFixed(1));
                    }
                }
                clearTimeout(dlTimeoutId);

                // 3. Upload Test
                setStatus('network', t('network_uploading'), 'running');
                const ulSize = selectedMode === 'quick' ? 1000000 : 3000000; 
                const ulData = new Uint8Array(ulSize);
                for(let i=0; i<ulSize; i+=4096) ulData[i] = Math.random() * 255;
                let ulStart = performance.now();
                const ulController = new AbortController();
                const ulTimeoutId = setTimeout(() => ulController.abort(), 8000);
                let ulMbps = 0;
                try {
                    const ulResp = await fetch(`https://speed.cloudflare.com/__up?t=${Date.now()}`, {
                        method: 'POST', body: ulData, cache: 'no-store', signal: ulController.signal
                    });
                    if (ulResp.ok) {
                        const ulDurationSec = (performance.now() - ulStart) / 1000;
                        ulMbps = parseFloat(((ulSize * 8) / (1024 * 1024) / ulDurationSec).toFixed(1));
                    }
                } catch(e) {}
                clearTimeout(ulTimeoutId);

                return { value: dlMbps, dl: dlMbps, ul: ulMbps, ping: ping };
            } catch (e) {
                if (e.message === "使用者取消測試") throw e;
                setStatus('network', '連線失敗或逾時', 'error');
                document.getElementById('res-network').innerHTML = `N/A`;
                return { value: 0, dl: 0, ul: 0, ping: 0, error: '無法連線測試節點' };
            }
        }


        async function runWithSampling(name, testFn, iterations, durationPerIter, runId, isNetwork=false) {
            let results = [];
            let fullResults = [];
            for(let i=0; i<iterations; i++) {
                if (isCancelledRun(runId)) throw new Error('使用者取消測試');
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
                // Because network returns an object with dl, ul, ping, and we run iterations=1
                let resObj = fullResults[0];
                if (resObj && typeof resObj === 'object' && resObj.dl !== undefined) {
                    setStatus('network', `D: ${resObj.dl} | U: ${resObj.ul}`, 'done');
                    document.getElementById('res-network').innerHTML = `
                        <div class="flex flex-col">
                            <span class="text-lg">${resObj.dl} <span class="text-[10px] text-slate-500">DL</span> / ${resObj.ul} <span class="text-[10px] text-slate-500">UL</span></span>
                            <span class="text-xs text-slate-500 mt-1">Ping: ${resObj.ping} ms</span>
                        </div>
                    `;
                    return resObj;
                } else {
                    setStatus('network', `0 Mbps`, 'error');
                    return 0;
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
            let score = '高';
            let reason = '所有測試項目皆順利完成，無異常波動。';
            let colorClass = 'bg-primary';

            if (isCancelled) {
                return { score: '無', reason: '測試遭使用者手動中斷。', colorClass: 'bg-slate-600' };
            }

            if (errorOccurred) {
                if (!results.cpu || !results.gpu || (typeof results.gpu === 'object' ? results.gpu.value === undefined : results.gpu === undefined)) {
                    score = '低';
                    reason = '核心測試 (CPU/GPU) 發生錯誤或未完成，總分不具參考價值。';
                    colorClass = 'bg-red-500';
                } else {
                    score = '中';
                    reason = '部分次要測試發生中斷，總分可能略有偏差。';
                    colorClass = 'bg-yellow-500';
                }
            } else if (results.crypto && typeof results.crypto === 'object' && results.crypto.warning) {
                score = '中';
                reason = 'Crypto 數值異常偏高，可能受到底層快取或極端硬體加速影響。';
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
                // 依據相近性質分組，讓雷達圖形狀更平滑 (Compute -> Memory/IO -> Render)
                radarChart.data.datasets[0].data = [normCPU, normString, normCrypto, normMemory, normStorage, normNetwork, normDOM, normGPU, normCanvas2D];
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
            let webBrowsing = '非常順暢';
            let multiTab = '非常順暢';
            let web3D = '游刃有餘';
            let heavyWebApps = '輕鬆應付';

            if (finalScore < 30) {
                webBrowsing = '順暢';
                multiTab = '可能卡頓';
                web3D = '不建議';
                heavyWebApps = '極度吃力';
            } else if (finalScore < 60) {
                webBrowsing = '非常順暢';
                multiTab = '順暢';
                web3D = '勉強可用';
                heavyWebApps = '可用，但建議接上電源';
            } else if (finalScore < 85) {
                webBrowsing = '非常順暢';
                multiTab = '非常順暢';
                web3D = '中上水準';
                heavyWebApps = '順暢運行';
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
            let text = `YieldVitals V1.0 瀏覽器效能測試報告 [模式: ${modeLabel}]\n`;
            text += `=========================\n`;
            text += `綜合評分：${finalScore}\n`;
            text += `結果可信度：${rel.score} (${rel.reason})\n\n`;
            text += `[ 測試細項 ]\n`;
            text += `- 邏輯運算 (CPU): ${results.cpu || 0} M/s\n`;
            text += `- 字串解析: ${results.string || 0} k ops\n`;
            text += `- 記憶體與GC: ${results.memory || 0} cyc/s\n`;
            text += `- DOM 重繪: ${results.dom || 0} ops/s\n`;
            text += `- Canvas2D 繪圖: ${results.canvas2d || 0} ops/s\n`;
            
            const valGPU = typeof results.gpu === 'object' ? results.gpu.value : (results.gpu || 0);
            const lowFPS = typeof results.gpu === 'object' && results.gpu.onePercentLow ? ` (1% Low: ${results.gpu.onePercentLow} FPS)` : '';
            text += `- WebGL 渲染: ${valGPU > 0 ? Math.floor(valGPU / 1000) + 'k objs' + lowFPS : '不支援/失敗'}\n`;
            
            let cryptoVal = typeof results.crypto === 'object' ? results.crypto.value : (results.crypto || 0);
            let cryptoWarn = typeof results.crypto === 'object' && results.crypto.warning ? ' (異常偏高)' : '';
            text += `- 加密吞吐: ${cryptoVal} MB/s${cryptoWarn}\n`;
            
            let storageVal = typeof results.storage === 'object' ? results.storage.value : (results.storage || 0);
            text += `- 本機存取: ${storageVal} MB/s\n`;
            let networkVal = typeof results.network === 'object' ? results.network.value : (results.network || 0);
            text += `- 網路下載: ${networkVal} Mbps\n\n`;

            if (diag) {
                text += `[ 裝置適配性評估 ]\n`;
                text += `- 一般網頁瀏覽: ${diag.fitness.webBrowsing}\n`;
                text += `- 多分頁工作: ${diag.fitness.multiTab}\n`;
                text += `- Web 3D 應用: ${diag.fitness.web3D}\n`;
                text += `- 重型網頁工具: ${diag.fitness.heavyWebApps}\n\n`;

                text += `[ 效能瓶頸分析與專家建議 ]\n`;
                if (diag.weakestLink) {
                    text += `主要瓶頸: ${diag.weakestLink.name}\n`;
                    text += `專家建議: ${diag.weakestLink.advice}\n\n`;
                } else {
                    text += `效能均衡，沒有明顯的效能瓶頸。\n\n`;
                }
            }
            
            text += `[ 測試環境 ]\n`;
            text += `作業系統: ${deviceSpecs.platform}\n`;
            text += `圖形處理器: ${deviceSpecs.gpuRenderer}\n`;
            text += `系統記憶體: ${deviceSpecs.memory}\n`;
            text += `邏輯核心數: ${deviceSpecs.cores} 核心\n`;
            text += `螢幕解析度: ${deviceSpecs.resolution}@${deviceSpecs.pixelRatio}x\n`;
            text += `UserAgent: ${deviceSpecs.userAgent}\n`;
            text += `=========================\\n`;
            text += `產生時間：${new Date().toLocaleString()}`;
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
            adviceHTML += `<p class="font-bold text-white mb-2 border-b border-slate-700 pb-1 flex items-center gap-2"><svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> 你的裝置適合：</p>`;
            adviceHTML += `<ul class="text-xs text-slate-300 space-y-1 mb-4">`;
            adviceHTML += `<li><span class="text-slate-500">一般網頁瀏覽：</span> ${diag.fitness.webBrowsing}</li>`;
            adviceHTML += `<li><span class="text-slate-500">多分頁工作：</span> ${diag.fitness.multiTab}</li>`;
            adviceHTML += `<li><span class="text-slate-500">Web 3D 應用：</span> ${diag.fitness.web3D}</li>`;
            adviceHTML += `<li><span class="text-slate-500">線上剪輯或重型網頁工具：</span> ${diag.fitness.heavyWebApps}</li>`;
            adviceHTML += `</ul>`;

            if (diag.weakestLink) {
                adviceHTML += `<p class="font-bold text-yellow-400 mb-1 border-b border-slate-700 pb-1 flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg> 效能瓶頸分析：</p>`;
                adviceHTML += `<p class="text-xs text-slate-300">主要瓶頸落於 <span class="text-white font-bold">${diag.weakestLink.name}</span>。</p>`;
                adviceHTML += `<p class="text-xs text-slate-400 mt-2 bg-black/30 p-2 rounded border border-slate-700">💡 <b>專家診斷建議：</b>${diag.weakestLink.advice}</p>`;
            } else {
                adviceHTML += `<p class="font-bold text-primary mb-1 border-b border-slate-700 pb-1 flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> 效能均衡：</p>`;
                adviceHTML += `<p class="text-xs text-slate-300">各項指標表現均衡且優異，沒有明顯的效能瓶頸。</p>`;
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
                    console.error("i18n 未能正確載入雷達圖標籤");
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
                            label: '效能指標',
                            data: [0, 0, 0, 0, 0, 0, 0, 0, 0],
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
                        showToast('報告已成功複製到剪貼簿！');
                    } catch (err) {
                        showToast('複製失敗，請手動圈選');
                    }
                } else {
                    const textArea = document.createElement("textarea");
                    textArea.value = reportText;
                    document.body.appendChild(textArea);
                    textArea.select();
                    try {
                        document.execCommand('copy');
                        showToast('報告已成功複製到剪貼簿！');
                    } catch (err) {
                        showToast('複製失敗，請手動圈選');
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
                showToast('JSON 報告已匯出！');
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
                        results.network = await withTimeout(runWithSampling('network', runNetworkTest, 1, 0, myRunId, true), 40000, 'Network'); // Download takes too long, run once
                    } catch (e) {
                        errorOccurred = true;
                        if (e.message !== '使用者取消測試') {
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
                        reportText = generateReportText(results, finalScore, rel, config.label, diag);
                        document.getElementById('copyReportBtn').classList.remove('hidden');
                        
                        // 準備 JSON 匯出資料
                        lastJsonExport = {
                            timestamp: new Date().toISOString(),
                            mode: config.label,
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
                    showError("嚴重錯誤: " + fatalErr.message);
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
