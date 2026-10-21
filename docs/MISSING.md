# What Upstarts is missing — gap blueprint

Written 2026-10-21, ZaneGPT-style: what's built, what isn't, where the plans contradict each other,
and what to build in what order. Sources: `docs/BLUEPRINT.md` (roadmap M0–M9), the Dlist demo
(`demos/skin-test`, `docs/PORTING.md`, `docs/TUTORIAL.md` on Dlist's working branch), and the Upstarts
code as of commit `0dbd057`.

---

## 1. Where it stands (observations)

| Milestone | Blueprint promise | State |
|---|---|---|
| M0–M3 | Setup, greybox walk, survive, herds with scent and sound | **Built** |
| M4 | Bite combat, kill carcasses, growth stages, Saurosuchus hunts you | **Built** |
| M5 | Models, animation, plants, water, fog, lighting | **Half.** Herrerasaurus, environment and UI ported from Dlist; Hyperodapedon and Saurosuchus still greybox; no bloom or color grading; performance unmeasured on real hardware |
| M6 | Eodromaeus and Panphagia playable, remaining NPCs | Not started |
| M7 | Day/night, seasons, weather, saves, bigger streamed map | Not started |
| M8–M9 | Multiplayer, hosted alpha | Not started |

Sound (procedural engine) and footstep rumble are in, ahead of the roadmap.

---

## 2. Contradictions to settle first

These are places where the plans disagree with each other or with the code. Building on top of them
makes them more expensive later.

1. **Player identity (open tension T3).** The blueprint says "player identity lives in the world state
   from day one". The code has a single `world.player`. Every system added from here on (sleep,
   saves, egg, calls) hardens that assumption. *Cheapest to fix now.*
2. **AI hearing.** Blueprint §9 and Brain lesson sound-engine/E7: animals hear sim sound events. The
   code uses a `noiseOf` radius, and footsteps come from the client's animators, so what the player
   hears and what animals hear can disagree. Footfalls need to come from the sim's gait phase.
3. **Hatchling scale.** The Dlist tutorial (TD1) keeps the rig at adult size and builds the world 4x
   oversize. Upstarts scales the creature itself with growth. **The tutorial can't be ported as is**:
   its nest, plant sizes, prey sizes and camera distances assume the 4x world. Port the *beats*
   (egg, chirp, big-head look), not the layout.
4. **Damage model.** The demo uses `share = 0.2 r^1.5`, `r = (Ma/Mt)^(2/3) × bite/hide`, with hit-stop,
   knockback and fight-back. Upstarts uses `0.16 √(Ma/Mt)`. These give different outcomes for the
   same fight. Pick one.
5. **Controls.** Demo: X bite, B drink *and eat* (eat outranks drink, TD7), Y roar, A jump, LT rest.
   Upstarts: X eat *and bite*, B drink and sniff, no Y, A, LT. A player moving from the demo to the
   game relearns the pad. Pick one map.
6. **Stamina.** The demo cut recovery to a quarter (11 to 2.75%/s) so resting matters. Upstarts still
   regenerates 11%/s and has no Rest verb.
7. **Tutorial location.** You said the tutorial is built in the demo. "Start inside an egg" in
   Upstarts is therefore a **hatch sequence**, not the tutorial. Worth confirming that's the split.
8. **Map size.** Blueprint: about 2 × 2 km, growing to 4 × 4 km. Built: about 180 m across. This is
   the largest gap, and chunk streaming is a different architecture, not a parameter change.

---

## 3. The missing list, by system

### Foundations (invisible, but everything else sits on them)
- Player identity in world state: `players` map, creatures owned by a player id (T3).
- Named RNG streams per system (spawns, AI, combat, weather) plus a cosmetic stream. Today there's one `rand`.
- Sim-side footfall and body events, and AI hearing that reads them (E7).
- Versioned save format (IndexedDB) with export/import. Records-only carry-over is built (D13); world saves aren't.
- Sim in a Web Worker (D7, still PROPOSED).
- Replay-fingerprint test over a whole recorded session (per-tick tests exist; a recorded-command replay doesn't).

### Player creature (from the demo, not yet ported)
- **Egg and hatch:** soft leathery egg, tear free with repeated presses, shell scraps, first chirp, big-head baby look.
- **Calls:** Y roar plus the call wheel (roar, bellow, growl, boom, hiss, chuff), condition-based roars, hatchling chirp. The voice engine already supports them.
- **Rest:** lie down (LT / Z) for faster stamina recovery.
- **Jump:** crouch, ballistic leap scaled by size, ledge aim, scramble, stepping off.
- **Rocks and logs as footing:** step-up tiers, body-part collision, footholds.
- **Stumbles:** slip, stumble, trip from physical failure modes; falls with get-up.
- **Wet and mud:** the skin and fuzz shaders already have the bands; the state and drying aren't wired.
- **Footprints and scent marks:** wet or muddy tracks, visible scent trails and carcass plumes while sniffing.
- **Particles:** splashes, ripples, dust on landing, shell scraps.
- **Fight feel:** hit-stop, lunge root motion, head shake, knockback, limp below 30% health.
- **Touch haptics** on Android (`navigator.vibrate`), as in the demo.

### World
- **Day/night (D11):** 60 min daylight (40 near noon) plus 20 min night; lighting, fog and sky follow.
- **Night sleep (D14):** Hyperodapedon and Saurosuchus sleep at night; dinosaurs stay active. Sleeping animals wake on noise events.
- Wet/dry seasons (water shrinks), weather (rain, fog, ashfall).
- Map growth: river, oxbows, fern swamp, conifer uplands, badlands, volcano backdrop; chunks and level of detail.
- Pond ambience and reverb zones per area (the engine has zones; only `openPlain` is used).

### Creatures
- **Hyperodapedon** and **Saurosuchus**: procedural models in the Dlist style (currently greybox).
- NPCs: Exaeretodon (medium prey), Aetosauroides (armored, fights back), Ischigualastia (big herding dicynodont), small cynodonts.
- Playable: Eodromaeus, Panphagia.
- Utility AI with hysteresis (the herds and Saurosuchus are state machines today); cheap AI far from players.
- Spawn by fossil share, size predators by herbivore biomass (Brain dlist/E9).

### Presentation
- Bloom and color grading; quality presets.
- Performance pass: 640k triangles and 135 draw calls today, untested on a real integrated GPU (target 60 fps on a mid-range laptop).
- Settings menu: invert Y, rumble (built), volume, quality, readout toggle.

### Multiplayer (M8–M9)
- Node server running the same sim, client prediction, interpolation, interest management, binary snapshots, lag-compensated bites.

---

## 4. Build order

Ordered by what's cheap now and expensive later, then by what you feel when you play.

| # | Batch | Why now | Size |
|---|---|---|---|
| 1 | **Foundations:** player identity, named RNG streams, sim footfall events with hearing from events | Every later system builds on these. Retrofitting identity after saves and multiplayer is the expensive path (T3). | M |
| 2 | **Settle the contradictions:** one control map, one damage model, stamina recovery and Rest | Small code, but every playtest before this trains the wrong habits. | S |
| 3 | **Egg and hatch, calls (Y), chirp** | The opening minute, and calls are half-built already in the voice engine. | S |
| 4 | **Day/night and night sleep (D11, D14)** | Locked decisions with nothing built. It gives the underdog pillar its rhythm: night is the dinosaurs' time. | M |
| 5 | **Hyperodapedon and Saurosuchus models** | Finishes M5's look; the greybox now clashes with the ported Herrerasaurus. | M |
| 6 | **Jump, rocks as footing, stumbles; wet/mud; footprints and scent marks** | Demo systems that are tuned and tested; porting is mostly mechanical. | L |
| 7 | **Saves (versioned, export/import)** | Needed before long growth sessions are worth playing. | M |
| 8 | **Performance pass and quality presets** | Measure on a real laptop before the map grows. | M |
| 9 | **Bigger map with streaming and zones; seasons and weather** | The biggest architectural jump; do it on measured performance. | XL |
| 10 | **Roster (M6)**, then **multiplayer (M8–M9)** | Per the blueprint's own order. | XL |

---

## 5. Decisions only you can make

1. **Controls:** adopt the demo's pad map (X bite, B drink/eat, Y roar, A jump, LT rest)? *Recommended: yes, the demo's is tested and has room for every verb.*
2. **Damage model:** the demo's `(Ma/Mt)^(2/3)` with fight-back, or Upstarts' square root? *Recommended: the demo's; it was tuned against a real tutorial fight.*
3. **Hatch in Upstarts:** a short hatch sequence on every new life, with the full tutorial staying in Dlist? *Recommended: yes.*
4. **Growth time (open decision #2):** built at 2.5 h to adult. Keep it?
5. **Map size:** commit to 2 × 2 km, or hold at the current valley until the performance pass?
6. **Nesting and family play (open decision #7)** and **first-person camera (#6)**: still open.

---

## 6. Risks and failure modes

- **Porting drift:** the demo keeps changing (PORTING.md says so). Port from tagged commits and note the
  commit in each port, or Upstarts silently forks the tuning.
- **The vendored sound engine** carries a local voice patch that isn't upstream yet (VENDORED.md). A
  re-copy from `sound-engine` would drop it.
- **three.js is pinned at 0.160** for the fuzz shader. Upgrading needs a screenshot diff against the demo.
- **Feel can't be tested headless:** every batch above ends with your playtest, not just green tests.

## Next move

Decide items 1–3 in section 5. Batch 1 (foundations) doesn't depend on them and can start right away.
