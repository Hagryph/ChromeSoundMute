const STORAGE_PREFIX = 'capturing_';
const OVERRIDE_PREFIX = 'overrideAuto_';
const LAST_ACTIVE_PREFIX = 'lastActive_';
const MENU_ID = 'soundmute-auto-toggle';
const OVERRIDE_MENU_ID = 'soundmute-override-auto';

const getTabHost = (url) => {
  if (!url) return null;
  try { return new URL(url).hostname; } catch { return null; }
};

const isAutoDomain = (host, domains) => {
  if (!host || !domains?.length) return false;
  return domains.some((d) => host === d || host.endsWith('.' + d));
};

const getOverride = async (tabId) => {
  const key = OVERRIDE_PREFIX + tabId;
  return !!(await chrome.storage.session.get(key))[key];
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
      await chrome.contextMenus.update(OVERRIDE_MENU_ID, {
        title: "Don't auto-mute this tab (until reload)",
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

    const domainMatches = isAutoDomain(host, autoMuteDomains);
    const override = tab.id != null ? await getOverride(tab.id) : false;
    await chrome.contextMenus.update(OVERRIDE_MENU_ID, {
      title: "Don't auto-mute this tab (until reload)",
      enabled: domainMatches,
      checked: override,
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
    chrome.contextMenus.create({
      id: OVERRIDE_MENU_ID,
      title: "Don't auto-mute this tab (until reload)",
      type: 'checkbox',
      contexts: ['page', 'action'],
      checked: false,
      enabled: false,
    });
  });
};

const initLastActive = async () => {
  try {
    const windows = await chrome.windows.getAll({ populate: false });
    for (const win of windows) {
      if (win.id == null) continue;
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: win.id });
      if (activeTab?.id != null) {
        await chrome.storage.session.set({ [LAST_ACTIVE_PREFIX + win.id]: activeTab.id });
      }
    }
  } catch {}
};

const initialize = async () => {
  setupMenu();
  await initLastActive();
};

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;

  if (info.menuItemId === MENU_ID) {
    const host = getTabHost(tab.url);
    if (!host) return;
    const { autoMuteDomains = [] } = await chrome.storage.local.get('autoMuteDomains');
    const updated = autoMuteDomains.includes(host)
      ? autoMuteDomains.filter((d) => d !== host)
      : [...autoMuteDomains, host];
    await chrome.storage.local.set({ autoMuteDomains: updated });
    await updateMenuForTab(tab);
    return;
  }

  if (info.menuItemId === OVERRIDE_MENU_ID) {
    if (tab.id == null) return;
    const key = OVERRIDE_PREFIX + tab.id;
    const current = await getOverride(tab.id);
    if (current) {
      await chrome.storage.session.remove(key);
    } else {
      await chrome.storage.session.set({ [key]: true });
      const captureKey = STORAGE_PREFIX + tab.id;
      const state = (await chrome.storage.session.get(captureKey))[captureKey];
      if (state?.auto) {
        await stopCaptureForTab(tab.id);
      }
    }
    await updateMenuForTab(tab);
    return;
  }
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

chrome.tabs.onRemoved.addListener(async (tabId) => {
  stopCaptureForTab(tabId);
  try { await chrome.storage.session.remove(OVERRIDE_PREFIX + tabId); } catch {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    const key = STORAGE_PREFIX + tabId;
    const state = (await chrome.storage.session.get(key))[key];
    if (state) await stopCaptureForTab(tabId);
    try { await chrome.storage.session.remove(OVERRIDE_PREFIX + tabId); } catch {}
  }
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateMenuForTab(tab);
  }
  if (changeInfo.status === 'complete' && tab && !tab.active) {
    const { autoMuteDomains = [] } = await chrome.storage.local.get('autoMuteDomains');
    if (!autoMuteDomains.length) return;
    const host = getTabHost(tab.url);
    if (!isAutoDomain(host, autoMuteDomains)) return;
    if (await getOverride(tabId)) return;
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
  if (await getOverride(prev)) return;

  const prevKey = STORAGE_PREFIX + prev;
  const prevState = (await chrome.storage.session.get(prevKey))[prevKey];
  if (prevState) return;

  try { await startCaptureForTab(prev, true); } catch {}
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  try { await chrome.storage.session.remove(LAST_ACTIVE_PREFIX + windowId); } catch {}
});
