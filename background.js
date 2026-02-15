// background.js - Service Worker (MV3)
// 处理扩展生命周期事件和消息中继

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
});
