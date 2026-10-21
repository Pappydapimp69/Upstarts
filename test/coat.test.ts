import { describe, expect, it } from 'vitest';
import { COAT, mudFeet, newCoat, stepCoat, wetFeet } from '../src/sim/coat';
import { createDino, stepDino } from '../src/sim/dino';
import { HERRERASAURUS } from '../src/sim/species';
import { MUDS } from '../src/sim/terrain';
import { TICK_DT, TICK_HZ } from '../src/sim/world';

const tick = (c = newCoat(), s: number, wd: number, md: number, walking = true, rest = 0, hip = 1.15) => {
  for (let i = 0; i < s * TICK_HZ; i++) stepCoat(c, hip, wd, md, rest, walking, TICK_DT);
  return c;
};

describe('coat: wet and mud (demo skin state)', () => {
  it('wading wets the legs only, and they dry in about 8 s', () => {
    const c = tick(undefined, 1, 0.4, 0);
    expect(wetFeet(c)).toBe(1);
    expect(c.wet[20]).toBe(0); // high up the body stays dry
    tick(c, 4, 0, 0);
    expect(wetFeet(c)).toBeGreaterThan(0.3);
    tick(c, 4.5, 0, 0);
    expect(wetFeet(c)).toBe(0);
  });

  it('mud crusts after 8 s, flakes off after 30 s of walking, and water washes it off', () => {
    const c = tick(undefined, 1, 0, 0.5);
    expect(mudFeet(c)).toBe(1);
    tick(c, COAT.crust + 0.5, 0, 0, false);
    expect(c.dry[0]).toBe(1);
    tick(c, 20, 0, 0, false); // standing still, it stays
    expect(mudFeet(c)).toBe(1);
    tick(c, COAT.walkOff + COAT.flake + 1, 0, 0, true);
    expect(c.mud[0]).toBe(0);
    const d = tick(undefined, 1, 0, 0.5);
    tick(d, 2, 0.5, 0);
    expect(d.mud[0]).toBe(0);
  });

  it('lying down in it coats the flanks; a hatchling is muddy higher up its body in the same pit', () => {
    const stand = tick(undefined, 1, 0, 0.3), lie = tick(undefined, 1, 0, 0.3, false, 1);
    const top = (c: ReturnType<typeof newCoat>): number => {
      let t = -1;
      c.mud.forEach((v, i) => { if (v > 0) t = i; });
      return t;
    };
    expect(top(lie)).toBeGreaterThan(top(stand));
    expect(top(tick(undefined, 1, 0, 0.3, true, 0, 0.3))).toBeGreaterThan(top(stand));
  });

  it('walking through the mud pit cakes the legs', () => {
    const m = MUDS[0], d = createDino(HERRERASAURUS, m.x, m.z - m.r - 4, 0);
    for (let i = 0; i < 4 * TICK_HZ; i++) stepDino(d, { moveX: 0, moveZ: 1, sprint: 0 }, TICK_DT);
    expect(mudFeet(d.coat)).toBeGreaterThan(0.9);
  });
});
