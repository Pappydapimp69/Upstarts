import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ, type World } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { SPECIES } from '../src/sim/species';
import { GRUB, SMALL, SMALL_POP } from '../src/sim/smallprey';
import { SPAWNS } from '../src/sim/terrain';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

function quiet(seed = 4): World {
  const w = createWorld(seed);
  w.sauros = [];
  w.herbivores = [];
  return w;
}

describe('small prey', () => {
  it('populates burrows near spawns, an Exaeretodon group and grub sites', () => {
    const w = createWorld(4);
    const cyn = w.smalls.filter((s) => s.kind === 'cynodont'), ex = w.smalls.filter((s) => s.kind === 'exaeretodon');
    expect(cyn.length).toBe(SMALL_POP.burrows * SMALL_POP.perBurrow);
    expect(ex.length).toBe(SMALL_POP.exaeretodon.adults + SMALL_POP.exaeretodon.juveniles);
    expect(w.grubs.length).toBe(SMALL_POP.grubs);
    for (const c of cyn) expect(Math.min(...SPAWNS.map((p) => Math.hypot(p.x - c.homeX, p.z - c.homeZ)))).toBeLessThan(41);
  });

  it('a hatchling digs out a grub and gets fed; the site is empty for a while', () => {
    const w = quiet();
    const g = w.grubs[0];
    w.player = createDino(SPECIES.eodromaeus, g.x, g.z - 0.1, 0, 0);
    w.player.needs.hunger = 0.3;
    for (let i = 0; i < 2 * TICK_HZ; i++) step(w, { ...idle, eat: true });
    expect(w.player.needs.hunger).toBeGreaterThan(0.9);
    expect(g.readyAt).toBeGreaterThan(w.tick / TICK_HZ + GRUB.respawn - 3);
  });

  it('a cynodont bolts to its burrow when a sprinting predator comes, then hides', () => {
    const w = quiet();
    const c = w.smalls.find((s) => s.kind === 'cynodont')!;
    c.x = c.homeX + 4;
    c.z = c.homeZ;
    w.player = createDino(SPECIES.herrerasaurus, c.x + 8, c.z, -Math.PI / 2, 0.1);
    let hid = false;
    for (let i = 0; i < 4 * TICK_HZ && !hid; i++) {
      step(w, { moveX: -1, moveZ: 0, sprint: 1 });
      hid = c.state === 'hide';
    }
    expect(hid).toBe(true);
  });

  it('a hatchling Herrerasaurus catches and swallows a cornered cynodont', () => {
    const w = quiet();
    const c = w.smalls.find((s) => s.kind === 'cynodont')!;
    w.player = createDino(SPECIES.herrerasaurus, c.x, c.z - 0.5, 0, 0);
    w.player.needs.hunger = 0.2;
    for (let i = 0; i < 3 * TICK_HZ && c.state !== 'gone'; i++) {
      c.x = w.player.x;
      c.z = w.player.z + 0.5; // pinned in front of the jaws
      c.state = 'forage';
      step(w, { ...idle, eat: true });
    }
    expect(c.state).toBe('gone');
    expect(w.player.needs.hunger).toBeGreaterThan(0.2);
    // It comes back after its respawn time.
    for (let i = 0; i < (SMALL.cynodont.respawn + 2) * TICK_HZ; i++) step(w, idle);
    expect(c.state).not.toBe('gone');
  });

  it('an Exaeretodon kill leaves a carcass', () => {
    const w = quiet();
    w.carcasses = [];
    const e = w.smalls.find((s) => s.kind === 'exaeretodon' && s.mass < 20)!;
    w.player = createDino(SPECIES.herrerasaurus, e.x, e.z - 1.5, 0, 1);
    for (let i = 0; i < 5 * TICK_HZ && e.state !== 'gone'; i++) {
      e.x = w.player.x;
      e.z = w.player.z + 1.5;
      step(w, { ...idle, eat: true });
    }
    expect(e.state).toBe('gone');
    expect(w.carcasses.length).toBe(1);
  });

  it('is deterministic', () => {
    const a = createWorld(9, 1, 0.3), b = createWorld(9, 1, 0.3);
    for (let t = 0; t < 1500; t++) {
      const c: Command = { moveX: Math.sin(t * 0.01), moveZ: 1, sprint: t % 300 > 200 ? 1 : 0, eat: true };
      step(a, c);
      step(b, c);
    }
    expect(b.smalls.map((s) => [s.x, s.z, s.state])).toEqual(a.smalls.map((s) => [s.x, s.z, s.state]));
  });
});
