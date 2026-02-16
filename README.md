# Seedance 2.0 批量生成助手

> Chrome 扩展 + Mock Server，在即梦AI (jimeng.jianying.com) 页面上实现**批量视频生成**的全流水线自动化。

**版本**: v1.3.0 | **运行环境**: Chrome / Chromium + Node.js

---

## 功能概览

- **侧边抽屉面板** — 点击扩展图标即可打开，不遮挡即梦主界面
- **接收任务模式** — 通过 SSE 长连接从 Mock Server 实时接收任务，自动配置参数并提交生成
- **手动提交模式** — 拖拽/选择参考图，填写提示词，一键提交
- **全流水线自动化** — pending → configuring → generating → uploading → upscaling → uploading_hd → completed
- **@mention 引用** — 自动通过 ProseMirror API 插入参考图 mention 节点
- **视频检索下载** — 在页面历史记录中按 taskCode 检索生成结果，支持预览和下载
- **文件预览** — 👁 预览上传的参考图/视频
- **Mock Server** — 内置任务管理服务器，提供 Admin 管理页面和文件管理页面

---

## 目录结构

```
├── manifest.json              # Chrome 扩展清单 (MV3)
├── background.js              # Service Worker: 图标点击、消息中继
├── content.js                 # Content Script (ISOLATED): DOM 操作、上传、视频检索
├── mention-main-world.js      # Content Script (MAIN): ProseMirror @mention 插入
├── panel.html / panel.js      # 侧边抽屉面板 UI 和逻辑
├── popup.html / popup.js      # 弹出窗口 (备用)
├── mock-server.js             # Mock 任务 API 服务器 (Node.js)
├── admin.html                 # 任务管理页面 (由 mock-server 提供)
├── files.html                 # 文件管理页面 (由 mock-server 提供)
├── icon48.png / icon128.png   # 扩展图标
├── images/                    # 参考图片目录
├── uploads/                   # 上传文件存储 (自动生成)
├── data/                      # 持久化数据 (tasks.json, files.json)
├── playwright/
│   ├── config.js              # Playwright 配置
│   ├── helpers.js             # 辅助函数
│   ├── login.js               # 首次登录脚本
│   ├── batch.js               # 批量生成脚本
│   ├── test-extension.js      # 扩展测试脚本
│   ├── user-data/             # 浏览器登录数据 (自动生成)
│   └── screenshots/           # 调试截图 (自动生成)
└── package.json
```

---

## 快捷启动

> 一行命令完成 Mock Server + 浏览器的启动。

### Windows (PowerShell)

```powershell
cd e:\projects\rytesa.ai\chrome-extension-seedance2

# 1. 清理残留进程
Get-Process -Name "node","chrome","chromium" -ErrorAction SilentlyContinue | Stop-Process -Force 2>$null; Start-Sleep -Seconds 3

# 2. 启动 Mock Server (后台)
Start-Process -NoNewWindow node -ArgumentList "mock-server.js"

# 3. 等待 Server 就绪后启动浏览器
Start-Sleep -Seconds 2
node -e "
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const extPath = path.resolve('.');
  const userDataDir = path.resolve('./playwright/user-data');
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      '--disable-extensions-except=' + extPath,
      '--load-extension=' + extPath,
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://jimeng.jianying.com/ai-tool/image/generate');
  console.log('Page loaded. Browser running...');
  const adminPage = await ctx.newPage();
  await adminPage.goto('http://localhost:3456/admin');
  console.log('Admin page opened.');
  await new Promise(() => {});
})();
"
```

### npm 命令

```bash
npm run mock      # 启动 Mock Server (端口 3456)
npm run login     # 首次登录，保存 session
npm run batch     # 执行 Playwright 批量生成
npm run inspect   # 检查页面 DOM 结构 (调试)
```

---

## 启动手册

### 前置条件

1. **Node.js** >= 18
2. **Playwright Chromium** 浏览器

### 第一步：安装依赖

```bash
npm install
npx playwright install chromium
```

### 第二步：首次登录

```bash
npm run login
```

浏览器打开即梦AI页面后，手动完成登录，然后**关闭浏览器**。session 会保存到 `playwright/user-data/`，后续复用。

### 第三步：启动 Mock Server

```bash
npm run mock
# 或
node mock-server.js
```

服务器启动后可访问：
- `http://localhost:3456/admin` — 任务管理面板 (推送任务、查看状态)
- `http://localhost:3456/files` — 文件管理页面 (查看上传的视频/截图)
- `http://localhost:3456/api/config` — API 配置信息

### 第四步：启动带扩展的浏览器

使用 Playwright 启动 Chromium 并加载扩展：

```bash
node -e "
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const extPath = path.resolve('.');
  const userDataDir = path.resolve('./playwright/user-data');
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      '--disable-extensions-except=' + extPath,
      '--load-extension=' + extPath,
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://jimeng.jianying.com/ai-tool/image/generate');
  console.log('Browser running...');
  await new Promise(() => {});
})();
"
```

### 第五步：打开抽屉面板

在即梦AI页面上**点击扩展图标**，侧边抽屉面板自动展开。

面板启动时会自动：
1. 连接 SSE (`http://localhost:3456`)
2. 启动流水线自动执行

---

## 使用手册

### 一、接收任务模式 (Tab: 📡 接收任务)

这是主要的批量生成模式，通过 Mock Server 下发任务。

#### 工作流程

1. 在 Admin 页面 (`http://localhost:3456/admin`) 创建并推送任务
2. 扩展通过 SSE 长连接实时收到任务通知
3. 自动拉取任务到本地队列
4. 流水线按顺序执行每个任务：
   - **configuring** — 配置参数 (模型、参考模式、比例、时长)
   - **generating** — 上传参考图 + 填写提示词 + 点击生成
   - **uploading** — 等待视频生成完成，截图上传标清视频到服务器
   - **upscaling** — 点击「提升分辨率」
   - **uploading_hd** — 等待高清完成，上传高清视频
   - **completed** — 全部完成

#### 操作说明

| 操作 | 说明 |
|------|------|
| **API 地址** | 填写 Mock Server 地址 (默认 `http://localhost:3456`) |
| **📡 连接** | 建立 SSE 长连接，实时接收任务通知 |
| **🔄 拉取任务** | 手动从服务器拉取待处理任务 |
| **▶ 自动执行** | 启动流水线自动循环 (启动时默认开启) |
| **任务间隔** | 两个任务之间的等待时间 (秒) |

#### Admin 推送任务

打开 `http://localhost:3456/admin`：

1. 填写 **任务编号** (如 `TASK-001`)、**提示词**
2. 上传 **参考图片** (多张)
3. 选择模型配置 (模型、参考模式、比例、时长)
4. 勾选 **真实提交** (否则为模拟模式，不点击生成按钮)
5. 点击 **推送任务**

### 二、手动提交模式 (Tab: ✏️ 手动提交)

不依赖 Mock Server，直接在面板中操作。

#### 操作步骤

1. **设置预设参数** — 点击 ⚙️ 编辑: 模型、参考模式、画面比例、视频时长
2. **上传参考图** — 拖拽或点击上传区，支持 JPG/PNG/WEBP/MP4，最多 30 个文件
3. **填写提示词** — 在文本框中输入 (可选)
4. **应用预设** — 点击「🔧 应用预设」在即梦页面上设定参数
5. **上传+填词** — 点击「📤 上传+填词」将文件和提示词填入即梦
6. **提交生成** — 点击「🚀 提交生成」触发即梦的生成按钮

#### 视频检索与下载

1. 输入 **TaskCode** (提示词中包含的任务编号)
2. 点击 **🔍 检索视频** — 在页面历史记录中查找匹配的视频
3. 找到后可预览、下载、截图上传到服务器

### 三、任务列表 (Tab: 📋 任务列表)

查看所有已接收的任务及其状态：

| 状态 | 含义 |
|------|------|
| 🟡 待处理 | 等待执行 |
| ⚙️ 配置中 | 正在设置参数 |
| 🎬 生成中 | 已提交，等待视频生成 |
| 📤 上传标清 | 视频完成，正在上传 |
| 🔺 提升中 | 正在提升分辨率 |
| 📤 上传高清 | 高清完成，正在上传 |
| ✅ 已完成 | 全流程完成 |
| ❌ 失败 | 出错 |

每个任务卡片可以单独操作：**执行**、**跳过**、**重试**。

---

## API 接口

Mock Server (`http://localhost:3456`) 提供以下接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks/pending?clientId=xxx` | 获取并占用待处理任务 |
| POST | `/api/tasks/ack` | 确认接收任务 |
| POST | `/api/tasks/status` | 更新任务状态 |
| GET | `/api/tasks/release?taskCode=xxx` | 释放占用的任务 |
| GET | `/api/events?clientId=xxx` | SSE 长连接 (实时推送) |
| POST | `/api/tasks/push` | 推送新任务 |
| GET | `/api/config` | 获取配置信息 |
| GET | `/api/files` | 获取已上传文件列表 |
| POST | `/api/upload` | 上传文件 (multipart/form-data) |
| GET | `/admin` | 任务管理页面 |
| GET | `/files` | 文件管理页面 |

---

## 可用命令

| 命令 | 说明 |
|------|------|
| `npm run mock` | 启动 Mock Server (端口 3456) |
| `npm run login` | 打开浏览器登录即梦AI，保存 session |
| `npm run batch` | 执行 Playwright 批量生成 |
| `npm run inspect` | 检查页面 DOM 结构 (调试) |

---

## 常见问题

**Q: 打开抽屉面板显示「未连接」**
A: 确认 Mock Server 已启动 (`npm run mock`)，API 地址填写正确 (默认 `http://localhost:3456`)

**Q: 提示「内容脚本未就绪」**
A: 请确保当前在即梦AI页面 (`jimeng.jianying.com`)。刷新页面后等待几秒再试。

**Q: 任务一直停在「生成中」**
A: 检查即梦页面上视频是否仍在生成。流水线每 10 秒轮询一次状态。超时时间为 10 分钟。

**Q: 提示「需要登录」**
A: 运行 `npm run login` 重新登录，或在浏览器中手动登录即梦。

**Q: 需要更换登录账号**
A: 删除 `playwright/user-data/` 目录，重新运行 `npm run login`。

**Q: Mock Server 端口被占用**
A: 终止占用端口的进程: `Get-Process -Name node | Stop-Process -Force`，然后重新启动。

**Q: 上传太快被限制**
A: 增大面板中的「任务间隔」，或在 `playwright/config.js` 中调整 `taskDelay`。

---

## 技术架构

```
┌─────────────────────────────┐
│     Mock Server (:3456)     │
│  - SSE 推送                 │
│  - 任务管理 API             │
│  - 文件存储                 │
└──────────┬──────────────────┘
           │ SSE / HTTP
┌──────────▼──────────────────┐
│    Chrome Extension (MV3)    │
│  ┌─────────────────────┐    │
│  │   background.js     │    │  Service Worker
│  │   (消息中继/图标)    │    │
│  └──────────┬──────────┘    │
│  ┌──────────▼──────────┐    │
│  │   panel.js (iframe) │    │  扩展页面 (完整 API 权限)
│  │   - SSE 连接        │    │
│  │   - 流水线控制      │    │
│  │   - 任务队列        │    │
│  └──────────┬──────────┘    │
│  ┌──────────▼──────────┐    │
│  │   content.js        │    │  ISOLATED world
│  │   - DOM 操作        │    │
│  │   - 文件上传        │    │
│  │   - 视频检索        │    │
│  └──────────┬──────────┘    │
│  ┌──────────▼──────────┐    │
│  │ mention-main-world  │    │  MAIN world
│  │   - ProseMirror API │    │
│  │   - @mention 插入   │    │
│  └─────────────────────┘    │
└─────────────────────────────┘
           │ DOM 操作
┌──────────▼──────────────────┐
│   即梦AI (jimeng.jianying)   │
│   - 视频生成页面             │
│   - ProseMirror 编辑器       │
└─────────────────────────────┘
```
