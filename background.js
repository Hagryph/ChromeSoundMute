const STORAGE_PREFIX = 'capturing_';

const stopCaptureForTab = async (tabId) => {
  try { await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId }); } catch {}
  try { await chrome.storage.session.remove(STORAGE_PREFIX + tabId); } catch {}
  try { await chrome.action.setBadgeText({ text: '', tabId }); } catch {}
};

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  const key = STORAGE_PREFIX + tab.id;

  const { [key]: active } = await chrome.storage.session.get(key);

  if (active) {
    await stopCaptureForTab(tab.id);
    return;
  }

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

  const hasDoc = await chrome.offscreen.hasDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Hold the tab-capture MediaStream so original playback is silenced at the capture layer.',
    });
  }

  await chrome.runtime.sendMessage({ type: 'START_CAPTURE', streamId, tabId: tab.id });
  await chrome.storage.session.set({ [key]: true });
  await chrome.action.setBadgeText({ text: 'MUTE', tabId: tab.id });
  await chrome.action.setBadgeBackgroundColor({ color: '#c0392b', tabId: tab.id });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopCaptureForTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  const key = STORAGE_PREFIX + tabId;
  const { [key]: active } = await chrome.storage.session.get(key);
  if (active) {
    await stopCaptureForTab(tabId);
  }
});
