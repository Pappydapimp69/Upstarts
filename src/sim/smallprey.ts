import { clamp, damp, wrapAngle } from './math';
import { MAP_RADIUS, SPAWNS, waterDepthAt } from './terrain';
import { browseAt, pushOutOfTrees, TREES } from './flora';
import { heardFrom } from './hearing';
import type { SoundEvent } from './events';
import type { Predator } from './herbivore';

// Food for small bodies (ZaneGPT review, Q2). A hatchling Herrerasaurus weighs about 4 kg and can't take a
// Hyperodapedon, so the bottom of the food chain needs rungs: grubs dug from the ground, small cynodonts that
// bolt for their burrows, and Exaeretodon, a mid-sized cynodont browser. Numbers are game design, not fossil
// facts (Exaeretodon adult mass is a guess). Everything here draws from its own RNG stream.

export type SmallKind = 'cynodont' | 'exaeretodon';

export const SMALL = {
  cynodont: {
    name: 'small cynodont', length: 0.3, hip: 0.07, walk: 0.5, flee: 4.5, turn: 9,
    alert: 9, // m it spots a moving predator at
    hears: 40, // dB
    roam: 6, // m from its burrow while foraging
    hide: 12, // s it stays underground at least
    respawn: 90,
  },
  exaeretodon: {
    name: 'Exaeretodon', length: 1.6, hip: 0.32, walk: 0.8, flee: 5.2, turn: 4,
    alert: 25, hears: 45, roam: 14, hide: 0, respawn: 240,
    adult: 50, juvenile: 8, // kg
  },
} as const;

export const SMALL_POP = {
  burrows: 4,
  perBurrow: 3,
  exaeretodon: { adults: 3, juveniles: 3 },
  grubs: 40,
};

export const GRUB = {
  kg: 0.02, // meat in one grub
  dig: 1.2, // s of digging to get it out
  respawn: 120, // s until the site has another
  reach: 0.4, // m past the snout
};

export const SWALLOW_BELOW = 2; // kg: a kill this small is eaten whole on the spot, not left as a carcass

export type SmallState = 'forage' | 'flee' | 'hide' | 'gone';

export interface Small {
  id: number;
  kind: SmallKind;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  mass: number;
  health: number; // 0..1 of max HP
  state: SmallState;
  stateT: number;
  homeX: number; // burrow, or the group's range centre
  homeZ: number;
  threatX: number;
  threatZ: number;
  alarmAt: number;
  aim: number;
  bleeding: number;
  gait: number;
}

export interface Grub {
  id: number;
  x: number;
  z: number;
  readyAt: number; // world time a grub is there again
  dug: number; // s of digging so far
}

const dry = (x: number, z: number): boolean => waterDepthAt(x, z) === 0 && Math.hypot(x, z) < MAP_RADIUS - 25;
const clearOfTrees = (x: number, z: number, pad: number): boolean => TREES.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + pad);

// Burrows sit at fern edges 15-40 m from a spawn, so a hatchling finds one in its first minute.
export function placeBurrows(rand: () => number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < 2000 && out.length < SMALL_POP.burrows; i++) {
    const s = SPAWNS[out.length % SPAWNS.length];
    const a = rand() * Math.PI * 2, r = 15 + rand() * 25;
    const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
    const f = browseAt(x, z), edge = f > 0.05 && f < 0.95;
    if (!dry(x, z) || !clearOfTrees(x, z, 1.5) || (!edge && i < 1500)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 12)) continue;
    out.push({ x, z });
  }
  return out;
}

export function placeGrubs(rand: () => number, firstId: number): Grub[] {
  const out: Grub[] = [];
  for (let i = 0; i < 2000 && out.length < SMALL_POP.grubs; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 55;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!dry(x, z) || !clearOfTrees(x, z, 0.8)) continue;
    out.push({ id: firstId + out.length, x, z, readyAt: 0, dug: 0 });
  }
  return out;
}

export function exaeretodonHome(rand: () => number): { x: number; z: number } {
  for (let i = 0; i < 500; i++) {
    const a = rand() * Math.PI * 2, r = 25 + rand() * 20;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (dry(x, z) && clearOfTrees(x, z, 2)) return { x, z };
  }
  return { x: -25, z: 10 };
}

export function createSmall(id: number, kind: SmallKind, homeX: number, homeZ: number, mass: number, rand: () => number): Small {
  const a = rand() * Math.PI * 2, r = rand() * SMALL[kind].roam * 0.5;
  return {
    id, kind, x: homeX + Math.cos(a) * r, z: homeZ + Math.sin(a) * r, yaw: rand() * Math.PI * 2, speed: 0, mass,
    health: 1, state: 'forage', stateT: rand() * 4, homeX, homeZ, threatX: 0, threatZ: 0, alarmAt: -99,
    aim: rand() * Math.PI * 2, bleeding: 0, gait: 0,
  };
}

export const smallMass = (kind: SmallKind, rand: () => number, juvenile = false): number =>
  kind === 'cynodont' ? 0.5 + rand() * 0.5 : juvenile ? SMALL.exaeretodon.juvenile : SMALL.exaeretodon.adult;

// Out in the open and targetable (not underground, not respawning).
export const exposed = (s: Small): boolean => s.state === 'forage' || s.state === 'flee';

// Spots a predator worth running from: anything over half its own weight, seen moving, heard, or close.
export function sensesSmall(s: Small, p: Predator, heard: SoundEvent[]): boolean {
  if (!p.alive || p.mass < s.mass * 0.5) return false;
  const sp = SMALL[s.kind];
  const d = Math.hypot(p.x - s.x, p.z - s.z);
  const seen = sp.alert * p.stealth * (0.3 + 0.7 * clamp(p.speed / 3, 0, 1));
  return d < seen || d < 2 || !!heardFrom(heard, p.id, s.x, s.z, sp.hears);
}

export function stepSmall(s: Small, preds: Predator[], rand: () => number, dt: number, now: number, heard: SoundEvent[]): void {
  const sp = SMALL[s.kind];
  s.stateT += dt;
  s.bleeding = Math.max(0, s.bleeding - dt);
  if (s.state === 'gone') {
    s.speed = 0;
    return;
  }
  let near: Predator | null = null;
  for (const p of preds) {
    if (sensesSmall(s, p, heard) && (!near || Math.hypot(p.x - s.x, p.z - s.z) < Math.hypot(near.x - s.x, near.z - s.z))) near = p;
  }
  if (near) {
    s.threatX = near.x;
    s.threatZ = near.z;
    s.alarmAt = now;
  }
  const fresh = now - s.alarmAt < 4;

  if (s.state === 'hide') {
    // Underground: comes back up once it has waited and nothing has been sensed for a while.
    s.speed = 0;
    if (s.stateT > sp.hide && !fresh) setState(s, 'forage');
    return;
  }
  if (fresh && s.state !== 'flee') setState(s, 'flee');
  if (s.state === 'flee' && !fresh && s.stateT > 3) setState(s, 'forage');

  let yaw = s.yaw, target = 0;
  if (s.state === 'flee') {
    const toHome = Math.hypot(s.homeX - s.x, s.homeZ - s.z);
    if (s.kind === 'cynodont') {
      // Bolt for the burrow, then vanish into it.
      if (toHome < 0.4) {
        setState(s, 'hide');
        s.x = s.homeX;
        s.z = s.homeZ;
        s.speed = 0;
        return;
      }
      yaw = Math.atan2(s.homeX - s.x, s.homeZ - s.z);
      target = sp.flee;
    } else {
      // Run straight away from the threat, tiring after a few seconds of flight.
      yaw = Math.atan2(s.x - s.threatX, s.z - s.threatZ);
      target = (s.mass < SMALL.exaeretodon.adult ? 0.85 : 1) * sp.flee * (s.stateT > 6 ? 0.6 : 1);
    }
  } else {
    // Forage: potter about near home, stopping often.
    if (s.stateT > 2 + rand() * 4) {
      s.stateT = 0;
      s.aim = rand() < 0.4 ? -1 : rand() * Math.PI * 2;
    }
    const far = Math.hypot(s.homeX - s.x, s.homeZ - s.z) > sp.roam;
    if (far) s.aim = Math.atan2(s.homeX - s.x, s.homeZ - s.z);
    if (s.aim >= 0 || far) {
      yaw = s.aim;
      target = sp.walk;
    }
  }
  // Steer away from deep water and the map edge.
  const lx = s.x + Math.sin(yaw) * 2, lz = s.z + Math.cos(yaw) * 2;
  if (waterDepthAt(lx, lz) > 0.2 || Math.hypot(lx, lz) > MAP_RADIUS - 12) yaw += Math.PI / 2;
  const turn = sp.turn * dt;
  s.yaw = wrapAngle(s.yaw + clamp(wrapAngle(yaw - s.yaw), -turn, turn));
  s.speed = damp(s.speed, target, 6, dt);
  [s.x, s.z] = pushOutOfTrees(s.x + Math.sin(s.yaw) * s.speed * dt, s.z + Math.cos(s.yaw) * s.speed * dt, sp.length * 0.3);
}

function setState(s: Small, st: SmallState): void {
  s.state = st;
  s.stateT = 0;
}

// Bring a gone animal back at its home, full health.
export function respawnSmall(s: Small, rand: () => number): void {
  const fresh = createSmall(s.id, s.kind, s.homeX, s.homeZ, s.mass, rand);
  Object.assign(s, fresh);
}
