// playwright/batch.js - 主批量生成脚本
// 使用 Playwright 自动化即梦AI Seedance2.0 批量添加参考图并生成
// 基于实际DOM结构分析编写选择器

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const {
  sleep,
  safeScreenshot,
  clickByText,
  waitForText,
  getImageFiles,
} = require('./helpers');

// ============================================================
// 即梦AI页面的实际DOM选择器
// ============================================================
const SELECTORS = {
  toolbar: '[class*="toolbar-settings"]',
  toolbarContent: '[class*="toolbar-settings-content"]',
  lvSelect: '.lv-select',
  lvSelectView: '.lv-select-view',
  toolbarSelect: '[class*="toolbar-select"]',
  ratioButton: '[class*="toolbar-button"]',
  submitButton: '[class*="submit-button"]',
  submitContainer: '[class*="collapsed-submit-button-container"]:not([class*="collapsed-WjKggt"])',
  fileInput: 'input[type="file"]',
  uploadArea: '[class*="reference-upload"]',
  previewContainer: '[class*="preview-container"], [class*="image-"][src*="blob:"], img[src*="blob:"]',
  referenceGroup: '[class*="reference-group"]',
  referenceItem: '[class*="reference-item"]',
  promptTextarea: 'textarea[class*="prompt-textarea"]',
  promptTextareaAlt: 'textarea.lv-textarea',
  deleteButton: '[class*="delete"], [class*="Delete"], [class*="remove"], [class*="Remove"]',
  swapButton: '[class*="swap-button"]',
  typeSelector: '[class*="type-home-select-BUj0QG"]',
  typeSelectorDropdown: '[class*="type-home-select-dropdown"]',
  typeOption: '[class*="type-home-select-option-label"]',
  lvDropdown: '.lv-trigger-popup',
  lvOption: '.lv-select-option',
};

// ============================================================
// 主流程
// ============================================================
(async () => {
  console.log('🎬 Seedance 2.0 批量生成助手 (Playwright)');
  console.log('━'.repeat(50));

  const imagesDir = path.resolve(config.imagesDir);
  const imageFiles = getImageFiles(imagesDir);

  if (imageFiles.length === 0) {
    console.error(`❌ 在 ${imagesDir} 中未找到图片文件`);
    console.log('请将参考图片（JPG/PNG/WEBP）放入 images/ 目录后重试');
    process.exit(1);
  }

  console.log(`📁 找到 ${imageFiles.length} 张参考图片:`);
  imageFiles.forEach((f, i) => console.log(`   ${i + 1}. ${path.basename(f)}`));
  console.log();

  console.log('🚀 启动浏览器...');
  if (!fs.existsSync(config.userDataDir)) {
    fs.mkdirSync(config.userDataDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(config.userDataDir, {
    headless: config.browser.headless,
    slowMo: config.browser.slowMo,
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
  page.setDefaultTimeout(15000);

  try {
    console.log('📄 打开即梦AI生成页面...');
    await page.goto(config.pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);
    await safeScreenshot(page, '01-page-loaded', config);

    console.log('\n⚙️  切换到视频生成模式...');
    await switchToVideoGeneration(page);
    await sleep(1000);
    await safeScreenshot(page, '02-video-mode', config);

    console.log('\n⚙️  应用预设参数...');
    await applyPreset(page);
    await sleep(500);
    await safeScreenshot(page, '03-preset-applied', config);

    console.log(`\n🔄 开始批量生成 (共 ${imageFiles.length} 个任务)`);
    console.log('━'.repeat(50));

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < imageFiles.length; i++) {
      const imageFile = imageFiles[i];
      const imageName = path.basename(imageFile);
      console.log(`\n📌 任务 ${i + 1}/${imageFiles.length}: ${imageName}`);

      try {
        await processOneTask(page, imageFile, i, imageFiles.length);
        successCount++;
        console.log(`  ✅ 任务 ${i + 1} 完成`);
        await safeScreenshot(page, `task-${i + 1}-done`, config);
      } catch (err) {
        failCount++;
        console.error(`  ❌ 任务 ${i + 1} 失败: ${err.message}`);
        await safeScreenshot(page, `task-${i + 1}-error`, config);
      }

      if (i < imageFiles.length - 1) {
        console.log(`  ⏳ 等待 ${config.taskDelay / 1000}s 后继续...`);
        await sleep(config.taskDelay);
      }
    }

    console.log('\n' + '━'.repeat(50));
    console.log('📊 批量生成完成!');
    console.log(`   ✅ 成功: ${successCount}`);
    console.log(`   ❌ 失败: ${failCount}`);
    console.log(`   📁 总计: ${imageFiles.length}`);
    await safeScreenshot(page, '99-final', config);

  } catch (err) {
    console.error('\n❌ 全局错误:', err.message);
    await safeScreenshot(page, 'error-global', config);
  } finally {
    if (config.browser.headless) {
      console.log('\n(headless模式) 自动关闭浏览器...');
      await context.close();
    } else {
      console.log('\n浏览器保持打开中，手动关闭即可退出...');
      await new Promise(resolve => context.on('close', resolve));
    }
  }
})().catch(err => {
  console.error('❌ 致命错误:', err);
  process.exit(1);
});


// ============================================================
// 切换到视频生成模式
// ============================================================
async function switchToVideoGeneration(page) {
  // 先关闭可能的弹窗
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(1000);

  // 检查工具栏是否存在
  let toolbar = page.locator(SELECTORS.toolbarContent).first();
  let toolbarVisible = await toolbar.isVisible().catch(() => false);

  if (!toolbarVisible) {
    // 可能在首页，尝试点击侧边栏 "生成"
    console.log('  未检测到工具栏，尝试点击侧边栏"生成"...');
    try {
      await page.getByText('生成', { exact: true }).first().click({ timeout: 3000 });
      await sleep(2000);
    } catch (e) {
      console.warn('  侧边栏"生成"点击失败:', e.message.substring(0, 80));
    }
  }

  // 再次检查工具栏
  toolbar = page.locator(SELECTORS.toolbarContent).first();
  toolbarVisible = await toolbar.isVisible().catch(() => false);

  if (toolbarVisible) {
    // 检查当前类型
    const selects = toolbar.locator(SELECTORS.lvSelect);
    const selectCount = await selects.count();
    if (selectCount > 0) {
      const currentType = await selects.first().textContent();
      if (currentType && currentType.trim() === '视频生成') {
        console.log('  ✅ 已在视频生成模式');
        return;
      }

      // 点击类型选择器切换
      console.log(`  当前类型: "${currentType?.trim()}", 切换到视频生成...`);
      await selects.first().click();
      await sleep(500);

      const videoOption = page.locator(SELECTORS.lvOption).filter({ hasText: '视频生成' }).first();
      if (await videoOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await videoOption.click();
        console.log('  ✅ 已切换到视频生成模式');
        await sleep(2000);
        return;
      }
    }
  }

  // 备用: 使用页面顶部类型选择器
  try {
    const typeSelector = page.locator(SELECTORS.typeSelector).first();
    if (await typeSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
      await typeSelector.click();
      await sleep(500);
      const videoOption = page.locator('[class*="home-type-select-option"]').filter({ hasText: '视频生成' }).first();
      if (await videoOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await videoOption.click();
        console.log('  ✅ 已通过页面选择器切换到视频生成模式');
        await sleep(2000);
        return;
      }
    }
  } catch (e) {
    console.warn(`  ⚠️ 页面选择器切换失败: ${e.message.substring(0, 80)}`);
  }

  // 最后尝试: 点击文本
  try {
    await clickByText(page, '视频生成', { timeout: 3000 });
    console.log('  ✅ 已通过文本点击切换到视频生成模式');
    await sleep(2000);
  } catch (e) {
    console.warn(`  ⚠️ 切换视频生成模式失败: ${e.message.substring(0, 80)}`);
  }
}


// ============================================================
// 应用预设参数
// ============================================================
async function applyPreset(page) {
  const { preset } = config;

  // 查找非折叠的工具栏
  const allToolbars = page.locator(SELECTORS.toolbarContent);
  const count = await allToolbars.count();
  let toolbar = null;

  for (let i = 0; i < count; i++) {
    const tb = allToolbars.nth(i);
    const cls = await tb.getAttribute('class').catch(() => '');
    if (cls && !cls.includes('collapsed') && await tb.isVisible().catch(() => false)) {
      toolbar = tb;
      break;
    }
  }

  if (!toolbar) {
    toolbar = page.locator(SELECTORS.toolbarContent).first();
    const toolbarVisible = await toolbar.isVisible().catch(() => false);
    if (!toolbarVisible) {
      console.warn('  ⚠️ 未找到工具栏，跳过预设参数');
      return;
    }
  }

  const selects = toolbar.locator(SELECTORS.lvSelect);
  const selectCount = await selects.count();
  console.log(`  工具栏中找到 ${selectCount} 个下拉选择器`);
  // 结构: [0]=创作类型(视频生成), [1]=模型, [2]=参考模式, [3]=时长
  // [button]=画面比例

  if (selectCount > 1) {
    await selectDropdownOption(page, selects.nth(1), preset.model, '模型');
  }
  if (selectCount > 2) {
    await selectDropdownOption(page, selects.nth(2), preset.referenceMode, '参考模式');
  }
  await selectRatio(page, toolbar, preset.aspectRatio);
  if (selectCount > 3) {
    await selectDropdownOption(page, selects.nth(3), preset.duration, '时长');
  }

  console.log('  ⚙️  预设参数应用完毕');
}


// ============================================================
// 选择 lv-select 下拉选项
// ============================================================
async function selectDropdownOption(page, selectLocator, targetText, label) {
  try {
    const currentText = await selectLocator.textContent();
    if (currentText && currentText.includes(targetText)) {
      console.log(`  ✅ ${label}已是: ${targetText}`);
      return;
    }

    await selectLocator.click();
    await sleep(500);

    // 在弹出的popup中查找选项
    const option = page.locator(SELECTORS.lvOption).filter({ hasText: targetText }).first();
    const optionVisible = await option.isVisible({ timeout: 3000 }).catch(() => false);

    if (optionVisible) {
      await option.click();
      console.log(`  ✅ ${label}已选择: ${targetText}`);
    } else {
      const textOption = page.getByText(targetText, { exact: true });
      if (await textOption.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await textOption.first().click();
        console.log(`  ✅ ${label}已选择(备用): ${targetText}`);
      } else {
        console.warn(`  ⚠️ ${label}未找到选项: ${targetText}`);
        await page.keyboard.press('Escape');
      }
    }
    await sleep(300);
  } catch (e) {
    console.warn(`  ⚠️ ${label}选择失败: ${e.message}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
}


// ============================================================
// 选择画面比例
// ============================================================
async function selectRatio(page, toolbar, targetRatio) {
  try {
    const ratioBtn = toolbar.locator('[class*="toolbar-button"]').first();
    const currentText = await ratioBtn.textContent().catch(() => '');

    if (currentText && currentText.includes(targetRatio)) {
      console.log(`  ✅ 比例已是: ${targetRatio}`);
      return;
    }

    await ratioBtn.click();
    await sleep(500);

    const option = page.getByText(targetRatio, { exact: true }).first();
    if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
      await option.click();
      console.log(`  ✅ 比例已选择: ${targetRatio}`);
    } else {
      console.warn(`  ⚠️ 比例未找到选项: ${targetRatio}`);
      await page.keyboard.press('Escape');
    }
    await sleep(300);
  } catch (e) {
    console.warn(`  ⚠️ 比例选择失败: ${e.message}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
}


// ============================================================
// 处理单个生成任务
// ============================================================
async function processOneTask(page, imageFile, index, total) {
  const { stepDelay, uploadWait, generateWait } = config;

  console.log('  📎 上传参考图...');
  const uploaded = await uploadReferenceImage(page, imageFile);
  if (!uploaded) throw new Error('上传参考图失败');
  await sleep(uploadWait);

  const hasPreview = await page.locator(SELECTORS.previewContainer).first()
    .isVisible({ timeout: 3000 }).catch(() => false);
  if (hasPreview) {
    console.log('  预览图片: ✅ 已出现');
  } else {
    // 也检查swap按钮是否出现（上传成功的另一个标志）
    const hasSwap = await page.locator(SELECTORS.swapButton).first()
      .isVisible({ timeout: 1000 }).catch(() => false);
    console.log(`  预览图片: ${hasSwap ? '✅ swap按钮已出现' : 'ℹ️  未检测到预览（不影响功能）'}`);
  }

  if (config.prompt) {
    console.log('  ✏️  填写提示词...');
    await setPrompt(page, config.prompt);
    await sleep(stepDelay);
  }

  console.log('  🚀 点击生成...');
  await clickGenerate(page);
  await sleep(generateWait);

  if (index < total - 1) {
    console.log('  🧹 清除参考图...');
    await clearReferenceImage(page);
    await sleep(stepDelay);
  }
}


// ============================================================
// 上传参考图
// ============================================================
async function uploadReferenceImage(page, imageFile) {
  try {
    const fileInput = page.locator(SELECTORS.fileInput).first();
    await fileInput.waitFor({ state: 'attached', timeout: 5000 });
    await fileInput.setInputFiles(imageFile);
    console.log(`  ✅ 已上传: ${path.basename(imageFile)}`);
    return true;
  } catch (e) {
    console.warn(`  ⚠️ 直接设置文件失败: ${e.message}`);
  }

  try {
    const uploadArea = page.locator(SELECTORS.uploadArea).first();
    if (await uploadArea.isVisible()) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        uploadArea.click(),
      ]);
      await fileChooser.setFiles(imageFile);
      console.log(`  ✅ 文件选择器上传: ${path.basename(imageFile)}`);
      return true;
    }
  } catch (e) {
    console.warn(`  ⚠️ 文件选择器上传失败: ${e.message}`);
  }

  return false;
}


// ============================================================
// 填写提示词
// ============================================================
async function setPrompt(page, prompt) {
  try {
    let textarea = page.locator(SELECTORS.promptTextarea).first();
    let visible = await textarea.isVisible().catch(() => false);

    if (!visible) {
      textarea = page.locator(SELECTORS.promptTextareaAlt).first();
      visible = await textarea.isVisible().catch(() => false);
    }

    if (!visible) {
      textarea = page.locator('textarea[placeholder*="Seedance"], textarea[placeholder*="提示词"]').first();
      visible = await textarea.isVisible().catch(() => false);
    }

    if (visible) {
      await textarea.fill(prompt);
      console.log('  ✅ 提示词已填写');
    } else {
      console.warn('  ⚠️ 未找到提示词输入框');
    }
  } catch (e) {
    console.warn(`  ⚠️ 填写提示词失败: ${e.message}`);
  }
}


// ============================================================
// 点击生成按钮
// ============================================================
async function clickGenerate(page) {
  try {
    const submitBtn = page.locator('[class*="submit-button"]:not([class*="collapsed-WjKggt"])').first();
    const visible = await submitBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (visible) {
      const disabled = await submitBtn.isDisabled().catch(() => true);
      if (disabled) {
        console.warn('  ⚠️ 生成按钮当前为禁用状态（可能需要登录或添加内容）');
      }
      await submitBtn.click({ force: true });
      console.log('  ✅ 已点击生成按钮');
      return;
    }
  } catch (e) {
    console.warn(`  ⚠️ 提交按钮点击失败: ${e.message}`);
  }

  try {
    const container = page.locator(SELECTORS.submitContainer).first();
    if (await container.isVisible()) {
      const btn = container.locator('button').first();
      await btn.click({ force: true });
      console.log('  ✅ 已点击生成按钮(容器)');
      return;
    }
  } catch (e) { /* ignore */ }

  const allSubmit = page.locator('button[class*="submit"]');
  const count = await allSubmit.count();
  for (let i = 0; i < count; i++) {
    const btn = allSubmit.nth(i);
    const rect = await btn.boundingBox().catch(() => null);
    if (rect && rect.width > 20 && rect.height > 20) {
      await btn.click({ force: true });
      console.log(`  ✅ 已点击生成按钮(#${i + 1})`);
      return;
    }
  }

  console.warn('  ⚠️ 未找到可用的生成按钮');
}


// ============================================================
// 清除已上传的参考图
// ============================================================
async function clearReferenceImage(page) {
  try {
    const deleteBtn = page.locator(SELECTORS.deleteButton).first();
    if (await deleteBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await deleteBtn.click();
      console.log('  ✅ 已清除参考图 (delete)');
      return;
    }

    const closeBtn = page.locator('[class*="preview"] [class*="close"], [class*="preview"] [class*="delete"]').first();
    if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeBtn.click();
      console.log('  ✅ 已清除参考图 (close)');
      return;
    }

    const swapArea = page.locator(SELECTORS.swapButton).first();
    if (await swapArea.isVisible({ timeout: 1000 }).catch(() => false)) {
      await swapArea.hover();
      await sleep(300);
      const del = page.locator('[class*="delete"], [class*="remove"]').first();
      if (await del.isVisible({ timeout: 1000 }).catch(() => false)) {
        await del.click();
        console.log('  ✅ 已清除参考图 (hover-delete)');
        return;
      }
    }

    console.log('  ℹ️  无法找到清除按钮，尝试重新上传覆盖');
  } catch (e) {
    console.warn(`  ⚠️ 清除参考图失败: ${e.message}`);
  }
}
