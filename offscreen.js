const entriesByTab = new Map();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'START_CAPTURE' && msg.streamId && msg.tabId != null) {
    startCapture(msg.tabId, msg.streamId, !!msg.muted);
  } else if (msg?.type === 'STOP_CAPTURE' && msg.tabId != null) {
    stopCapture(msg.tabId);
  } else if (msg?.type === 'SET_MUTED' && msg.tabId != null) {
    setMuted(msg.tabId, !!msg.muted);
  }
});

async function startCapture(tabId, streamId, muted) {
  stopCapture(tabId);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });
    const audio = new Audio();
    audio.srcObject = stream;
    audio.muted = !!muted;
    audio.volume = 1;
    audio.play().catch(() => {});
    entriesByTab.set(tabId, { audio, stream });
    console.log('[SoundMute] capture started for tab', tabId, 'muted:', muted);
  } catch (e) {
    console.error('[SoundMute] capture failed for tab', tabId, e);
  }
}

function stopCapture(tabId) {
  const entry = entriesByTab.get(tabId);
  if (!entry) return;
  try { entry.audio.pause(); } catch {}
  try { entry.audio.srcObject = null; } catch {}
  try { entry.stream.getTracks().forEach((t) => t.stop()); } catch {}
  entriesByTab.delete(tabId);
  console.log('[SoundMute] capture stopped for tab', tabId);
}

function setMuted(tabId, muted) {
  const entry = entriesByTab.get(tabId);
  if (!entry) return;
  entry.audio.muted = !!muted;
}
