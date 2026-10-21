import { smooth } from './math';
import { atDistance } from './hearing';
import type { SoundEvent } from './events';

// Day and night (D11): 60 minutes of daylight, the sun within 15 degrees of its highest point for 40 of them, dawn
// and dusk 10 minutes each, then 20 minutes of night. An 80-minute cycle. A new world starts mid-morning.
export const CLOCK = {
  cycle: 80 * 60,
  dawn: 10 * 60, // sun rising to 15 degrees under its peak
  high: 40 * 60, // within 15 degrees of its peak
  dusk: 10 * 60,
  night: 20 * 60,
  peak: 78, // degrees: highest sun (low latitude, a long summer day)
  start: 15 * 60, // a new world begins 15 minutes after dawn
};

// Seconds into the current cycle (0 = sunrise).
export const dayTime = (t: number): number => (((t + CLOCK.start) % CLOCK.cycle) + CLOCK.cycle) % CLOCK.cycle;

// Sun elevation in degrees: up through dawn, a gentle arc over the high 40 minutes, down through dusk, and
// down to about 30 degrees below the horizon at midnight.
export function sunElevation(u: number): number {
  const { dawn, high, dusk, night, peak } = CLOCK;
  const top = peak - 15;
  if (u < dawn) return top * Math.sin((u / dawn) * Math.PI / 2);
  if (u < dawn + high) {
    const s = (u - dawn) / high * 2 - 1;
    return peak - 15 * s * s;
  }
  if (u < dawn + high + dusk) return top * Math.cos(((u - dawn - high) / dusk) * Math.PI / 2);
  return -30 * Math.sin(((u - dawn - high - dusk) / night) * Math.PI);
}

// Sun azimuth: 0 rising in the east (+x), pi setting in the west (-x), crossing the north (-z) at noon.
export function sunAzimuth(u: number): number {
  const day = CLOCK.dawn + CLOCK.high + CLOCK.dusk;
  return u < day ? Math.PI * (u / day) : Math.PI * (1 + (u - day) / CLOCK.night);
}

// Direction toward the sun (unit vector; y up).
export function sunDir(u: number): { x: number; y: number; z: number } {
  const e = (sunElevation(u) * Math.PI) / 180, a = sunAzimuth(u);
  return { x: Math.cos(a) * Math.cos(e), y: Math.sin(e), z: -Math.sin(a) * Math.cos(e) };
}

// 1 at full day, 0 at full night, easing through the last and first few degrees of the sun.
export const daylight = (u: number): number => smooth(-8, 6, sunElevation(u));

export const isNight = (u: number): boolean => sunElevation(u) < -2;

// Sleep (D14): the loudest sound reaching (x, z) from anyone else last tick, in dB.
export function loudestAt(heard: SoundEvent[], x: number, z: number, self = -1e9): number {
  let best = -Infinity;
  for (const ev of heard) {
    if (ev.id === self) continue;
    best = Math.max(best, atDistance(ev.level, Math.hypot(ev.x - x, ev.z - z)));
  }
  return best;
}

export const WAKE_DB = 60; // a sleeper wakes to a sound this loud where it lies
export const WAKE_NEAR = 3; // m: or to something brushing right up against it
export const SETTLE = 15; // s calm before a woken sleeper drops off again
