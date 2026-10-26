import { clamp, smooth } from './math';

// Injuries (blueprint §4 "later", The Isle): bleeding and broken legs.
// Bleeding: a bite opens a wound by how much of the body it took. It drains health, clots over time
// (faster lying still), makes the animal smell of blood to anything downwind, and leaves drops on
// the ground that can be sniffed out and followed. A broken leg comes from a bite that takes a big
// share of the body; it stops sprinting and jumping and cuts speed until it mends, which takes
// minutes of being fed and watered. Below LIMP of its health any animal limps.
export const INJURY = {
  bleedPerShare: 2.5, // bleed added per share of max HP a bite takes (a 40% bite opens a full wound)
  bleedDamage: 1 / 180, // health/s at a full wound
  clot: 1 / 60, // bleed/s that closes standing (a full wound clots in a minute)
  clotRest: 1 / 20, // lying down
  scent: 3, // a fully bleeding animal smells this many times stronger
  dropEvery: 1.5, // m walked between blood drops (or every dropIdle s standing)
  dropIdle: 3,
  dropLife: 90, // s a blood drop stays on the scent field
  breakFrom: 0.25, // a bite's share: chance of a broken leg rises from 0 here ...
  breakAll: 0.6, // ... to certain here
  mend: 8 * 60, // s fed and watered for a broken leg to mend
  lame: 0.55, // speed with a broken leg (no sprint, no jumping)
  limp: 0.3, // health below this limps
  limpSpeed: 0.8,
};

export interface Blood {
  x: number;
  z: number;
  t: number; // world time it fell, s
  s: number; // strength, 0..1 (how badly it was bleeding)
}

// A bite's chance of breaking a leg, from the share of max HP it took.
export const breakChance = (share: number): number => smooth(INJURY.breakFrom, INJURY.breakAll, share);

// Opens or deepens a wound.
export const wound = (bleed: number, share: number): number => clamp(bleed + share * INJURY.bleedPerShare, 0, 1);

// Speed multiplier from injuries: a broken leg, else a limp at low health.
export const lameness = (broken: number, health: number): number =>
  broken > 0 ? INJURY.lame : health < INJURY.limp ? INJURY.limpSpeed : 1;

// How strong a drop still smells.
export const bloodScent = (b: Blood, now: number): number => b.s * Math.max(0, 1 - (now - b.t) / INJURY.dropLife);
