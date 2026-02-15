// content.js - 即梦AI页面内容脚本
// 负责在页面中执行实际的参考图上传和生成操作

(function () {
  'use strict';

  // ============================================================
  // 状态管理
  // ============================================================
  let isProcessing = false;
  let currentTaskIndex = -1;

  // ============================================================
  // 消息监听
  // ============================================================
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ success: true, ready: true, processing: isProcessing });
      return false;
    }

    if (msg.action === 'getPageInfo') {
      const info = getPageInfo();
      sendResponse({ success: true, info });
      return false;
    }

    if (msg.action === 'applyPreset') {
      applyPresetParams(msg.preset || {})
        .then(result => sendResponse({ success: true, result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (msg.action === 'generateTask') {
      if (isProcessing) {
        sendResponse({ success: false, error: '正在处理其他任务，请稍候' });
        return false;
      }
      handleGenerateTask(msg)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // keep message channel open for async response
    }

    if (msg.action === 'clearReference') {
      clearReferenceImage()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (msg.action === 'setPrompt') {
      setPrompt(msg.prompt || '')
        .then(() => {
          // 读取编辑器当前 <p> 内容返回用于验证
          const editor = findPromptEditor();
          const p = editor ? editor.querySelector('p') : null;
          const currentText = (p ? p.textContent : (editor ? editor.textContent : '')) || '';
          sendResponse({ success: true, currentText });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (msg.action === 'getPromptText') {
      const editor = findPromptEditor();
      const p = editor ? editor.querySelector('p') : null;
      const currentText = (p ? p.textContent : (editor ? editor.textContent : '')) || '';
      sendResponse({ success: true, currentText, hasEditor: !!editor });
      return false;
    }

    if (msg.action === 'doGenerate') {
      if (isProcessing) {
        sendResponse({ success: false, error: '正在处理其他任务，请稍候' });
        return false;
      }
      doGenerate(msg)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

  // ============================================================
  // 页面信息获取
  // ============================================================
  function getPageInfo() {
    const toolbar = findToolbar();
    const typeSelect = toolbar ? toolbar.querySelector('.lv-select') : null;
    const currentType = typeSelect ? typeSelect.textContent.trim() : '';
    return {
      url: window.location.href,
      isVideoGenMode: currentType === '视频生成',
      currentType,
      hasToolbar: !!toolbar,
      hasFileInput: !!document.querySelector('input[type="file"]'),
      hasSubmitButton: !!document.querySelector('[class*="submit-button"]'),
      hasTextarea: !!findPromptTextarea(),
      hasPromptEditor: !!findPromptEditor(),
      selectCount: toolbar ? toolbar.querySelectorAll('.lv-select').length : 0,
      hasUploadArea: !!document.querySelector('[class*="reference-upload"]'),
      hasPreview: !!document.querySelector('[class*="preview-container"], img[src*="blob:"]'),
    };
  }

  // ============================================================
  // Helper: 查找元素 - 按文本内容
  // ============================================================
  function findByText(selector, text) {
    const els = document.querySelectorAll(selector);
    for (const el of els) {
      if (el.textContent.trim().includes(text)) {
        return el;
      }
    }
    return null;
  }

  // ============================================================
  // Helper: 模拟鼠标点击事件
  // ============================================================
  function simulateClick(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  // ============================================================
  // Helper: 设置 React 受控输入的值
  // ============================================================
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ============================================================
  // Helper: sleep
  // ============================================================
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // Helper: 等待元素出现
  // ============================================================
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(found);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`等待元素超时: ${selector}`));
      }, timeout);
    });
  }

  // ============================================================
  // Helper: 查找非折叠的工具栏
  // ============================================================
  function findToolbar() {
    // 优先找非折叠的 toolbar-settings-content
    const toolbars = document.querySelectorAll('[class*="toolbar-settings-content"]');
    for (const tb of toolbars) {
      if (tb.offsetParent !== null && !tb.className.includes('collapsed')) {
        return tb;
      }
    }
    // fallback: 找任何可见的
    for (const tb of toolbars) {
      if (tb.offsetParent !== null) return tb;
    }
    return null;
  }

  // ============================================================
  // 导航: 确保页面处于 "视频生成" 模式
  // ============================================================
  async function ensureVideoGenerationMode() {
    const toolbar = findToolbar();
    if (!toolbar) {
      // 可能页面还在首页、没有工具栏，尝试点击侧边栏"生成"
      const genNav = findByText('div, span, a', '生成');
      if (genNav && genNav.offsetParent !== null) {
        simulateClick(genNav);
        await sleep(2000);
      }
    }

    // 找到工具栏中的类型选择器 (第一个 .lv-select, 带有 type-select-* 类)
    const toolbar2 = findToolbar();
    if (!toolbar2) {
      throw new Error('未找到工具栏，请确认已打开即梦AI生成页面');
    }

    const selects = toolbar2.querySelectorAll('.lv-select');
    if (selects.length === 0) {
      throw new Error('工具栏中未找到选择器');
    }

    // 检查类型选择器 (第一个 select, 通常带 type-select-* class)
    const typeSelect = selects[0];
    const currentType = typeSelect.textContent.trim();
    console.log(`[Seedance批量] 当前创作类型: "${currentType}"`);

    if (currentType === '视频生成') {
      console.log('[Seedance批量] 已在视频生成模式');
      return true;
    }

    // 点击类型选择器打开下拉
    console.log('[Seedance批量] 切换到视频生成模式...');
    simulateClick(typeSelect);
    await sleep(500);

    // 在弹出的选项中找到 "视频生成"
    const options = document.querySelectorAll('.lv-select-option');
    let clicked = false;
    for (const opt of options) {
      const text = opt.textContent.trim();
      if (text === '视频生成' || text.startsWith('视频生成')) {
        simulateClick(opt);
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      // 备用: 找全局弹出的下拉选项
      const allOpts = document.querySelectorAll('[class*="select-option-label"]');
      for (const opt of allOpts) {
        if (opt.textContent.trim() === '视频生成' && opt.offsetParent !== null) {
          simulateClick(opt);
          clicked = true;
          break;
        }
      }
    }

    if (!clicked) {
      // 关闭下拉
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      throw new Error('未找到"视频生成"选项');
    }

    // 等待页面切换
    await sleep(2000);

    // 验证切换成功
    const toolbar3 = findToolbar();
    if (toolbar3) {
      const newSelects = toolbar3.querySelectorAll('.lv-select');
      const newType = newSelects[0]?.textContent.trim();
      if (newType === '视频生成') {
        console.log('[Seedance批量] 成功切换到视频生成模式');
        return true;
      }
    }

    console.warn('[Seedance批量] 切换后类型验证失败，继续尝试...');
    return true;
  }

  // ============================================================
  // Helper: base64 转 File
  // ============================================================
  function base64ToFile(base64Data, filename, mimeType) {
    const arr = base64Data.split(',');
    const bstr = atob(arr[1]);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new File([u8arr], filename, { type: mimeType });
  }

  // ============================================================
  // Helper: 查找提示词输入框 (必须可见)
  // ============================================================
  // ============================================================
  // Helper: 查找提示词编辑器 (TipTap/ProseMirror contenteditable)
  // ============================================================
  function findPromptEditor() {
    // 即梦AI 使用 TipTap/ProseMirror 富文本编辑器
    // 结构: div[class*="main-content-"] > div[class*="prompt-editor-container-"]
    //        > div[class*="prompt-editor-"]:not([class*="sizer"])
    //          > div[contenteditable="true"].tiptap.ProseMirror

    // 方法1: 在 prompt-editor 容器中找 (排除 sizer)
    const editorWrappers = document.querySelectorAll('[class*="prompt-editor-"]:not([class*="sizer"])');
    for (const wrapper of editorWrappers) {
      const editor = wrapper.querySelector('div[contenteditable="true"].tiptap.ProseMirror');
      if (editor && editor.offsetParent !== null && !editor.closest('#seedance-drawer-container')) {
        const rect = editor.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 10) {
          return editor;
        }
      }
    }

    // 方法2: 直接在 main-content 中找 contenteditable
    const mainContent = document.querySelector('[class*="main-content-"]');
    if (mainContent) {
      const editors = mainContent.querySelectorAll('div[contenteditable="true"].tiptap');
      for (const editor of editors) {
        // 排除 sizer 中的 (sizer 用于高度计算，不是真正的输入)
        if (editor.closest('[class*="sizer"]')) continue;
        if (editor.offsetParent !== null) {
          const rect = editor.getBoundingClientRect();
          if (rect.width > 50 && rect.height > 10) {
            return editor;
          }
        }
      }
    }

    // 方法3: 全局查找 ProseMirror 编辑器 (排除 sizer 和抽屉)
    const allEditors = document.querySelectorAll('div[contenteditable="true"].ProseMirror');
    for (const editor of allEditors) {
      if (editor.closest('[class*="sizer"]')) continue;
      if (editor.closest('#seedance-drawer-container')) continue;
      if (editor.offsetParent !== null) {
        const rect = editor.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 10) {
          return editor;
        }
      }
    }

    // 方法4: 兜底 — 找任何 contenteditable (排除 sizer 和抽屉)
    const allContentEditable = document.querySelectorAll('div[contenteditable="true"]');
    for (const editor of allContentEditable) {
      if (editor.closest('[class*="sizer"]')) continue;
      if (editor.closest('#seedance-drawer-container')) continue;
      if (editor.offsetParent !== null) {
        const rect = editor.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 10) {
          return editor;
        }
      }
    }

    return null;
  }

  // 保留旧函数名兼容
  function findPromptTextarea() {
    return findPromptEditor();
  }

  // ============================================================
  // Helper: 查找上传入口 (file input)
  // ============================================================
  function findUploadTarget() {
    const inputs = document.querySelectorAll('input[type="file"]');
    
    // 优先选择 parent reference-upload 容器可见的 file input
    // 页面上有多个 display:none 的 file input, 只有一个的父容器是可见的
    let bestMatch = null;
    let fallbackMatch = null;
    
    for (const input of inputs) {
      const acceptsMedia = input.accept && (input.accept.includes('image') || input.accept.includes('video'));
      if (!acceptsMedia) continue;
      
      // 检查 reference-upload 父容器是否可见
      const refParent = input.closest('[class*="reference-upload"]');
      if (refParent) {
        const rect = refParent.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          console.log(`[Seedance批量] findUploadTarget: 选择可见容器中的 input, parent rect=(${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)}x${Math.round(rect.height)})`);
          bestMatch = input;
          break;
        }
      }
      
      // 备选: 检查 input 自身或任意祖先是否可见
      if (!fallbackMatch) {
        // 逐级往上找到第一个有尺寸的容器
        let el = input.parentElement;
        while (el && el !== document.body) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            fallbackMatch = input;
            break;
          }
          el = el.parentElement;
        }
      }
    }
    
    if (bestMatch) return bestMatch;
    if (fallbackMatch) {
      console.log('[Seedance批量] findUploadTarget: 使用 fallback 可见祖先 input');
      return fallbackMatch;
    }
    
    // 最后的 fallback: 返回最后一个 accept media 的 input (通常靠后的是可见区域的)
    for (let i = inputs.length - 1; i >= 0; i--) {
      const input = inputs[i];
      if (input.accept && (input.accept.includes('image') || input.accept.includes('video'))) {
        console.log('[Seedance批量] findUploadTarget: 使用最后一个 media input (fallback)');
        return input;
      }
    }
    
    if (inputs.length > 0) return inputs[inputs.length - 1];
    return null;
  }

  // ============================================================
  // Helper: 查找生成/提交按钮
  // ============================================================
  function findSubmitButton() {
    // 方法1: class 包含 submit-button
    const submitBtn = document.querySelector('[class*="submit-button"]:not([class*="collapsed-WjKggt"])');
    if (submitBtn && submitBtn.offsetParent !== null) return submitBtn;

    // 方法2: 在 submit-button-container 中找按钮
    const container = document.querySelector('[class*="collapsed-submit-button-container"]:not([class*="collapsed-WjKggt"])');
    if (container) {
      const btn = container.querySelector('button');
      if (btn) return btn;
    }

    // 方法3: 找所有 submit 相关按钮
    const allSubmit = document.querySelectorAll('button[class*="submit"]');
    for (const btn of allSubmit) {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 20 && rect.height > 20 && btn.offsetParent !== null) {
        return btn;
      }
    }

    // 方法4: 按文本查找
    const textBtn = findByText('button, div[role="button"]', '生成')
      || findByText('button, div[role="button"]', '立即生成');
    if (textBtn) {
      let btn = textBtn;
      while (btn && btn.tagName !== 'BUTTON' && !btn.getAttribute('role')) {
        btn = btn.parentElement;
      }
      return btn || textBtn;
    }

    return null;
  }

  // ============================================================
  // 上传参考图
  // ============================================================
  async function uploadReferenceImage(fileData) {
    const file = base64ToFile(fileData.data, fileData.name, fileData.type);
    console.log(`[Seedance批量] 准备上传参考图: ${fileData.name} (${file.size} bytes, ${file.type})`);

    // 诊断: 列出页面上所有 file input
    const allInputs = document.querySelectorAll('input[type="file"]');
    console.log(`[Seedance批量] 页面中共有 ${allInputs.length} 个 file input:`);
    allInputs.forEach((inp, i) => {
      const rect = inp.getBoundingClientRect();
      console.log(`  [${i}] accept="${inp.accept}" visible=${inp.offsetParent !== null} rect=(${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)}x${Math.round(rect.height)}) parent=${inp.parentElement?.className?.substring(0, 50)}`);
    });

    // 尝试点击"添加参考图"或相关按钮
    const refButtonTexts = ['添加参考图', '上传图片', '添加参考', '上传参考图', '首帧', '尾帧', '添加图片'];
    let clickedRefBtn = false;
    for (const text of refButtonTexts) {
      const btn = findByText('span, div, button, p, a', text);
      if (btn && btn.offsetParent !== null) {
        console.log(`[Seedance批量] 点击参考图按钮: "${text}"`);
        simulateClick(btn);
        clickedRefBtn = true;
        await sleep(800);
        break;
      }
    }
    if (!clickedRefBtn) {
      console.log('[Seedance批量] 未找到"添加参考图"按钮，直接查找 file input');
    }

    // 通过 file input 上传
    const fileInput = findUploadTarget();
    if (fileInput) {
      const parentCls = fileInput.parentElement?.className?.substring(0, 50) || '';
      const refParent = fileInput.closest('[class*="reference-upload"]');
      const refRect = refParent ? refParent.getBoundingClientRect() : null;
      console.log(`[Seedance批量] 找到 file input: accept="${fileInput.accept}" parent="${parentCls}"`);
      if (refRect) {
        console.log(`[Seedance批量] reference-upload 容器 rect=(${Math.round(refRect.x)},${Math.round(refRect.y)},${Math.round(refRect.width)}x${Math.round(refRect.height)})`);
      }
      
      const dt = new DataTransfer();
      dt.items.add(file);
      
      // 使用 Object.getOwnPropertyDescriptor 设置 files (兼容 React/框架)
      const nativeInputFileSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'files'
      )?.set;
      if (nativeInputFileSetter) {
        nativeInputFileSetter.call(fileInput, dt.files);
        console.log('[Seedance批量] 使用 native setter 设置 files');
      } else {
        fileInput.files = dt.files;
        console.log('[Seedance批量] 使用直接赋值设置 files');
      }
      
      // 触发多种事件以确保框架捕获
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      console.log(`[Seedance批量] 已通过 input 上传: ${fileData.name}, files.length=${fileInput.files.length}`);
      await sleep(2000);

      // 验证上传是否成功: 检查页面中是否出现了预览图
      const hasPreview = !!document.querySelector(
        '[class*="preview-container"], [class*="preview-image"], img[src*="blob:"], ' +
        '[class*="uploaded"], [class*="image-preview"], ' + 
        '[class*="reference-image-"], [class*="reference-item-"]'
      );
      console.log(`[Seedance批量] 上传后预览检测: ${hasPreview}`);

      return true;
    }

    // 尝试拖放上传
    console.log('[Seedance批量] 未找到 file input，尝试拖放上传...');
    const dropSelectors = [
      '[class*="reference-upload"]',
      '[class*="upload-area"]',
      '[class*="drop-zone"]',
      '[class*="upload"]',
      '[class*="drop"]',
      '[class*="reference"]',
    ];
    for (const sel of dropSelectors) {
      const dropZone = document.querySelector(sel);
      if (dropZone && dropZone.offsetParent !== null) {
        const dtTransfer = new DataTransfer();
        dtTransfer.items.add(file);

        dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dtTransfer }));
        dropZone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dtTransfer }));
        dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dtTransfer }));
        console.log(`[Seedance批量] 已通过拖放上传: ${fileData.name} (${sel})`);
        await sleep(2000);
        return true;
      }
    }

    throw new Error('未找到上传入口 (无 file input，无拖放区域)');
  }

  // ============================================================
  // 填写提示词
  // ============================================================
  async function setPrompt(prompt) {
    if (!prompt) return;

    const editor = findPromptEditor();
    if (!editor) {
      console.warn('[Seedance批量] 未找到提示词编辑器');
      return;
    }

    console.log(`[Seedance批量] 找到提示词编辑器: tag=${editor.tagName} cls=${editor.className.substring(0, 60)}`);
    console.log(`[Seedance批量] 要填入的提示词: "${prompt.substring(0, 40)}"`);

    // 辅助: 获取编辑器当前文本内容 (从 <p> 标签读取)
    function getEditorText() {
      const p = editor.querySelector('p');
      return (p ? p.textContent : editor.textContent) || '';
    }

    // 辅助: 检查提示词是否已正确填入
    function isPromptSet() {
      const text = getEditorText();
      return text.includes(prompt.substring(0, Math.min(10, prompt.length)));
    }

    // Step 1: 点击编辑器获得焦点
    editor.scrollIntoView({ block: 'center' });
    await sleep(200);
    simulateClick(editor);
    await sleep(300);
    editor.focus();
    await sleep(200);

    // Step 2: 选中全部内容 (Ctrl+A)
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    document.execCommand('selectAll', false, null);
    editor.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true,
    }));
    await sleep(200);

    // Step 3: 用 Backspace 删除所有选中内容
    const currentText = getEditorText();
    if (currentText.length > 0) {
      // 先尝试 execCommand delete 删除选中
      document.execCommand('delete', false, null);
      await sleep(200);

      // 如果还有内容，逐字 Backspace
      let remaining = getEditorText();
      let maxDelete = remaining.length + 5;
      while (remaining.length > 0 && maxDelete > 0) {
        editor.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true, cancelable: true,
        }));
        editor.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'deleteContentBackward', bubbles: true, cancelable: true,
        }));
        document.execCommand('delete', false, null);
        editor.dispatchEvent(new InputEvent('input', {
          inputType: 'deleteContentBackward', bubbles: true,
        }));
        editor.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true,
        }));
        await sleep(10);
        remaining = getEditorText();
        maxDelete--;
      }
      await sleep(200);
      console.log(`[Seedance批量] 清空后编辑器内容: "${getEditorText()}"`);
    }

    // Step 4: 逐字键盘输入提示词
    for (const char of prompt) {
      // keydown
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: char, code: `Key${char.toUpperCase()}`,
        keyCode: char.charCodeAt(0), bubbles: true, cancelable: true,
      }));
      // beforeinput
      editor.dispatchEvent(new InputEvent('beforeinput', {
        data: char, inputType: 'insertText', bubbles: true, cancelable: true,
      }));
      // 使用 execCommand insertText 让 ProseMirror 处理
      document.execCommand('insertText', false, char);
      // input
      editor.dispatchEvent(new InputEvent('input', {
        data: char, inputType: 'insertText', bubbles: true,
      }));
      // keyup
      editor.dispatchEvent(new KeyboardEvent('keyup', {
        key: char, code: `Key${char.toUpperCase()}`,
        keyCode: char.charCodeAt(0), bubbles: true,
      }));
      await sleep(15);
    }
    await sleep(500);

    // Step 5: 验证结果
    const resultText = getEditorText();
    console.log(`[Seedance批量] 输入后 <p> 内容: "${resultText.substring(0, 50)}"`);

    if (isPromptSet()) {
      console.log('[Seedance批量] ✅ 提示词已成功设置 (键盘逐字输入)');
      return;
    }

    // ---- 兜底方式: 直接操作 ProseMirror DOM ----
    console.log('[Seedance批量] 键盘输入未生效，尝试直接操作 DOM...');
    const p = editor.querySelector('p');
    if (p) {
      p.textContent = prompt;
    } else {
      editor.innerHTML = `<p>${prompt}</p>`;
    }
    // 触发 input 事件让 ProseMirror 同步状态
    editor.dispatchEvent(new InputEvent('input', {
      data: prompt, inputType: 'insertText', bubbles: true,
    }));
    await sleep(500);

    const finalText = getEditorText();
    console.log(`[Seedance批量] DOM 操作后 <p> 内容: "${finalText.substring(0, 50)}"`);

    if (finalText.includes(prompt.substring(0, Math.min(10, prompt.length)))) {
      console.log('[Seedance批量] ✅ 提示词已设置 (DOM 直接操作)');
    } else {
      console.warn(`[Seedance批量] ⚠️ 提示词填充可能失败! 当前内容: "${finalText.substring(0, 50)}"`);
    }
  }

  // ============================================================
  // 从 @ 弹窗读取 UUID + 构建带 mention 的文档
  // 通过 mention-main-world.js (MAIN world 脚本, manifest 注册) 执行
  // 使用 window.postMessage 跨 world 通信
  // segments: 已解析的段落数组 [{type, value, fileIndex?}, ...]
  // ============================================================
  function insertDocWithMentionUUIDs(resolvedSegments) {
    return new Promise((resolve) => {
      const eventName = '__seedance_mention_doc_' + Date.now();

      // 监听 MAIN world 通过 window.postMessage 返回的结果
      const handler = (e) => {
        if (!e.data || e.data.type !== eventName) return;
        window.removeEventListener('message', handler);
        clearTimeout(timeoutId);
        const detail = e.data.detail || { success: false, error: 'no detail' };
        console.log(`[Seedance批量] [Mention] postMessage 收到结果: success=${detail.success}, mention=${detail.mentionCount || 0}, uuid=${detail.uuidCount || 0}`);
        resolve(detail);
      };
      window.addEventListener('message', handler);

      // 发送消息给 MAIN world 脚本 (mention-main-world.js)
      console.log(`[Seedance批量] [Mention] 发送构建请求到 MAIN world, segments=${resolvedSegments.length}`);
      window.postMessage({
        type: 'seedance-build-mention-doc',
        segments: resolvedSegments,
        eventName: eventName,
      }, '*');

      // 全局超时 (MAIN world 中的 setTimeout 链可能需要 ~8s)
      const timeoutId = setTimeout(() => {
        window.removeEventListener('message', handler);
        console.warn('[Seedance批量] [Mention] 超时 (15s)');
        resolve({ success: false, error: 'timeout (15s)' });
      }, 15000);
    });
  }

  // ============================================================
  // 填写提示词（支持 @mention 引用）
  // 提示词中 "@XXX" 会通过 ProseMirror API 直接插入 reference-mention-tag 节点
  // 例如: "一个女孩 (@图片1) 在跳舞" → 文本"一个女孩 " + mention(图片1的UUID) + 文本" 在跳舞"
  // ============================================================
  async function setPromptWithMentions(promptRaw, fileList) {
    if (!promptRaw) return;

    const editor = findPromptEditor();
    if (!editor) {
      console.warn('[Seedance批量] 未找到提示词编辑器');
      return;
    }

    console.log(`[Seedance批量] [Mention] 找到编辑器: tag=${editor.tagName}`);
    console.log(`[Seedance批量] [Mention] 原始提示词: "${promptRaw.substring(0, 120)}"`);

    // ----------------------------------------------------------------
    // 构建文件名 → 弹窗序号的映射
    // reference-mention-tag 的 id 属性是 UUID，需从 @ 弹窗的 React Fiber 中读取
    // ----------------------------------------------------------------
    const fileNameToIndex = new Map();
    let imgCounter = 0;
    let vidCounter = 0;
    if (fileList && fileList.length > 0) {
      for (let i = 0; i < fileList.length; i++) {
        const fd = fileList[i];
        const fname = fd.name;
        const isVideo = fd.type && fd.type.startsWith('video/');
        const label = isVideo ? `视频${++vidCounter}` : `图片${++imgCounter}`;

        fileNameToIndex.set(fname, i);
        const nameNoExt = fname.replace(/\.[^.]+$/, '');
        if (nameNoExt !== fname) fileNameToIndex.set(nameNoExt, i);
        fileNameToIndex.set(label, i);

        console.log(`[Seedance批量] [Mention] 文件[${i}]: "${fname}" → 标签 "${label}" (index=${i})`);
      }
    }

    // ----------------------------------------------------------------
    // 解析提示词中的 @mention
    // 支持: @XXX, (@XXX), （@XXX）
    // ----------------------------------------------------------------
    const mentionRegex = /[（(]@(\S+?)[）)]|@(\S+)/g;
    const segments = [];
    let lastIndex = 0;
    let match;
    while ((match = mentionRegex.exec(promptRaw)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', value: promptRaw.substring(lastIndex, match.index) });
      }
      const mentionValue = match[1] || match[2];
      segments.push({ type: 'mention', value: mentionValue });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < promptRaw.length) {
      segments.push({ type: 'text', value: promptRaw.substring(lastIndex) });
    }

    console.log(`[Seedance批量] [Mention] 解析得到 ${segments.length} 个段落:`);
    segments.forEach((s, i) => console.log(`  [${i}] ${s.type}: "${s.value.substring(0, 40)}"`));

    // 如果没有 mention，直接用普通 setPrompt
    if (!segments.some(s => s.type === 'mention')) {
      console.log('[Seedance批量] [Mention] 无 @mention，使用普通 setPrompt');
      await setPrompt(promptRaw);
      return;
    }

    // ----------------------------------------------------------------
    // 将 mention value 解析为 reference index
    // ----------------------------------------------------------------
    let mentionCounter = 0;
    const resolvedSegments = segments.map(seg => {
      if (seg.type !== 'mention') return seg;
      let fileIndex = fileNameToIndex.get(seg.value);
      if (fileIndex === undefined) {
        for (const [key, idx] of fileNameToIndex) {
          if (key.toLowerCase() === seg.value.toLowerCase()) {
            fileIndex = idx;
            break;
          }
        }
      }
      if (fileIndex === undefined) {
        fileIndex = mentionCounter;
        console.log(`[Seedance批量] [Mention] "${seg.value}" 未在映射中找到，按顺序使用索引 ${fileIndex}`);
      } else {
        console.log(`[Seedance批量] [Mention] "${seg.value}" → 文件索引 ${fileIndex}`);
      }
      mentionCounter++;
      return { type: 'mention', value: seg.value, fileIndex };
    });

    // ----------------------------------------------------------------
    // 从 @ 弹窗读取每个上传文件的真实 UUID
    // mention 的 id 属性必须是网站分配的 UUID，不能用简单的 0-based 索引
    // 然后直接在 MAIN world 中构建完整文档 (全部在一个脚本中完成)
    // ----------------------------------------------------------------
    const result = await insertDocWithMentionUUIDs(resolvedSegments);

    if (result.success) {
      console.log(`[Seedance批量] [Mention] ✅ 提示词插入成功`);
      console.log(`[Seedance批量] [Mention] 编辑器内容: "${result.text?.substring(0, 80)}"`);
      console.log(`[Seedance批量] [Mention] mention=${result.mentionCount}, uuid=${result.uuidCount}`);
    } else {
      console.warn(`[Seedance批量] [Mention] ⚠️ 插入失败: ${result.error}`);
      console.log('[Seedance批量] [Mention] 回退: 使用普通 setPrompt (不含 mention 标签)');
      // 回退: 去掉 @mention 标记, 直接填文本
      const plainText = promptRaw.replace(/[（(]@(\S+?)[）)]/g, '$1').replace(/@(\S+)/g, '$1');
      await setPrompt(plainText);
    }
  }

  // ============================================================
  // doGenerate: 清除旧图 → 一次性上传所有参考文件 → 填写提示词（不点击生成）
  // files: 文件数据数组 [{name, data, type}, ...]
  // prompt: 提示词文本（支持 @mention）
  // ============================================================
  async function doGenerate(msg) {
    const { files, fileData, prompt } = msg;

    // 兼容旧的单文件调用方式
    const fileList = files || (fileData ? [fileData] : []);

    isProcessing = true;
    currentTaskIndex = 0;

    try {
      console.log(`[Seedance批量] [doGenerate] 开始: ${fileList.length} 个文件`);
      console.log(`[Seedance批量] [doGenerate] 提示词: "${prompt || '(无)'}"`);

      // Step 0: 确保在视频生成模式
      await ensureVideoGenerationMode();
      await sleep(500);

      // Step 1: 清除所有已上传的参考图
      console.log('[Seedance批量] [doGenerate] Step 1: 清除所有已上传的参考图');
      await clearAllReferenceImages();
      await sleep(500);

      // Step 2: 一次性上传所有参考文件
      if (fileList.length > 0) {
        console.log(`[Seedance批量] [doGenerate] Step 2: 一次性上传 ${fileList.length} 个文件`);
        await uploadAllReferenceFiles(fileList);
        console.log(`[Seedance批量] [doGenerate] Step 2 完成: 已上传 ${fileList.length} 个文件`);
      } else {
        console.log('[Seedance批量] [doGenerate] Step 2: 无参考文件，跳过');
      }

      // Step 3: 填写提示词（@mention 会自动映射到上传顺序）
      if (prompt) {
        console.log('[Seedance批量] [doGenerate] Step 3: 填写提示词 (含 @mention 解析)');
        await setPromptWithMentions(prompt, fileList);

        // 验证
        const editor = findPromptEditor();
        if (editor) {
          const currentText = (editor.querySelector('p')?.textContent || editor.textContent || '');
          console.log(`[Seedance批量] [doGenerate] Step 3 完成, 编辑器内容: "${currentText.substring(0, 60)}"`);
        }
      } else {
        console.log('[Seedance批量] [doGenerate] Step 3: 无提示词，跳过');
      }

      // 不点击生成按钮，仅上传并填写提示词
      console.log(`[Seedance批量] [doGenerate] ✅ 全部完成: ${fileList.length} 个文件已上传, 提示词已填写`);
    } finally {
      isProcessing = false;
      currentTaskIndex = -1;
    }
  }

  // ============================================================
  // 一次性上传所有参考文件 (通过一个 DataTransfer 包含多个 File)
  // ============================================================
  async function uploadAllReferenceFiles(fileList) {
    // 将所有 base64 文件转为 File 对象
    const allFiles = fileList.map(fd => base64ToFile(fd.data, fd.name, fd.type));
    console.log(`[Seedance批量] 准备一次性上传 ${allFiles.length} 个文件: ${allFiles.map(f => f.name).join(', ')}`);

    // 尝试点击"添加参考图"或相关按钮
    const refButtonTexts = ['添加参考图', '上传图片', '添加参考', '上传参考图', '首帧', '尾帧', '添加图片'];
    let clickedRefBtn = false;
    for (const text of refButtonTexts) {
      const btn = findByText('span, div, button, p, a', text);
      if (btn && btn.offsetParent !== null) {
        console.log(`[Seedance批量] 点击参考图按钮: "${text}"`);
        simulateClick(btn);
        clickedRefBtn = true;
        await sleep(800);
        break;
      }
    }
    if (!clickedRefBtn) {
      console.log('[Seedance批量] 未找到"添加参考图"按钮，直接查找 file input');
    }

    // 通过 file input 上传
    const fileInput = findUploadTarget();
    if (fileInput) {
      const dt = new DataTransfer();
      for (const file of allFiles) {
        dt.items.add(file);
      }

      // 使用 Object.getOwnPropertyDescriptor 设置 files (兼容 React/框架)
      const nativeInputFileSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'files'
      )?.set;
      if (nativeInputFileSetter) {
        nativeInputFileSetter.call(fileInput, dt.files);
        console.log(`[Seedance批量] 使用 native setter 一次性设置 ${dt.files.length} 个文件`);
      } else {
        fileInput.files = dt.files;
        console.log(`[Seedance批量] 使用直接赋值设置 ${dt.files.length} 个文件`);
      }

      // 触发多种事件以确保框架捕获
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      console.log(`[Seedance批量] 已通过 input 一次性上传 ${allFiles.length} 个文件`);
      // 等待所有文件上传完成
      await sleep(2000 + allFiles.length * 500);

      return true;
    }

    // 尝试拖放上传
    console.log('[Seedance批量] 未找到 file input，尝试拖放上传...');
    const dropSelectors = [
      '[class*="reference-upload"]',
      '[class*="upload-area"]',
      '[class*="drop-zone"]',
      '[class*="upload"]',
    ];
    for (const sel of dropSelectors) {
      const dropZone = document.querySelector(sel);
      if (dropZone && dropZone.offsetParent !== null) {
        const dtTransfer = new DataTransfer();
        for (const file of allFiles) {
          dtTransfer.items.add(file);
        }
        dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dtTransfer }));
        dropZone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dtTransfer }));
        dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dtTransfer }));
        console.log(`[Seedance批量] 已通过拖放上传 ${allFiles.length} 个文件 (${sel})`);
        await sleep(2000 + allFiles.length * 500);
        return true;
      }
    }

    throw new Error('未找到上传入口 (无 file input，无拖放区域)');
  }

  // ============================================================
  // 点击生成按钮
  // ============================================================
  async function clickGenerate() {
    const btn = findSubmitButton();
    if (!btn) {
      throw new Error('未找到生成按钮');
    }

    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
      console.warn('[Seedance批量] 生成按钮当前禁用');
    }

    simulateClick(btn);
    console.log('[Seedance批量] 已点击生成按钮');
    await sleep(2000);
  }

  // ============================================================
  // 清除已上传的参考图
  // ============================================================
  async function clearReferenceImage() {
    const selectors = [
      '[class*="delete"]',
      '[class*="Delete"]',
      '[class*="remove"]',
      '[class*="Remove"]',
      '[class*="preview"] [class*="close"]',
      '[class*="preview"] [class*="delete"]',
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        simulateClick(btn);
        console.log(`[Seedance批量] 已清除参考图 (${sel})`);
        await sleep(500);
        return true;
      }
    }

    // hover swap 按钮后清除
    const swapBtn = document.querySelector('[class*="swap-button"]');
    if (swapBtn && swapBtn.offsetParent !== null) {
      swapBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      swapBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await sleep(400);

      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          simulateClick(btn);
          console.log('[Seedance批量] 已清除参考图 (hover后)');
          await sleep(500);
          return true;
        }
      }
    }

    const removeBtn = findByText('span, div, button', '删除')
      || findByText('span, div, button', '移除');
    if (removeBtn) {
      simulateClick(removeBtn);
      console.log('[Seedance批量] 已清除参考图 (文本)');
      await sleep(500);
      return true;
    }

    console.log('[Seedance批量] 未找到清除按钮');
    return false;
  }

  // ============================================================
  // 清除所有已上传的参考图（循环调用直到没有可删除的为止）
  // ============================================================
  async function clearAllReferenceImages() {
    console.log('[Seedance批量] 开始清除所有已上传的参考图...');
    let cleared = 0;
    const maxAttempts = 20; // 防止死循环
    for (let i = 0; i < maxAttempts; i++) {
      const found = await clearReferenceImage();
      if (!found) break;
      cleared++;
      await sleep(300);
    }
    console.log(`[Seedance批量] 共清除 ${cleared} 张参考图`);
    return cleared;
  }

  // ============================================================
  // 应用预设参数
  // ============================================================
  async function applyPresetParams(preset) {
    const results = {};

    // Step 0: 确保处于视频生成模式
    try {
      await ensureVideoGenerationMode();
      results.navigation = true;
    } catch (e) {
      console.error('[Seedance批量] 导航失败:', e.message);
      return { error: e.message };
    }

    await sleep(500);

    const toolbar = findToolbar();
    if (!toolbar) {
      return { warning: '切换后未找到工具栏' };
    }

    // 获取工具栏中的4个 select:
    // [0] = 创作类型 (视频生成), [1] = 模型, [2] = 参考模式, [3] = 时长
    const selects = toolbar.querySelectorAll('.lv-select');
    console.log(`[Seedance批量] 工具栏中找到 ${selects.length} 个选择器`);

    async function selectOption(selectEl, targetText, label) {
      if (!selectEl) {
        console.warn(`[Seedance批量] ${label}: 选择器不存在`);
        return false;
      }

      const currentText = selectEl.textContent.trim();
      // 使用精确匹配，避免 "15s".includes("5s") 误判
      if (currentText === targetText) {
        console.log(`[Seedance批量] ${label}: 已是 "${targetText}"`);
        return true;
      }

      console.log(`[Seedance批量] ${label}: "${currentText}" → "${targetText}"`);
      simulateClick(selectEl);
      await sleep(500);

      // 查找弹出的下拉选项
      const options = document.querySelectorAll('.lv-select-option');
      for (const opt of options) {
        const optText = opt.textContent.trim();
        // 使用 startsWith 匹配（因为选项可能包含描述文本）
        if (optText === targetText || optText.startsWith(targetText)) {
          simulateClick(opt);
          await sleep(300);
          console.log(`[Seedance批量] ${label}: 已选择 "${targetText}"`);
          return true;
        }
      }

      // 备用: 查找所有可见元素
      const allEls = document.querySelectorAll('[class*="select-option-label"]');
      for (const el of allEls) {
        const elText = el.textContent.trim();
        if ((elText === targetText || elText.startsWith(targetText)) && el.offsetParent !== null) {
          simulateClick(el);
          await sleep(300);
          console.log(`[Seedance批量] ${label}: 备用方式选择 "${targetText}"`);
          return true;
        }
      }

      // 关闭下拉
      document.body.click();
      await sleep(200);
      console.warn(`[Seedance批量] ${label}: 未找到选项 "${targetText}"`);
      return false;
    }

    // Step 1: 设置模型 (select index 1)
    if (preset.model && selects.length > 1) {
      results.model = await selectOption(selects[1], preset.model, '模型');
      await sleep(400);
    }

    // Step 2: 设置参考模式 (select index 2)
    if (preset.referenceMode && selects.length > 2) {
      results.referenceMode = await selectOption(selects[2], preset.referenceMode, '参考模式');
      await sleep(400);
    }

    // Step 3: 设置画面比例 (toolbar button, not a select)
    if (preset.aspectRatio) {
      const ratioBtn = toolbar.querySelector('button[class*="toolbar-button"]');
      if (ratioBtn) {
        const currentRatio = ratioBtn.textContent.trim();
        if (currentRatio === preset.aspectRatio) {
          console.log(`[Seedance批量] 比例: 已是 "${preset.aspectRatio}"`);
          results.aspectRatio = true;
        } else {
          console.log(`[Seedance批量] 比例: "${currentRatio}" → "${preset.aspectRatio}"`);
          simulateClick(ratioBtn);
          await sleep(500);

          // 查找比例选项 (span.label-* 在弹出面板中)
          let ratioSet = false;
          const ratioLabels = document.querySelectorAll('[class*="label-"]');
          for (const label of ratioLabels) {
            if (label.textContent.trim() === preset.aspectRatio && label.offsetParent !== null) {
              // 点击父元素（比例选项容器）
              const clickTarget = label.closest('[class*="ratio-option"]') || label.parentElement || label;
              simulateClick(clickTarget);
              ratioSet = true;
              break;
            }
          }

          if (!ratioSet) {
            // 备用: 找任何包含比例文本的可点击元素
            const allEls = document.querySelectorAll('div, span, button');
            for (const el of allEls) {
              if (el.textContent.trim() === preset.aspectRatio && el.offsetParent !== null) {
                const rect = el.getBoundingClientRect();
                // 只点击比例弹出面板中的元素 (位置在工具栏下方)
                if (rect.y > 350 && rect.height < 50) {
                  simulateClick(el);
                  ratioSet = true;
                  break;
                }
              }
            }
          }

          results.aspectRatio = ratioSet;
          if (ratioSet) {
            console.log(`[Seedance批量] 比例: 已选择 "${preset.aspectRatio}"`);
          } else {
            console.warn(`[Seedance批量] 比例: 未找到选项 "${preset.aspectRatio}"`);
            document.body.click(); // 关闭弹出
          }
          await sleep(400);
        }
      } else {
        console.warn('[Seedance批量] 未找到比例按钮');
        results.aspectRatio = false;
      }
    }

    // Step 4: 设置视频时长 (select index 3)
    if (preset.duration && selects.length > 3) {
      results.duration = await selectOption(selects[3], preset.duration, '时长');
      await sleep(400);
    }

    console.log('[Seedance批量] 预设参数已应用:', results);
    return results;
  }

  // ============================================================
  // 主处理: 单个生成任务
  // ============================================================
  async function handleGenerateTask(msg) {
    const { fileData, prompt, index, total } = msg;

    isProcessing = true;
    currentTaskIndex = index;

    try {
      console.log(`[Seedance批量] 处理任务 ${index + 1}/${total}: ${fileData.name}`);
      console.log(`[Seedance批量] 收到提示词: "${prompt || '(无)'}"`);

      // Step 0: 确保在视频生成模式（仅第一个任务时检查）
      if (index === 0) {
        await ensureVideoGenerationMode();
        await sleep(500);
      }

      // Step 1: 上传参考图
      await sleep(500);
      await uploadReferenceImage(fileData);

      // Step 2: 设置提示词 (最后设置，在点击生成之前)
      if (prompt) {
        console.log(`[Seedance批量] [Step 2] 开始设置提示词: "${prompt.substring(0, 40)}"`);
        await setPrompt(prompt);
        // 验证提示词是否设置成功
        const editor = findPromptEditor();
        if (editor) {
          const p = editor.querySelector('p');
          const currentText = (p ? p.textContent : editor.textContent) || '';
          console.log(`[Seedance批量] [Step 2] 设置后编辑器 <p> 内容: "${currentText.substring(0, 50)}"`);
          if (currentText.includes(prompt.substring(0, Math.min(10, prompt.length)))) {
            console.log(`[Seedance批量] [Step 2] ✅ 提示词已确认一致`);
          } else {
            console.warn(`[Seedance批量] [Step 2] ⚠️ 提示词不一致! 期望: "${prompt.substring(0, 30)}" 实际: "${currentText.substring(0, 30)}"`);
          }
        } else {
          console.warn(`[Seedance批量] [Step 2] ⚠️ 设置后找不到编辑器`);
        }
      } else {
        console.log(`[Seedance批量] [Step 2] 无提示词，跳过`);
      }

      // Step 3: 点击生成 (提示词已在上一步设置完毕)
      await sleep(500);
      await clickGenerate();

      // Step 4: 等待任务提交
      await sleep(1000);

      // Step 5: 如果不是最后一个任务，清除参考图
      if (index < total - 1) {
        await clearReferenceImage();
      }

      console.log(`[Seedance批量] 任务 ${index + 1} 完成`);
    } finally {
      isProcessing = false;
      currentTaskIndex = -1;
    }
  }

  // ============================================================
  // 侧边抽屉 UI 注入
  // ============================================================
  let drawerOpen = false;
  let drawerContainer = null;
  let drawerToggleBtn = null;

  function createDrawer() {
    if (drawerContainer) return;

    // 创建抽屉容器 (fixed 定位在右侧)
    drawerContainer = document.createElement('div');
    drawerContainer.id = 'seedance-drawer-container';
    drawerContainer.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: 360px;
      height: 100vh;
      z-index: 2147483647;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: -4px 0 20px rgba(0,0,0,0.4);
      pointer-events: auto;
    `;

    // 创建 iframe 加载 panel.html
    const iframe = document.createElement('iframe');
    iframe.id = 'seedance-drawer-iframe';
    iframe.src = chrome.runtime.getURL('panel.html');
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      background: #1a1a2e;
    `;
    drawerContainer.appendChild(iframe);
    document.body.appendChild(drawerContainer);

    // 创建悬浮切换按钮
    drawerToggleBtn = document.createElement('div');
    drawerToggleBtn.id = 'seedance-drawer-toggle';
    drawerToggleBtn.innerHTML = '🎬';
    drawerToggleBtn.title = 'Seedance 批量生成助手';
    drawerToggleBtn.style.cssText = `
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 36px;
      height: 72px;
      background: linear-gradient(135deg, #e94560, #c23152);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2147483646;
      border-radius: 8px 0 0 8px;
      font-size: 18px;
      box-shadow: -2px 0 10px rgba(233, 69, 96, 0.3);
      transition: all 0.3s;
      user-select: none;
      pointer-events: auto;
    `;
    drawerToggleBtn.addEventListener('mouseenter', () => {
      if (!drawerOpen) {
        drawerToggleBtn.style.width = '42px';
        drawerToggleBtn.style.boxShadow = '-3px 0 15px rgba(233, 69, 96, 0.5)';
      }
    });
    drawerToggleBtn.addEventListener('mouseleave', () => {
      if (!drawerOpen) {
        drawerToggleBtn.style.width = '36px';
        drawerToggleBtn.style.boxShadow = '-2px 0 10px rgba(233, 69, 96, 0.3)';
      }
    });
    drawerToggleBtn.addEventListener('click', toggleDrawer);
    document.body.appendChild(drawerToggleBtn);

    // 监听来自 iframe (panel.js) 的消息
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SEEDANCE_DRAWER_TOGGLE') {
        if (e.data.open === false) {
          closeDrawer();
        } else {
          toggleDrawer();
        }
      }
    });
  }

  function toggleDrawer() {
    if (drawerOpen) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  function openDrawer() {
    if (!drawerContainer) createDrawer();
    drawerOpen = true;
    drawerContainer.style.transform = 'translateX(0)';
    drawerToggleBtn.style.right = '360px';
    drawerToggleBtn.innerHTML = '✕';
    drawerToggleBtn.style.background = 'linear-gradient(135deg, #0f3460, #16213e)';
    drawerToggleBtn.style.boxShadow = '-2px 0 10px rgba(0,0,0,0.3)';
    drawerToggleBtn.style.width = '36px';
  }

  function closeDrawer() {
    if (!drawerContainer) return;
    drawerOpen = false;
    drawerContainer.style.transform = 'translateX(100%)';
    drawerToggleBtn.style.right = '0';
    drawerToggleBtn.innerHTML = '🎬';
    drawerToggleBtn.style.background = 'linear-gradient(135deg, #e94560, #c23152)';
    drawerToggleBtn.style.boxShadow = '-2px 0 10px rgba(233, 69, 96, 0.3)';
  }

  // 监听来自 background.js 的抽屉切换命令
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'toggleDrawer') {
      if (!drawerContainer) createDrawer();
      toggleDrawer();
      sendResponse({ success: true, open: drawerOpen });
      return false;
    }
  });

  // ============================================================
  // 初始化
  // ============================================================
  createDrawer();
  console.log('[Seedance批量助手] Content script loaded');
})();
