// playwright/login.js - 首次登录脚本
// 用途：打开浏览器让用户手动登录即梦AI，保存session到本地
// 之后运行主脚本时会自动复用登录状态

const { chromium } = require('playwright');
const config = require('./config');
const fs = require('fs');

(async () => {
  console.log('🔐 即梦AI 登录助手');
  console.log('━'.repeat(50));
  console.log('浏览器即将打开，请手动完成登录。');
  console.log('登录成功后，关闭浏览器窗口即可保存session。\n');

  // 确保用户数据目录存在
  if (!fs.existsSync(config.userDataDir)) {
    fs.mkdirSync(config.userDataDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(config.userDataDir, {
    headless: false,
    viewport: config.browser.viewport,
    locale: 'zh-CN',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });

  const page = context.pages()[0] || await context.newPage();

  // 导航到即梦AI
  await page.goto(config.pageUrl, { waitUntil: 'domcontentloaded' });

  console.log('⏳ 等待登录... 完成后请关闭浏览器窗口。');

  // 等待浏览器被关闭
  await new Promise(resolve => {
    context.on('close', resolve);
  });

  console.log('✅ 登录session已保存到:', config.userDataDir);
  console.log('现在可以运行 npm run batch 开始批量生成了。');
})().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
