import { clamp, damp, wrapAngle } from './math';
import { heightAt, MAP_RADIUS, TOO_DEEP, waterDepthAt } from './terrain';
import { plume } from './scent';
import { pushOutOfTrees } from './flora';
import { heardFrom } from './hearing';
import type { SoundEvent } from './events';
import { loudestAt, SETTLE, WAKE_DB, WAKE_NEAR } from './clock';

// Saurosuchus: the apex predator, a big crocodile-line archosaur. Rare, roams a
// territory, ambushes. Numbers are game design informed by the anatomy (blueprint §2):
// its mass and speeds are guesses, labelled as such.
export const SAUROSUCHUS = {
  name: 'Saurosuchus',
  length: 6.5, // m
  hip: 0.9,
  mass: 650, // kg (guess: estimates vary widely)
  meat: 250,
  patrol: 1.2, // m/s
  stalk: 0.7, // creeping, easing to stalkSlow in the last stretch
  stalkSlow: 0.3,
  charge: 6.0, // burst, m/s: slower than an adult Herrerasaurus sprint (7.4), faster than juveniles
  sprintTime: 6, // s of full charge
  react: 0.5, // s for prey to react once it charges (tau in the catch radius)
  turnSlow: 1.6, // rad/s
  turnFast: 0.9, // at a charge: a long body turns wide
  reach: 3.1, // m from its centre to what its jaws can close on
  biteCone: 0.6,
  biteEvery: 1.4, // s
  biteMult: 1.3, // heavy skull: bites harder than its mass alone gives
  hide: 1.5, // osteoderms down the back: bites do two thirds of the damage
  sight: 50,
  smell: 0.12,
  hears: 45, // dB: the quietest footfall or call it notices
  stealth: 0.35, // multiplier on how far away prey can see it while it stalks (low and crouched)
  eatRate: 1, // kg/s
  fullAfter: 40, // kg eaten before it's sated
  hungryAfter: 150, // s after a meal before it hunts again
  retreatAt: 0.35, // health it breaks off a fight at
  heal: 1 / 400, // health/s while not fighting
  territory: 50, // m radius around its home
  minPrey: 25, // kg: smaller than this isn't worth chasing
  maxPreyFrac: 0.8, // of its own mass: bigger than this is too risky
};

export type SauroState = 'patrol' | 'stalk' | 'charge' | 'eat' | 'retreat' | 'rest' | 'sleep' | 'dead';

export interface Sauro {
  id: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  health: number;
  stamina: number; // charge left, 0..1
  state: SauroState;
  stateT: number;
  homeX: number;
  homeZ: number;
  wanderX: number;
  wanderZ: number;
  target: number; // id of what it's hunting or eating, -1 none
  lastMeal: number; // world time (s)
  wokeAt: number; // world time it was last woken (s)
  eaten: number; // kg this meal
  biteT: number;
  gait: number; // footfalls so far (4 per stride), for footstep events
}

// Something it could hunt this tick: the player or a herbivore.
export interface Quarry {
  id: number;
  x: number;
  z: number;
  speed: number;
  topSpeed: number;
  mass: number;
  scent?: number; // how strongly it smells (bleeding: stronger), default 1
}

export function createSauro(id: number, x: number, z: number): Sauro {
  return {
    id, x, z, yaw: 0, speed: 0, health: 1, stamina: 1, state: 'patrol', stateT: 0, homeX: x, homeZ: z,
    wanderX: x, wanderZ: z, target: -1, lastMeal: -999, eaten: 0, biteT: 9, gait: 0, wokeAt: -999,
  };
}

// Catch radius (dlist/E11): R = vp*tau + max(0, (vp - vq)(E - tau)). Inside it a charge
// can close the gap before the sprint runs out; outside it, it's wasted.
export function catchRadius(vq: number): number {
  const S = SAUROSUCHUS;
  return S.charge * S.react + Math.max(0, (S.charge - vq) * (S.sprintTime - S.react));
}

export function sensesQuarry(s: Sauro, q: Quarry, heard: SoundEvent[] = []): boolean {
  const dx = q.x - s.x, dz = q.z - s.z, d = Math.hypot(dx, dz);
  const ahead = Math.abs(wrapAngle(Math.atan2(dx, dz) - s.yaw)) < 1.4;
  if (ahead && d < SAUROSUCHUS.sight) return true;
  if (heardFrom(heard, q.id, s.x, s.z, SAUROSUCHUS.hears)) return true;
  return plume(q.x, q.z, q.scent ?? 1, s.x, s.z) > SAUROSUCHUS.smell;
}

export interface SauroWorld {
  now: number;
  rand: () => number;
  quarry: Quarry[];
  heard?: SoundEvent[]; // last tick's sound events
  night?: boolean; // a reptile: it sleeps through the night (D14)
  // Carcasses it can eat: id, position, meat.
  carcasses: { id: number; x: number; z: number; meat: number }[];
  // Called when its jaws close on something: returns nothing; the world applies damage.
  bite: (targetId: number) => void;
  eat: (carcassId: number, kg: number) => number; // returns kg actually eaten
}

const steerTo = (s: Sauro, x: number, z: number): number => Math.atan2(x - s.x, z - s.z);

export function stepSauro(s: Sauro, w: SauroWorld, dt: number): void {
  const S = SAUROSUCHUS;
  if (s.state === 'dead') {
    s.speed = Math.max(0, s.speed - 6 * dt);
    return;
  }
  s.stateT += dt;
  s.biteT += dt;
  const set = (st: SauroState): void => {
    s.state = st;
    s.stateT = 0;
  };
  if (s.state !== 'charge') s.stamina = clamp(s.stamina + dt / 20, 0, 1);
  if (s.state !== 'charge' && s.state !== 'stalk') s.health = clamp(s.health + S.heal * dt, 0, 1);

  const hungry = w.now - s.lastMeal > S.hungryAfter;
  const fromHome = Math.hypot(s.x - s.homeX, s.z - s.homeZ);
  const q = w.quarry.find((k) => k.id === s.target);

  if (s.health < S.retreatAt && s.state !== 'retreat') set('retreat');
  // Night: off duty (patrolling or lying up) it goes to sleep where it is. It wakes to a loud sound or something
  // right up against it, and at dawn. A bite wakes it too: the world turns it on the biter.
  if (w.night && (s.state === 'rest' || s.state === 'patrol') && w.now - s.wokeAt > SETTLE) set('sleep');
  if (s.state === 'sleep') {
    const brushed = w.quarry.some((k) => Math.hypot(k.x - s.x, k.z - s.z) < WAKE_NEAR);
    if (w.night && !brushed && loudestAt(w.heard ?? [], s.x, s.z, s.id) < WAKE_DB) {
      s.speed = Math.max(0, s.speed - 4 * dt);
      return;
    }
    if (w.night) s.wokeAt = w.now;
    set('patrol');
  }

  let yaw = s.yaw, target = 0, turn = S.turnSlow;
  switch (s.state) {
    case 'patrol':
    case 'rest': {
      // Eat any carcass it comes across when hungry. After a chase it lies up until it has its
      // breath back; otherwise it re-targets the next tick and flip-flops between rest and charge.
      const ready = s.state === 'patrol' || (s.stateT > 8 && s.stamina > 0.6);
      if (hungry && ready) {
        const c = w.carcasses.find((k) => Math.hypot(k.x - s.x, k.z - s.z) < 25 && k.meat > 2);
        if (c) {
          s.target = c.id;
          set('eat');
          break;
        }
        // Pick the best quarry it can sense: the most meat for the distance, within limits.
        let best: Quarry | null = null, bestScore = 0;
        for (const k of w.quarry) {
          // Small fry isn't worth a hunt, but it snaps at anything that wanders close.
          const near = Math.hypot(k.x - s.x, k.z - s.z) < 10;
          if ((k.mass < S.minPrey && !(near && k.mass >= 2)) || k.mass > S.mass * S.maxPreyFrac) continue;
          if (!sensesQuarry(s, k, w.heard)) continue;
          if (Math.hypot(k.x - s.homeX, k.z - s.homeZ) > S.territory + 20) continue;
          const score = k.mass / (10 + Math.hypot(k.x - s.x, k.z - s.z));
          if (score > bestScore) {
            best = k;
            bestScore = score;
          }
        }
        if (best) {
          s.target = best.id;
          set('stalk');
          break;
        }
      }
      if (s.state === 'rest') {
        if (s.stateT > 20) set('patrol');
        break;
      }
      // Wander its territory.
      if (Math.hypot(s.wanderX - s.x, s.wanderZ - s.z) < 4 || s.stateT > 60) {
        const a = w.rand() * Math.PI * 2, r = w.rand() * S.territory;
        s.wanderX = s.homeX + Math.cos(a) * r;
        s.wanderZ = s.homeZ + Math.sin(a) * r;
        s.stateT = 0;
      }
      yaw = steerTo(s, s.wanderX, s.wanderZ);
      target = S.patrol;
      break;
    }
    case 'stalk': {
      if (!q || !hungry) {
        set('patrol');
        break;
      }
      const d = Math.hypot(q.x - s.x, q.z - s.z);
      // Charge once inside the catch radius for this quarry's top speed.
      if (d < catchRadius(q.topSpeed)) {
        set('charge');
        break;
      }
      if (s.stateT > 90 || Math.hypot(q.x - s.homeX, q.z - s.homeZ) > S.territory + 20) {
        set('patrol');
        break;
      }
      yaw = steerTo(s, q.x, q.z);
      const R = catchRadius(q.topSpeed);
      target = S.stalkSlow + (S.stalk - S.stalkSlow) * clamp((d - R) / 15, 0, 1);
      break;
    }
    case 'charge': {
      if (!q) {
        set('rest');
        break;
      }
      const d = Math.hypot(q.x - s.x, q.z - s.z);
      s.stamina = clamp(s.stamina - dt / S.sprintTime, 0, 1);
      // Give up when the gap can't close in the sprint left (dlist/E11), or it's out of breath.
      const closing = s.speed - q.speed;
      const reach = Math.max(0, closing) * s.stamina * S.sprintTime + S.reach;
      if (s.stamina <= 0 || (s.stateT > 1.5 && d > reach + 2) || fromHome > S.territory + 25) {
        s.target = -1;
        set('rest');
        break;
      }
      yaw = steerTo(s, q.x, q.z);
      // Ease off as it closes so it doesn't overshoot (a long body turns wide at speed),
      // and swing the head round fast once it's in range.
      target = Math.min(S.charge, q.speed + 1 + Math.max(0, d - S.reach) * 1.5);
      turn = d < S.reach * 1.6 ? S.turnSlow * 1.5 : S.turnFast;
      if (d < S.reach && Math.abs(wrapAngle(yaw - s.yaw)) < S.biteCone && s.biteT >= S.biteEvery) {
        s.biteT = 0;
        w.bite(q.id);
      }
      break;
    }
    case 'eat': {
      const c = w.carcasses.find((k) => k.id === s.target);
      if (!c || c.meat <= 0.5 || s.eaten >= S.fullAfter) {
        if (s.eaten > 0) s.lastMeal = w.now;
        s.eaten = 0;
        s.target = -1;
        set('rest');
        break;
      }
      const d = Math.hypot(c.x - s.x, c.z - s.z);
      yaw = steerTo(s, c.x, c.z);
      if (d > S.reach) target = S.patrol;
      else s.eaten += w.eat(c.id, S.eatRate * dt);
      break;
    }
    case 'retreat': {
      // Back off toward home and lie up until it's healed enough.
      yaw = steerTo(s, s.homeX, s.homeZ);
      target = fromHome > 6 ? S.patrol * 2 : 0;
      if (s.health > 0.7) {
        s.target = -1;
        set('patrol');
      }
      break;
    }
  }

  const dy = wrapAngle(yaw - s.yaw);
  s.yaw = wrapAngle(s.yaw + clamp(dy, -turn * dt, turn * dt));
  if (Math.abs(dy) > 1.2) target *= 0.5;
  s.speed = damp(s.speed, target, s.state === 'charge' ? 3 : 2, dt);
  let nx = s.x + Math.sin(s.yaw) * s.speed * dt;
  let nz = s.z + Math.cos(s.yaw) * s.speed * dt;
  if (waterDepthAt(nx, nz) > TOO_DEEP) {
    nx = s.x;
    nz = s.z;
  }
  const r = Math.hypot(nx, nz);
  if (r > MAP_RADIUS) {
    nx *= MAP_RADIUS / r;
    nz *= MAP_RADIUS / r;
  }
  [nx, nz] = pushOutOfTrees(nx, nz, 0.9);
  s.x = nx;
  s.z = nz;
}

export const sauroY = (s: Sauro): number => heightAt(s.x, s.z);
