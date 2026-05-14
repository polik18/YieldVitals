# 📊 YieldVitals Pro | 廠測級網頁效能評測工具

> **YieldVitals Pro 是一款專為旗艦硬體打造的「廠測級」網頁效能評測工具。打破傳統跑分盲區，採用 Web Worker 多核心叢集榨乾 CPU 算力，並透過 Three.js 執行十萬級 3D 光影渲染測試 GPU 極限。內建 RAM 垃圾回收、DOM 強制重繪與 Gigabit 千兆並發網路測試。搭配專屬校準演算法與硬體天梯圖，為開發者與 QA 提供最嚴苛、真實的效能檢驗報告。**

## 🛑 為什麼需要 YieldVitals Pro？(解決傳統測試盲區)

傳統的 Web Benchmark 工具在面對現代旗艦級設備 (如 Apple M-Series, 高階 RTX 筆電) 時，往往因為瀏覽器沙盒限制與演算法缺陷而失去鑑別度，產生「誤判」。YieldVitals Pro 針對以下致命問題進行了**底層架構重構**：

1. **單線程限制 (Single-Threaded Bias)**: 突破 JS 單執行緒限制，自動偵測實體核心數並派發對應的 Web Worker 叢集，真實榨乾多核 CPU 算力。
2. **Vsync 鎖幀陷阱 (The Vsync Trap)**: 傳統 GPU 測試常受限於螢幕更新率 (如 60FPS) 而無法測出高階顯卡極限。本工具導入十萬級實體 (InstancedMesh) 與動態光影，利用「超高負載」直接測試 GPU 的 ALU 吞吐量。
3. **JIT 編譯器欺騙 (JIT Deception)**: 放棄簡單的迴圈測試，改以密集的浮點矩陣運算與複雜字串解析，防止 V8 引擎過度最佳化導致的「虛假零延遲」。
4. **網路測速失真 (Network Bottleneck)**: 解決單線程 Fetch 無法塞滿 Gigabit 網卡的問題，採用多線程並發下載，並加入 TLS/TCP 封包開銷 (Overhead) 補償。

## ⚙️ 核心測試模組 (Core Modules)

本工具包含六大深度測試引擎，全面評估設備體質：

### 1. 邏輯運算 (CPU 全核心)

- **技術**: `Web Worker Clusters`
- **原理**: 根據 `navigator.hardwareConcurrency` 動態產生平行 Worker。在 1.5 秒內密集進行亂數生成、三角函數與平方根矩陣運算。

### 2. 深度字串解析 (CPU 單核)

- **技術**: `JSON.parse` & `RegEx RegExp`
- **原理**: 模擬前端框架處理龐大 JSON 狀態與 Router 匹配的真實場景，測試 V8 引擎處理巢狀物件與正則表達式的極限速度。

### 3. 記憶體分配與回收 (RAM)

- **技術**: `Garbage Collection Thrashing`
- **原理**: 在極短時間內創建巨大的巢狀物件陣列並立即拋棄指標，強制觸發 JavaScript 引擎的垃圾回收 (GC) 機制，測試記憶體吞吐與卡頓抵抗力。

### 4. DOM 佈局重繪 (DOM)

- **技術**: `Layout Thrashing (強制同步佈局)`
- **原理**: 生成帶有深度的 HTML 結構，寫入內聯 CSS 後立即讀取 `offsetHeight`，強迫瀏覽器中斷渲染線程進行版面重算，測量最真實的渲染開銷。

### 5. 全螢幕 3D 渲染 (GPU)

- **技術**: `Three.js` / `WebGL InstancedMesh` / `Phong Material`
- **原理**: 進入全螢幕 3D 測試艙，同時渲染 **100,000 個** 具備獨立矩陣、動態旋轉、且受即時點光源影響的多面體，榨取高階顯卡效能。

### 6. 網路吞吐量 (Network)

- **技術**: `Parallel Fetch API`
- **原理**: 向 Cloudflare 專用測速端點發起多線程無上限並發請求 (瞬間流量需求 > 100MB)，並透過 OQC 校準公式還原 L1/L2 物理層的真實 Gigabit 帶寬。

## 📊 OQC 最終校準計分系統

YieldVitals Pro 內建專為現代硬體校準的對數計分演算法 (Logarithmic Scoring) 與天梯系統。

- **動態天梯圖**: 將測試結果即時投影至視覺化比例尺，與「舊款文書機」、「主流行動裝置」、「高階創作者筆電」及「旗艦級工作站」進行直觀對比。
- **動態權重**: 總分 = `(CPU * 35%)` + `(GPU * 35%)` + `(DOM/RAM * 15%)` + `(NET * 15%)`
- **高階鑑別度**: 拔高各項指標滿分天花板，確保未來的 M3/M4 Max 或更強硬體依然具備測試意義。

## 🚀 部署指南 (Deployment)

本專案設計為 **100% 純前端單頁應用程式 (Single Page Application)**，無須任何後端伺服器或資料庫支援。

### 透過 GitHub Pages 部署 (最快方法)

1. **Fork** 或是 clone 這個 repository 到你的 GitHub 帳號。
2. 前往 repository 的 **Settings** > **Pages**。
3. 在 `Source` 區塊選擇 `Deploy from a branch`。
4. 將 branch 設定為 `main` (或 `master`) 的 `/(root)` 資料夾，點擊 **Save**。
5. 等待 1-2 分鐘，你的 YieldVitals Pro 廠測平台就上線了！

### 本地端測試

只需將 `index.html` 下載，並使用任何本地伺服器開啟 (因使用 Web Worker，建議使用 Live Server 等工具，避免 `file://` 協議的跨域問題)。

```
# 例如使用 Python 內建伺服器
python -m http.server 8000
```

然後打開瀏覽器前往 `http://localhost:8000` 即可體驗。

## 🛠️ 開發與技術棧

- **結構**: HTML5 (單一檔案結構)
- **樣式**: Tailwind CSS (透過 CDN 即時編譯)
- **腳本**: Vanilla JavaScript (ES6+)
- **視覺化**: Chart.js (雷達圖)
- **3D 引擎**: Three.js (WebGL 渲染)

## 📝 免責聲明

本網頁提供之效能評測數據僅供參考。實際運作效能可能因當下背景程式、網路波動、設備散熱狀態 (Thermal Throttling) 及瀏覽器版本而有所差異。測試結果不應作為任何硬體選購之唯一絕對依據。

*Developed with rigorous factory standards by Quality Control Engineering.*
