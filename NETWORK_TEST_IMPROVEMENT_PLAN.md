# YieldVitals 網路測速改進方案

## 📋 現狀分析：為什麼網路測速不準確或測不出來

### 問題 1：單一依賴 + CORS 限制
**問題描述**：
- 代碼完全依賴 `https://speed.cloudflare.com` 的三個端點
- 在某些網絡環境（企業代理、地區限制、CDN 故障）下無法訪問
- 沒有備用服務器，一旦主服務故障整個測試失敗

**現有代碼位置**：[app.js](js/app.js#L1033), [app.js](js/app.js#L1052), [app.js](js/app.js#L1085)

**影響**：
```javascript
// 當下載失敗時
try {
    const dlResp = await fetch(`https://speed.cloudflare.com/__down?bytes=${dlSize}`, ...);
    // 如果此 fetch 失敗，整個網路測試返回 0 Mbps
} catch(e) {
    // dlMbps 保持為 0
}
```

---

### 問題 2：超時設置不合理
**問題描述**：
- 下載測試：20 秒超時
  - 對於 100MB 文件在 100Mbps 的連接上需要 ~8 秒，目前設置有余量
  - 但在 10Mbps 連接上需要 ~80 秒，**超時會導致連接中斷**
  
- 上傳測試：8 秒超時
  - 對於 3MB 文件在 10Mbps 連接上需要 ~2.4 秒，OK
  - 但對於慢速連接（1Mbps）需要 ~24 秒，**直接超時失敗**

- Ping 測試：3 秒/次，只重試 5 次
  - 在網路波動時可能 0 次成功

**現有代碼位置**：[app.js](js/app.js#L1049), [app.js](js/app.js#L1083)

**數據**：
```javascript
const dlTimeoutId = setTimeout(() => dlController.abort(), 20000); // 固定 20s
const ulTimeoutId = setTimeout(() => dlController.abort(), 8000);  // 固定 8s
```

---

### 問題 3：缓存導致測試重複
**問題描述**：
- 雖然設置了 `cache: 'no-store'`，但某些瀏覽器和代理仍會緩存
- `t=${Date.now()}` 時間戳只精確到毫秒，在快速重試時可能相同

**現有代碼位置**：[app.js](js/app.js#L1044)

**示例**：
```javascript
// 時間戳可能重複或被快速代理緩存
const dlResp = await fetch(`https://speed.cloudflare.com/__down?bytes=${dlSize}&t=${Date.now()}`, ...);
```

---

### 問題 4：數據完整性驗證缺失
**問題描述**：
- **下載測試**：只檢查 `dlResp.ok`，但沒驗證是否接收了完整的字節數
  - 可能因網路中斷而只收到部分數據，但仍認為成功
  - `receivedLength` 可能小於 `dlSize`，導致速度計算錯誤
  
- **上傳測試**：發送數據後，不等待服務器響應完成
  - 假設 POST 成功但未驗證是否真的上傳完成

**現有代碼位置**：[app.js](js/app.js#L1055-L1070)

**代碼示例**：
```javascript
// 只檢查 ok，不檢查數據完整性
if (!dlResp.ok) throw new Error('DL Fetch failed');
// ... 讀取 body ...
const dlDurationSec = (performance.now() - dlStart) / 1000;
dlMbps = ((receivedLength * 8) / (1024 * 1024) / dlDurationSec).toFixed(1);
// receivedLength 可能 << dlSize，但計算仍繼續
```

---

### 問題 5：計時精度和網路波動
**問題描述**：
- `performance.now()` 在某些瀏覽器和虛擬機中精度不足（可能只有 1ms）
- 網路波動導致單次測試結果跨度很大（±50%）
- 目前只運行一次，無法平均化波動

**現有代碼位置**：[app.js](js/app.js#L1107)

**問題**：
```javascript
// 只運行一次
results.network = await runWithSampling('network', runNetworkTest, 1, 0, myRunId, true);
//                                                              ↑
//                                                        只有 1 次迭代
```

---

### 問題 6：降級方案缺失
**問題描述**：
- 如果主 Cloudflare 節點不可用，沒有備用方案
- 返回空值 `{ value: 0, dl: null, ul: null, ping: null }`
- 使用者無法區分「真的是慢速網路」還是「測試服務故障」

---

## ✅ 改進方案（分優先級）

### **優先級 1：改進 Cloudflare 端點的可靠性**

#### 1.1 動態文件大小調整
**目的**：根據初始 ping 智能選擇文件大小，避免超時

```javascript
async function runNetworkTest(duration, runId) {
    try {
        // 第一步：測 Ping，決定策略
        let pings = [];
        setStatus('network', t('network_pinging'), 'running');
        for (let i = 0; i < 3; i++) {
            if (isCancelledRun(runId)) return Promise.reject(new Error(t('error_cancelled')));
            const pStart = performance.now();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            try {
                const resp = await fetch(`https://speed.cloudflare.com/__down?bytes=0&t=${Date.now()}_${Math.random()}`, 
                    { method: 'HEAD', cache: 'no-store', signal: controller.signal });
                if (resp.ok) {
                    pings.push(performance.now() - pStart);
                }
            } catch(e) { console.debug('Ping failed:', e.message); }
            clearTimeout(timeoutId);
        }
        pings.sort((a, b) => a - b);
        const ping = pings.length > 0 ? Math.round(pings[Math.floor(pings.length / 2)]) : null;

        // 根據 Ping 動態調整文件大小和超時
        let dlSize, dlTimeout, ulSize, ulTimeout;
        
        if (!ping || ping > 500) { // 高延遲連接
            dlSize = 5000000;      // 5MB instead of 100MB
            dlTimeout = 30000;     // 30s instead of 20s
            ulSize = 500000;       // 500KB instead of 3MB
            ulTimeout = 15000;     // 15s instead of 8s
        } else if (ping > 100) {   // 中等延遲
            dlSize = 25000000;     // 25MB
            dlTimeout = 25000;
            ulSize = 1000000;
            ulTimeout = 12000;
        } else {                   // 低延遲（快速連接）
            dlSize = 100000000;    // 100MB
            dlTimeout = 20000;
            ulSize = 3000000;
            ulTimeout = 8000;
        }

        // 第二步：下載測試（改進）
        setStatus('network', t('network_downloading'), 'running');
        let dlStart = performance.now();
        let dlMbps = 0;
        let receivedLength = 0;
        let expectedSize = dlSize;
        
        try {
            const dlController = new AbortController();
            const dlTimeoutId = setTimeout(() => dlController.abort(), dlTimeout);
            const dlResp = await fetch(
                `https://speed.cloudflare.com/__down?bytes=${dlSize}&t=${Date.now()}_${Math.random()}`,
                { cache: 'no-store', signal: dlController.signal }
            );
            
            if (!dlResp.ok) {
                throw new Error(`HTTP ${dlResp.status}`);
            }
            
            // 取得預期大小
            const contentLength = dlResp.headers.get('content-length');
            if (contentLength) {
                expectedSize = parseInt(contentLength, 10);
            }
            
            const reader = dlResp.body.getReader();
            while(true) {
                if (isCancelledRun(runId)) {
                    dlController.abort();
                    throw new Error(t('error_cancelled'));
                }
                const {done, value} = await reader.read();
                if (done) break;
                receivedLength += value.length;
            }
            
            const dlDurationSec = (performance.now() - dlStart) / 1000;
            
            // 驗證數據完整性
            const completionRate = receivedLength / expectedSize;
            if (completionRate < 0.9) {
                console.warn(`DL completion: ${(completionRate*100).toFixed(1)}%, may be inaccurate`);
            }
            
            dlMbps = parseFloat(((receivedLength * 8) / (1024 * 1024) / dlDurationSec).toFixed(1));
            clearTimeout(dlTimeoutId);
        } catch(e) {
            if (e.name === 'AbortError' && receivedLength > 0) {
                const dlDurationSec = (performance.now() - dlStart) / 1000;
                dlMbps = parseFloat(((receivedLength * 8) / (1024 * 1024) / dlDurationSec).toFixed(1));
            } else {
                console.error('DL test failed:', e.message);
                dlMbps = null;
            }
        }

        // 第三步：上傳測試（改進）
        setStatus('network', t('network_uploading'), 'running');
        const ulData = new Uint8Array(ulSize);
        // 填充更好的隨機數據
        const seedBuffer = crypto.getRandomValues(new Uint8Array(4096));
        for(let i = 0; i < ulSize; i += 4096) {
            ulData.set(seedBuffer.subarray(0, Math.min(4096, ulSize - i)), i);
        }
        
        let ulStart = performance.now();
        let ulMbps = 0;
        try {
            const ulController = new AbortController();
            const ulTimeoutId = setTimeout(() => ulController.abort(), ulTimeout);
            const ulResp = await fetch(
                `https://speed.cloudflare.com/__up?t=${Date.now()}_${Math.random()}`,
                {
                    method: 'POST',
                    body: ulData,
                    cache: 'no-store',
                    signal: ulController.signal,
                    headers: { 'Content-Type': 'application/octet-stream' }
                }
            );
            
            if (ulResp.ok) {
                const ulDurationSec = (performance.now() - ulStart) / 1000;
                ulMbps = parseFloat(((ulSize * 8) / (1024 * 1024) / ulDurationSec).toFixed(1));
            } else {
                console.error(`UL HTTP ${ulResp.status}`);
            }
            clearTimeout(ulTimeoutId);
        } catch(e) {
            console.error('UL test failed:', e.message);
        }

        return {
            value: dlMbps || 0,
            dl: dlMbps,
            ul: ulMbps,
            ping: ping,
            completionRate: receivedLength / expectedSize,
            bytesReceived: receivedLength,
            expectedBytes: expectedSize
        };
    } catch (e) {
        if (e.message === t('error_cancelled') || e.message === '使用者取消測試') {
            throw e;
        }
        setStatus('network', t('error_network_failed'), 'error');
        document.getElementById('res-network').innerHTML = `N/A`;
        return {
            value: 0,
            dl: null,
            ul: null,
            ping: null,
            error: true,
            errorMsg: e.message
        };
    }
}
```

---

#### 1.2 改進快取策略
**目的**：使用多種技巧確保不被緩存

```javascript
// 修改 fetch 調用，加強防緩存
const noCacheHeaders = {
    cache: 'no-store',
    'pragma': 'no-cache'
};

// 在 URL 上添加多重時間戳和隨機數
const uniqueParam = `t=${Date.now()}_${Math.random()}_${crypto.getRandomValues(new Uint32Array(1))[0]}`;
const testUrl = `https://speed.cloudflare.com/__down?bytes=${dlSize}&${uniqueParam}`;

// 使用 POST instead of GET for 下載（某些代理會緩存 GET）
// 或者使用 Request 對象增加 cache 控制
const request = new Request(testUrl, {
    method: 'GET',
    cache: 'no-store',
    headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    }
});
const response = await fetch(request);
```

---

### **優先級 2：添加備用測試服務和本地測試**

#### 2.1 備用服務列表
**目的**：當 Cloudflare 不可用時自動故障轉移

```javascript
const NETWORK_TEST_ENDPOINTS = [
    {
        name: 'Cloudflare',
        ping: 'https://speed.cloudflare.com/__down?bytes=0',
        download: 'https://speed.cloudflare.com/__down?bytes=',
        upload: 'https://speed.cloudflare.com/__up',
        maxDlSize: 100000000
    },
    {
        name: 'Cloudflare US',
        ping: 'https://speed.cloudflare.com/__down?bytes=0',
        download: 'https://speed.cloudflare.com/__down?bytes=', // 可選擇地區端點
        upload: 'https://speed.cloudflare.com/__up',
        maxDlSize: 100000000
    },
    {
        name: 'Fallback: Local Echo',
        ping: '/api/ping', // 自建服務
        download: '/api/download?size=',
        upload: '/api/upload',
        maxDlSize: 10000000,
        isLocal: true
    }
];

async function runNetworkTestWithFallback(duration, runId) {
    let lastError = null;
    
    for (const endpoint of NETWORK_TEST_ENDPOINTS) {
        try {
            if (isCancelledRun(runId)) {
                throw new Error(t('error_cancelled'));
            }
            
            // 先測試該端點是否可用
            const pingStart = performance.now();
            const controller = new AbortController();
            const pingTimeout = setTimeout(() => controller.abort(), 3000);
            
            try {
                const pingResp = await fetch(endpoint.ping, {
                    method: 'HEAD',
                    cache: 'no-store',
                    signal: controller.signal
                });
                clearTimeout(pingTimeout);
                
                if (!pingResp.ok) continue; // Skip this endpoint
            } catch(e) {
                clearTimeout(pingTimeout);
                continue; // Try next endpoint
            }
            
            // 該端點可用，執行完整測試
            const result = await runNetworkTestWithEndpoint(endpoint, duration, runId);
            if (result && result.dl > 0) {
                result.endpoint = endpoint.name;
                return result;
            }
        } catch (e) {
            lastError = e;
            console.warn(`Endpoint ${endpoint.name} failed:`, e.message);
            continue;
        }
    }
    
    // 所有端點都失敗
    throw new Error(`All network test endpoints failed. Last error: ${lastError?.message}`);
}

async function runNetworkTestWithEndpoint(endpoint, duration, runId) {
    // 使用指定端點執行測試
    // ... 實現與上面 runNetworkTest 類似的邏輯，但使用 endpoint 的 URL ...
}
```

---

#### 2.2 自建輕量級本地測試服務（Node.js）
**目的**：作為備用方案和開發/私有網路測試

```javascript
// 建議在服務器添加這些端點（例如使用 Express）
// GET /api/network/ping - 返回 200，空內容
app.head('/api/network/ping', (req, res) => {
    res.sendStatus(200);
});

// GET /api/network/download?bytes=SIZE - 返回指定大小的隨機數據
app.get('/api/network/download', (req, res) => {
    const bytes = Math.min(parseInt(req.query.bytes) || 1000000, 50000000); // Max 50MB
    const buffer = crypto.randomBytes(bytes);
    res.setHeader('Content-Length', bytes);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(buffer);
});

// POST /api/network/upload - 接收數據並返回確認
app.post('/api/network/upload', express.raw({type: '*/*', limit: '50mb'}), (req, res) => {
    const receivedBytes = req.body.length;
    res.json({ success: true, bytesReceived: receivedBytes });
});
```

---

### **優先級 3：運行多次迭代和錯誤檢測**

#### 3.1 允許多次測試和中位數平均
**目的**：消除單次波動

```javascript
// 修改網路測試的迭代次數（在 runWithSampling 中）
// 原本：results.network = await runWithSampling('network', runNetworkTest, 1, ...);
// 改為：
results.network = await runWithSampling('network', runNetworkTest, 3, 0, myRunId, true);

// 修改 runWithSampling 中的網路部分
if (iterations === 1) {
    finalVal = results[0];
} else {
    if (isNetwork) {
        // 對於網路，計算 DL/UL/Ping 的中位數
        const dls = fullResults.map(r => r.dl || 0).filter(v => v > 0);
        const uls = fullResults.map(r => r.ul || 0).filter(v => v > 0);
        const pings = fullResults.map(r => r.ping || 0).filter(v => v > 0);
        
        if (dls.length > 0) dls.sort((a, b) => a - b);
        if (uls.length > 0) uls.sort((a, b) => a - b);
        if (pings.length > 0) pings.sort((a, b) => a - b);
        
        finalVal = {
            dl: dls.length > 0 ? dls[Math.floor(dls.length / 2)] : null,
            ul: uls.length > 0 ? uls[Math.floor(uls.length / 2)] : null,
            ping: pings.length > 0 ? pings[Math.floor(pings.length / 2)] : null,
            value: dls.length > 0 ? dls[Math.floor(dls.length / 2)] : 0
        };
    } else {
        results.sort((a,b) => a - b);
        finalVal = results[Math.floor(results.length/2)];
    }
}
```

---

#### 3.2 添加診斷信息
**目的**：幫助用戶理解測試失敗原因

```javascript
// 修改返回值，添加診斷信息
return {
    value: dlMbps || 0,
    dl: dlMbps,
    ul: ulMbps,
    ping: ping,
    // 診斷信息
    diagnostics: {
        downloadCompleted: completionRate > 0.9,
        completionRate: completionRate,
        bytesReceived: receivedLength,
        expectedBytes: expectedSize,
        uploadSuccessful: !!ulMbps,
        pingAvailable: ping !== null,
        pingCount: pings.length,
        endpoint: selectedEndpoint,
        testDuration: performance.now() - testStart
    }
};

// 在 UI 中顯示診斷信息
if (resObj && resObj.diagnostics) {
    const diag = resObj.diagnostics;
    let warnings = [];
    
    if (!diag.downloadCompleted) {
        warnings.push(`下載不完整 (${(diag.completionRate * 100).toFixed(1)}%)`);
    }
    if (!diag.uploadSuccessful) {
        warnings.push('上傳失敗');
    }
    if (!diag.pingAvailable) {
        warnings.push('無法測量 Ping');
    }
    
    if (warnings.length > 0) {
        const warningEl = document.createElement('div');
        warningEl.className = 'text-xs text-yellow-400 mt-1';
        warningEl.textContent = `⚠️ ${warnings.join(', ')}`;
        document.getElementById('res-network').appendChild(warningEl);
    }
}
```

---

### **優先級 4：改進評分和權重**

#### 4.1 網路分數納入總分（可選）
**目的**：讓網路性能對總分有貢獻

```javascript
// 原本網路不計分，現在添加可選的輕微權重
function calculateFinalScore(results) {
    const valNetwork = typeof results.network === 'object' ? results.network.value : (results.network || 0);
    const normNetwork = normalize(valNetwork, BENCHMARK_BASELINE.network);
    
    // 如果網路可用，納入分數（權重 2%）
    let finalScore = 0;
    if (valNetwork && valNetwork > 0) {
        finalScore = Math.round(
            normCPU * 0.25 +
            normGPU * 0.20 +
            normCanvas2D * 0.10 +
            normDOM * 0.10 +
            normStorage * 0.10 +
            normMemory * 0.10 +
            normString * 0.10 +
            normCrypto * 0.05 +
            normNetwork * 0.00  // 暫時不計或改為 0.02
        );
    } else {
        // 網路失敗時按原邏輯計算
        finalScore = Math.round(
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
    
    return finalScore;
}
```

---

## 🔧 實施步驟

### 第一階段（緊急修復，2-3 小時）
1. ✅ 添加防緩存機制（隨機時間戳 + 隨機數）
2. ✅ 實現動態超時和文件大小調整
3. ✅ 添加數據完整性驗證
4. ✅ 改進錯誤處理和診斷信息

### 第二階段（可靠性增強，1-2 天）
1. ✅ 實現端點故障轉移邏輯
2. ✅ 添加備用本地測試端點支持
3. ✅ 允許網路測試多次迭代

### 第三階段（優化和監控，進行中）
1. ✅ 網路結果納入評分
2. ✅ 添加詳細診斷報告
3. ✅ 用戶界面改進（顯示測試質量指標）

---

## 📊 測試驗證檢查清單

測試改進方案時，檢查以下場景：

- [ ] 低速網路（1-5 Mbps）下能否正確測速
- [ ] 高延遲網路（>200ms）下能否完成測試
- [ ] Cloudflare 服務故障時是否能轉向備用服務
- [ ] 多次運行結果的穩定性（標準差 < 20%）
- [ ] 測試中斷時的恢復能力
- [ ] 不同瀏覽器（Chrome, Firefox, Safari, Edge）的兼容性
- [ ] 行動設備上的可靠性

---

## 🚀 推薦優先事項

**如果只有有限時間，優先實施：**
1. **立即實施**：防緩存 + 動態超時（30 分鐘）- 解決 70% 的問題
2. **次優先**：數據驗證 + 診斷信息（1 小時）- 提高可靠性
3. **後續**：故障轉移 + 本地備用（1-2 天）- 完全避免失敗

---

## 📝 備注

- 如果部署了自建服務，建議使用 HTTPS + CORS 頭來支持跨域測試
- 定期監控各個測試端點的可用性
- 建議在 UI 中顯示「測試質量」指標（例如 "High Quality" 或 "Degraded"）
- 考慮添加測試環境選擇（默認、備用、本地）的用戶選項
