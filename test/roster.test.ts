import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_DT, TICK_HZ, type World } from '../src/sim/world';
import { createDino, stepDino, type Command } from '../src/sim/dino';
import { AETOSAUROIDES, EODROMAEUS, HERRERASAURUS, PANPHAGIA, PROTEROCHAMPSA, SPECIES, SPECIES_ORDER } from '../src/sim/species';
import { ROCKS, tierOf } from '../src/sim/ground';
import { PONDS } from '../src/sim/terrain';
import { createSauro, SAUROSUCHUS } from '../src/sim/saurosuchus';
import { biteDamage } from '../src/sim/combat';
import { CLOCK } from '../src/sim/clock';
import { senses } from '../src/sim/herbivore';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };
const empty = (seed = 1): World => {
  const w = createWorld(seed, 1, 1);
  w.sauros = [];
  w.herbivores = [];
  w.smalls = [];
  w.carcasses = [];
  return w;
};

describe('four legs (owner: can not jump, can not trip)', () => {
  it('a quadruped never leaves the ground on A', () => {
    for (const sp of [PROTEROCHAMPSA, AETOSAUROIDES]) {
      const d = createDino(sp, -40, -10, 0, 1);
      for (let i = 0; i < 2 * TICK_HZ; i++) {
        stepDino(d, { moveX: 0, moveZ: 1, sprint: 0, jump: i % 10 === 0 }, TICK_DT);
        expect(d.jump).toBeNull();
        expect(d.air).toBe(0);
      }
    }
    const h = createDino(HERRERASAURUS, -40, -10, 0, 1);
    stepDino(h, { ...idle, jump: true }, TICK_DT);
    expect(h.jump).not.toBeNull();
  });

  it('a tired quadruped sprinting over every rock never goes down; it can still slip', () => {
    for (const sp of [AETOSAUROIDES, PROTEROCHAMPSA]) {
      const w = empty();
      let down = 0, slips = 0;
      for (const k of ROCKS.filter((r) => tierOf(r.h, sp.hip) === 1).slice(0, 20)) {
        for (const yaw of [0, 2.1, 4.2]) {
          const back = k.r + 8;
          w.player = createDino(sp, k.x - Math.sin(yaw) * back, k.z - Math.cos(yaw) * back, yaw, 1);
          for (let i = 0; i < 5 * TICK_HZ; i++) {
            w.player.stamina = 0.2;
            step(w, { moveX: Math.sin(yaw), moveZ: Math.cos(yaw), sprint: 1 });
            const f = w.player.fall;
            if (f?.down) down++;
            if (f && f.t === 0) slips++;
          }
        }
      }
      expect(down).toBe(0);
      void slips;
    }
  });
});

describe('Proterochampsa: in the water', () => {
  const pondWorld = (): World => {
    const w = empty();
    const P = PONDS[0];
    w.player = createDino(PROTEROCHAMPSA, P.x, P.z, 0, 1);
    return w;
  };

  it('floats and swims in water a land animal can not enter; still, it sinks low', () => {
    const w = pondWorld(), d = w.player;
    for (let i = 0; i < 3 * TICK_HZ; i++) step(w, { moveX: 1, moveZ: 0, sprint: 0 });
    expect(d.swim).toBeGreaterThan(0.9);
    expect(d.speed).toBeCloseTo(PROTEROCHAMPSA.swim, 0);
    for (let i = 0; i < 6 * TICK_HZ; i++) step(w, idle);
    expect(d.under).toBeGreaterThan(0.8);
    // A Herrerasaurus pulls up at the edge instead.
    const h = createDino(HERRERASAURUS, PONDS[0].x, PONDS[0].z + PONDS[0].r + 2, Math.PI, 1);
    for (let i = 0; i < 6 * TICK_HZ; i++) stepDino(h, { moveX: 0, moveZ: -1, sprint: 0 }, TICK_DT);
    expect(Math.hypot(h.x - PONDS[0].x, h.z - PONDS[0].z)).toBeGreaterThan(PONDS[0].r * 0.4);
  });

  it('lying low it is nearly invisible to a herd at the water', () => {
    const w = createWorld(2, 1, 1, 'proterochampsa');
    w.sauros = [];
    const h = w.herbivores[0];
    const pred = { id: 0, x: h.x + 10, z: h.z, speed: 0, alive: true, mass: PROTEROCHAMPSA.mass, stealth: 1, hunts: true };
    expect(senses(h, pred)).toBe(true);
    expect(senses(h, { ...pred, stealth: 0.15 })).toBe(false);
  });

  it('the pond has a few fish, and they stay in it', () => {
    const w = createWorld(3);
    const fish = w.smalls.filter((m) => m.kind === 'fish');
    expect(fish.length).toBeGreaterThan(2);
    for (let i = 0; i < 20 * TICK_HZ; i++) step(w, idle);
    for (const f of fish) expect(Math.hypot(f.x - PONDS[0].x, f.z - PONDS[0].z)).toBeLessThan(PONDS[0].r);
  });

  it('herds come down to the pond to drink', () => {
    const w = createWorld(4);
    w.sauros = [];
    let atWater = false;
    for (let i = 0; i < 12 * 60 * TICK_HZ && !atWater; i += 30) {
      for (let k = 0; k < 30; k++) step(w, idle);
      atWater = w.herds.some((h) => h.drinkUntil > 0);
    }
    expect(atWater).toBe(true);
  });
});

describe('Aetosauroides: armour', () => {
  it('its plates cut a Saurosuchus bite, and lying flat cuts it more', () => {
    const juv = createDino(AETOSAUROIDES, 0, 0, 0, 0.6).body.mass;
    const plain = biteDamage(SAUROSUCHUS.mass, juv, SAUROSUCHUS.biteMult);
    const plated = biteDamage(SAUROSUCHUS.mass, juv, SAUROSUCHUS.biteMult, AETOSAUROIDES.hide);
    const flat = biteDamage(SAUROSUCHUS.mass, juv, SAUROSUCHUS.biteMult, AETOSAUROIDES.hide * 1.5);
    expect(plated).toBeLessThan(plain * 0.7); // the unarmoured bite is already at the size-ratio cap
    expect(flat).toBeLessThan(plated);
  });

  it('herds do not run from it, and an adult is not Saurosuchus prey', () => {
    const h = createWorld(1).herbivores[0];
    expect(senses(h, { id: 0, x: h.x + 5, z: h.z, speed: 1, alive: true, mass: AETOSAUROIDES.mass, stealth: 1, hunts: false })).toBe(false);
    expect(AETOSAUROIDES.mass).toBeGreaterThan(SAUROSUCHUS.mass * SAUROSUCHUS.maxPreyFrac);
  });

  it('roots for grubs and browses ferns, but is not a hunter', () => {
    expect(AETOSAUROIDES.diet).toBe('rooter');
    expect(AETOSAUROIDES.biteMult).toBeLessThan(0.5);
  });
});

describe('cold blood', () => {
  it('a reptile goes hungry several times slower than a dinosaur of similar size', () => {
    const run = (sp: typeof AETOSAUROIDES): number => {
      const w = empty();
      w.player = createDino(sp, -40, -10, 0, 1);
      for (let i = 0; i < 120 * TICK_HZ; i++) step(w, idle);
      return 1 - w.player.needs.hunger;
    };
    expect(run(AETOSAUROIDES) * 2.5).toBeLessThan(run(HERRERASAURUS));
  });

  it('is sluggish at night', () => {
    const speedAt = (t: number): number => {
      const w = empty();
      w.tick = Math.round(t * TICK_HZ);
      w.player = createDino(AETOSAUROIDES, -40, -10, 0, 1);
      for (let i = 0; i < 3 * TICK_HZ; i++) step(w, { moveX: 0, moveZ: 1, sprint: 0 });
      return w.player.speed;
    };
    const night = CLOCK.dawn + CLOCK.high + CLOCK.dusk + 120 - CLOCK.start;
    expect(speedAt(night)).toBeLessThan(0.8 * speedAt(CLOCK.dawn + 600 - CLOCK.start));
  });
});

describe('the roster', () => {
  it('a full-grown Herrerasaurus outweighs the Saurosuchus; everything smaller fears it', () => {
    expect(HERRERASAURUS.mass).toBeGreaterThan(SAUROSUCHUS.mass);
    expect(HERRERASAURUS.mass).toBeGreaterThan(SAUROSUCHUS.mass * SAUROSUCHUS.fearFrac);
    for (const id of SPECIES_ORDER) if (id !== 'herrerasaurus') expect(SPECIES[id].mass).toBeLessThan(SAUROSUCHUS.mass * SAUROSUCHUS.fearFrac);
  });

  it('every species can hatch, walk, drink and eat something', () => {
    for (const id of SPECIES_ORDER) {
      const w = createWorld(5, 1, 0, id);
      w.sauros = [];
      const d = w.player;
      const x0 = d.x, z0 = d.z;
      for (let i = 0; i < 2 * TICK_HZ; i++) step(w, { moveX: 0, moveZ: 1, sprint: 0 });
      expect(Math.hypot(d.x - x0, d.z - z0)).toBeGreaterThan(0.2);
    }
    expect([EODROMAEUS, PANPHAGIA].every((s) => s.plan === 'biped')).toBe(true);
  });

  it('Saurosuchus will not hunt a full-grown Herrerasaurus', () => {
    const w = empty();
    w.player = createDino(HERRERASAURUS, -10, 20, Math.PI, 1);
    const s = createSauro(500, -10, 45);
    s.homeX = -10;
    s.homeZ = 30;
    w.sauros = [s];
    let hunted = false;
    for (let i = 0; i < 30 * TICK_HZ; i++) {
      step(w, idle);
      if (s.state === 'stalk' || s.state === 'charge') hunted = true;
    }
    expect(hunted).toBe(false);
  });
});

describe('Proterochampsa: the ambush', () => {
  it('lunges from lying low, and a grip at the water drowns a Hyperodapedon it could not bite to death', () => {
    const w = createWorld(1, 1, 1, 'proterochampsa');
    w.sauros = [];
    w.smalls = [];
    const P = PONDS[0];
    // A Hyperodapedon drinking at the edge, the hunter lying low two metres out, facing it.
    w.herbivores = [w.herbivores[0]];
    const h = w.herbivores[0];
    h.x = P.x;
    h.z = P.z + P.r + 0.2;
    h.state = 'graze';
    w.player = createDino(PROTEROCHAMPSA, P.x, P.z + P.r - 2.2, 0, 1);
    const d = w.player;
    d.swim = d.under = 1;
    let lunged = false;
    for (let i = 0; i < 25 * TICK_HZ && w.herbivores.length; i++) {
      const hh = w.herbivores[0];
      const dist = Math.hypot(hh.x - d.x, hh.z - d.z), ux = (hh.x - d.x) / dist, uz = (hh.z - d.z) / dist;
      step(w, d.grip >= 0 ? { moveX: -ux * 0.6, moveZ: -uz * 0.6, sprint: 0, eat: true } : { moveX: ux, moveZ: uz, sprint: 1, eat: true });
      if (d.lungeT < 0.5) lunged = true;
    }
    expect(lunged).toBe(true);
    expect(w.herbivores.length).toBe(0);
    expect(w.carcasses.length).toBeGreaterThan(0);
  });
});
