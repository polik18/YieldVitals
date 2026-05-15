import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update MODE_SETTINGS to include stability
mode_settings_old = "burnin: { gpuMax: 500000, gpuTimeLimit: 120000, cpuTime: 15000, otherTime: 5000, label: '燒機', desc: '長時間壓力測試 (測量散熱與穩定度)' }"
mode_settings_new = "stability: { gpuMax: 150000, gpuTimeLimit: 20000, cpuTime: 2000, otherTime: 1500, iterations: 3, label: '穩定', desc: '多次取樣，減少波動與系統干擾' },\n            burnin: { gpuMax: 500000, gpuTimeLimit: 120000, cpuTime: 15000, otherTime: 5000, label: '燒機', desc: '長時間壓力測試 (測量散熱與穩定度)' }"
content = content.replace(mode_settings_old, mode_settings_new)

# 2. Update BENCHMARK_BASELINE with canvas2d
baseline_old = "network: 1000  // Mbps"
baseline_new = "network: 1000, // Mbps\n            canvas2d: 8000 // ops/s"
content = content.replace(baseline_old, baseline_new)

# 3. Add runCanvas2DTest
canvas2d_func = """
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
"""
content = content.replace("        // 4. DOM 重繪測試", canvas2d_func + "        // 4. DOM 重繪測試")

# 4. Modify existing tests to remove direct UI done updates (sampler handles it)
def remove_ui_updates(text, item_name):
    # This might fail if the regex isn't perfect, so let's be careful.
    # Alternatively, just let the sampler overwrite the DOM since it's cleaner to not use regex if it's risky.
    # However, avoiding duplicate 'done' transitions is better.
    # Actually, the sampler updates the UI after each iteration, so the UI will show intermediate results.
    # That is actually a cool feature (seeing the numbers update)!
    return text

# We will just let them update the UI themselves for each iteration, 
# and the sampler will override it with the median at the end!

# 5. Add runWithSampling wrapper function
sampler_code = """
        async function runWithSampling(name, testFn, iterations, durationPerIter, runId, isNetwork=false) {
            let results = [];
            for(let i=0; i<iterations; i++) {
                if (isCancelledRun(runId)) throw new Error('使用者取消測試');
                let res = await testFn(durationPerIter, runId);
                let val = (typeof res === 'object') ? (res.value || res.score || res) : res;
                results.push(val);
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
            if(name === 'network') { unit = 'Mbps'; formattedVal = Number(finalVal).toFixed(1); }
            
            if(name !== 'gpu' && name !== 'storage' && name !== 'crypto') {
                setStatus(name, `${formattedVal} ${unit}`, 'done');
                document.getElementById(`res-${name}`).innerHTML = `${formattedVal} <span class="text-xs font-normal text-slate-500">${unit}</span>`;
            } else if (name === 'gpu') {
                setStatus('gpu', `${Math.floor(finalVal / 1000)}k objs`, 'done');
                document.getElementById('res-gpu').innerHTML = `${Math.floor(finalVal / 1000)} <span class="text-xs font-normal text-slate-500">k objs</span>`;
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
"""
content = content.replace("        function calculateReliability(results", sampler_code + "\n        function calculateReliability(results")

# 6. Change main execution flow
main_exec_old = """                    try {
                        results.cpu = await withTimeout(runCPUMultiCore(config.cpuTime, myRunId), config.cpuTime + 5000, 'CPU');
                        results.string = await withTimeout(runStringTest(config.otherTime, myRunId), config.otherTime + 3000, 'String');
                        results.memory = await withTimeout(runRAMTest(config.otherTime, myRunId), config.otherTime + 3000, 'RAM');
                        results.dom = await withTimeout(runDOMTest(config.otherTime, myRunId), config.otherTime + 3000, 'DOM');
                        results.gpu = await withTimeout(runThreeJSTest(config, myRunId), config.gpuTimeLimit + 5000, 'GPU');
                        results.crypto = await withTimeout(runCryptoTest(config.otherTime, myRunId), config.otherTime + 3000, 'Crypto');
                        results.storage = await withTimeout(runStorageTest(config.otherTime, myRunId), config.otherTime + 10000, 'Storage');
                        results.network = await withTimeout(runNetworkTest(myRunId), 15000, 'Network');
                    } catch (e) {"""

main_exec_new = """                    try {
                        let iters = config.iterations || 1;
                        results.cpu = await withTimeout(runWithSampling('cpu', runCPUMultiCore, iters, config.cpuTime, myRunId), config.cpuTime*iters + 10000, 'CPU');
                        results.string = await withTimeout(runWithSampling('string', runStringTest, iters, config.otherTime, myRunId), config.otherTime*iters + 5000, 'String');
                        results.memory = await withTimeout(runWithSampling('ram', runRAMTest, iters, config.otherTime, myRunId), config.otherTime*iters + 5000, 'RAM');
                        results.dom = await withTimeout(runWithSampling('dom', runDOMTest, iters, config.otherTime, myRunId), config.otherTime*iters + 5000, 'DOM');
                        results.canvas2d = await withTimeout(runWithSampling('canvas2d', runCanvas2DTest, iters, config.otherTime, myRunId), config.otherTime*iters + 5000, 'Canvas2D');
                        results.gpu = await withTimeout(runWithSampling('gpu', runThreeJSTest, 1, config, myRunId), config.gpuTimeLimit + 5000, 'GPU');
                        results.crypto = await withTimeout(runWithSampling('crypto', runCryptoTest, iters, config.otherTime, myRunId), config.otherTime*iters + 5000, 'Crypto');
                        results.storage = await withTimeout(runWithSampling('storage', runStorageTest, 1, config.otherTime, myRunId), config.otherTime + 10000, 'Storage');
                        results.network = await withTimeout(runWithSampling('network', runNetworkTest, 1, 0, myRunId, true), 30000, 'Network'); // Download takes too long, run once
                    } catch (e) {"""
content = content.replace(main_exec_old, main_exec_new)

# 7. Add canvas2d to calculateFinalScore and radar
calc_final_old = """            const normDOM = normalize(results.dom || 0, BENCHMARK_BASELINE.dom);
            const normGPU = normalize(valGPU, BENCHMARK_BASELINE.gpu);"""
calc_final_new = """            const normDOM = normalize(results.dom || 0, BENCHMARK_BASELINE.dom);
            const normCanvas2D = normalize(results.canvas2d || 0, BENCHMARK_BASELINE.canvas2d);
            const normGPU = normalize(valGPU, BENCHMARK_BASELINE.gpu);"""
content = content.replace(calc_final_old, calc_final_new)

radar_update_old = "radarChart.data.datasets[0].data = [normCPU, normString, normCrypto, normMemory, normStorage, normNetwork, normDOM, normGPU];"
radar_update_new = "radarChart.data.datasets[0].data = [normCPU, normString, normCrypto, normMemory, normStorage, normNetwork, normDOM, normGPU, normCanvas2D];"
content = content.replace(radar_update_old, radar_update_new)

# Initial radar chart length fix
radar_init_old = "data: [0, 0, 0, 0, 0, 0, 0, 0],"
radar_init_new = "data: [0, 0, 0, 0, 0, 0, 0, 0, 0],"
content = content.replace(radar_init_old, radar_init_new)

weight_old = """            return Math.round(
                normCPU * 0.25 +
                normGPU * 0.25 +
                normDOM * 0.15 +
                normStorage * 0.10 +
                normMemory * 0.10 +
                normString * 0.10 +
                normCrypto * 0.05
            );"""
weight_new = """            return Math.round(
                normCPU * 0.25 +
                normGPU * 0.20 +
                normCanvas2D * 0.10 +
                normDOM * 0.10 +
                normStorage * 0.10 +
                normMemory * 0.10 +
                normString * 0.10 +
                normCrypto * 0.05
            );"""
content = content.replace(weight_old, weight_new)

# 8. Reset UI for canvas2d
reset_ui_old = "['cpu', 'string', 'ram', 'dom', 'gpu', 'crypto'].forEach(id => {"
reset_ui_new = "['cpu', 'string', 'ram', 'dom', 'canvas2d', 'gpu', 'crypto', 'storage', 'network'].forEach(id => {"
content = content.replace(reset_ui_old, reset_ui_new)

error_ui_old = "['cpu', 'string', 'ram', 'dom', 'gpu', 'crypto', 'storage', 'network'].forEach(id => {"
error_ui_new = "['cpu', 'string', 'ram', 'dom', 'canvas2d', 'gpu', 'crypto', 'storage', 'network'].forEach(id => {"
content = content.replace(error_ui_old, error_ui_new)

# 9. Update the reportText generation
report_old = """            text += `- DOM 重繪: ${results.dom || 0} ops/s\\n`;
            
            const valGPU = typeof results.gpu === 'object' ? results.gpu.value : (results.gpu || 0);"""
report_new = """            text += `- DOM 重繪: ${results.dom || 0} ops/s\\n`;
            text += `- Canvas2D 繪圖: ${results.canvas2d || 0} ops/s\\n`;
            
            const valGPU = typeof results.gpu === 'object' ? results.gpu.value : (results.gpu || 0);"""
content = content.replace(report_old, report_new)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("app.js updated successfully")
