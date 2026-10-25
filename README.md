# Upstarts

Browser-based Triassic dinosaur survival game. Three.js + TypeScript.

This is the main game, and all new work happens here. [Dlist](https://github.com/Pappydapimp69/Dlist) is frozen
(2026-10-25): read it as reference material (the demo's movement, balance, sound, haptics and tutorial, and its
`docs/PORTING.md`), but don't update it. Where the two differ, Upstarts is right.
The plan is in [docs/BLUEPRINT.md](docs/BLUEPRINT.md).

## Run

```
npm install
npm run dev      # local dev server
npm run build    # typecheck + production build into dist/
```

Pushes deploy to GitHub Pages (`.github/workflows/pages.yml`).

## Play

WASD move · Shift sprint · hold G drink (or sniff away from water) · hold E eat (or bite live prey)
· drag to look · C camera behind.
Controller: left stick, RT sprint, hold B drink/sniff, hold X eat/bite, A to hatch again.
Footsteps rumble the controller: heavier and faster animals hit harder, and a step to your left or
right drives that side (left/right triggers on Xbox-style pads, else the left/right motors).
Toggle it on the pause card (R, or X on a controller).

Add `?fast` to the URL to run hunger, thirst and growth 20x faster, and `?adult` to start fully grown.

## Species

Four playable dinosaurs, chosen on the splash and on the death card: *Herrerasaurus*, *Sanjuansaurus*,
*Eodromaeus* and *Panphagia* (`src/sim/species.ts`). Each is the Dlist Herrerasaurus model reshaped by
`src/render/dlist/shapes.js` (neck, head, tail, legs, arms, palette) and baked as a new rest pose, so the
same animation drives all four. Small species grow up faster and get hungry sooner (mass^0.324);
*Panphagia* also browses ferns.

## Look

The environment, Herrerasaurus model and animation, and the HUD come from the Dlist demo
(`demos/skin-test`), ported into `src/render/dlist/` and `index.html`. three.js is pinned to
0.160, the demo's version: on 0.169 the fuzz shader compiles but renders the wrong colour.

## Sound

Every sound is synthesized by the procedural engine from `pappydapimp69/sound-engine` (blueprint D8), vendored
in `public/sound-engine/` and loaded at runtime. `src/audio/audio.ts` is the Dlist demo's audio layer: the sim
emits sound events (bites, hits, calls) and the client's animators emit footsteps and mouth sounds; the layer
plays them and never feeds back into the sim. Sound starts on the first key, click or tap (browsers require a
gesture). Left and right are swapped once at the output, because three.js seen from above is mirrored against
the engine's plane.

## Layout

- `src/sim/`: game state and rules. No Three.js or DOM, so it can move to a
  Web Worker or a server unchanged.
- `src/render/`: draws the sim state. Reads it, never writes it.
