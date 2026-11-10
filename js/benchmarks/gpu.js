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
                        // 讀回 1 像素強制真正光柵化（否則 GPU 加速的 2D context 只是在錄製指令）
                        ctx.getImageData((ops * 13) % 800, (ops * 17) % 600, 1, 1);
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
        // ===== GPU 測試（固定工作量吞吐量測試）=====
        // 量測原則（改動畫面時不可破壞）：
        //  - 固定工作量、量時間：場景大小固定，模式只決定量測時間長短。
        //  - 與螢幕脫鉤：計時的幀渲染到固定 1280x720 離屏 render target，不受 vsync / 解析度 / DPR 影響。
        //  - 以 readPixels 1x1 強制 GPU 完成後才停表。
        //  - 相依鏈：每幀都讀取上一幀輸出（3D 場景用角落的微小 probe，Phase 2 用 uPrev 做殘影），
        //    否則驅動（實測 Chromium ANGLE/Metal）會略過沒人讀取的中間幀，吞吐量被灌水 100 倍以上。
        //  - 光源、材質、環境貼圖於量測前一次建好並 compile；量測中不會重新編譯 shader。
        //  - 螢幕預覽（使用者看到的畫面）在計時區間之外渲染並同步，不影響分數。
        const GPU_RT_WIDTH = 1280;
        const GPU_RT_HEIGHT = 720;
        const GPU_P1_INSTANCES = 60000;   // Phase 1：星系星體數（Icosahedron detail 1 = 80 三角形）
        const GPU_P2_ITERS = 128;         // Phase 2：Julia 碎形每像素固定迭代次數（無提前跳出）
        const GPU_P3_LIGHTS = 8;          // Phase 3：PBR 點光源數
        const GPU_P3_SPHERES = 400;       // Phase 3：PBR 實例球數
        // 參考吞吐量：達到此值 = 1000 Pts（Apple M2 Max / Chromium，ANGLE Metal，tools 校準）。
        // 2026-11-10 新場景實測（Chromium Quick×2 / Extreme，差異 < 2%）：幾何 2.50 G tris/s、Shader 178.8 G iter/s、PBR 1425 M pix/s
        const GPU_REFERENCE = { geometry: 2500, shader: 178.8, lighting: 1425 };
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

        // 徑向漸層貼圖（光暈、燈泡用）
        function gpuGlowTexture(inner, outer) {
            const c = document.createElement('canvas');
            c.width = c.height = 128;
            const g = c.getContext('2d');
            const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
            grad.addColorStop(0, inner);
            grad.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)'));
            grad.addColorStop(1, outer);
            g.fillStyle = grad;
            g.fillRect(0, 0, 128, 128);
            return new THREE.CanvasTexture(c);
        }

        // 相依鏈 probe：畫在左下角約 6x4 像素、讀取上一幀中心像素。肉眼不可見，但強制驅動完成上一幀。
        function gpuDependencyProbe() {
            const uniforms = { uPrev: { value: null } };
            const mat = new THREE.ShaderMaterial({
                uniforms,
                depthTest: false,
                depthWrite: false,
                vertexShader: `void main() { gl_Position = vec4(position.xy * 0.005 + vec2(-0.994, -0.994), 0.0, 1.0); }`,
                fragmentShader: `uniform sampler2D uPrev; void main() { gl_FragColor = vec4(texture2D(uPrev, vec2(0.5)).rgb * 0.02, 1.0); }`
            });
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
            mesh.frustumCulled = false;
            mesh.renderOrder = 9999;
            return { mesh, uniforms, disposables: [mesh.geometry, mat] };
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
            const titleEl = document.getElementById('gpuPhaseTitle');
            const subEl = document.getElementById('gpuPhaseSub');
            const progressEl = document.getElementById('gpuProgress');
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
                if (progressEl) progressEl.style.width = '0%';
                container.classList.add('hidden');
                container.classList.remove('flex');
            };

            try {
                // antialias 只作用於螢幕預覽（預設 framebuffer）；計時用的離屏目標不做 MSAA，工作量不變
                renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                renderer.setSize(window.innerWidth, window.innerHeight);
                renderer.shadowMap.enabled = false;
                renderer.outputEncoding = THREE.sRGBEncoding;
                renderer.toneMapping = THREE.ACESFilmicToneMapping;
                renderer.toneMappingExposure = 1.1;
                renderer.domElement.style.position = 'absolute';
                renderer.domElement.style.inset = '0';
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
                const syncScreen = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                let bindPrev = () => {};
                const renderFrame = (scene, camera) => {
                    bindPrev(src.texture);
                    renderer.setRenderTarget(dst);
                    renderer.render(scene, camera);
                    const tmp = src; src = dst; dst = tmp;
                };

                // 每階段量測時間由模式決定（只影響取樣長度，不影響分數尺度）
                const measureMs = Math.max(1000, Math.min((config.gpuTimeLimit / 3) * 0.6, 30000));

                const checkAbort = () => {
                    if (isCancelledRun(runId)) throw new Error(t('error_cancelled'));
                    if (contextLost) throw new Error('WebGL context lost');
                    if (hiddenDuringTest) throw new Error('GPU: page hidden during test, result discarded');
                };

                // 量測單一階段：回傳每秒完成的工作量（workPerFrame 的單位 / 秒）
                // update(timeSec)：動畫依真實時間前進（不依幀數），快慢 GPU 看到的動畫速度一致
                const measurePhase = async (phase, scene, camera, update, workPerFrame, bind) => {
                    bindPrev = bind;
                    if (titleEl) titleEl.textContent = phase.title;
                    if (subEl) subEl.textContent = phase.sub;
                    if (progressEl) progressEl.style.width = '0%';
                    const animStart = performance.now();
                    const now = () => (performance.now() - animStart) / 1000;

                    bindPrev(src.texture);
                    renderer.setRenderTarget(dst);
                    renderer.compile(scene, camera);
                    update(0);
                    renderFrame(scene, camera); // 暖機一幀（含 shader 編譯/上傳），不計時
                    syncRT();
                    renderer.setRenderTarget(null);
                    renderer.render(scene, camera); // 編譯螢幕預覽用的 shader 變體（含 tone mapping）
                    syncScreen();

                    let framesPerBatch = 1;
                    let calibrated = false;
                    let totalFrames = 0, totalMs = 0;
                    const phaseStart = performance.now();

                    while (true) {
                        checkAbort();

                        // 螢幕預覽（不計時），並先同步，避免預覽工作混入下一批計時
                        const tWall = now();
                        update(tWall);
                        bindPrev(src.texture);
                        renderer.setRenderTarget(null);
                        renderer.render(scene, camera);
                        syncScreen();

                        const t0 = performance.now();
                        for (let i = 0; i < framesPerBatch; i++) {
                            update(tWall + i * 0.0005);
                            renderFrame(scene, camera);
                        }
                        syncRT();
                        const dt = performance.now() - t0;
                        renderer.setRenderTarget(null);

                        // 先倍增每批幀數，直到單批 >= 30ms（降低計時與同步開銷比例），校準批次不計分
                        if (!calibrated && dt < 30 && framesPerBatch < 4096) {
                            framesPerBatch *= 2;
                        } else {
                            calibrated = true;
                            totalFrames += framesPerBatch;
                            totalMs += dt;
                        }

                        const fps = Math.round(framesPerBatch * 1000 / Math.max(dt, 0.001));
                        fpsEl.textContent = `${fps} FPS @720p`;
                        gpuStatusEl.textContent = `${phase.label} | ${phase.status} | ${fps} FPS`;
                        if (progressEl) progressEl.style.width = `${Math.min(100, totalMs / measureMs * 100).toFixed(1)}%`;

                        const elapsed = performance.now() - phaseStart;
                        if (totalFrames > 0 && (totalMs >= measureMs || elapsed >= measureMs * 1.5)) break;

                        await new Promise(r => setTimeout(r, 0)); // 讓出主執行緒（UI 更新、取消按鈕）
                    }
                    checkAbort();
                    return (workPerFrame * totalFrames) / (totalMs / 1000);
                };

                const aspect = GPU_RT_WIDTH / GPU_RT_HEIGHT;
                const onResizeAspect = window.innerWidth / window.innerHeight;
                const dummy = new THREE.Object3D();
                const col = new THREE.Color();

                // ============ Phase 1：旋臂星系（幾何吞吐）============
                const s1 = new THREE.Scene();
                s1.background = new THREE.Color(0x02030a);
                s1.fog = new THREE.FogExp2(0x02030a, 0.0018);
                const c1 = new THREE.PerspectiveCamera(55, onResizeAspect || aspect, 0.5, 2000);
                s1.add(new THREE.AmbientLight(0x8a80b0, 0.8));
                const coreLight = new THREE.PointLight(0xffc27a, 2.4, 420, 1.2);
                coreLight.position.set(0, 55, 0); // 置於核心上方：相機（俯視）看到的是受光面
                s1.add(coreLight);
                const rim = new THREE.DirectionalLight(0x8fb4ff, 0.6);
                rim.position.set(-1, 0.6, -0.8);
                s1.add(rim);

                const g1 = new THREE.IcosahedronGeometry(1, 1);
                const m1 = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x666666, shininess: 70 });
                disposables.push(g1, m1);
                const galaxy = new THREE.InstancedMesh(g1, m1, GPU_P1_INSTANCES);
                const rand1 = gpuSeededRandom(12345);
                const gauss = () => (rand1() + rand1() + rand1() - 1.5) / 1.5;
                const ARMS = 3, R_MAX = 200;
                for (let i = 0; i < GPU_P1_INSTANCES; i++) {
                    const r = Math.pow(rand1(), 1.4) * R_MAX + 3 + gauss() * 5;
                    const k = Math.min(1, Math.max(0, r / R_MAX));
                    const arm = i % ARMS;
                    const angle = arm * (Math.PI * 2 / ARMS) + r * 0.03 + gauss() * (0.75 - k * 0.4);
                    const thickness = 16 * Math.exp(-r / 45) + 3;
                    dummy.position.set(Math.cos(angle) * r, gauss() * thickness, Math.sin(angle) * r);
                    dummy.rotation.set(rand1() * Math.PI, rand1() * Math.PI, 0);
                    dummy.scale.setScalar((0.3 + rand1() * 0.8) * (1.3 - k * 0.6));
                    dummy.updateMatrix();
                    galaxy.setMatrixAt(i, dummy.matrix);
                    // 色帶：核心暖金 → 粉紅 → 紫 → 藍 → 外圍青
                    const hue = k < 0.18 ? 0.055 + k * 0.12 : 0.95 - (k - 0.18) / 0.82 * 0.45;
                    col.setHSL(hue + (rand1() - 0.5) * 0.04, k < 0.18 ? 0.95 : 0.8, k < 0.18 ? 0.6 : 0.58);
                    galaxy.setColorAt(i, col);
                }
                s1.add(galaxy);

                const glowTex = gpuGlowTexture('rgba(255,196,120,1)', 'rgba(255,110,40,0)');
                const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
                const coreGlow = new THREE.Sprite(glowMat);
                coreGlow.scale.set(95, 95, 1);
                glowMat.opacity = 0.9;
                s1.add(coreGlow);
                disposables.push(glowTex, glowMat);

                const starGeo = new THREE.BufferGeometry();
                const starPos = new Float32Array(3000 * 3);
                for (let i = 0; i < 3000; i++) {
                    const u = rand1() * 2 - 1, th = rand1() * Math.PI * 2, rr = 900 + rand1() * 300;
                    starPos[i * 3] = Math.sqrt(1 - u * u) * Math.cos(th) * rr;
                    starPos[i * 3 + 1] = u * rr;
                    starPos[i * 3 + 2] = Math.sqrt(1 - u * u) * Math.sin(th) * rr;
                }
                starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
                const starMat = new THREE.PointsMaterial({ color: 0xbfd4ff, size: 1.6, sizeAttenuation: false, fog: false });
                s1.add(new THREE.Points(starGeo, starMat));
                disposables.push(starGeo, starMat);

                const probe1 = gpuDependencyProbe();
                s1.add(probe1.mesh);
                disposables.push(...probe1.disposables);

                const trisPerInstance = g1.index ? g1.index.count / 3 : g1.attributes.position.count / 3;
                const geometryMtris = await measurePhase(
                    { label: 'Ph.1/3', title: 'GALAXY SWARM', sub: `${(GPU_P1_INSTANCES / 1000).toFixed(0)}k instanced bodies · ${(GPU_P1_INSTANCES * trisPerInstance / 1e6).toFixed(1)}M triangles / frame`, status: `${t('status_gpu_p1')} ${(GPU_P1_INSTANCES / 1000).toFixed(0)}k` },
                    s1, c1,
                    (tt) => {
                        galaxy.rotation.y = tt * 0.06;
                        const a = tt * 0.12;
                        c1.position.set(Math.cos(a) * 275, 120 + Math.sin(tt * 0.21) * 35, Math.sin(a) * 275);
                        c1.lookAt(0, 0, 0);
                    },
                    GPU_P1_INSTANCES * trisPerInstance / 1e6,
                    (tex) => { probe1.uniforms.uPrev.value = tex; }
                );

                // ============ Phase 2：Julia 碎形（片段著色器 ALU）============
                // 無分支逃逸：已逃逸的像素凍結 z 但照樣跑完全部迭代 → 每像素工作量固定
                const s2 = new THREE.Scene();
                const c2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
                const u2 = { uTime: { value: 0 }, uPrev: { value: null }, uAspect: { value: 16 / 9 } };
                const m2 = new THREE.ShaderMaterial({
                    uniforms: u2,
                    defines: { ITERS: GPU_P2_ITERS },
                    vertexShader: `
                        varying vec2 vUv;
                        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
                    `,
                    fragmentShader: `
                        uniform float uTime;
                        uniform float uAspect;
                        uniform sampler2D uPrev;
                        varying vec2 vUv;
                        vec3 palette(float t) {
                            return 0.5 + 0.5 * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.00, 0.15, 0.25)));
                        }
                        void main() {
                            float zoom = 1.45 + 0.25 * sin(uTime * 0.17);
                            vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0 * zoom;
                            float a = 0.6 + uTime * 0.11;
                            vec2 c = vec2(-0.745, 0.11) + 0.035 * vec2(cos(a * 1.7), sin(a));
                            vec2 z = p;
                            float escaped = 0.0;
                            float n = 0.0;
                            float trap = 10.0;
                            for (int i = 0; i < ITERS; i++) {
                                vec2 zn = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
                                z = mix(zn, z, escaped);
                                trap = min(trap, mix(abs(z.y) + 0.35 * abs(length(z) - 0.6), 10.0, escaped));
                                n += 1.0 - escaped;
                                escaped = max(escaped, step(256.0, dot(z, z)));
                            }
                            float sn = n - log2(max(log2(max(dot(z, z), 1.0001)), 1e-4)) + 4.0;
                            vec3 outside = vec3(0.004, 0.006, 0.02) + palette(sn * 0.018 + uTime * 0.03) * smoothstep(3.0, 40.0, sn);
                            vec3 inside = vec3(0.02, 0.01, 0.06) + vec3(0.25, 0.55, 1.0) * exp(-trap * 9.0);
                            vec3 col = mix(inside, outside, escaped);
                            col += vec3(1.0, 0.75, 0.45) * exp(-trap * 30.0) * 0.6;
                            vec3 prev = texture2D(uPrev, vUv).rgb;
                            gl_FragColor = vec4(mix(col, prev, 0.12), 1.0); // 輕微殘影（同時是相依鏈）
                        }
                    `
                });
                const g2 = new THREE.PlaneGeometry(2, 2);
                disposables.push(g2, m2);
                const quad = new THREE.Mesh(g2, m2);
                quad.frustumCulled = false;
                s2.add(quad);
                const shaderGiter = await measurePhase(
                    { label: 'Ph.2/3', title: 'FRACTAL NEBULA', sub: `Julia set · ${GPU_P2_ITERS} iterations / pixel · ${(GPU_RT_WIDTH * GPU_RT_HEIGHT * GPU_P2_ITERS / 1e6).toFixed(0)}M iterations / frame`, status: `${t('status_gpu_p2')} ${GPU_P2_ITERS}` },
                    s2, c2,
                    (tt) => { u2.uTime.value = tt; },
                    GPU_RT_WIDTH * GPU_RT_HEIGHT * GPU_P2_ITERS / 1e9,
                    (tex) => { u2.uPrev.value = tex; }
                );

                // ============ Phase 3：鉻金屬與彩光（PBR 多光源）============
                const s3 = new THREE.Scene();
                s3.background = new THREE.Color(0x04050a);
                s3.fog = new THREE.Fog(0x04050a, 90, 250);
                renderer.toneMappingExposure = 0.8;
                const c3 = new THREE.PerspectiveCamera(50, onResizeAspect || aspect, 0.1, 1000);

                // 程序產生的攝影棚環境貼圖（PMREM），讓金屬有反射
                const envScene = new THREE.Scene();
                const envGeo = new THREE.SphereGeometry(50, 32, 16);
                const envColors = [];
                const envPos = envGeo.attributes.position;
                const top = new THREE.Color(0x0c1124), horizon = new THREE.Color(0x2a1c40), bottom = new THREE.Color(0x020205);
                for (let i = 0; i < envPos.count; i++) {
                    const y = envPos.getY(i) / 50;
                    const cc = y > 0 ? horizon.clone().lerp(top, y) : horizon.clone().lerp(bottom, -y);
                    envColors.push(cc.r, cc.g, cc.b);
                }
                envGeo.setAttribute('color', new THREE.Float32BufferAttribute(envColors, 3));
                const envMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
                envScene.add(new THREE.Mesh(envGeo, envMat));
                const panelGeo = new THREE.PlaneGeometry(1, 1);
                [[0, 40, 0, 40, 40, 0xffffff, 1.6], [-45, 10, 0, 20, 30, 0xff6fb5, 1.4], [45, 10, 0, 20, 30, 0x5fd3ff, 1.4]].forEach(([x, y, z, w, h, color, intensity]) => {
                    const pm = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
                    const panel = new THREE.Mesh(panelGeo, pm);
                    panel.position.set(x, y, z);
                    panel.scale.set(w, h, 1);
                    panel.lookAt(0, 0, 0);
                    envScene.add(panel);
                    disposables.push(pm);
                });
                const pmrem = new THREE.PMREMGenerator(renderer);
                const envRT = pmrem.fromScene(envScene, 0.02);
                s3.environment = envRT.texture;
                disposables.push(envGeo, envMat, panelGeo, envRT, pmrem);

                const floorMat = new THREE.MeshStandardMaterial({ color: 0x07080d, roughness: 0.32, metalness: 0.6 });
                const floorGeo = new THREE.CircleGeometry(420, 64);
                const floor = new THREE.Mesh(floorGeo, floorMat);
                floor.rotation.x = -Math.PI / 2;
                floor.position.y = -15;
                const knotGeo = new THREE.TorusKnotGeometry(10, 3, 256, 48);
                const knotMat = new THREE.MeshStandardMaterial({ color: 0xe8ecff, roughness: 0.1, metalness: 1.0, envMapIntensity: 1.0 });
                const knot = new THREE.Mesh(knotGeo, knotMat);
                const sphereGeo = new THREE.SphereGeometry(2, 24, 16);
                const sphereMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1, envMapIntensity: 0.6 });
                const spheres = new THREE.InstancedMesh(sphereGeo, sphereMat, GPU_P3_SPHERES);
                const rand3 = gpuSeededRandom(67890);
                const RINGS = 5;
                for (let i = 0; i < GPU_P3_SPHERES; i++) {
                    const ring = i % RINGS;
                    const idx = Math.floor(i / RINGS);
                    const perRing = GPU_P3_SPHERES / RINGS;
                    const ang = idx / perRing * Math.PI * 2 + ring * 0.37;
                    const rad = 26 + ring * 13;
                    dummy.position.set(Math.cos(ang) * rad, -15 + 1.6 + (ring % 2) * 0.4 + Math.sin(ang * 3 + ring) * 0.6, Math.sin(ang) * rad);
                    dummy.rotation.set(0, 0, 0);
                    dummy.scale.setScalar(0.7 + rand3() * 0.6 + ring * 0.08);
                    dummy.updateMatrix();
                    spheres.setMatrixAt(i, dummy.matrix);
                    col.setHSL((ang / (Math.PI * 2) + ring * 0.08) % 1, 0.85, 0.42);
                    spheres.setColorAt(i, col);
                }
                disposables.push(floorMat, floorGeo, knotGeo, knotMat, sphereGeo, sphereMat);
                s3.add(floor, knot, spheres);

                const lights = [];
                const bulbGeo = new THREE.SphereGeometry(0.9, 16, 12);
                disposables.push(bulbGeo);
                const bulbGlowTex = gpuGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
                disposables.push(bulbGlowTex);
                for (let i = 0; i < GPU_P3_LIGHTS; i++) {
                    const lc = new THREE.Color().setHSL(i / GPU_P3_LIGHTS, 0.9, 0.6);
                    const l = new THREE.PointLight(lc, 1.6, 140, 1.6);
                    const bulbMat = new THREE.MeshBasicMaterial({ color: lc.clone().multiplyScalar(2.5), fog: false });
                    l.add(new THREE.Mesh(bulbGeo, bulbMat));
                    const haloMat = new THREE.SpriteMaterial({ map: bulbGlowTex, color: lc, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
                    const halo = new THREE.Sprite(haloMat);
                    halo.scale.set(9, 9, 1);
                    l.add(halo);
                    disposables.push(bulbMat, haloMat);
                    lights.push(l);
                    s3.add(l);
                }

                const probe3 = gpuDependencyProbe();
                s3.add(probe3.mesh);
                disposables.push(...probe3.disposables);

                const lightingMpix = await measurePhase(
                    { label: 'Ph.3/3', title: 'CHROME & LIGHTS', sub: `PBR · ${GPU_P3_LIGHTS} dynamic lights · ${GPU_P3_SPHERES} materials · image-based reflections`, status: `${t('status_gpu_p3')} ${GPU_P3_LIGHTS}` },
                    s3, c3,
                    (tt) => {
                        knot.rotation.y = tt * 0.5;
                        knot.rotation.x = tt * 0.3;
                        knot.position.y = 6 + Math.sin(tt * 0.8) * 2;
                        spheres.rotation.y = -tt * 0.08;
                        for (let k = 0; k < lights.length; k++) {
                            const la = tt * 0.7 + k * (Math.PI * 2 / lights.length);
                            lights[k].position.set(Math.cos(la) * (30 + (k % 2) * 18), 4 + Math.sin(tt * 1.3 + k) * 8, Math.sin(la) * (30 + (k % 2) * 18));
                        }
                        const ca = tt * 0.15;
                        c3.position.set(Math.cos(ca) * 95, 38 + Math.sin(tt * 0.25) * 10, Math.sin(ca) * 95);
                        c3.lookAt(0, 0, 0);
                    },
                    GPU_RT_WIDTH * GPU_RT_HEIGHT / 1e6,
                    (tex) => { probe3.uniforms.uPrev.value = tex; }
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
                    integrated: isIntegratedGPU(rendererName),
                    renderer: gpuShortName(rendererName),
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
