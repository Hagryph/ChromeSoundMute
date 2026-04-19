# Chrome SoundMute

Manifest V3 Chrome extension that silences tab audio in a way the page cannot detect.

## Status

Pre-bootstrap. No code yet — scaffolding ships via the first `feat/bootstrap` PR.

## Approach

Layered muting (see `memory/project_mute_techniques.md`):

1. **`chrome.tabs.update({muted: true})`** — native tab-mute. Below the audio graph, invisible to page JS. Covers all frames, Web Audio, WebRTC, notification sounds.
2. **`HTMLMediaElement.prototype` getter spoofing** — optional stealth layer; page-world content script (`world: "MAIN"`, `document_start`, `all_frames: true`).
3. **Web Audio `AudioNode.connect` rerouting** — optional; keeps `ctx.state === 'running'` and AnalyserNode samples real while the mixer silences output.

## Install (dev)

1. Clone and `git checkout main` (or `beta` for combined unmerged features).
2. `chrome://extensions` → enable Developer Mode → "Load unpacked" → select this directory.
3. Reload on the extension card after pulling new commits.

## Workflow

Every change goes on a branch + PR against `main`. See `memory/feedback_pr_workflow.md` and `memory/feedback_dev_procedure.md`.
