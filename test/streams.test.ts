import { describe, expect, it } from 'vitest';
import { createWorld, step } from '../src/sim/world';
import type { Command } from '../src/sim/dino';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

describe('named RNG streams', () => {
  it('an extra roll on one stream leaves other systems untouched', () => {
    const a = createWorld(21, 1, 1), b = createWorld(21, 1, 1);
    for (const w of [a, b]) w.sauros = [];
    for (let k = 0; k < 5; k++) b.rng.carcass(); // B's carcass system draws more
    for (let t = 0; t < 900; t++) {
      step(a, idle);
      step(b, idle);
    }
    const herd = (w: typeof a): number[][] => w.herbivores.map((h) => [h.x, h.z, h.yaw]);
    expect(herd(b)).toEqual(herd(a)); // herds and their AI didn't notice
  });

  it('each stream is still deterministic per seed', () => {
    const a = createWorld(5), b = createWorld(5);
    expect([a.rng.spawn(), a.rng.herd(), a.rng.carcass(), a.rng.ai()]).toEqual([b.rng.spawn(), b.rng.herd(), b.rng.carcass(), b.rng.ai()]);
  });
});
