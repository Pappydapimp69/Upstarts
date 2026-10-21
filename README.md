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

## Layout

- `src/sim/`: game state and rules. No Three.js or DOM, so it can move to a
  Web Worker or a server unchanged.
- `src/render/`: draws the sim state. Reads it, never writes it.
