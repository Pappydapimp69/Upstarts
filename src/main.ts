import { createWorld, step, TICK_DT } from './sim/world';
import { lerp, wrapAngle } from './sim/math';
import { SceneView } from './render/scene';
import { DinoMesh } from './render/dinoMesh';
import { FollowCamera } from './render/camera';
import { initInput, readInput } from './input/input';

const world = createWorld();
const view = new SceneView(document.body);
const p = world.player;
const dinoMesh = new DinoMesh(p.species);
view.scene.add(dinoMesh.root);
const cam = new FollowCamera(view.camera, p.yaw, p.x, p.y, p.z);
initInput(view.renderer.domElement);

const hud = document.getElementById('hud')!;

// Fixed-step sim, free-running render, interpolated between the last two ticks.
let prev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += dt;
  const inp = readInput();
  const cmd = cam.command(inp);
  while (acc >= TICK_DT) {
    prev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
    step(world, cmd);
    acc -= TICK_DT;
  }
  const a = acc / TICK_DT;
  const x = lerp(prev.x, p.x, a), y = lerp(prev.y, p.y, a), z = lerp(prev.z, p.z, a);
  const yaw = prev.yaw + wrapAngle(p.yaw - prev.yaw) * a;

  dinoMesh.update(x, y, z, yaw, p.speed, p.accel, p.grade, dt);
  cam.update(inp, dt, { x, y, z, yaw, speed: p.speed });
  view.followSun(x, y, z);
  view.render();
  hud.textContent = `${p.speed.toFixed(1)} m/s · stamina ${Math.round(p.stamina * 100)}%`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for automated checks.
(window as unknown as { upstarts: unknown }).upstarts = { world };
