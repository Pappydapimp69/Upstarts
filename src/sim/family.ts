import { clamp, damp, wrapAngle } from './math';
import { heightAt, MAP_RADIUS, MUDS, PONDS, SPAWNS, TOO_DEEP, waterDepthAt } from './terrain';
import { groundAt, pushOutOfRocks } from './ground';
import { browseAt, pushOutOfTrees, steerRoundTrees } from './flora';
import { heardAt } from './calls';
import { SPECIES, type SpeciesId } from './species';
import type { SoundEvent } from './events';

// Family (the owner's call: a grown animal needs something to live for; blueprint: "nest and pass on"). A full-grown
// animal calls, and one of its own kind that hears it comes; staying close a while, they pair. A paired, well-fed
// adult digs a nest on open dry ground and lays a clutch; the eggs need guarding, since the small cynodonts steal
// them; they hatch into young that stay by the nest and grow. When the parent dies, the player can carry on as one
// of them: death stays permanent, the line goes on. Numbers are game design.
export const NEST = {
  dig: 6, // s of digging to make the scrape and lay
  needs: 0.6, // hunger and thirst above this to lay
  layCost: 0.25, // of hunger
  space: 10, // m from any other nest
  incubate: 600, // s of game time (scaled by the growth setting, like growing)
  clutch: { herrerasaurus: 6, eodromaeus: 4, panphagia: 5, proterochampsa: 10, aetosauroides: 6, sanjuansaurus: 6 } as Record<SpeciesId, number>,
  youngLoss: 0.02, // chance per young per game minute of being taken while small (scaled like growth)
  youngGrow: 0.5, // young grow at this fraction of a fed player's rate
};
export const eggKg = (adultMass: number): number => 0.09 * Math.pow(adultMass, 0.311); // Brain dlist/E92

export const MATE = {
  hears: 45, // dB: a call this loud at the mate brings it
  near: 4, // m: close enough to court
  court: 10, // s together to pair
  walk: 1.6, // m/s (times sqrt of hip, as the species walk)
};

export interface Nest {
  id: number;
  owner: number; // the player entity that laid it
  species: SpeciesId;
  x: number;
  z: number;
  eggs: number;
  young: number; // hatched and still alive
  youngGrowth: number;
  hatchAt: number; // world time (s)
  taken: number; // kg of egg the thieves have eaten toward the next egg
}

export interface Mate {
  id: number;
  species: SpeciesId;
  for: number; // the player entity it belongs with
  x: number;
  z: number;
  yaw: number;
  speed: number;
  state: 'roam' | 'come' | 'court' | 'leave';
  stateT: number;
  homeX: number;
  homeZ: number;
  aimX: number;
  aimZ: number;
}

// Somewhere it can stand: dry, open, off the rocks, away from the nests and the spawns.
export function nestSiteOk(x: number, z: number, nests: Nest[]): boolean {
  const h = heightAt(x, z);
  return waterDepthAt(x, z) <= 0 && groundAt(x, z) <= h + 0.05 && browseAt(x, z) < 0.5 && Math.hypot(x, z) < MAP_RADIUS - 6
    && !PONDS.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 2) && !MUDS.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + 2)
    && !SPAWNS.some((s) => Math.hypot(x - s.x, z - s.z) < 4) && !nests.some((n) => Math.hypot(x - n.x, z - n.z) < NEST.space);
}

// A new mate for a player's species, somewhere out across the valley from it.
export function newMate(id: number, species: SpeciesId, owner: number, px: number, pz: number, rand: () => number): Mate {
  let x = 0, z = 0;
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2, r = 35 + rand() * 35;
    x = Math.cos(a) * r;
    z = Math.sin(a) * r;
    if (waterDepthAt(x, z) <= 0 && Math.hypot(x - px, z - pz) > 30) break;
  }
  return { id, species, for: owner, x, z, yaw: rand() * 6.28, speed: 0, state: 'roam', stateT: 0, homeX: x, homeZ: z, aimX: x, aimZ: z };
}

// One tick of a mate. heard: last tick's sounds; p: its player's animal (null if dead or not grown). Returns true on
// the tick they pair.
export function stepMate(m: Mate, p: { x: number; z: number; alive: boolean } | null, heard: SoundEvent[], rand: () => number, dt: number): boolean {
  const sp = SPECIES[m.species], walk = MATE.walk * Math.sqrt(sp.hip / 1.05);
  m.stateT += dt;
  let paired = false;
  const call = p && heard.find((e) => e.kind === 'call' && e.who === 'player' && e.id === m.for);
  if (p && call && m.state === 'roam' && heardAt(call.level, Math.hypot(call.x - m.x, call.z - m.z)) >= MATE.hears) {
    m.state = 'come';
    m.stateT = 0;
  }
  let gx = m.aimX, gz = m.aimZ, target = 0;
  if (m.state === 'come' || m.state === 'court') {
    if (!p || !p.alive || m.stateT > 120) {
      m.state = 'leave';
      m.stateT = 0;
    } else {
      gx = p.x;
      gz = p.z;
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      target = d > MATE.near * 0.7 ? walk * (d > 12 ? 1.6 : 1) : 0;
      if (d < MATE.near) {
        if (m.state === 'come') {
          m.state = 'court';
          m.stateT = 0;
        } else if (m.stateT >= MATE.court) {
          paired = true;
          m.state = 'leave';
          m.stateT = 0;
        }
      } else if (m.state === 'court' && d > MATE.near * 2.5) m.state = 'come';
    }
  }
  if (m.state === 'leave') {
    gx = m.homeX;
    gz = m.homeZ;
    target = walk;
    if (Math.hypot(m.homeX - m.x, m.homeZ - m.z) < 3) {
      m.state = 'roam';
      m.stateT = 0;
    }
  } else if (m.state === 'roam') {
    if (Math.hypot(m.aimX - m.x, m.aimZ - m.z) < 2 || m.stateT > 40) {
      const a = rand() * Math.PI * 2, r = rand() * 15;
      m.aimX = m.homeX + Math.cos(a) * r;
      m.aimZ = m.homeZ + Math.sin(a) * r;
      m.stateT = 0;
    }
    gx = m.aimX;
    gz = m.aimZ;
    target = Math.hypot(gx - m.x, gz - m.z) > 1 ? walk * 0.6 : 0;
  }
  let yaw = Math.atan2(gx - m.x, gz - m.z);
  if (target > 0.1) yaw = steerRoundTrees(m.x, m.z, yaw, 0.4, 3);
  m.yaw = wrapAngle(m.yaw + clamp(wrapAngle(yaw - m.yaw), -2 * dt, 2 * dt));
  m.speed = damp(m.speed, target, 3, dt);
  const nx = m.x + Math.sin(m.yaw) * m.speed * dt, nz = m.z + Math.cos(m.yaw) * m.speed * dt;
  if (waterDepthAt(nx, nz) < TOO_DEEP) {
    [m.x, m.z] = pushOutOfTrees(nx, nz, 0.4);
    [m.x, m.z] = pushOutOfRocks(m.x, m.z, 0.4, sp.hip);
  }
  return paired;
}

// The nest's eggs hatch, its young grow and are sometimes taken. scale: the world's growth multiplier.
export function stepNest(n: Nest, now: number, dt: number, scale: number, rand: () => number): 'hatched' | null {
  let ev: 'hatched' | null = null;
  if (n.eggs > 0 && now >= n.hatchAt) {
    n.young += n.eggs;
    n.eggs = 0;
    n.youngGrowth = 0;
    ev = 'hatched';
  }
  if (n.young > 0) {
    n.youngGrowth = Math.min(1, n.youngGrowth + (dt * scale * NEST.youngGrow) / SPECIES[n.species].toAdult);
    // Small young get taken; grown past a juvenile they're safe enough.
    const p = (NEST.youngLoss / 60) * dt * scale * (n.youngGrowth < 0.25 ? 1 : 0);
    for (let k = n.young; k > 0; k--) if (rand() < p) n.young--;
  }
  return ev;
}
