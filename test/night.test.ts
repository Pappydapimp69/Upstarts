import { describe, expect, it } from 'vitest';
import { createWorld, step, TICK_HZ, type World } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { SPECIES } from '../src/sim/species';
import { CLOCK, dayTime, isNight, sunElevation } from '../src/sim/clock';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };
const NIGHT_START = CLOCK.dawn + CLOCK.high + CLOCK.dusk;

// A world whose clock is moved to the middle of the night.
function atNight(): World {
  const w = createWorld(3);
  w.tick = Math.round((NIGHT_START + CLOCK.night / 2 - CLOCK.start) * TICK_HZ);
  w.player = createDino(SPECIES.herrerasaurus, 60, -60, 0, 1);
  return w;
}

describe('clock', () => {
  it('60 minutes of day (40 within 15 degrees of the peak) and 20 of night', () => {
    let day = 0, high = 0;
    for (let u = 0; u < CLOCK.cycle; u += 1) {
      if (!isNight(u) && sunElevation(u) > 0) day++;
      if (sunElevation(u) >= CLOCK.peak - 15 - 1e-9) high++;
    }
    expect(Math.abs(day - 3600)).toBeLessThan(30);
    expect(Math.abs(high - 2400)).toBeLessThan(5);
    expect(isNight(NIGHT_START + 600)).toBe(true);
    expect(dayTime(0)).toBe(CLOCK.start);
  });
});

describe('night sleep (D14)', () => {
  it('Hyperodapedon and Saurosuchus fall asleep at night', () => {
    const w = atNight();
    for (let i = 0; i < 25 * TICK_HZ; i++) step(w, idle);
    expect(w.herbivores.every((h) => h.state === 'sleep')).toBe(true);
    expect(w.sauros.every((s) => s.state === 'sleep')).toBe(true);
  });

  it('a walking dinosaur can creep up on a sleeper; a sprinting one wakes it', () => {
    for (const sprint of [0, 1]) {
      const w = atNight();
      w.sauros = [];
      for (let i = 0; i < 25 * TICK_HZ; i++) step(w, idle);
      const h = w.herbivores[0];
      // Come at it from outside its herd, so the walk isn't through the other sleepers.
      const mates = w.herbivores.filter((k) => k.herd === h.herd);
      const cx = mates.reduce((a, k) => a + k.x, 0) / mates.length, cz = mates.reduce((a, k) => a + k.z, 0) / mates.length;
      const ax = h.x - cx, az = h.z - cz, al = Math.hypot(ax, az) || 1;
      w.player = createDino(SPECIES.herrerasaurus, h.x + (ax / al) * 16, h.z + (az / al) * 16, 0, 1);
      let woke = false;
      for (let i = 0; i < 4 * TICK_HZ && Math.hypot(w.player.x - h.x, w.player.z - h.z) > 3.5; i++) {
        step(w, { moveX: h.x - w.player.x, moveZ: h.z - w.player.z, sprint });
        if (h.state !== 'sleep') woke = true;
      }
      expect(woke).toBe(sprint === 1);
    }
  });

  it('wakes at dawn', () => {
    const w = atNight();
    for (let i = 0; i < 25 * TICK_HZ; i++) step(w, idle);
    w.tick = Math.round((CLOCK.cycle + 60 - CLOCK.start) * TICK_HZ);
    for (let i = 0; i < 2 * TICK_HZ; i++) step(w, idle);
    expect(w.herbivores.some((h) => h.state === 'sleep')).toBe(false);
  });
});
