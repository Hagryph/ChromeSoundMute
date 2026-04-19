const $ = (id) => document.getElementById(id);

async function load() {
  const { autoMuteEnabled = false, autoMuteDomains = [] } =
    await chrome.storage.local.get(['autoMuteEnabled', 'autoMuteDomains']);
  $('autoMute').checked = autoMuteEnabled;
  $('domains').value = autoMuteDomains.join('\n');
}

async function save() {
  const autoMuteEnabled = $('autoMute').checked;
  const autoMuteDomains = $('domains').value
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  await chrome.storage.local.set({ autoMuteEnabled, autoMuteDomains });
  const status = $('status');
  status.textContent = 'Saved';
  setTimeout(() => { status.textContent = ''; }, 1500);
}

$('save').addEventListener('click', save);
load();
