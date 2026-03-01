# AlphaDAPR - AI 繪畫心理評估系統 (GitHub Pages 版本)

基於 [AlphaDAPR](https://github.com/your-org/alpha-dapr-copilot) 的純前端版本，可部署到 GitHub Pages。

## 功能特色

- 🎨 **繪畫功能**: 在瀏覽器中繪製「雨中人」(DAPR) 心理評估圖
- 🔍 **AI 物件偵測**: 使用 ONNX Runtime Web 在瀏覽器端執行 YOLOv8 模型推論（或 placeholder 模式）
- 📊 **DAPR 評分**: 完整的 35 項 DAPR 評分系統，自動計算壓力與資源分數
- 📈 **分析儀表板**: 偵測結果視覺化、分數分布圖、相似素描、素描回放
- 💾 **本地儲存**: 所有資料存在瀏覽器 IndexedDB，無需後端伺服器
- 🚀 **免登入使用**: 開啟即可直接使用，自動建立預設使用者

## 技術架構

- **前端框架**: Vue 3 + Vite
- **UI 元件**: Element Plus (繁體中文)
- **圖表**: ECharts
- **狀態管理**: Pinia
- **本地資料庫**: IndexedDB (Dexie.js)
- **AI 推論**: ONNX Runtime Web (WebGL / WebAssembly)

## 快速開始

### 開發

```bash
npm install
npm run dev
```

### 建置

```bash
npm run build
```

### 部署到 GitHub Pages

#### 方法一：GitHub Actions 自動部署（推薦）

本專案已內建 `.github/workflows/deploy.yml`，每次 push 到 `main` branch 會自動建置並部署。

**首次設定步驟：**

1. 在 GitHub 建立 repo 並推送程式碼：
   ```bash
   git init
   git add -A
   git commit -m "Initial commit"
   gh repo create <你的帳號>/<repo名稱> --public --source=. --push
   ```

2. 啟用 GitHub Pages（選擇 GitHub Actions 作為來源）：
   ```bash
   gh api repos/<你的帳號>/<repo名稱>/pages -X POST \
     --input - <<'EOF'
   {"build_type":"workflow","source":{"branch":"main","path":"/"}}
   EOF
   ```

3. 觸發部署（push 一次即可）：
   ```bash
   git commit --allow-empty -m "Trigger deploy"
   git push origin main
   ```

4. 等待約 1-2 分鐘，即可在以下網址存取：
   ```
   https://<你的帳號>.github.io/<repo名稱>/
   ```

**之後更新：** 只要 push 到 `main`，Actions 會自動重新建置部署。

#### 方法二：手動部署 dist 到 gh-pages branch

```bash
npm run build
cd dist
git init
git checkout -b gh-pages
git add -A
git commit -m 'deploy'
git push -f git@github.com:<你的帳號>/<repo名稱>.git gh-pages
```

然後到 GitHub repo **Settings → Pages**，將 Source 設為 `gh-pages` branch。

### 使用 ONNX 模型（可選）

若要啟用真正的 YOLOv8 偵測：

1. 將 YOLOv8 模型轉換為 ONNX 格式
2. 將 `dapr.onnx` 放入 `public/models/` 目錄
3. 重新建置部署

若無 ONNX 模型，系統會使用 placeholder 偵測模式。

## 與原始版本的差異

| 功能 | 原始版本 | GitHub Pages 版本 |
|------|---------|-------------------|
| 後端 | Python FastAPI | 無（純前端 JS） |
| 資料庫 | PostgreSQL/SQLite | IndexedDB (瀏覽器) |
| AI 推論 | PyTorch (伺服器) | ONNX Runtime Web (瀏覽器) |
| 認證 | JWT + bcrypt | 免登入（自動預設使用者） |
| 部署 | Docker Compose | GitHub Pages (靜態) |

## 更新紀錄

### 2026-03-01 — 提升辨識效率與移除登入

#### 移除登入頁面
- 移除登入/註冊/登出流程，開啟即可直接使用
- 自動建立預設使用者，所有 IndexedDB 資料存取正常運作
- 移除路由 auth guard 與 `/login` 路由

#### 畫圖辨識效率提升（參照 SceneDAPR）

| 改善項目 | 說明 |
|---------|------|
| 🐛 **修正 getCenter 計算 bug** | `scoring.js` 中心點公式 `(x + w) / 2` 改為正確的 `x + w / 2`，修正所有距離與重疊判斷 |
| 🎯 **Letterbox 預處理** | 圖片縮放改為等比例縮放 + 灰色填充 (114, 114, 114)，與 SceneDAPR YOLOv8 訓練方式一致，大幅提升辨識準度 |
| ⚡ **WebGL GPU 加速** | ONNX 推論優先使用 WebGL provider，有 GPU 的裝置顯著加速；失敗時自動 fallback 至 WASM |
| 🗑️ **Canvas 記憶體優化** | 圖片來源轉換改用可重用 canvas，減少每次辨識的記憶體分配 |
| 🔄 **NMS 演算法優化** | Non-Maximum Suppression 內迴圈改為只遍歷後續索引，減少不必要的 IoU 計算 |
| 🚀 **模型預熱機制** | 新增 `warmupModel()` 函式，可在應用啟動時預先載入 ONNX 模型並執行空推論，消除首次辨識延遲 |
