import os

with open('js/app.js', 'r', encoding='utf-8') as f:
    text = f.read()

with open('tools/target_gpu.txt', 'r', encoding='utf-8') as f:
    target_content = f.read()

replacement = """        async function runThreeJSTest(config, runId) {
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
        }"""

if target_content in text:
    new_text = text.replace(target_content, replacement)
    with open('js/app.js', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("Replaced successfully.")
else:
    print("Target content not found in app.js")
