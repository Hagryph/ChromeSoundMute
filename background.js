const STORAGE_PREFIX = 'capturing_';
const LAST_ACTIVE_PREFIX = 'lastActive_';

const startCaptureForTab = async (tabId, auto) => {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  const hasDoc = await chrome.offscreen.hasDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Hold the tab-capture MediaStream so original playback is silenced at the capture layer.',
    });
  }

  await chrome.runtime.sendMessage({ type: 'START_CAPTURE', streamId, tabId });
  await chrome.storage.session.set({ [STORAGE_PREFIX + tabId]: { auto: !!auto } });
  await chrome.action.setBadgeText({ text: 'MUTE', tabId });
  await chrome.action.setBadgeBackgroundColor({ color: '#c0392b', tabId });
};

const stopCaptureForTab = async (tabId) => {
  try { await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId }); } catch {}
  try { await chrome.storage.session.remove(STORAGE_PREFIX + tabId); } catch {}
  try { await chrome.action.setBadgeText({ text: '', tabId }); } catch {}
};

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  const key = STORAGE_PREFIX + tab.id;
  const state = (await chrome.storage.session.get(key))[key];

  if (state) {
    await stopCaptureForTab(tab.id);
    return;
  }

  await startCaptureForTab(tab.id, false);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopCaptureForTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  const key = STORAGE_PREFIX + tabId;
  const state = (await chrome.storage.session.get(key))[key];
  if (state) await stopCaptureForTab(tabId);
});

const tabDomainMatches = (url, domains) => {
  if (!url || !domains?.length) return false;
  try {
    const host = new URL(url).hostname;
    return domains.some((d) => host === d || host.endsWith('.' + d));
  } catch { return false; }
};

chrome.tabs.onActivated.addListener(async ({ tabId: newActive, windowId }) => {
  const lastKey = LAST_ACTIVE_PREFIX + windowId;
  const prev = (await chrome.storage.session.get(lastKey))[lastKey];
  await chrome.storage.session.set({ [lastKey]: newActive });

  const newKey = STORAGE_PREFIX + newActive;
  const newState = (await chrome.storage.session.get(newKey))[newKey];
  if (newState?.auto) {
    await stopCaptureForTab(newActive);
  }

  if (!prev || prev === newActive) return;

  const { autoMuteEnabled = false, autoMuteDomains = [] } =
    await chrome.storage.local.get(['autoMuteEnabled', 'autoMuteDomains']);
  if (!autoMuteEnabled) return;

  const prevTab = await chrome.tabs.get(prev).catch(() => null);
  if (!prevTab || !tabDomainMatches(prevTab.url, autoMuteDomains)) return;

  const prevKey = STORAGE_PREFIX + prev;
  const prevState = (await chrome.storage.session.get(prevKey))[prevKey];
  if (prevState) return;

  try { await startCaptureForTab(prev, true); } catch {}
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  try { await chrome.storage.session.remove(LAST_ACTIVE_PREFIX + windowId); } catch {}
});
