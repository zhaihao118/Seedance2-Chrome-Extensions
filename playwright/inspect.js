// playwright/inspect.js - DOM 检查脚本
// 用途：打开即梦AI页面，检查DOM结构，帮助调试选择器
// 会输出页面中关键元素的信息，便于调整自动化选择器

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { sleep, safeScreenshot } = require('./helpers');

(async () => {
  console.log('🔍 即梦AI 页面 DOM 检查器');
  console.log('━'.repeat(50));

  if (!fs.existsSync(config.userDataDir)) {
    console.error('❌ 未找到登录数据，请先运行: npm run login');
    process.exit(1);
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
  page.setDefaultTimeout(15000);

  await page.goto(config.pageUrl, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  console.log('⏳ 等待页面加载...');
  await sleep(3000);

  // 检查页面元素
  console.log('\n📋 页面元素分析:');
  console.log('━'.repeat(50));

  // 1. 查找所有按钮
  const buttons = await page.evaluate(() => {
    const btns = document.querySelectorAll('button, [role="button"]');
    return Array.from(btns).map(btn => ({
      tag: btn.tagName,
      text: btn.textContent.trim().substring(0, 80),
      class: btn.className.substring(0, 100),
      disabled: btn.disabled,
    }));
  });
  console.log('\n🔘 按钮:');
  buttons.forEach((btn, i) => {
    console.log(`  ${i + 1}. [${btn.tag}] "${btn.text}" | class="${btn.class}" ${btn.disabled ? '(disabled)' : ''}`);
  });

  // 2. 查找文件输入
  const fileInputs = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="file"]');
    return Array.from(inputs).map(inp => ({
      accept: inp.accept,
      multiple: inp.multiple,
      class: inp.className,
      id: inp.id,
      hidden: inp.offsetParent === null,
    }));
  });
  console.log('\n📁 文件输入 (input[type="file"]):');
  if (fileInputs.length === 0) {
    console.log('  (未找到)');
  } else {
    fileInputs.forEach((inp, i) => {
      console.log(`  ${i + 1}. accept="${inp.accept}" multiple=${inp.multiple} hidden=${inp.hidden} class="${inp.class}" id="${inp.id}"`);
    });
  }

  // 3. 查找 textarea / contenteditable
  const textInputs = await page.evaluate(() => {
    const textareas = document.querySelectorAll('textarea');
    const editables = document.querySelectorAll('[contenteditable="true"]');
    return {
      textareas: Array.from(textareas).map(ta => ({
        placeholder: ta.placeholder,
        class: ta.className.substring(0, 80),
        rows: ta.rows,
      })),
      editables: Array.from(editables).map(ed => ({
        text: ed.textContent.trim().substring(0, 50),
        class: ed.className.substring(0, 80),
        tag: ed.tagName,
      })),
    };
  });
  console.log('\n✏️  文本输入:');
  console.log('  Textareas:');
  textInputs.textareas.forEach((ta, i) => {
    console.log(`    ${i + 1}. placeholder="${ta.placeholder}" class="${ta.class}"`);
  });
  console.log('  ContentEditable:');
  textInputs.editables.forEach((ed, i) => {
    console.log(`    ${i + 1}. [${ed.tag}] text="${ed.text}" class="${ed.class}"`);
  });

  // 4. 查找上传相关区域
  const uploadAreas = await page.evaluate(() => {
    const selectors = [
      '[class*="upload"]', '[class*="Upload"]',
      '[class*="drop"]', '[class*="Drop"]',
      '[class*="reference"]', '[class*="Reference"]',
      '[class*="添加"]',
    ];
    const results = [];
    selectors.forEach(sel => {
      const els = document.querySelectorAll(sel);
      els.forEach(el => {
        results.push({
          selector: sel,
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 60),
          class: el.className.substring(0, 100),
        });
      });
    });
    return results;
  });
  console.log('\n📤 上传相关区域:');
  uploadAreas.forEach((area, i) => {
    console.log(`  ${i + 1}. [${area.tag}] "${area.text}" | selector=${area.selector} class="${area.class}"`);
  });

  // 5. 查找关键文本元素
  const keyTexts = ['Seedance', '生成', '参考', '上传', '时长', '比例', 'Fast', '全能'];
  console.log('\n🔤 关键文本元素:');
  for (const keyword of keyTexts) {
    const count = await page.getByText(keyword).count();
    if (count > 0) {
      console.log(`  "${keyword}": 找到 ${count} 个匹配`);
      // 展示前3个
      for (let i = 0; i < Math.min(count, 3); i++) {
        const info = await page.getByText(keyword).nth(i).evaluate(el => ({
          tag: el.tagName,
          fullText: el.textContent.trim().substring(0, 80),
          class: el.className ? el.className.substring(0, 60) : '',
          parent: el.parentElement ? el.parentElement.tagName : '',
        }));
        console.log(`    ${i + 1}. [${info.tag}] "${info.fullText}" parent=${info.parent} class="${info.class}"`);
      }
    } else {
      console.log(`  "${keyword}": 未找到`);
    }
  }

  // 截图
  await safeScreenshot(page, 'inspect', config);

  // 导出完整 DOM snapshot（可选）
  const htmlPath = path.join(config.screenshots.dir || './playwright/screenshots', 'page-snapshot.html');
  const dir = path.dirname(htmlPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const html = await page.content();
  fs.writeFileSync(htmlPath, html);
  console.log(`\n💾 完整HTML已保存到: ${htmlPath}`);

  console.log('\n浏览器保持打开中，你可以用 DevTools 进一步检查。');
  console.log('关闭浏览器窗口即可退出。');

  await new Promise(resolve => context.on('close', resolve));
})().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
