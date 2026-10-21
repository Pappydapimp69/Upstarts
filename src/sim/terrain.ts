import { fbm } from './noise';
import { smooth } from './math';

// Greybox valley: rolling floor that rises into hills past ~40 m from the centre.
// Same shape as the demo's valley, minus water and mud (those arrive with M2).
export const MAP_RADIUS = 90;

export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = 0.42 + (fbm(x * 0.03, z * 0.03, 1) - 0.5) * 1.6 + (fbm(x * 0.11, z * 0.11, 5) - 0.5) * 0.35;
  h += smooth(36, 72, r) * (7 + 5 * fbm(x * 0.05, z * 0.05, 9));
  return h;
}

// Rise per metre along a heading, sampled across 1.5 m like the demo.
export function gradeAlong(x: number, z: number, yaw: number): number {
  const hx = Math.sin(yaw) * 0.75, hz = Math.cos(yaw) * 0.75;
  return (heightAt(x + hx, z + hz) - heightAt(x - hx, z - hz)) / 1.5;
}
