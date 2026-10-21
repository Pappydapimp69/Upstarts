import { createWorld, step, TICK_DT, CARCASS } from './sim/world';
import { lerp, wrapAngle } from './sim/math';
import { heightAt, waterDepthAt } from './sim/terrain';
import { SceneView } from './render/scene';
import { DinoMesh } from './render/dinoMesh';
import { FollowCamera } from './render/camera';
import { buildWater, CarcassMeshes } from './render/worldMeshes';
import { Hud } from './render/hud';
import { HerbivoreMeshes } from './render/herbivoreMesh';
import { SauroMeshes } from './render/sauroMesh';
import { initInput, readInput } from './input/input';

// ?fast runs hunger, thirst and growth 20x faster, to try the loop quickly. ?adult starts fully grown.
const params = new URLSearchParams(location.search);
const world = createWorld((Math.random() * 2 ** 31) | 0, params.has('fast') ? 20 : 1, params.has('adult') ? 1 : 0);
const view = new SceneView(document.body);
view.scene.add(buildWater());
const carcassMeshes = new CarcassMeshes();
view.scene.add(carcassMeshes.group);
const herbMeshes = new HerbivoreMeshes();
view.scene.add(herbMeshes.group);
const sauroMeshes = new SauroMeshes();
view.scene.add(sauroMeshes.group);

let p = world.player;
let dinoMesh = new DinoMesh(p.species);
view.scene.add(dinoMesh.root);
const cam = new FollowCamera(view.camera, p.yaw, p.x, p.y, p.z);
initInput(view.renderer.domElement);
const hud = new Hud(document.body);

// Fixed-step sim, free-running render, interpolated between the last two ticks.
let prev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
let last = performance.now();
let acc = 0;

function nearby(): { water: boolean; food: boolean; prey: boolean } {
  const r = p.body.reach;
  let water = false;
  for (let i = 0; i < 12 && !water; i++) {
    const a = (i / 12) * Math.PI * 2;
    water = waterDepthAt(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r) > 0.05;
  }
  const food = world.carcasses.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < r + CARCASS.radius);
  const inFront = (x: number, z: number, rad: number): boolean => Math.hypot(x - p.x, z - p.z) < p.body.snout + 0.6 + rad
    && Math.abs(wrapAngle(Math.atan2(x - p.x, z - p.z) - p.yaw)) < 0.7;
  const prey = world.herbivores.some((h) => inFront(h.x, h.z, 0.8)) || world.sauros.some((s) => inFront(s.x, s.z, 1.4));
  return { water, food, prey };
}

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += dt;
  const inp = readInput();
  const cmd = cam.command(inp);
  while (acc >= TICK_DT) {
    prev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
    herbMeshes.beforeTick(world.herbivores);
    sauroMeshes.beforeTick(world.sauros);
    step(world, cmd);
    cmd.respawn = false; // a press acts once, not once per tick
    acc -= TICK_DT;
    if (world.player !== p) {
      // Hatched again: fresh body, camera behind it.
      p = world.player;
      view.scene.remove(dinoMesh.root);
      dinoMesh = new DinoMesh(p.species);
      view.scene.add(dinoMesh.root);
      prev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
      cam.snapBehind(p);
    }
  }
  const a = acc / TICK_DT;
  const x = lerp(prev.x, p.x, a), y = lerp(prev.y, p.y, a), z = lerp(prev.z, p.z, a);
  const yaw = prev.yaw + wrapAngle(p.yaw - prev.yaw) * a;

  const feeding = p.act === 'drink' || p.act === 'eat';
  dinoMesh.update(x, y, z, yaw, p.speed, p.accel, p.grade, dt, feeding, p.alive, p.biteT, p.act === 'sniff', p.body.size);
  herbMeshes.update(world.herbivores, a, dt);
  sauroMeshes.update(world.sauros, a, dt);
  carcassMeshes.sync(world.carcasses, heightAt);
  // Saurosuchus bodies (head to tail) block the camera.
  const blockers = world.sauros.map((s) => {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), gy = heightAt(s.x, s.z) + 1.0;
    return { ax: s.x + fx * 3, ay: gy, az: s.z + fz * 3, bx: s.x - fx * 2.5, by: gy, bz: s.z - fz * 2.5, r: 1.3 };
  });
  cam.update(inp, dt, { x, y, z, yaw, speed: p.speed }, p.body.size, p.alive && p.hitT < 0.25 ? 1 - p.hitT / 0.25 : 0, blockers);
  view.followSun(x, y, z);
  view.render();
  const near = nearby();
  hud.update(world, near.water, near.food, near.prey, cam.yaw);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for automated checks.
(window as unknown as { upstarts: unknown }).upstarts = { get world() { return world; } };
