# Upstarts — Game Blueprint

Status: **M4 built**, **M5 under way**: the Dlist demo's environment, Herrerasaurus model and
animation, and UI are ported in (Hyperodapedon and Saurosuchus are still greybox). Game code lives in this repo; the demo and
tutorial live in [Dlist](https://github.com/Pappydapimp69/Dlist). Everything below is a proposal until
marked **LOCKED**. Items marked **YOUR CALL** need a decision from you.

Title: *Upstarts* (D9).

---

## 1. Vision

A grounded, browser-based dinosaur survival game in the spirit of *The Isle*,
set at the dawn of the dinosaurs. You play one creature, from hatchling to
adult. You eat, drink, avoid being eaten, and grow. Dinosaurs here are
**not** the top of the food chain yet. That's the hook.

### Pillars
1. **Survival first.** Hunger, thirst, threat. Every trip to water is a risk.
2. **Underdog era.** The apex predator is a crocodile-relative, not a dinosaur.
3. **True to the record.** Animals, plants and landscape come from one real
   place and time. Invent only where the fossils are silent (colors,
   behavior details).
4. **Runs in a browser tab.** No installs. Decent-looking, not cartoony.
5. **Multiplayer-shaped from day one,** even while it's single-player.

---

## 2. Setting — LOCKED

**Ischigualasto Formation, northwestern Argentina, ~231 million years ago
(Late Triassic, Carnian age).** It's one of the best-preserved early-dinosaur
ecosystems we know.

### Landscape
- A wide river floodplain in a rift valley, with meandering channels, oxbow
  ponds, levees and swampy low ground.
- **Seasonal climate:** wet and dry seasons. Water sources shrink in the dry season.
- Volcanoes nearby. The ash layers in these rocks are how the site is dated.
  Gameplay: occasional **ashfall** weather events. The volcano we show on the
  horizon is artistic license, since the real source isn't pinned down.

### Accuracy rules (the "no grass" list)
- **No grass.** Grasses didn't exist yet. Ground cover is ferns, horsetails, mosses
  and bare mud or sand.
- **No flowers or flowering plants.** None existed yet.
- Trees: conifers and seed ferns (*Dicroidium* is the signature plant), plus
  cycad-like plants. Ferns and horsetails grow along the water.
- No birds. No true mammals are known from these rocks. Small mammal-relatives (cynodonts) are fine.
- Creature colors and patterns are invented. Skin texture is plausible guesswork.
- Behaviors (herding, territories, hunting styles) are game design informed by
  the anatomy, not facts from the fossils. We label them that way.

---

## 3. Species roster

Sizes are adult estimates from the fossil literature, rounded. They're
starting points for tuning, not promises.

### Playable at launch — LOCKED
| Species | Size | Diet | Playstyle |
|---|---|---|---|
| **Herrerasaurus** | 4.5–6 m, ~200–350 kg | Carnivore | Biggest dinosaur predator around. Strong bite. By design, it loses 1-on-1 to an adult Saurosuchus. |
| **Eodromaeus** | ~1.2 m, ~5 kg | Carnivore | Fast, fragile, hunts small prey, scavenges, survives by running. |
| **Panphagia** | ~1.3 m (the known fossil is a juvenile) | Omnivore | Eats plants, small prey and carrion. The flexible "easy mode." |

### NPC creatures (v1)
| Species | Size | Role |
|---|---|---|
| **Hyperodapedon** | ~1.3–2 m | Beaked rhynchosaur and the most common fossil animal here. The main prey for everything. Herds (game choice). |
| **Exaeretodon** | ~1.8 m | Mammal-relative herbivore. Medium prey. |
| **Aetosauroides** | ~3 m | Armored herbivore. Hard to kill and fights back. Mid/late-game prey. |
| **Ischigualastia** | ~3.5 m | Big beaked dicynodont. Unlike many relatives, it had **no tusks**. Herds (game choice). Dangerous up close. Late-game prey. |
| **Saurosuchus** | ~6–7 m (some estimates larger) | Apex predator, a crocodile-relative. Hunts the player. Rare, roams territories. |

### Later candidates
Playable: Eoraptor, Sanjuansaurus, Chromogisaurus.
NPC: Sillosuchus (a big beaked crocodile-relative), small cynodonts, and fish
or insects as ambient life.

---

## 4. Core loop

> Spawn as a hatchling → find water and food → avoid predators → grow →
> hunt bigger prey → (later) nest and pass on.

### Survival stats — LOCKED (D12)
| Stat | Proposal |
|---|---|
| Hunger | Drains over time. Faster when sprinting or healing. |
| Thirst | Drains faster than hunger. Faster in the dry season. |
| Stamina | Sprinting, attacking and swimming drain it. Regenerates at rest. |
| Health | Damage from fights and falls. Regenerates slowly when fed and watered. |
| Injuries (later) | Bleeding (leaves a scent trail) and a broken leg (slows you). |
| Temperature | **Skip for v1.** Seasons and day/night carry the climate. |

### Growth — PROPOSED, YOUR CALL
- Stages: **hatchling → juvenile → sub-adult → adult.** Size, speed, bite and
  health scale between stages.
- You grow while fed and watered. Suggested time to adult: about 2–3 hours of
  play (*The Isle* takes far longer). This is a single setting we can tune.
- **The growth vs. death tradeoff:** permadeath plus long growth means one
  Saurosuchus ambush can cost hours. Longer growth makes adults feel earned but
  punishes death harder. Growth time and death rules must be decided together.
- Small species grow up faster than big ones.

### Death — LOCKED (D10)
- Death is permanent for that creature. You respawn as a new hatchling.
- What carries over: **records only** (longest life, kills and the like). No unlocks or
  skins carry over (D13).
- Your body stays in the world as a carcass that others can eat.

### Senses and interaction
- **Scent.** Blood, carcasses and trails leave a decaying scent field on the
  map. Carnivores can track it; prey can detect predators downwind (later).
- **Sound.** Footsteps, calls and fights make noise with a radius. Big
  animals are loud.
- **Calls.** A few vocal calls per species (friendly, threat, distress). This
  is the social language of multiplayer.
- **Eating.** Carcasses hold a meat amount that rots over time. Plants are
  patches that regrow. Water is any river or pond.
- **Combat.** Directional bite and claw attacks with stamina costs. Size
  ratio matters a lot. Grab or pin comes later.

### World cycles
- Day/night cycle (D11): **60 minutes of daylight, then 20 minutes of night** (an 80-minute
  cycle). The sun spends 40 of the daylight minutes within ±15° of its highest point; dawn
  and dusk share the other 20. Night is dark and dangerous.
- **Night belongs to the dinosaurs (D14).** Every non-dinosaur reptile (*Saurosuchus*,
  *Hyperodapedon* and the other crocodile-line and lizard-like animals) sleeps through the
  night. Dinosaurs, the player included, stay active. *Guess, labelled:* early dinosaurs
  probably had a higher metabolism (fast bone growth), but this is debated, and some
  crocodile-line reptiles may have run warm too. It's a gameplay choice built on a likely idea.
- Wet/dry season cycle over several in-game days.
- Weather: rain, fog, ashfall.

---

## 5. Map — PROPOSED, YOUR CALL

- **One valley, about 2 × 2 km at first, growing to around 4 × 4 km** once
  streaming is proven. Browsers can't hold an *Isle*-sized map in one piece.
- Zones within the valley: main river, oxbow lakes, fern swamp, conifer
  uplands, dry badlands at the edges, and a volcano on the horizon (backdrop
  only).
- Terrain from a generated heightmap that we hand-tweak. Split into chunks for
  streaming and level of detail.

---

## 6. Tech architecture

### Stack — LOCKED
- **Three.js** (latest stable at project start) for rendering only, **TypeScript**, **Vite**.
- We own everything else ourselves: movement/physics, animation, AI, netcode.
  That custom layer is the real engine, and its lessons go back into Brain.
- WebGPU when available, WebGL2 fallback.
- **Node.js** for the multiplayer server (later).
- **Vitest** for unit tests and **Playwright** for in-browser tests.

### The key idea: the game logic never touches the renderer
```
packages/
  sim/      pure TypeScript game logic. No Three.js, no DOM.
            Creatures, stats, AI, combat, world rules.
  client/   Three.js rendering, input, audio, UI.
  server/   Node.js host that runs `sim` for multiplayer (later).
  shared/   network protocol, species data, constants.
```
- The movement code is shared so the client can predict your own creature
  (see Multiplayer plan).
- `sim` runs at a **fixed tick** (20–30 ticks/sec). The client renders at
  display rate and blends between ticks.
- **Solo play runs `sim` in a Web Worker,** a "server" inside your browser.
  Multiplayer runs the same `sim` on a Node server. Same code, two hosts, so
  multiplayer isn't a rewrite.
- Every player action is a **command** (move, bite, eat, call). The sim
  applies commands and emits **events** (hit, died, ate). The renderer only
  reads state and events and never writes game state.
- **Player identity lives in the world state from day one.** Each creature
  records which player owns it, even in solo.

### Physics
- **No physics engine in the game logic.** Movement is a simple custom
  controller: it slides along the heightmap, uses circle-vs-circle collision
  between creatures and trees, and has slope limits. That's cheap, easy to
  run on a server, and predictable.
- Cosmetic effects (ragdolls, debris) are client-only and never touch gameplay.

### Randomness
- Seeded random number generator with **one named stream per system** (spawns, AI,
  combat, weather), plus a separate cosmetic stream for rendering effects.
  Save the generator's full state, not just the seed.
- Why: reproducible bugs, replay tests, fair server behavior. We are **not**
  doing lockstep netcode, so we don't need bit-perfect floats across machines.

### Multiplayer plan (built later, designed now)
- **Server-authoritative.** The server's sim is the truth, and clients send
  commands only.
- Your own creature moves instantly on your screen (client prediction) and
  gets corrected by the server. Other creatures are shown slightly in the
  past and smoothed (interpolation).
- Each client only receives creatures near it (interest management).
- Transport: WebSockets, with compact binary snapshots.
- Bite hit detection uses limited lag compensation, with a cap on how far
  back the server will rewind.
- Expected size: **20–50 players per server.** This is an estimate. The real
  limit comes from server CPU (NPC AI too) and bandwidth, and we'll measure it at M8.

### Hosting
| Phase | Hosting | Cost |
|---|---|---|
| Solo builds | Static site: Cloudflare Pages, or GitHub Pages if the repo is public (Pages on private repos needs a paid GitHub plan) | Free |
| Friends playtests (option) | One player's browser hosts the sim and others connect peer-to-peer (WebRTC). Still needs a small free signaling service, and some home networks need a relay server. Easy to cheat, fine for friends. | ~Free |
| Public multiplayer | Small VPS (Hetzner, Fly.io) running the Node server | ~$5–20/mo per server |

### Saving (solo)
- The world plus your creature is saved to browser storage (IndexedDB).
- The save format is versioned from the first save.
- Browsers can wipe this storage, so we add an export/import save-file button.

---

## 7. Art and animation pipeline — LOCKED approach

### Creatures
- **Generated by code:** a skeleton plus a body built from curves and
  cross-sections along the spine, neck, tail and limbs. The result is a
  low-poly, faceted, readable silhouette.
- Each species is a **data file** (proportions, bone lengths, colors), so we
  can tweak shapes without rewriting code.
- Skin: code-generated patterns (stripes, mottling, countershading) with
  per-individual variation.
- Models are exported as glTF so we can swap in better ones later (AI-generated,
  bought or commissioned). A swapped-in model has to be rigged to our skeleton
  layout first. That's scriptable, but it's real work for each model.

### Animation (procedural)
- Legs: inverse kinematics that plant feet on uneven terrain, with a gait
  cycle driven by speed.
- Spine, neck and tail: follow-through and sway from physics-like springs.
- Head tracks targets. Breathing and idle motions.
- A few authored poses blended in: bite, roar or call, eat, drink, rest,
  death.

### Environment
- Terrain shader blending mud, sand, rock and moss by slope and wetness.
- Plants as instanced meshes (thousands for cheap): ferns, horsetails, cycads,
  conifers, Dicroidium.
- Water: river and pond surfaces with simple reflection and flow.
- Atmosphere: distance fog (also hides the draw-distance limit), cascaded
  shadows, bloom, color grading. Mood comes from light, not texture detail.

### Look
Grounded and moody. Low-poly forms, realistic lighting, muted earthy colors,
heavy atmosphere. Nothing bright or toy-like.

---

## 8. Creature AI

- **Utility AI:** each creature scores its options (graze, drink, flee, hunt,
  rest, follow herd) and does the best one. Hysteresis keeps it from flipping
  between options every tick.
- **Perception:** sight cone, hearing radius, and smell (reads the scent field).
- **Herds:** Hyperodapedon and Ischigualastia move as groups. Alarm spreads
  through the herd.
- **Saurosuchus:** territorial roamer. Picks targets by size ratio and hunger.
  Gives up chases after a stamina or distance limit.
- **Movement first:** chase-and-flee quality depends mostly on speed and
  stamina balance, so we tune those before tuning AI logic.
- Creatures far from any player run a cheap, simplified version of the AI.

---

## 9. Sound engine — LOCKED: fully procedural

Every sound is generated by code at runtime. No recorded or designed sound files,
ever. The browser's Web Audio API is the low-level layer (like WebGL is for
graphics). Our engine sits on top of it and decides what plays, where, and how.

### Architecture
- **Sound events from the sim.** The game logic emits events such as footfall,
  splash, bite, call, body impact or plant brushing. Each event carries a position,
  energy, material, creature size and species. The client turns events into
  sound. The same events drive AI hearing (§8), so what you hear and what NPCs
  hear always agree. AI hearing uses event energy and distance, never the audio
  output.
- **Custom DSP in an AudioWorklet** (runs on the audio thread, loaded from an
  inline blob). Simple sounds use built-in Web Audio nodes. Complex synthesis runs
  in the worklet.
- **Mixer with buses:** ambience, creatures, foley (footsteps and contact), water,
  weather and UI, each with level and ducking. A must-hear sound, like a nearby
  predator call, ducks the ambience bed.
- **Voice manager:** a concurrent voice budget of about 16 to 24 with priority
  (closer, louder and more dangerous wins), cooldowns on rapid repeats, and
  `onended` cleanup.
- **Sound level of detail:** far or quiet sources use cheaper synthesis (fewer
  partials or grains). Near sources get the full model.
- **Timing:** everything is scheduled on the AudioContext clock with a look-ahead
  window, never with setTimeout.
- **Startup:** audio unlocks on the first click or key press. The game never waits
  on audio starting (some browsers, Brave for example, leave `resume()` pending forever).

### Synthesis techniques (what makes it better than the demo)
| Sound family | Technique |
|---|---|
| Creature calls | **Source-filter vocal model.** A source (pulse train, noise, or both, with jitter, subharmonics and roughness) passes through formant filters set by vocal tract length, so size and species change the voice automatically. Pitch, effort and mouth opening are animated over the call. |
| Footsteps and impacts | **Modal synthesis.** Impact energy (from weight and speed) excites resonant modes picked per surface (packed dirt, sandstone, mud, wood, shallow water). Heavier animals hit lower and harder. |
| Water, mud, rain, gravel, crunching ferns | **Granular synthesis.** Many tiny procedural grains (bubbles, droplets, squelches, leaf snaps) with randomized timing and pitch, driven by event intensity. Bubble grains use the classic resonant bubble model, so pitch comes from bubble size. |
| Wind | Filtered noise layers driven by the world wind direction and gust model. Wind also hisses through foliage near conifers and ferns. |
| Ambient life | Procedural insects and small animals (FM and noise chirps). Kept era-appropriate: no birdsong, since no birds existed yet. |
| Body sounds | Breathing and panting tied to stamina, swallowing and lapping while drinking, bites and jaw snaps, sniff bursts. |

### Space and environment
- **3D positioning** with HRTF panning and distance falloff.
- **Occlusion:** terrain and dense vegetation between the source and the listener
  low-pass and quiet a sound. Checked against the heightmap and a vegetation
  density map, not per-mesh raycasts.
- **Reverb zones:** open floodplain, fern swamp, rocky gully, forest. Impulse
  responses are generated procedurally (noise shaped by decay time and
  brightness), so reverb needs no recordings either.
- **Weather and time of day** change the ambience mix (night insects, rain beds,
  muffled sound in fog).

### Accuracy
- Creature voices are informed guesses. Herrerasaurus's living relatives,
  crocodiles and birds, suggest closed-mouth rumbles, booms, hisses and grunts.
  Movie-style open-mouth roars are speculative. Build both styles in the voice
  model, and keep the default call set grounded.
- No birds, frogs of modern kinds, or grass rustle (no grass existed yet).

### Determinism and multiplayer
- Sound is cosmetic and client-side. It uses its own random stream, never the
  sim's, so audio can never desync gameplay.
- Every client hears the same events, because they come from the server's sim.

---

## 10. Performance targets

| Target | Goal |
|---|---|
| Mid-range laptop (integrated GPU) | 60 fps at medium settings (ambitious; verified at M5) |
| Low-end | 30 fps at low settings |
| First load | Under ~30 MB before you can play |
| Draw calls | Measured, not guessed. Budget set once the first scene exists. |

Techniques: instancing, merged static meshes, level of detail with
anti-flicker buffers, GPU-compressed textures (KTX2), chunk streaming,
fog-limited draw distance, no memory churn in per-frame code, and quality
presets.

---

## 11. Testing and verification

- **Sim tests (headless):** stats, growth, AI decisions and combat math run
  without a browser. Fast, many seeds.
- **Replay fingerprints:** record commands, replay them, and check that the
  world ends identical. This catches hidden randomness and order bugs.
- **Browser smoke tests:** Playwright opens the game, checks that it renders
  frames, walks the creature, and catches errors.
- **Limit:** automated tests can prove the logic works, not that it *looks or
  feels* right. Playtests with you are the real check for looks and feel.

---

## 12. Roadmap

Each milestone ends with something you can open in a browser and play.

| # | Milestone | You can… |
|---|---|---|
| M0 | Project setup | Open a blank Three.js scene from a URL |
| M1 | Greybox walk | Walk a placeholder Herrerasaurus over terrain with a third-person camera |
| M2 | Survive | Drink at the river, eat placed carcasses, watch stats drain, die and respawn |
| M3 | Life | Hyperodapedon herds graze, flee and get hunted. Scent and sound work. |
| M4 | Fight and grow | Bite combat, carcasses from kills, growth stages, Saurosuchus hunts you |
| M5 | Look | Procedural creature models and animation, plants, water, fog and lighting |
| M6 | Roster | Eodromaeus and Panphagia playable. Remaining NPCs added. |
| M7 | World | Day/night, seasons, weather, saves, map grown and streamed |
| M8 | Multiplayer (local) | Node server on your PC. Friends join over the internet or peer-to-peer. |
| M9 | Online alpha | Hosted server, public test |

Order rationale: the game should be **fun in greybox (M1–M4) before we spend
time on art (M5).**

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Procedural dinos look bad | Data-driven bodies we can keep tweaking. glTF swap path. Lighting and fog carry the mood. |
| Browser performance | Budgets from M1, quality presets, fog and level of detail, measure before optimizing |
| Netcode is hard | Sim/render split and command model from day one. Multiplayer is a host swap, not a rewrite. |
| Scope creep (it's months of work) | Milestones are playable. Extra species and features wait for the roster phase. |
| Fun is unproven | Greybox playtests before the art pass |
| Historical details are uncertain | Accuracy rules in §2. Uncertain things are labeled as guesses. |

---

## 14. Open decisions — YOUR CALL

1. ~~Survival stats~~ Decided: the §4 set as proposed (D12).
2. Growth time: about 2–3 hours to adult, or longer like *The Isle*? (Built at 2.5 h as a single setting, `GROWTH.toAdult`.)
3. ~~Death~~ Decided: permanent (D10); only records carry over (D13).
4. Map: start at 2 × 2 km, as proposed?
5. ~~Day length~~ Decided: 60 min of daylight (40 near midday) plus 20 min of night (D11).
6. Camera: third-person only, or a first-person option too?
7. Nesting and family play (*The Isle*-style): in scope later, or never?
8. ~~Real name for the game.~~ Decided: **Upstarts** (D9).

---

## 15. Decision log

| # | Decision | Status |
|---|---|---|
| D1 | ~~Babylon.js~~ → **Three.js** + TypeScript, browser-only client. Switched because our own movement code removes the need for built-in physics. | LOCKED |
| D2 | Multiplayer-ready architecture now, servers later | LOCKED |
| D3 | Setting: Ischigualasto, ~231 Ma | LOCKED |
| D4 | Launch playables: Herrerasaurus, Eodromaeus, Panphagia | LOCKED |
| D5 | Art: code-generated low-poly creatures plus procedural animation, upgrade later | LOCKED |
| D6 | No physics engine in game logic. Custom movement controller. | LOCKED |
| D7 | Solo play runs the sim in a Web Worker | PROPOSED |
| D8 | Fully procedural sound engine. No recorded or designed audio. | LOCKED |
| D9 | Game name: **Upstarts**. The full game lives in its own repo, `upstarts`. Dlist stays the shareable demo and tutorial. | LOCKED |
| D10 | Death is permanent for that creature. You respawn as a new hatchling. | LOCKED |
| D11 | Day/night: 60 min of daylight (the sun within ±15° of its highest point for 40 of them), then 20 min of night. | LOCKED |
| D12 | Survival stats: hunger, thirst, stamina, health; injuries later; no temperature in v1. | LOCKED |
| D13 | After a death only records carry over (longest life, kills). No unlocks or skins. | LOCKED |
| D14 | Non-dinosaur reptiles sleep at night; dinosaurs, the player included, stay active. | LOCKED |

---

## 16. Brain input

### Lessons applied
| Brain lesson | Where it shows up |
|---|---|
| Authoritative reducer with a command/event split | §6: sim/render split and command model |
| Seeded RNG: named stream per system, save full state, cosmetics on their own stream | §6 Randomness |
| Keep physics float noise out of the authoritative layer | §6 Physics (no physics engine in sim) |
| Server rewind must cap the latency it trusts | §6 lag compensation |
| Mesh count ≠ draw calls, measure first. Instancing and shared materials. | §10 |
| KTX2 cuts VRAM, Draco only cuts download | §10 |
| LOD switches need hysteresis or they flicker | §10 |
| A 60 fps budget means zero per-frame allocations | §10 |
| Utility AI plus hysteresis. Speed parity matters more than flee-AI cleverness. | §8 |
| An "arrive" state needs an arrival radius or it livelocks | §8 (implementation note) |
| Pheromone-style decaying grid for scent trails | §4 Scent |
| Headless WebGL needs SwiftShader flags. "Didn't crash" tests are false-green. | §11 |
| Pointer-lock deltas and HUD sizing break under OS display scaling | Client input (M1 note) |
| Release WebGL/Audio contexts where they're created | Client lifecycle (M0 note) |
| Scale creatures against an in-world reference, not alone | M1/M5 art checks |
| Assert the *sign* of camera-relative movement in tests | M1 test |

### Open tensions that touch this project
- 🔴 **T3: "co-op without a rewrite" vs. the save format.** Our answer is
  player identity in world state from day one, plus a versioned save. §6.
- 🔴 **T11: automated 3D checks have a ceiling (logic, not looks).** We accept
  it: playtests are the visual gate. §11.
- 🟡 **T2: determinism vs. a physics-driven game.** We resolve it by keeping
  physics out of the sim. §6.
- 🟡 **T10: does greybox-first keep a 3D game on schedule?** We're betting yes.
  M1–M4 come before art.
- 🟡 **T16: engine paths not taken.** Unity, Unreal, Godot and Babylon.js were
  considered and passed over for D1.
