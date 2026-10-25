# Vendored: sound-engine

Copied from `pappydapimp69/sound-engine` `src/` at commit `5045b6d` (branch `claude/sweet-brown-q1bxjk`, not yet
merged to `main` there). Plain ES modules with no dependencies. **No local changes.** Don't edit here: fix the
engine repo, then copy its `src/` into Dlist and Upstarts both, from the engine repo, never from another copy.

Upstarts serves this folder as static files from `public/sound-engine/` and imports it at runtime, so the worklet resolves its own path on GitHub Pages.

## Sound styles in use

A change that alters the sound is an opt-in style in the engine, never a new default (engine `docs/IDEAS.md`).
This project turns on:

- `realism: true` on every voice source: per-call glottal phase, jitter and shimmer, audible aspiration. The owner
  heard the classic calls as cartoonish (2026-10-21).

## History

- 2026-10-21: the voice-realism patch and the "idle sources sleep" fix (audio static on phones) were made in the
  copy only. 2026-10-25: both upstreamed; the realism patch became the opt-in style above.
