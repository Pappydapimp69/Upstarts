import { describe, expect, it } from 'vitest';
import { CARCASS, createWorld, step, TICK_HZ } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { AETOSAUROIDES, EODROMAEUS, hatchFraction, HERRERASAURUS, PANPHAGIA, PROTEROCHAMPSA, SANJUANSAURUS, SPECIES, SPECIES_ORDER } from '../src/sim/species';
import { bodyOf } from '../src/sim/growth';
import { browseAt } from '../src/sim/flora';
import { ectoGap, needPace } from '../src/sim/needs';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

// A spot thick with ferns, away from water.
function fernSpot(): [number, number] {
  for (let x = -60; x < 60; x += 1.5) for (let z = -60; z < 60; z += 1.5) if (browseAt(x, z) > 0.8 && Math.hypot(x, z) < 40) return [x, z];
  throw new Error('no ferns');
}

describe('species', () => {
  it('five playable species with distinct roles; Sanjuansaurus parked', () => {
    expect(SPECIES_ORDER).toEqual(['herrerasaurus', 'eodromaeus', 'panphagia', 'proterochampsa', 'aetosauroides']);
    expect(SPECIES_ORDER.includes('sanjuansaurus')).toBe(false);
    const plans = SPECIES_ORDER.map((id) => SPECIES[id].plan), diets = new Set(SPECIES_ORDER.map((id) => SPECIES[id].diet));
    expect(plans.filter((p) => p === 'quad')).toHaveLength(2);
    expect(diets.size).toBe(3);
    expect(SPECIES_ORDER.filter((id) => SPECIES[id].swim > 0)).toEqual(['proterochampsa']);
  });

  it('measured masses and sizes (Brain dlist/E90-E97; the research notes in species.ts)', () => {
    expect(HERRERASAURUS.mass).toBe(270);
    expect(EODROMAEUS.mass).toBe(5);
    expect(PANPHAGIA.mass).toBe(12);
    expect(SANJUANSAURUS.mass).toBe(133);
    // Hatchlings from egg mass: a 270 kg Herrerasaurus hatches at about 0.36 kg (hatchSize about 0.11).
    expect(HERRERASAURUS.hatchSize).toBeCloseTo(0.11, 2);
    expect(bodyOf(HERRERASAURUS, 0).mass).toBeCloseTo(0.36, 1);
    expect(EODROMAEUS.hatchSize).toBeCloseTo(0.275, 2);
    expect(PANPHAGIA.hatchSize).toBeCloseTo(0.225, 2);
    expect(hatchFraction(5)).toBeGreaterThan(hatchFraction(270)); // small species hatch relatively bigger
  });

  it('Herrerasaurus is the fastest; the four-legged reptiles are slow on land', () => {
    for (const id of SPECIES_ORDER) if (id !== 'herrerasaurus') expect(SPECIES[id].sprintMax).toBeLessThan(HERRERASAURUS.sprintMax);
    expect(EODROMAEUS.sprintMax).toBeLessThan(4.1); // m/s: was 5.2, felt far too fast
    expect(PROTEROCHAMPSA.sprintMax).toBeLessThan(2.5);
    expect(AETOSAUROIDES.sprintMax).toBeLessThan(2.5);
    expect(PROTEROCHAMPSA.swim).toBeGreaterThan(PROTEROCHAMPSA.walk);
  });

  it('small species get hungry faster (mass^0.324); cold-blooded ones need several times less', () => {
    expect(needPace(EODROMAEUS.mass)).toBeGreaterThan(3.5);
    expect(needPace(350)).toBe(1);
    expect(ectoGap(5)).toBeCloseTo(7.1, 1);
    expect(ectoGap(200)).toBeGreaterThan(2.8);
    expect(ectoGap(200)).toBeLessThan(3.4);
  });

  it('Panphagia browses ferns back to full; a carnivore can\'t', () => {
    const [x, z] = fernSpot();
    for (const [sp, expectFed] of [[PANPHAGIA, true], [EODROMAEUS, false]] as const) {
      const w = createWorld(1, 1, 1, sp.id);
      w.sauros = [];
      w.carcasses = [];
      w.herbivores = [];
      w.player = createDino(sp, x, z, 0, 1);
      w.player.needs.hunger = 0.3;
      for (let i = 0; i < 30 * TICK_HZ; i++) step(w, { ...idle, eat: true });
      expect(w.player.needs.hunger > 0.9).toBe(expectFed);
      expect(w.player.act).toBe(expectFed ? 'browse' : 'none');
    }
  });

  it('a small animal fills up on a small amount of meat', () => {
    const w = createWorld(1, 1, 1, 'eodromaeus');
    w.sauros = [];
    w.herbivores = [];
    w.player = createDino(EODROMAEUS, -20, 20, 0, 1);
    w.player.needs.hunger = 0;
    w.carcasses = [{ id: 99, x: -20, z: 20.6, yaw: 0, meat: 30, meat0: 30 }];
    for (let i = 0; i < 20 * TICK_HZ; i++) step(w, { ...idle, eat: true });
    expect(w.player.needs.hunger).toBeGreaterThan(0.95);
    const eaten = 30 - w.carcasses[0].meat - CARCASS.rot * 20; // what it ate, minus 20 s of rot
    expect(eaten).toBeLessThan(1); // an adult Eodromaeus's stomach holds well under a kilo
    expect(eaten).toBeGreaterThan(0.2);
  });

  it('respawns as the chosen species', () => {
    const w = createWorld(1, 50, 0, 'herrerasaurus');
    w.sauros = [];
    w.player.needs.thirst = 0;
    w.player.needs.health = 0.01;
    for (let i = 0; i < 2 * TICK_HZ && w.player.alive; i++) step(w, idle);
    expect(w.player.alive).toBe(false);
    step(w, { ...idle, respawn: true, species: 'panphagia' });
    expect(w.player.species.id).toBe('panphagia');
    expect(w.player.growth).toBe(0);
  });
});
