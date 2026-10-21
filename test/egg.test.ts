import { describe, expect, it } from 'vitest';
import { createWorld, EGG, step } from '../src/sim/world';
import type { Command } from '../src/sim/dino';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

describe('hatch', () => {
  it('a new hatchling starts in the egg, can not move or act, and tears free in four presses', () => {
    const w = createWorld(3, 1, 0, 'herrerasaurus', true);
    w.sauros = [];
    const d = w.player, x = d.x, z = d.z;
    expect(d.egg).toBe(EGG.presses);
    for (let i = 0; i < 60; i++) step(w, { moveX: 1, moveZ: 1, sprint: 1, eat: true, drink: true, call: 'roar' });
    expect(Math.hypot(d.x - x, d.z - z)).toBeLessThan(1e-6);
    expect(d.act).toBe('none');
    expect(w.events.some((e) => e.call === 'roar')).toBe(false);
    for (let k = 0; k < EGG.presses; k++) {
      step(w, { ...idle, respawn: true });
      expect(w.events.some((e) => e.call === 'chirp')).toBe(true);
    }
    expect(d.egg).toBe(0);
    for (let i = 0; i < 30; i++) step(w, { moveX: 1, moveZ: 0, sprint: 0 });
    expect(Math.hypot(d.x - x, d.z - z)).toBeGreaterThan(0.1);
  });

  it('adult starts and test worlds skip the egg', () => {
    expect(createWorld(3, 1, 1, 'herrerasaurus', true).player.egg).toBe(0);
    expect(createWorld(3).player.egg).toBe(0);
  });
});
