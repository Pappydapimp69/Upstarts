import { describe, expect, it } from 'vitest';
import { createDino, stepDino, IDLE, type Command } from '../src/sim/dino';
import { SPECIES } from '../src/sim/species';
import { TICK_DT, TICK_HZ } from '../src/sim/world';

const at = (growth = 1) => createDino(SPECIES.herrerasaurus, 0, 15, 0, growth);

function peak(d: ReturnType<typeof at>, cmd: Command): { peak: number; landed: number } {
  let peak = 0, landed = 0;
  stepDino(d, { ...cmd, jump: true }, TICK_DT);
  for (let i = 0; i < 3 * TICK_HZ && (d.jump || i === 0); i++) {
    stepDino(d, cmd, TICK_DT);
    peak = Math.max(peak, d.air);
    landed = Math.max(landed, d.jumpLanded);
  }
  return { peak, landed };
}

describe('jump', () => {
  it('an adult hops about 0.4 m standing and leaps higher running, then lands', () => {
    const stand = peak(at(), IDLE);
    expect(stand.peak).toBeGreaterThan(0.3);
    expect(stand.peak).toBeLessThan(0.5);
    expect(stand.landed).toBeGreaterThan(0);
    const d = at();
    const run: Command = { moveX: 0, moveZ: 1, sprint: 0 };
    for (let i = 0; i < 2 * TICK_HZ; i++) stepDino(d, run, TICK_DT);
    const r = peak(d, run);
    expect(r.peak).toBeGreaterThan(stand.peak + 0.15);
    expect(d.air).toBe(0);
  });

  it('costs stamina, and a spent animal can not jump', () => {
    const d = at();
    stepDino(d, { ...IDLE, jump: true }, TICK_DT);
    expect(d.stamina).toBeLessThan(0.9);
    const t = at();
    t.stamina = 0.02;
    stepDino(t, { ...IDLE, jump: true }, TICK_DT);
    expect(t.jump).toBeNull();
  });

  it('a hatchling jumps lower than an adult', () => {
    expect(peak(at(0), IDLE).peak).toBeLessThan(peak(at(), IDLE).peak);
  });
});

describe('rest', () => {
  it('lying down recovers stamina about ten times faster than standing, and blocks moving', () => {
    const a = at(), b = at();
    a.stamina = b.stamina = 0.2;
    for (let i = 0; i < 2 * TICK_HZ; i++) {
      stepDino(a, { ...IDLE, rest: true }, TICK_DT);
      stepDino(b, IDLE, TICK_DT);
    }
    expect(a.rest).toBeGreaterThan(0.95);
    a.stamina = b.stamina = 0.2;
    for (let i = 0; i < TICK_HZ; i++) {
      stepDino(a, { moveX: 0, moveZ: 1, sprint: 0, rest: true }, TICK_DT);
      stepDino(b, IDLE, TICK_DT);
    }
    expect(a.stamina - 0.2).toBeGreaterThan(8 * (b.stamina - 0.2));
    expect(a.speed).toBe(0);
    for (let i = 0; i < TICK_HZ; i++) stepDino(a, IDLE, TICK_DT);
    expect(a.resting).toBe(false);
    expect(a.rest).toBeLessThan(0.1);
  });
});
