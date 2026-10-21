# Upstarts

Browser-based Triassic dinosaur survival game. Three.js + TypeScript.

The shareable demo and the tutorial live in [Dlist](https://github.com/Pappydapimp69/Dlist).
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
Add `?fast` to the URL to run hunger, thirst and growth 20x faster, and `?adult` to start fully grown.

## Look

The environment, Herrerasaurus model and animation, and the HUD come from the Dlist demo
(`demos/skin-test`), ported into `src/render/dlist/` and `index.html`. three.js is pinned to
0.160, the demo's version: on 0.169 the fuzz shader compiles but renders the wrong colour.

## Layout

- `src/sim/`: game state and rules. No Three.js or DOM, so it can move to a
  Web Worker or a server unchanged.
- `src/render/`: draws the sim state. Reads it, never writes it.
