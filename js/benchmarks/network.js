        const NETWORK_TEST_ENDPOINTS = [
            {
                name: 'Cloudflare',
                ping: { url: 'https://speed.cloudflare.com/__down?bytes=0', method: 'HEAD' },
                download: { url: 'https://speed.cloudflare.com/__down', params: 'bytes=' },
                upload: { url: 'https://speed.cloudflare.com/__up', method: 'POST' }
            }
        ];

        function generateAntiCacheParam() {
            return `t=${Date.now()}_r${Math.random().toString(36).substr(2)}_${crypto.getRandomValues(new Uint32Array(1))[0]}`;
        }

        async function runNetworkTest(duration, runId) {
            let lastError = null;
            let successEndpoint = null;
            let finalResult = { value: 0, dl: null, ul: null, ping: null };

            for (const endpoint of NETWORK_TEST_ENDPOINTS) {
                try {
                    let pings = [];
                    setStatus('network', `${t('network_pinging')} (${endpoint.name})`, 'running');
                    
                    for (let i = 0; i < 3; i++) {
                        if (isCancelledRun(runId)) return Promise.reject(new Error(t('error_cancelled')));
                        const pStart = performance.now();
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 3000);
                        try {
                            const url = endpoint.name === 'OVH Public' 
                                ? `${endpoint.ping.url}?${generateAntiCacheParam()}`
                                : `${endpoint.ping.url}&${generateAntiCacheParam()}`;
                            const resp = await fetch(url, {
                                method: endpoint.ping.method,
                                cache: 'no-store',
                                signal: controller.signal
                            });
                            if (resp.ok || resp.status === 204) pings.push(performance.now() - pStart);
                        } catch(e) {}
                        clearTimeout(timeoutId);
                    }
                    
                    if (pings.length === 0) throw new Error(`${endpoint.name} unreachable`);
                    pings.sort((a, b) => a - b);
                    const ping = Math.round(pings[Math.floor(pings.length / 2)]);

                    setStatus('network', `${t('network_downloading')} (${endpoint.name})`, 'running');
                    const isHighLatency = ping > 500;
                    
                    let dlSize, dlUrl, expectedSize;
                    if (endpoint.name === 'Cloudflare') {
                        const modeValue = document.querySelector('input[name="testMode"]:checked').value;
                        dlSize = isHighLatency ? 5000000 : (modeValue === 'quick' ? 25000000 : 50000000);
                        dlUrl = `${endpoint.download.url}?${endpoint.download.params}${dlSize}&${generateAntiCacheParam()}`;
                        expectedSize = dlSize;
                    } else {
                        const sizeStr = isHighLatency ? '10Mb.dat' : '100Mb.dat';
                        dlUrl = `${endpoint.download.url}/${sizeStr}?${generateAntiCacheParam()}`;
                        expectedSize = isHighLatency ? 10485760 : 104857600;
                    }

                    const dlTimeout = isHighLatency ? 30000 : 20000;
                    let dlStart = performance.now();
                    const dlController = new AbortController();
                    const dlTimeoutId = setTimeout(() => dlController.abort(), dlTimeout);
                    let receivedLength = 0;
                    let dlMbps = null;

                    try {
                        const dlResp = await fetch(dlUrl, {
                            cache: 'no-store',
                            signal: dlController.signal
                        });
                        
                        if (!dlResp.ok) throw new Error(`HTTP ${dlResp.status}`);
                        
                        const contentLength = dlResp.headers.get('content-length');
                        if (contentLength) expectedSize = parseInt(contentLength, 10);
                        
                        const reader = dlResp.body.getReader();
                        while(true) {
                            if (isCancelledRun(runId)) { dlController.abort(); return Promise.reject(new Error(t('error_cancelled'))); }
                            const {done, value} = await reader.read();
                            if (done) break;
                            receivedLength += value.length;
                        }
                        
                        const dlDurationSec = (performance.now() - dlStart) / 1000;
                        const completionRate = receivedLength / expectedSize;
                        if (completionRate < 0.9) {
                            console.warn(`DL completion: ${(completionRate*100).toFixed(1)}%, data may be incomplete`);
                        }
                        dlMbps = parseFloat(((receivedLength * 8) / (1024 * 1024) / dlDurationSec).toFixed(1));
                    } catch (e) {
                        if (e.name === 'AbortError' && receivedLength > 500000) {
                            const dlDurationSec = (performance.now() - dlStart) / 1000;
                            dlMbps = parseFloat(((receivedLength * 8) / (1024 * 1024) / dlDurationSec).toFixed(1));
                        } else {
                            throw new Error(`Download failed: ${e.message}`);
                        }
                    } finally {
                        clearTimeout(dlTimeoutId);
                    }

                    let ulMbps = null;
                    if (endpoint.upload) {
                        setStatus('network', `${t('network_uploading')} (${endpoint.name})`, 'running');
                        const ulSize = isHighLatency ? 500000 : 2000000;
                        const ulData = new Uint8Array(ulSize);
                        const seedBuffer = crypto.getRandomValues(new Uint8Array(4096));
                        for(let i = 0; i < ulSize; i += 4096) {
                            ulData.set(seedBuffer.subarray(0, Math.min(4096, ulSize - i)), i);
                        }
                        
                        const ulTimeout = isHighLatency ? 15000 : 10000;
                        let ulStart = performance.now();
                        const ulController = new AbortController();
                        const ulTimeoutId = setTimeout(() => ulController.abort(), ulTimeout);
                        
                        try {
                            const ulResp = await fetch(`${endpoint.upload.url}?${generateAntiCacheParam()}`, {
                                method: endpoint.upload.method,
                                body: ulData,
                                cache: 'no-store',
                                signal: ulController.signal
                            });
                            
                            if (ulResp.ok) {
                                const ulDurationSec = (performance.now() - ulStart) / 1000;
                                ulMbps = parseFloat(((ulSize * 8) / (1024 * 1024) / ulDurationSec).toFixed(1));
                            }
                        } catch(e) {
                            console.warn('UL test failed:', e.message);
                        } finally {
                            clearTimeout(ulTimeoutId);
                        }
                    }
                    
                    finalResult = { value: dlMbps, dl: dlMbps, ul: ulMbps, ping: ping };
                    successEndpoint = endpoint.name;
                    break;
                    
                } catch (e) {
                    if (e.message === t('error_cancelled') || e.message === '使用者取消測試') throw e;
                    lastError = e;
                    console.warn(`Endpoint ${endpoint.name} failed:`, e.message);
                }
            }

            if (!successEndpoint) {
                setStatus('network', t('error_network_failed'), 'error');
                document.getElementById('res-network').innerHTML = `N/A`;
                return { value: 0, dl: null, ul: null, ping: null, error: lastError ? lastError.message : 'All endpoints failed' };
            }

            return finalResult;
        }


