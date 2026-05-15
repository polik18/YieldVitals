import json
import os
import glob
import urllib.request
import urllib.parse
from string import Template

def translate_single(text, target_lang):
    url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" + target_lang + "&dt=t&q=" + urllib.parse.quote(text)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        response = urllib.request.urlopen(req)
        result = json.loads(response.read().decode('utf-8'))
        return "".join([part[0] for part in result[0] if part[0]])
    except Exception as e:
        print(f"Failed to translate {text} to {target_lang}: {e}")
        return text

# 1. Prepare English and Chinese translations
new_keys_en = {
    "advice_diy_ram": "System memory is insufficient for heavy workloads. Upgrading physical RAM to 16GB or 32GB dual-channel is highly recommended.",
    "advice_diy_storage": "Disk I/O is a bottleneck. Consider upgrading to a high-performance NVMe SSD or check if your disk space is low.",
    "advice_diy_gpu": "Graphics performance is lacking. Ensure browser hardware acceleration is enabled, or consider installing a dedicated GPU for 3D tasks.",
    "advice_diy_cpu": "Processing power is constrained. Consider upgrading your processor, closing heavy background apps, or ensuring adequate cooling.",
    "advice_mobile_ram": "Mobile memory space is constrained. Clear background apps or consider a device with larger RAM capacity for better stability.",
    "advice_mobile_storage": "Mobile storage may be almost full, dropping I/O speed. Clear unused apps/photos to free up space.",
    "advice_mobile_gpu": "Mobile GPU is bottlenecking. Lower 3D game settings and ensure the device isn't overheating to prevent thermal throttling.",
    "advice_mobile_cpu": "Mobile CPU is limited. Close battery-draining apps in the background or consider upgrading to a device with a stronger chip.",
    "advice_dom_pc": "Avoid opening too many heavy tabs simultaneously, or consider a CPU with stronger single-core performance.",
    "advice_dom_mobile": "Prone to stuttering on complex sites. Avoid opening too many tabs or clear browser cache.",
    "network_speed": "Network Speed",
    "network_pinging": "Pinging...",
    "network_downloading": "Testing DL...",
    "network_uploading": "Testing UL...",
    "report_network": "[ Network Details ]",
    "report_network_dl": "Download Speed",
    "report_network_ul": "Upload Speed",
    "report_network_ping": "Latency (Ping)"
}

new_keys_tw = {
    "advice_diy_ram": "系統記憶體不足以應付高負載工作。強烈建議擴充實體記憶體 (RAM) 至 16GB 或 32GB 雙通道。",
    "advice_diy_storage": "硬碟讀寫速度遭遇瓶頸。建議升級為更高階的 NVMe SSD，或檢查硬碟剩餘空間是否不足。",
    "advice_diy_gpu": "圖形效能遭遇瓶頸。建議檢查是否已開啟瀏覽器的「硬體加速」。若長期有 3D 需求，建議加裝獨立外接顯示卡。",
    "advice_diy_cpu": "處理器運算受限。建議升級具備更高時脈的處理器，或關閉背景佔用資源的常駐程式、清理風扇散熱。",
    "advice_mobile_ram": "手機記憶體空間不足，容易導致背景 App 被強制重新載入。建議定期清理後台程式，或選購 RAM 容量更大的機型。",
    "advice_mobile_storage": "手機儲存空間可能接近全滿，導致讀寫嚴重掉速。建議清理不需要的照片與 App 以釋放空間。",
    "advice_mobile_gpu": "行動裝置圖形效能遭遇瓶頸。玩 3D 遊戲時建議調低畫質與特效，若經常發熱降頻，可考慮使用手機散熱器。",
    "advice_mobile_cpu": "運算晶片效能有限。建議關閉背景耗電的應用程式，或考慮更換為具備更強處理晶片的手機/平板。",
    "advice_dom_pc": "建議避免同時開啟過多複雜的網頁分頁，或考慮升級具備更強單核效能的處理器。",
    "advice_dom_mobile": "瀏覽複雜網頁時容易卡頓。建議一次不要開啟太多分頁，或清理瀏覽器快取。",
    "network_speed": "網路測速",
    "network_pinging": "Ping 測試中...",
    "network_downloading": "下載測速中...",
    "network_uploading": "上傳測速中...",
    "report_network": "[ 網路詳細數據 ]",
    "report_network_dl": "下載速度",
    "report_network_ul": "上傳速度",
    "report_network_ping": "延遲 (Ping)"
}

# Update translation files
with open('../locales/en.json', 'r', encoding='utf-8') as f:
    en_data = json.load(f)
en_data.update(new_keys_en)
with open('../locales/en.json', 'w', encoding='utf-8') as f:
    json.dump(en_data, f, indent=2, ensure_ascii=False)

with open('../locales/zh-TW.json', 'r', encoding='utf-8') as f:
    tw_data = json.load(f)
tw_data.update(new_keys_tw)
with open('../locales/zh-TW.json', 'w', encoding='utf-8') as f:
    json.dump(tw_data, f, indent=2, ensure_ascii=False)

for file in glob.glob('../locales/*.json'):
    lang = os.path.basename(file).split('.')[0]
    if lang in ['en', 'zh-TW']:
        continue
    with open(file, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    print(f"Updating {lang} translations...")
    updated = False
    for key, val in new_keys_en.items():
        if key not in data or data[key] == val: # If not translated
            data[key] = translate_single(val, lang)
            updated = True
            
    if updated:
        with open(file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

# 2. Update app.js 
with open('../js/app.js', 'r', encoding='utf-8') as f:
    app_js = f.read()

# Update getDiagnostics
get_diagnostics_old = """
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const scores = [
                {
                    name: '邏輯運算 (CPU)',
                    norm: normCPU,
                    advice: isMobile ?
                        '建議關閉背景耗電的應用程式，或考慮更換為具備更強處理晶片的手機/平板。' :
                        '建議升級具備更高時脈或更多核心的處理器，若為筆電請接上電源，或關閉背景佔用資源的常駐程式。'
                },
                {
                    name: '圖形渲染 (GPU)',
                    norm: normGPU,
                    advice: isMobile ?
                        '行動裝置圖形效能遭遇瓶頸。玩 3D 遊戲時建議調低畫質與特效，若經常發熱降頻，可考慮使用手機散熱器。' :
                        '建議檢查是否已開啟瀏覽器的「硬體加速」功能。若為桌機且長期有 3D 或遊戲需求，建議加裝獨立外接顯示卡。'
                },
                {
                    name: 'DOM 與互動',
                    norm: normDOM,
                    advice: isMobile ?
                        '瀏覽複雜網頁時容易卡頓。建議一次不要開啟太多分頁，或清理瀏覽器快取。' :
                        '建議避免同時開啟過多複雜的網頁分頁，或考慮升級具備更強單核效能的處理器。'
                },
                {
                    name: '記憶體 (RAM)',
                    norm: normMemory,
                    advice: isMobile ?
                        '手機記憶體空間可能不足，容易導致背景 App 被強制重新載入。建議定期清理後台程式，或選購 RAM 容量更大的機型。' :
                        '系統記憶體空間或頻寬可能不足，建議加裝實體記憶體 (RAM)，或關閉不必要的分頁以釋放記憶體空間。'
                },
                {
                    name: '本機存取 (Storage)',
                    norm: normStorage,
                    advice: isMobile ?
                        '手機儲存空間可能接近全滿，導致讀寫嚴重掉速。建議清理不需要的照片與 App 以釋放空間。' :
                        '硬碟讀寫速度遭遇瓶頸。建議升級為更高階的 NVMe SSD，或檢查硬碟剩餘空間是否不足。'
                }
            ];"""

get_diagnostics_new = """
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
            ];"""
app_js = app_js.replace(get_diagnostics_old, get_diagnostics_new)

# 3. Update network logic
network_logic_old = """
        async function runNetworkTest(runId) {
            setStatus('network', '下載中...', 'running');
            try {
                // 使用 Cloudflare 25MB 檔案 (支援 CORS)
                const targetUrl = 'https://speed.cloudflare.com/__down?bytes=25000000';
                const startTime = performance.now();
                // 加上 query string 避免快取
                const response = await fetch(`${targetUrl}&t=${Date.now()}`, { cache: 'no-store' });
                
                if (!response.ok) throw new Error('Fetch failed');
                
                const reader = response.body.getReader();
                let receivedLength = 0;
                
                while(true) {
                    if (isCancelledRun(runId)) return Promise.reject(new Error('使用者取消'));
                    const {done, value} = await reader.read();
                    if (done) break;
                    receivedLength += value.length;
                }
                
                const durationSec = (performance.now() - startTime) / 1000;
                const megabits = (receivedLength * 8) / (1024 * 1024);
                const mbps = (megabits / durationSec).toFixed(1);
                
                setStatus('network', `${mbps} Mbps`, 'done');
                document.getElementById('res-network').innerHTML = `${mbps} <span class="text-xs font-normal text-slate-500">Mbps</span>`;
                return parseFloat(mbps);
            } catch (e) {
                if (e.message === '使用者取消') throw e;
                setStatus('network', '連線逾時或失敗', 'error');
                document.getElementById('res-network').innerHTML = `N/A`;
                return { value: 0, error: '無法連線至節點' };
            }
        }"""

network_logic_new = """
        async function runNetworkTest(runId) {
            try {
                let pingSum = 0;
                let pings = [];
                // 1. Ping Test
                setStatus('network', t('network_pinging'), 'running');
                for (let i = 0; i < 5; i++) {
                    if (isCancelledRun(runId)) return Promise.reject(new Error('使用者取消'));
                    let pStart = performance.now();
                    await fetch(`https://speed.cloudflare.com/__down?bytes=0&t=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
                    pings.push(performance.now() - pStart);
                }
                pings.sort((a,b) => a - b);
                const ping = Math.round(pings[2]); // Median ping

                // 2. Download Test
                setStatus('network', t('network_downloading'), 'running');
                const selectedMode = document.querySelector('input[name="testMode"]:checked')?.value;
                const dlSize = selectedMode === 'quick' ? 5000000 : 15000000; // 5MB or 15MB
                let dlStart = performance.now();
                const dlResp = await fetch(`https://speed.cloudflare.com/__down?bytes=${dlSize}&t=${Date.now()}`, { cache: 'no-store' });
                if (!dlResp.ok) throw new Error('DL Fetch failed');
                const reader = dlResp.body.getReader();
                let receivedLength = 0;
                while(true) {
                    if (isCancelledRun(runId)) return Promise.reject(new Error('使用者取消'));
                    const {done, value} = await reader.read();
                    if (done) break;
                    receivedLength += value.length;
                }
                const dlDurationSec = (performance.now() - dlStart) / 1000;
                const dlMbps = parseFloat(((receivedLength * 8) / (1024 * 1024) / dlDurationSec).toFixed(1));

                // 3. Upload Test
                setStatus('network', t('network_uploading'), 'running');
                const ulSize = selectedMode === 'quick' ? 2000000 : 5000000; // 2MB or 5MB
                const ulData = new Uint8Array(ulSize);
                for(let i=0; i<ulSize; i+=4096) ulData[i] = Math.random() * 255;
                let ulStart = performance.now();
                const ulResp = await fetch(`https://speed.cloudflare.com/__up?t=${Date.now()}`, {
                    method: 'POST',
                    body: ulData,
                    cache: 'no-store'
                });
                if (!ulResp.ok) throw new Error('UL Fetch failed');
                const ulDurationSec = (performance.now() - ulStart) / 1000;
                const ulMbps = parseFloat(((ulSize * 8) / (1024 * 1024) / ulDurationSec).toFixed(1));

                return {
                    value: dlMbps, // fallback for radar
                    dl: dlMbps,
                    ul: ulMbps,
                    ping: ping
                };
            } catch (e) {
                if (e.message === '使用者取消') throw e;
                setStatus('network', '連線逾時或失敗', 'error');
                document.getElementById('res-network').innerHTML = `N/A`;
                return { value: 0, dl: 0, ul: 0, ping: 0, error: '無法連線至節點' };
            }
        }"""
app_js = app_js.replace(network_logic_old, network_logic_new)

# Update runWithSampling to handle the complex network object
# Specifically, in the UI Update section
sampler_network_old = """
            if(name === 'network') { unit = 'Mbps'; formattedVal = Number(finalVal).toFixed(1); }
            
            if(name !== 'gpu' && name !== 'storage' && name !== 'crypto') {
                setStatus(name, `${formattedVal} ${unit}`, 'done');
                document.getElementById(`res-${name}`).innerHTML = `${formattedVal} <span class="text-xs font-normal text-slate-500">${unit}</span>`;
            } else if (name === 'gpu') {"""
sampler_network_new = """
            if(name === 'network') { 
                // Because network returns an object with dl, ul, ping, and we run iterations=1
                let resObj = results[0];
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
            } else if (name === 'gpu') {"""
app_js = app_js.replace(sampler_network_old, sampler_network_new)

# Update network text generation in generateReport
report_text_old = "            text += `- ${t('network_dl')}: ${valNetwork} Mbps\\n`;"
report_text_new = """            
            const net = results.network || {};
            text += `\\n${t('report_network')}\\n`;
            text += `- ${t('report_network_dl')}: ${net.dl || 0} Mbps\\n`;
            text += `- ${t('report_network_ul')}: ${net.ul || 0} Mbps\\n`;
            text += `- ${t('report_network_ping')}: ${net.ping || 0} ms\\n\\n`;"""
app_js = app_js.replace(report_text_old, report_text_new)

with open('../js/app.js', 'w', encoding='utf-8') as f:
    f.write(app_js)

# 4. Update index.html for network item translation key
with open('../index.html', 'r', encoding='utf-8') as f:
    index_html = f.read()

index_html = index_html.replace('data-i18n="network_dl">網路下載 (Network)', 'data-i18n="network_speed">網路測速 (Network)')

with open('../index.html', 'w', encoding='utf-8') as f:
    f.write(index_html)

print("All features implemented successfully.")
