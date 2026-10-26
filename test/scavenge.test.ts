import { describe, expect, it } from 'vitest';
import { BODY_R, createWorld, step, TICK_HZ } from '../src/sim/world';
import { createDino } from '../src/sim/dino';
import { PANPHAGIA } from '../src/sim/species';
import { SCAVENGE } from '../src/sim/smallprey';

const idle = { moveX: 0, moveZ: 0, sprint: 0 };

describe('scavengers at a kill', () => {
  it('small cynodonts come out to a carcass near their burrows and eat it, unless something guards it', () => {
    const run = (guard: boolean): number => {
      const w = createWorld(6, 1, 1);
      w.sauros = [];
      w.herbivores = [];
      const cyn = w.smalls.filter((m) => m.kind === 'cynodont');
      const home = cyn[0];
      w.carcasses = [{ id: 999, x: home.homeX + 5, z: home.homeZ, yaw: 0, meat: 40, meat0: 40 }];
      // Unguarded: the player is far away; guarding: it stands right over the carcass.
      const p = w.player;
      [p.x, p.z] = guard ? [home.homeX + 5.8, home.homeZ] : [home.homeX + 60, home.homeZ + 40];
      for (let i = 0; i < 60 * TICK_HZ; i++) step(w, idle);
      return 40 - (w.carcasses[0]?.meat ?? 0) - 60 * 3 / 60; // eaten, beyond what rotted
    };
    const open = run(false), guarded = run(true);
    expect(open).toBeGreaterThan(SCAVENGE.rate * 20); // at least one nibbling for 20 s of the minute
    expect(guarded).toBeLessThan(open * 0.3);
  });
});

describe('bodies', () => {
  it("you can't walk through a Hyperodapedon, and a herd doesn't stand inside itself", () => {
    const w = createWorld(2, 1, 1);
    w.sauros = [];
    const h = w.herbivores[0];
    w.herbivores = [h];
    Object.assign(h, { x: -40, z: -7, state: 'sleep', speed: 0 }); // asleep: it stays put
    w.player = createDino(PANPHAGIA, -40, -10, 0, 1);
    let closest = 9;
    for (let i = 0; i < 4 * TICK_HZ; i++) {
      step(w, { moveX: 0, moveZ: 1, sprint: 0 });
      closest = Math.min(closest, Math.hypot(w.player.x - h.x, w.player.z - h.z));
    }
    expect(closest).toBeGreaterThan(BODY_R.herb + BODY_R.player * PANPHAGIA.length - 0.05);
    const herd = createWorld(3, 1, 1);
    herd.sauros = [];
    for (let i = 0; i < 20 * TICK_HZ; i++) step(herd, idle);
    const hs = herd.herbivores;
    let overlaps = 0;
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) if (Math.hypot(hs[i].x - hs[j].x, hs[i].z - hs[j].z) < 2 * BODY_R.herb - 0.05) overlaps++;
    expect(overlaps).toBe(0);
  });
});
