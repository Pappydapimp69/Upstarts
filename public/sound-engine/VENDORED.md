# Vendored: sound-engine

Copied from `pappydapimp69/sound-engine` `src/` at commit `b028f469f713a451861e076070da1222f020e268`.
Plain ES modules with no dependencies. Don't edit here; change the engine repo and copy `src/` again.

It sits next to the demo page so the same relative path (`./vendor/sound-engine/index.js`) works in the repo,
on GitHub Pages and in the published artifact. When the game proper starts (M0) it moves to a top-level vendor folder.

## Local change (diverges from upstream)

`dsp/voice.js` carries `docs/proposals/sound-engine-voice-realism.patch`, applied here at the owner's request
(2026-10-21): aspiration scaled to the glottal pulse and gated by the open phase, per-period jitter and shimmer,
and a glottal phase per call. Upstream it into `pappydapimp69/sound-engine` before the next re-copy of `src/`,
or the re-copy will drop it.

## Upstarts copy

Upstarts serves this folder as static files from `public/sound-engine/` (copied from the Dlist demo's vendor folder,
voice patch included) and imports it at runtime, so the worklet resolves its own path on GitHub Pages.
