import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ, type World } from '../src/sim/world';
import { restore, SAVE_VERSION, snapshot } from '../src/sim/save';
import type { Command } from '../src/sim/dino';

const walk: Command = { moveX: 0.3, moveZ: 1, sprint: 0 };
const run = (w: World, s: number): void => {
  for (let i = 0; i < s * TICK_HZ; i++) step(w, i % 90 < 40 ? walk : { ...walk, eat: true, moveX: -0.5 });
};
// Everything that matters, as JSON (a save goes through JSON in localStorage).
const state = (w: World): string => JSON.stringify(snapshot(w));

describe('saves', () => {
  it('a world saved, written out as JSON and loaded carries on exactly as the original does', () => {
    const a = createWorld(7, 1, 0.4, 'proterochampsa');
    run(a, 40);
    const saved = JSON.parse(JSON.stringify(snapshot(a)));
    const b = restore(saved)!;
    expect(b).not.toBeNull();
    expect(state(b)).toBe(state(a));
    run(a, 60);
    run(b, 60);
    expect(state(b)).toBe(state(a));
    expect(b.player.species.id).toBe('proterochampsa');
    expect(b.player.coat.wet).toBeInstanceOf(Float32Array);
  });

  it('a dead player stays dead after a reload (death is permanent)', () => {
    const w = createWorld(3, 1, 0.5);
    for (let i = 0; i < 120 * TICK_HZ && w.player.alive; i++) {
      w.player.needs.hunger = w.player.needs.thirst = 0;
      step(w, { moveX: 0, moveZ: 0, sprint: 0 });
    }
    expect(w.player.alive).toBe(false);
    const b = restore(JSON.parse(JSON.stringify(snapshot(w))))!;
    expect(b.player.alive).toBe(false);
    expect(b.lastDeath?.cause).toBe(w.lastDeath?.cause);
  });

  it('refuses a save from another version, or one that is not a save', () => {
    const s = snapshot(createWorld(1));
    expect(restore({ ...s, v: SAVE_VERSION + 1 })).toBeNull();
    expect(restore(null)).toBeNull();
    expect(restore({ v: SAVE_VERSION, players: [] })).toBeNull();
    expect(restore({ ...s, players: [{ ...s.players[0], speciesId: 'tyrannosaurus' }] })).toBeNull();
  });
});
