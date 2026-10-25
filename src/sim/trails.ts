// Trails on the ground (the Dlist tutorial's scent marks, now for the whole game). An animal on the move lays a scent
// mark every TRAIL.scentEvery metres: travel-gated, so a herd standing about doesn't pile them up. A bleeding animal
// drips blood on a timer instead, so a wounded animal that stops still leaves blood where it stands (Brain: a
// stationary emitter on a travel-gated field deposits nothing). Marks fade. Sniffing with the nose down reads them:
// what laid them, how fresh, and which way it went (from its older marks to its newer ones).
export const TRAIL = {
  scentEvery: 1.6, // m travelled per scent mark
  scentLife: 180, // s until a scent mark is gone
  bloodEvery: 0.5, // s between blood drops while bleeding
  bloodLife: 360, // s: blood lasts longer than scent
  max: 1500, // marks kept (oldest go first)
  nose: 2.5, // m around the snout a sniff picks marks up from
  follow: 10, // m: the same animal's marks this close are read together for its heading
};

export type MarkKind = 'scent' | 'blood';
export type Layer = 'Hyperodapedon' | 'Exaeretodon' | 'cynodont' | 'Saurosuchus' | 'you';

export interface Mark {
  x: number;
  z: number;
  t: number; // world time laid, s
  kind: MarkKind;
  who: number; // entity id that laid it
  what: Layer;
}

export interface Trails {
  marks: Mark[];
  odo: Record<number, { x: number; z: number; drip: number }>; // per animal: where its last scent mark was, blood timer
}

// One animal this tick: where it is, whether it leaves scent, whether it is bleeding.
export interface TrailLayer {
  id: number;
  x: number;
  z: number;
  what: Layer;
  scent: boolean;
  bleeding: boolean;
}

export const newTrails = (): Trails => ({ marks: [], odo: {} });

const lifeOf = (m: Mark): number => (m.kind === 'blood' ? TRAIL.bloodLife : TRAIL.scentLife);

export function layTrails(tr: Trails, now: number, dt: number, animals: TrailLayer[]): void {
  for (const a of animals) {
    let o = tr.odo[a.id];
    if (!o) o = tr.odo[a.id] = { x: a.x, z: a.z, drip: 0 };
    if (a.scent && Math.hypot(a.x - o.x, a.z - o.z) >= TRAIL.scentEvery) {
      tr.marks.push({ x: a.x, z: a.z, t: now, kind: 'scent', who: a.id, what: a.what });
      o.x = a.x;
      o.z = a.z;
    }
    if (a.bleeding) {
      o.drip += dt;
      if (o.drip >= TRAIL.bloodEvery) {
        o.drip -= TRAIL.bloodEvery;
        // Drops land a little either side of the body (spread from the time and id: deterministic, no RNG draw).
        const k = now * 7.31 + a.id * 1.7;
        tr.marks.push({ x: a.x + 0.18 * Math.sin(k), z: a.z + 0.18 * Math.cos(k * 1.3), t: now, kind: 'blood', who: a.id, what: a.what });
      }
    } else o.drip = 0;
  }
  if (tr.marks.length && now - tr.marks[0].t > TRAIL.scentLife) tr.marks = tr.marks.filter((m) => now - m.t < lifeOf(m));
  if (tr.marks.length > TRAIL.max) tr.marks.splice(0, tr.marks.length - TRAIL.max);
}

// What the nose picks up at (x, z): the freshest mark in reach (blood before scent at the same age), and the way
// that animal went if its other marks nearby show it. yaw is null for a lone mark or a pool from a standing animal.
export interface TrailRead {
  kind: MarkKind;
  what: Layer;
  who: number;
  age: number; // s
  strength: number; // 1 fresh .. 0 gone
  yaw: number | null;
}

export function readTrail(tr: Trails, now: number, x: number, z: number, self = 0): TrailRead | null {
  let best: Mark | null = null, bestS = 0;
  for (const m of tr.marks) {
    if (m.who === self || Math.hypot(m.x - x, m.z - z) > TRAIL.nose) continue;
    const s = (1 - (now - m.t) / lifeOf(m)) * (m.kind === 'blood' ? 1.5 : 1);
    if (s > bestS) {
      best = m;
      bestS = s;
    }
  }
  if (!best) return null;
  const b = best;
  // Its trail: the same animal's marks of the same kind around here, oldest to newest.
  const own = tr.marks.filter((m) => m.who === b.who && m.kind === b.kind && Math.hypot(m.x - b.x, m.z - b.z) < TRAIL.follow);
  let yaw: number | null = null;
  if (own.length >= 2) {
    const first = own[0], last = own[own.length - 1];
    if (Math.hypot(last.x - first.x, last.z - first.z) > 0.8) yaw = Math.atan2(last.x - first.x, last.z - first.z);
  }
  return { kind: b.kind, what: b.what, who: b.who, age: now - b.t, strength: Math.min(1, bestS), yaw };
}
