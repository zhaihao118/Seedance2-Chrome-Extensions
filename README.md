# Seedance 2.0 批量生成工具

使用 Playwright 自动化即梦AI (Jimeng) Seedance 2.0 批量添加参考图并生成视频。

## 目录结构

```
├── images/                    # 放置参考图片（JPG/PNG/WEBP）
├── playwright/
│   ├── config.js              # 配置文件（预设参数、延迟等）
│   ├── helpers.js             # 辅助函数
│   ├── login.js               # 首次登录脚本
│   ├── inspect.js             # DOM检查脚本（调试用）
│   ├── batch.js               # 主批量生成脚本
│   ├── user-data/             # 浏览器登录数据（自动生成）
│   └── screenshots/           # 调试截图（自动生成）
├── package.json
└── README.md
```

## 使用步骤

### 1. 安装依赖

```bash
npm install
npx playwright install chromium
```

### 2. 首次登录

```bash
npm run login
```

浏览器会打开即梦AI页面，手动完成登录后**关闭浏览器窗口**，session 会自动保存。之后运行批量脚本时将复用此 session。

### 3. 准备图片

将参考图片（JPG/PNG/WEBP）放入 `images/` 目录。

### 4. 修改配置（可选）

编辑 `playwright/config.js`：

```js
module.exports = {
  preset: {
    model: 'Seedance 2.0',       // 模型
    referenceMode: '全能参考',    // 参考模式
    aspectRatio: '9:16',          // 画面比例
    duration: '10s',              // 视频时长
    speed: 'Fast',                // 生成速度
  },
  prompt: '你的提示词',           // 所有任务共用
  taskDelay: 3000,                // 任务间隔（ms）
  // ...更多选项见配置文件
};
```

### 5. 运行批量生成

```bash
npm run batch
```

### 6. 调试DOM（可选）

如果自动化操作失败，运行 inspect 脚本检查页面元素：

```bash
npm run inspect
```

会输出页面中的按钮、上传控件、文本输入框等关键元素信息，以及完整的 HTML snapshot。

## 可用命令

| 命令 | 说明 |
|------|------|
| `npm run login` | 打开浏览器登录即梦AI，保存session |
| `npm run inspect` | 检查页面DOM结构（调试用） |
| `npm run batch` | 执行批量生成任务 |

## 常见问题

**Q: 提示"需要登录"**
A: 运行 `npm run login` 重新登录

**Q: 找不到上传入口/生成按钮**
A: 即梦AI页面可能更新了DOM结构。运行 `npm run inspect` 查看当前页面元素，然后更新 `playwright/batch.js` 中的选择器。

**Q: 上传太快被限制**
A: 增大 `config.js` 中的 `taskDelay` 和 `uploadWait` 值。

**Q: 需要更换登录账号**
A: 删除 `playwright/user-data/` 目录，重新运行 `npm run login`。
