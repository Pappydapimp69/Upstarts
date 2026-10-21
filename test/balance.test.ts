import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ, type World } from '../src/sim/world';
import { createDino } from '../src/sim/dino';
import { HERRERASAURUS } from '../src/sim/species';
import { ROCKS, tierOf } from '../src/sim/ground';
import { MUDS } from '../src/sim/terrain';
import { soak } from '../src/sim/coat';

const empty = (): World => {
  const w = createWorld(1, 1, 1);
  w.sauros = [];
  w.herbivores = [];
  w.smalls = [];
  return w;
};
// Sprint (or walk) straight over every step-up rock from several sides; count what happens.
function overRocks(stamina: number, sprint: number): Record<'slip' | 'stumble' | 'trip', number> {
  const out = { slip: 0, stumble: 0, trip: 0 }, w = empty();
  for (const k of ROCKS.filter((r) => tierOf(r.h, HERRERASAURUS.hip) === 1).slice(0, 24)) {
    for (const yaw of [0, 2.1, 4.2]) {
      const back = k.r + 10;
      w.player = createDino(HERRERASAURUS, k.x - Math.sin(yaw) * back, k.z - Math.cos(yaw) * back, yaw, 1);
      const seen = new Set<object>();
      for (let i = 0; i < 3.5 * TICK_HZ; i++) {
        if (stamina < 1) w.player.stamina = stamina;
        step(w, { moveX: Math.sin(yaw), moveZ: Math.cos(yaw), sprint });
        const f = w.player.fall;
        if (f && !seen.has(f)) {
          seen.add(f);
          out[f.level]++;
        }
      }
    }
  }
  return out;
}

describe('balance: slips, stumbles and trips (demo stability)', () => {
  it('sprinting fresh over rocks it sometimes slips or stumbles, but never goes down', () => {
    const r = overRocks(1, 1);
    expect(r.slip + r.stumble).toBeGreaterThan(3);
    expect(r.trip).toBe(0);
  });

  it('only a tired sprint can put it down; a walk never does', () => {
    expect(overRocks(1, 0).trip).toBe(0);
    const tired = overRocks(0.3, 1);
    expect(tired.slip + tired.stumble + tired.trip).toBeGreaterThan(overRocks(1, 1).slip);
  });

  it('dry open ground holds even turning at a sprint; muddy feet do not', () => {
    const turns = (muddy: boolean): number => {
      const w = empty();
      let n = 0;
      for (let r = 0; r < 4; r++) {
        w.player = createDino(HERRERASAURUS, -40, -10 + r, Math.PI / 2, 1);
        const seen = new Set<object>();
        for (let i = 0; i < 6 * TICK_HZ; i++) {
          if (muddy) soak(w.player.coat, w.player.body.hip, 0.3, true);
          step(w, { moveX: Math.sin(i / TICK_HZ * 2), moveZ: Math.cos(i / TICK_HZ * 2), sprint: 1 });
          if (w.player.fall && !seen.has(w.player.fall)) {
            seen.add(w.player.fall);
            n++;
          }
        }
      }
      return n;
    };
    expect(turns(false)).toBeLessThanOrEqual(1);
    expect(turns(true)).toBeGreaterThan(4);
    expect(MUDS.length).toBe(1);
  });

  it('a trip: it goes down, cannot move, thuds and growls, then gets back up', () => {
    const w = empty();
    const d = createDino(HERRERASAURUS, -40, -10, 0, 1);
    w.player = d;
    d.speed = 6;
    d.fall = { level: 'trip', kind: 'trip', down: true, t: 0, dur: 1, side: 1, sev: 1, tT: 0.45, tL: 1, tR: 1.1, thud: false };
    const x = d.x, z = d.z;
    let thud = false, growl = false;
    for (let i = 0; i < 1.2 * TICK_HZ; i++) {
      step(w, { moveX: 0, moveZ: 1, sprint: 1 });
      if (w.events.some((e) => e.kind === 'thud')) thud = true;
      if (w.events.some((e) => e.kind === 'call' && e.call === 'growl' && e.who === 'player')) growl = true;
    }
    expect(thud).toBe(true);
    expect(growl).toBe(true);
    const moved = Math.hypot(d.x - x, d.z - z);
    expect(moved).toBeLessThan(2.5); // it slid to a stop, not ran on
    for (let i = 0; i < 2 * TICK_HZ; i++) step(w, { moveX: 0, moveZ: 1, sprint: 0 });
    expect(d.fall).toBeNull();
    for (let i = 0; i < 1 * TICK_HZ; i++) step(w, { moveX: 0, moveZ: 1, sprint: 0 });
    expect(d.speed).toBeGreaterThan(1);
  });
});
