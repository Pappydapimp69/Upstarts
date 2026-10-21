// Rocks and logs as real footing (the Dlist demo's obstacle course and valley, docs/PORTING.md "Ground the movement
// stands on"). The demo built them as meshes and read foot height off the triangles; here they are analytic shapes in
// the sim, so feet, collision and stumbles are decided by the sim and the renderer builds its meshes from the same
// function (the sim must run headless, D2). A fixed seed: the same rocks for every player.
import { clamp, lerp } from './math';
import { rng } from './rng';
import { heightAt, inMudPit, MUD_Y, MUDS, PONDS, SPAWNS, WATER_Y } from './terrain';
import { TREES } from './flora';

// Tiers are fractions of the animal's own hip height (demo TIER): a pebble it walks over, a step-up to about knee
// height, and above that something to jump onto or go round. A hatchling meets walls where an adult sees steps.
export const TIER = { pebble: 0.08, step: 0.55, scramble: 0.3 };

export interface Rock {
  id: number;
  log: boolean;
  x: number;
  z: number;
  yaw: number;
  r: number; // bounding radius of the footprint, m
  ground: number; // terrain height at the centre
  top: number; // highest point, absolute
  h: number; // top above the ground
  // A rock: an elliptical dome, base sunk below the ground, sides set by k (lower is steeper), lumpy in plan.
  rx: number;
  rz: number;
  base: number;
  k: number;
  lump: number;
  seed: number;
  flat: number | null; // a flat-topped block (a mesa or slab) is cut off here
  tx: number; // top tilt, rise per metre along local x and z
  tz: number;
  // A log: a cylinder lying along its yaw.
  len: number;
  rad: number;
  cy: number;
}

// Height of one rock's surface at (x, z), or -Infinity off it. edgeOut receives 0 at the centre, 1 at the rim.
const edge = { v: 0 };
export function rockY(k: Rock, x: number, z: number, edgeOut = edge): number {
  const dx = x - k.x, dz = z - k.z;
  if (dx * dx + dz * dz > k.r * k.r) return -Infinity;
  const c = Math.cos(k.yaw), s = Math.sin(k.yaw);
  const u = dx * c - dz * s, w = dx * s + dz * c;
  if (k.log) {
    if (Math.abs(u) > k.len / 2 || Math.abs(w) >= k.rad) return -Infinity;
    edgeOut.v = Math.abs(w) / k.rad;
    return k.cy + Math.sqrt(k.rad * k.rad - w * w);
  }
  const a = Math.atan2(w, u);
  const lump = 1 + k.lump * (0.5 * Math.sin(3 * a + k.seed) + 0.3 * Math.sin(5 * a + 2 * k.seed) + 0.2 * Math.sin(9 * a + 3 * k.seed));
  const q = ((u / k.rx) ** 2 + (w / k.rz) ** 2) / (lump * lump);
  if (q >= 1) return -Infinity;
  edgeOut.v = Math.sqrt(q);
  let y = k.base + (k.top - k.base) * Math.pow(1 - q, k.k) + k.tx * u + k.tz * w;
  if (k.flat !== null) y = Math.min(y, k.flat + k.tx * u + k.tz * w);
  return y;
}

function build(): Rock[] {
  const R = rng(20251021);
  const out: Rock[] = [];
  const ring = (rMin: number, rMax: number): [number, number] => {
    const a = R() * Math.PI * 2, r = Math.sqrt(lerp(rMin * rMin, rMax * rMax, R()));
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const clearOf = (x: number, z: number, pad: number): boolean =>
    !PONDS.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 2 + pad)
    && !MUDS.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + 1 + pad)
    && !SPAWNS.some((p) => Math.hypot(x - p.x, z - p.z) < 5 + pad)
    && !TREES.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 1 + pad)
    && !out.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 0.6 + pad);
  const rock = (x: number, z: number, rx: number, rz: number, h: number, o: { k?: number; flat?: boolean; tilt?: number; sink?: number } = {}): void => {
    const g = heightAt(x, z), sink = o.sink ?? 0.25 * h, top = g + h, tilt = o.tilt ?? (o.flat ? 0.06 : 0.15);
    const lump = o.flat ? 0.05 : h > 1 ? 0.22 : 0.14;
    out.push({
      id: out.length, log: false, x, z, yaw: R() * Math.PI * 2, r: Math.max(rx, rz) * (1 + lump), ground: g, top, h,
      rx, rz, base: g - sink, k: o.k ?? (o.flat ? 0.18 : 0.45), lump, seed: R() * 6.28, flat: o.flat ? top : null,
      tx: (R() - 0.5) * tilt, tz: (R() - 0.5) * tilt, len: 0, rad: 0, cy: 0,
    });
  };
  const log = (x: number, z: number, yaw: number, len: number, rad: number, sink = 0.25): void => {
    const g = heightAt(x, z), cy = g + rad * (1 - 2 * sink), top = cy + rad;
    out.push({
      id: out.length, log: true, x, z, yaw, r: len / 2 + rad, ground: g, top, h: top - g,
      rx: 0, rz: 0, base: 0, k: 0, lump: 0, seed: 0, flat: null, tx: 0, tz: 0, len, rad, cy,
    });
  };

  // Near the first nest, ahead of where a hatchling faces (SPAWNS[0] faces -z): low slabs to try step-ups on, a
  // ledge about 0.85 m high to jump onto, and a taller rock beside it you can only reach from the ledge (demo valley).
  const s0 = SPAWNS[0];
  for (const [ox, oz, rad, h] of [[-1.6, 7.6, 0.95, 0.18], [1.9, 5.4, 0.8, 0.22], [3.9, 8.8, 1.05, 0.15], [-4.4, 10.6, 0.75, 0.13], [0.8, 10.4, 0.55, 0.11], [-3.8, 4.4, 1.1, 0.28]]) {
    rock(s0.x - ox, s0.z - oz, rad, rad * lerp(0.75, 1, R()), h, { flat: true });
  }
  rock(s0.x - 7.5, s0.z - 8.5, 1.8, 1.5, 0.85, { flat: true, k: 0.12, tilt: 0.04 });
  rock(s0.x - 9.6, s0.z - 6.2, 1.9, 1.7, 1.5, { flat: true, k: 0.12, tilt: 0.04 });

  // Scattered over the floor: pebbles and step-up stones, and a few real boulders taller than an adult's hips.
  for (let i = 0, n = 0; i < 600 && n < 40; i++) {
    const [x, z] = ring(8, 56);
    const big = R() < 0.25;
    const rad = big ? lerp(1.6, 2.6, R()) : lerp(0.18, 0.7, R());
    if (!clearOf(x, z, big ? 1.5 : 0.3)) continue;
    rock(x, z, rad, rad * lerp(0.7, 1, R()), big ? lerp(1.4, 2.4, R()) : rad * lerp(0.35, 0.6, R()));
    n++;
  }

  // Fallen trunks, getting thicker: a thin one is stepped over, a thick one has to be jumped (demo course section 2).
  const rads = [0.14, 0.2, 0.27, 0.36, 0.45];
  for (let i = 0, n = 0; i < 300 && n < rads.length; i++) {
    const [x, z] = ring(14, 44);
    if (!clearOf(x, z, 3)) continue;
    log(x, z, R() * Math.PI * 2, lerp(4.5, 6.5, R()), rads[n]);
    n++;
  }
  // A log half sunk at the far edge of the mud pit.
  const m = MUDS[0];
  log(m.x + m.r * 0.75, m.z - m.r * 0.3, 0.4, 4.5, 0.2, 0.45);
  return out;
}

export const ROCKS: Rock[] = build();

// A coarse grid, so a ground query only looks at the rocks near it.
const CELL = 6;
const grid = new Map<number, Rock[]>();
const key = (i: number, j: number): number => (i + 512) * 1024 + (j + 512);
for (const k of ROCKS) {
  for (let i = Math.floor((k.x - k.r) / CELL); i <= Math.floor((k.x + k.r) / CELL); i++) {
    for (let j = Math.floor((k.z - k.r) / CELL); j <= Math.floor((k.z + k.r) / CELL); j++) {
      const c = grid.get(key(i, j));
      if (c) c.push(k);
      else grid.set(key(i, j), [k]);
    }
  }
}
export const rocksNear = (x: number, z: number): Rock[] => grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? [];

export interface GroundInfo {
  y: number; // footing height: terrain, or the rock or log on it
  rock: number; // id of the rock or log underfoot, -1 for open ground
  edge: number; // 0 at a rock's centre, 1 at its rim
}
const GI: GroundInfo = { y: 0, rock: -1, edge: 0 };
// Shared result object: copy what you need before the next call.
export function groundInfo(x: number, z: number): GroundInfo {
  let y = heightAt(x, z), id = -1, e = 0;
  for (const k of rocksNear(x, z)) {
    const ry = rockY(k, x, z, edge);
    if (ry > y) {
      y = ry;
      id = k.id;
      e = edge.v;
    }
  }
  GI.y = y;
  GI.rock = id;
  GI.edge = e;
  return GI;
}
export const groundAt = (x: number, z: number): number => groundInfo(x, z).y;

// Depths measured from the real footing, so a rock or log standing out of the water or mud is dry.
export const mudDepthAt = (x: number, z: number): number => (inMudPit(x, z) ? Math.max(0, MUD_Y - groundAt(x, z)) : 0);

export type SurfaceKind = 'water' | 'mud' | 'rock' | 'log' | 'dirt';
// What a foot comes down on at (x, z).
export function surfaceAt(x: number, z: number): SurfaceKind {
  const g = groundInfo(x, z);
  if (g.y < WATER_Y && PONDS.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 2)) return 'water';
  if (g.y < MUD_Y && inMudPit(x, z)) return 'mud';
  return g.rock < 0 ? 'dirt' : ROCKS[g.rock].log ? 'log' : 'rock';
}

export const tierOf = (h: number, hip: number): 0 | 1 | 2 => (h < TIER.pebble * hip ? 0 : h < TIER.step * hip ? 1 : 2);

// Keep a non-player animal (radius rad, hip height hip) out of anything too tall for it to step onto, the way
// pushOutOfTrees keeps it out of trunks. The footprint is taken where the rock stands a step above the ground.
export function pushOutOfRocks(x: number, z: number, rad: number, hip: number): [number, number] {
  for (const k of rocksNear(x, z)) {
    if (k.h < TIER.step * hip) continue;
    if (k.log) {
      const c = Math.cos(k.yaw), s = Math.sin(k.yaw), dx = x - k.x, dz = z - k.z;
      const u = clamp(dx * c - dz * s, -k.len / 2, k.len / 2);
      const px = k.x + u * c, pz = k.z - u * s; // nearest point on the axis
      const ex = x - px, ez = z - pz, d = Math.hypot(ex, ez), min = k.rad + rad;
      if (d < min && d > 1e-6) {
        x = px + (ex / d) * min;
        z = pz + (ez / d) * min;
      }
      continue;
    }
    // The dome is y = base + (top - base)(1 - q)^k, so it stands a step high where 1 - q = t^(1/k).
    const t = clamp((k.ground + TIER.step * hip - k.base) / (k.top - k.base), 0, 1);
    const reach = Math.sqrt(1 - Math.pow(t, 1 / k.k)) * (k.rx + k.rz) / 2;
    const dx = x - k.x, dz = z - k.z, d = Math.hypot(dx, dz), min = reach + rad;
    if (d < min && d > 1e-6) {
      x = k.x + (dx / d) * min;
      z = k.z + (dz / d) * min;
    }
  }
  return [x, z];
}
