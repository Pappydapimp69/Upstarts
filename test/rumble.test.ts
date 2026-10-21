import { describe, expect, it } from 'vitest';
import { feltRange, footfallRumble } from '../src/render/rumbleMath';

const total = (r: { strong: number; weak: number }): number => r.strong + r.weak;

describe('footfall rumble', () => {
  it('heavier animals hit harder', () => {
    const hatch = footfallRumble({ mass: 4, speed: 2, dist: 5, pan: 0 });
    const adult = footfallRumble({ mass: 350, speed: 2, dist: 5, pan: 0 });
    const sauro = footfallRumble({ mass: 650, speed: 2, dist: 5, pan: 0 });
    expect(total(adult)).toBeGreaterThan(total(hatch));
    expect(total(sauro)).toBeGreaterThan(total(adult));
    expect(sauro.strong / sauro.weak).toBeGreaterThan(hatch.strong / hatch.weak); // heavier = more low thud
  });

  it('faster steps hit harder', () => {
    const walk = footfallRumble({ mass: 350, speed: 1.5, dist: 0, pan: 0 });
    const sprint = footfallRumble({ mass: 350, speed: 7.4, dist: 0, pan: 0 });
    expect(total(sprint)).toBeGreaterThan(total(walk) * 1.5);
  });

  it('fades with distance and is gone past three felt ranges', () => {
    const near = footfallRumble({ mass: 650, speed: 3, dist: 5, pan: 0 });
    const far = footfallRumble({ mass: 650, speed: 3, dist: 30, pan: 0 });
    expect(total(far)).toBeLessThan(total(near));
    expect(total(footfallRumble({ mass: 650, speed: 3, dist: feltRange(650) * 3.1, pan: 0 }))).toBe(0);
  });

  it('follows the direction of the source', () => {
    const left = footfallRumble({ mass: 650, speed: 3, dist: 6, pan: -1 });
    const right = footfallRumble({ mass: 650, speed: 3, dist: 6, pan: 1 });
    expect(left.left).toBeGreaterThan(0);
    expect(left.right).toBe(0);
    expect(right.right).toBeGreaterThan(0);
    expect(right.left).toBe(0);
    expect(left.strong).toBeGreaterThan(right.strong); // left body motor leans left
    expect(right.weak).toBeGreaterThan(left.weak);
  });

  it('a stalking predator is felt less', () => {
    const open = footfallRumble({ mass: 650, speed: 0.7, dist: 8, pan: 0 });
    const stalk = footfallRumble({ mass: 650, speed: 0.7, dist: 8, pan: 0, quiet: 0.3 });
    expect(total(stalk)).toBeLessThan(total(open) * 0.5);
  });
});
