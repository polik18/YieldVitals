import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    text = f.read()

pattern = r'async function runNetworkTest\(runId\) \{.*?return \{ value: dlMbps.*?error: \'無法連線至節點\' \};\n            \}\n        \}'

new_func = """async function runNetworkTest(runId) {
            try {
                let pingSum = 0;
                let pings = [];
                // 1. Ping Test
                setStatus('network', t('network_pinging'), 'running');
                for (let i = 0; i < 5; i++) {
                    if (isCancelledRun(runId)) return Promise.reject(new Error('使用者取消'));
                    let pStart = performance.now();
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    try {
                        await fetch(`https://speed.cloudflare.com/__down?bytes=0&t=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
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
                        if (isCancelledRun(runId)) { dlController.abort(); return Promise.reject(new Error('使用者取消')); }
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
                if (e.message === "使用者取消") throw e;
                setStatus('network', '連線逾時或失敗', 'error');
                document.getElementById('res-network').innerHTML = `N/A`;
                return { value: 0, dl: 0, ul: 0, ping: 0, error: '無法連線至節點' };
            }
        }"""

new_text = re.sub(pattern, new_func, text, flags=re.DOTALL)

if new_text == text:
    print("No changes made. Pattern not found.")
else:
    with open('js/app.js', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("Replaced runNetworkTest")
