import { describe, expect, it } from 'vitest';
import { createDino, stepDino, type Command, type Dino } from '../src/sim/dino';
import { HERRERASAURUS } from '../src/sim/species';
import { groundAt, mudDepthAt, ROCKS, surfaceAt, tierOf } from '../src/sim/ground';
import { MUDS } from '../src/sim/terrain';
import { TICK_DT, TICK_HZ } from '../src/sim/world';

const run = (d: Dino, s: number, cmd: Command | ((d: Dino) => Command)): void => {
  for (let i = 0; i < s * TICK_HZ; i++) stepDino(d, typeof cmd === 'function' ? cmd(d) : cmd, TICK_DT);
};
// Walk from `back` m behind a rock's centre straight at it.
const toward = (rx: number, rz: number, back: number, growth = 1): Dino => {
  const yaw = 0.7, d = createDino(HERRERASAURUS, rx - Math.sin(yaw) * back, rz - Math.cos(yaw) * back, yaw, growth);
  return d;
};
const go = (d: Dino): Command => ({ moveX: Math.sin(d.yaw), moveZ: Math.cos(d.yaw), sprint: 0 });

describe('ground: rocks and logs are footing', () => {
  it('has pebbles, step-ups and walls for an adult; a hatchling meets walls where an adult sees steps', () => {
    const tiers = [0, 0, 0];
    for (const k of ROCKS) tiers[tierOf(k.h, HERRERASAURUS.hip)]++;
    expect(tiers[1]).toBeGreaterThan(10);
    expect(tiers[2]).toBeGreaterThan(4);
    const slab = ROCKS[1];
    expect(tierOf(slab.h, HERRERASAURUS.hip)).toBe(1);
    expect(tierOf(slab.h, 0.25)).toBe(2);
  });

  it('an adult walks up onto a low slab', () => {
    const k = ROCKS[1], d = toward(k.x, k.z, 4);
    let top = 0;
    run(d, 3, (dd) => {
      top = Math.max(top, dd.y - groundAt(k.x + 3, k.z + 3));
      return Math.hypot(dd.x - k.x, dd.z - k.z) > 0.5 ? { moveX: k.x - dd.x, moveZ: k.z - dd.z, sprint: 0 } : { moveX: 0, moveZ: 0, sprint: 0 };
    });
    expect(Math.hypot(d.x - k.x, d.z - k.z)).toBeLessThan(0.8);
    expect(d.y).toBeGreaterThan(k.ground + 0.6 * k.h);
  });

  it('a boulder is a wall: it does not walk through or up it', () => {
    const k = ROCKS.find((r) => !r.log && r.h > 1.3)!;
    const d = toward(k.x, k.z, k.r + 3);
    run(d, 4, (dd) => ({ moveX: k.x - dd.x, moveZ: k.z - dd.z, sprint: 0 }));
    expect(d.y).toBeLessThan(k.ground + 0.7);
    expect(Math.hypot(d.x - k.x, d.z - k.z)).toBeGreaterThan(0.6);
  });

  it('jumps up onto the 0.85 m ledge, and steps off it with a drop', () => {
    const k = ROCKS[6];
    expect(k.h).toBeCloseTo(0.85, 1);
    const d = toward(k.x, k.z, k.r + 1.2);
    run(d, 0.5, { moveX: 0, moveZ: 0, sprint: 0 });
    stepDino(d, { ...go(d), jump: true }, TICK_DT);
    run(d, 2, (dd) => (Math.hypot(dd.x - k.x, dd.z - k.z) > 0.4 ? { moveX: k.x - dd.x, moveZ: k.z - dd.z, sprint: 0 } : { moveX: 0, moveZ: 0, sprint: 0 }));
    expect(d.y).toBeGreaterThan(k.ground + 0.7);
    // Let go at the edge, it stops there; push on and it drops off.
    const yaw = d.yaw;
    run(d, 2, { moveX: Math.sin(yaw), moveZ: Math.cos(yaw), sprint: 0 });
    expect(d.y).toBeLessThan(k.ground + 0.3);
  });

  it('mud slows it, water and mud are surfaces, rocks are dry footing', () => {
    const m = MUDS[0];
    expect(mudDepthAt(m.x, m.z)).toBeGreaterThan(0.5);
    expect(surfaceAt(m.x, m.z)).toBe('mud');
    expect(surfaceAt(ROCKS[0].x, ROCKS[0].z)).toBe('rock');
    const speed = (x: number, z: number): number => {
      const d = createDino(HERRERASAURUS, x, z, 0);
      run(d, 1.5, { moveX: 0, moveZ: 1, sprint: 0 });
      return d.speed;
    };
    expect(speed(m.x, m.z - 2)).toBeLessThan(0.75 * speed(-30, 30));
  });
});
