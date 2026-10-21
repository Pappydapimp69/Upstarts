import { describe, expect, it } from 'vitest';
import { addStep, decay, emptyBed, groundFeel, mixRumble, ownStep } from '../src/render/rumbleMath';

describe('ground bed (Dlist model)', () => {
  it('an adult Herrerasaurus walking 2 m away is felt at 0.35', () => {
    expect(groundFeel(350, 3.4, 2)).toBeCloseTo(0.35, 5);
  });

  it('heavier and faster animals are felt more', () => {
    expect(groundFeel(650, 3, 10)).toBeGreaterThan(groundFeel(80, 3, 10));
    expect(groundFeel(80, 4.8, 10)).toBeGreaterThan(groundFeel(80, 1, 10));
  });

  it('fades with distance', () => {
    expect(groundFeel(650, 3, 40)).toBeLessThan(groundFeel(650, 3, 10));
  });

  it('a stampeding herd adds up instead of taking the loudest step', () => {
    const one = emptyBed(), herd = emptyBed();
    addStep(one, 80, 4.8, 13, 0);
    for (let i = 0; i < 7; i++) addStep(herd, 80, 4.8, 13, 0);
    expect(mixRumble(herd, []).strong).toBeGreaterThan(mixRumble(one, []).strong * 2);
  });

  it('dies away in about 0.15 s', () => {
    const b = emptyBed();
    addStep(b, 650, 3, 5, 0);
    const g0 = Math.sqrt(b.g2);
    decay(b, 0.15);
    expect(Math.sqrt(b.g2) / g0).toBeCloseTo(Math.exp(-0.5), 3);
  });

  it('keeps the direction for the triggers', () => {
    const b = emptyBed();
    addStep(b, 650, 3, 6, -1);
    const r = mixRumble(b, []);
    expect(r.left).toBeGreaterThan(0);
    expect(r.right).toBe(0);
  });
});

describe('own footsteps', () => {
  it('never drop below what a motor can feel', () => {
    expect(ownStep(4, 0.5, 3.5).weak).toBeGreaterThanOrEqual(0.16);
  });
  it('a sprinting adult hits the deep motor harder than a walking hatchling', () => {
    expect(ownStep(350, 7.4, 7.4).strong).toBeGreaterThan(ownStep(4, 1, 3.5).strong * 3);
  });
  it('pulses mix with the bed in power', () => {
    const b = emptyBed();
    addStep(b, 650, 3, 5, 0);
    const p = ownStep(350, 7, 7.4);
    const r = mixRumble(b, [p]);
    expect(r.strong).toBeGreaterThan(Math.max(Math.sqrt(b.g2), p.strong));
  });
});
