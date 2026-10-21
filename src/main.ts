import { createWorld, step, TICK_DT } from './sim/world';
import { SceneView } from './render/scene';

const world = createWorld();
const view = new SceneView(document.body);

// Fixed-step sim, free-running render.
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc += Math.min((now - last) / 1000, 0.25);
  last = now;
  while (acc >= TICK_DT) {
    step(world);
    acc -= TICK_DT;
  }
  view.render(world, acc / TICK_DT);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
