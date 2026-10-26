import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ } from '../src/sim/world';
import { loadWorld, saveWorld, SAVE_VERSION } from '../src/sim/save';

const walk = { moveX: 0.3, moveZ: 1, sprint: 0, eat: true };

describe('saves', () => {
  it('a loaded world plays on exactly as the saved one', () => {
    const a = createWorld(13, 5, 0.4);
    for (let i = 0; i < 20 * TICK_HZ; i++) step(a, walk);
    const b = loadWorld(saveWorld(a, 0));
    for (let i = 0; i < 40 * TICK_HZ; i++) {
      step(a, walk);
      step(b, walk);
    }
    expect(saveWorld(b, 0)).toBe(saveWorld(a, 0));
    expect(b.player.species).toBe(a.player.species);
    expect(b.player.body.mass).toBeCloseTo(a.player.body.mass);
  });

  it('keeps nests, wounds and a creature that never laid', () => {
    const a = createWorld(2, 1, 1);
    a.player.bleed = 0.4;
    a.nests.push({ id: 900, x: 1, z: 2, yaw: 0, species: 'herrerasaurus', owner: 0, generation: 3, eggs: 2, laidAt: 0, unguarded: 0 });
    const b = loadWorld(saveWorld(a));
    expect(b.player.bleed).toBe(0.4);
    expect(b.nests[0].generation).toBe(3);
    expect(b.player.lastClutch).toBeLessThan(-1e9);
    step(b, walk); // and it runs
  });

  it('refuses junk and newer versions', () => {
    expect(() => loadWorld('{"x":1}')).toThrow();
    const s = JSON.parse(saveWorld(createWorld(1)));
    s.version = SAVE_VERSION + 1;
    expect(() => loadWorld(JSON.stringify(s))).toThrow(/newer/);
  });
});
