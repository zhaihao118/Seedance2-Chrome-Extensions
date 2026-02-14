// content.js - 即梦AI页面内容脚本
// 负责在页面中执行实际的参考图上传和生成操作

(function () {
  'use strict';

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'generateTask') {
      handleGenerateTask(msg)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // keep message channel open for async response
    }
  });

  // Helper: find element by text content
  function findByText(selector, text) {
    const els = document.querySelectorAll(selector);
    for (const el of els) {
      if (el.textContent.trim().includes(text)) {
        return el;
      }
    }
    return null;
  }

  // Helper: find all elements by text
  function findAllByText(selector, text) {
    const els = document.querySelectorAll(selector);
    return Array.from(els).filter(el => el.textContent.trim().includes(text));
  }

  // Helper: simulate mouse events
  function simulateClick(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  // Helper: set React input value
  function setNativeValue(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Helper: sleep
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper: convert base64 to File
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

  // Helper: find the upload input or drop zone for reference image
  function findUploadTarget() {
    // Look for file input elements
    const inputs = document.querySelectorAll('input[type="file"]');
    for (const input of inputs) {
      if (input.accept && (input.accept.includes('image') || input.accept.includes('video'))) {
        return input;
      }
    }
    // Fallback: return any file input
    if (inputs.length > 0) return inputs[0];
    return null;
  }

  // Main: handle a single generation task
  async function handleGenerateTask(msg) {
    const { fileData, prompt, index, total } = msg;

    console.log(`[Seedance批量] 处理任务 ${index + 1}/${total}: ${fileData.name}`);

    // Step 1: Click "添加参考图" button if visible
    await sleep(500);
    
    // Look for the upload area / add reference image button
    // Common patterns: "添加参考图", "上传图片", upload icon area
    const addRefBtn = findByText('span, div, button, p', '添加参考图')
      || findByText('span, div, button, p', '上传图片')
      || findByText('span, div, button, p', '添加参考')
      || findByText('span, div, button, p', '上传参考图');

    if (addRefBtn) {
      simulateClick(addRefBtn);
      await sleep(800);
    }

    // Step 2: Upload the reference image
    const file = base64ToFile(fileData.data, fileData.name, fileData.type);

    // Try to find file input and inject file
    const fileInput = findUploadTarget();
    if (fileInput) {
      // Create a DataTransfer to set files
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      console.log(`[Seedance批量] 已通过input上传: ${fileData.name}`);
      await sleep(1500);
    } else {
      // Try drag and drop approach
      const dropZone = document.querySelector('[class*="upload"]')
        || document.querySelector('[class*="drop"]')
        || document.querySelector('[class*="reference"]');

      if (dropZone) {
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          dataTransfer: new DataTransfer(),
        });
        dropEvent.dataTransfer.items.add(file);
        dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true }));
        dropZone.dispatchEvent(new DragEvent('dragover', { bubbles: true }));
        dropZone.dispatchEvent(dropEvent);
        console.log(`[Seedance批量] 已通过拖放上传: ${fileData.name}`);
        await sleep(1500);
      } else {
        console.warn('[Seedance批量] 未找到上传入口');
      }
    }

    // Step 3: Set prompt if provided
    if (prompt) {
      // 使用实际的class名定位提示词输入框
      const textarea = document.querySelector('textarea[class*="prompt-textarea"]')
        || document.querySelector('textarea.lv-textarea')
        || document.querySelector('textarea[placeholder*="Seedance"]')
        || document.querySelector('textarea')
        || document.querySelector('[contenteditable="true"]');
      
      if (textarea) {
        if (textarea.tagName === 'TEXTAREA' || textarea.tagName === 'INPUT') {
          setNativeValue(textarea, prompt);
        } else {
          textarea.textContent = prompt;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await sleep(300);
      }
    }

    // Step 4: Click generate button (submit-button 圆形图标按钮)
    await sleep(500);
    // 使用实际的class名定位生成按钮
    const submitBtn = document.querySelector('[class*="submit-button"]:not([class*="collapsed-WjKggt"])')
      || document.querySelector('button[class*="submit-button"]');

    if (submitBtn) {
      simulateClick(submitBtn);
      console.log(`[Seedance批量] 已点击生成按钮`);
      await sleep(2000);
    } else {
      // 降级查找
      const generateBtn = findByText('button, div[role="button"], span', '生成')
        || findByText('button, div[role="button"], span', '立即生成');
      if (generateBtn) {
        let btn = generateBtn;
        while (btn && btn.tagName !== 'BUTTON' && !btn.getAttribute('role')) {
          btn = btn.parentElement;
        }
        simulateClick(btn || generateBtn);
        console.log(`[Seedance批量] 已点击生成按钮(降级)`);
        await sleep(2000);
      } else {
        console.warn('[Seedance批量] 未找到生成按钮');
      }
    }

    // Step 5: Wait for the task to be submitted and clear for next one
    await sleep(1000);

    // After generation, we may need to clear the reference image for the next task
    // Look for delete/remove button on the uploaded reference
    const removeBtn = findByText('span, div, button', '删除')
      || document.querySelector('[class*="delete"]')
      || document.querySelector('[class*="remove"]')
      || document.querySelector('[class*="close"][class*="ref"]');

    if (removeBtn && index < total - 1) {
      simulateClick(removeBtn);
      await sleep(500);
    }

    console.log(`[Seedance批量] 任务 ${index + 1} 完成`);
  }

  // Notify that content script is ready
  console.log('[Seedance批量助手] Content script loaded');
})();
