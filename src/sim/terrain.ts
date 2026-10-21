import { fbm } from './noise';
import { lerp, smooth } from './math';

// Greybox valley: rolling floor that rises into hills past ~40 m from the centre,
// with the demo's pond carved into it.
export const MAP_RADIUS = 90;
export const WATER_Y = 0;
export const TOO_DEEP = 1.12; // deeper than this and it won't wade further

export interface Pond {
  x: number;
  z: number;
  r: number;
  depth: number;
  flat: number;
}
export const PONDS: Pond[] = [{ x: 15, z: -9, r: 11, depth: 1.7, flat: 11 }];

export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = 0.42 + (fbm(x * 0.03, z * 0.03, 1) - 0.5) * 1.6 + (fbm(x * 0.11, z * 0.11, 5) - 0.5) * 0.35;
  h += smooth(36, 72, r) * (7 + 5 * fbm(x * 0.05, z * 0.05, 9));
  for (const w of PONDS) {
    const d = Math.hypot(x - w.x, z - w.z);
    h = lerp(h, 0.36 + (h - 0.36) * 0.2, 1 - smooth(w.r + 2, w.r + w.flat, d));
    h = lerp(h, WATER_Y - w.depth, 1 - smooth(w.r * 0.2, w.r + 1.5, d));
  }
  return h;
}

export function waterDepthAt(x: number, z: number): number {
  return Math.max(0, WATER_Y - heightAt(x, z));
}


// Rise per metre along a heading, sampled across 1.5 m like the demo.
export function gradeAlong(x: number, z: number, yaw: number): number {
  const hx = Math.sin(yaw) * 0.75, hz = Math.cos(yaw) * 0.75;
  return (heightAt(x + hx, z + hz) - heightAt(x - hx, z - hz)) / 1.5;
}
