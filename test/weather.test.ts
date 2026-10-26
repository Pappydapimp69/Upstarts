import { describe, expect, it } from 'vitest';
import { createWorld, setConditions, step, TICK_DT } from '../src/sim/world';
import { AIR, dryness, isDrySeason, SEASON, setAir, stepWeather, firstWeather, WEATHER } from '../src/sim/weather';
import { PONDS, WATER, waterDepthAt } from '../src/sim/terrain';
import { plume } from '../src/sim/scent';
import { rng } from '../src/sim/rng';

describe('seasons', () => {
  it('starts wet, dries out and the ponds shrink, then fills again', () => {
    expect(dryness(0)).toBe(0);
    expect(isDrySeason(SEASON.length * 1.2)).toBe(true);
    const w = createWorld(1);
    const edge = { x: PONDS[0].x + PONDS[0].r * 0.8, z: PONDS[0].z };
    expect(waterDepthAt(edge.x, edge.z)).toBeGreaterThan(0);
    w.tick = Math.round(SEASON.length / TICK_DT);
    setConditions(w);
    expect(WATER.level).toBeCloseTo(-SEASON.dryDrop);
    expect(waterDepthAt(edge.x, edge.z)).toBe(0);
    w.tick = Math.round((2 * SEASON.length) / TICK_DT);
    setConditions(w);
    expect(WATER.level).toBeCloseTo(0);
  });
});

describe('weather', () => {
  it('rain washes scent out and fog cuts sight', () => {
    const wx = firstWeather();
    setAir(wx, 0);
    const dry = plume(0, 0, 1, 8, 6);
    Object.assign(wx, { sky: 'rain', prev: 'rain', since: 0 });
    setAir(wx, 100);
    expect(plume(0, 0, 1, 8, 6)).toBeCloseTo(dry * WEATHER.scent.rain);
    Object.assign(wx, { sky: 'fog', prev: 'fog' });
    setAir(wx, 100);
    expect(AIR.sight).toBe(WEATHER.sight.fog);
    setAir(firstWeather(), 0);
  });

  it('changes in spells from its own stream, and replays', () => {
    const a = firstWeather(), b = firstWeather(), ra = rng(4), rb = rng(4);
    const seen = new Set<string>();
    for (let t = 0; t < 40 * 3600; t += 30) {
      stepWeather(a, t, ra);
      stepWeather(b, t, rb);
      seen.add(a.sky);
    }
    expect(a).toEqual(b);
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('the world steps its weather', () => {
    const w = createWorld(3);
    for (let i = 0; i < 30; i++) step(w, { moveX: 0, moveZ: 0, sprint: 0 });
    expect(w.weather.until).toBeGreaterThan(0);
  });
});
