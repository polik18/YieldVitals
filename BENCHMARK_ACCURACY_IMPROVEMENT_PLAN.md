# YieldVitals 準確度問題研究與改善計畫

> 研究日期：2026-11-10｜研究對象：`main` @ `bd558d8`｜測試機：Apple M2 Max（12 核、32 GB）
> 測試方式：共用 Camoufox（Firefox 152，headless）＋ Playwright Chromium 148（headless，ANGLE Metal 真實 GPU），對線上版 `https://polik18.github.io/YieldVitals/` 實跑。

---

## 一、結論（一句話）

**分數不準的主因是「計分校準與量測設計」錯了，而不是硬體或網路：** 每個項目的基準值（baseline）單位與實測量級對不上；GPU 分數由「測試時間長短」決定而非 GPU 能力；所以雷達圖必然一邊頂到 100、一邊掉到個位數。另外，正式網域 `yieldvitals.com` 目前根本連不到網站。

---

## 二、實測數據

### 2.1 同一台 M2 Max、不同瀏覽器（Quick 模式）

| 項目 | Camoufox/Firefox ×3 | Chromium ×2 | Baseline | 雷達值 FF → Chromium |
|---|---|---|---|---|
| CPU (M/s) | 565–583 | 755 | 900 | 56 → 63 |
| String (k ops) | 18.4–18.6 | 23.1 | 40 | 48 → 54 |
| RAM (cyc/s) | 183 | 649–734 | 700 | **34 → 65–68** |
| DOM (ops/s) | 3,364–4,396 | 23,643–24,425 | 4,000 | **~66 → 92** |
| Canvas 2D (ops/s) | ~231,000 | ~2,800,000 | **5,000** | **99 → 100** |
| GPU (Pts) | **47（三次完全相同）** | 481–639 | **1,500** | **6 → 39–46** |
| Crypto (MB/s) | ~2,250 | ~2,300 | 3,000 | 60 → 61 |
| Storage (MB/s) | 2,578–2,784 | 729–749 | 1,500 | 78 → 50 |
| **總分** | **50–51** | **63–64** | | |

**觀察：**
- 頂級筆電 M2 Max 總分只有 50–64，比程式註解宣稱的「基準機 ≈ 67 分」還低。
- 雷達圖極端化：Canvas 2D 永遠 99–100，GPU 永遠 6–46（使用者回報的現象已重現）。
- 同一台機器換瀏覽器：RAM 差 4 倍、DOM 差 6 倍、Canvas 差 12 倍、Storage 方向相反，但共用同一套 baseline。
- 可信度徽章三次都顯示「High」，即使 GPU 明顯卡在下限。

### 2.2 Chromium 不同模式的 GPU 分數

| 模式 | GPU Pts | 雷達 GPU |
|---|---|---|
| Quick | 639 / 481 | 46 / 39 |
| Standard | 663 | 47 |
| **Extreme** | **432** | **37** |

→ 越「極限」的模式，GPU 分數越低。證明 GPU 分數取決於模式參數與時間，而不是 GPU。

### 2.3 Camoufox 指紋偽裝

Camoufox 回報 `8 核 / "Apple M1, or similar" / Memory Unknown`（實機 12 核 M2 Max）。程式完全依賴 `hardwareConcurrency` 與 `WEBGL_debug_renderer_info`，遇到隱私瀏覽器（Brave、Firefox RFP、Safari）時，CPU Worker 數與環境資訊都會失真。

---

## 三、問題清單（依嚴重度排序）

### P0-1 正式網域掛掉
- `yieldvitals.com` DNS → `162.255.119.175`（Namecheap parking），HTTPS 連線逾時 75 秒；`www` 指向 `parkingpage.namecheap.com`。
- 但 `index.html` 的 `og:url`、`sitemap.xml`、canonical 都指向 `yieldvitals.com`，repo 也沒有 `CNAME` 檔。
- 影響：使用者與搜尋引擎從正式網址進不來，「效果非常不好」有一部分是根本沒流量。

### P0-2 GPU 分數設計錯誤（`js/benchmarks/gpu.js`）
1. **天花板低於 baseline**：三階段分數上限合計 1000，baseline 卻是 1500 → 雷達 GPU 理論最高只有 **57**。
2. **分數 = 時間，不是能力**：每 250 ms 固定加一次負載（+3000 實例／+15 迭代／+1 燈），時間到就結束。強 GPU 只會「跑到時間到」，拿到的是時間上限分。
3. **依模式正規化**：Phase 1 以 `config.gpuMax`（5 萬／15 萬／50 萬）當分母 → Extreme 分母大 10 倍，分數反而更低（實測已證實）。
4. **低 FPS 立即判死**：`currentFPS < 30` 就累計 drop，headless 或軟體渲染（13–15 FPS）每一階段一開始就結束 → 永遠得到下限 **47 分**（= 1000/50000×500 + 20/200×300 + 1/30×200）。
5. **Vsync 綁定**：以 rAF FPS 判斷，60/120 Hz 螢幕結果不同；分頁背景化時 rAF 停止，會等到 timeout。
6. **Phase 3 加燈會觸發 Three.js 重新編譯 shader**，造成卡頓被誤判為 GPU 不足；Mac 上又強制關閉陰影 → Mac 與 Windows 跑的是不同工作量，分數不可比。

### P0-3 Canvas 2D baseline 單位錯誤（`js/benchmarks/memory.js` 內的 canvas2d、`state.js`）
- 實際計算 `ops × 100 / 秒`（每秒 draw call 數），baseline 卻寫 5,000「ops/s」→ 實測是 baseline 的 **46～555 倍**，永遠 100 分。
- OffscreenCanvas 只呼叫 `fill()`、從不 `convertToBlob/getImageData`，GPU 加速的 2D context 可能只是在「錄製指令」，沒有真正光柵化。
- 沒有 OffscreenCanvas 時改跑純數學 fallback，結果卻放在同一軸上。

### P0-4 單點失敗拖垮全部（`js/main.js`）
- 9 項測試包在同一個 `try`：任一項 timeout/錯誤 → 後續全部跳過 → 缺的項目以 0 分計入加權 → 總分暴跌。
- `withTimeout` 只是 `Promise.race`，不會中止原本的工作；逾時的測試（如網路下載）仍在背景跑，干擾後面的測試。
- `runWithSampling` 的 `res.value || res.score || res`：值為 0 時會把物件塞進排序陣列。

### P1-1 Baseline 未校準、且與瀏覽器引擎強相關
- 註解寫「已用 M4/Ryzen 校準」，但 M2 Max 實測 CPU/String/RAM 全部低於 baseline，DOM/Canvas 遠高於 baseline。
- RAM、DOM、Storage、Canvas 在 Firefox 與 Chromium 之間差 3–12 倍，用同一組 baseline 就必然失真。

### P1-2 正規化曲線壓縮差異
- `100·r/(r+0.5)`：baseline=67、2 倍=80、4 倍=89、0.25 倍=33。強 4 倍的機器只多 22 分，弱機卻很快跌到個位數 → 分數區間被擠在 45–70，只有「單位錯」的項目才會衝到極端。
- 總分是算術加權平均：一個項目 100、一個 6，平均起來看似正常，掩蓋問題。

### P1-3 各項量測方法本身的偏差
| 項目 | 問題 |
|---|---|
| CPU | 主要測 `Math.sin/cos/random` 吞吐；以「要求的 duration」除而非實際經過時間；Worker 啟動與 JIT 暖機算在內；Quick 只有 500 ms。 |
| String | 每輪字串長度幾乎相同，實際測的是 `String.repeat`＋`JSON.parse` 混合，且 350 ms 太短。 |
| RAM | 測的是 JS 引擎 allocator/GC，不是記憶體；Firefox 與 Chromium 差 4 倍。 |
| DOM | `setTimeout(step, 0)` 巢狀超過 5 層被瀏覽器 clamp 到 ≥4 ms → 4 ms 工作＋4 ms 閒置，分母包含閒置時間；結果反映計時器政策而非排版效能。 |
| Storage | 計時包含 `getDirectory/createSyncAccessHandle` 開銷；只跑 1 次、350 ms；各瀏覽器 `flush()` 語意不同（FF 2.7 GB/s vs Chromium 0.75 GB/s）。 |
| Crypto | 相對合理，但 350 ms 太短；>10000 MB/s 的警告門檻永遠不會觸發。 |
| Network | 用 1024² 換算 Mbps（低估 4.6%）；單一連線無法跑滿高頻寬；上傳只 2 MB，延遲主導；3 次 × 50 MB 下載在慢速網路必超過 60 s 總逾時。 |

### P1-4 可信度與診斷誤導
- 可信度只檢查 CPU/GPU 是否存在 → 卡在下限/上限、變異大時仍顯示「High」。
- 「弱點」只在 5 項裡挑最低，實測 M2 Max 被建議「加裝獨立顯卡」，對筆電/Mac/手機是錯誤建議。
- 環境資訊被隱私瀏覽器偽裝時沒有提示。

### P2 專案衛生
- `temp_app.js`（92 KB 舊版單檔）、`split_app.py`、`tools/patch_*.{js,py}`、多份過時的 NETWORK_* 報告 → 容易改錯檔、誤判現行邏輯。
- 沒有任何自動化回歸測試，每次調參都靠手感。

---

## 四、改善計畫

### 階段 0：止血（0.5–1 天）— 2026-11-10 程式部分已完成，網域待處理

> **完成狀態**
> - ✅ 2 流程容錯：`main.js` 改為逐項 `runStep`；失敗項目記為 `null`、顯示 N/A、雷達留空、總分依剩餘權重重算；錯誤訊息列出每個失敗項目與原因。
> - ✅ 逾時真正中止：`utils.js` 新增 `runStep`（AbortSignal token）＋`trackWorker`/`terminateActiveWorkers`；`isCancelledRun` 支援 token。
> - ✅ 3 `runWithSampling` 改用 `resultValue()`，只取有效樣本的中位數；無有效樣本即視為失敗。可信度改依實際失敗清單判斷。
> - ✅ 4 baseline 暫定值：GPU 1500→600、Canvas 2D 5000→1,500,000。
> - ✅ 報告文字：失敗項目顯示 N/A 而非 0。
> - ✅ 1 網址：`yieldvitals.com` 並非本專案網域（他人註冊、停車頁），已全面改為 `https://polik18.github.io/YieldVitals/` 並加 canonical；commit `dbe36ec` 已推送，Pages 約 45 s 上線，線上實跑驗證通過（總分 66、無 page error）。
>
> **驗證（M2 Max，本機 http.server）**
> - Chromium 正常跑：總分 66，雷達 `[62,54,61,68,51,93,67,79]`（GPU 46→67、Canvas 100→79），無 page error。
> - Chromium 故障注入（Storage 拋錯＋Crypto 永久卡住）：Crypto 6 s 逾時、Storage 失敗，其餘 7 項含 Network 照常完成；兩項 N/A、雷達留空、總分 69、可信度降為 Medium。
> - Camoufox（Firefox 引擎）正常跑：無錯誤，總分 45；GPU 仍為 47 下限（屬階段 1）。
> - 仍存在的極端值：Chromium DOM 93（baseline 4000 vs 實測 ~26k，Firefox ~3.5k）→ 屬階段 2 依引擎校準。
1. **網域**：二擇一
   - 恢復 `yieldvitals.com`：Namecheap DNS 設 GitHub Pages A 記錄（185.199.108–111.153）＋`www` CNAME → `polik18.github.io`，repo 加 `CNAME` 檔，Pages 開啟 Enforce HTTPS。
   - 或暫時把 `og:url`、canonical、`sitemap.xml` 改成 `https://polik18.github.io/YieldVitals/`。
2. **流程容錯**（`main.js`）：每項測試獨立 `try/catch`，失敗記為 `null`（不是 0）；總分只對成功項目重新分配權重；`withTimeout` 改為傳入 `AbortSignal`／終止 Worker，逾時即真正停止。
3. **修 `runWithSampling`**：統一由各測試回傳 `{value, unit, meta}`，不再用 `||` 推斷。
4. **立即修正兩個明顯錯誤的 baseline**：Canvas 2D 改用實際單位（draw calls/s）並重新設定量級；GPU baseline 不得高於 GPU 分數上限（暫時改 600，待階段 2 重寫）。

### 階段 1：GPU 測試重寫（2–3 天）— 2026-11-10 已完成

> **完成狀態**
> - ✅ 固定工作量、量時間：Phase 1 = 60k 實例 × 80 三角形；Phase 2 = 每像素 128 次 ALU 迴圈；Phase 3 = 8 點光源 PBR＋400 實例球。模式只影響量測時間，不影響尺度（移除 `gpuMax`）。
> - ✅ 與螢幕脫鉤：固定 1280×720 離屏 render target，批次渲染後以 readPixels 1×1 同步停表；不再依 rAF/FPS 門檻。
> - ✅ **Ping-pong 相依鏈**：實驗證實未讀取的中間幀會被驅動略過（Shader 階段吞吐被灌水約 130 倍，2048 次迴圈仍 8000 FPS）；改為每幀取樣上一幀後吞吐與迴圈數/解析度呈線性。
> - ✅ 光源初始化時一次建好、先 compile；所有平台不開陰影（移除 Mac 特例）。
> - ✅ 分數 = 三階段相對參考值的加權幾何平均 × 1000（無上限）；參考值 = M2 Max/Chromium，`BENCHMARK_BASELINE.gpu = 1000`（暫定，階段 2 重新校準）。
> - ✅ 軟體渲染偵測（SwiftShader/llvmpipe 等）→ 顯示 `(SW)`、可信度降為 Medium（新增 `rel_reason_gpu_sw`，30 語系）。
> - ✅ 測試期間分頁被隱藏 → 該次結果作廢（N/A）。
> - ✅ 完整 GPU 結果（各階段吞吐量、software 旗標）保留於 JSON 匯出。
>
> **驗證（M2 Max）**
> | 情境 | 修改前 | 修改後 |
> |---|---|---|
> | Chromium Quick / Quick / Extreme | 639 / 481 / 432 Pts | 1014 / 1006 / 1011 Pts（差異 < 1%） |
> | Camoufox（Firefox 引擎） | 固定 47 Pts | 1059 Pts |
> | Chromium SwiftShader 軟體渲染 | — | 6 Pts (SW)，可信度 Medium |
> | 雷達 GPU 軸（Chromium） | 39–46 | 67 |

- 改為**固定工作量、量時間**（不依模式、不依時間上限）：每個 phase 用固定的幾個負載等級（例如 Phase 1 = 1 萬／5 萬／20 萬實例），每級渲染固定 N 幀，以 `gl.finish()` 或 `EXT_disjoint_timer_query_webgl2` 量 GPU 時間，輸出「每秒實例數」「每秒片段迭代數」等連續值。
- 渲染到離屏 render target（固定解析度，如 1920×1080），與螢幕刷新率、devicePixelRatio、vsync 脫鉤。
- Phase 3 在開始前一次建好所有燈並預熱 shader，只切換 `visible`／強度，避免重新編譯；Mac 與其他平台使用同樣的陰影設定（或兩者都關）。
- 偵測軟體渲染（`SwiftShader`、`llvmpipe`、`Microsoft Basic Render`、FPS 遠低於門檻），標記為「GPU 加速未啟用」而不是給 47 分。
- 頁面 `visibilitychange` 時暫停並作廢該次結果。

### 階段 2：校準與計分重構（3–5 天）— 2026-11-10 已完成第一版（單一參考機）

> **完成狀態**
> - ✅ `tools/calibrate.js`：Playwright 在 Chromium/Firefox/WebKit 實跑並輸出各項中位數與 CV。
> - ✅ 校準過程發現並修正量測錯誤（原屬階段 3）：
>   - CPU：迴圈結果未使用，Safari/JSC 直接最佳化掉 → WebKit CPU 灌水 22 倍（22655 → 362）。String/RAM 同樣加入 sink；改以實際經過時間為分母。
>   - DOM：改用 MessageChannel 讓出（無 setTimeout 4ms 強制延遲），分母只計工作時間；三引擎差距 14 倍 → 2.7 倍。
>   - Canvas 2D：每批讀回 1 像素強制光柵化；三引擎由 2.5M/230k/1.16M → 155k/154k/172k（一致）。
> - ✅ `detectEngine()`（blink/gecko/webkit，iOS 一律 webkit）＋ `BENCHMARK_BASELINES` 依引擎分開。
> - ✅ 對數計分：參考機 = 75，每 2 倍 ±15；總分 = 各項對數分數加權平均（= 倍率加權幾何平均）。
> - ✅ 報告與 JSON 匯出加入引擎與 baseline。
> - ⏳ 只有一台參考機（M2 Max）；需補中低階筆電、Windows、Android、iPhone 的資料驗證曲線。
> - ⏳ 可信度尚未改用 CV。
>
> **驗證（M2 Max，tools/calibrate.js）**：三引擎各項 CV 皆 < 6%；參考機雷達 74–77；
> Chromium 主執行緒降速 4 倍模擬 → DOM 47445→10939、雷達 75→43（理論 45），總分 75→72，診斷正確指出 DOM 瓶頸。

### 網路測速重寫（原階段 3 網路項目）— 2026-11-10 已完成

> 對照 macOS `networkQuality`（DL ~900 / UL ~932 Mbps / RTT 10–13 ms）：
> | | 舊版 | 新版（Chromium / Firefox / WebKit） |
> |---|---|---|
> | 下載 | 530–717 | 898–914 / 902–915 / 892–907 |
> | 上傳 | 126–258 | 785–811 / 746–768 / 756–832 |
> | Ping | 29–77 ms | 9.5 / 8–9 / 9–11 ms |
>
> 修正：Ping 扣除 Server-Timing 伺服器處理時間（約 25–30 ms）並取 10 次中位數＋jitter；6 條並行連線、固定時間窗、扣除 1 秒爬升期；上傳自適應區塊並以 **Blob** 為 body（Chromium 用 ArrayBuffer 會卡在 ~300 Mbps）；Mbps 改用 1e6；WebKit 無 serverTiming 時解析回應標頭。

1. **建立校準資料集**：用下方「驗證工具」在至少 6 種裝置 × 2 引擎（Chromium、Firefox；Safari 可選）跑 Standard 模式各 5 次，存成 `calibration/*.json`。
2. **依引擎分開的 baseline**：`BENCHMARK_BASELINE[engine][test]`，引擎由 feature detection 判斷（不用 UA）；未知引擎回退到 Chromium baseline 並標示「跨引擎不可比」。
3. **改用對數計分**（業界 Geekbench/Speedometer 做法）：
   - 子項分數 = `clamp(50 + 25·log2(value/baseline), 0, 100)` → baseline=50、2 倍=75、4 倍=100、0.5 倍=25。差異線性可讀，不會再被曲線壓扁。
   - 總分 = 子項比值的**加權幾何平均**再映射，單一極端值不會綁架總分。
4. **暖機與取樣**：每項先跑 1 次暖機丟棄；正式取樣 ≥5 次取中位數；用實際 `performance.now()` 經過時間做分母；Quick 模式每項 ≥1 s。
5. **可信度改用統計**：計算每項變異係數（CV）；CV > 10%、命中上/下限、分頁曾背景化、偵測到軟體渲染或指紋偽裝（`hardwareConcurrency` 不合理、renderer 含 "or similar"）→ 降級並說明原因。

### 階段 3：各項測試修正（3–4 天，可並行）
| 項目 | 修正 |
|---|---|
| CPU | 混合整數/浮點/分支工作負載（如 SHA-256、排序、矩陣乘）；同時回報單核與多核分數；Worker 數改為 `min(hardwareConcurrency, 實測擴展到不再增加為止)`。 |
| String | 使用預先產生的多種大小 JSON 樣本（10 KB/100 KB/1 MB），分別量 parse 與 stringify。 |
| RAM | 改名為「JS 記憶體配置/GC」並明說是引擎指標；加入 TypedArray 大區塊複製頻寬（較接近記憶體頻寬）。 |
| DOM | 改用 `MessageChannel` 讓出主執行緒（無 4 ms clamp），分母只計工作時間；測真實排版（多層 flex/grid、1000 節點的 layout）。 |
| Canvas 2D | 每批繪製後 `convertToBlob()` 或 `getImageData` 1×1 強制光柵化；拿掉純數學 fallback（不支援就標 N/A）。 |
| Storage | 計時只包含寫入迴圈；固定寫入量（如 64 MB）量時間；分別量寫入與讀回；標註「瀏覽器沙盒 I/O，非裸 SSD 速度」。 |
| Crypto | 延長到 ≥1 s；改量 AES-GCM 與 SHA-256 兩種。 |
| Network | 用 1e6 換算；4–6 條並行連線、以時間為上限（例如 8 s）持續下載；上傳改為多段並行、總量依頻寬自適應；ping 用 5–10 次取中位數並排除第一次（TLS 握手）；整體逾時與迭代次數依量測動態調整。 |

### 階段 4：診斷建議與 UI（1–2 天）
- 弱點判斷改用「相對同引擎、同裝置類型的百分位」，只在明顯低於中位數時才建議升級；Mac/筆電/手機不再出現「加裝獨立顯卡」「加裝記憶體」等不可行建議。
- 雷達圖顯示原始值 tooltip 與「本次引擎」，並對 N/A 項目以虛線/灰色呈現，不再畫成 0。
- 報告與 JSON 匯出加入：引擎、模式、每項取樣陣列、CV、可信度原因、偵測到的偽裝/軟體渲染旗標。

### 階段 5：驗證與防回歸（持續）
- 把本次研究用的 Playwright 腳本（見附錄）收進 `tools/bench_harness.py`，加入：
  - **重複性**：同機同引擎 5 次，各子項 CV < 5%（GPU < 8%）。
  - **單調性**：同機切換 Quick/Standard/Extreme，各子項差異 < 10%（目前 GPU 差 35%）。
  - **無頂天/觸底**：校準裝置上沒有任何子項 = 0 或 = 100。
  - **跨裝置排序**：校準資料集中，已知較強裝置的總分必須較高。
- 清理 `temp_app.js`、`split_app.py`、`tools/patch_*`、過時的 NETWORK_* 文件（移到 `archive/`）。

---

## 五、建議執行順序與驗收

| 順序 | 內容 | 驗收標準 |
|---|---|---|
| 1 | 階段 0 | 正式網址 200；任一項失敗時其餘項目照常完成、總分不含 0 |
| 2 | 階段 1 | Quick/Standard/Extreme 的 GPU 分數差 < 10%；headless 顯示「GPU 加速未啟用」而非 47 |
| 3 | 階段 2 | M2 Max 在 Chromium 上各子項落在 40–90；雷達無 0/100 極端值 |
| 4 | 階段 3、4 | 各子項 CV 達標；診斷建議不再出現不適用的硬體升級 |
| 5 | 階段 5 | 腳本可一鍵跑出回歸報告，納入每次發版前檢查 |

---

## 附錄：重現用腳本

研究時使用的 Playwright 腳本（Chromium，獨立暫存 profile，不動共用 Camoufox profile）：

```bash
python -I chromium_bench.py headless <quick|standard|extreme> <runs>
```

重點：用 `Chart.getChart('radarChart')` 取雷達資料（`window.radarChart` 會被同名 `<canvas id="radarChart">` 遮蔽）；Chromium 需加 `--use-angle=metal --enable-gpu --ignore-gpu-blocklist` 才會用真實 GPU。
