import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ } from '../src/sim/world';
import { createDino, stepDino, type Command } from '../src/sim/dino';
import { HERRERASAURUS } from '../src/sim/species';
import { TICK_DT } from '../src/sim/world';

const ahead = (sprint = 0): Command => ({ moveX: 0, moveZ: 1, sprint });

function run(cmd: Command, seconds: number, x = 0, z = -30) {
  const d = createDino(HERRERASAURUS, x, z, 0);
  for (let i = 0; i < seconds * TICK_HZ; i++) stepDino(d, cmd, TICK_DT);
  return d;
}

describe('movement', () => {
  it('walks at about 3.4 m/s on the valley floor', () => {
    const d = run(ahead(), 4);
    expect(d.speed).toBeGreaterThan(3.0);
    expect(d.speed).toBeLessThanOrEqual(3.5);
  });

  it('sprints faster than it walks, under the 7.4 m/s cap', () => {
    const d = run(ahead(1), 8);
    expect(d.speed).toBeGreaterThan(6);
    expect(d.speed).toBeLessThanOrEqual(7.4 * 1.04);
  });

  it('caps acceleration at 2.1 m/s^2', () => {
    const d = run(ahead(1), 1);
    expect(d.speed).toBeLessThanOrEqual(2.1 + 1e-9);
  });

  it('slows down climbing into the hills', () => {
    // Run outward from the centre into the rising rim.
    const d = createDino(HERRERASAURUS, 0, 40, 0);
    let minUphill = Infinity;
    for (let i = 0; i < 8 * TICK_HZ; i++) {
      stepDino(d, ahead(1), TICK_DT);
      if (d.grade > 0.15 && i > 4 * TICK_HZ) minUphill = Math.min(minUphill, d.speed);
    }
    expect(minUphill).toBeLessThan(6);
  });

  it('drains stamina only while sprinting', () => {
    expect(run(ahead(), 10).stamina).toBe(1);
    expect(run(ahead(1), 10).stamina).toBeLessThan(1);
  });
});

describe('determinism', () => {
  it('replays the same commands to the same state, tick for tick', () => {
    const script = (t: number): Command => ({ moveX: Math.sin(t * 0.03), moveZ: Math.cos(t * 0.05), sprint: t % 200 > 120 ? 1 : 0 });
    const a = createWorld(), b = createWorld();
    for (let t = 0; t < 1800; t++) {
      step(a, script(t));
      step(b, script(t));
      // Fingerprint every tick: an end-state check can hide a mid-run desync.
      expect([b.player.x, b.player.z, b.player.yaw, b.player.speed]).toEqual([a.player.x, a.player.z, a.player.yaw, a.player.speed]);
    }
  });
});
