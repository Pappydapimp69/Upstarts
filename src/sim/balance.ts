// Slips, stumbles and trips (the Dlist demo's stability(), docs/PORTING.md "Stability"). Physics, not a dice roll:
// three things can go wrong as a foot comes down, each measured from what that foot did.
//  trip  - the toe struck a rock face during the swing (the swing's arc against the ground it passed over)
//  slip  - the friction the foot needs (leg angle at touchdown, ground tilt, turning, landing impact) beats the grip
//          of that surface, and wet or muddy feet grip far less
//  roll  - too little of the foot is supported (landing half off an edge)
// The demo read the feet off its animated rig; here the sim places them itself from the gait, so the outcome is the
// sim's call and the same inputs give the same result. Results still vary because foot placement and gait phase do.
import { clamp, lerp, smooth } from './math';
import { groundAt, groundInfo, ROCKS, tierOf } from './ground';
import { mudFeet, mudFeetDry, wetFeet } from './coat';
import type { Dino } from './dino';

export type FallLevel = 'slip' | 'stumble' | 'trip';

export interface Fall {
  level: FallLevel; // slip: the foot skids and it catches itself; stumble: a big lurch; trip: it goes down
  kind: 'trip' | 'stumble'; // what caused it: a toe catching, or the footing giving way
  down: boolean;
  t: number;
  dur: number; // s for a slip or stumble; a trip's total is tT + tL + tR
  side: number; // +1 the right foot, -1 the left
  sev: number; // 0.5 .. 1.5
  tT: number; // trip: s to topple onto its side
  tL: number; // s lying there
  tR: number; // s rolling back and pushing up
  thud: boolean; // the body has hit the ground
}

// Falls scale with the animal: a bigger body topples and recovers more slowly (time ~ sqrt(size)), a heavier one
// lands harder and lies longer, a lighter one is quicker and twitchier (demo BODY).
export function bodyScale(d: Dino): { ts: number; mk: number; agile: number } {
  return {
    ts: Math.sqrt(d.body.hip / 1.15) * Math.pow(d.body.mass / 350, 0.1),
    mk: Math.cbrt(d.body.mass / 350),
    agile: Math.pow(350 / d.body.mass, 0.15),
  };
}

export interface Check {
  trip: number;
  slip: number;
  roll: number;
  score: number;
  outcome: 'ok' | 'stagger' | 'down';
}

// One foot coming down at (fx, fz), `side` +1 right / -1 left, having swung from (lx, lz). along: how far ahead of
// the hip it lands (m); impact: a landing's hardness (0 on a normal step); sprinting: a hard sprint is the only way
// to go down, and only on tired legs.
export function footCheck(d: Dino, fx: number, fz: number, lx: number, lz: number, along: number, impact: number, sprinting: boolean): Check | null {
  const hip = d.body.hip, sz = hip / 1.15, v = d.speed, massK = Math.pow(d.body.mass / 350, 0.25);
  const g = groundInfo(fx, fz), rock = g.rock, gy = g.y;
  const big = (id: number): boolean => id >= 0 && tierOf(ROCKS[id].h, hip) >= 1;
  const lift = groundInfo(lx, lz).rock;
  // Trip: sweep the toe along its arc from lift-off to touchdown; anything it would pass through, it catches on.
  // Tired legs lift lower and scuff more.
  const ly = groundAt(lx, lz), clear = Math.min(0.42, 0.12 + 0.045 * (v / Math.sqrt(sz))) * sz * lerp(0.7, 1, smooth(0, 0.6, d.stamina));
  let catchD = 0, onRock = big(rock) || big(lift);
  for (let k = 1; k <= 6; k++) {
    const s = k / 7, x = lerp(lx, fx, s), z = lerp(lz, fz, s), info = groundInfo(x, z);
    if (!big(info.rock)) continue;
    onRock = true;
    const toe = lerp(ly, gy, s) + clear * Math.sin(Math.PI * s);
    if (s < 0.85 && info.y > toe + 0.02 * sz) catchD = Math.max(catchD, info.y - toe);
  }
  const wet = wetFeet(d.coat), mud = mudFeet(d.coat);
  const turning = (0.6 * Math.abs(v * d.yawRate)) / 9.81; // sideways grip a turn needs, eased by leaning into it
  // Plain dry ground is checked only when something could go wrong: rocks, slick feet, or a hard turn at speed.
  if (!onRock && !impact && wet < 0.1 && mud < 0.1 && turning < 0.5) return null;
  // Four legs (owner): a toe that catches doesn't trip it, and it never goes down; the footing can still give.
  const quad = d.species.plan === 'quad';
  const trip = catchD > 0 && !quad ? smooth(0.02, 0.1, catchD / sz) * (v / 4) * massK : 0;
  const legT = (Math.abs(along) / Math.max(0.3 * sz, hip)) * smooth(0.3, 2.0, v); // a slow step loads the foot almost straight down
  const fwX = Math.sin(d.yaw), fwZ = Math.cos(d.yaw), sx = Math.cos(d.yaw), szz = -Math.sin(d.yaw);
  const ga = (dx: number, dz: number): number => groundAt(fx + dx, fz + dz);
  const e1 = 0.12 * sz, e2 = 0.08 * sz;
  const sAl = (ga(fwX * e1, fwZ * e1) - ga(-fwX * e1, -fwZ * e1)) / (2 * e1), sLat = (ga(sx * e2, szz * e2) - ga(-sx * e2, -szz * e2)) / (2 * e2);
  // Braking (foot ahead of the hip) is worse on ground falling away ahead; pushing off, on ground falling away behind.
  const demand = Math.max(0, legT - Math.sign(along) * sAl) + 0.6 * Math.abs(sLat) + 0.25 * impact + turning;
  const stone = rock >= 0;
  let mu = stone ? 0.95 : 1.05; // dry sandstone and packed dirt, with claws for grip
  mu *= lerp(1, stone ? 0.5 : 0.75, wet); // water on stone is slick
  mu *= lerp(1, lerp(0.45, 0.8, mudFeetDry(d.coat)), mud); // wet mud is the worst, a dry crust less so
  const slip = (Math.max(0, demand - mu) / mu) * (0.6 + 0.4 * massK);
  // Roll: of five points under the foot, fewer than three supported.
  let sup = 0;
  for (const [ox, oz] of [[0, 0], [0, 0.14], [0, -0.08], [0.06, 0.04], [-0.06, 0.04]]) {
    if (Math.abs(ga((sx * ox + fwX * oz) * sz, (szz * ox + fwZ * oz) * sz) - gy) < 0.025 * sz) sup++;
  }
  const roll = onRock ? (Math.max(0, 0.6 - sup / 5) / 0.6) * (0.35 + v / 5) : 0;
  const cap = lerp(0.65, 1, smooth(0, 0.8, d.stamina)); // fresher legs recover more
  const score = Math.max(trip, slip, roll) / cap;
  // Only a sprint puts it down, and only on tired legs (below half stamina); it stays rare.
  const downAt = quad || !sprinting || d.stamina >= 0.5 ? Infinity : lerp(2.1, 3.5, smooth(0.1, 0.5, d.stamina));
  return { trip, slip, roll, score, outcome: score >= downAt ? 'down' : score >= 0.55 ? 'stagger' : 'ok' };
}

// Three escalating outcomes: a slip (score 0.55 to 0.9), a stumble (above 0.9), a trip (it goes down).
export function startFall(d: Dino, c: Check, side: number): Fall {
  const B = bodyScale(d), score = c.score + 0.1, down = c.outcome === 'down';
  const k = clamp((score - 0.5) * 2, 0, 1), level: FallLevel = down ? 'trip' : score < 0.9 ? 'slip' : 'stumble';
  const kind = c.trip >= Math.max(c.slip, c.roll) ? 'trip' : 'stumble';
  const sev = clamp(score, 0.5, 1.5);
  const dur = (level === 'trip' ? lerp(1, 2, clamp(score - 1, 0, 1)) : level === 'slip' ? lerp(0.32, 0.45, k) : lerp(0.65, 1.15, k)) * B.ts;
  d.speed *= level === 'trip' ? 0.45 : level === 'slip' ? 0.97 : lerp(0.94, 0.8, k);
  d.jump = null;
  return {
    level, kind, down, t: 0, dur, side, sev,
    tT: 0.45 * B.ts, tL: lerp(0.8, 1.6, clamp(sev - 1, 0, 1)) * Math.sqrt(B.mk), tR: 1.15 * B.ts * Math.pow(B.mk, 0.4), thud: false,
  };
}

// Advance a fall; true on the tick the body hits the ground.
export function stepFall(f: Fall, dt: number): { done: boolean; thud: boolean } {
  f.t += dt;
  if (f.down) {
    const thud = !f.thud && f.t >= f.tT;
    if (thud) f.thud = true;
    return { done: f.t > f.tT + f.tL + f.tR, thud };
  }
  return { done: f.t > f.dur, thud: false };
}
