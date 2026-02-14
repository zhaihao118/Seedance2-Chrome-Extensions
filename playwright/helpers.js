// playwright/helpers.js - 页面操作辅助函数
const fs = require('fs');
const path = require('path');

/**
 * 等待指定毫秒
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 安全截图 - 出错时不中断流程
 */
async function safeScreenshot(page, name, config) {
  if (!config.screenshots.enabled) return;
  try {
    const dir = config.screenshots.dir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${Date.now()}-${name}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    console.log(`  📸 截图: ${filePath}`);
  } catch (e) {
    console.warn(`  ⚠️ 截图失败: ${e.message}`);
  }
}

/**
 * 查找包含指定文本的元素并点击
 * @param {import('playwright').Page} page
 * @param {string} text - 要匹配的文本
 * @param {object} options
 * @returns {boolean} 是否成功点击
 */
async function clickByText(page, text, options = {}) {
  const { exact = false, timeout = 5000, index = 0 } = options;

  try {
    const locator = exact
      ? page.getByText(text, { exact: true })
      : page.getByText(text);

    if (index > 0) {
      await locator.nth(index).click({ timeout });
    } else {
      await locator.first().click({ timeout });
    }
    console.log(`  ✅ 点击: "${text}"`);
    return true;
  } catch (e) {
    console.warn(`  ⚠️ 未找到文本 "${text}": ${e.message}`);
    return false;
  }
}

/**
 * 查找包含指定文本的按钮并点击
 */
async function clickButton(page, text, options = {}) {
  const { timeout = 5000 } = options;
  try {
    const btn = page.getByRole('button', { name: text });
    await btn.first().click({ timeout });
    console.log(`  ✅ 点击按钮: "${text}"`);
    return true;
  } catch (e) {
    // Fallback: try any clickable element with the text
    return clickByText(page, text, options);
  }
}

/**
 * 等待元素出现
 */
async function waitForText(page, text, timeout = 10000) {
  try {
    await page.getByText(text).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取images目录下的所有图片文件
 */
function getImageFiles(imagesDir) {
  if (!fs.existsSync(imagesDir)) {
    console.error(`❌ 图片目录不存在: ${imagesDir}`);
    return [];
  }

  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  const files = fs.readdirSync(imagesDir)
    .filter(f => exts.includes(path.extname(f).toLowerCase()))
    .sort()
    .map(f => path.join(imagesDir, f));

  return files;
}

/**
 * 在页面中查找 file input 并上传文件
 */
async function uploadViaFileInput(page, filePath, options = {}) {
  const { timeout = 5000 } = options;

  try {
    // 方法 1: 查找 accept 包含 image 或 video 的文件 input
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout });
    await fileInput.setInputFiles(filePath);
    console.log(`  ✅ 文件上传: ${path.basename(filePath)}`);
    return true;
  } catch (e) {
    console.warn(`  ⚠️ 文件上传失败: ${e.message}`);
    return false;
  }
}

/**
 * 通过文件选择器上传（点击触发 -> 拦截对话框 -> 设置文件）
 */
async function uploadViaFileChooser(page, clickTarget, filePath, options = {}) {
  const { timeout = 5000 } = options;

  try {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout }),
      clickTarget.click(),
    ]);
    await fileChooser.setFiles(filePath);
    console.log(`  ✅ 文件选择器上传: ${path.basename(filePath)}`);
    return true;
  } catch (e) {
    console.warn(`  ⚠️ 文件选择器上传失败: ${e.message}`);
    return false;
  }
}

module.exports = {
  sleep,
  safeScreenshot,
  clickByText,
  clickButton,
  waitForText,
  getImageFiles,
  uploadViaFileInput,
  uploadViaFileChooser,
};
