// playwright/test-interaction.js - 深度交互测试
// 模拟完整的用户操作流程，找出正确的选择器

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { sleep } = require('./helpers');

(async () => {
  console.log('🧪 交互测试 - 深度DOM检查');
  console.log('━'.repeat(50));

  const screenshotDir = config.screenshots.dir;
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
  if (!fs.existsSync(config.userDataDir)) fs.mkdirSync(config.userDataDir, { recursive: true });

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
  page.setDefaultTimeout(15000);

  try {
    // ============================================================
    // Step 1: 加载首页
    // ============================================================
    console.log('\n📄 Step 1: 加载页面...');
    await page.goto(config.pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    console.log(`  URL: ${page.url()}`);
    await page.screenshot({ path: path.join(screenshotDir, '10-home.png') });

    // ============================================================
    // Step 2: 尝试点击"视频生成"入口
    // ============================================================
    console.log('\n📄 Step 2: 点击"视频生成"...');
    
    // 尝试点击视频生成入口
    const videoGenClicked = await page.getByText('视频生成').first().click({ timeout: 5000 }).then(() => true).catch(() => false);
    console.log(`  点击"视频生成": ${videoGenClicked}`);
    await sleep(2000);
    console.log(`  URL变化: ${page.url()}`);
    await page.screenshot({ path: path.join(screenshotDir, '11-after-video-gen-click.png') });

    // 如果还在首页，试直接导航
    if (!page.url().includes('generate')) {
      console.log('  尝试直接导航到视频生成页面...');
      await page.goto('https://jimeng.jianying.com/ai-tool/generate/video-generation', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await sleep(3000);
      console.log(`  URL: ${page.url()}`);
    }

    await page.screenshot({ path: path.join(screenshotDir, '12-video-gen-page.png') });

    // ============================================================
    // Step 3: 详细分析页面DOM
    // ============================================================
    console.log('\n📄 Step 3: 分析生成页面DOM...');

    const domAnalysis = await page.evaluate(() => {
      const results = {};

      // 1. 所有按钮和可点击元素
      const clickables = document.querySelectorAll('button, [role="button"], [class*="btn"], [class*="Btn"]');
      results.clickables = Array.from(clickables).map(el => ({
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 100),
        class: (el.className || '').toString().substring(0, 120),
        visible: el.offsetParent !== null || el.offsetWidth > 0,
        rect: el.getBoundingClientRect ? (() => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        })() : null,
      }));

      // 2. 所有文件输入
      results.fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
        accept: el.accept,
        multiple: el.multiple,
        class: (el.className || '').toString().substring(0, 80),
        id: el.id,
        name: el.name,
        parentClass: el.parentElement ? (el.parentElement.className || '').toString().substring(0, 80) : '',
        parentTag: el.parentElement ? el.parentElement.tagName : '',
        hidden: el.offsetParent === null,
      }));

      // 3. 文本输入区域
      results.textInputs = [];
      document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(el => {
        results.textInputs.push({
          tag: el.tagName,
          type: el.type || '',
          placeholder: el.placeholder || '',
          class: (el.className || '').toString().substring(0, 80),
          value: (el.value || el.textContent || '').substring(0, 50),
          visible: el.offsetParent !== null,
        });
      });

      // 4. 查找包含关键词的元素
      const keywords = ['参考图', '上传', '生成', '模型', 'Seedance', '时长', '比例', '全能', '提示词'];
      results.keywordElements = {};
      keywords.forEach(kw => {
        const matches = [];
        const walker = document.createTreeWalker(
          document.body, NodeFilter.SHOW_ELEMENT,
          { acceptNode: (node) => {
            const ownText = Array.from(node.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent.trim())
              .join('');
            return ownText.includes(kw) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }}
        );
        let node;
        let count = 0;
        while ((node = walker.nextNode()) && count < 5) {
          matches.push({
            tag: node.tagName,
            text: node.textContent.trim().substring(0, 80),
            class: (node.className || '').toString().substring(0, 80),
            clickable: node.tagName === 'BUTTON' || node.getAttribute('role') === 'button' || node.onclick !== null,
          });
          count++;
        }
        if (matches.length > 0) results.keywordElements[kw] = matches;
      });

      // 5. 查找上传拖放区域
      const uploadSelectors = [
        '[class*="upload"]', '[class*="Upload"]', '[class*="dragger"]', '[class*="Dragger"]',
        '[class*="dropzone"]', '[class*="DropZone"]', '[class*="reference"]', '[class*="Reference"]',
        '[class*="drag"]', '[class*="Drag"]',
      ];
      results.uploadAreas = [];
      uploadSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          results.uploadAreas.push({
            selector: sel,
            tag: el.tagName,
            class: (el.className || '').toString().substring(0, 120),
            text: el.textContent.trim().substring(0, 80),
            visible: el.offsetParent !== null,
            children: el.children.length,
          });
        });
      });

      // 6. 查找右侧面板（参数设置区域）
      const sidePanels = document.querySelectorAll('[class*="panel"], [class*="Panel"], [class*="sidebar"], [class*="Sidebar"], [class*="setting"], [class*="Setting"], [class*="config"], [class*="Config"]');
      results.sidePanels = Array.from(sidePanels).slice(0, 10).map(el => ({
        tag: el.tagName,
        class: (el.className || '').toString().substring(0, 120),
        text: el.textContent.trim().substring(0, 120),
        visible: el.offsetParent !== null,
      }));

      // 7. 选择器/下拉菜单
      const selects = document.querySelectorAll('select, [class*="select"], [class*="Select"], [class*="dropdown"], [class*="Dropdown"]');
      results.selects = Array.from(selects).slice(0, 10).map(el => ({
        tag: el.tagName,
        class: (el.className || '').toString().substring(0, 100),
        text: el.textContent.trim().substring(0, 80),
        visible: el.offsetParent !== null,
      }));

      return results;
    });

    // 输出结果
    console.log('\n🔘 可点击元素:');
    domAnalysis.clickables.filter(c => c.visible).forEach((c, i) => {
      console.log(`  ${i + 1}. [${c.tag}] "${c.text}" | pos=(${c.rect?.x},${c.rect?.y}) size=${c.rect?.w}x${c.rect?.h}`);
    });

    console.log('\n📁 文件输入:');
    domAnalysis.fileInputs.forEach((f, i) => {
      console.log(`  ${i + 1}. accept="${f.accept}" hidden=${f.hidden} parent=[${f.parentTag}] parentClass="${f.parentClass}"`);
    });

    console.log('\n✏️  文本输入:');
    domAnalysis.textInputs.forEach((t, i) => {
      console.log(`  ${i + 1}. [${t.tag}] type=${t.type} placeholder="${t.placeholder}" visible=${t.visible} class="${t.class}"`);
    });

    console.log('\n🔤 关键词元素:');
    Object.entries(domAnalysis.keywordElements).forEach(([kw, matches]) => {
      console.log(`  "${kw}" (${matches.length} matches):`);
      matches.forEach((m, i) => {
        console.log(`    ${i + 1}. [${m.tag}] "${m.text}" clickable=${m.clickable} class="${m.class}"`);
      });
    });

    console.log('\n📤 上传区域:');
    domAnalysis.uploadAreas.filter(a => a.visible).forEach((a, i) => {
      console.log(`  ${i + 1}. [${a.tag}] selector="${a.selector}" text="${a.text}" class="${a.class}"`);
    });

    console.log('\n⚙️  面板/设置:');
    domAnalysis.sidePanels.filter(s => s.visible).forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.tag}] text="${s.text}" class="${s.class}"`);
    });

    console.log('\n📋 下拉选择:');
    domAnalysis.selects.filter(s => s.visible).forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.tag}] text="${s.text}" class="${s.class}"`);
    });

    // ============================================================
    // Step 4: 创建测试图片并尝试上传
    // ============================================================
    console.log('\n📄 Step 4: 创建测试图片...');
    
    // 如果 images 目录为空，创建一个测试图片
    const imagesDir = path.resolve(config.imagesDir);
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    
    const existingImages = fs.readdirSync(imagesDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    let testImagePath;
    
    if (existingImages.length === 0) {
      // 创建一个简单的1x1白色PNG
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64, // 100x100
        0x08, 0x02, 0x00, 0x00, 0x00, 0xFF, 0x80, 0x02, 0x03, // 8-bit RGB
        0x00, 0x00, 0x00, 0x01, 0x73, 0x52, 0x47, 0x42, // sRGB chunk
        0x00, 0xAE, 0xCE, 0x1C, 0xE9,
      ]);
      // Create a minimal valid PNG using canvas in page
      const base64Png = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#e94560';
        ctx.fillRect(0, 0, 200, 200);
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Test Image', 100, 100);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      
      testImagePath = path.join(imagesDir, 'test-001.png');
      fs.writeFileSync(testImagePath, Buffer.from(base64Png, 'base64'));
      console.log(`  ✅ 创建测试图片: ${testImagePath}`);
    } else {
      testImagePath = path.join(imagesDir, existingImages[0]);
      console.log(`  📁 使用已有图片: ${testImagePath}`);
    }

    // ============================================================
    // Step 5: 尝试上传
    // ============================================================
    console.log('\n📄 Step 5: 尝试上传文件...');

    // 先尝试直接设置 file input
    const fileInputCount = await page.locator('input[type="file"]').count();
    console.log(`  找到 ${fileInputCount} 个 file input`);

    if (fileInputCount > 0) {
      for (let i = 0; i < fileInputCount; i++) {
        const input = page.locator('input[type="file"]').nth(i);
        const accept = await input.getAttribute('accept');
        console.log(`  尝试 input #${i + 1} (accept="${accept}")...`);
        
        try {
          await input.setInputFiles(testImagePath);
          console.log(`  ✅ 文件已设置到 input #${i + 1}`);
          await sleep(2000);
          await page.screenshot({ path: path.join(screenshotDir, `13-after-upload-${i}.png`) });
          
          // 检查上传后的变化
          const afterUpload = await page.evaluate(() => {
            const previews = document.querySelectorAll('[class*="preview"], [class*="Preview"], [class*="thumb"], [class*="Thumb"], img[src*="blob:"]');
            return {
              previewCount: previews.length,
              previews: Array.from(previews).slice(0, 5).map(p => ({
                tag: p.tagName,
                class: (p.className || '').toString().substring(0, 80),
                src: p.src ? p.src.substring(0, 100) : '',
              })),
              newButtons: Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null).map(b => b.textContent.trim().substring(0, 50)),
            };
          });
          console.log(`  预览元素: ${afterUpload.previewCount}`);
          afterUpload.previews.forEach(p => console.log(`    [${p.tag}] class="${p.class}" src="${p.src}"`));
          console.log(`  当前按钮: ${afterUpload.newButtons.join(', ')}`);
          break; // 上传成功，跳出循环
        } catch (e) {
          console.warn(`  ⚠️ input #${i + 1} 上传失败: ${e.message}`);
        }
      }
    }

    // ============================================================
    // Step 6: 尝试点击生成按钮
    // ============================================================
    console.log('\n📄 Step 6: 查找生成按钮...');
    
    const generateBtns = await page.evaluate(() => {
      const btns = document.querySelectorAll('button, [role="button"]');
      return Array.from(btns)
        .filter(b => b.textContent.includes('生成'))
        .map(b => ({
          text: b.textContent.trim().substring(0, 60),
          class: (b.className || '').toString().substring(0, 80),
          disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
          visible: b.offsetParent !== null,
          tag: b.tagName,
        }));
    });
    
    console.log('  包含"生成"的按钮:');
    generateBtns.forEach((b, i) => {
      console.log(`    ${i + 1}. [${b.tag}] "${b.text}" disabled=${b.disabled} visible=${b.visible} class="${b.class}"`);
    });

    // 最终截图
    await page.screenshot({ path: path.join(screenshotDir, '19-final.png') });
    
    // 保存完整HTML
    const html = await page.content();
    fs.writeFileSync(path.join(screenshotDir, 'page-full.html'), html);
    console.log(`\n💾 完整HTML已保存`);

  } catch (err) {
    console.error('❌ 错误:', err.message);
    console.error(err.stack);
    await page.screenshot({ path: path.join(screenshotDir, 'error.png') }).catch(() => {});
  } finally {
    await context.close();
    console.log('\n✅ 交互测试完成');
  }
})().catch(err => {
  console.error('❌ 致命错误:', err);
  process.exit(1);
});
