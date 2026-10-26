import { describe, expect, it } from 'vitest';
import { CLOCK } from '../src/sim/clock';
import { dryness, SEASON, seasonName } from '../src/sim/season';
import { createWorld, step, TICK_HZ } from '../src/sim/world';
import { PONDS, waterDepthAt } from '../src/sim/terrain';

const cycle = CLOCK.cycle * SEASON.days;
// World time at a point in the cycle of seasons (0 wet, 0.5 the height of the dry).
const at = (u: number): number => u * cycle - CLOCK.start;

describe('seasons', () => {
  it('a cycle runs wet, dry, wet over two days', () => {
    expect(dryness(at(0))).toBeCloseTo(0, 5);
    expect(dryness(at(0.5))).toBeCloseTo(1, 5);
    expect(dryness(at(1))).toBeCloseTo(0, 5);
    expect(seasonName(at(0))).toBe('wet season');
    expect(seasonName(at(0.5))).toBe('dry season');
    expect(seasonName(at(0.3))).toBe('drying out');
  });

  it('in the dry the pond shrinks: its shallows are dry ground', () => {
    const P = PONDS[0];
    const season = (u: number): void => {
      const w = createWorld(1);
      w.tick = Math.round(at(u) * TICK_HZ);
      step(w, { moveX: 0, moveZ: 0, sprint: 0 });
    };
    // In the wet, the shallows: a strip of the shore about 0.3 m deep.
    season(0);
    let r = 0;
    while (waterDepthAt(P.x + r, P.z) > 0.3) r += 0.05;
    const shore = { x: P.x + r, z: P.z };
    const wet = waterDepthAt(shore.x, shore.z);
    season(0.5);
    const dry = waterDepthAt(shore.x, shore.z);
    expect(wet).toBeGreaterThan(0.25);
    expect(dry).toBe(0);
    expect(waterDepthAt(P.x, P.z)).toBeGreaterThan(0.5); // the middle still holds water
  });
});
