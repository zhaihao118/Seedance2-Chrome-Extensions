// playwright/test-extension.js
// 使用 Playwright 加载 Chrome 扩展并测试其功能

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const config = require('./config');

const readline = require('readline');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const USER_DATA_DIR = path.resolve(__dirname, 'ext-test-user-data');
const SCREENSHOTS_DIR = path.resolve(__dirname, 'screenshots');

function waitForEnter(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

// Ensure screenshot dir exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// 生成指定尺寸的纯色 PNG (无需 canvas 依赖)
function createTestPNG(width, height, r, g, b) {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 2;   // color type: RGB
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdr = makePNGChunk('IHDR', ihdrData);

  // IDAT chunk: raw image data (filter byte 0 + RGB pixels per row)
  const rowSize = 1 + width * 3; // 1 filter byte + RGB
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rowSize;
    rawData[offset] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }
  const compressed = zlib.deflateSync(rawData);
  const idat = makePNGChunk('IDAT', compressed);

  // IEND chunk
  const iend = makePNGChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makePNGChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Ensure test images exist (512x512 pixels, different colors)
function ensureTestImages() {
  const imagesDir = path.resolve(EXTENSION_PATH, 'images');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const colors = [
    [220, 80, 80],   // 红色
    [80, 180, 80],   // 绿色
    [80, 80, 220],   // 蓝色
  ];

  for (let i = 1; i <= 3; i++) {
    const filePath = path.join(imagesDir, `test-${String(i).padStart(3, '0')}.png`);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1000) {
      // Create a 512x512 solid color PNG
      const [r, g, b] = colors[i - 1];
      const png = createTestPNG(512, 512, r, g, b);
      fs.writeFileSync(filePath, png);
      console.log(`  Created test image: ${path.basename(filePath)} (512x512, ${png.length} bytes)`);
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
// Test Results Tracking
// ============================================================
const testResults = [];
function recordTest(name, passed, detail = '') {
  testResults.push({ name, passed, detail });
  console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ': ' + detail : ''}`);
}

// ============================================================
// Main Test
// ============================================================
async function main() {
  console.log('=== Chrome 扩展测试 ===\n');
  console.log(`扩展路径: ${EXTENSION_PATH}`);
  console.log(`用户数据: ${USER_DATA_DIR}\n`);

  // Verify extension files exist
  const requiredFiles = ['manifest.json', 'panel.html', 'panel.js', 'popup.html', 'popup.js', 'content.js', 'background.js'];
  let allFilesExist = true;
  for (const f of requiredFiles) {
    const p = path.join(EXTENSION_PATH, f);
    if (!fs.existsSync(p)) {
      console.error(`❌ Missing extension file: ${f}`);
      allFilesExist = false;
    }
  }
  recordTest('扩展文件完整性', allFilesExist);
  if (!allFilesExist) process.exit(1);

  // Verify icons exist
  const iconFiles = ['icon48.png', 'icon128.png'];
  const iconsExist = iconFiles.every(f => fs.existsSync(path.join(EXTENSION_PATH, f)));
  recordTest('图标文件存在', iconsExist);

  const imagesDir = ensureTestImages();
  const testImages = fs.readdirSync(imagesDir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map(f => path.join(imagesDir, f));
  console.log(`📁 测试图片: ${testImages.length} 张\n`);

  // Validate manifest.json structure
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
  recordTest('Manifest V3', manifest.manifest_version === 3);
  recordTest('Manifest 有 storage 权限', manifest.permissions.includes('storage'));
  recordTest('Manifest 有 background', !!manifest.background?.service_worker);
  recordTest('Manifest 有 content_scripts', Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0);
  recordTest('Manifest 有 tabs 权限', manifest.permissions.includes('tabs'));
  recordTest('Manifest 无 default_popup', !manifest.action?.default_popup);
  recordTest('Manifest 有 web_accessible_resources', Array.isArray(manifest.web_accessible_resources) && manifest.web_accessible_resources.length > 0);

  // Launch browser with extension loaded
  console.log('\n🚀 启动带扩展的浏览器...');

  // 保留用户数据目录以保持登录状态
  // 如需清除登录状态，手动删除目录或使用 --clean 参数
  if (process.argv.includes('--clean') && fs.existsSync(USER_DATA_DIR)) {
    console.log('⚠️  --clean 模式: 清除用户数据...');
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
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
    // ---- Test: Extension loads successfully ----
    console.log('\n--- Test: 扩展加载 ---');

    let serviceWorker;
    if (context.serviceWorkers().length > 0) {
      serviceWorker = context.serviceWorkers()[0];
    } else {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
    }

    if (serviceWorker) {
      extensionId = serviceWorker.url().split('/')[2];
      recordTest('扩展加载 (service worker)', true, `ID: ${extensionId}`);
    } else {
      // Fallback: try background pages
      const bgPages = context.backgroundPages();
      if (bgPages.length > 0) {
        extensionId = new URL(bgPages[0].url()).hostname;
        recordTest('扩展加载 (background page)', true, `ID: ${extensionId}`);
      } else {
        // Try extensions page
        const extPage = await context.newPage();
        await extPage.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
        await sleep(1000);
        await extPage.close();
        recordTest('扩展加载', false, '无法获取扩展ID');
      }
    }

    if (!extensionId) {
      console.error('❌ 无法获取扩展ID，测试终止');
      await context.close();
      printSummary();
      process.exit(1);
    }

    // ---- Test: Panel UI loads correctly (drawer version) ----
    console.log('\n--- Test: Panel UI (Drawer) ---');
    const panelUrl = `chrome-extension://${extensionId}/panel.html`;
    const popupPage = await context.newPage();
    await popupPage.goto(panelUrl);
    await sleep(500);

    const popupChecks = await popupPage.evaluate(() => {
      return {
        title: document.querySelector('h1')?.textContent?.trim(),
        uploadArea: !!document.getElementById('uploadArea'),
        fileInput: !!document.getElementById('fileInput'),
        btnPreset: !!document.getElementById('btnPreset'),
        btnDoGenerate: !!document.getElementById('btnDoGenerate'),
        btnCheckPage: !!document.getElementById('btnCheckPage'),
        promptInput: !!document.getElementById('promptInput'),
        fileList: !!document.getElementById('fileList'),
        progress: !!document.getElementById('progress'),
        log: !!document.getElementById('log'),
        connStatus: !!document.getElementById('connStatus'),
        taskDelay: !!document.getElementById('taskDelay'),
        presetEditor: !!document.getElementById('presetEditor'),
        presetEditToggle: !!document.getElementById('presetEditToggle'),
        tagModel: !!document.getElementById('tagModel'),
        tagRefMode: !!document.getElementById('tagRefMode'),
        tagRatio: !!document.getElementById('tagRatio'),
        tagDuration: !!document.getElementById('tagDuration'),
        btnCollapse: !!document.getElementById('btnCollapse'),
      };
    });

    console.log(`  标题: ${popupChecks.title}`);
    const coreElements = popupChecks.uploadArea && popupChecks.fileInput &&
      popupChecks.btnPreset && popupChecks.btnDoGenerate &&
      popupChecks.promptInput && popupChecks.fileList;
    recordTest('Panel 核心元素', coreElements);

    const newElements = popupChecks.btnCheckPage && popupChecks.connStatus &&
      popupChecks.taskDelay && popupChecks.presetEditor &&
      popupChecks.presetEditToggle && popupChecks.btnCollapse;
    recordTest('Panel 新增元素 (含收起按钮)', newElements);

    const presetTags = popupChecks.tagModel && popupChecks.tagRefMode &&
      popupChecks.tagRatio && popupChecks.tagDuration;
    recordTest('Panel 预设标签', presetTags);

    await screenshot(popupPage, 'popup-loaded');

    // ---- Test: File upload in popup ----
    console.log('\n--- Test: 文件选择 ---');
    const fileInput = popupPage.locator('#fileInput');
    await fileInput.setInputFiles(testImages.slice(0, 2));
    await sleep(500);

    const fileState = await popupPage.evaluate(() => {
      const countEl = document.getElementById('fileCount');
      const items = document.querySelectorAll('.file-item');
      return {
        countText: countEl?.textContent,
        itemCount: items.length,
        generateBtnText: document.getElementById('btnDoGenerate')?.textContent,
        generateDisabled: document.getElementById('btnDoGenerate')?.disabled,
      };
    });

    console.log(`  文件数: ${fileState.countText}`);
    console.log(`  列表项: ${fileState.itemCount}`);
    recordTest('文件选择 - 数量正确', fileState.itemCount === 2);
    recordTest('文件选择 - 按钮启用', !fileState.generateDisabled);

    await screenshot(popupPage, 'popup-files-added');

    // ---- Test: Add more files ----
    console.log('\n--- Test: 追加文件 ---');
    await fileInput.setInputFiles(testImages.slice(2, 3));
    await sleep(300);

    const fileState2 = await popupPage.evaluate(() => ({
      itemCount: document.querySelectorAll('.file-item').length,
    }));
    recordTest('追加文件', fileState2.itemCount === 3);

    // ---- Test: Remove single file ----
    console.log('\n--- Test: 删除单个文件 ---');
    await popupPage.click('.file-item:first-child .remove');
    await sleep(300);

    const fileState3 = await popupPage.evaluate(() => ({
      itemCount: document.querySelectorAll('.file-item').length,
    }));
    recordTest('删除单个文件', fileState3.itemCount === 2);

    // ---- Test: Prompt input ----
    console.log('\n--- Test: 提示词输入 ---');
    const testPrompt = '跳舞的女孩';
    await popupPage.fill('#promptInput', testPrompt);
    const promptValue = await popupPage.inputValue('#promptInput');
    recordTest('提示词输入', promptValue === testPrompt);

    // ---- Test: Task delay input ----
    console.log('\n--- Test: 任务间隔设置 ---');
    await popupPage.fill('#taskDelay', '5');
    const delayValue = await popupPage.inputValue('#taskDelay');
    recordTest('任务间隔设置', delayValue === '5');

    // ---- Test: Preset editor toggle ----
    console.log('\n--- Test: 预设编辑器 ---');
    await popupPage.click('#presetEditToggle');
    await sleep(300);

    const editorVisible = await popupPage.evaluate(() => {
      const editor = document.getElementById('presetEditor');
      const display = document.getElementById('presetDisplay');
      return {
        editorVisible: editor?.style.display !== 'none',
        displayHidden: display?.style.display === 'none',
      };
    });
    recordTest('预设编辑器打开', editorVisible.editorVisible && editorVisible.displayHidden);

    // Change a preset value
    await popupPage.selectOption('#cfgDuration', '10s');
    await popupPage.click('#presetSave');
    await sleep(300);

    const afterSave = await popupPage.evaluate(() => ({
      editorHidden: document.getElementById('presetEditor')?.style.display === 'none',
      durationTag: document.getElementById('tagDuration')?.textContent,
    }));
    recordTest('预设保存', afterSave.editorHidden && afterSave.durationTag?.includes('10s'));

    // Reset back
    await popupPage.click('#presetEditToggle');
    await sleep(200);
    await popupPage.selectOption('#cfgDuration', '5s');
    await popupPage.click('#presetSave');
    await sleep(200);

    await screenshot(popupPage, 'popup-preset-edited');

    // ---- Test: Clear button ----
    console.log('\n--- Test: 清空按钮 ---');
    await popupPage.click('#btnClear');
    await sleep(300);
    const afterClear = await popupPage.evaluate(() => ({
      items: document.querySelectorAll('.file-item').length,
      disabled: document.getElementById('btnDoGenerate')?.disabled,
    }));
    recordTest('清空功能', afterClear.items === 0 && afterClear.disabled);

    // ---- Test: Navigate to Jimeng AI ----
    console.log('\n--- Test: 即梦AI页面加载 ---');
    const jimengPage = await context.newPage();
    await jimengPage.goto('https://jimeng.jianying.com/ai-tool/home', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    const pageUrl = jimengPage.url();
    const isJimeng = pageUrl.includes('jimeng.jianying.com');
    recordTest('即梦AI页面加载', isJimeng);
    await screenshot(jimengPage, 'jimeng-page');

    // ---- Test: Drawer injection ----
    console.log('\n--- Test: 侧边抽屉注入 ---');
    await sleep(2000);

    const drawerState = await jimengPage.evaluate(() => {
      return {
        hasContainer: !!document.getElementById('seedance-drawer-container'),
        hasToggle: !!document.getElementById('seedance-drawer-toggle'),
        hasIframe: !!document.getElementById('seedance-drawer-iframe'),
      };
    });

    recordTest('抽屉容器注入', drawerState.hasContainer);
    recordTest('抽屉切换按钮注入', drawerState.hasToggle);
    recordTest('抽屉 iframe 注入', drawerState.hasIframe);

    // ---- Test: Drawer toggle ----
    console.log('\n--- Test: 抽屉展开/收起 ---');
    await jimengPage.click('#seedance-drawer-toggle');
    await sleep(500);

    const drawerOpenState = await jimengPage.evaluate(() => {
      const container = document.getElementById('seedance-drawer-container');
      return {
        transform: container?.style.transform,
        isOpen: container?.style.transform === 'translateX(0px)' || container?.style.transform === 'translateX(0)',
      };
    });
    recordTest('抽屉展开', drawerOpenState.isOpen, `transform: ${drawerOpenState.transform}`);
    await screenshot(jimengPage, 'drawer-open');

    // Close drawer
    await jimengPage.click('#seedance-drawer-toggle');
    await sleep(500);

    const drawerClosedState = await jimengPage.evaluate(() => {
      const container = document.getElementById('seedance-drawer-container');
      return {
        transform: container?.style.transform,
        isClosed: container?.style.transform.includes('100%'),
      };
    });
    recordTest('抽屉收起', drawerClosedState.isClosed, `transform: ${drawerClosedState.transform}`);
    await screenshot(jimengPage, 'drawer-closed');

    // ---- 等待用户手动登录 ----
    console.log('\n⏸️  请在浏览器中登录即梦AI账号，登录完成后回到终端按 Enter 继续测试...');
    await waitForEnter('👉 按 Enter 继续...');
    console.log('▶️  继续测试...\n');
    await sleep(2000);

    // 捕获即梦页面的 console 日志 (用于调试提示词填充)
    const jimengConsoleLogs = [];
    jimengPage.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Seedance批量]') || text.includes('[Seedance-PM]')) {
        jimengConsoleLogs.push(text);
        console.log(`  [页面日志] ${text}`);
      }
    });

    // 捕获页面错误 (便于调试 MAIN world 脚本问题)
    jimengPage.on('pageerror', err => {
      console.log(`  [页面错误] ${err.message}`);
    });

    // ---- Test: Content script communication ----
    console.log('\n--- Test: 内容脚本通信 ---');

    const jimengTabId = await popupPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url && t.url.includes('jimeng.jianying.com'));
      return tab ? tab.id : null;
    });

    if (jimengTabId) {
      console.log(`  即梦 Tab ID: ${jimengTabId}`);

      // Test ping
      const pingResult = await popupPage.evaluate(async (tabId) => {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
          return { success: true, response };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, jimengTabId);

      recordTest('Ping 通信', pingResult.success && pingResult.response?.ready === true);

      // Test getPageInfo
      const pageInfoResult = await popupPage.evaluate(async (tabId) => {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' });
          return { success: true, response };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, jimengTabId);

      recordTest('getPageInfo 通信', pageInfoResult.success && pageInfoResult.response?.info?.url);
      if (pageInfoResult.success) {
        console.log(`  页面信息: ${JSON.stringify(pageInfoResult.response.info)}`);
      }

      // Test generateTask message
      const taskResult = await popupPage.evaluate(async (tabId) => {
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

      // The task itself may fail (page not logged in), but communication should work
      recordTest('generateTask 通信', taskResult.success);
      console.log(`  Task结果: ${JSON.stringify(taskResult.response)}`);
    } else {
      recordTest('内容脚本通信', false, '未找到即梦AI标签页');
    }

    await screenshot(jimengPage, 'after-tests');

    // ---- Test: 提示词填充到 ProseMirror 编辑器 ----
    console.log('\n--- Test: 提示词填充验证 ---');
    if (jimengTabId) {
      // 测试1: 检查是否能找到 ProseMirror 编辑器
      const editorCheck = await popupPage.evaluate(async (tabId) => {
        try {
          const response = await chrome.tabs.sendMessage(tabId, {
            action: 'getPromptText',
          });
          return response;
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, jimengTabId);
      recordTest('找到提示词编辑器', editorCheck.success && editorCheck.hasEditor);
      console.log(`  编辑器存在: ${editorCheck.hasEditor}, 当前内容: "${editorCheck.currentText || ''}"`);

      // 测试2: 设置提示词并验证 <p> 标签内容
      const testPromptText = '跳舞的女孩 test prompt';
      const setResult = await popupPage.evaluate(async ({ tabId, promptText }) => {
        try {
          const response = await chrome.tabs.sendMessage(tabId, {
            action: 'setPrompt',
            prompt: promptText,
          });
          return response;
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, { tabId: jimengTabId, promptText: testPromptText });

      recordTest('setPrompt 消息通信', setResult.success);
      console.log(`  setPrompt 结果: currentText="${setResult.currentText || ''}"`);
      // 等待页面日志输出
      await sleep(1000);
      console.log(`  累计捕获 ${jimengConsoleLogs.length} 条 [Seedance批量] 日志`);

      // 验证 <p> 标签内容与预期一致
      const promptMatch = setResult.success && setResult.currentText &&
        setResult.currentText.includes(testPromptText);
      recordTest('提示词内容比对', promptMatch,
        `期望: "${testPromptText}" | 实际: "${setResult.currentText || '(空)'}"`);

      await screenshot(jimengPage, 'prompt-filled');

      // 测试3: 重新设置不同的提示词，验证能覆盖
      const testPromptText2 = '赛博朋克城市夜景';
      console.log(`\n  设置第二个提示词: "${testPromptText2}"`);
      const setResult2 = await popupPage.evaluate(async ({ tabId, promptText }) => {
        try {
          const response = await chrome.tabs.sendMessage(tabId, {
            action: 'setPrompt',
            prompt: promptText,
          });
          return response;
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, { tabId: jimengTabId, promptText: testPromptText2 });

      await sleep(1000);
      const promptMatch2 = setResult2.success && setResult2.currentText &&
        setResult2.currentText.includes(testPromptText2);
      recordTest('提示词覆盖比对', promptMatch2,
        `期望: "${testPromptText2}" | 实际: "${setResult2.currentText || '(空)'}"`);

      // 再次通过 getPromptText 独立验证
      const verifyResult = await popupPage.evaluate(async (tabId) => {
        try {
          const response = await chrome.tabs.sendMessage(tabId, {
            action: 'getPromptText',
          });
          return response;
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, jimengTabId);

      const verifyMatch = verifyResult.success && verifyResult.currentText &&
        verifyResult.currentText.includes(testPromptText2);
      recordTest('独立读取验证提示词', verifyMatch,
        `读取: "${verifyResult.currentText || '(空)'}"`);

      // 输出所有捕获的 Seedance 日志
      if (jimengConsoleLogs.length > 0) {
        console.log(`\n  --- 页面 Seedance 日志汇总 (${jimengConsoleLogs.length} 条) ---`);
        jimengConsoleLogs.forEach((log, i) => console.log(`  ${i + 1}. ${log}`));
      }

      await screenshot(jimengPage, 'prompt-overwritten');
    } else {
      recordTest('提示词填充', false, '未找到即梦AI标签页');
    }

    // ---- Test: Preset button ----
    console.log('\n--- Test: 预设按钮 ---');
    if (jimengTabId) {
      await jimengPage.bringToFront();
      await sleep(300);
      await popupPage.bringToFront();

      // In test mode, popup opens as standalone page, so chrome.tabs.query
      // returns the popup tab itself, not the jimeng tab. We test the button
      // click executes without errors and the applyPreset message works directly.
      const presetResult = await popupPage.evaluate(async (tabId) => {
        try {
          // 使用"全能参考"模式 — 这是 @mention 引用功能所需的模式
          const response = await chrome.tabs.sendMessage(tabId, {
            action: 'applyPreset',
            preset: {
              model: 'Seedance 2.0',
              referenceMode: '全能参考',
              aspectRatio: '16:9',
              duration: '5s',
            },
          });
          return { success: true, response };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, jimengTabId);

      recordTest('预设消息通信', presetResult.success, JSON.stringify(presetResult.response));
    }

    // ---- Test: doGenerate with @mention ----
    console.log('\n--- Test: doGenerate + @mention 提示词 ---');
    if (jimengTabId) {
      await jimengPage.bringToFront();
      await sleep(1000);

      // 准备 2 张图片的 base64 数据
      const img1Path = testImages[0];
      const img2Path = testImages[1];
      const img1Base64 = 'data:image/png;base64,' + fs.readFileSync(img1Path).toString('base64');
      const img2Base64 = 'data:image/png;base64,' + fs.readFileSync(img2Path).toString('base64');

      const mentionPrompt = '一个女孩 (@图片1) 在跳舞 (@图片2)';
      console.log(`  提示词: "${mentionPrompt}"`);
      console.log(`  文件: ${path.basename(img1Path)}, ${path.basename(img2Path)}`);

      const doGenResult = await popupPage.evaluate(async ({ tabId, files, prompt }) => {
        try {
          const response = await chrome.tabs.sendMessage(tabId, {
            action: 'doGenerate',
            files: files,
            prompt: prompt,
          });
          return { success: true, response };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, {
        tabId: jimengTabId,
        files: [
          { name: path.basename(img1Path), data: img1Base64, type: 'image/png' },
          { name: path.basename(img2Path), data: img2Base64, type: 'image/png' },
        ],
        prompt: mentionPrompt,
      });

      recordTest('doGenerate 通信', doGenResult.success,
        JSON.stringify(doGenResult.response || doGenResult.error));

      // 等待处理完成 (MAIN world 中的 setTimeout 链 + @ 弹窗操作需要较长时间)
      await sleep(10000);

      // 验证编辑器内容是否包含 mention 标签
      const mentionCheck = await jimengPage.evaluate(() => {
        const editor = document.querySelector('.tiptap.ProseMirror[contenteditable="true"]');
        if (!editor) return { error: '未找到编辑器' };

        const text = editor.textContent || '';
        const html = editor.innerHTML || '';
        const mentionNodes = editor.querySelectorAll('[data-type="reference-mention-tag"]');

        // 也检查 PM 状态
        let pmInfo = null;
        if (editor.pmViewDesc && editor.pmViewDesc.view) {
          const state = editor.pmViewDesc.view.state;
          const mentions = [];
          state.doc.descendants((node) => {
            if (node.type.name === 'reference-mention-tag') {
              mentions.push({ id: node.attrs.id });
            }
          });
          pmInfo = { docSize: state.doc.content.size, mentions };
        }

        return {
          text: text.substring(0, 200),
          htmlSnippet: html.substring(0, 500),
          mentionNodeCount: mentionNodes.length,
          pmInfo,
        };
      });

      console.log(`  编辑器文本: "${mentionCheck.text}"`);
      console.log(`  mention DOM 节点: ${mentionCheck.mentionNodeCount}`);
      if (mentionCheck.pmInfo) {
        console.log(`  PM doc size: ${mentionCheck.pmInfo.docSize}`);
        console.log(`  PM mentions: ${JSON.stringify(mentionCheck.pmInfo.mentions)}`);
      }
      console.log(`  HTML 片段: ${mentionCheck.htmlSnippet?.substring(0, 200)}`);

      const hasMentions = (mentionCheck.mentionNodeCount || 0) > 0 ||
        (mentionCheck.pmInfo?.mentions?.length || 0) > 0;
      const hasText = mentionCheck.text && mentionCheck.text.includes('女孩');
      recordTest('@mention 标签插入', hasMentions, `mention=${mentionCheck.mentionNodeCount}`);
      recordTest('@mention 文本保留', hasText, `"${mentionCheck.text?.substring(0, 50)}"`);

      await screenshot(jimengPage, 'mention-test');

      // 输出最近的 Seedance 日志
      const recentLogs = jimengConsoleLogs.slice(-15);
      if (recentLogs.length > 0) {
        console.log(`\n  --- @mention 相关日志 (最近 ${recentLogs.length} 条) ---`);
        recentLogs.forEach((log, i) => console.log(`  ${i + 1}. ${log}`));
      }
    }

    // ---- Test: Connection check button ----
    console.log('\n--- Test: 连接检查按钮 ---');
    await popupPage.bringToFront();
    await popupPage.click('#btnCheckPage');
    await sleep(1000);

    const connResult = await popupPage.evaluate(() => {
      const el = document.getElementById('connStatus');
      return {
        text: el?.textContent,
        hasClass: el?.className,
      };
    });
    recordTest('连接检查按钮', connResult.text && connResult.text.length > 0, connResult.text);

    // ---- Test: Storage persistence ----
    console.log('\n--- Test: Storage 持久化 ---');
    // Re-add files and save prompt
    await fileInput.setInputFiles(testImages.slice(0, 1));
    await popupPage.fill('#promptInput', '持久化测试');
    await popupPage.fill('#taskDelay', '3');
    // Trigger blur to save
    await popupPage.click('h1');
    await sleep(500);

    const storageData = await popupPage.evaluate(async () => {
      const data = await chrome.storage.local.get(['preset', 'prompt', 'taskDelay']);
      return data;
    });

    recordTest('Storage 保存预设', !!storageData.preset);
    recordTest('Storage 保存提示词', storageData.prompt === '持久化测试');
    recordTest('Storage 保存间隔', storageData.taskDelay === 3);

    await screenshot(popupPage, 'final');

    await screenshot(popupPage, 'final');

  } catch (err) {
    console.error('❌ 测试出错:', err.message);
    console.error(err.stack);
    recordTest('测试运行', false, err.message);
  }

  printSummary();

  // 保持浏览器打开，等待用户手动关闭
  console.log('\n🖥️  浏览器保持打开，可手动操作验证。关闭浏览器后程序自动退出。');
  await new Promise(resolve => context.on('close', resolve));
}

function printSummary() {
  console.log('\n' + '═'.repeat(50));
  console.log('  测试结果汇总');
  console.log('═'.repeat(50));

  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  const total = testResults.length;

  testResults.forEach(t => {
    console.log(`  ${t.passed ? '✅' : '❌'} ${t.name}${t.detail ? ' - ' + t.detail : ''}`);
  });

  console.log('─'.repeat(50));
  console.log(`  总计: ${total} | 通过: ${passed} | 失败: ${failed}`);
  console.log('═'.repeat(50));
}

main().catch(console.error);
