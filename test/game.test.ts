import { describe, expect, it } from 'vitest';
import { BITE, CARCASS, COUNTER, createWorld, START, step, TICK_HZ, type World } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { HERRERASAURUS, SPECIES } from '../src/sim/species';
import { objectiveOf } from '../src/sim/objective';
import { createSauro } from '../src/sim/saurosuchus';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

// One Hyperodapedon in front of an adult, nothing else about.
function duel(seed = 3): World {
  const w = createWorld(seed);
  w.sauros = [];
  w.smalls = [];
  w.carcasses = [];
  w.herbivores = [w.herbivores[0]];
  const h = w.herbivores[0];
  h.x = 0;
  h.z = 2.2;
  h.yaw = 0;
  h.state = 'graze';
  w.player = createDino(HERRERASAURUS, 0, 0, 0);
  return w;
}

describe('a harder opening', () => {
  it('a game hatchling starts thirsty and hungry, with no carcasses, and a cynodont just past the nest', () => {
    const w = createWorld(7, 1, 0, 'herrerasaurus', true);
    expect(CARCASS.start).toBe(0);
    expect(w.carcasses.length).toBe(0);
    expect(w.player.needs.thirst).toBe(START.needs);
    expect(w.player.needs.hunger).toBe(START.needs);
    const near = w.smalls.filter((m) => m.kind === 'cynodont' && Math.hypot(m.x - w.player.x, m.z - w.player.z) <= START.preyGap + 0.01);
    expect(near.length).toBeGreaterThan(0);
    // Tests and ?adult start full.
    expect(createWorld(7).player.needs.hunger).toBe(1);
  });
});

describe('bites (the Dlist demo fight feel)', () => {
  it('the jaws close a moment after the press, not on it', () => {
    const w = duel();
    step(w, { ...idle, eat: true });
    expect(w.events.some((e) => e.kind === 'bite')).toBe(false);
    for (let i = 0; i < BITE.snap * TICK_HZ + 1; i++) step(w, { ...idle, eat: true });
    expect(w.herbivores[0].health).toBeLessThan(1);
  });

  it('snaps on air when the target slips out of the way', () => {
    const w = duel();
    step(w, { ...idle, eat: true });
    w.herbivores[0].x = 3; // gone sideways before the jaws close
    let missed = false;
    for (let i = 0; i < BITE.snap * TICK_HZ + 1; i++) {
      step(w, idle);
      if (w.events.some((e) => e.kind === 'bite' && e.who === 'player' && e.miss)) missed = true;
    }
    expect(missed).toBe(true);
    expect(w.herbivores[0].health).toBe(1);
  });

  it('a glancing bite does less than a clean one', () => {
    const clean = duel(), glance = duel();
    glance.herbivores[0].x = 0.55;
    for (const w of [clean, glance]) for (let i = 0; i < 0.5 * TICK_HZ; i++) {
      w.herbivores[0].z = 2.2;
      step(w, { ...idle, eat: true });
    }
    expect(glance.herbivores[0].health).toBeLessThan(1);
    expect(glance.herbivores[0].health).toBeGreaterThan(clean.herbivores[0].health);
  });

  it('a bite shoves a lighter victim back along the strike', () => {
    const w = duel();
    const z0 = w.herbivores[0].z;
    for (let i = 0; i < 0.6 * TICK_HZ; i++) step(w, { ...idle, eat: i < 2 });
    expect(w.herbivores[0].z - z0).toBeGreaterThan(0.3);
  });

  it('a wounded Hyperodapedon sometimes bites back', () => {
    let backs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const w = duel(seed);
      for (let i = 0; i < 1.5 * TICK_HZ; i++) {
        const h = w.herbivores[0];
        if (h) {
          h.x = 0;
          h.z = 2.2;
        }
        step(w, { ...idle, eat: i < 2 });
        if (w.events.some((e) => e.kind === 'hit' && e.who === 'prey')) backs++;
      }
    }
    // Chance per wounding bite is COUNTER.chance; over 12 tries some, but not all, bite back.
    expect(backs).toBeGreaterThan(0);
    expect(backs).toBeLessThan(12);
    expect(COUNTER.below).toBeGreaterThan(0.4);
  });

  it('badly hurt, it limps', () => {
    const run = (health: number): number => {
      const w = createWorld(1);
      w.sauros = [];
      w.player.needs.health = health;
      for (let i = 0; i < 3 * TICK_HZ; i++) step(w, { moveX: 0, moveZ: -1, sprint: 0 });
      return w.player.speed;
    };
    expect(run(0.1)).toBeLessThan(0.85 * run(1));
  });
});

describe('objective', () => {
  it('follows a priority ladder from live state', () => {
    const w = createWorld(2, 1, 0, 'herrerasaurus', true);
    w.sauros = [];
    expect(objectiveOf(w)!.key).toBe('egg');
    w.player.egg = 0;
    expect(objectiveOf(w)!.key).toBe('drink'); // thirsty from the egg
    expect(objectiveOf(w)!.at).not.toBeNull();
    w.player.needs.thirst = 1;
    expect(['hunt:the small cynodont', 'grubs', 'carcass']).toContain(objectiveOf(w)!.key);
    w.player.needs.hunger = 1;
    expect(objectiveOf(w)!.key).toBe('grow');
    w.player.needs.thirst = 0.2;
    expect(objectiveOf(w)!.key).toBe('drinkNow');
    // A Saurosuchus hunting it outranks everything.
    const s = createSauro(900, w.player.x + 10, w.player.z);
    s.state = 'stalk';
    s.target = w.players[0].entity;
    w.sauros = [s];
    expect(objectiveOf(w)!.key).toBe('danger');
    w.player.alive = false;
    expect(objectiveOf(w)).toBeNull();
  });

  it('an omnivore with nothing to hunt is told to browse', () => {
    const w = createWorld(2, 1, 0, 'panphagia');
    w.sauros = [];
    w.smalls = [];
    w.herbivores = [];
    w.player = createDino(SPECIES.panphagia, 0, 0, 0, 0);
    w.player.needs.hunger = 0.5;
    const o = objectiveOf(w)!;
    expect(['browse', 'grubs']).toContain(o.key);
  });
});
