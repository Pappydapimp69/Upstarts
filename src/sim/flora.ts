import { lerp, smooth } from './math';
import { fbm } from './noise';
import { rng } from './rng';
import { heightAt, MUDS, PONDS, SPAWNS, waterDepthAt } from './terrain';

// Trees are solid, so where they stand is part of the sim: a fixed seed, the same
// for every player. Layout and counts follow the Dlist demo's valley.
export type TreeKind = 'conifer' | 'dicroidium';
export interface Tree {
  kind: TreeKind;
  x: number;
  z: number;
  y: number; // base height
  s: number; // scale
  ry: number;
  r: number; // trunk collision radius, m
  extra?: boolean; // added later: the rocks were laid out without it, and it gives way to them (ground.ts)
}

function clearOf(x: number, z: number, pad: number): boolean {
  if (PONDS.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + pad)) return false;
  if (MUDS.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + pad)) return false;
  if (SPAWNS.some((p) => Math.hypot(x - p.x, z - p.z) < 6)) return false;
  return true;
}

function build(): Tree[] {
  const R = rng(20251020);
  const ring = (rMin: number, rMax: number): [number, number] => {
    const a = R() * Math.PI * 2, r = Math.sqrt(lerp(rMin * rMin, rMax * rMax, R()));
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const out: Tree[] = [];
  // Conifers on the outer ring.
  let n = 0;
  for (let i = 0; i < 600 && n < 44; i++) {
    const [x, z] = ring(n < 6 ? 20 : 30, 74);
    if (!clearOf(x, z, 6) || out.some((o) => Math.hypot(o.x - x, o.z - z) < 5)) continue;
    const s = lerp(0.8, 1.35, R());
    out.push({ kind: 'conifer', x, z, y: heightAt(x, z) - 0.2, s, ry: R() * 6.28, r: 0.42 * s + 0.1 });
    n++;
  }
  // Dicroidium: the signature seed fern of the Triassic southern continents.
  n = 0;
  for (let i = 0; i < 600 && n < 22; i++) {
    const [x, z] = ring(12, 46);
    if (!clearOf(x, z, 3.5) || out.some((o) => Math.hypot(o.x - x, o.z - z) < 4)) continue;
    const s = lerp(0.85, 1.3, R());
    out.push({ kind: 'dicroidium', x, z, y: heightAt(x, z) - 0.1, s, ry: R() * 6.28, r: 0.2 * s + 0.1 });
    n++;
  }
  // More (owner: the valley needs more vegetation), drawn from the same stream after the originals so those stay
  // where they were: a belt of conifers round the rim of the valley, and Dicroidium in small groves, as it grew in
  // stands along the Ischigualasto floodplain.
  n = 0;
  for (let i = 0; i < 800 && n < 34; i++) {
    const [x, z] = ring(74, 88);
    if (!clearOf(x, z, 6) || out.some((o) => Math.hypot(o.x - x, o.z - z) < 4.5)) continue;
    const s = lerp(0.75, 1.3, R());
    out.push({ kind: 'conifer', x, z, y: heightAt(x, z) - 0.2, s, ry: R() * 6.28, r: 0.42 * s + 0.1, extra: true });
    n++;
  }
  n = 0;
  const groves = out.filter((o) => o.kind === 'dicroidium');
  for (let i = 0; i < 800 && n < 18; i++) {
    const g = groves[i % groves.length];
    const a = R() * Math.PI * 2, d = lerp(3.5, 7, R()), x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d;
    if (Math.hypot(x, z) > 60 || !clearOf(x, z, 3.5) || out.some((o) => Math.hypot(o.x - x, o.z - z) < 3.5)) continue;
    const s = lerp(0.7, 1.15, R());
    out.push({ kind: 'dicroidium', x, z, y: heightAt(x, z) - 0.1, s, ry: R() * 6.28, r: 0.2 * s + 0.1, extra: true });
    n++;
  }
  return out;
}

export const TREES: Tree[] = build();

// Fern cover for browsing: the same clump field the renderer scatters ferns by. 0 bare .. 1 thick.
export function browseAt(x: number, z: number): number {
  if (waterDepthAt(x, z) > 0 || MUDS.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + 1.5)) return 0;
  return smooth(0.35, 0.6, fbm(x * 0.09, z * 0.09, 71));
}

// Steer round trunks: if the nearest trunk ahead (within `look` m) would be brushed by a body of radius rad going
// this way, turn just enough to pass it on the side it isn't on. Without this a charging animal pressed into a trunk,
// slid along it, and gave up the chase (pushOutOfTrees only stops the overlap).
export function steerRoundTrees(x: number, z: number, yaw: number, rad: number, look: number): number {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let best = Infinity, turn = 0;
  for (const t of TREES) {
    const dx = t.x - x, dz = t.z - z, along = dx * fx + dz * fz;
    if (along <= 0 || along > look || along > best) continue;
    const lat = dx * fz - dz * fx, clear = t.r + rad + 0.3; // lat > 0: the trunk is on the +yaw side
    if (Math.abs(lat) >= clear) continue;
    best = along;
    turn = -(lat >= 0 ? 1 : -1) * Math.min(1.2, (clear - Math.abs(lat)) / Math.max(0.6, along));
  }
  return yaw + turn;
}

// Push a circle of radius rad out of any trunk it overlaps. Returns the corrected position.
export function pushOutOfTrees(x: number, z: number, rad: number): [number, number] {
  for (const t of TREES) {
    const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz), min = t.r + rad;
    if (d < min && d > 1e-6) {
      x = t.x + (dx / d) * min;
      z = t.z + (dz / d) * min;
    }
  }
  return [x, z];
}
