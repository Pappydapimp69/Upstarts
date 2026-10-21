// Game state and rules. No Three.js or DOM here: the sim must be able to run
// in a Web Worker or on a server unchanged (blueprint D2, D7).
import { createDino, isSprinting, stepDino, type Act, type Command, type Dino, type Override } from './dino';
import { NEEDS, stepNeeds } from './needs';
import { heightAt, waterDepthAt } from './terrain';
import { HERRERASAURUS } from './species';
import { wrapAngle } from './math';
import { rng } from './rng';

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

export const SPAWNS = [
  { x: 0, z: 15, yaw: Math.PI },
  { x: -18, z: -12, yaw: 0.6 },
  { x: 22, z: 20, yaw: -2.4 },
  { x: -6, z: -30, yaw: 0.2 },
];

export const CARCASS = {
  start: 6, // placed at the start
  meatMin: 40, // kg
  meatMax: 90,
  rot: 3 / 60, // kg lost per s (about 3 kg a minute)
  every: 180, // s between new carcasses turning up
  max: 8,
  radius: 0.9, // m, for reaching it
};

export interface Carcass {
  id: number;
  x: number;
  z: number;
  yaw: number;
  meat: number;
  meat0: number;
}

export interface Death {
  age: number; // s it lived
  cause: 'hunger' | 'thirst';
}

export interface World {
  tick: number;
  seed: number;
  rand: () => number;
  player: Dino;
  carcasses: Carcass[];
  nextId: number;
  lastDeath: Death | null;
  lives: number;
  needScale: number; // 1 = real time; tests and ?fast speed it up
}

export function createWorld(seed = 1, needScale = 1): World {
  const rand = rng(seed);
  const w: World = {
    tick: 0, seed, rand, player: spawnDino(rand), carcasses: [], nextId: 1, lastDeath: null, lives: 1, needScale,
  };
  for (let i = 0; i < CARCASS.start; i++) placeCarcass(w);
  return w;
}

function spawnDino(rand: () => number): Dino {
  const s = SPAWNS[Math.floor(rand() * SPAWNS.length)];
  return createDino(HERRERASAURUS, s.x, s.z, s.yaw);
}

// Somewhere on the dry valley floor.
function placeCarcass(w: World, x?: number, z?: number, meat?: number): void {
  for (let tries = 0; x === undefined && tries < 50; tries++) {
    const a = w.rand() * Math.PI * 2, r = 6 + w.rand() * 30;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    if (waterDepthAt(cx, cz) > 0 || waterDepthAt(cx + 3, cz) > 0 || waterDepthAt(cx - 3, cz) > 0 || heightAt(cx, cz) > 2.5) continue;
    x = cx;
    z = cz;
  }
  if (x === undefined || z === undefined) return;
  const m = meat ?? CARCASS.meatMin + w.rand() * (CARCASS.meatMax - CARCASS.meatMin);
  w.carcasses.push({ id: w.nextId++, x, z, yaw: w.rand() * Math.PI * 2, meat: m, meat0: m });
}

// Nearest water within reach of the hips, searched in 24 directions.
function findWater(d: Dino): { yaw: number; dist: number } | null {
  let best: { yaw: number; dist: number } | null = null;
  for (let i = 0; i < 24; i++) {
    const yaw = (i / 24) * Math.PI * 2;
    for (let r = 0.6; r <= d.species.reach; r += 0.2) {
      if (waterDepthAt(d.x + Math.sin(yaw) * r, d.z + Math.cos(yaw) * r) > 0.05) {
        if (!best || r < best.dist) best = { yaw, dist: r };
        break;
      }
    }
  }
  return best;
}

// Turn to face a point, creep up until the lowered snout is over it, then act.
function approach(d: Dino, yaw: number, dist: number, reach: number, act: Act): { act: Act; ov: Override } {
  const off = Math.abs(wrapAngle(yaw - d.yaw));
  if (off > 0.45) return { act: 'turn', ov: { yaw, target: 0, turnCap: 1.4, steer: true } };
  if (dist > reach) return { act: 'shuffle', ov: { yaw, target: 0.6, turnCap: 1.4, steer: true } };
  return { act, ov: { yaw, target: 0, turnCap: 1.4, steer: true } };
}

export function step(w: World, cmd: Command): void {
  const d = w.player;
  const dt = TICK_DT;

  if (!d.alive) {
    stepDino(d, cmd, dt);
    if (cmd.respawn) {
      // Its body stays in the world as a carcass others can eat.
      placeCarcass(w, d.x, d.z, d.species.meat);
      w.player = spawnDino(w.rand);
      w.lives++;
    }
  } else {
    // Hold to drink or eat. Drinking wins if both are in reach.
    let ov: Override | undefined;
    let act: Act = 'none';
    let food: Carcass | null = null;
    if (cmd.drink) {
      const water = findWater(d);
      if (water) ({ act, ov } = approach(d, water.yaw, water.dist, d.species.snout, 'drink'));
    } else if (cmd.eat) {
      let bestD = d.species.reach + CARCASS.radius;
      for (const c of w.carcasses) {
        const dist = Math.hypot(c.x - d.x, c.z - d.z);
        if (dist < bestD) {
          bestD = dist;
          food = c;
        }
      }
      if (food) {
        const yaw = Math.atan2(food.x - d.x, food.z - d.z);
        ({ act, ov } = approach(d, yaw, bestD, d.species.snout + CARCASS.radius, 'eat'));
      }
    }
    d.act = act;
    stepDino(d, cmd, dt, ov);

    const n = d.needs;
    if (act === 'drink') n.thirst = Math.min(1, n.thirst + NEEDS.drinkRate * dt);
    if (act === 'eat' && food && n.hunger < 1) {
      const kg = Math.min(food.meat, NEEDS.eatRate * dt, (1 - n.hunger) * NEEDS.kgPerHunger);
      food.meat -= kg;
      n.hunger = Math.min(1, n.hunger + kg / NEEDS.kgPerHunger);
    }
    stepNeeds(n, isSprinting(d, cmd), dt, w.needScale);
    d.age += dt;

    if (n.health <= 0) {
      d.alive = false;
      d.act = 'none';
      w.lastDeath = { age: d.age, cause: n.thirst <= 0 ? 'thirst' : 'hunger' };
    }
  }

  // Carcasses rot away; new ones turn up now and then.
  for (const c of w.carcasses) c.meat -= CARCASS.rot * dt;
  w.carcasses = w.carcasses.filter((c) => c.meat > 0.5);
  w.tick++;
  if (w.tick % Math.round(CARCASS.every * TICK_HZ) === 0 && w.carcasses.length < CARCASS.max) placeCarcass(w);
}
