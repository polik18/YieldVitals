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
                const worker = trackWorker(new Worker(workerUrl));
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
        // ===== GPU 測試（階段 1 重寫）=====
        // 設計原則：
        //  - 固定工作量、量時間：場景大小固定，不隨模式或時間加負載；模式只決定量測時間長短。
        //  - 與螢幕脫鉤：渲染到固定 1280x720 的離屏 render target，不受 vsync / 解析度 / DPR 影響。
        //  - 以 readPixels 1x1 強制 GPU 完成後才停表，量到的是 GPU 實際完成工作的時間。
        //  - Ping-pong 相依鏈：每幀都取樣上一幀的輸出（3D 場景用 scene.background，Phase 2 用 uPrev）。
        //    否則驅動（實測 Chromium ANGLE/Metal）會略過沒人讀取的中間幀，吞吐量被灌水 100 倍以上。
        //  - 光源於初始化時一次建好並先 compile，量測中不會觸發 shader 重新編譯；所有平台都不開陰影。
        const GPU_RT_WIDTH = 1280;
        const GPU_RT_HEIGHT = 720;
        const GPU_P1_INSTANCES = 60000;   // Phase 1：InstancedMesh 實例數（Icosahedron detail 1 = 80 三角形）
        const GPU_P2_ITERS = 128;         // Phase 2：每像素 ALU 迴圈次數（固定、無提前跳出）
        const GPU_P3_LIGHTS = 8;          // Phase 3：PBR 點光源數（固定）
        const GPU_P3_SPHERES = 400;       // Phase 3：PBR 實例球數
        // 參考吞吐量：達到此值 = 1000 Pts。2026-11-10 以 Apple M2 Max / Chromium 148 (ANGLE Metal) 實測校準。
        // 實測（Quick/Standard/Extreme 各模式差異 < 1%）：幾何 2.65 G tris/s、Shader 121 G iter/s、PBR 3180 M pix/s
        const GPU_REFERENCE = { geometry: 2650, shader: 121, lighting: 3180 };
        const GPU_PHASE_WEIGHTS = { geometry: 0.4, shader: 0.3, lighting: 0.3 };
        const SOFTWARE_RENDERER_RE = /SwiftShader|llvmpipe|softpipe|Software Rasterizer|Microsoft Basic Render|Mesa OffScreen/i;

        function gpuSeededRandom(seed) {
            // mulberry32：固定種子，確保每次場景完全相同
            return function () {
                seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
                let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
                r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
                return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
            };
        }

        async function runThreeJSTest(config, runId) {
            if (!supportsWebGL()) {
                setStatus('gpu', t('error_no_webgl'), 'error');
                document.getElementById('res-gpu').innerHTML = `N/A`;
                return 0; // runWithSampling 會將無效值標為 N/A
            }

            setStatus('gpu', t('status_running_gpu'), 'running');
            const container = document.getElementById('threeContainer');
            const fpsEl = document.getElementById('fpsCounter');
            const gpuStatusEl = document.getElementById('gpuStatus');
            container.classList.remove('hidden');
            container.classList.add('flex');

            let renderer = null, rtA = null, rtB = null;
            const disposables = [];
            let contextLost = false;
            let hiddenDuringTest = document.hidden;
            const onVisibility = () => { if (document.hidden) hiddenDuringTest = true; };
            document.addEventListener('visibilitychange', onVisibility);

            const cleanup = () => {
                document.removeEventListener('visibilitychange', onVisibility);
                disposables.forEach(d => { try { d.dispose(); } catch (_) {} });
                if (rtA) rtA.dispose();
                if (rtB) rtB.dispose();
                if (renderer) {
                    renderer.dispose();
                    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
                }
                container.classList.add('hidden');
                container.classList.remove('flex');
            };

            try {
                renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
                renderer.setPixelRatio(1);
                renderer.setSize(window.innerWidth, window.innerHeight);
                renderer.shadowMap.enabled = false;
                container.appendChild(renderer.domElement);
                renderer.domElement.addEventListener('webglcontextlost', (event) => {
                    event.preventDefault();
                    contextLost = true;
                });

                rtA = new THREE.WebGLRenderTarget(GPU_RT_WIDTH, GPU_RT_HEIGHT, { depthBuffer: true });
                rtB = new THREE.WebGLRenderTarget(GPU_RT_WIDTH, GPU_RT_HEIGHT, { depthBuffer: true });
                let src = rtA, dst = rtB;
                const gl = renderer.getContext();
                const pixel = new Uint8Array(4);
                const syncRT = () => renderer.readRenderTargetPixels(src, 0, 0, 1, 1, pixel);
                // 渲染一幀到離屏目標：先把上一幀 (src) 綁成輸入，形成相依鏈，再交換
                let bindPrev = null;
                const renderFrame = (scene, camera) => {
                    bindPrev(src.texture);
                    renderer.setRenderTarget(dst);
                    renderer.render(scene, camera);
                    const tmp = src; src = dst; dst = tmp;
                };
                const syncScreen = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

                // 每階段量測時間由模式決定（只影響取樣長度，不影響分數尺度）
                const measureMs = Math.max(1000, Math.min((config.gpuTimeLimit / 3) * 0.6, 30000));

                const checkAbort = () => {
                    if (isCancelledRun(runId)) throw new Error(t('error_cancelled'));
                    if (contextLost) throw new Error('WebGL context lost');
                    if (hiddenDuringTest) throw new Error('GPU: page hidden during test, result discarded');
                };

                // 量測單一階段：回傳每秒完成的工作量（workPerFrame 的單位 / 秒）
                const measurePhase = async (phaseLabel, statusText, scene, camera, update, workPerFrame, bind) => {
                    bindPrev = bind || ((tex) => { scene.background = tex; });
                    bindPrev(src.texture);
                    renderer.compile(scene, camera);
                    update(0);
                    renderFrame(scene, camera); // 暖機一幀（含 shader 編譯/上傳），不計時
                    syncRT();
                    renderer.setRenderTarget(null);

                    let framesPerBatch = 1;
                    let calibrated = false;
                    let totalFrames = 0, totalMs = 0, frameIndex = 1;
                    const phaseStart = performance.now();

                    while (true) {
                        checkAbort();

                        // 螢幕預覽（不計時），並先同步，避免預覽工作混入下一批計時
                        bindPrev(src.texture);
                        renderer.setRenderTarget(null);
                        renderer.render(scene, camera);
                        syncScreen();

                        const t0 = performance.now();
                        for (let i = 0; i < framesPerBatch; i++) {
                            update(frameIndex++);
                            renderFrame(scene, camera);
                        }
                        syncRT();
                        const dt = performance.now() - t0;
                        renderer.setRenderTarget(null);

                        // 先倍增每批幀數，直到單批 >= 40ms（降低計時與同步開銷的比例），校準批次不計分
                        if (!calibrated && dt < 40 && framesPerBatch < 4096) {
                            framesPerBatch *= 2;
                        } else {
                            calibrated = true;
                            totalFrames += framesPerBatch;
                            totalMs += dt;
                        }

                        const fps = Math.round(framesPerBatch * 1000 / Math.max(dt, 0.001));
                        fpsEl.textContent = `${fps} FPS @720p`;
                        gpuStatusEl.textContent = `${phaseLabel} | ${statusText} | ${fps} FPS`;

                        const elapsed = performance.now() - phaseStart;
                        if (totalFrames > 0 && (totalMs >= measureMs || elapsed >= measureMs * 1.5)) break;

                        await new Promise(r => setTimeout(r, 0)); // 讓出主執行緒（UI 更新、取消按鈕）
                    }
                    checkAbort();
                    return (workPerFrame * totalFrames) / (totalMs / 1000);
                };

                const aspect = GPU_RT_WIDTH / GPU_RT_HEIGHT;

                // === Phase 1：幾何吞吐（固定 60k 實例 × 80 三角形）===
                const s1 = new THREE.Scene();
                const c1 = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
                c1.position.set(0, 0, 150);
                c1.lookAt(0, 0, 0);
                s1.add(new THREE.AmbientLight(0x404040));
                const dir1 = new THREE.DirectionalLight(0x0abab5, 1);
                dir1.position.set(1, 1, 1);
                s1.add(dir1);
                const g1 = new THREE.IcosahedronGeometry(1, 1);
                const m1 = new THREE.MeshPhongMaterial({ color: 0x222222, specular: 0x0abab5, shininess: 50, emissive: 0x050505 });
                disposables.push(g1, m1);
                const mesh1 = new THREE.InstancedMesh(g1, m1, GPU_P1_INSTANCES);
                const rand1 = gpuSeededRandom(12345);
                const dummy = new THREE.Object3D();
                for (let i = 0; i < GPU_P1_INSTANCES; i++) {
                    dummy.position.set((rand1() - 0.5) * 400, (rand1() - 0.5) * 400, (rand1() - 0.5) * 400);
                    dummy.rotation.set(rand1() * Math.PI, rand1() * Math.PI, 0);
                    dummy.scale.setScalar(rand1() * 2 + 0.5);
                    dummy.updateMatrix();
                    mesh1.setMatrixAt(i, dummy.matrix);
                }
                s1.add(mesh1);
                const trisPerInstance = g1.index ? g1.index.count / 3 : g1.attributes.position.count / 3;
                const geometryMtris = await measurePhase(
                    'Ph.1/3', `${t('status_gpu_p1')} ${(GPU_P1_INSTANCES / 1000).toFixed(0)}k`, s1, c1,
                    (i) => { mesh1.rotation.y = i * 0.005; mesh1.rotation.x = i * 0.002; },
                    GPU_P1_INSTANCES * trisPerInstance / 1e6
                );

                // === Phase 2：片段著色器 ALU（固定每像素 128 次迴圈、無提前跳出）===
                const s2 = new THREE.Scene();
                const c2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
                const u2 = { uTime: { value: 0 }, uPrev: { value: null } };
                const m2 = new THREE.ShaderMaterial({
                    uniforms: u2,
                    defines: { ITERS: GPU_P2_ITERS },
                    vertexShader: `
                        varying vec2 vUv;
                        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
                    `,
                    fragmentShader: `
                        uniform float uTime;
                        uniform sampler2D uPrev;
                        varying vec2 vUv;
                        void main() {
                            vec4 prev = texture2D(uPrev, vUv);
                            vec2 p = vUv * 2.0 - 1.0 + prev.xy * 0.01;
                            vec2 z = p;
                            vec3 c = vec3(0.0);
                            for (int i = 0; i < ITERS; i++) {
                                z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + p * 0.5 + vec2(sin(uTime + float(i)) * 0.01);
                                z = z / (1.0 + dot(z, z));
                                c += vec3(z.x, z.y, z.x * z.y) * 0.02;
                            }
                            gl_FragColor = vec4(fract(abs(c) + prev.rgb * 0.5), 1.0);
                        }
                    `
                });
                const g2 = new THREE.PlaneGeometry(2, 2);
                disposables.push(g2, m2);
                s2.add(new THREE.Mesh(g2, m2));
                const shaderGiter = await measurePhase(
                    'Ph.2/3', `${t('status_gpu_p2')} ${GPU_P2_ITERS}`, s2, c2,
                    (i) => { u2.uTime.value = i * 0.016; },
                    GPU_RT_WIDTH * GPU_RT_HEIGHT * GPU_P2_ITERS / 1e9,
                    (tex) => { u2.uPrev.value = tex; }
                );

                // === Phase 3：PBR 多光源（固定 8 點光源、無陰影）===
                const s3 = new THREE.Scene();
                const c3 = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
                c3.position.set(0, 40, 80);
                c3.lookAt(0, 0, 0);
                const floorMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.2, metalness: 0.8 });
                const floorGeo = new THREE.PlaneGeometry(400, 400);
                const floor = new THREE.Mesh(floorGeo, floorMat);
                floor.rotation.x = -Math.PI / 2;
                floor.position.y = -15;
                const knotGeo = new THREE.TorusKnotGeometry(10, 3, 256, 48);
                const knotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 1.0 });
                const knot = new THREE.Mesh(knotGeo, knotMat);
                const sphereGeo = new THREE.SphereGeometry(2, 24, 16);
                const sphereMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.5 });
                const spheres = new THREE.InstancedMesh(sphereGeo, sphereMat, GPU_P3_SPHERES);
                const rand3 = gpuSeededRandom(67890);
                for (let i = 0; i < GPU_P3_SPHERES; i++) {
                    dummy.position.set((rand3() - 0.5) * 160, rand3() * 30 - 12, (rand3() - 0.5) * 160);
                    dummy.rotation.set(0, 0, 0);
                    dummy.scale.setScalar(rand3() + 0.5);
                    dummy.updateMatrix();
                    spheres.setMatrixAt(i, dummy.matrix);
                }
                disposables.push(floorMat, floorGeo, knotGeo, knotMat, sphereGeo, sphereMat);
                s3.add(floor, knot, spheres);
                const lights = [];
                for (let i = 0; i < GPU_P3_LIGHTS; i++) {
                    const col = new THREE.Color();
                    col.setHSL(i / GPU_P3_LIGHTS, 1, 0.5);
                    const l = new THREE.PointLight(col, 1.5, 120);
                    lights.push(l);
                    s3.add(l);
                }
                const lightingMpix = await measurePhase(
                    'Ph.3/3', `${t('status_gpu_p3')} ${GPU_P3_LIGHTS}`, s3, c3,
                    (i) => {
                        const tt = i * 0.016;
                        knot.rotation.y = tt / 2;
                        knot.rotation.x = tt / 3;
                        for (let k = 0; k < lights.length; k++) {
                            lights[k].position.set(Math.sin(tt + k * 2) * 40, Math.sin(tt * 2 + k) * 10 + 15, Math.cos(tt + k * 2) * 40);
                        }
                    },
                    GPU_RT_WIDTH * GPU_RT_HEIGHT / 1e6
                );

                cleanup();

                // 綜合分數：三階段相對參考值的加權幾何平均 × 1000（參考機 = 1000 Pts），無上限
                const ratios = {
                    geometry: geometryMtris / GPU_REFERENCE.geometry,
                    shader: shaderGiter / GPU_REFERENCE.shader,
                    lighting: lightingMpix / GPU_REFERENCE.lighting
                };
                let lnSum = 0;
                Object.keys(GPU_PHASE_WEIGHTS).forEach(k => { lnSum += GPU_PHASE_WEIGHTS[k] * Math.log(Math.max(ratios[k], 1e-6)); });
                const unifiedScore = Math.round(1000 * Math.exp(lnSum));

                const rendererName = (typeof deviceSpecs !== 'undefined' && deviceSpecs.gpuRenderer) || '';
                const software = SOFTWARE_RENDERER_RE.test(rendererName);

                setStatus('gpu', `${unifiedScore} Pts`, 'done');
                document.getElementById('res-gpu').innerHTML = `${unifiedScore} <span class="text-xs font-normal text-slate-500">Pts</span>`;

                return {
                    value: unifiedScore,
                    software,
                    phases: {
                        geometryMtrisPerSec: +geometryMtris.toFixed(1),
                        shaderGiterPerSec: +shaderGiter.toFixed(2),
                        lightingMpixPerSec: +lightingMpix.toFixed(1)
                    },
                    resolution: `${GPU_RT_WIDTH}x${GPU_RT_HEIGHT}`
                };
            } catch (e) {
                cleanup();
                throw e;
            }
        }

        // 6. WebCrypto 加解密測試 (升級為 Worker 且解決 JIT/快取問題)
