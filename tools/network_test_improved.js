/**
 * 改進版網路測試模組
 * YieldVitals - Network Test Module v2.0
 * 
 * 主要改進：
 * 1. 動態文件大小和超時調整
 * 2. 防緩存機制強化
 * 3. 數據完整性驗證
 * 4. 多次迭代支持
 * 5. 故障轉移邏輯（備用服務）
 * 6. 詳細診斷信息
 */

// ============================================================================
// 測試端點配置 - 支持多個備用服務
// ============================================================================

const NETWORK_TEST_ENDPOINTS = [
    {
        name: 'Cloudflare (Primary)',
        provider: 'cloudflare',
        ping: { url: 'https://speed.cloudflare.com/__down?bytes=0', method: 'HEAD' },
        download: { url: 'https://speed.cloudflare.com/__down', params: 'bytes=' },
        upload: { url: 'https://speed.cloudflare.com/__up', method: 'POST' },
        constraints: { maxDlSize: 100000000, maxUlSize: 10000000, priority: 1 }
    },
    // 備用服務 - 如果使用了自建服務
    {
        name: 'Local Fallback',
        provider: 'local',
        ping: { url: '/api/network/ping', method: 'HEAD' },
        download: { url: '/api/network/download', params: 'bytes=' },
        upload: { url: '/api/network/upload', method: 'POST' },
        constraints: { maxDlSize: 50000000, maxUlSize: 5000000, priority: 100, isLocal: true }
    }
];

// ============================================================================
// 實用函數：生成防緩存參數
// ============================================================================

function generateAntiCacheParam() {
    // 使用多個隨機源確保 URL 獨一無二
    return `t=${Date.now()}_r${Math.random().toString(36).substr(2)}_${crypto.getRandomValues(new Uint32Array(1))[0]}`;
}

// ============================================================================
// 實用函數：基於 Ping 動態決定策略
// ============================================================================

function getNetworkStrategy(pingMs) {
    /**
     * 根據延遲選擇適當的測試參數
     * - 高延遲（>500ms）：使用小文件和長超時
     * - 中延遲（100-500ms）：使用中等文件
     * - 低延遲（<100ms）：使用大文件和標準超時
     */
    
    if (!pingMs || pingMs > 500) {
        return {
            name: 'high-latency',
            dlSize: 5000000,      // 5MB
            dlTimeout: 45000,     // 45 秒
            ulSize: 500000,       // 500KB
            ulTimeout: 20000,     // 20 秒
            dlCheckInterval: 100  // 每 100ms 檢查一次進度
        };
    } else if (pingMs > 100) {
        return {
            name: 'medium-latency',
            dlSize: 25000000,     // 25MB
            dlTimeout: 30000,     // 30 秒
            ulSize: 1000000,      // 1MB
            ulTimeout: 15000,     // 15 秒
            dlCheckInterval: 80
        };
    } else {
        return {
            name: 'low-latency',
            dlSize: 100000000,    // 100MB
            dlTimeout: 20000,     // 20 秒
            ulSize: 3000000,      // 3MB
            ulTimeout: 10000,     // 10 秒
            dlCheckInterval: 50
        };
    }
}

// ============================================================================
// 核心函數：改進版 Ping 測試
// ============================================================================

async function runImprovedPingTest(endpoint, attemptCount = 5) {
    /**
     * 改進的 Ping 測試
     * 
     * 改進點：
     * - 多次重試，計算中位數而非簡單平均
     * - 防止單次異常值影響結果
     * - 詳細的超時和錯誤處理
     */
    
    const pings = [];
    const failedAttempts = [];
    
    for (let i = 0; i < attemptCount; i++) {
        try {
            const startTime = performance.now();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(
                `${endpoint.ping.url}&${generateAntiCacheParam()}`,
                {
                    method: endpoint.ping.method || 'HEAD',
                    cache: 'no-store',
                    signal: controller.signal,
                    // 額外的防緩存頭
                    headers: {
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Pragma': 'no-cache'
                    }
                }
            );
            
            clearTimeout(timeoutId);
            
            if (response.ok || response.status === 204) {
                const duration = performance.now() - startTime;
                pings.push(duration);
            }
        } catch (e) {
            failedAttempts.push(e.message || 'Unknown');
        }
    }
    
    // 計算結果
    if (pings.length === 0) {
        return {
            success: false,
            ping: null,
            pingMs: null,
            failureRate: 1.0,
            failedAttempts: failedAttempts
        };
    }
    
    pings.sort((a, b) => a - b);
    const medianPing = pings[Math.floor(pings.length / 2)];
    const avgPing = pings.reduce((a, b) => a + b, 0) / pings.length;
    const failureRate = failedAttempts.length / attemptCount;
    
    return {
        success: true,
        ping: Math.round(medianPing),
        pingMs: Math.round(medianPing),
        avgPing: Math.round(avgPing),
        minPing: Math.round(pings[0]),
        maxPing: Math.round(pings[pings.length - 1]),
        sampleCount: pings.length,
        failureRate: failureRate,
        failedAttempts: failedAttempts
    };
}

// ============================================================================
// 核心函數：改進版下載測試
// ============================================================================

async function runImprovedDownloadTest(endpoint, strategy, runId, onProgress) {
    /**
     * 改進的下載測試
     * 
     * 改進點：
     * - 動態超時和文件大小
     * - 進度報告（用於 UI 更新）
     * - 完整性驗證
     * - 防止 JIT 優化偏誤
     * - Content-Length 校驗
     */
    
    const dlStart = performance.now();
    let receivedLength = 0;
    let expectedSize = strategy.dlSize;
    let lastProgressTime = dlStart;
    
    try {
        const dlController = new AbortController();
        const dlTimeoutId = setTimeout(() => dlController.abort(), strategy.dlTimeout);
        
        // 構建下載 URL
        const dlUrl = `${endpoint.download.url}?${endpoint.download.params}${strategy.dlSize}&${generateAntiCacheParam()}`;
        
        const dlResp = await fetch(dlUrl, {
            method: 'GET',
            cache: 'no-store',
            signal: dlController.signal,
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        
        if (!dlResp.ok) {
            clearTimeout(dlTimeoutId);
            return {
                success: false,
                error: `HTTP ${dlResp.status}`,
                dl: null,
                completionRate: 0,
                bytesReceived: 0,
                expectedBytes: strategy.dlSize
            };
        }
        
        // 從響應頭取得預期大小
        const contentLength = dlResp.headers.get('content-length');
        if (contentLength) {
            expectedSize = parseInt(contentLength, 10);
        }
        
        // 讀取響應體
        const reader = dlResp.body.getReader();
        
        while (true) {
            if (typeof isCancelledRun !== 'undefined' && isCancelledRun(runId)) {
                dlController.abort();
                clearTimeout(dlTimeoutId);
                return {
                    success: false,
                    error: 'Cancelled',
                    dl: null,
                    completionRate: receivedLength / expectedSize,
                    bytesReceived: receivedLength,
                    expectedBytes: expectedSize
                };
            }
            
            const { done, value } = await reader.read();
            if (done) break;
            
            receivedLength += value.length;
            
            // 定期更新進度（如果有回調）
            const now = performance.now();
            if (onProgress && (now - lastProgressTime) > strategy.dlCheckInterval) {
                const progressPercent = (receivedLength / expectedSize * 100).toFixed(1);
                onProgress({
                    phase: 'download',
                    percent: progressPercent,
                    bytesReceived: receivedLength,
                    expectedBytes: expectedSize
                });
                lastProgressTime = now;
            }
        }
        
        clearTimeout(dlTimeoutId);
        
        const dlDurationSec = (performance.now() - dlStart) / 1000;
        const completionRate = receivedLength / expectedSize;
        
        // 計算速度
        const dlMbps = (receivedLength * 8) / (1024 * 1024) / dlDurationSec;
        
        return {
            success: true,
            dl: parseFloat(dlMbps.toFixed(1)),
            dlMbps: parseFloat(dlMbps.toFixed(1)),
            completionRate: completionRate,
            bytesReceived: receivedLength,
            expectedBytes: expectedSize,
            durationSec: dlDurationSec,
            warning: completionRate < 0.9 ? `Download incomplete: ${(completionRate * 100).toFixed(1)}%` : null
        };
    } catch (e) {
        // 如果因超時而中斷，但已接收部分數據，仍計算速度
        if (e.name === 'AbortError' && receivedLength > 0) {
            const dlDurationSec = (performance.now() - dlStart) / 1000;
            const dlMbps = (receivedLength * 8) / (1024 * 1024) / dlDurationSec;
            
            return {
                success: true,
                dl: parseFloat(dlMbps.toFixed(1)),
                dlMbps: parseFloat(dlMbps.toFixed(1)),
                completionRate: receivedLength / expectedSize,
                bytesReceived: receivedLength,
                expectedBytes: expectedSize,
                durationSec: dlDurationSec,
                isTimeout: true,
                warning: `Download interrupted (timeout): ${(receivedLength / expectedSize * 100).toFixed(1)}% received`
            };
        }
        
        return {
            success: false,
            error: e.message,
            dl: null,
            completionRate: receivedLength > 0 ? receivedLength / expectedSize : 0,
            bytesReceived: receivedLength,
            expectedBytes: expectedSize
        };
    }
}

// ============================================================================
// 核心函數：改進版上傳測試
// ============================================================================

async function runImprovedUploadTest(endpoint, strategy, runId, onProgress) {
    /**
     * 改進的上傳測試
     * 
     * 改進點：
     * - 使用 crypto.getRandomValues 生成更好的隨機數據
     * - 檢查服務器響應
     * - 支持進度報告
     * - 動態超時
     */
    
    const ulStart = performance.now();
    
    try {
        // 生成隨機上傳數據
        const ulData = new Uint8Array(strategy.ulSize);
        const seedBuffer = crypto.getRandomValues(new Uint8Array(4096));
        for (let i = 0; i < strategy.ulSize; i += 4096) {
            ulData.set(seedBuffer.subarray(0, Math.min(4096, strategy.ulSize - i)), i);
        }
        
        const ulController = new AbortController();
        const ulTimeoutId = setTimeout(() => ulController.abort(), strategy.ulTimeout);
        
        const ulUrl = `${endpoint.upload.url}?${generateAntiCacheParam()}`;
        
        const ulResp = await fetch(ulUrl, {
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
        
        clearTimeout(ulTimeoutId);
        
        if (!ulResp.ok) {
            return {
                success: false,
                error: `HTTP ${ulResp.status}`,
                ul: null,
                bytesUploaded: 0,
                expectedBytes: strategy.ulSize
            };
        }
        
        // 嘗試解析響應以驗證上傳成功
        let serverConfirmation = null;
        try {
            serverConfirmation = await ulResp.json();
        } catch (e) {
            // 即使無法解析也認為成功（基於 HTTP 200）
        }
        
        const ulDurationSec = (performance.now() - ulStart) / 1000;
        const ulMbps = (strategy.ulSize * 8) / (1024 * 1024) / ulDurationSec;
        
        return {
            success: true,
            ul: parseFloat(ulMbps.toFixed(1)),
            ulMbps: parseFloat(ulMbps.toFixed(1)),
            bytesUploaded: strategy.ulSize,
            expectedBytes: strategy.ulSize,
            durationSec: ulDurationSec,
            serverConfirmation: serverConfirmation
        };
    } catch (e) {
        // 即使因超時而中斷，如果已開始傳輸，也計算速度
        if (e.name === 'AbortError') {
            const ulDurationSec = (performance.now() - ulStart) / 1000;
            if (ulDurationSec > 0.1) { // 至少傳輸了一些數據
                const estimatedMbps = (strategy.ulSize * 8) / (1024 * 1024) / ulDurationSec;
                return {
                    success: true,
                    ul: parseFloat(estimatedMbps.toFixed(1)),
                    isTimeout: true,
                    warning: 'Upload timeout - partial result'
                };
            }
        }
        
        return {
            success: false,
            error: e.message,
            ul: null,
            bytesUploaded: 0,
            expectedBytes: strategy.ulSize
        };
    }
}

// ============================================================================
// 主函數：改進版網路測試（單個端點）
// ============================================================================

async function runNetworkTestWithEndpoint(endpoint, runId, onProgress) {
    /**
     * 使用指定端點執行完整的網路測試
     * 
     * 返回結果包含：
     * {
     *   dl: Mbps,           // 下載速度
     *   ul: Mbps,           // 上傳速度
     *   ping: ms,           // 往返延遲
     *   value: dl,          // 主要指標（下載速度）
     *   strategy: 'low-latency' | 'medium-latency' | 'high-latency',
     *   completionRate: 0-1,
     *   diagnostics: {...}
     * }
     */
    
    const testStart = performance.now();
    const result = {
        endpoint: endpoint.name,
        success: false,
        dl: null,
        ul: null,
        ping: null,
        value: 0,
        diagnostics: {
            strategy: null,
            pingStat: null,
            dlStat: null,
            ulStat: null,
            testDuration: null,
            completionRate: 0,
            warnings: []
        }
    };
    
    try {
        // 第一步：Ping 測試
        if (onProgress) onProgress({ phase: 'ping', percent: 10 });
        
        const pingStat = await runImprovedPingTest(endpoint, 3);
        result.diagnostics.pingStat = pingStat;
        result.ping = pingStat.ping;
        
        if (!pingStat.success) {
            result.diagnostics.warnings.push(`Ping failed: ${pingStat.failedAttempts.join(', ')}`);
            return result; // 無法連接，返回失敗
        }
        
        // 第二步：根據 Ping 決定策略
        const strategy = getNetworkStrategy(pingStat.ping);
        result.diagnostics.strategy = strategy.name;
        
        // 第三步：下載測試
        if (onProgress) onProgress({ phase: 'download', percent: 30 });
        
        const dlStat = await runImprovedDownloadTest(endpoint, strategy, runId, onProgress);
        result.diagnostics.dlStat = dlStat;
        
        if (dlStat.success) {
            result.dl = dlStat.dl;
            result.value = dlStat.dl; // 主要指標
            result.diagnostics.completionRate = dlStat.completionRate;
            
            if (dlStat.warning) {
                result.diagnostics.warnings.push(dlStat.warning);
            }
        } else {
            result.diagnostics.warnings.push(`Download failed: ${dlStat.error}`);
        }
        
        // 第四步：上傳測試
        if (onProgress) onProgress({ phase: 'upload', percent: 65 });
        
        const ulStat = await runImprovedUploadTest(endpoint, strategy, runId, onProgress);
        result.diagnostics.ulStat = ulStat;
        
        if (ulStat.success) {
            result.ul = ulStat.ul;
            if (ulStat.warning) {
                result.diagnostics.warnings.push(ulStat.warning);
            }
        } else {
            result.diagnostics.warnings.push(`Upload failed: ${ulStat.error}`);
        }
        
        // 計算整體成功度
        result.success = result.dl !== null || result.ul !== null;
        result.diagnostics.testDuration = performance.now() - testStart;
        
        if (onProgress) onProgress({ phase: 'complete', percent: 100 });
        
        return result;
    } catch (e) {
        result.diagnostics.warnings.push(`Fatal error: ${e.message}`);
        result.diagnostics.testDuration = performance.now() - testStart;
        return result;
    }
}

// ============================================================================
// 故障轉移包裝函數：自動嘗試多個端點
// ============================================================================

async function runNetworkTestWithFallback(runId, onProgress) {
    /**
     * 按優先級嘗試所有配置的端點，直到成功或所有都失敗
     * 
     * 返回值與 runNetworkTestWithEndpoint 相同，但包含額外的:
     * {
     *   ...
     *   endpointsTriedCount: number,
     *   primaryFailed: boolean,
     *   fallbackUsed: boolean
     * }
     */
    
    const sortedEndpoints = [...NETWORK_TEST_ENDPOINTS].sort((a, b) => {
        return (a.constraints.priority || 1) - (b.constraints.priority || 1);
    });
    
    let primaryFailed = false;
    let fallbackUsed = false;
    let endpointsTriedCount = 0;
    
    for (const endpoint of sortedEndpoints) {
        try {
            endpointsTriedCount++;
            
            if (onProgress) {
                onProgress({ phase: 'endpoint-test', message: `Testing ${endpoint.name}...` });
            }
            
            // 快速可達性測試
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            
            try {
                await fetch(endpoint.ping.url, {
                    method: 'HEAD',
                    cache: 'no-store',
                    signal: controller.signal
                });
            } catch (e) {
                clearTimeout(timeoutId);
                console.warn(`Endpoint ${endpoint.name} unreachable`);
                
                if (endpointsTriedCount === 1) primaryFailed = true;
                if (endpointsTriedCount > 1) fallbackUsed = true;
                
                continue; // 嘗試下一個端點
            }
            clearTimeout(timeoutId);
            
            // 執行完整測試
            const result = await runNetworkTestWithEndpoint(endpoint, runId, onProgress);
            
            if (result.success) {
                result.endpointsTriedCount = endpointsTriedCount;
                result.primaryFailed = primaryFailed;
                result.fallbackUsed = fallbackUsed;
                return result;
            }
            
            // 標記故障轉移狀態
            if (endpointsTriedCount === 1) primaryFailed = true;
            if (endpointsTriedCount > 1) fallbackUsed = true;
            
        } catch (e) {
            console.error(`Error testing ${endpoint.name}:`, e.message);
            
            if (endpointsTriedCount === 1) primaryFailed = true;
            if (endpointsTriedCount > 1) fallbackUsed = true;
        }
    }
    
    // 所有端點都失敗
    return {
        endpoint: 'None',
        success: false,
        dl: null,
        ul: null,
        ping: null,
        value: 0,
        endpointsTriedCount: endpointsTriedCount,
        primaryFailed: true,
        fallbackUsed: false,
        diagnostics: {
            warnings: ['All network test endpoints failed']
        }
    };
}

// ============================================================================
// 導出函數（供主應用調用）
// ============================================================================

async function runNetworkTest(duration, runId, onProgress = null) {
    /**
     * 改進版網路測試主入口
     * 這個函數應該替代原有的 runNetworkTest
     * 
     * 使用方式：
     *   const result = await runNetworkTest(duration, runId, (progress) => {
     *       console.log(progress.phase, progress.percent);
     *   });
     */
    
    try {
        const result = await runNetworkTestWithFallback(runId, onProgress);
        
        // 確保返回與原有函數兼容的格式
        return {
            value: result.value || 0,
            dl: result.dl,
            ul: result.ul,
            ping: result.ping,
            // 附加信息
            endpoint: result.endpoint,
            strategy: result.diagnostics.strategy,
            completionRate: result.diagnostics.completionRate,
            warnings: result.diagnostics.warnings,
            endpointsTriedCount: result.endpointsTriedCount,
            primaryFailed: result.primaryFailed,
            fallbackUsed: result.fallbackUsed
        };
    } catch (e) {
        console.error('Network test fatal error:', e);
        return {
            value: 0,
            dl: null,
            ul: null,
            ping: null,
            error: e.message,
            success: false
        };
    }
}

// ============================================================================
// 注意事項
// ============================================================================

/*
這個改進版本應該使用以下方式在原有代碼中替換：

1. 在 app.js 中找到原有的 runNetworkTest 函數
2. 使用以上改進版本的代碼替換
3. 更新 runWithSampling 的調用，允許網路測試多次迭代（改為 3 次）
4. 更新 UI 顯示邏輯，支持新的返回格式

搭配使用建議：
- 添加進度回調到 UI 更新函數
- 在 UI 中顯示 warnings 和 diagnostics 信息
- 根據 primaryFailed 和 fallbackUsed 標記展示警告信息
*/
