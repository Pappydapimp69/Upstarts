import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ, type World } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { HERRERASAURUS } from '../src/sim/species';
import { PONDS, waterDepthAt } from '../src/sim/terrain';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };
const runFor = (w: World, cmd: Command, s: number): void => {
  for (let i = 0; i < s * TICK_HZ; i++) step(w, cmd);
};
const pond = PONDS[0];

// Stand the player on the shore, facing away from the water.
function onShore(w: World, facingWater: boolean): void {
  const x = pond.x, z = pond.z + pond.r + 1.2;
  w.player = createDino(HERRERASAURUS, x, z, facingWater ? Math.PI : 0);
}

describe('needs', () => {
  it('thirst drains faster than hunger', () => {
    const w = createWorld(1);
    runFor(w, idle, 60);
    expect(1 - w.player.needs.thirst).toBeGreaterThan(1 - w.player.needs.hunger);
  });

  it('dies of thirst, leaves a carcass on respawn, and keeps nothing but the count', () => {
    const w = createWorld(1, 50);
    w.carcasses = [];
    let t = 0;
    while (w.player.alive && t++ < 60 * 60 * TICK_HZ) step(w, idle);
    expect(w.player.alive).toBe(false);
    expect(w.lastDeath?.cause).toBe('thirst');
    const body = { x: w.player.x, z: w.player.z };
    step(w, { ...idle, respawn: true });
    expect(w.player.alive).toBe(true);
    expect(w.player.needs).toEqual({ hunger: 1, thirst: 1, health: 1 });
    expect(w.lives).toBe(2);
    expect(w.carcasses.some((c) => Math.hypot(c.x - body.x, c.z - body.z) < 0.01 && c.meat > 100)).toBe(true);
  });
});

describe('drinking', () => {
  it('turns round to water behind it, then drinks thirst back up', () => {
    const w = createWorld(1, 20);
    onShore(w, false);
    w.player.needs.thirst = 0.3;
    const acts = new Set<string>();
    for (let i = 0; i < 10 * TICK_HZ; i++) {
      step(w, { ...idle, drink: true });
      acts.add(w.player.act);
    }
    expect(acts.has('turn')).toBe(true);
    expect(acts.has('drink')).toBe(true);
    expect(w.player.needs.thirst).toBeGreaterThan(0.9);
  });

  it('sniffs instead of drinking away from water', () => {
    const w = createWorld(1);
    w.player = createDino(HERRERASAURUS, -20, 20, 0);
    w.player.needs.thirst = 0.5;
    runFor(w, { ...idle, drink: true }, 3);
    expect(w.player.act).toBe('sniff');
    expect(w.player.needs.thirst).toBeLessThan(0.5);
  });

  it('will not wade in over its depth', () => {
    const w = createWorld(1);
    onShore(w, true);
    let deepest = 0;
    for (let i = 0; i < 15 * TICK_HZ; i++) {
      step(w, { moveX: 0, moveZ: -1, sprint: 0 });
      deepest = Math.max(deepest, waterDepthAt(w.player.x, w.player.z));
    }
    expect(deepest).toBeLessThanOrEqual(1.12);
  });
});

describe('eating', () => {
  it('eats a carcass: meat goes down, hunger goes up, then it rots away', () => {
    const w = createWorld(1);
    w.player = createDino(HERRERASAURUS, -20, 20, 0);
    w.player.needs.hunger = 0.2;
    w.carcasses = [{ id: 99, x: -20, z: 22.5, yaw: 0, meat: 30, meat0: 30 }];
    runFor(w, { ...idle, eat: true }, 12);
    expect(w.player.needs.hunger).toBeGreaterThan(0.9);
    const c = w.carcasses.find((k) => k.id === 99)!;
    expect(c.meat).toBeLessThan(30 - 15);
    runFor(w, idle, 60 * 10);
    expect(w.carcasses.some((k) => k.id === 99)).toBe(false);
  });
});

describe('determinism with survival', () => {
  it('two worlds with the same seed and commands match tick for tick', () => {
    const a = createWorld(7, 30), b = createWorld(7, 30);
    const script = (t: number): Command => ({
      moveX: Math.sin(t * 0.01), moveZ: Math.cos(t * 0.013), sprint: t % 300 > 200 ? 1 : 0,
      drink: t % 500 > 450, eat: t % 700 > 620, respawn: t % 97 === 0,
    });
    for (let t = 0; t < 9000; t++) {
      step(a, script(t));
      step(b, script(t));
      expect([b.player.x, b.player.z, b.player.needs.thirst, b.carcasses.length, b.lives])
        .toEqual([a.player.x, a.player.z, a.player.needs.thirst, a.carcasses.length, a.lives]);
    }
  });
});
