// playwright/test-access.js - 快速测试页面访问
// 不需要登录，先看页面基本结构和登录状态

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { sleep, safeScreenshot } = require('./helpers');

(async () => {
  console.log('🧪 页面访问测试');
  console.log('━'.repeat(50));

  const screenshotDir = config.screenshots.dir;
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

  // 确保user-data目录存在
  if (!fs.existsSync(config.userDataDir)) {
    fs.mkdirSync(config.userDataDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(config.userDataDir, {
    headless: true,
    viewport: config.browser.viewport,
    locale: 'zh-CN',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);

  // 收集控制台日志
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`  [console.error] ${msg.text()}`);
  });

  try {
    console.log('📄 导航到即梦AI...');
    const response = await page.goto(config.pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log(`  HTTP状态: ${response.status()}`);
    console.log(`  最终URL: ${page.url()}`);

    await sleep(3000);

    // 截图
    await page.screenshot({ path: path.join(screenshotDir, '00-initial-load.png'), fullPage: false });
    console.log(`  📸 截图已保存`);

    // 页面标题
    const title = await page.title();
    console.log(`  页面标题: ${title}`);

    // 检查是否有登录弹窗或登录按钮
    const pageInfo = await page.evaluate(() => {
      const body = document.body;
      const allText = body ? body.innerText.substring(0, 2000) : '(empty)';
      
      // 查找关键元素
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const buttonsInfo = buttons.slice(0, 20).map(b => b.textContent.trim().substring(0, 50));
      
      const inputs = Array.from(document.querySelectorAll('input'));
      const inputsInfo = inputs.map(i => ({ type: i.type, placeholder: i.placeholder, accept: i.accept }));
      
      const textareas = Array.from(document.querySelectorAll('textarea'));
      const textareasInfo = textareas.map(t => ({ placeholder: t.placeholder, rows: t.rows }));

      // 查找模态框/弹窗
      const modals = document.querySelectorAll('[class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="popup"], [class*="Popup"]');
      const modalsInfo = Array.from(modals).map(m => ({
        class: m.className.substring(0, 80),
        text: m.textContent.trim().substring(0, 100),
        visible: m.offsetParent !== null,
      }));

      return {
        pageText: allText,
        buttons: buttonsInfo,
        inputs: inputsInfo,
        textareas: textareasInfo,
        modals: modalsInfo,
        url: window.location.href,
      };
    });

    console.log('\n📋 页面分析:');
    console.log(`  URL: ${pageInfo.url}`);
    console.log(`\n  按钮 (${pageInfo.buttons.length}):`);
    pageInfo.buttons.forEach((b, i) => console.log(`    ${i + 1}. "${b}"`));

    console.log(`\n  输入框 (${pageInfo.inputs.length}):`);
    pageInfo.inputs.forEach((inp, i) => console.log(`    ${i + 1}. type=${inp.type} placeholder="${inp.placeholder}" accept="${inp.accept}"`));

    console.log(`\n  Textarea (${pageInfo.textareas.length}):`);
    pageInfo.textareas.forEach((ta, i) => console.log(`    ${i + 1}. placeholder="${ta.placeholder}"`));

    console.log(`\n  弹窗/模态框 (${pageInfo.modals.length}):`);
    pageInfo.modals.forEach((m, i) => console.log(`    ${i + 1}. visible=${m.visible} text="${m.text}" class="${m.class}"`));

    // 输出页面文本摘要（用于判断登录状态）
    console.log('\n  页面文本摘要 (前500字):');
    console.log('  ' + pageInfo.pageText.substring(0, 500).replace(/\n/g, '\n  '));

    // 等待更多内容加载
    await sleep(3000);
    await page.screenshot({ path: path.join(screenshotDir, '01-after-wait.png'), fullPage: false });

    // 检查是否被重定向到登录页
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('signin')) {
      console.log('\n⚠️  页面被重定向到登录页，需要先登录');
    }

    // 保存HTML
    const html = await page.content();
    const htmlPath = path.join(screenshotDir, 'page-snapshot.html');
    fs.writeFileSync(htmlPath, html);
    console.log(`\n💾 HTML已保存: ${htmlPath} (${(html.length / 1024).toFixed(1)}KB)`);

  } catch (err) {
    console.error('❌ 错误:', err.message);
    await page.screenshot({ path: path.join(screenshotDir, 'error.png') }).catch(() => {});
  } finally {
    await context.close();
    console.log('\n✅ 测试完成');
  }
})().catch(err => {
  console.error('❌ 致命错误:', err);
  process.exit(1);
});
