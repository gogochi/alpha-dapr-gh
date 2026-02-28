# AlphaDAPR - AI 繪畫心理評估系統 (GitHub Pages 版本)

基於 [AlphaDAPR](https://github.com/your-org/alpha-dapr-copilot) 的純前端版本，可部署到 GitHub Pages。

## 功能特色

- 🎨 **繪畫功能**: 在瀏覽器中繪製「雨中人」(DAPR) 心理評估圖
- 🔍 **AI 物件偵測**: 使用 ONNX Runtime Web 在瀏覽器端執行 YOLOv8 模型推論（或 placeholder 模式）
- 📊 **DAPR 評分**: 完整的 35 項 DAPR 評分系統，自動計算壓力與資源分數
- 📈 **分析儀表板**: 偵測結果視覺化、分數分布圖、相似素描、素描回放
- 💾 **本地儲存**: 所有資料存在瀏覽器 IndexedDB，無需後端伺服器
- 🔐 **本地認證**: 基於 localStorage 的簡易認證（demo 用途）

## 技術架構

- **前端框架**: Vue 3 + Vite
- **UI 元件**: Element Plus (繁體中文)
- **圖表**: ECharts
- **狀態管理**: Pinia
- **本地資料庫**: IndexedDB (Dexie.js)
- **AI 推論**: ONNX Runtime Web (WebAssembly)

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

```bash
# 方法一: 使用 deploy script
chmod +x deploy.sh
./deploy.sh

# 方法二: 手動部署
npm run build
cd dist
git init
git checkout -b main
git add -A
git commit -m 'deploy'
git push -f git@github.com:<USERNAME>/<REPO>.git main:gh-pages
```

然後在 GitHub repo 設定中，將 Pages 來源設為 `gh-pages` branch。

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
| 認證 | JWT + bcrypt | localStorage (demo) |
| 部署 | Docker Compose | GitHub Pages (靜態) |
