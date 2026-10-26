// Wind and scent. Scent is an analytic plume per source, carried downwind and
// spreading as it goes. Evaluated per source rather than on a grid: a grid not
// aligned with the wind smears scent crosswind and cuts its range (dlist/E20).

// The wind blows from the north-west toward the south-east, as in the demo.
export const WIND = { x: 0.8 / Math.hypot(0.8, 0.55), z: 0.55 / Math.hypot(0.8, 0.55) };
export const WIND_FROM_YAW = Math.atan2(-WIND.x, -WIND.z); // heading that faces into the wind

const RANGE = 70; // m downwind before a plume is too thin to matter
const UPWIND = 3; // m: right next to the source you smell it whatever the wind

import { AIR } from './weather';

// Concentration at (px, pz) from a source of the given strength at (sx, sz). 0..strength.
export function plume(sx: number, sz: number, strength: number, px: number, pz: number): number {
  const dx = px - sx, dz = pz - sz;
  const along = dx * WIND.x + dz * WIND.z;
  const cross = Math.abs(dx * WIND.z - dz * WIND.x);
  const dist = Math.hypot(dx, dz);
  strength *= AIR.scent; // rain washes scent out of the air
  if (dist < UPWIND) return strength * (1 - dist / (UPWIND * 2));
  if (along <= 0 || along > RANGE) return 0;
  const sigma = 1.5 + 0.18 * along; // the plume widens downwind
  return (strength * Math.exp(-(cross * cross) / (2 * sigma * sigma))) / (1 + along / 15);
}
