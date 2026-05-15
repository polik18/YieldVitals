# 📊 YieldVitals V1.0 | 廠測級網頁效能評測與硬體診斷平台

> **YieldVitals V1.0 是一款專為現代硬體打造的「廠測級」網頁效能與硬體診斷工具。不僅打破傳統跑分盲區，採用 Web Worker 多核心叢集與 WebGL 底層探測技術，更全新導入 8 軸全方位檢測 (包含本機 I/O 存取、加密吞吐等)。搭配「專家級硬體診斷建議」，能直接點出設備的效能瓶頸，提供具體的升級方案，為開發者、QA 與 PC DIY 玩家提供最嚴苛、真實且具建設性的檢驗報告。**

## 🛑 為什麼需要 YieldVitals V1.0？(解決傳統測試盲區)

傳統的 Web Benchmark 工具在面對現代設備時，往往因為瀏覽器沙盒限制與演算法缺陷而產生誤判，甚至無法給予使用者改善建議。YieldVitals V1.0 針對以下致命問題進行了**底層架構升級**：

1. **單線程限制 (Single-Threaded Bias)**: 突破 JS 單執行緒限制，自動偵測實體核心數並派發對應的 Web Worker 叢集，真實榨乾多核 CPU 算力。
2. **淺層評估 (Lack of I/O & Crypto)**: 傳統跑分忽略了日益重要的加密與硬碟讀寫。本平台導入 Web Crypto API 與 OPFS (Origin Private File System) 本機存取測試，精準反映 SSD 讀寫與安全運算能力。
3. **黑箱規格 (Blackbox Environment)**: 傳統網頁無法得知真實硬體規格。導入 WebGL 探測技術 (`WEBGL_debug_renderer_info`)，能穿透瀏覽器直接抓取底層真實 GPU 型號，並結合記憶體、核心數與解析度探測，讓跑分對應真實硬體。
4. **無效的建議 (Lack of Actionable Advice)**: 跑分不再只是冷冰冰的數字。內建「專家診斷引擎」，能針對行動裝置 (手機/平板) 與桌面端 (PC/筆電) 區分情境，自動分析瓶頸並給出如「加裝實體記憶體」、「更換 NVMe SSD」、「加裝獨立顯卡」等具體改善方針。

## ⚙️ 核心測試模組 (8-Axis Core Modules)

本工具包含八大深度測試引擎，全面評估設備體質：

### 1. 邏輯運算 (CPU)
- **技術**: `Web Worker Clusters`
- **原理**: 根據設備核心數動態平行化，執行密集亂數生成與平方根矩陣運算。

### 2. 字串解析 (String)
- **技術**: `JSON.parse` & `RegEx RegExp`
- **原理**: 模擬前端框架處理龐大 JSON 狀態，測試 V8 引擎處理巢狀物件的極限速度。

### 3. 加密吞吐 (Crypto)
- **技術**: `Web Crypto API (AES-GCM)`
- **原理**: 產生亂數 Initialization Vector 並高頻加解密，測試硬體加速加密指令集支援度。

### 4. 記憶體分配與回收 (RAM)
- **技術**: `Garbage Collection Thrashing`
- **原理**: 在極短時間內創建巨大的巢狀物件陣列並拋棄指標，測試記憶體吞吐與 GC 卡頓抵抗力。

### 5. 本機存取 (Storage)
- **技術**: `OPFS (Origin Private File System)` / `IndexedDB`
- **原理**: 模擬大檔案寫入本機硬碟，繞過快取直接測試 SSD/UFS 快閃記憶體的真實寫入 I/O 速度。

### 6. 網路下載 (Network)
- **技術**: `Fetch API`
- **原理**: 向高效能邊緣節點拉取大容量測試檔案，測試實體網路下行頻寬。

### 7. DOM 佈局重繪 (DOM)
- **技術**: `Layout Thrashing`
- **原理**: 測量複雜 HTML 結構與內聯 CSS 讀寫時的真實渲染開銷。

### 8. 全螢幕圖形渲染 (GPU)
- **技術**: `Three.js` / `WebGL InstancedMesh`
- **原理**: 渲染十萬級實體與動態光影，榨取高階獨立顯卡與行動 GPU 的 ALU 吞吐量。

## 📊 V1.0 專家診斷與報告系統

- **自動化硬體探測**: 自動抓取 OS、GPU Renderer、RAM 容量與螢幕解析度，不再顯示無用的 Browser UserAgent 代碼。
- **裝置適配性評估**: 根據綜合跑分，將設備能力具象化為「一般網頁瀏覽」、「多分頁工作」、「Web 3D 應用」與「重型網頁工具」的適配等級。
- **效能瓶頸分析**: 找尋雷達圖上的短板，並針對手機/PC 給予實務上的「專家診斷建議」。
- **一鍵匯出報告**: 支援一鍵複製純文字規格報告，以及下載完整的 JSON 原始數據。

## 🌐 支援 30 國語系無縫切換 (I18N)

- **全方位在地化**: 涵蓋繁中、簡中、英文、日文、韓文、法文、德文、西班牙文、阿拉伯文等 30 種主要語言。
- **動態替換技術**: 不論是介面上的靜態說明、動態的狀態回報 (如：測試進行中)，或是最後匯出的**診斷報告與專家建議**，都會根據選定的語系自動切換。
- **Local File 友善**: 突破傳統 CORS 限制，內建打包好的 `locales.js` 字典庫。就算直接雙擊開啟 `index.html` (本地 `file://` 協定)，也能完美載入語系，無須架設 Local Server。

## 🚀 部署指南 (Deployment)

本專案設計為 **100% 純前端單頁應用程式 (Single Page Application)**，無須任何後端伺服器或資料庫支援。

### 透過 GitHub Pages 部署 (最快方法)

1. **Fork** 或是 clone 這個 repository 到你的 GitHub 帳號。
2. 前往 repository 的 **Settings** > **Pages**。
3. 在 `Source` 區塊選擇 `Deploy from a branch`。
4. 將 branch 設定為 `main` (或 `master`) 的 `/(root)` 資料夾，點擊 **Save**。
5. 等待 1-2 分鐘，你的 YieldVitals V1.0 廠測平台就上線了！

### 本地端測試

**免環境、隨開即用**！本專案採用 `locales.js` 打包語系，直接雙擊 `index.html` 即可在瀏覽器中開啟測試 (支援 `file://` 協議)，並完美體驗 30 國語系切換與完整測試流程，不需架設任何 Local Server。

如果希望以 HTTP 方式開啟，也可以使用 Python 內建伺服器：
```bash
# 使用 Python 內建伺服器
python -m http.server 8000
```
然後打開瀏覽器前往 `http://localhost:8000` 即可。

## 🛠️ 開發與技術棧

- **結構**: HTML5 (單一檔案結構)
- **樣式**: Tailwind CSS (透過 CDN 即時編譯)
- **腳本**: Vanilla JavaScript (ES6+ / Web Worker)
- **視覺化**: Chart.js (8 軸雷達圖)
- **3D 引擎**: Three.js (WebGL 渲染)

## 📝 免責聲明

本網頁提供之效能評測數據與專家建議僅供參考。實際運作效能可能因當下背景程式、網路波動、設備散熱狀態 (Thermal Throttling) 及瀏覽器底層支援度而有所差異。硬體升級建議為通用型參考，升級前請詳閱設備說明書或諮詢原廠。

*Developed with rigorous factory standards by Quality Control Engineering.*
