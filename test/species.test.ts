import { describe, expect, it } from 'vitest';
import { CARCASS, createWorld, step, TICK_HZ } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { EODROMAEUS, HERRERASAURUS, PANPHAGIA, SANJUANSAURUS, SPECIES, SPECIES_ORDER } from '../src/sim/species';
import { maxHp } from '../src/sim/combat';
import { browseAt } from '../src/sim/flora';
import { needPace } from '../src/sim/needs';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

// A spot thick with ferns, away from water.
function fernSpot(): [number, number] {
  for (let x = -60; x < 60; x += 1.5) for (let z = -60; z < 60; z += 1.5) if (browseAt(x, z) > 0.8 && Math.hypot(x, z) < 40) return [x, z];
  throw new Error('no ferns');
}

describe('species', () => {
  it('four playable species, ordered by size', () => {
    expect(SPECIES_ORDER).toHaveLength(4);
    expect(new Set(SPECIES_ORDER.map((id) => SPECIES[id].name)).size).toBe(4);
    expect(maxHp(HERRERASAURUS.mass)).toBeGreaterThan(maxHp(SANJUANSAURUS.mass));
    expect(maxHp(SANJUANSAURUS.mass)).toBeGreaterThan(maxHp(PANPHAGIA.mass));
  });

  it('Herrerasaurus is the fastest outright; Eodromaeus is no faster for its size than Panphagia', () => {
    const rel = (s: typeof EODROMAEUS): number => s.sprintMax / Math.sqrt(s.hip);
    expect(rel(EODROMAEUS)).toBeLessThanOrEqual(rel(PANPHAGIA));
    expect(EODROMAEUS.sprintMax).toBeLessThan(4); // m/s: was 5.2, felt far too fast
    expect(HERRERASAURUS.sprintMax).toBeGreaterThan(SANJUANSAURUS.sprintMax);
  });

  it('small species get hungry faster (mass^0.324)', () => {
    expect(needPace(EODROMAEUS.mass)).toBeGreaterThan(3.5);
    expect(needPace(HERRERASAURUS.mass)).toBe(1);
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
    w.carcasses = [{ id: 99, x: -20, z: 20.6, yaw: 0, meat: 30, meat0: 30, food: 'meat' }];
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
