import { clamp, damp, lerp, wrapAngle } from './math';
import { heightAt, MAP_RADIUS, TOO_DEEP, waterDepthAt } from './terrain';
import { plume } from './scent';
import { pushOutOfTrees } from './flora';
import { heardFrom } from './hearing';
import type { SoundEvent } from './events';
import { loudestAt, SETTLE, WAKE_DB, WAKE_NEAR } from './clock';

// Hyperodapedon: beaked rhynchosaur, the most common animal in the valley and
// the main prey. Herding and the numbers below are game design informed by the
// anatomy (blueprint §2), not facts from the fossils.
export const HYPERODAPEDON = {
  name: 'Hyperodapedon',
  length: 1.6, // m
  hip: 0.45,
  mass: 80, // kg
  meat: 35, // kg its carcass holds
  graze: 0.35, // m/s drifting while grazing
  walk: 1.1,
  flee: 4.8, // burst
  fleeTired: 3.0, // once its sprint stamina is gone
  turn: 3.2, // rad/s: a stocky body, but it jinks faster than a big biped at speed
  sight: 60, // m (dlist/E18: about range + chaser speed x alarm spread + herd depth)
  hears: 45, // dB: the quietest footfall or call it notices
  smell: 0.18, // plume concentration that counts as smelling a predator
  ignoreBelow: 24, // kg: predators smaller than this aren't worth running from
};

export type HerbState = 'graze' | 'walk' | 'alert' | 'flee' | 'sleep' | 'dead';

export interface Herbivore {
  id: number;
  herd: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  health: number;
  stamina: number;
  state: HerbState;
  stateT: number; // s in this state
  threatX: number; // last place it sensed the predator
  threatZ: number;
  alarmAt: number; // world time (s) of the freshest sighting it knows of, its own or a neighbour's
  startleAt: number; // world time it heard a call loud enough to bolt (kept apart from alarmAt, which neighbours copy)
  bleeding: number; // s of bleeding left
  aim: number; // yaw it's drifting toward while grazing
  gait: number; // footfalls so far (4 per stride), for footstep events
}

export interface Herd {
  id: number;
  // Where the herd is heading while calm. Moves on when they reach it.
  goalX: number;
  goalZ: number;
}

// What a herbivore can sense of a predator this tick.
export interface Predator {
  x: number;
  z: number;
  speed: number;
  id: number; // entity id, to match the sound events it made
  alive: boolean;
  mass: number; // kg
  stealth: number; // multiplier on how far away it can be seen (1 = in the open)
}

const SEP = 1.6; // m personal space
const NEAR = 12; // m: neighbours that count for alarm and cohesion
const QUORUM = 2; // fleeing neighbours needed to start fleeing (dlist/E18: k=2)
const PANIC = 14; // m: closer than this and it flees without waiting
const CALM = 6; // s without sensing the predator before a fleeing animal settles

export function senses(h: Herbivore, p: Predator, heard: SoundEvent[] = []): boolean {
  if (!p.alive || p.mass < HYPERODAPEDON.ignoreBelow) return false;
  const dx = p.x - h.x, dz = p.z - h.z;
  const d = Math.hypot(dx, dz);
  // Sight: a wide field of view (eyes on the sides of the head), but a still animal is hard to pick out.
  const ahead = Math.abs(wrapAngle(Math.atan2(dx, dz) - h.yaw)) < 2.4;
  const visible = HYPERODAPEDON.sight * p.stealth * (0.25 + 0.75 * clamp(p.speed / 4, 0, 1));
  if (ahead && d < visible) return true;
  if (heardFrom(heard, p.id, h.x, h.z, HYPERODAPEDON.hears)) return true;
  return plume(p.x, p.z, 1, h.x, h.z) > HYPERODAPEDON.smell;
}

export function stepHerbivore(h: Herbivore, herd: Herd, all: Herbivore[], preds: Predator[], rand: () => number, dt: number, now: number,
  heard: SoundEvent[] = [], night = false): void {
  if (h.state === 'dead') {
    h.speed = Math.max(0, h.speed - 6 * dt);
    return;
  }
  h.stateT += dt;
  h.bleeding = Math.max(0, h.bleeding - dt);
  // Asleep (D14, a reptile at night): eyes shut, it wakes only to a loud sound, a bite, a body right up against it,
  // or a herd-mate bolting past. Otherwise it lies still until dawn.
  if (h.state === 'sleep') {
    const brushed = preds.some((k) => k.alive && k.mass >= HYPERODAPEDON.ignoreBelow && Math.hypot(k.x - h.x, k.z - h.z) < WAKE_NEAR);
    const bolting = all.some((o) => o.herd === h.herd && o.state === 'flee' && Math.hypot(o.x - h.x, o.z - h.z) < NEAR);
    if (night && !brushed && !bolting && h.bleeding <= 0 && loudestAt(heard, h.x, h.z, h.id) < WAKE_DB) {
      h.speed = Math.max(0, h.speed - 4 * dt);
      return;
    }
    h.state = night ? 'alert' : 'graze';
    h.stateT = 0;
    if (night) h.alarmAt = now; // woken with a start
  }
  // The nearest predator it can sense is the one it runs from.
  let p: Predator | null = null;
  for (const k of preds) {
    if (senses(h, k, heard) && (!p || Math.hypot(k.x - h.x, k.z - h.z) < Math.hypot(p.x - h.x, p.z - h.z))) p = k;
  }
  const sensed = !!p;
  if (p) {
    h.threatX = p.x;
    h.threatZ = p.z;
    h.alarmAt = now;
  }

  let fleeingNear = 0, cx = 0, cz = 0, n = 0, sx = 0, sz = 0;
  for (const o of all) {
    if (o === h || o.state === 'dead' || o.herd !== h.herd) continue;
    const dx = o.x - h.x, dz = o.z - h.z, d = Math.hypot(dx, dz);
    if (d < NEAR) {
      cx += o.x;
      cz += o.z;
      n++;
      // Alarm spreads with its timestamp: a neighbour's panic only counts while its
      // sighting is fresh, and passing it on never makes it fresher. Without this a
      // fleeing herd keeps itself fleeing forever (each sees two others running).
      // A timestamp, not an age counter: ages shared within one tick depend on update order.
      if (o.state === 'flee' && now - o.alarmAt < CALM) {
        fleeingNear++;
        if (o.alarmAt > h.alarmAt) {
          h.alarmAt = o.alarmAt;
          h.threatX = o.threatX;
          h.threatZ = o.threatZ;
        }
      }
    }
    if (d < SEP && d > 1e-6) {
      sx -= dx / d;
      sz -= dz / d;
    }
  }

  const threatD = Math.hypot(h.threatX - h.x, h.threatZ - h.z);
  const calmT = now - h.alarmAt;
  // State changes, with hysteresis: it takes a while to calm down.
  if (h.state !== 'flee') {
    if (h.bleeding > 0 || (sensed && threatD < PANIC) || fleeingNear >= QUORUM || (h.state === 'alert' && sensed && h.stateT > 1.2) || now - h.startleAt < 0.2) {
      h.state = 'flee';
      h.stateT = 0;
    } else if (sensed && h.state !== 'alert') {
      h.state = 'alert';
      h.stateT = 0;
    } else if (h.state === 'alert' && calmT > 3) {
      h.state = 'graze';
      h.stateT = 0;
    }
  } else if (calmT > CALM && h.bleeding <= 0) {
    h.state = 'walk';
    h.stateT = 0;
  }
  // Night: once calm, it settles down where it is.
  if (night && (h.state === 'graze' || h.state === 'walk') && calmT > SETTLE) {
    h.state = 'sleep';
    h.stateT = 0;
    return;
  }

  const sp = HYPERODAPEDON;
  let yaw = h.yaw, target = 0;
  if (h.state === 'flee') {
    // Away from the threat, pulled a little toward the herd, pushed apart from neighbours.
    let ax = h.x - h.threatX, az = h.z - h.threatZ;
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    if (n) {
      ax += ((cx / n - h.x) / NEAR) * 0.4;
      az += ((cz / n - h.z) / NEAR) * 0.4;
    }
    // Head back in from the map edge rather than pinning against it.
    const r = Math.hypot(h.x, h.z);
    if (r > MAP_RADIUS - 15) {
      ax -= (h.x / r) * 1.5;
      az -= (h.z / r) * 1.5;
    }
    yaw = Math.atan2(ax + sx, az + sz);
    target = lerp(sp.fleeTired, sp.flee, h.stamina);
    h.stamina = clamp(h.stamina - dt / 8, 0, 1); // about 8 s of full burst
  } else {
    h.stamina = clamp(h.stamina + dt / 20, 0, 1);
    if (h.state === 'alert') {
      // Head up, turned toward where the danger is.
      yaw = Math.atan2(h.threatX - h.x, h.threatZ - h.z);
      target = 0;
    } else {
      // Calm: drift toward the herd's goal, keep near the herd, nibble along.
      const toGoal = Math.atan2(herd.goalX - h.x, herd.goalZ - h.z);
      if (rand() < dt / 4) h.aim = toGoal + (rand() - 0.5) * 1.6;
      let ax = Math.sin(h.aim), az = Math.cos(h.aim);
      if (n) {
        const hx = cx / n - h.x, hz = cz / n - h.z, hd = Math.hypot(hx, hz);
        if (hd > 4) {
          ax += (hx / hd) * 0.8;
          az += (hz / hd) * 0.8;
        }
      }
      yaw = Math.atan2(ax + sx * 1.5, az + sz * 1.5);
      if (h.state === 'walk' && h.stateT > 8) {
        h.state = 'graze';
        h.stateT = 0;
      }
      // Grazing moves in short steps between bites: 3 s moving, 3 s cropping, staggered by id.
      target = h.state === 'walk' ? sp.walk : Math.floor(h.stateT / 3 + h.id * 0.37) % 2 === 0 ? sp.graze : 0;
    }
  }

  const dy = wrapAngle(yaw - h.yaw);
  const turn = clamp(dy, -sp.turn * dt, sp.turn * dt);
  h.yaw = wrapAngle(h.yaw + turn);
  if (Math.abs(dy) > 1.6 && h.state !== 'flee') target *= 0.3;
  h.speed = damp(h.speed, target, h.state === 'flee' ? 4 : 2, dt);

  let nx = h.x + Math.sin(h.yaw) * h.speed * dt;
  let nz = h.z + Math.cos(h.yaw) * h.speed * dt;
  if (waterDepthAt(nx, nz) > TOO_DEEP * 0.4) {
    // Short legs: it won't go far into water. Slide along the shore instead.
    h.yaw = wrapAngle(h.yaw + (dy >= 0 ? 1 : -1) * sp.turn * dt * 2);
    nx = h.x;
    nz = h.z;
  }
  const r = Math.hypot(nx, nz);
  if (r > MAP_RADIUS) {
    nx *= MAP_RADIUS / r;
    nz *= MAP_RADIUS / r;
  }
  [nx, nz] = pushOutOfTrees(nx, nz, 0.4);
  h.x = nx;
  h.z = nz;
}

export const herbY = (h: Herbivore): number => heightAt(h.x, h.z);
