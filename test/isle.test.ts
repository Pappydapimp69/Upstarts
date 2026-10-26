import { describe, expect, it } from 'vitest';
import { createWorld, nestBlock, nestFor, step, TICK_HZ, type World } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { HERRERASAURUS, PANPHAGIA } from '../src/sim/species';
import { createSauro } from '../src/sim/saurosuchus';
import { balance, DIET, dietGrowth } from '../src/sim/diet';
import { breakChance, INJURY } from '../src/sim/injury';
import { NEST } from '../src/sim/nest';
import { biteDamage } from '../src/sim/combat';
import { SAUROSUCHUS } from '../src/sim/saurosuchus';
import { bodyOf } from '../src/sim/growth';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };
const secs = (w: World, s: number, cmd: Command | ((w: World) => Command) = idle): void => {
  for (let i = 0; i < s * TICK_HZ; i++) step(w, typeof cmd === 'function' ? cmd(w) : cmd);
};
const quiet = (seed = 5, growth = 1): World => {
  const w = createWorld(seed, 1, growth);
  w.sauros = [];
  w.herbivores = [];
  w.smalls = [];
  w.carcasses = [];
  w.player = createDino(HERRERASAURUS, -10, 20, 0, growth);
  return w;
};

describe('injuries', () => {
  it('a Saurosuchus bite opens a wound that bleeds, drops blood and clots', () => {
    const w = quiet();
    const s = createSauro(500, -10, 22.5);
    s.yaw = Math.PI;
    s.state = 'charge';
    s.target = 0;
    s.homeX = -10;
    s.homeZ = 20;
    w.sauros = [s];
    for (let i = 0; i < 5 * TICK_HZ && w.player.bleed === 0; i++) step(w, idle);
    expect(w.player.bleed).toBeGreaterThan(0.5);
    w.sauros = [];
    const h0 = w.player.needs.health;
    secs(w, 10, { moveX: 0, moveZ: 0.3, sprint: 0 });
    expect(w.player.needs.health).toBeLessThan(h0);
    expect(w.blood.length).toBeGreaterThan(0);
    secs(w, 60);
    expect(w.player.bleed).toBe(0);
  });

  it('bleeds out on its own when the wound is bad and health is low', () => {
    const w = quiet();
    w.player.bleed = 1;
    w.player.needs.health = 0.05;
    secs(w, 30);
    expect(w.player.alive).toBe(false);
    expect(w.lastDeath?.cause).toBe('bleeding');
  });

  it('a broken leg stops sprinting and jumping and mends while fed', () => {
    const w = quiet();
    w.player.broken = 1;
    secs(w, 4, (ww) => {
      ww.player.needs.hunger = ww.player.needs.thirst = 1;
      return { moveX: 0, moveZ: 1, sprint: 1, jump: true };
    });
    expect(w.player.speed).toBeLessThan(HERRERASAURUS.walk * INJURY.lame + 0.01);
    expect(w.player.jump).toBeNull();
    secs(w, INJURY.mend + 1, (ww) => {
      ww.player.needs.hunger = ww.player.needs.thirst = 1;
      return idle;
    });
    expect(w.player.broken).toBe(0);
  });

  it('only a big bite can break a leg', () => {
    expect(breakChance(0.2)).toBe(0);
    expect(breakChance(biteDamage(SAUROSUCHUS.mass, 350, SAUROSUCHUS.biteMult, 1))).toBeLessThan(1);
    expect(breakChance(biteDamage(SAUROSUCHUS.mass, bodyOf(HERRERASAURUS, 0.3).mass))).toBe(1);
  });

  it('bleeding stops growth', () => {
    const w = quiet(5, 0.1);
    w.player.bleed = 1;
    const g = w.player.growth;
    secs(w, 5);
    expect(w.player.growth).toBe(g);
  });
});

describe('nests', () => {
  it('an adult lays a clutch, and the next life hatches there a generation on', () => {
    const w = quiet();
    expect(nestBlock(w, w.players[0])).toBeNull();
    secs(w, NEST.build + 0.5, { ...idle, nest: true });
    expect(w.nests.length).toBe(1);
    const n = w.nests[0];
    expect(n.eggs).toBe(NEST.clutch.herrerasaurus);
    expect(w.player.needs.hunger).toBeLessThan(0.7);
    expect(nestBlock(w, w.players[0])).not.toBeNull(); // one clutch at a time
    w.player.alive = false;
    step(w, { ...idle, respawn: true, species: 'herrerasaurus' });
    expect(w.player.alive).toBe(true);
    expect(Math.hypot(w.player.x - n.x, w.player.z - n.z)).toBeLessThan(0.01);
    expect(w.player.generation).toBe(2);
    expect(n.eggs).toBe(NEST.clutch.herrerasaurus - 1);
    expect(nestFor(w, 0, 'panphagia')).toBeNull(); // another species starts fresh
  });

  it('a hatchling can not nest', () => {
    const w = quiet(5, 0);
    expect(nestBlock(w, w.players[0])).toBe('too young');
  });

  it('unguarded eggs get taken one at a time', () => {
    const w = quiet();
    secs(w, NEST.build + 0.5, { ...idle, nest: true });
    const eggs = w.nests[0].eggs;
    w.player.x += 40;
    secs(w, NEST.raidEvery + 1);
    expect(w.nests[0].eggs).toBe(eggs - 1);
  });
});

describe('diet', () => {
  it('nutrients drain, and a poor diet slows growth', () => {
    const w = createWorld(5, 50, 0.2);
    w.sauros = [];
    secs(w, 60, (ww) => {
      ww.player.needs.hunger = ww.player.needs.thirst = 1;
      return idle;
    });
    expect(balance(w.player.nutrients, 'carnivore')).toBeLessThan(0.5);
    expect(w.player.nutrients.carb).toBe(1); // a carnivore doesn't track carbs
    expect(dietGrowth(0)).toBeLessThan(0.5);
    expect(dietGrowth(1)).toBe(1);
  });

  it('fat prey refills lipids better than a lean carcass', () => {
    const fill = (food: 'lean' | 'fatty'): number => {
      const w = quiet();
      w.player.needs.hunger = 0.2;
      w.player.nutrients.lipid = 0.2;
      w.carcasses = [{ id: 99, x: -10, z: 22, yaw: 0, meat: 60, meat0: 60, food }];
      secs(w, 15, { ...idle, eat: true });
      return w.player.nutrients.lipid;
    };
    expect(fill('fatty')).toBeGreaterThan(fill('lean') + 0.2);
  });

  it('an omnivore gets its carbs from ferns', () => {
    expect(DIET.foods.fern.carb).toBeGreaterThan(1);
    expect(DIET.tracked[PANPHAGIA.diet]).toContain('carb');
  });
});
