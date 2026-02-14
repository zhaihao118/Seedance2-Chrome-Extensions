// popup.js - 批量生成控制面板
(function () {
  const MAX_FILES = 30;
  let selectedFiles = [];

  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');
  const statusBar = document.getElementById('statusBar');
  const fileCount = document.getElementById('fileCount');
  const btnClear = document.getElementById('btnClear');
  const btnGenerate = document.getElementById('btnGenerate');
  const btnPreset = document.getElementById('btnPreset');
  const progressEl = document.getElementById('progress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const logEl = document.getElementById('log');
  const promptInput = document.getElementById('promptInput');

  // Upload area click
  uploadArea.addEventListener('click', () => fileInput.click());

  // Drag and drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#e94560';
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = '#0f3460';
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#0f3460';
    handleFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = '';
  });

  function handleFiles(files) {
    const imageFiles = Array.from(files).filter(f =>
      ['image/jpeg', 'image/png', 'image/webp'].includes(f.type)
    );
    const remaining = MAX_FILES - selectedFiles.length;
    const toAdd = imageFiles.slice(0, remaining);
    selectedFiles = selectedFiles.concat(toAdd);
    updateUI();
  }

  function updateUI() {
    const count = selectedFiles.length;

    // Status bar
    statusBar.style.display = count > 0 ? 'flex' : 'none';
    fileCount.textContent = `${count} / ${MAX_FILES} 张`;

    // File list
    fileList.innerHTML = '';
    selectedFiles.forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <span class="name">${idx + 1}. ${file.name}</span>
        <span class="remove" data-idx="${idx}">✕</span>
      `;
      fileList.appendChild(item);
    });

    // Remove buttons
    fileList.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        selectedFiles.splice(idx, 1);
        updateUI();
      });
    });

    // Generate button
    btnGenerate.disabled = count === 0;
    btnGenerate.textContent = `🚀 开始批量生成（${count} 个任务）`;
  }

  // Clear
  btnClear.addEventListener('click', () => {
    selectedFiles = [];
    updateUI();
  });

  // Apply preset parameters
  btnPreset.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('jimeng.jianying.com')) {
      alert('请先打开即梦AI生成页面');
      return;
    }

    btnPreset.textContent = '⏳ 应用中...';
    btnPreset.disabled = true;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: applyPresetInPage,
      });
      btnPreset.textContent = '✅ 预设已应用';
      setTimeout(() => {
        btnPreset.textContent = '🔧 应用预设参数到页面';
        btnPreset.disabled = false;
      }, 2000);
    } catch (err) {
      btnPreset.textContent = '❌ 应用失败';
      btnPreset.disabled = false;
      console.error(err);
    }
  });

  // Convert file to base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Start batch generation
  btnGenerate.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('jimeng.jianying.com')) {
      alert('请先打开即梦AI生成页面');
      return;
    }

    btnGenerate.disabled = true;
    progressEl.classList.add('active');
    logEl.classList.add('active');
    logEl.innerHTML = '';

    const total = selectedFiles.length;
    const prompt = promptInput.value.trim();

    addLog(`开始批量生成 ${total} 个任务...`);
    addLog(`提示词: ${prompt || '(无)'}`);

    // Convert all files to base64 first
    const filesData = [];
    for (let i = 0; i < total; i++) {
      progressText.textContent = `读取图片 ${i + 1}/${total}...`;
      progressFill.style.width = `${((i + 1) / total) * 30}%`;
      try {
        const base64 = await fileToBase64(selectedFiles[i]);
        filesData.push({
          name: selectedFiles[i].name,
          data: base64,
          type: selectedFiles[i].type,
        });
      } catch (err) {
        addLog(`读取失败: ${selectedFiles[i].name}`, 'error');
      }
    }

    // Send to content script one by one
    for (let i = 0; i < filesData.length; i++) {
      const file = filesData[i];
      progressText.textContent = `生成任务 ${i + 1}/${filesData.length}...`;
      progressFill.style.width = `${30 + ((i + 1) / filesData.length) * 70}%`;

      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'generateTask',
          fileData: file,
          prompt: prompt,
          index: i,
          total: filesData.length,
        });
        addLog(`✅ 任务 ${i + 1}: ${file.name}`, 'success');
        // Wait between tasks to avoid rate limiting
        if (i < filesData.length - 1) {
          await sleep(2000);
        }
      } catch (err) {
        addLog(`❌ 任务 ${i + 1} 失败: ${err.message}`, 'error');
      }
    }

    progressText.textContent = `完成! ${filesData.length} 个任务已提交`;
    progressFill.style.width = '100%';
    addLog(`全部完成!`, 'success');

    setTimeout(() => {
      btnGenerate.disabled = false;
    }, 3000);
  });

  function addLog(msg, type = '') {
    const p = document.createElement('p');
    p.className = type;
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(p);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // This function runs in the page context to apply presets
  function applyPresetInPage() {
    // 使用 Playwright 测试验证过的实际 DOM 选择器

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 点击 lv-select 下拉框并选择选项
    async function selectOption(selectEl, targetText) {
      if (!selectEl) return false;
      // 检查当前值
      if (selectEl.textContent.includes(targetText)) return true;
      // 点击展开
      selectEl.click();
      await sleep(400);
      // 在弹出列表中查找
      const options = document.querySelectorAll('.lv-select-option');
      for (const opt of options) {
        if (opt.textContent.trim().includes(targetText)) {
          opt.click();
          return true;
        }
      }
      // 备用：全局文本匹配
      const allEls = document.querySelectorAll('div, span');
      for (const el of allEls) {
        if (el.textContent.trim() === targetText && el.offsetParent !== null) {
          el.click();
          return true;
        }
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return false;
    }

    return (async () => {
      // 1. 找到工具栏
      const toolbar = document.querySelector('[class*="toolbar-settings-content"]');
      if (!toolbar) {
        console.warn('[预设] 未找到工具栏');
        return;
      }

      // 获取所有 lv-select 下拉框: [0]=类型, [1]=模型, [2]=参考模式, [3]=时长
      const selects = toolbar.querySelectorAll('.lv-select');

      // 2. 选择模型 - Seedance 2.0
      if (selects[1]) {
        await selectOption(selects[1], 'Seedance 2.0');
        await sleep(300);
      }

      // 3. 选择参考模式 - 全能参考
      if (selects[2]) {
        await selectOption(selects[2], '全能参考');
        await sleep(300);
      }

      // 4. 选择比例 - 9:16（按钮而非lv-select）
      const ratioBtn = toolbar.querySelector('[class*="toolbar-button"]');
      if (ratioBtn && !ratioBtn.textContent.includes('9:16')) {
        ratioBtn.click();
        await sleep(400);
        const allEls = document.querySelectorAll('div, span');
        for (const el of allEls) {
          if (el.textContent.trim() === '9:16' && el.offsetParent !== null) {
            el.click();
            break;
          }
        }
        await sleep(300);
      }

      // 5. 选择时长 - 10s
      if (selects[3]) {
        await selectOption(selects[3], '10s');
        await sleep(300);
      }

      console.log('[预设] 参数应用完毕');
    })();
  }
})();
