import { createWorld, hatchAs, step, TICK_DT, CARCASS } from './sim/world';
import { browseAt } from './sim/flora';
import { lerp, smooth, wrapAngle } from './sim/math';
import { groundAt, surfaceAt as surfaceKind } from './sim/ground';
import { waterDepthAt } from './sim/terrain';
import { SceneView } from './render/scene';
import { HerreraAnimator } from './render/dlist/animator.js';
import { isQuad, QuadAnimator } from './render/quadruped';
import { fernCut } from './render/dlist/env.js';
import { dayTime } from './sim/clock';
import { isSprinting, type Command } from './sim/dino';
import { FollowCamera } from './render/camera';
import { CarcassMeshes } from './render/worldMeshes';
import { Ui } from './render/ui';
import { HerbivoreMeshes } from './render/herbivoreMesh';
import { SmallMeshes } from './render/smallMesh';
import { EggView } from './render/eggMesh';
import { visibleFraction } from './render/visibility';
import { exposed, SMALL } from './sim/smallprey';
import { SauroMeshes } from './render/sauroMesh';
import { FootfallRumble } from './render/rumble';
import { AudioLayer, tractOf, type Surface } from './audio/audio';
import { clamp } from './sim/math';
import { HYPERODAPEDON } from './sim/herbivore';
import { SAUROSUCHUS } from './sim/saurosuchus';
import { setPlaying, setRoarLabel, state as inputState } from './input/input';
import { CALLS, roarStyle } from './sim/calls';
import { initInput, readInput } from './input/input';
import { objectiveOf } from './sim/objective';
import { FrameStats } from './render/frameStats';
import { TrailView } from './render/trailView';
import { loadSave, writeSave } from './render/saveStore';
import type { SpeciesId } from './sim/species';
import { bodyScale } from './sim/balance';
import { Marker } from './render/marker';
import { BLOOD, Drops } from './render/blood';
import { CoatView, coatText } from './render/coatView';

// ?fast runs hunger, thirst and growth 20x faster, to try the loop quickly. ?adult starts fully grown.
const params = new URLSearchParams(location.search);
const stats = params.has('fps') ? new FrameStats() : null; // frame meter for checking a phone
// A saved life carries on (render/saveStore.ts); ?new starts over, and test runs (?debug, ?adult) never load one.
const saved = params.has('new') || params.has('debug') || params.has('adult') ? null : loadSave();
const world = saved ?? createWorld((Math.random() * 2 ** 31) | 0, params.has('fast') ? 20 : 1, params.has('adult') ? 1 : 0, undefined, !params.has('adult'));
// Testing (the owner's call): growth runs 101x (+10000%), so a Herrerasaurus is adult in about 90 s of
// fed play. ?realgrowth turns it off.
const TEST_GROWTH = params.has('realgrowth') ? 1 : 101;
world.growScale = TEST_GROWTH;
document.getElementById('growChip')!.hidden = TEST_GROWTH === 1;
const ui = new Ui();
if (saved) ui.setContinue(world.player);
else if (ui.selected !== world.speciesId) hatchAs(world, ui.selected);
const view = new SceneView(document.body);
const carcassMeshes = new CarcassMeshes();
view.scene.add(carcassMeshes.group);
const herbMeshes = new HerbivoreMeshes();
view.scene.add(herbMeshes.group);
const eggView = new EggView();
view.scene.add(eggView.group);
const smallMeshes = new SmallMeshes();
view.scene.add(smallMeshes.group);
const sauroMeshes = new SauroMeshes();
view.scene.add(sauroMeshes.group);
const marker = new Marker();
view.scene.add(marker.g);
const blood = new Drops(groundAt, BLOOD);
view.scene.add(blood.points);
const coatView = new CoatView();
view.scene.add(coatView.group);
const trailView = new TrailView();
view.scene.add(trailView.group);
// Fight feel (the Dlist demo's): a hit-stop freezes your own animation for a few hundredths of a second when a
// bite lands, the head shakes to tear, and a bite taken makes it flinch away from that side.
const fx = { hold: 0, heldBiteT: 0, biteHit: false, hurtT: 9, hurtSide: 0, hurtK: 0, jolt: 0 };
const blowText = (blow: 'kick' | 'swipe', left: number): string => (left <= 0 ? 'Killed it' : blow === 'kick' ? 'Kicked it' : 'Hit it with the tail');
const woundText = (left: number): string => left <= 0 ? 'Killed it' : left > 0.6 ? 'Bit it, a light wound' : left > 0.3 ? 'Bit it, badly wounded' : 'Bit it, nearly finished';

let p = world.player;
// The Dlist demo's Herrerasaurus model, reshaped per species. One model, re-planted for each new
// hatchling and rebuilt when the species changes.
// Two-legged species are the Herrerasaurus rig reshaped (shapes.js); four-legged ones have their own (quadruped.ts).
type Animator = HerreraAnimator | QuadAnimator;
const makeAnimator = (id: string): Animator => (isQuad(id) ? new QuadAnimator(id) : new HerreraAnimator(id));
let herrera: Animator = makeAnimator(p.species.id);
view.scene.add(herrera.root);
const rigScale = (): number => p.body.hip / herrera.rigHip;
herrera.plant(p.x, p.z, p.yaw, rigScale());
function useModel(): void {
  if (herrera.speciesId === p.species.id) return;
  const onStep = herrera.onStep, onSound = herrera.onSound;
  view.scene.remove(herrera.root);
  herrera = makeAnimator(p.species.id);
  herrera.onStep = onStep;
  herrera.onSound = onSound;
  view.scene.add(herrera.root);
}
const cam = new FollowCamera(view.camera, p.yaw, p.x, p.y, p.z);
initInput(view.renderer.domElement);
// Sound: the vendored procedural engine, started inside the first key, click or tap (the browser
// only allows audio from a user gesture). A controller press also tries, where the browser allows it.
const audio = new AudioLayer();
const soundChip = document.getElementById('soundChip')!;
audio.onState = () => {
  const st = audio.status;
  soundChip.textContent = st === 'on' ? 'Sound is on' : st === 'failed' ? 'The sound engine could not start in this browser.'
    : st === 'starting' ? 'Starting the sound engine…' : 'Sound is off. Press a key, click or tap to turn it on.';
  soundChip.className = st === 'on' ? 'chip ok' : 'chip warn';
  if (st === 'on') setTimeout(() => (soundChip.hidden = audio.status === 'on'), 2500);
};
for (const ev of ['keydown', 'pointerdown'] as const) window.addEventListener(ev, () => audio.start(), { capture: true });
// Footsteps by what the foot comes down on (demo: dirt, sandstone, wood, mud, water).
const SURFACE = { water: 'water', mud: 'mud', rock: 'sandstone', log: 'wood', dirt: 'packedDirt' } as const;
const surfaceAt = (x: number, z: number): Surface => SURFACE[surfaceKind(x, z)];
const tract = (): number => tractOf(p.body.size) * (p.species.length / 5.2);

// Footsteps rumble the controller by weight, speed and direction (relative to the camera).
const rumble = new FootfallRumble();
const panOf = (x: number, z: number): number => {
  const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1;
  return (dx * Math.cos(cam.yaw) - dz * Math.sin(cam.yaw)) / d; // camera right is (cos yaw, -sin yaw)
};
herrera.onStep = (foot: { x: number; y: number; z: number }) => {
  coatView.step(foot, p);
  rumble.own(p.body.mass, p.speed, p.body.sprintMax, performance.now(), inputState.device === 'touch');
  // Your own small feet are close-miked: a hatchling's steps are physically almost silent. Only the mix.
  audio.step('player', foot, p.body.mass, p.speed, surfaceAt(foot.x, foot.z), clamp((350 / p.body.mass) ** 0.3, 1, 3.5));
};
herrera.onSound = (kind: 'lap' | 'drip' | 'gulp' | 'sniff' | 'tear' | 'thud', at: { x: number; y: number; z: number }) => audio.body(kind, at, p.body.mass);
const feel = (who: 'prey' | 'saurosuchus', mass: number) => (x: number, z: number, speed: number, quiet: number): void => {
  rumble.step(mass, speed, Math.hypot(x - p.x, z - p.z), panOf(x, z), quiet, performance.now(), inputState.device === 'touch');
  audio.step(who, { x, y: groundAt(x, z), z }, mass * quiet * quiet, speed, surfaceAt(x, z));
};
herbMeshes.onStep = feel('prey', HYPERODAPEDON.mass);
sauroMeshes.onStep = feel('saurosuchus', SAUROSUCHUS.mass);
ui.setRumble(rumble.enabled);
ui.onRumbleButton(() => ui.setRumble(rumble.toggle()));
// The game waits on the splash until the player hatches; the menu button pauses it.
let started = false, paused = false;
let viewZoom = 1; // ?debug can pull the camera in for close looks
// One-shot presses wait for the next sim tick: at a high frame rate some frames run no tick at all.
let pendingCall: Command['call'], pendingRespawn = false;
ui.showIntro(true);

// Fixed-step sim, free-running render, interpolated between the last two ticks.
let prev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
let last = performance.now();
let acc = 0;

function nearby(): { water: boolean; food: boolean; prey: boolean; browse: boolean } {
  const r = p.body.reach;
  let water = false;
  for (let i = 0; i < 12 && !water; i++) {
    const a = (i / 12) * Math.PI * 2;
    water = waterDepthAt(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r) > 0.05;
  }
  const now = world.tick * TICK_DT;
  const food = world.carcasses.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < r + CARCASS.radius)
    || world.grubs.some((g) => g.readyAt <= now && Math.hypot(g.x - p.x, g.z - p.z) < p.body.snout + 1);
  const inFront = (x: number, z: number, rad: number): boolean => Math.hypot(x - p.x, z - p.z) < p.body.snout + 0.6 + rad
    && Math.abs(wrapAngle(Math.atan2(x - p.x, z - p.z) - p.yaw)) < 0.7;
  const prey = world.herbivores.some((h) => inFront(h.x, h.z, 0.8)) || world.sauros.some((s) => inFront(s.x, s.z, 1.4))
    || world.smalls.some((s) => exposed(s) && inFront(s.x, s.z, SMALL[s.kind].length / 2));
  const browse = p.species.diet === 'omnivore' && browseAt(p.x, p.z) > 0.5;
  return { water, food, prey, browse };
}

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += dt;
  stats?.begin();
  const inp = readInput();
  if (!started) {
    if (inp.nav) ui.move(inp.nav);
    if (inp.confirm) {
      audio.start();
      if (ui.selected !== world.speciesId) {
        hatchAs(world, ui.selected);
        p = world.player;
        useModel();
        herrera.plant(p.x, p.z, p.yaw, rigScale());
        prev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
        cam.snapBehind(p);
      }
      started = true;
      ui.showIntro(false);
      ui.setContinue(null);
      inp.confirm = false; // the press that started the game must not also tear the egg
    }
    acc = 0;
  } else if (paused) {
    if (inp.toggle) ui.setRumble(rumble.toggle());
    if (inp.confirm || inp.menu) {
      paused = false;
      ui.showPause(false);
      inp.confirm = false; // nor the one that resumed it
    }
    acc = 0;
  } else if (inp.menu) {
    paused = true;
    ui.showPause(true);
  }
  const live = started && !paused;
  if (live && !p.alive && inp.nav) ui.move(inp.nav); // death card: choose what to hatch as next
  setPlaying(live && p.alive);
  setRoarLabel(CALLS[p.species.ecto ? p.species.calls : roarStyle(p.stamina, p.needs.thirst, p.needs.hunger)].label);
  const cmd = cam.command(live ? inp : { ...inp, moveF: 0, moveR: 0, sprint: 0, drink: false, eat: false, confirm: false, call: null });
  if (cmd.call) pendingCall = cmd.call;
  if (cmd.respawn) pendingRespawn = true;
  while (acc >= TICK_DT) {
    prev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
    cmd.call = pendingCall;
    cmd.respawn = pendingRespawn;
    cmd.jump = pendingRespawn; // A / Space: hatch again while dead, tear the egg inside one, jump otherwise
    cmd.species = ui.selected;
    pendingCall = undefined;
    pendingRespawn = false;
    herbMeshes.beforeTick(world.herbivores);
    smallMeshes.beforeTick(world.smalls);
    sauroMeshes.beforeTick(world.sauros);
    const eggBefore = p.egg;
    step(world, cmd);
    if (p.egg < eggBefore) {
      // A press tore the shell: wobble, scraps, a tearing sound and a growing jolt; a bigger one as it bursts open.
      eggView.tear(p);
      audio.body('tear', { x: p.x, y: groundAt(p.x, p.z) + 0.3, z: p.z }, p.body.mass);
      const k = 1 - p.egg / 4;
      rumble.hit(0.3, 0.2 + 0.2 * k, p.egg ? 120 : 300, performance.now(), inputState.device === 'touch');
    }
    for (const ev of world.events) {
      audio.play(ev, tract());
      // Losing footing: a jolt for a stumble, a heavy one when the body hits the ground (demo startFall, thud).
      const touch = inputState.device === 'touch';
      if (ev.kind === 'skid' && ev.who === 'player' && p.fall) {
        const L = p.fall.level, mk = bodyScale(p).mk;
        rumble.hit(L === 'slip' ? 0.3 : 0.5, Math.min(1, (L === 'trip' ? 0.6 : L === 'slip' ? 0.15 : 0.5) * mk), L === 'trip' ? 260 : L === 'slip' ? 90 : 180, performance.now(), touch);
        if (L !== 'slip') fx.jolt = Math.max(fx.jolt, L === 'trip' ? 0.6 : 0.4 + 0.5 * Math.min(1, p.fall.sev - 0.5));
      }
      if (ev.kind === 'thud' && ev.who === 'player') {
        const mk = bodyScale(p).mk;
        rumble.hit(0.6, Math.min(1, 0.7 * mk), 240, performance.now(), touch);
        fx.jolt = Math.max(fx.jolt, 0.7 * mk);
      }
      if (ev.kind === 'scramble' && ev.who === 'player') rumble.hit(0.3, 0.35, 120, performance.now(), touch);
      if (ev.kind === 'bite' && ev.who === 'player') {
        fx.biteHit = false;
        if (ev.miss) ui.flash('Missed');
      }
      if (ev.kind === 'hit') {
        const yaw = ev.yaw ?? 0, share = ev.share ?? 0.3;
        if (ev.who === 'player') {
          fx.biteHit = !ev.blow; // the tearing head shake is for bites
          fx.hold = 0.06 + 0.06 * share;
          fx.heldBiteT = p.biteT;
          fx.jolt = Math.max(fx.jolt, 0.3 + 0.6 * share);
          ui.flash(ev.blow ? blowText(ev.blow, ev.left ?? 1) : woundText(ev.left ?? 1));
        }
        if (ev.target === world.players[0].entity) {
          const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw); // its right
          fx.hurtT = 0;
          fx.hurtSide = Math.sign(-Math.sin(yaw) * rx - Math.cos(yaw) * rz) || 1; // the side the bite came from
          fx.hurtK = Math.min(1, 0.4 + share * 4);
          if (ev.who === 'prey') ui.flash('It bit back');
        }
        const big = ev.who === 'player' ? 1 : 1.4;
        // A kick's claws can draw a little blood; a tail swipe is a blunt blow.
        if (ev.blow !== 'swipe') blood.spray(ev.x, ev.y, ev.z, yaw, ev.blow ? share * 0.4 : share, big * Math.max(0.3, Math.min(1.5, ev.who === 'player' ? p.body.size : 1)));
      }
      // Haptic jolts: your bite landing, and being bitten (harder, longer).
      if (ev.kind === 'hit' && ev.who === 'player') rumble.hit(0.45, 0.7, 90, performance.now(), inputState.device === 'touch');
      if (ev.kind === 'hit' && ev.who !== 'player' && Math.hypot(ev.x - p.x, ev.z - p.z) < 1.5) rumble.hit(0.7, 1, 180, performance.now(), inputState.device === 'touch');
    }
    cmd.respawn = cmd.jump = false; // a press acts once, not once per tick
    cmd.call = undefined;
    acc -= TICK_DT;
    if (world.player !== p) {
      // Hatched again: fresh body, camera behind it.
      p = world.player;
      useModel();
      herrera.plant(p.x, p.z, p.yaw, rigScale());
      prev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
      cam.snapBehind(p);
    }
  }
  stats?.simDone();
  const a = acc / TICK_DT;
  const x = lerp(prev.x, p.x, a), y = lerp(prev.y, p.y, a), z = lerp(prev.z, p.z, a);
  const yaw = prev.yaw + wrapAngle(p.yaw - prev.yaw) * a;

  // Snout target when eating: the top of the nearest carcass.
  let dipY: number | undefined;
  if (p.act === 'browse' || p.act === 'dig') dipY = groundAt(p.x, p.z) + 0.15 * p.body.hip;
  if (p.act === 'eat') {
    const c = world.carcasses.reduce((b, k) => (Math.hypot(k.x - p.x, k.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? k : b), world.carcasses[0]);
    if (c) dipY = groundAt(c.x, c.z) + 0.35 * Math.cbrt(c.meat0 / 140);
  }
  fx.hurtT += dt;
  const held = fx.hold > 0;
  fx.hold -= dt;
  herrera.update({ x, z, yaw, speed: p.speed, accel: p.accel, yawRate: p.yawRate, act: p.act, alive: p.alive,
    biteT: held ? fx.heldBiteT : p.biteT, sprinting: isSprinting(p, cmd), size: rigScale(), dipY,
    biteHit: fx.biteHit, hurtT: fx.hurtT, hurtSide: fx.hurtSide, hurtK: fx.hurtK, fall: p.fall, bodyK: bodyScale(p),
    air: Math.max(0, y - groundAt(x, z)), rest: p.rest, crouch: p.jump?.ph === 'crouch' ? Math.min(1, p.jump.t / p.jump.dur) : 0, swim: p.swim, under: p.under,
    strike: p.strike, holding: p.grip >= 0, grabber: p.species.attack === 'grab' }, held ? 0 : dt);
  blood.update(dt);
  coatView.update(p, herrera, dt);
  trailView.update(world.trails, world.tick * TICK_DT, p.alive && p.act === 'sniff', dt);
  view.setTime(dayTime(world.tick * TICK_DT));
  herbMeshes.update(world.herbivores, a, dt);
  eggView.update(p, dt);
  herrera.root.visible = p.egg === 0;
  cam.zoom = p.egg > 0 ? 1.8 : viewZoom;
  smallMeshes.update(world.smalls, world.grubs, world.tick * TICK_DT, a, dt);
  sauroMeshes.update(world.sauros, a, dt);
  carcassMeshes.sync(world.carcasses, groundAt, !p.alive && world.lastDeath ? world.lastDeath.carcassId : -1);
  // Saurosuchus bodies (head to tail) block the camera.
  const blockers = world.sauros.map((s) => {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), gy = groundAt(s.x, s.z) + 1.0;
    return { ax: s.x + fx * 3, ay: gy, az: s.z + fz * 3, bx: s.x - fx * 2.5, by: gy, bz: s.z - fz * 2.5, r: 1.3 };
  });
  fx.jolt = Math.max(0, fx.jolt - dt * 6);
  cam.update(inp, dt, { x, y, z, yaw, speed: p.speed }, p.body.hip / 1.15, Math.max(fx.jolt * 0.4, p.alive && p.hitT < 0.25 ? 1 - p.hitT / 0.25 : 0), blockers);
  // Ferns thin out between the camera and the player, and round a small player.
  fernCut.uCutA.value.copy(cam.camera.position);
  fernCut.uCutB.value.set(x, y + 0.6 * p.body.hip, z);
  fernCut.uCutR.value = Math.max(0.5, 0.6 * p.body.hip);
  fernCut.uCutDisc.value = Math.max(1, 1.5 * p.species.length * p.body.size);
  fernCut.uCutDiscK.value = p.alive ? 0.85 * (1 - smooth(0.5, 1, p.body.hip)) : 0;
  view.followSun(x, y, z);
  stats?.updateDone();
  view.render(dt);
  stats?.end(now, view.renderer);
  const near = nearby();
  const goal = live ? objectiveOf(world) : null;
  marker.update(goal?.at ?? null, goal?.at ? groundAt(goal.at.x, goal.at.z) : 0, goal?.at ? Math.hypot(goal.at.x - p.x, goal.at.z - p.z) : 0, dt);
  ui.update(world, near, cam.yaw, goal, dt);
  document.getElementById('coat')!.textContent = coatText(p);
  rumble.flush(now, dt, live && p.alive && inputState.device === 'pad');
  {
    const s0 = world.sauros[0];
    const snout = herrera.snout();
    audio.update(view.camera.position, cam.yaw, snout, s0 ? { x: s0.x, y: groundAt(s0.x, s0.z) + 1, z: s0.z } : null, tract());
  }
  // Autosave every 15 s of play, and whenever the page is hidden or closed (below).
  if (live && SAVING && (saveT += dt) > 15) {
    saveT = 0;
    writeSave(world);
  }
  requestAnimationFrame(frame);
}
// Test runs never write over the real save.
const SAVING = !(params.has('debug') || params.has('adult'));
let saveT = 0;
const saveNow = (): void => {
  if (started && SAVING) writeSave(world);
};
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveNow());
window.addEventListener('pagehide', saveNow);
// ?debug exposes the world and camera for automated checks (screenshots, headless playtests).
if (params.has('debug')) (window as unknown as { __up: unknown }).__up = { world, cam, groundAt, hatch: (id: SpeciesId) => hatchAs(world, id), zoom: (z: number) => (viewZoom = z), start: () => { started = true; ui.showIntro(false); } };
requestAnimationFrame(frame);

// Test hook for automated checks.
(window as unknown as { upstarts: unknown }).upstarts = { get world() { return world; }, cam, sauroMeshes, herbMeshes, smallMeshes, herrera, view, audio, fernCut,
  visible: () => visibleFraction(view.renderer, view.scene, view.camera, herrera.root) };
