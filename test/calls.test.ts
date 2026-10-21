import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ } from '../src/sim/world';
import { roarStyle } from '../src/sim/calls';
import type { Command } from '../src/sim/dino';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

describe('calls', () => {
  it('Y plays the roar that fits the animal', () => {
    expect(roarStyle(0.2, 1, 1)).toBe('winded');
    expect(roarStyle(1, 0.3, 1)).toBe('parched');
    expect(roarStyle(1, 1, 0.3)).toBe('hungry');
    expect(roarStyle(1, 1, 1)).toBe('roar');
  });

  it('a call is a sound event from the mouth, and calls don\'t overlap', () => {
    const w = createWorld(2, 1, 1);
    w.sauros = [];
    step(w, { ...idle, call: 'roar' });
    const ev = w.events.find((e) => e.kind === 'call' && e.who === 'player');
    expect(ev?.call).toBe('roar');
    step(w, { ...idle, call: 'growl' }); // still roaring
    expect(w.events.some((e) => e.kind === 'call' && e.who === 'player')).toBe(false);
    for (let i = 0; i < 2 * TICK_HZ; i++) step(w, idle);
    step(w, { ...idle, call: 'growl' });
    expect(w.events.find((e) => e.kind === 'call' && e.who === 'player')?.call).toBe('growl');
  });

  it('an adult\'s roar sets a nearby herd running; a hatchling\'s call doesn\'t', () => {
    for (const [growth, expectFlee] of [[1, true], [0, false]] as const) {
      const w = createWorld(3, 1, growth);
      w.sauros = [];
      const h = w.herbivores[0];
      w.player.x = h.x + 30;
      w.player.z = h.z;
      step(w, { ...idle, call: 'roar' });
      for (let i = 0; i < 1 * TICK_HZ; i++) step(w, idle);
      expect(w.herbivores.some((k) => k.state === 'flee')).toBe(expectFlee);
    }
  });

  it('a hungry Saurosuchus comes to look when it hears a call', () => {
    const w = createWorld(4, 1, 1);
    const s = w.sauros[0];
    s.state = 'patrol';
    s.x = w.player.x + 40;
    s.z = w.player.z;
    step(w, { ...idle, call: 'bellow' });
    expect(Math.hypot(s.wanderX - w.player.x, s.wanderZ - w.player.z)).toBeLessThan(1);
  });
});
