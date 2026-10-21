import { createWorld, hatchAs, step, TICK_DT, CARCASS } from './sim/world';
import { browseAt } from './sim/flora';
import { lerp, smooth, wrapAngle } from './sim/math';
import { heightAt, waterDepthAt } from './sim/terrain';
import { SceneView } from './render/scene';
import { HerreraAnimator } from './render/dlist/animator.js';
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

// ?fast runs hunger, thirst and growth 20x faster, to try the loop quickly. ?adult starts fully grown.
const params = new URLSearchParams(location.search);
const world = createWorld((Math.random() * 2 ** 31) | 0, params.has('fast') ? 20 : 1, params.has('adult') ? 1 : 0, undefined, !params.has('adult'));
const ui = new Ui();
if (ui.selected !== world.speciesId) hatchAs(world, ui.selected);
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

let p = world.player;
// The Dlist demo's Herrerasaurus model, reshaped per species. One model, re-planted for each new
// hatchling and rebuilt when the species changes.
let herrera = new HerreraAnimator(p.species.id);
view.scene.add(herrera.root);
const rigScale = (): number => p.body.hip / herrera.rigHip;
herrera.plant(p.x, p.z, p.yaw, rigScale());
function useModel(): void {
  if (herrera.speciesId === p.species.id) return;
  const onStep = herrera.onStep, onSound = herrera.onSound;
  view.scene.remove(herrera.root);
  herrera = new HerreraAnimator(p.species.id);
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
const surfaceAt = (x: number, z: number): Surface => (waterDepthAt(x, z) > 0.02 ? 'water' : 'packedDirt');
const tract = (): number => tractOf(p.body.size) * (p.species.length / 5.2);

// Footsteps rumble the controller by weight, speed and direction (relative to the camera).
const rumble = new FootfallRumble();
const panOf = (x: number, z: number): number => {
  const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1;
  return (dx * Math.cos(cam.yaw) - dz * Math.sin(cam.yaw)) / d; // camera right is (cos yaw, -sin yaw)
};
herrera.onStep = (foot: { x: number; y: number; z: number }) => {
  rumble.own(p.body.mass, p.speed, p.body.sprintMax, performance.now(), inputState.device === 'touch');
  // Your own small feet are close-miked: a hatchling's steps are physically almost silent. Only the mix.
  audio.step('player', foot, p.body.mass, p.speed, surfaceAt(foot.x, foot.z), clamp((350 / p.body.mass) ** 0.3, 1, 3.5));
};
herrera.onSound = (kind: 'lap' | 'drip' | 'gulp' | 'sniff' | 'tear' | 'thud', at: { x: number; y: number; z: number }) => audio.body(kind, at, p.body.mass);
const feel = (who: 'prey' | 'saurosuchus', mass: number) => (x: number, z: number, speed: number, quiet: number): void => {
  rumble.step(mass, speed, Math.hypot(x - p.x, z - p.z), panOf(x, z), quiet, performance.now(), inputState.device === 'touch');
  audio.step(who, { x, y: heightAt(x, z), z }, mass * quiet * quiet, speed, surfaceAt(x, z));
};
herbMeshes.onStep = feel('prey', HYPERODAPEDON.mass);
sauroMeshes.onStep = feel('saurosuchus', SAUROSUCHUS.mass);
ui.setRumble(rumble.enabled);
ui.onRumbleButton(() => ui.setRumble(rumble.toggle()));
// The game waits on the splash until the player hatches; the menu button pauses it.
let started = false, paused = false;
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
  setRoarLabel(CALLS[roarStyle(p.stamina, p.needs.thirst, p.needs.hunger)].label);
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
      audio.body('tear', { x: p.x, y: heightAt(p.x, p.z) + 0.3, z: p.z }, p.body.mass);
      const k = 1 - p.egg / 4;
      rumble.hit(0.3, 0.2 + 0.2 * k, p.egg ? 120 : 300, performance.now(), inputState.device === 'touch');
    }
    for (const ev of world.events) {
      audio.play(ev, tract());
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
  const a = acc / TICK_DT;
  const x = lerp(prev.x, p.x, a), y = lerp(prev.y, p.y, a), z = lerp(prev.z, p.z, a);
  const yaw = prev.yaw + wrapAngle(p.yaw - prev.yaw) * a;

  // Snout target when eating: the top of the nearest carcass.
  let dipY: number | undefined;
  if (p.act === 'browse' || p.act === 'dig') dipY = heightAt(p.x, p.z) + 0.15 * p.body.hip;
  if (p.act === 'eat') {
    const c = world.carcasses.reduce((b, k) => (Math.hypot(k.x - p.x, k.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? k : b), world.carcasses[0]);
    if (c) dipY = heightAt(c.x, c.z) + 0.35 * Math.cbrt(c.meat0 / 140);
  }
  herrera.update({ x, z, yaw, speed: p.speed, accel: p.accel, yawRate: p.yawRate, act: p.act, alive: p.alive,
    biteT: p.biteT, sprinting: isSprinting(p, cmd), size: rigScale(), dipY,
    air: Math.max(0, y - heightAt(x, z)), rest: p.rest, crouch: p.jump?.ph === 'crouch' ? Math.min(1, p.jump.t / p.jump.dur) : 0 }, dt);
  view.setTime(dayTime(world.tick * TICK_DT));
  herbMeshes.update(world.herbivores, a, dt);
  eggView.update(p, dt);
  herrera.root.visible = p.egg === 0;
  cam.zoom = p.egg > 0 ? 1.8 : 1;
  smallMeshes.update(world.smalls, world.grubs, world.tick * TICK_DT, a, dt);
  sauroMeshes.update(world.sauros, a, dt);
  carcassMeshes.sync(world.carcasses, heightAt, !p.alive && world.lastDeath ? world.lastDeath.carcassId : -1);
  // Saurosuchus bodies (head to tail) block the camera.
  const blockers = world.sauros.map((s) => {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), gy = heightAt(s.x, s.z) + 1.0;
    return { ax: s.x + fx * 3, ay: gy, az: s.z + fz * 3, bx: s.x - fx * 2.5, by: gy, bz: s.z - fz * 2.5, r: 1.3 };
  });
  cam.update(inp, dt, { x, y, z, yaw, speed: p.speed }, p.body.hip / 1.15, p.alive && p.hitT < 0.25 ? 1 - p.hitT / 0.25 : 0, blockers);
  // Ferns thin out between the camera and the player, and round a small player.
  fernCut.uCutA.value.copy(cam.camera.position);
  fernCut.uCutB.value.set(x, y + 0.6 * p.body.hip, z);
  fernCut.uCutR.value = Math.max(0.5, 0.6 * p.body.hip);
  fernCut.uCutDisc.value = Math.max(1, 1.5 * p.species.length * p.body.size);
  fernCut.uCutDiscK.value = p.alive ? 0.85 * (1 - smooth(0.5, 1, p.body.hip)) : 0;
  view.followSun(x, y, z);
  view.render(dt);
  const near = nearby();
  ui.update(world, near, cam.yaw);
  rumble.flush(now, dt, live && p.alive && inputState.device === 'pad');
  {
    const s0 = world.sauros[0];
    const snout = herrera.snout();
    audio.update(view.camera.position, cam.yaw, snout, s0 ? { x: s0.x, y: heightAt(s0.x, s0.z) + 1, z: s0.z } : null, tract());
  }
  requestAnimationFrame(frame);
}
// ?debug exposes the world and camera for automated checks (screenshots, headless playtests).
if (params.has('debug')) (window as unknown as { __up: unknown }).__up = { world, cam, start: () => { started = true; ui.showIntro(false); } };
requestAnimationFrame(frame);

// Test hook for automated checks.
(window as unknown as { upstarts: unknown }).upstarts = { get world() { return world; }, cam, sauroMeshes, herbMeshes, smallMeshes, herrera, view, audio, fernCut,
  visible: () => visibleFraction(view.renderer, view.scene, view.camera, herrera.root) };
