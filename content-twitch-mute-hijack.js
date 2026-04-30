const MUTE_BUTTON_SELECTOR = '[data-a-target="player-mute-unmute-button"]';

const sendToggle = () => {
  try {
    chrome.runtime.sendMessage({ type: 'TOGGLE_MUTE_FROM_PAGE' });
  } catch {}
};

document.addEventListener('click', (e) => {
  const btn = e.target?.closest?.(MUTE_BUTTON_SELECTOR);
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  sendToggle();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key?.toLowerCase() !== 'm') return;
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  sendToggle();
}, true);
