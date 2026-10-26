import { describe, expect, it } from 'vitest';
import { concealment, coverAt, SHRUBS } from '../src/sim/cover';
import { browseAt } from '../src/sim/flora';
import { createSauro, sensesQuarry } from '../src/sim/saurosuchus';
import { senses } from '../src/sim/herbivore';
import { createWorld } from '../src/sim/world';

// A spot in thick fern cover, and one in the open.
const find = (want: (x: number, z: number) => boolean): [number, number] => {
  for (let r = 6; r < 70; r += 0.7) for (let a = 0; a < 6.28; a += 0.21) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (want(x, z)) return [x, z];
  }
  throw new Error('no spot');
};
const thick = find((x, z) => browseAt(x, z) > 0.95);
const open = find((x, z) => coverAt(x, z).density === 0);

describe('cover: the plants hide what is in them', () => {
  it('the shrubs and cycads are in the sim, and their cover is thick at the middle', () => {
    expect(SHRUBS.filter((s) => s.kind === 'shrub').length).toBeGreaterThan(100);
    expect(SHRUBS.filter((s) => s.kind === 'cycad').length).toBeGreaterThan(40);
    const s = SHRUBS[0];
    expect(coverAt(s.x, s.z).density).toBeGreaterThan(0.9);
  });

  it('a hatchling in ferns is hidden; an adult Herrerasaurus stands out unless it lies down; moving gives it away', () => {
    const [x, z] = thick;
    expect(concealment(x, z, 0.2, 0, 0)).toBeGreaterThan(0.9);
    expect(concealment(x, z, 1.05, 0, 0)).toBeLessThan(0.5);
    expect(concealment(x, z, 1.05, 1, 0)).toBeGreaterThan(0.9);
    expect(concealment(x, z, 0.2, 0, 4)).toBeLessThan(0.5);
    expect(concealment(...open, 0.2, 0, 0)).toBe(0);
  });

  it('Saurosuchus cannot see a hidden animal across open ground at a range it would see it in the open', () => {
    const s = createSauro(1, 0, 0);
    s.yaw = 0;
    const q = { id: 2, x: 0, z: 30, speed: 0, topSpeed: 5, mass: 80 };
    // Due north of it, downwind (the wind blows toward the south-east), so only sight can decide.
    const seen = (hidden: number): boolean => sensesQuarry(s, { ...q, hidden }, []);
    expect(seen(0)).toBe(true);
    expect(seen(0.95)).toBe(false);
  });

  it('herds do not spot a player hidden in the plants', () => {
    const w = createWorld(2, 1, 1);
    const h = w.herbivores[0];
    const pred = { id: 0, x: h.x + 12, z: h.z, speed: 0.5, alive: true, mass: 270, stealth: 1, hunts: true };
    expect(senses(h, pred)).toBe(true);
    expect(senses(h, { ...pred, stealth: 1 - 0.8 * 0.95 })).toBe(false);
  });
});
