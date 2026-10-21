import { clamp, smooth } from '../sim/math';

// Controller haptics, ported from the Dlist demo. Pure math so it can be tested without a gamepad.
//
// Ground bed: every footfall nearby adds energy, so many animals add up into one rumble (a herd stampeding
// past) and it dies away in about 0.15 s. Ground (Rayleigh) waves spread as 1/sqrt(r) and soil damps them
// about 2% per metre; low frequency, so the bed goes mostly to the heavy motor. Felt amplitude 0.35 is an
// adult Herrerasaurus walking step 2 m away. Direction: the bed also keeps a left and a right share (from
// where each step is relative to the camera) for the triggers.
//
// Own feet: a tap on every footfall. Controller motors barely register below about 0.15, so even a
// hatchling's light step stays above that; weight and speed add the deep motor.

export const BED_TAU = 0.15; // s

export function groundFeel(mass: number, speed: number, dist: number): number {
  const r = Math.max(2, dist), e = (mass * speed * speed) / (350 * 3.4 * 3.4);
  return 0.35 * Math.sqrt(e) * Math.sqrt(2 / r) * Math.exp(-0.02 * (r - 2));
}

export interface Pulse {
  weak: number;
  strong: number;
}

// The player's own footfall. intensity 0..1 grows with weight and speed.
export function ownStep(mass: number, speed: number, topSpeed: number): Pulse {
  const intensity = clamp(Math.pow(mass / 350, 0.25) * (0.3 + 0.7 * smooth(0, topSpeed, speed)), 0, 1);
  const run = speed > 0.6 * topSpeed ? 1 : 0.35;
  return { weak: Math.max(0.16, 0.14 + 0.2 * intensity), strong: (0.04 + 0.24 * intensity) * run };
}

export interface Bed {
  g2: number; // energy, all directions
  l2: number; // energy from the left
  r2: number; // energy from the right
}

export const emptyBed = (): Bed => ({ g2: 0, l2: 0, r2: 0 });

export function decay(b: Bed, dt: number): void {
  const k = Math.exp(-dt / BED_TAU);
  b.g2 *= k;
  b.l2 *= k;
  b.r2 *= k;
}

// pan: -1 left .. 1 right, relative to the camera. quiet scales the step (a stalking predator steps softly).
export function addStep(b: Bed, mass: number, speed: number, dist: number, pan: number, quiet = 1): void {
  const a = groundFeel(mass, speed, dist) * quiet, e = a * a;
  b.g2 += e;
  b.l2 += e * Math.max(0, -pan);
  b.r2 += e * Math.max(0, pan);
}

export interface Rumble {
  strong: number; // low-frequency (heavy) motor
  weak: number; // high-frequency (light) motor
  left: number; // left trigger
  right: number; // right trigger
}

// Mix the bed with the player's live pulses. Everything adds in power, so sources combine.
export function mixRumble(b: Bed, pulses: Pulse[]): Rumble {
  const g = Math.min(1, Math.sqrt(b.g2));
  let w2 = (0.3 * g) ** 2, s2 = g * g;
  for (const p of pulses) {
    w2 += p.weak * p.weak;
    s2 += p.strong * p.strong;
  }
  return {
    strong: Math.min(1, Math.sqrt(s2)),
    weak: Math.min(1, Math.sqrt(w2)),
    left: Math.min(1, Math.sqrt(b.l2) * 1.2),
    right: Math.min(1, Math.sqrt(b.r2) * 1.2),
  };
}
