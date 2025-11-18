# 线上打分系统 (Online Scoring System)

这是一个轻量级、功能完整的全栈线上打分系统。它允许管理员设置比赛、导入选手和评分标准，并让大众评委通过链接实时为选手打分。后台会自动统计排名。

该项目采用前后端分离的开发模式和一体化部署策略。

## ✨ 主要功能

- **后台管理**:
  - **选手管理**: 支持 Excel 批量导入和手动增删改查。
  - **评分项管理**: 支持多“评分组”（如不同赛道），并可在组内对评分项进行增删改查和 Excel 批量导入。
  - **实时评分控制**: 管理员可以精确控制当前开放评分的选手，并实时查看各组排名。
  - **数据管理**: 可一键重置某位选手的全部评分数据。
- **评委端**:
  - **实时同步**: 评委页面自动同步管理员的指令，只显示当前可评分的选手。
  - **便捷打分**: 简洁的界面，使用滑块进行打分。
  - **允许修改**: 在评分通道开放期间，评委可以刷新页面修改自己的评分。
  - **打分记录**: 评委可以随时查看自己为所有选手打出的历史分数。

## 🚀 技术栈

- **后端**: Node.js + Express + SQLite3
- **前端**: Vue 3 + Vite + Element Plus
- **核心库**: `xlsx` (用于解析Excel), `express-session` (用于会话管理)
- **部署**: Render.com (免费 Web Service)

## 🔧 本地开发与运行

您需要分别启动前端和后端两个服务。

### 1. 启动后端服务

> **前置要求**: 已安装 [Node.js](https://nodejs.org/) (v16+)。

```bash
# 进入后端项目目录
cd scoring-system-backend

# 安装依赖 (首次运行时需要)
npm install

# 启动服务器
# 服务器将运行在 http://localhost:3000
node index.js
```
启动后，后端项目会在根目录下自动创建一个 `scoring.db` 文件作为数据库。

### 2. 启动前端服务

> **前置要求**: 同样需要 Node.js。

```bash
# 在另一个终端中，进入前端项目目录
cd vite-project

# 安装依赖 (首次运行时需要)
npm install

# 启动开发服务器
# 前端页面将运行在 http://localhost:5173 (或其他可用端口)
npm run dev
```

### 3. 访问系统

- **后台管理页面**: [http://localhost:5173/](http://localhost:5173/)
- **评委打分页面**: [http://localhost:5173/judge](http://localhost:5173/judge)

---

## ☁️ 线上部署 (一体化部署方案)

本项目采用后端托管前端静态文件的一体化策略进行部署，以避免跨域问题。

### 1. 修改前端 API 地址

在部署前，必须将前端请求后端的地址改为相对路径。

- 打开 `vite-project/src/utils/request.js` 文件，确认 `baseURL` 为 `/api`。
- 打开 `vite-project/src/views/` 下所有包含 `<el-upload>` 的文件，确认其 `action` 属性也为相对路径 (如 `/api/players/import`)。

### 2. 打包前端项目

在前端项目 (`vite-project`) 目录下运行：
```bash
npm run build
```
这会在 `vite-project` 目录下生成一个 `dist` 文件夹。

### 3. 准备后端项目

- **将 `dist` 文件夹移动到后端**: 将上一步生成的 `dist` 文件夹，**整个复制**到 `scoring-system-backend` 项目的根目录下。
- **配置 `.gitignore`**: 确保后端项目的 `.gitignore` 文件包含以下内容，以避免将不必要的文件上传到 Git 仓库：
  ```
  /node_modules
  /uploads
  *.db
  *.log
  ```

### 4. 推送到 GitHub

在后端项目 (`scoring-system-backend`) 目录下，执行 Git 命令将代码推送到您的 GitHub 仓库：
```bash
git add .
git commit -m "Prepare for deployment"
git push origin main
```

### 5. 在 Render.com 上部署

1.  登录 [Render.com](https://render.com/)，选择 **New+ > Web Service**。
2.  连接您的 GitHub 仓库。
3.  填写以下配置：
    - **Name**: `your-app-name` (自定义)
    - **Root Directory**: (保持空白)
    - **Runtime**: `Node`
    - **Build Command**: `npm install`
    - **Start Command**: `node index.js`
    - **Plan**: `Free`
4.  点击 **Create Web Service**，等待部署完成即可。

---

## 📝 使用说明

1.  **设置评分标准**:
    - 访问后台的“评分项设置”页面。
    - “新增组”或“导入”来创建评分组（赛道）。
    - 选中一个组后，在右侧“添加评分项”或“导入”。
2.  **录入选手**:
    - 访问“选手管理”页面。
    - 通过“批量导入”(Excel) 或“手动录入”来添加选手。
3.  **开始比赛**:
    - 访问“评分控制台”页面。
    - 在右上角下拉框中，选择本次比赛要使用的“评分组”。
    - 在左侧列表中，点击选手的“开始评分”按钮。
4.  **评委打分**:
    - 评委通过 `/judge` 链接进入页面，即可为当前选手打分。
5.  **查看排名**:
    - 管理员可以在“评分控制台”右侧实时查看所选评分组的排名情况。
