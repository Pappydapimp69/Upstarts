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
· hold N nest (adults) · drag to look · C camera behind.
Controller: left stick, RT sprint, hold B drink/sniff, hold X eat/bite, hold D-pad down to nest, A to hatch again.
Footsteps rumble the controller: heavier and faster animals hit harder, and a step to your left or
right drives that side (left/right triggers on Xbox-style pads, else the left/right motors).
Toggle it on the pause card (R, or X on a controller).

Add `?fast` to the URL to run hunger, thirst and growth 20x faster, and `?adult` to start fully grown.

## Isle-style systems

- **Injuries** (`src/sim/injury.ts`): a bite opens a wound that drains health, blocks healing and growth,
  makes you smell of blood to Saurosuchus and drops a sniffable trail; it clots in about a minute (faster
  lying down). A big bite can break a leg: no sprint or jump and about half speed until it mends (8 min fed).
  Below 30% health you limp.
- **Diet** (`src/sim/diet.ts`): protein and fats (plus carbs for Panphagia) drain slowly on top of hunger.
  Lean carcasses are mostly protein; Hyperodapedon, Exaeretodon and grubs carry the fat; ferns the carbs.
  A poor diet slows growth to about a third and healing to half.
- **Nests** (`src/sim/nest.ts`): a well-fed adult holds N to scrape a nest and lay a clutch. Your next life of
  that species hatches there, a generation on. Unguarded eggs get taken every 4 minutes; eggs go bad after 45.
- **Growth** is about twice as long: 5 h to adult for Herrerasaurus, 4 h Sanjuansaurus, 3 h Panphagia,
  2.5 h Eodromaeus.

## Seasons and weather

`src/sim/weather.ts`: a wet and a dry season, three in-game days each. In the dry one the pond drops up to
0.6 m and thirst runs up to 30% faster. Weather comes in 8 to 22 minute spells: rain (scent carries half as
far), fog (sight down to 40%), and ashfall (dim, brown, thirsty). Weather has its own RNG stream and is saved.

## Saves

The game saves to this browser every 30 s and when the tab is hidden (`src/sim/save.ts`, versioned JSON with
every RNG stream's state, so a loaded world plays on exactly as it would have). Continue from the splash
(L, or Y on a controller); export or import a save file from the pause card. `?adult` and `?fast` games
are never saved.

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
