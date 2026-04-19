const streamsByTab = new Map();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'START_CAPTURE' && msg.streamId && msg.tabId != null) {
    startCapture(msg.tabId, msg.streamId);
  } else if (msg?.type === 'STOP_CAPTURE' && msg.tabId != null) {
    stopCapture(msg.tabId);
  }
});

async function startCapture(tabId, streamId) {
  try {
    stopCapture(tabId);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });
    streamsByTab.set(tabId, stream);
    console.log('[SoundMute] capture started for tab', tabId, '— tracks:', stream.getAudioTracks().length);
  } catch (e) {
    console.error('[SoundMute] capture failed for tab', tabId, e);
  }
}

function stopCapture(tabId) {
  const stream = streamsByTab.get(tabId);
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
  streamsByTab.delete(tabId);
  console.log('[SoundMute] capture stopped for tab', tabId);
}
