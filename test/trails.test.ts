import { describe, expect, it } from 'vitest';
import { layTrails, newTrails, readTrail, TRAIL } from '../src/sim/trails';
import { createWorld, step, TICK_DT, TICK_HZ } from '../src/sim/world';
import { createSauro, sensesQuarry, stepSauro } from '../src/sim/saurosuchus';
import { WIND } from '../src/sim/scent';

const walker = (x: number, z: number, bleeding = false) => [{ id: 7, x, z, what: 'Hyperodapedon' as const, scent: true, bleeding }];

describe('trails', () => {
  it('a moving animal lays scent every 1.6 m; standing still it lays none', () => {
    const tr = newTrails();
    for (let i = 0; i <= 300; i++) layTrails(tr, i * TICK_DT, TICK_DT, walker(i * 0.05, 0)); // 15 m at 1.5 m/s
    expect(tr.marks.length).toBe(Math.floor(15 / TRAIL.scentEvery));
    const n = tr.marks.length;
    for (let i = 0; i < 300; i++) layTrails(tr, 10 + i * TICK_DT, TICK_DT, walker(15, 0));
    expect(tr.marks.length).toBe(n);
  });

  it('a bleeding animal that stops still leaves blood where it stands (time-gated, not travel-gated)', () => {
    const tr = newTrails();
    for (let i = 0; i < 5 * TICK_HZ; i++) layTrails(tr, i * TICK_DT, TICK_DT, walker(0, 0, true));
    const blood = tr.marks.filter((m) => m.kind === 'blood');
    expect(blood.length).toBeGreaterThanOrEqual(9);
    expect(blood.every((m) => Math.hypot(m.x, m.z) < 0.3)).toBe(true);
  });

  it('the nose tells what laid it, how fresh it is and which way it went; marks fade', () => {
    const tr = newTrails();
    for (let i = 0; i <= 200; i++) layTrails(tr, i * TICK_DT, TICK_DT, walker(0, i * 0.05, true)); // heading +z
    const r = readTrail(tr, 7, 0, 5)!;
    expect(r.kind).toBe('blood'); // blood beats scent
    expect(r.what).toBe('Hyperodapedon');
    expect(Math.abs(r.yaw!)).toBeLessThan(0.3); // went +z
    expect(r.strength).toBeGreaterThan(0.9);
    expect(readTrail(tr, 7, 30, 30)).toBeNull(); // nothing out here
    // Long after, it's gone.
    layTrails(tr, 7 + TRAIL.bloodLife + 1, TICK_DT, []);
    expect(tr.marks.length).toBe(0);
  });

  it('in the game: a bitten Hyperodapedon leaves a blood trail you can sniff out and follow', () => {
    const w = createWorld(2, 1, 1);
    w.sauros = [];
    const h = w.herbivores[0];
    h.bleeding = 20;
    for (let i = 0; i < 6 * TICK_HZ; i++) step(w, { moveX: 0, moveZ: 0, sprint: 0 });
    const blood = w.trails.marks.filter((m) => m.kind === 'blood' && m.who === h.id);
    expect(blood.length).toBeGreaterThan(8);
    // Stand on its trail and sniff.
    const p = w.player, m = blood[Math.floor(blood.length / 2)];
    p.x = m.x - Math.sin(p.yaw) * p.body.snout;
    p.z = m.z - Math.cos(p.yaw) * p.body.snout;
    step(w, { moveX: 0, moveZ: 0, sprint: 0, drink: true });
    expect(p.act).toBe('sniff');
    expect(p.trail?.kind).toBe('blood');
    expect(p.trail?.what).toBe('Hyperodapedon');
  });

  it('Saurosuchus smells a bleeding animal from much further downwind', () => {
    const s = createSauro(1, 0, 0);
    s.yaw = Math.atan2(WIND.x, WIND.z); // facing away: it can't see it
    // Upwind of it, at a distance a clean animal isn't smelled from.
    let d = 10;
    const q = (bleeding: boolean) => ({ id: 2, x: -WIND.x * d, z: -WIND.z * d, speed: 0, topSpeed: 5, mass: 80, bleeding });
    while (sensesQuarry(s, q(false))) d += 2;
    expect(sensesQuarry(s, q(true))).toBe(true);
  });
});

describe('Saurosuchus on a blood trail', () => {
  it('a hungry one that crosses fresh blood follows it toward the newer drops', () => {
    const run = (withTrail: boolean): { z: number; tracking: boolean } => {
      const s = createSauro(1, -38, -34);
      s.yaw = 0;
      const blood = { kind: 'blood' as const, what: 'Hyperodapedon' as const, who: 5, age: 10, strength: 0.9, yaw: 0 };
      for (let i = 0; i < 12 * TICK_HZ; i++) {
        stepSauro(s, { now: i * TICK_DT, rand: () => 0.5, quarry: [], carcasses: [], bite: () => {}, eat: () => 0,
          // A trail running north along x = -38.
          trail: withTrail ? (x) => (Math.abs(x + 38) < 2 ? blood : null) : undefined }, TICK_DT);
      }
      return { z: s.z, tracking: s.tracking };
    };
    const on = run(true), off = run(false);
    expect(on.z).toBeGreaterThan(-34 + 10);
    expect(on.tracking).toBe(true);
    expect(off.tracking).toBe(false);
  });
});
