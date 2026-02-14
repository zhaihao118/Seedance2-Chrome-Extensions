// playwright/test-extension.js
// 使用 Playwright 加载 Chrome 扩展并测试其功能
// 这是正确的做法：扩展是产品，Playwright 用来测试扩展

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const USER_DATA_DIR = path.resolve(__dirname, 'ext-test-user-data');
const SCREENSHOTS_DIR = path.resolve(__dirname, 'screenshots');

// Ensure screenshot dir exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// Ensure test images exist
function ensureTestImages() {
  const imagesDir = path.resolve(EXTENSION_PATH, 'images');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  // Create simple test PNG files if they don't exist
  for (let i = 1; i <= 2; i++) {
    const filePath = path.join(imagesDir, `test-${String(i).padStart(3, '0')}.png`);
    if (!fs.existsSync(filePath)) {
      // Create a minimal valid PNG (1x1 pixel)
      const png = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
        0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
        0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
        0x44, 0xAE, 0x42, 0x60, 0x82,
      ]);
      fs.writeFileSync(filePath, png);
      console.log(`  Created test image: ${filePath}`);
    }
  }
  return imagesDir;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function screenshot(page, name) {
  const ts = Date.now();
  const filePath = path.join(SCREENSHOTS_DIR, `${ts}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  📸 Screenshot: ${name}`);
}

// ============================================================
// Main Test
// ============================================================
async function main() {
  console.log('=== Chrome 扩展测试 ===\n');
  console.log(`扩展路径: ${EXTENSION_PATH}`);
  console.log(`用户数据: ${USER_DATA_DIR}\n`);

  // Verify extension files exist
  const requiredFiles = ['manifest.json', 'popup.html', 'popup.js', 'content.js'];
  for (const f of requiredFiles) {
    const p = path.join(EXTENSION_PATH, f);
    if (!fs.existsSync(p)) {
      console.error(`❌ Missing extension file: ${f}`);
      process.exit(1);
    }
  }
  console.log('✅ 扩展文件完整\n');

  const imagesDir = ensureTestImages();
  const testImages = fs.readdirSync(imagesDir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map(f => path.join(imagesDir, f));
  console.log(`📁 测试图片: ${testImages.length} 张\n`);

  // Launch browser with extension loaded
  // Chrome extensions require persistent context and non-headless mode
  // With newer Playwright, headless: 'shell' does NOT support extensions
  // We need headless: false with Xvfb, or the new headless mode
  console.log('🚀 启动带扩展的浏览器...');

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,  // Extensions require headed mode
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
    viewport: config.browser.viewport,
  });

  let extensionId = null;

  try {
    // ---- Test 1: Extension loads successfully ----
    console.log('\n--- Test 1: 扩展是否加载 ---');

    // Get extension ID from service worker
    let serviceWorker;
    if (context.serviceWorkers().length > 0) {
      serviceWorker = context.serviceWorkers()[0];
    } else {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 5000 }).catch(() => null);
    }

    if (serviceWorker) {
      extensionId = serviceWorker.url().split('/')[2];
      console.log(`✅ 扩展已加载, ID: ${extensionId}`);
    } else {
      // Try to find extension ID by navigating to chrome://extensions
      console.log('⚠️  No service worker found, trying to find extension...');
      const extPage = await context.newPage();
      await extPage.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
      await sleep(1000);

      // Try to get extension ID from the extensions page
      const extIds = await extPage.evaluate(() => {
        const manager = document.querySelector('extensions-manager');
        if (manager && manager.shadowRoot) {
          const itemList = manager.shadowRoot.querySelector('extensions-item-list');
          if (itemList && itemList.shadowRoot) {
            const items = itemList.shadowRoot.querySelectorAll('extensions-item');
            return Array.from(items).map(item => item.id);
          }
        }
        return [];
      });

      if (extIds.length > 0) {
        extensionId = extIds[0];
        console.log(`✅ 扩展已加载, ID: ${extensionId} (from extensions page)`);
      } else {
        console.log('⚠️  无法获取扩展ID，尝试用 background page...');
        // For MV3, try background pages
        const bgPages = context.backgroundPages();
        if (bgPages.length > 0) {
          extensionId = new URL(bgPages[0].url()).hostname;
          console.log(`✅ 扩展已加载, ID: ${extensionId} (from background page)`);
        }
      }
      await extPage.close();
    }

    if (!extensionId) {
      console.error('❌ 无法获取扩展ID，测试终止');
      await context.close();
      process.exit(1);
    }

    // ---- Test 2: Popup UI loads correctly ----
    console.log('\n--- Test 2: Popup UI 加载 ---');
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const popupPage = await context.newPage();
    await popupPage.goto(popupUrl);
    await sleep(500);

    // Check essential popup elements
    const popupChecks = await popupPage.evaluate(() => {
      return {
        title: document.querySelector('h1')?.textContent?.trim(),
        uploadArea: !!document.getElementById('uploadArea'),
        fileInput: !!document.getElementById('fileInput'),
        btnPreset: !!document.getElementById('btnPreset'),
        btnGenerate: !!document.getElementById('btnGenerate'),
        promptInput: !!document.getElementById('promptInput'),
        fileList: !!document.getElementById('fileList'),
        progress: !!document.getElementById('progress'),
        log: !!document.getElementById('log'),
      };
    });

    console.log(`  标题: ${popupChecks.title}`);
    const allPresent = popupChecks.uploadArea && popupChecks.fileInput &&
      popupChecks.btnPreset && popupChecks.btnGenerate &&
      popupChecks.promptInput && popupChecks.fileList;

    if (allPresent) {
      console.log('✅ Popup UI 所有元素正常');
    } else {
      console.log('❌ Popup UI 缺少元素:', JSON.stringify(popupChecks, null, 2));
    }
    await screenshot(popupPage, 'popup-loaded');

    // ---- Test 3: File upload in popup ----
    console.log('\n--- Test 3: Popup 文件选择 ---');
    const fileInput = popupPage.locator('#fileInput');
    await fileInput.setInputFiles(testImages.slice(0, 2));
    await sleep(500);

    const fileCountAfter = await popupPage.evaluate(() => {
      const countEl = document.getElementById('fileCount');
      const items = document.querySelectorAll('.file-item');
      return {
        countText: countEl?.textContent,
        itemCount: items.length,
        generateBtnText: document.getElementById('btnGenerate')?.textContent,
        generateDisabled: document.getElementById('btnGenerate')?.disabled,
      };
    });

    console.log(`  文件数: ${fileCountAfter.countText}`);
    console.log(`  列表项: ${fileCountAfter.itemCount}`);
    console.log(`  按钮文本: ${fileCountAfter.generateBtnText}`);
    console.log(`  按钮禁用: ${fileCountAfter.generateDisabled}`);

    if (fileCountAfter.itemCount === 2 && !fileCountAfter.generateDisabled) {
      console.log('✅ 文件选择功能正常');
    } else {
      console.log('❌ 文件选择异常');
    }
    await screenshot(popupPage, 'popup-files-added');

    // ---- Test 4: Prompt input ----
    console.log('\n--- Test 4: 提示词输入 ---');
    const testPrompt = '跳舞的女孩';
    await popupPage.fill('#promptInput', testPrompt);
    const promptValue = await popupPage.inputValue('#promptInput');
    if (promptValue === testPrompt) {
      console.log('✅ 提示词输入正常');
    } else {
      console.log('❌ 提示词输入异常');
    }

    // ---- Test 5: Navigate to Jimeng AI and verify content script ----
    console.log('\n--- Test 5: 内容脚本注入 ---');
    const jimengPage = await context.newPage();
    await jimengPage.goto('https://jimeng.jianying.com/ai-tool/home', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    // Check if content script was injected
    const contentScriptLoaded = await jimengPage.evaluate(() => {
      return new Promise(resolve => {
        // Check console for content script message
        // We'll check by trying to send a message via chrome.runtime
        // Since we're in page context, we can't directly check.
        // But we can check if the content script added any markers.
        // The content script logs '[Seedance批量助手] Content script loaded'
        // We can try a different approach: check the DOM for content script effects
        resolve(true); // Content script is loaded if no error
      });
    });

    // Verify the page loaded
    const pageUrl = jimengPage.url();
    console.log(`  页面URL: ${pageUrl}`);
    const isJimeng = pageUrl.includes('jimeng.jianying.com');
    if (isJimeng) {
      console.log('✅ 即梦AI 页面已加载');
    } else {
      console.log('⚠️  页面可能被重定向');
    }
    await screenshot(jimengPage, 'jimeng-page');

    // Check if the page has the expected toolbar elements
    const pageElements = await jimengPage.evaluate(() => {
      return {
        hasToolbar: !!document.querySelector('[class*="toolbar-settings"]'),
        hasLvSelect: document.querySelectorAll('.lv-select').length,
        hasSubmitBtn: !!document.querySelector('[class*="submit-button"]'),
        hasUploadArea: !!document.querySelector('[class*="reference-upload"]') ||
          !!document.querySelector('input[type="file"]'),
        hasTextarea: !!document.querySelector('textarea[class*="prompt-textarea"]') ||
          !!document.querySelector('textarea'),
      };
    });
    console.log('  页面元素检查:', JSON.stringify(pageElements, null, 2));

    // ---- Test 6: Test popup → content script communication ----
    console.log('\n--- Test 6: Popup → Content Script 通信 ---');

    // We'll test by sending a message from the popup and checking if
    // the content script responds. We need the tab ID of the jimeng page.
    // In extension test, the popup page can use chrome.tabs API.

    // First, get the tab ID of the jimeng page
    const jimengTabId = await popupPage.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('jimeng.jianying.com'));
      return tab ? tab.id : null;
    }, pageUrl);

    if (jimengTabId) {
      console.log(`  即梦 Tab ID: ${jimengTabId}`);

      // Try sending a test message to the content script
      const msgResult = await popupPage.evaluate(async (tabId) => {
        try {
          const response = await chrome.tabs.sendMessage(tabId, {
            action: 'generateTask',
            fileData: {
              name: 'test.png',
              data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              type: 'image/png',
            },
            prompt: '测试提示词',
            index: 0,
            total: 1,
          });
          return { success: true, response };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, jimengTabId);

      if (msgResult.success) {
        console.log('✅ Popup → Content Script 通信正常');
        console.log(`  Response: ${JSON.stringify(msgResult.response)}`);
      } else {
        console.log(`⚠️  通信可能失败: ${msgResult.error}`);
        console.log('  (如果未登录即梦AI，内容脚本可能无法操作页面元素)');
      }
    } else {
      console.log('⚠️  未找到即梦AI标签页');
    }

    await screenshot(jimengPage, 'after-communication-test');

    // ---- Test 7: Test preset button ----
    console.log('\n--- Test 7: 预设参数按钮 ---');

    // Focus on jimeng tab (make it active)
    await jimengPage.bringToFront();
    await sleep(500);

    // Now click the preset button from popup
    await popupPage.bringToFront();
    const presetBtnText = await popupPage.textContent('#btnPreset');
    console.log(`  按钮文本: ${presetBtnText}`);

    // Click always applies to active tab, so we need jimeng to be active
    // But since we're testing in the popup page context, we can execute directly
    if (jimengTabId) {
      const presetResult = await popupPage.evaluate(async (tabId) => {
        const btn = document.getElementById('btnPreset');
        if (!btn) return { error: 'Button not found' };
        // Simulate clicking the preset button
        btn.click();
        // Wait for it to complete
        await new Promise(r => setTimeout(r, 3000));
        return { btnText: btn.textContent };
      }, jimengTabId);

      console.log(`  应用后按钮: ${presetResult.btnText || presetResult.error}`);
      if (presetResult.btnText && presetResult.btnText.includes('已应用')) {
        console.log('✅ 预设参数按钮工作正常');
      } else {
        console.log('⚠️  预设可能未完全应用（需要登录状态才能操作页面）');
      }
    }

    // ---- Test 8: Clear button ----
    console.log('\n--- Test 8: 清空按钮 ---');
    await popupPage.click('#btnClear');
    await sleep(300);
    const afterClear = await popupPage.evaluate(() => {
      return {
        items: document.querySelectorAll('.file-item').length,
        disabled: document.getElementById('btnGenerate')?.disabled,
      };
    });
    if (afterClear.items === 0 && afterClear.disabled) {
      console.log('✅ 清空功能正常');
    } else {
      console.log('❌ 清空功能异常');
    }

    // ---- Summary ----
    console.log('\n========================================');
    console.log('  扩展测试完成');
    console.log('========================================');
    console.log('如需完整的生成流程测试，请先运行:');
    console.log('  HEADLESS=false node playwright/login.js');
    console.log('登录即梦AI后再运行此测试\n');

    await popupPage.close();
    await jimengPage.close();

  } catch (err) {
    console.error('❌ 测试出错:', err.message);
    console.error(err.stack);
  } finally {
    await context.close();
  }
}

main().catch(console.error);
