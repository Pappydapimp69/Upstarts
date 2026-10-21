import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ, type World } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { HERRERASAURUS } from '../src/sim/species';
import { HYPERODAPEDON, senses, type Herbivore } from '../src/sim/herbivore';
import { plume, WIND } from '../src/sim/scent';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

// One herd of 7 grazing in the open, the player placed relative to its centre.
function oneHerd(px: number, pz: number): World {
  const w = createWorld(3);
  w.herbivores = w.herbivores.filter((h) => h.herd === 0);
  w.herbivores.forEach((h, i) => {
    h.x = -20 + (i % 3) * 3;
    h.z = 20 + Math.floor(i / 3) * 3;
    h.state = 'graze';
  });
  w.herds[0].goalX = -20;
  w.herds[0].goalZ = 22;
  w.carcasses = [];
  w.player = createDino(HERRERASAURUS, px, pz, 0);
  return w;
}
const fleeing = (w: World): number => w.herbivores.filter((h) => h.state === 'flee').length;
const herbAt = (x: number, z: number, yaw = 0): Herbivore => ({
  id: 1, herd: 0, x, z, yaw, speed: 0, health: 1, stamina: 1, state: 'graze', stateT: 0,
  threatX: 0, threatZ: 0, alarmAt: -99, bleeding: 0, aim: 0,
});

describe('scent', () => {
  it('carries downwind, not upwind', () => {
    expect(plume(0, 0, 1, WIND.x * 30, WIND.z * 30)).toBeGreaterThan(0.2);
    expect(plume(0, 0, 1, -WIND.x * 30, -WIND.z * 30)).toBe(0);
  });
});

describe('herbivore senses', () => {
  const still = { x: 0, z: 0, speed: 0, noise: 0, alive: true };
  it('smells a still predator upwind of it, but not one downwind', () => {
    // Upwind predator, prey 30 m downwind and facing away.
    expect(senses(herbAt(WIND.x * 30, WIND.z * 30, Math.atan2(WIND.x, WIND.z)), still)).toBe(true);
    expect(senses(herbAt(-WIND.x * 30, -WIND.z * 30, Math.atan2(-WIND.x, -WIND.z)), still)).toBe(false);
  });
  it('hears a sprinting predator behind it', () => {
    const run = { x: 0, z: 0, speed: 7, noise: 3 + 7 * 3, alive: true };
    // Crosswind so smell can't help, facing away so sight can't.
    const h = herbAt(WIND.z * 20, -WIND.x * 20, Math.atan2(WIND.z, -WIND.x));
    expect(senses(h, run)).toBe(true);
    expect(senses(h, { ...run, speed: 0, noise: 0 })).toBe(false);
  });
});

describe('herds', () => {
  it('graze calmly with nobody around', () => {
    const w = oneHerd(60, -60);
    for (let i = 0; i < 20 * TICK_HZ; i++) step(w, idle);
    expect(fleeing(w)).toBe(0);
  });

  it('a sprinting predator charging in sets the whole herd fleeing', () => {
    const w = oneHerd(-20, -25); // 45 m south of the herd
    let peak = 0;
    for (let i = 0; i < 10 * TICK_HZ; i++) {
      step(w, { moveX: 0, moveZ: 1, sprint: 1 });
      peak = Math.max(peak, fleeing(w));
    }
    expect(peak).toBe(w.herbivores.length);
  });

  it('one alarmed member does not stampede the herd (quorum of two)', () => {
    const w = oneHerd(60, -60);
    const lone = w.herbivores[0];
    lone.state = 'flee';
    lone.threatX = lone.x + 5;
    lone.threatZ = lone.z;
    lone.alarmAt = w.tick / TICK_HZ;
    let peak = 0;
    for (let i = 0; i < 3 * TICK_HZ; i++) {
      step(w, idle);
      peak = Math.max(peak, fleeing(w));
    }
    expect(peak).toBe(1);
  });

  it('calm down after the threat is gone', () => {
    const w = oneHerd(-20, -25);
    for (let i = 0; i < 4 * TICK_HZ; i++) step(w, { moveX: 0, moveZ: 1, sprint: 1 });
    expect(fleeing(w)).toBeGreaterThan(0);
    w.player.alive = false;
    for (let i = 0; i < 30 * TICK_HZ; i++) step(w, idle);
    expect(fleeing(w)).toBe(0);
  });
});

describe('hunting', () => {
  it('three bites kill a Hyperodapedon and leave a carcass', () => {
    const w = oneHerd(60, -60);
    w.herbivores = [w.herbivores[0]];
    const h = w.herbivores[0];
    h.x = 0;
    h.z = 2.2;
    h.yaw = 0;
    w.player = createDino(HERRERASAURUS, 0, 0, 0);
    // Pin it in place so the test is about the bite, not the chase.
    let bites = 0, lastHealth = 1;
    for (let i = 0; i < 4 * TICK_HZ && w.herbivores.length; i++) {
      w.herbivores[0].x = 0;
      w.herbivores[0].z = 2.2;
      step(w, { ...idle, eat: true });
      const hh = w.herbivores[0];
      if (hh && hh.health < lastHealth) {
        bites++;
        lastHealth = hh.health;
      }
    }
    expect(w.herbivores.length).toBe(0);
    expect(bites).toBe(2); // the third, killing bite removes it
    expect(w.carcasses.some((c) => Math.abs(c.meat - HYPERODAPEDON.meat) < 1)).toBe(true);
  });

  it('a bitten animal bleeds, and the blood can be smelled downwind', () => {
    const w = oneHerd(60, -60);
    const h = w.herbivores[0];
    h.bleeding = 20;
    w.player = createDino(HERRERASAURUS, h.x + WIND.x * 15, h.z + WIND.z * 15, 0);
    step(w, { ...idle, drink: true });
    expect(w.player.act).toBe('sniff');
    expect(w.player.sniff).not.toBeNull();
  });

  it('a sprinting Herrerasaurus can run one down', () => {
    const w = oneHerd(-20, -20);
    let caught = false;
    for (let i = 0; i < 40 * TICK_HZ && !caught; i++) {
      const p = w.player;
      // Chase the nearest live one.
      let best = w.herbivores[0], bd = Infinity;
      for (const h of w.herbivores) {
        const d = Math.hypot(h.x - p.x, h.z - p.z);
        if (d < bd) {
          bd = d;
          best = h;
        }
      }
      const n = w.herbivores.length;
      step(w, { moveX: best.x - p.x, moveZ: best.z - p.z, sprint: 1, eat: bd < 4 });
      if (w.herbivores.length < n) caught = true;
    }
    expect(caught).toBe(true);
  });
});

describe('determinism with herds', () => {
  it('two worlds with the same seed and commands match tick for tick', () => {
    const a = createWorld(11), b = createWorld(11);
    const script = (t: number): Command => ({ moveX: Math.sin(t * 0.004), moveZ: Math.cos(t * 0.004), sprint: t % 400 > 250 ? 1 : 0, eat: t % 50 < 10 });
    for (let t = 0; t < 6000; t++) {
      step(a, script(t));
      step(b, script(t));
      const fa = a.herbivores.map((h) => [h.x, h.z, h.state]);
      const fb = b.herbivores.map((h) => [h.x, h.z, h.state]);
      expect(fb).toEqual(fa);
    }
  });
});
