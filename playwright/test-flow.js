// playwright/test-flow.js - 完整流程测试
// 切换到视频生成 -> 上传图片 -> 查找提交按钮 -> 查找参数选择器

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { sleep } = require('./helpers');

(async () => {
  console.log('🧪 完整流程测试');
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
    // Step 1: 导航
    console.log('\n📄 Step 1: 加载页面...');
    await page.goto(config.pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    console.log(`  URL: ${page.url()}`);

    // Step 2: 切换到视频生成模式
    console.log('\n📄 Step 2: 切换到视频生成模式...');
    
    // 查找下拉选择器 - 先点击展开
    const typeSelector = page.locator('[class*="type-home-select-BUj0QG"]').first();
    const selectorVisible = await typeSelector.isVisible().catch(() => false);
    console.log(`  类型选择器可见: ${selectorVisible}`);
    
    if (selectorVisible) {
      await typeSelector.click();
      await sleep(500);
    }
    
    // 点击"视频生成"选项
    const videoOption = page.locator('[class*="type-home-select-option-label"]').filter({ hasText: '视频生成' }).first();
    const videoOptVisible = await videoOption.isVisible().catch(() => false);
    console.log(`  "视频生成"选项可见: ${videoOptVisible}`);
    if (videoOptVisible) {
      await videoOption.click();
      await sleep(1000);
      console.log('  ✅ 已切换到视频生成');
    } else {
      // 尝试直接点击文本
      await page.getByText('视频生成').first().click().catch(() => {});
      await sleep(1000);
    }
    
    await page.screenshot({ path: path.join(screenshotDir, '20-video-mode.png') });

    // Step 3: 寻找参数设置区域（展开的那个视图）
    console.log('\n📄 Step 3: 分析展开视图的参数区域...');
    
    const expandedView = await page.evaluate(() => {
      // 找展开的参考组
      const expandedRef = document.querySelector('[class*="reference-group"][class*="expanded"]')
        || document.querySelector('[class*="reference-group-content"][class*="expanded"]');
      
      if (!expandedRef) return { error: '未找到展开的参考区域' };
      
      // 在展开区域的父级容器中查找所有可交互元素
      let container = expandedRef;
      // 向上找到包含所有设置的容器
      for (let i = 0; i < 10 && container.parentElement; i++) {
        container = container.parentElement;
        if (container.children.length > 3) break;
      }
      
      // 收集容器内的所有交互元素信息
      const allElements = [];
      const walk = (el, depth = 0) => {
        if (depth > 8) return;
        const text = Array.from(el.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent.trim())
          .join('');
        
        if (text || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || 
            el.getAttribute('role') || el.className.toString().includes('btn') ||
            el.className.toString().includes('submit') ||
            el.className.toString().includes('generate') ||
            el.className.toString().includes('select') ||
            el.className.toString().includes('tab') ||
            el.className.toString().includes('option') ||
            el.className.toString().includes('ratio') ||
            el.className.toString().includes('duration') ||
            el.className.toString().includes('model')) {
          allElements.push({
            tag: el.tagName,
            text: text.substring(0, 60),
            fullText: el.textContent.trim().substring(0, 100),
            class: (el.className || '').toString().substring(0, 120),
            visible: el.offsetParent !== null || el.offsetWidth > 0,
            clickable: el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.onclick !== null,
            depth,
          });
        }
        
        for (const child of el.children) {
          walk(child, depth + 1);
        }
      };
      
      walk(container);
      return { elements: allElements.filter(e => e.visible), containerClass: container.className.substring(0, 100) };
    });

    if (expandedView.error) {
      console.log(`  ⚠️ ${expandedView.error}`);
    } else {
      console.log(`  容器class: ${expandedView.containerClass}`);
      console.log(`  可见元素 (${expandedView.elements.length}):`);
      expandedView.elements.forEach((el, i) => {
        if (el.text || el.clickable) {
          console.log(`    ${i + 1}. [${el.tag}] d=${el.depth} text="${el.text}" fullText="${el.fullText}" class="${el.class.substring(0, 80)}"`);
        }
      });
    }

    // Step 4: 直接搜索提交/生成按钮（在整个页面中）
    console.log('\n📄 Step 4: 搜索生成/提交按钮...');
    
    const submitSearch = await page.evaluate(() => {
      const results = [];
      
      // 搜索所有包含submit, generate, 生成 相关class的元素
      const submitSelectors = [
        '[class*="submit"]', '[class*="Submit"]',
        '[class*="generate"]', '[class*="Generate"]',
        '[class*="send"]', '[class*="Send"]',
        '[class*="create"]', '[class*="Create"]',
        '[class*="start"]', '[class*="Start"]',
        'button[type="submit"]',
      ];
      
      submitSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          results.push({
            selector: sel,
            tag: el.tagName,
            text: el.textContent.trim().substring(0, 80),
            class: (el.className || '').toString().substring(0, 120),
            visible: el.offsetParent !== null,
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
          });
        });
      });

      // 也搜索包含icon/svg的按钮（生成按钮可能是一个图标按钮）
      const iconBtns = document.querySelectorAll('[class*="submit-button"], [class*="submitButton"], [class*="action-btn"], [class*="action-button"]');
      iconBtns.forEach(el => {
        results.push({
          selector: 'icon-btn',
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 80),
          class: (el.className || '').toString().substring(0, 120),
          visible: el.offsetParent !== null,
          disabled: el.disabled,
          rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
        });
      });

      return results;
    });

    console.log('  提交/生成相关元素:');
    submitSearch.forEach((s, i) => {
      console.log(`    ${i + 1}. [${s.tag}] sel="${s.selector}" text="${s.text}" visible=${s.visible} disabled=${s.disabled} pos=(${s.rect.x},${s.rect.y}) size=${s.rect.w}x${s.rect.h} class="${s.class}"`);
    });

    // Step 5: 搜索collapsed-submit-button相关元素
    console.log('\n📄 Step 5: 查找collapsed-submit-button区域...');
    
    const submitBtnArea = await page.evaluate(() => {
      const containers = document.querySelectorAll('[class*="submit-button-container"], [class*="collapsed-submit"]');
      return Array.from(containers).map(el => {
        // 获取所有子元素
        const children = [];
        const walkChildren = (node, depth = 0) => {
          if (depth > 5) return;
          for (const child of node.children) {
            children.push({
              tag: child.tagName,
              class: (child.className || '').toString().substring(0, 100),
              text: child.textContent.trim().substring(0, 60),
              visible: child.offsetParent !== null,
              rect: (() => { const r = child.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
            });
            walkChildren(child, depth + 1);
          }
        };
        walkChildren(el);
        
        return {
          class: (el.className || '').toString(),
          text: el.textContent.trim().substring(0, 100),
          visible: el.offsetParent !== null,
          rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
          children,
        };
      });
    });

    submitBtnArea.forEach((area, i) => {
      console.log(`  Area ${i + 1}: class="${area.class}" visible=${area.visible} pos=(${area.rect.x},${area.rect.y}) size=${area.rect.w}x${area.rect.h}`);
      area.children.forEach((c, j) => {
        if (c.visible) {
          console.log(`    ${j + 1}. [${c.tag}] text="${c.text}" class="${c.class}" pos=(${c.rect.x},${c.rect.y}) size=${c.rect.w}x${c.rect.h}`);
        }
      });
    });

    // Step 6: 上传图片后再搜索
    console.log('\n📄 Step 6: 上传图片后搜索提交按钮...');
    
    const testImage = path.resolve('images/test-001.png');
    if (fs.existsSync(testImage)) {
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(testImage);
      await sleep(2000);
      await page.screenshot({ path: path.join(screenshotDir, '21-after-upload.png') });
      
      // 再次搜索提交按钮
      const afterUpload = await page.evaluate(() => {
        // 查找所有可见的按钮类元素
        const allClickable = document.querySelectorAll('button, [role="button"], [class*="submit"], [class*="btn"], [class*="generate"]');
        return Array.from(allClickable)
          .filter(el => el.offsetParent !== null && el.getBoundingClientRect().width > 0)
          .map(el => ({
            tag: el.tagName,
            text: el.textContent.trim().substring(0, 60),
            class: (el.className || '').toString().substring(0, 120),
            rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
          }));
      });
      
      console.log('  上传后的可见按钮/可点击元素:');
      afterUpload.forEach((el, i) => {
        console.log(`    ${i + 1}. [${el.tag}] "${el.text}" pos=(${el.rect.x},${el.rect.y}) size=${el.rect.w}x${el.rect.h} class="${el.class}"`);
      });

      // 特别查找底部/右侧的提交区域
      const bottomArea = await page.evaluate(() => {
        // 查找页面底部 y > 600 的所有元素
        const bottom = [];
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const r = el.getBoundingClientRect();
          if (r.y > 500 && r.width > 20 && r.height > 20 && el.offsetParent !== null) {
            const text = el.textContent.trim();
            if (text.length < 100 && text.length > 0 &&
                (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button' ||
                 (el.className || '').toString().includes('btn') ||
                 (el.className || '').toString().includes('submit') ||
                 (el.className || '').toString().includes('send'))) {
              bottom.push({
                tag: el.tagName,
                text,
                class: (el.className || '').toString().substring(0, 100),
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
              });
            }
          }
        }
        return bottom;
      });
      
      console.log('\n  底部区域元素 (y>500):');
      bottomArea.forEach((el, i) => {
        console.log(`    ${i + 1}. [${el.tag}] "${el.text}" pos=(${el.rect.x},${el.rect.y}) size=${el.rect.w}x${el.rect.h} class="${el.class}"`);
      });
    }

    // Step 7: 查找参数面板（模型、比例、时长等）
    console.log('\n📄 Step 7: 查找参数设置面板...');
    
    const paramsPanel = await page.evaluate(() => {
      // 查找右侧面板或设置区域
      const settingsSelectors = [
        '[class*="panel"]', '[class*="Panel"]',
        '[class*="sidebar"]', '[class*="Sidebar"]',
        '[class*="setting"]', '[class*="Setting"]',
        '[class*="config"]', '[class*="Config"]',
        '[class*="param"]', '[class*="Param"]',
        '[class*="option"]', '[class*="Option"]',
        '[class*="toolbar"]', '[class*="Toolbar"]',
      ];
      
      const results = [];
      settingsSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width > 100 && r.height > 50 && el.offsetParent !== null) {
            const text = el.textContent.trim().substring(0, 200);
            if (text.includes('模型') || text.includes('比例') || text.includes('时长') || 
                text.includes('Seedance') || text.includes('9:16') || text.includes('16:9') ||
                text.includes('参考') || text.includes('Fast') || text.includes('模式')) {
              results.push({
                selector: sel,
                tag: el.tagName,
                class: (el.className || '').toString().substring(0, 100),
                text: text.substring(0, 150),
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
              });
            }
          }
        });
      });
      return results;
    });

    console.log('  匹配的参数面板:');
    paramsPanel.forEach((p, i) => {
      console.log(`    ${i + 1}. [${p.tag}] sel="${p.selector}" pos=(${p.rect.x},${p.rect.y}) size=${p.rect.w}x${p.rect.h}`);
      console.log(`       text="${p.text}"`);
      console.log(`       class="${p.class}"`);
    });

    await page.screenshot({ path: path.join(screenshotDir, '29-final-flow.png') });

  } catch (err) {
    console.error('❌ 错误:', err.message);
    console.error(err.stack);
    await page.screenshot({ path: path.join(screenshotDir, 'flow-error.png') }).catch(() => {});
  } finally {
    await context.close();
    console.log('\n✅ 流程测试完成');
  }
})().catch(err => {
  console.error('❌ 致命错误:', err);
  process.exit(1);
});
