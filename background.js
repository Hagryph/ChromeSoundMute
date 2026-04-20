const STORAGE_PREFIX = 'capturing_';
const LAST_ACTIVE_PREFIX = 'lastActive_';
const MENU_ID = 'soundmute-auto-toggle';

const getTabHost = (url) => {
  if (!url) return null;
  try { return new URL(url).hostname; } catch { return null; }
};

const isAutoDomain = (host, domains) => {
  if (!host || !domains?.length) return false;
  return domains.some((d) => host === d || host.endsWith('.' + d));
};

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

const updateMenuForTab = async (tab) => {
  const host = getTabHost(tab?.url);
  try {
    if (!host) {
      await chrome.contextMenus.update(MENU_ID, {
        title: 'Auto-mute this site on tab switch',
        enabled: false,
        checked: false,
      });
      return;
    }
    const { autoMuteDomains = [] } = await chrome.storage.local.get('autoMuteDomains');
    await chrome.contextMenus.update(MENU_ID, {
      title: `Auto-mute ${host} on tab switch`,
      enabled: true,
      checked: autoMuteDomains.includes(host),
    });
  } catch {}
};

const setupMenu = () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Auto-mute this site on tab switch',
      type: 'checkbox',
      contexts: ['page', 'action'],
      checked: false,
    });
  });
};

chrome.runtime.onInstalled.addListener(setupMenu);
chrome.runtime.onStartup.addListener(setupMenu);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const host = getTabHost(tab?.url);
  if (!host) return;
  const { autoMuteDomains = [] } = await chrome.storage.local.get('autoMuteDomains');
  const updated = autoMuteDomains.includes(host)
    ? autoMuteDomains.filter((d) => d !== host)
    : [...autoMuteDomains, host];
  await chrome.storage.local.set({ autoMuteDomains: updated });
  if (tab) await updateMenuForTab(tab);
});

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

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    const key = STORAGE_PREFIX + tabId;
    const state = (await chrome.storage.session.get(key))[key];
    if (state) await stopCaptureForTab(tabId);
  }
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateMenuForTab(tab);
  }
  if (changeInfo.status === 'complete' && tab && !tab.active) {
    const { autoMuteDomains = [] } = await chrome.storage.local.get('autoMuteDomains');
    if (!autoMuteDomains.length) return;
    const host = getTabHost(tab.url);
    if (!isAutoDomain(host, autoMuteDomains)) return;
    const key = STORAGE_PREFIX + tabId;
    const state = (await chrome.storage.session.get(key))[key];
    if (state) return;
    try { await startCaptureForTab(tabId, true); } catch {}
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId: newActive, windowId }) => {
  const lastKey = LAST_ACTIVE_PREFIX + windowId;
  const prev = (await chrome.storage.session.get(lastKey))[lastKey];
  await chrome.storage.session.set({ [lastKey]: newActive });

  const newKey = STORAGE_PREFIX + newActive;
  const newState = (await chrome.storage.session.get(newKey))[newKey];
  if (newState?.auto) {
    await stopCaptureForTab(newActive);
  }

  const newTab = await chrome.tabs.get(newActive).catch(() => null);
  if (newTab) await updateMenuForTab(newTab);

  if (!prev || prev === newActive) return;

  const { autoMuteDomains = [] } = await chrome.storage.local.get('autoMuteDomains');
  if (!autoMuteDomains.length) return;

  const prevTab = await chrome.tabs.get(prev).catch(() => null);
  const prevHost = getTabHost(prevTab?.url);
  if (!isAutoDomain(prevHost, autoMuteDomains)) return;

  const prevKey = STORAGE_PREFIX + prev;
  const prevState = (await chrome.storage.session.get(prevKey))[prevKey];
  if (prevState) return;

  try { await startCaptureForTab(prev, true); } catch {}
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  try { await chrome.storage.session.remove(LAST_ACTIVE_PREFIX + windowId); } catch {}
});
