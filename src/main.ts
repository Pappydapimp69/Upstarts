import { createWorld, step, TICK_DT, CARCASS } from './sim/world';
import { lerp, wrapAngle } from './sim/math';
import { heightAt, waterDepthAt } from './sim/terrain';
import { SceneView } from './render/scene';
import { DinoMesh } from './render/dinoMesh';
import { FollowCamera } from './render/camera';
import { buildWater, CarcassMeshes } from './render/worldMeshes';
import { Hud } from './render/hud';
import { initInput, readInput } from './input/input';

// ?fast makes hunger and thirst drain 20x faster, to try the death loop quickly.
const fast = new URLSearchParams(location.search).has('fast');
const world = createWorld((Math.random() * 2 ** 31) | 0, fast ? 20 : 1);
const view = new SceneView(document.body);
view.scene.add(buildWater());
const carcassMeshes = new CarcassMeshes();
view.scene.add(carcassMeshes.group);

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

function nearby(): { water: boolean; food: boolean } {
  const r = p.species.reach;
  let water = false;
  for (let i = 0; i < 12 && !water; i++) {
    const a = (i / 12) * Math.PI * 2;
    water = waterDepthAt(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r) > 0.05;
  }
  const food = world.carcasses.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < r + CARCASS.radius);
  return { water, food };
}

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += dt;
  const inp = readInput();
  const cmd = cam.command(inp);
  while (acc >= TICK_DT) {
    prev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
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
  dinoMesh.update(x, y, z, yaw, p.speed, p.accel, p.grade, dt, feeding, p.alive);
  carcassMeshes.sync(world.carcasses, heightAt);
  cam.update(inp, dt, { x, y, z, yaw, speed: p.speed });
  view.followSun(x, y, z);
  view.render();
  const near = nearby();
  hud.update(world, near.water, near.food);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for automated checks.
(window as unknown as { upstarts: unknown }).upstarts = { get world() { return world; } };
