import { fbm } from './noise';
import { lerp, smooth } from './math';

// Greybox valley: rolling floor that rises into hills past ~40 m from the centre,
// with the demo's pond carved into it.
export const MAP_RADIUS = 90;
// The pond's full level, which its basin is carved to, and the water's level now: lower in the dry season. WATER_Y is
// a live binding the world sets each tick from the season (sim/season.ts), so everything reading it follows.
export const POND_Y = 0;
export let WATER_Y = POND_Y;
export function setWaterLevel(y: number): void {
  WATER_Y = y;
}
export const TOO_DEEP = 1.12; // deeper than this and it won't wade further

export interface Pond {
  x: number;
  z: number;
  r: number;
  depth: number;
  flat: number;
}
export const PONDS: Pond[] = [{ x: 15, z: -9, r: 11, depth: 1.7, flat: 11 }];

// The demo's mud pit (floodplain map): a soft hollow whose floor sits under a level of wet mud.
export const MUD_Y = 0.36;
export const MUDS: Pond[] = [{ x: -14, z: 4, r: 6.5, depth: 0.85, flat: 8 }];
export const inMudPit = (x: number, z: number): boolean => MUDS.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + 1.2);

// Where new animals hatch. Kept clear of trees.
export const SPAWNS = [
  { x: 0, z: 15, yaw: Math.PI },
  { x: -18, z: -12, yaw: 0.6 },
  { x: 22, z: 20, yaw: -2.4 },
  { x: -6, z: -30, yaw: 0.2 },
];

export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = 0.42 + (fbm(x * 0.03, z * 0.03, 1) - 0.5) * 1.6 + (fbm(x * 0.11, z * 0.11, 5) - 0.5) * 0.35;
  h += smooth(36, 72, r) * (7 + 5 * fbm(x * 0.05, z * 0.05, 9));
  for (const w of PONDS) {
    const d = Math.hypot(x - w.x, z - w.z);
    h = lerp(h, 0.36 + (h - 0.36) * 0.2, 1 - smooth(w.r + 2, w.r + w.flat, d));
    h = lerp(h, POND_Y - w.depth, 1 - smooth(w.r * 0.2, w.r + 1.5, d));
  }
  for (const m of MUDS) {
    const d = Math.hypot(x - m.x, z - m.z);
    h = lerp(h, 0.42 + (h - 0.42) * 0.2, 1 - smooth(m.r + 1, m.r + m.flat, d));
    h = lerp(h, MUD_Y - m.depth, 1 - smooth(m.r * 0.15, m.r + 0.6, d));
  }
  return h;
}

// Only in a pond: the mud pit's floor is below the water level too, but it holds mud, not water.
export function waterDepthAt(x: number, z: number): number {
  if (!PONDS.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 2)) return 0;
  return Math.max(0, WATER_Y - heightAt(x, z));
}


// Rise per metre along a heading, sampled across 1.5 m like the demo.
export function gradeAlong(x: number, z: number, yaw: number): number {
  const hx = Math.sin(yaw) * 0.75, hz = Math.cos(yaw) * 0.75;
  return (heightAt(x + hx, z + hz) - heightAt(x - hx, z - hz)) / 1.5;
}
