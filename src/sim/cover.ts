import { lerp, smooth } from './math';
import { rng } from './rng';
import { heightAt, MUDS, PONDS, POND_Y, SPAWNS } from './terrain';
import { browseAt, TREES } from './flora';
import { groundAt } from './ground';

// Cover: what the plants hide (the owner's understory, made part of the sim so what looks hidden is hidden). The
// fern clumps (flora.ts browseAt) stand about 0.9 m; Dicroidium shrubs about 1 m and cycads about 1.2 m, times their
// scale. An animal is hidden by how thick the cover is and how much of its body the plants stand over: lying down
// it's lower, and moving through it shakes the fronds and gives it away.
export type ShrubKind = 'shrub' | 'cycad';
export interface Shrub {
  kind: ShrubKind;
  x: number;
  z: number;
  s: number;
  ry: number;
}

export const COVER = { fernH: 0.9, shrubH: 1.0, cycadH: 1.2, shrubR: 0.75, cycadR: 0.6 };

function build(): Shrub[] {
  const R = rng(20261026);
  const out: Shrub[] = [];
  const ok = (x: number, z: number, pad: number, gap: number): boolean => {
    const h = heightAt(x, z);
    return h > POND_Y + 0.1 && Math.hypot(x, z) < 88 && !SPAWNS.some((p) => Math.hypot(x - p.x, z - p.z) < 3.5) && groundAt(x, z) <= h + 0.05
      && !MUDS.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + 1.2) && !PONDS.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 0.5)
      && !TREES.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + pad) && !out.some((o) => Math.hypot(o.x - x, o.z - z) < gap);
  };
  const ring = (rMin: number, rMax: number): [number, number] => {
    const a = R() * Math.PI * 2, r = Math.sqrt(lerp(rMin * rMin, rMax * rMax, R()));
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const groves = TREES.filter((t) => t.kind === 'dicroidium');
  // Dicroidium shrubs round the groves, and a few out on their own.
  for (let i = 0, n = 0; i < 1500 && n < 170; i++) {
    let x: number, z: number;
    if (R() < 0.7) {
      const g = groves[Math.floor(R() * groves.length)], a = R() * Math.PI * 2, d = lerp(1.5, 8, R());
      x = g.x + Math.cos(a) * d;
      z = g.z + Math.sin(a) * d;
    } else [x, z] = ring(6, 80);
    if (!ok(x, z, 0.6, 1.2)) continue;
    out.push({ kind: 'shrub', x, z, s: lerp(0.6, 1.2, R()), ry: R() * 6.28 });
    n++;
  }
  // Cycad-like plants, scattered.
  for (let i = 0, n = 0; i < 1200 && n < 80; i++) {
    const [x, z] = ring(6, 82);
    if (!ok(x, z, 1, 2)) continue;
    out.push({ kind: 'cycad', x, z, s: lerp(0.7, 1.4, R()), ry: R() * 6.28 });
    n++;
  }
  return out;
}

export const SHRUBS: Shrub[] = build();

// A coarse grid of the shrubs, for quick lookups.
const CELL = 4;
const grid = new Map<number, Shrub[]>();
const key = (i: number, j: number): number => (i + 512) * 1024 + (j + 512);
for (const s of SHRUBS) {
  const k = key(Math.floor(s.x / CELL), Math.floor(s.z / CELL));
  (grid.get(k) ?? grid.set(k, []).get(k)!).push(s);
}

// Cover at a point: how thick (0..1) and how tall (m).
export function coverAt(x: number, z: number): { density: number; height: number } {
  let density = browseAt(x, z), height = COVER.fernH;
  const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (const s of grid.get(key(i, j)) ?? []) {
        const r = (s.kind === 'shrub' ? COVER.shrubR : COVER.cycadR) * s.s, d = Math.hypot(x - s.x, z - s.z);
        if (d >= r) continue;
        const k = 1 - smooth(0.5 * r, r, d);
        if (k > density) {
          density = k;
          height = (s.kind === 'shrub' ? COVER.shrubH : COVER.cycadH) * s.s;
        }
      }
    }
  }
  return { density, height };
}

// How hidden a body is: 0 in the open .. 1 out of sight. hip: its hip height; rest: 0 standing .. 1 lying down.
export function concealment(x: number, z: number, hip: number, rest: number, speed: number): number {
  const c = coverAt(x, z);
  if (c.density <= 0) return 0;
  const top = hip * (1.15 - 0.6 * rest); // the top of its back
  return c.density * smooth(0.55, 1.0, c.height / top) * (1 - 0.6 * smooth(0.5, 3, speed));
}
