// background.js - Service Worker (MV3)
// 处理扩展生命周期事件、消息中继、任务轮询

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Seedance批量助手] 扩展已安装', details.reason);

  // 设置默认预设
  chrome.storage.local.get(['preset'], (data) => {
    if (!data.preset) {
      chrome.storage.local.set({
        preset: {
          model: 'Seedance 2.0',
          referenceMode: '首尾帧',
          aspectRatio: '16:9',
          duration: '5s',
        },
        taskDelay: 2,
        apiBaseUrl: 'http://localhost:3456',
        pollInterval: 30,
        taskQueue: [],
      });
    }
  });
});

// 点击扩展图标时: 在即梦页面 → 切换抽屉; 其他页面 → 打开即梦
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.includes('jimeng.jianying.com')) {
    // 在即梦AI页面上，发消息给 content script 切换抽屉
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'toggleDrawer' });
    } catch (e) {
      // content script 未加载，尝试注入后重试
      console.warn('[Seedance批量助手] Content script 未响应，尝试注入...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
        // 等一下让 content script 初始化
        setTimeout(async () => {
          try {
            await chrome.tabs.sendMessage(tab.id, { action: 'toggleDrawer' });
          } catch (e2) {
            console.error('[Seedance批量助手] 注入后仍无法切换抽屉:', e2);
          }
        }, 500);
      } catch (injectErr) {
        console.error('[Seedance批量助手] 注入 content script 失败:', injectErr);
      }
    }
  } else {
    // 不在即梦AI页面，打开即梦
    await chrome.tabs.create({
      url: 'https://jimeng.jianying.com/ai-tool/home',
    });
  }
});

// 监听来自 content script 的消息（用于日志/状态更新）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'log') {
    console.log(`[Content → BG] ${msg.message}`);
    sendResponse({ received: true });
  }

  if (msg.action === 'taskStatus') {
    // 可以在这里更新 badge 显示进度
    if (msg.status === 'processing') {
      chrome.action.setBadgeText({ text: `${msg.current}/${msg.total}` });
      chrome.action.setBadgeBackgroundColor({ color: '#e94560' });
    } else if (msg.status === 'done') {
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#4caf50' });
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
      }, 5000);
    }
    sendResponse({ received: true });
  }

  // ===== 任务队列相关消息 =====

  // 从 panel.js 触发: 拉取远程任务
  if (msg.action === 'fetchTasks') {
    fetchRemoteTasks(msg.apiBaseUrl)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async
  }

  // 更新远程任务状态
  if (msg.action === 'reportTaskStatus') {
    reportTaskStatusToAPI(msg.apiBaseUrl, msg.taskCode, msg.status, msg.error)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 确认接收任务
  if (msg.action === 'ackTasks') {
    ackTasksToAPI(msg.apiBaseUrl, msg.taskCodes)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ============================================================
// 任务 API 通信
// ============================================================

/**
 * 从远程 API 拉取待处理任务
 */
async function fetchRemoteTasks(apiBaseUrl) {
  try {
    const url = `${apiBaseUrl}/api/tasks/pending`;
    console.log(`[Seedance BG] 拉取任务: ${url}`);
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    console.log(`[Seedance BG] 获取到 ${data.total || 0} 个待处理任务`);

    // 更新 badge
    if (data.total > 0) {
      chrome.action.setBadgeText({ text: String(data.total) });
      chrome.action.setBadgeBackgroundColor({ color: '#f0ad4e' });
    }

    return { success: true, tasks: data.tasks || [], total: data.total || 0 };
  } catch (err) {
    console.error('[Seedance BG] 拉取任务失败:', err.message);
    return { success: false, error: err.message, tasks: [] };
  }
}

/**
 * 向 API 报告任务状态
 */
async function reportTaskStatusToAPI(apiBaseUrl, taskCode, status, error) {
  try {
    const url = `${apiBaseUrl}/api/tasks/status`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskCode,
        status,
        error: error || null,
        completedAt: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return { success: true, data };
  } catch (err) {
    console.error(`[Seedance BG] 报告任务状态失败 (${taskCode}):`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 确认接收任务
 */
async function ackTasksToAPI(apiBaseUrl, taskCodes) {
  try {
    const url = `${apiBaseUrl}/api/tasks/ack`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskCodes }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return { success: true, data };
  } catch (err) {
    console.error('[Seedance BG] 确认任务失败:', err.message);
    return { success: false, error: err.message };
  }
}
