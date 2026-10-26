import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ, type World } from '../src/sim/world';
import { NEST, nestSiteOk } from '../src/sim/family';
import type { Command } from '../src/sim/dino';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

// A full-grown Herrerasaurus alone on open dry ground (no Saurosuchus, no herds), fed and watered.
function valley(seed = 3): World {
  const w = createWorld(seed, 1, 1, 'herrerasaurus');
  w.sauros = [];
  w.herbivores = [];
  const p = w.player;
  for (let r = 6; r < 60; r += 1.5) {
    for (let a = 0; a < 6.28; a += 0.3) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (nestSiteOk(x, z, [])) {
        p.x = x;
        p.z = z;
        return w;
      }
    }
  }
  throw new Error('no open ground');
}
const feed = (w: World): void => {
  w.player.needs.hunger = w.player.needs.thirst = 1;
};

describe('family', () => {
  it('a grown animal calls, one of its kind comes, and staying close a while they pair', () => {
    const w = valley();
    step(w, idle);
    expect(w.mates.length).toBe(1);
    const m = w.mates[0];
    const d0 = Math.hypot(m.x - w.player.x, m.z - w.player.z);
    expect(d0).toBeGreaterThan(20);
    let answered = false;
    for (let i = 0; i < 120 * TICK_HZ && !w.player.mated; i++) {
      feed(w);
      step(w, i % (8 * TICK_HZ) === 0 ? { ...idle, call: 'auto' } : idle);
      if (w.events.some((e) => e.kind === 'call' && e.id === m.id)) answered = true;
    }
    expect(answered).toBe(true);
    expect(w.player.mated).toBe(true);
  });

  it('paired and fed on open ground, it digs a nest and lays a clutch, which hatches', () => {
    const w = valley();
    w.player.mated = true;
    for (let i = 0; i < (NEST.dig + 0.5) * TICK_HZ; i++) {
      feed(w);
      step(w, { ...idle, eat: true });
    }
    expect(w.nests.length).toBe(1);
    const n = w.nests[0];
    expect(n.eggs).toBe(NEST.clutch.herrerasaurus);
    expect(w.player.mated).toBe(false); // one clutch per pairing
    // It hatches after the incubation (scaled by the growth setting).
    const t = NEST.incubate / w.growScale + 2;
    for (let i = 0; i < t * TICK_HZ; i++) {
      feed(w);
      step(w, idle);
    }
    expect(n.eggs).toBe(0);
    expect(n.young).toBeGreaterThan(0);
  });

  it("not without a mate, and not where it's too wet or rocky", () => {
    const w = valley();
    for (let i = 0; i < (NEST.dig + 1) * TICK_HZ; i++) {
      feed(w);
      step(w, { ...idle, eat: true });
    }
    expect(w.nests.length).toBe(0);
    expect(nestSiteOk(15, -9, [])).toBe(false); // the pond
  });

  it('small cynodonts take eggs left unguarded near their burrows', () => {
    const w = valley();
    const c = w.smalls.find((m) => m.kind === 'cynodont')!;
    w.nests.push({ id: 900, owner: w.players[0].entity, species: 'herrerasaurus', x: c.homeX + 4, z: c.homeZ, eggs: 6, young: 0, youngGrowth: 0, hatchAt: 1e9, taken: 0 });
    w.player.x = c.homeX + 60; // far away
    for (let i = 0; i < 90 * TICK_HZ; i++) step(w, idle);
    expect(w.nests[0]?.eggs ?? 0).toBeLessThan(6);
  });

  it('when it dies, the player carries on as one of its young: the next generation', () => {
    const w = valley();
    const slot = w.players[0];
    w.nests.push({ id: 901, owner: slot.entity, species: 'herrerasaurus', x: w.player.x + 5, z: w.player.z, eggs: 0, young: 3, youngGrowth: 0.3, hatchAt: 0, taken: 0 });
    for (let i = 0; i < 240 * TICK_HZ && w.player.alive; i++) {
      w.player.needs.hunger = w.player.needs.thirst = 0;
      step(w, idle);
    }
    expect(w.player.alive).toBe(false);
    step(w, { ...idle, respawn: true });
    expect(w.player.alive).toBe(true);
    expect(slot.generation).toBe(2);
    expect(w.player.growth).toBeGreaterThanOrEqual(0.3);
    expect(Math.hypot(w.player.x - w.nests[0].x, w.player.z - w.nests[0].z)).toBeLessThan(2);
    expect(w.nests[0].young).toBe(2);
  });
});
