// playwright/config.js - 配置文件
module.exports = {
  // 即梦AI页面URL
  pageUrl: 'https://jimeng.jianying.com/ai-tool/home',

  // 用户数据目录 - 保存登录状态，避免每次重新登录
  // 首次运行时会打开浏览器让你手动登录，之后会复用session
  userDataDir: './playwright/user-data',

  // 参考图片目录
  imagesDir: './images',

  // 预设参数
  preset: {
    model: 'Seedance 2.0',       // 模型名称
    referenceMode: '首尾帧',      // 参考模式: 全能参考 / 首尾帧 / 智能多帧 / 主体参考
    aspectRatio: '16:9',          // 画面比例: 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16
    duration: '5s',               // 视频时长: 4s ~ 15s
  },

  // 提示词（所有任务共用，留空则不填写）
  prompt: '',

  // 任务间隔（毫秒）- 每个生成任务之间的等待时间
  taskDelay: 3000,

  // 操作间隔（毫秒）- 页面内每步操作之间的等待时间
  stepDelay: 800,

  // 上传后等待时间（毫秒）- 等待图片上传完成
  uploadWait: 2000,

  // 生成后等待时间（毫秒）- 等待生成任务提交
  generateWait: 3000,

  // 浏览器设置
  browser: {
    headless: process.env.HEADLESS !== 'false',  // 默认headless，设 HEADLESS=false 可显示浏览器
    slowMo: 100,                  // 每个操作之间的延迟（毫秒），方便观察
    viewport: { width: 1440, height: 900 },
  },

  // 截图设置（调试用）
  screenshots: {
    enabled: true,                // 是否在关键步骤截图
    dir: './playwright/screenshots',
  },
};
