const STORAGE_PREFIX = 'capturing_';
const OVERRIDE_PREFIX = 'overrideAuto_';
const LAST_ACTIVE_PREFIX = 'lastActive_';
const MENU_ID = 'soundmute-auto-toggle';
const OVERRIDE_MENU_ID = 'soundmute-override-auto';

let autoMuteDomainsCache = [];

const syncDomainsCache = async () => {
  try {
    const { autoMuteDomains = [] } = await chrome.storage.local.get('autoMuteDomains');
    autoMuteDomainsCache = autoMuteDomains;
  } catch {}
};

syncDomainsCache();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autoMuteDomains) {
    autoMuteDomainsCache = changes.autoMuteDomains.newValue || [];
  }
});

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

const getTabState = async (tabId) => {
  const key = STORAGE_PREFIX + tabId;
  return (await chrome.storage.session.get(key))[key];
};

const setTabState = async (tabId, state) => {
  await chrome.storage.session.set({ [STORAGE_PREFIX + tabId]: state });
};

const clearTabState = async (tabId) => {
  await chrome.storage.session.remove(STORAGE_PREFIX + tabId);
};

const updateBadge = async (tabId, muted) => {
  try {
    if (muted) {
      await chrome.action.setBadgeText({ text: 'MUTE', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#c0392b', tabId });
    } else {
      await chrome.action.setBadgeText({ text: '', tabId });
    }
  } catch {}
};

const ensureOffscreen = async () => {
  const hasDoc = await chrome.offscreen.hasDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Hold the tab-capture MediaStream and control per-tab playback volume.',
    });
  }
};

const startCaptureForTab = async (tabId, source, muted, streamIdArg) => {
  const streamId = streamIdArg || await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ type: 'START_CAPTURE', streamId, tabId, muted });
  await setTabState(tabId, { source, muted: !!muted });
  await updateBadge(tabId, !!muted);
};

const stopCaptureForTab = async (tabId) => {
  try { await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId }); } catch {}
  try { await clearTabState(tabId); } catch {}
  try { await chrome.action.setBadgeText({ text: '', tabId }); } catch {}
};

const setMutedOffscreen = async (tabId, muted) => {
  try { await chrome.runtime.sendMessage({ type: 'SET_MUTED', tabId, muted }); } catch {}
  const state = await getTabState(tabId);
  if (state) {
    state.muted = !!muted;
    await setTabState(tabId, state);
  }
  await updateBadge(tabId, !!muted);
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

initLastActive();

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
    await chrome.contextMenus.update(MENU_ID, {
      title: `Auto-mute ${host} on tab switch`,
      enabled: true,
      checked: autoMuteDomainsCache.includes(host),
    });
    const domainMatches = isAutoDomain(host, autoMuteDomainsCache);
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

chrome.runtime.onInstalled.addListener(setupMenu);
chrome.runtime.onStartup.addListener(setupMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;

  if (info.menuItemId === MENU_ID) {
    const host = getTabHost(tab.url);
    if (!host) return;

    const wasEnabled = autoMuteDomainsCache.includes(host);

    if (!wasEnabled && tab.id != null && tab.active) {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
        .then((streamId) => startCaptureForTab(tab.id, 'auto', false, streamId))
        .catch((e) => console.warn('[SoundMute] bootstrap capture failed:', e?.message || e));
    }

    (async () => {
      const updated = wasEnabled
        ? autoMuteDomainsCache.filter((d) => d !== host)
        : [...autoMuteDomainsCache, host];
      await chrome.storage.local.set({ autoMuteDomains: updated });
      autoMuteDomainsCache = updated;
      await updateMenuForTab(tab);

      if (wasEnabled) {
        const session = await chrome.storage.session.get(null);
        for (const [key, state] of Object.entries(session)) {
          if (!key.startsWith(STORAGE_PREFIX)) continue;
          const tabId = parseInt(key.slice(STORAGE_PREFIX.length), 10);
          if (Number.isNaN(tabId) || state?.source !== 'auto') continue;
          const tabObj = await chrome.tabs.get(tabId).catch(() => null);
          const tHost = getTabHost(tabObj?.url);
          if (tHost && (tHost === host || tHost.endsWith('.' + host))) {
            await stopCaptureForTab(tabId);
          }
        }
      }
    })();

    return;
  }

  if (info.menuItemId === OVERRIDE_MENU_ID) {
    if (tab.id == null) return;
    (async () => {
      const key = OVERRIDE_PREFIX + tab.id;
      const current = await getOverride(tab.id);
      if (current) {
        await chrome.storage.session.remove(key);
      } else {
        await chrome.storage.session.set({ [key]: true });
        const state = await getTabState(tab.id);
        if (state?.source === 'auto' && state.muted) {
          await setMutedOffscreen(tab.id, false);
        }
      }
      await updateMenuForTab(tab);
    })();
    return;
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  chrome.storage.session.get(STORAGE_PREFIX + tab.id).then(async (res) => {
    const state = res[STORAGE_PREFIX + tab.id];
    if (!state) {
      try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        await startCaptureForTab(tab.id, 'manual', true, streamId);
      } catch (e) {
        console.warn('[SoundMute] manual capture failed:', e?.message || e);
      }
      return;
    }
    if (state.muted) {
      await stopCaptureForTab(tab.id);
    } else {
      await setMutedOffscreen(tab.id, true);
      state.source = 'manual';
      await setTabState(tab.id, state);
    }
  });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await stopCaptureForTab(tabId);
  try { await chrome.storage.session.remove(OVERRIDE_PREFIX + tabId); } catch {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    await stopCaptureForTab(tabId);
    try { await chrome.storage.session.remove(OVERRIDE_PREFIX + tabId); } catch {}
  }
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateMenuForTab(tab);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId: newActive, windowId }) => {
  const lastKey = LAST_ACTIVE_PREFIX + windowId;
  const prev = (await chrome.storage.session.get(lastKey))[lastKey];
  await chrome.storage.session.set({ [lastKey]: newActive });

  const newState = await getTabState(newActive);
  if (newState?.source === 'auto' && newState.muted) {
    await setMutedOffscreen(newActive, false);
  }

  const newTab = await chrome.tabs.get(newActive).catch(() => null);
  if (newTab) await updateMenuForTab(newTab);

  if (!prev || prev === newActive) return;

  const prevState = await getTabState(prev);
  if (prevState?.source !== 'auto') return;
  if (prevState.muted) return;
  if (await getOverride(prev)) return;

  const prevTab = await chrome.tabs.get(prev).catch(() => null);
  const prevHost = getTabHost(prevTab?.url);
  if (!isAutoDomain(prevHost, autoMuteDomainsCache)) return;

  await setMutedOffscreen(prev, true);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  try { await chrome.storage.session.remove(LAST_ACTIVE_PREFIX + windowId); } catch {}
});
