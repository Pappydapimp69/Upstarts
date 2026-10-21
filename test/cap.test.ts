import { describe, expect, it } from 'vitest';
import { biteCap, bitesToKill } from '../src/sim/combat';
import { bodyOf } from '../src/sim/growth';
import { SAUROSUCHUS } from '../src/sim/saurosuchus';
import { HYPERODAPEDON } from '../src/sim/herbivore';
import { HERRERASAURUS, SPECIES, SPECIES_ORDER } from '../src/sim/species';

const sauroBites = (mass: number): number => bitesToKill(SAUROSUCHUS.mass, mass, SAUROSUCHUS.biteMult);

describe('ratio-gated bite cap', () => {
  it('is 40% up to a 3x mass ratio and 100% from 8x', () => {
    expect(biteCap(300, 100)).toBeCloseTo(0.4);
    expect(biteCap(800, 100)).toBeCloseTo(1);
    expect(biteCap(500, 100)).toBeGreaterThan(0.4);
    expect(biteCap(500, 100)).toBeLessThan(1);
  });

  it('Saurosuchus (245 kg): adult Herrerasaurus 4 bites, three-quarter grown 3, juvenile 1', () => {
    expect(sauroBites(HERRERASAURUS.mass)).toBe(4);
    expect(sauroBites(bodyOf(HERRERASAURUS, 0.85).mass)).toBe(3); // just grown up
    expect(sauroBites(96)).toBe(3);
    expect(sauroBites(25)).toBe(1); // massively outclassed
  });

  it('Saurosuchus on Hyperodapedon 3, adult Herrerasaurus on Hyperodapedon 3 (both about 3x its mass)', () => {
    expect(sauroBites(HYPERODAPEDON.mass)).toBe(3);
    expect(bitesToKill(HERRERASAURUS.mass, HYPERODAPEDON.mass)).toBe(3);
  });

  it('nothing dies in one bite from an animal less than 3x its mass', () => {
    for (const a of SPECIES_ORDER) {
      for (const d of SPECIES_ORDER) {
        for (const g of [0, 0.4, 0.7, 1]) {
          const am = SPECIES[a].mass, dm = bodyOf(SPECIES[d], g).mass;
          if (am / dm <= 3) expect(bitesToKill(am, dm, SPECIES[a].biteMult)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});
