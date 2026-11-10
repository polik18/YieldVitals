#!/usr/bin/env node
// YieldVitals 校準／回歸測試工具
//
// 以 Playwright 在 Chromium / Firefox / WebKit 實跑 YieldVitals，擷取每個測試項目的原始數值，
// 輸出中位數與變異係數 (CV)，用於設定 js/core/state.js 的各引擎 baseline，或驗證改版後數值是否穩定。
//
// 用法：
//   NODE_PATH=$(npm root -g) node tools/calibrate.js [選項]
//     --url <網址>            預設 http://127.0.0.1:8765/（先在專案根目錄執行 python3 -m http.server 8765）
//     --engines a,b,c         chromium,firefox,webkit（預設三者）
//     --mode <模式>           quick|standard|extreme（預設 standard）
//     --runs <次數>           每個引擎跑幾次（預設 3）
//     --headless              無頭模式（預設有頭；有頭較接近真實使用者，GPU 也一定走硬體加速）
//     --skip-network          跳過網路測速（校準計分 baseline 時不需要網路）
//     --out <檔案>            將結果寫成 JSON
//
// 需要 playwright-core（或 playwright）與對應版本的瀏覽器：npx playwright install chromium firefox webkit

let pw;
try { pw = require('playwright'); } catch (_) { pw = require('playwright-core'); }

function parseArgs(argv) {
    const o = { url: 'http://127.0.0.1:8765/', engines: ['chromium', 'firefox', 'webkit'], mode: 'standard', runs: 3, headless: false, skipNetwork: false, out: null };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--url') o.url = argv[++i];
        else if (a === '--engines') o.engines = argv[++i].split(',');
        else if (a === '--mode') o.mode = argv[++i];
        else if (a === '--runs') o.runs = parseInt(argv[++i], 10);
        else if (a === '--headless') o.headless = true;
        else if (a === '--skip-network') o.skipNetwork = true;
        else if (a === '--out') o.out = argv[++i];
        else throw new Error(`未知參數：${a}`);
    }
    return o;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const cv = (xs) => {
    if (xs.length < 2) return null;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    return m ? +(sd / m * 100).toFixed(1) : null;
};

const LAUNCH_ARGS = {
    chromium: ['--enable-gpu', '--ignore-gpu-blocklist'],
    firefox: [],
    webkit: []
};

async function runEngine(engineName, opt) {
    const browser = await pw[engineName].launch({ headless: opt.headless, args: LAUNCH_ARGS[engineName] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    const sep = opt.url.includes('?') ? '&' : '?';
    await page.goto(`${opt.url}${sep}calib=${Date.now()}`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForFunction(() => typeof runWithSampling === 'function' && !!window.Chart && !!window.THREE, null, { timeout: 30000 });

    const env = await page.evaluate(() => ({
        ua: navigator.userAgent,
        engine: typeof detectEngine === 'function' ? detectEngine() : 'n/a',
        cores: navigator.hardwareConcurrency,
        gpu: (typeof deviceSpecs !== 'undefined' && deviceSpecs.gpuRenderer) || ''
    }));

    // 包裝 runWithSampling，擷取每項的最終結果（含物件）
    await page.evaluate((skipNetwork) => {
        const orig = runWithSampling;
        window.__calib = {};
        runWithSampling = async (name, ...rest) => {
            const r = await orig(name, ...rest);
            window.__calib[name] = r;
            return r;
        };
        if (skipNetwork) {
            runNetworkTest = async () => ({ value: 0, dl: null, ul: null, ping: null, skipped: true });
        }
    }, opt.skipNetwork);

    await page.click(`input[name=testMode][value=${opt.mode}]`, { force: true });
    const runs = [];
    for (let i = 0; i < opt.runs; i++) {
        await page.evaluate(() => { window.__calib = {}; document.getElementById('startBtn').click(); });
        await page.waitForTimeout(1500);
        await page.waitForFunction(() => !document.getElementById('startBtn').disabled, null, { timeout: 15 * 60 * 1000 });
        const r = await page.evaluate(() => {
            const pick = (v) => (v && typeof v === 'object') ? v.value : v;
            const c = window.__calib;
            const chart = Chart.getChart('radarChart');
            return {
                raw: {
                    cpu: pick(c.cpu), string: pick(c.string), memory: pick(c.ram), dom: pick(c.dom),
                    canvas2d: pick(c.canvas2d), gpu: pick(c.gpu), crypto: pick(c.crypto), storage: pick(c.storage)
                },
                network: c.network && typeof c.network === 'object' ? { dl: c.network.dl, ul: c.network.ul, ping: c.network.ping, jitter: c.network.jitter } : null,
                gpuDetail: c.gpu && typeof c.gpu === 'object' ? c.gpu : null,
                score: document.getElementById('scoreMarker').innerText.trim(),
                radar: chart ? chart.data.datasets[0].data : null,
                reliability: document.getElementById('reliabilityBadge').innerText.trim()
            };
        });
        runs.push(r);
        console.error(`[${engineName}] run ${i + 1}/${opt.runs}: score ${r.score} radar ${JSON.stringify(r.radar)}`);
    }
    await browser.close();

    const keys = Object.keys(runs[0].raw);
    const summary = {};
    keys.forEach(k => {
        const xs = runs.map(r => r.raw[k]).filter(v => typeof v === 'number' && v > 0);
        summary[k] = { median: median(xs), cvPct: cv(xs), samples: xs };
    });
    return { engine: engineName, env, summary, runs, pageErrors };
}

(async () => {
    const opt = parseArgs(process.argv);
    const results = [];
    for (const e of opt.engines) {
        try {
            results.push(await runEngine(e, opt));
        } catch (err) {
            console.error(`[${e}] 失敗：${err.message}`);
            results.push({ engine: e, error: err.message });
        }
    }
    const report = { timestamp: new Date().toISOString(), options: opt, results };
    if (opt.out) require('fs').writeFileSync(opt.out, JSON.stringify(report, null, 2));
    // 精簡摘要
    for (const r of results) {
        if (r.error) { console.log(`${r.engine}: ERROR ${r.error}`); continue; }
        console.log(`\n== ${r.engine} (${r.env.engine}, ${r.env.cores} cores, ${r.env.gpu})`);
        for (const [k, s] of Object.entries(r.summary)) console.log(`  ${k.padEnd(9)} median=${s.median}  CV=${s.cvPct}%`);
        const nets = r.runs.map(x => x.network).filter(Boolean);
        if (nets.length && !opt.skipNetwork) console.log(`  network   ${JSON.stringify(nets)}`);
        if (r.pageErrors.length) console.log(`  pageErrors: ${r.pageErrors.join(' | ')}`);
    }
})();
