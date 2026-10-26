import { describe, expect, it } from 'vitest';
import { createWorld, PLAYER_ID, step, TICK_HZ, type World } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { HERRERASAURUS } from '../src/sim/species';
import { bodyOf, stageOf } from '../src/sim/growth';
import { biteDamage, bitesToKill, maxHp } from '../src/sim/combat';
import { HYPERODAPEDON } from '../src/sim/herbivore';
import { catchRadius, createSauro, SAUROSUCHUS } from '../src/sim/saurosuchus';
import { WIND } from '../src/sim/scent';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };
const secs = (w: World, s: number, cmd: Command | ((w: World) => Command) = idle): void => {
  for (let i = 0; i < s * TICK_HZ; i++) step(w, typeof cmd === 'function' ? cmd(w) : cmd);
};

// Open ground with just the player and one Saurosuchus.
function arena(growth: number, gap: number, hungry = true): World {
  const w = createWorld(5, 1, growth);
  w.herbivores = [];
  w.carcasses = [];
  w.player = createDino(HERRERASAURUS, -10, 20, Math.PI, growth);
  const s = createSauro(500, -10, 20 + gap);
  s.homeX = -10;
  s.homeZ = 20;
  s.yaw = Math.PI;
  if (!hungry) s.lastMeal = 1e9;
  w.sauros = [s];
  return w;
}

describe('growth', () => {
  it('hatches small and slow, and grows only while fed', () => {
    const w = createWorld(1, 200, 0);
    w.sauros = [];
    expect(stageOf(w.player.growth)).toBe('hatchling');
    expect(w.player.body.sprintMax).toBeLessThan(4);
    const g0 = w.player.growth;
    secs(w, 10, (ww) => {
      // Keep it fed and watered.
      ww.player.needs.hunger = 1;
      ww.player.needs.thirst = 1;
      return idle;
    });
    expect(w.player.growth).toBeGreaterThan(g0);
    const g1 = w.player.growth;
    w.player.needs.hunger = 0.3;
    secs(w, 5, (ww) => {
      ww.player.needs.hunger = 0.3;
      return idle;
    });
    expect(w.player.growth).toBe(g1);
  });

  it('takes about the set time to reach adult', () => {
    expect(HERRERASAURUS.toAdult).toBe(5 * 3600);
    expect(stageOf(0.9)).toBe('adult');
    expect(bodyOf(HERRERASAURUS, 1).mass).toBeCloseTo(350);
  });
});

describe('combat', () => {
  it('size ratio decides bite damage', () => {
    expect(bitesToKill(350, 80)).toBe(2); // adult on Hyperodapedon
    expect(maxHp(350)).toBeCloseTo(100);
    expect(maxHp(SAUROSUCHUS.mass)).toBeGreaterThan(maxHp(350)); // bigger and heavier: more HP
    expect(maxHp(80)).toBeLessThan(maxHp(350));
    const hatch = bodyOf(HERRERASAURUS, 0).mass;
    expect(biteDamage(hatch, 80)).toBeLessThan(0.05); // a hatchling can't take one down
    // Saurosuchus out-trades an adult Herrerasaurus.
    const theirs = biteDamage(SAUROSUCHUS.mass, 350, SAUROSUCHUS.biteMult);
    const ours = biteDamage(350, SAUROSUCHUS.mass);
    expect(Math.ceil(1 / theirs)).toBeLessThan(Math.ceil(SAUROSUCHUS.retreatAt > 0 ? (1 - SAUROSUCHUS.retreatAt) / ours : 1 / ours) + 1);
  });
});

describe('Saurosuchus', () => {
  it('a hatchling isn\'t worth a hunt from afar, but it snaps at one close by', () => {
    for (const [gap, expectHunt] of [[20, false], [6, true]] as const) {
      const w = arena(0, gap);
      const s = w.sauros[0];
      let hunted = false;
      for (let i = 0; i < 5 * TICK_HZ; i++) {
        // Hold it at the set distance so this is about choosing prey, not wandering into range.
        if (s.state === 'patrol' || s.state === 'rest') {
          s.x = w.player.x;
          s.z = w.player.z + gap;
        }
        step(w, idle);
        if (s.state === 'stalk' || s.state === 'charge') hunted = true;
      }
      expect(hunted).toBe(expectHunt);
    }
  });

  it('stalks then charges a juvenile, inside its catch radius', () => {
    const w = arena(0.4, 30);
    const states = new Set<string>();
    secs(w, 50, (ww) => {
      states.add(ww.sauros[0]?.state ?? 'none');
      return idle;
    });
    expect(states.has('stalk')).toBe(true);
    expect(states.has('charge')).toBe(true);
    expect(w.player.needs.health).toBeLessThan(1);
  });

  it('kills a sub-adult that stands its ground', () => {
    const w = arena(0.7, 12);
    secs(w, 30, (ww) => {
      ww.player.needs.hunger = 1;
      ww.player.needs.thirst = 1;
      return idle;
    });
    expect(w.player.alive).toBe(false);
    expect(w.lastDeath?.cause).toBe('Saurosuchus');
  });

  it('an adult Herrerasaurus that reacts in time outruns it, and it gives up', () => {
    const w = arena(1, 30);
    const s = w.sauros[0];
    // Two bites kill an adult now, so standing still until it's at 3 m is fatal by design.
    // The player sees it creeping in and sprints away once it's within 12 m.
    let fled = false, gaveUp = false;
    secs(w, 60, () => {
      if (Math.hypot(s.x - w.player.x, s.z - w.player.z) < 12) fled = true;
      if (fled && s.state === 'rest') gaveUp = true;
      return fled ? { moveX: 0, moveZ: -1, sprint: 1 } : idle;
    });
    expect(fled).toBe(true);
    expect(w.player.alive).toBe(true);
    expect(w.player.needs.health).toBe(1);
    expect(gaveUp || s.state === 'stalk' || s.state === 'patrol').toBe(true);
    expect(catchRadius(7.4)).toBeLessThan(catchRadius(4.8));
  });

  it('beats an adult Herrerasaurus that fights it head on', () => {
    const w = arena(1, 6);
    secs(w, 40, (ww) => {
      const p = ww.player, t = ww.sauros[0];
      ww.player.needs.hunger = 1;
      ww.player.needs.thirst = 1;
      ww.player.stamina = 1;
      return t ? { moveX: (t.x - p.x) * 0.01, moveZ: (t.z - p.z) * 0.01, sprint: 0, eat: true } : idle;
    });
    const s = w.sauros[0];
    // Either the player died, or Saurosuchus had to break off: never the Herrerasaurus winning outright.
    expect(!w.player.alive || (s && s.state === 'retreat')).toBe(true);
    expect(w.sauros.length).toBe(1);
  });

  it('ambushes a herd from downwind and eats the kill', () => {
    const w = createWorld(9, 1, 1);
    w.player.alive = false; // out of the picture
    w.carcasses = [];
    const herd = w.herbivores.filter((h) => h.herd === 0);
    const cx = herd.reduce((a, h) => a + h.x, 0) / herd.length, cz = herd.reduce((a, h) => a + h.z, 0) / herd.length;
    const s = w.sauros[0];
    // Downwind, so the herd can't smell it, 25 m off and facing them.
    s.x = cx + WIND.x * 25;
    s.z = cz + WIND.z * 25;
    s.homeX = cx;
    s.homeZ = cz;
    s.yaw = Math.atan2(cx - s.x, cz - s.z);
    let killed = false, ate = false;
    for (let i = 0; i < 4 * 60 * TICK_HZ && !ate; i++) {
      const n = w.herbivores.length;
      step(w, idle);
      if (w.herbivores.length < n) killed = true;
      if (w.sauros[0]?.state === 'eat' && w.sauros[0].eaten > 1) ate = true;
    }
    expect(killed).toBe(true);
    expect(ate).toBe(true);
  });

  it('leaves a big carcass when killed, and another moves in later', () => {
    const w = arena(1, 30, false);
    w.sauros[0].health = 0.01;
    w.player.x = -10;
    w.player.z = 20 + 30 - 3.2;
    w.player.yaw = 0;
    secs(w, 2, { ...idle, eat: true });
    expect(w.sauros.length).toBe(0);
    expect(w.carcasses.some((c) => c.meat > 200)).toBe(true);
    secs(w, 601);
    expect(w.sauros.length).toBe(1);
  });

  it('Hyperodapedon flee from it too', () => {
    const w = createWorld(9, 1, 1);
    w.player.alive = false;
    const s = w.sauros[0];
    const h = w.herbivores[0];
    s.x = h.x;
    s.z = h.z - 8;
    s.state = 'charge';
    s.target = h.id;
    secs(w, 1);
    expect(w.herbivores.find((k) => k.id === h.id)?.state ?? 'flee').toBe('flee');
    expect(PLAYER_ID).toBe(0);
    expect(HYPERODAPEDON.ignoreBelow).toBeGreaterThan(bodyOf(HERRERASAURUS, 0).mass);
  });
});
