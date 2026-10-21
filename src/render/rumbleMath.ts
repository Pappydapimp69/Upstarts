import { clamp, smooth } from '../sim/math';

// Controller rumble from a footfall. Pure math so it can be tested without a gamepad.
//  - Weight: heavier animals hit harder and are felt further away.
//  - Speed: a sprint lands harder than a walk.
//  - Direction: a step to the left drives the left side (left motor / left trigger), one to the
//    right the right side; straight ahead or behind drives both.
export interface Footfall {
  mass: number; // kg
  speed: number; // m/s
  dist: number; // m from the player (0 for its own feet)
  pan: number; // -1 left .. 1 right, relative to the camera
  quiet?: number; // multiplier for a deliberately soft step (stalking), default 1
}

export interface Rumble {
  strong: number; // low-frequency (left, heavy) motor, 0..1
  weak: number; // high-frequency (right, light) motor, 0..1
  left: number; // left trigger, 0..1
  right: number; // right trigger
}

export const ZERO: Rumble = { strong: 0, weak: 0, left: 0, right: 0 };

// How far a footfall of this mass can be felt, m (an adult Herrerasaurus about 18 m).
export const feltRange = (mass: number): number => 4 + 14 * Math.sqrt(mass / 350);

export function footfallRumble(f: Footfall): Rumble {
  const m = Math.max(f.mass, 0.1);
  const heavy = smooth(5, 650, m); // how much of it is the low thud
  const R = feltRange(m);
  if (f.dist > 3 * R) return ZERO;
  const impact = Math.pow(m / 350, 0.6) * (0.35 + 0.65 * smooth(0, 7, f.speed)) * (f.quiet ?? 1);
  const fall = 1 / (1 + (f.dist / R) ** 2);
  const I = clamp(impact * fall * (f.dist === 0 ? 0.55 : 0.8), 0, 1);
  const p = clamp(f.pan, -1, 1);
  return {
    strong: clamp(I * (0.3 + 0.7 * heavy) * (1 - 0.7 * Math.max(0, p)), 0, 1),
    weak: clamp(I * (0.25 + 0.45 * smooth(0, 7, f.speed)) * (1 - 0.7 * Math.max(0, -p)), 0, 1),
    left: clamp(I * Math.max(0, -p) * 1.2, 0, 1),
    right: clamp(I * Math.max(0, p) * 1.2, 0, 1),
  };
}

// Several footfalls in one frame: take the strongest per channel, so a herd doesn't saturate.
export function mix(a: Rumble, b: Rumble): Rumble {
  return { strong: Math.max(a.strong, b.strong), weak: Math.max(a.weak, b.weak), left: Math.max(a.left, b.left), right: Math.max(a.right, b.right) };
}
