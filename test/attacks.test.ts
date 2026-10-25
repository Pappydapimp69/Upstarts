import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ, type World } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { AETOSAUROIDES, EODROMAEUS, HERRERASAURUS, PANPHAGIA, type Species } from '../src/sim/species';
import { createSauro } from '../src/sim/saurosuchus';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };
const press: Command = { ...idle, eat: true };

// A player at (-40, -10) facing +z, with one Hyperodapedon `front` m ahead (or none), and a Saurosuchus `back` m
// behind and a little to one side (or none).
function arena(sp: Species, o: { front?: number; back?: number; seed?: number } = {}): World {
  const w = createWorld(o.seed ?? 1, 1, 1);
  const h = w.herbivores[0];
  w.herbivores = [];
  w.smalls = [];
  w.carcasses = [];
  w.sauros = [];
  w.player = createDino(sp, -40, -10, 0, 1);
  if (o.front !== undefined) {
    Object.assign(h, { x: -40, z: -10 + o.front, yaw: 0, state: 'graze', speed: 0, health: 1 });
    w.herbivores = [h];
  }
  if (o.back !== undefined) {
    const s = createSauro(900, -40.4, -10 - o.back);
    s.yaw = 0;
    s.state = 'rest';
    w.sauros = [s];
  }
  return w;
}
const run = (w: World, cmd: Command, s: number): void => {
  for (let i = 0; i < s * TICK_HZ; i++) step(w, cmd);
};

describe('plant eaters defend without biting', () => {
  it('Aetosauroides never bites, even with prey right in front of it', () => {
    const w = arena(AETOSAUROIDES, { front: 1.6 });
    let bites = 0;
    for (let i = 0; i < 3 * TICK_HZ; i++) {
      step(w, press);
      bites += w.events.filter((e) => e.kind === 'bite' && e.who === 'player').length;
    }
    expect(bites).toBe(0);
    expect(w.herbivores[0].health).toBe(1);
  });

  it('its tail swipe hurts and shoves a Saurosuchus behind it, which usually breaks off', () => {
    let fled = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const w = arena(AETOSAUROIDES, { back: 2.2, seed });
      const s = w.sauros[0];
      let shovedBack = false;
      for (let i = 0; i < TICK_HZ; i++) {
        step(w, press);
        if (w.events.some((e) => e.blow === 'swipe' && e.target === s.id)) shovedBack = w.knocks.some((k) => k.id === s.id && k.vz < 0);
      }
      expect(s.health).toBeLessThan(1);
      expect(shovedBack).toBe(true); // shoved away from it, backward
      if (s.state === 'flee') fled++;
    }
    expect(fled).toBeGreaterThanOrEqual(5);
  });
});

describe('Panphagia kicks behind and bites in front', () => {
  it('kicks a Saurosuchus at its back instead of biting', () => {
    const w = arena(PANPHAGIA, { back: 1.7, front: 0.9 });
    let kicks = 0, bites = 0;
    for (let i = 0; i < 1.2 * TICK_HZ; i++) {
      step(w, press);
      kicks += w.events.filter((e) => e.kind === 'hit' && e.blow === 'kick').length;
      bites += w.events.filter((e) => e.kind === 'bite' && e.who === 'player').length;
    }
    expect(kicks).toBeGreaterThan(0);
    expect(bites).toBe(0);
  });

  it('with nothing behind it, it bites what is in front', () => {
    const w = arena(PANPHAGIA, { front: 0.7 });
    run(w, press, 1);
    expect(w.herbivores[0].health).toBeLessThan(1);
  });
});

describe('Herrerasaurus grabs and holds', () => {
  it('a bitten Hyperodapedon is held at its jaws while the bite is held, and let go when it is released', () => {
    const w = arena(HERRERASAURUS, { front: 2.2 });
    run(w, press, 0.6);
    const h = w.herbivores[0];
    expect(w.player.grip).toBe(h.id);
    // It struggles but can't get away: it stays at the jaws while the hunter walks off with it.
    run(w, { ...press, moveX: 1, moveZ: 0 }, 1.5);
    expect(Math.hypot(h.x - w.player.x, h.z - w.player.z)).toBeLessThan(3);
    run(w, idle, 0.1);
    expect(w.player.grip).toBe(-1);
  });

  it('it does not grab a Saurosuchus', () => {
    const w = arena(HERRERASAURUS);
    const s = createSauro(900, -40, -7.6);
    s.yaw = Math.PI;
    s.state = 'rest';
    w.sauros = [s];
    run(w, press, 0.6);
    expect(s.health).toBeLessThan(1);
    expect(w.player.grip).toBe(-1);
  });
});

describe('Eodromaeus nips', () => {
  it('bites twice as often as a plain biter, and skips back out of reach after a hit', () => {
    const snaps = (sp: Species): { bites: number; back: number } => {
      const w = arena(sp, { front: 0.6 });
      const h = w.herbivores[0];
      let bites = 0, back = 0;
      for (let i = 0; i < 2.5 * TICK_HZ; i++) {
        // Hold the target where the jaws are, so only the bite rate counts.
        const p = w.player;
        Object.assign(h, { x: p.x, z: p.z + p.body.snout + 0.3, speed: 0, health: 1 });
        const z0 = p.z;
        step(w, press);
        bites += w.events.filter((e) => e.kind === 'bite' && e.who === 'player').length;
        back = Math.min(back, w.player.z - z0);
        w.player.stamina = 1;
      }
      return { bites, back };
    };
    const nip = snaps(EODROMAEUS), plain = snaps(PANPHAGIA);
    expect(nip.bites).toBeGreaterThanOrEqual(2 * plain.bites - 1);
    expect(nip.back).toBeLessThan(-0.01); // it moved backward on some tick
    expect(plain.back).toBeGreaterThan(-0.005);
  });
});
