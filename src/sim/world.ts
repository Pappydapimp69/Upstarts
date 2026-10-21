// Game state and rules. No Three.js or DOM here: the sim must be able to run
// in a Web Worker or on a server unchanged (blueprint D2, D7).
import { createDino, isSprinting, stepDino, type Act, type Command, type Dino, type Override } from './dino';
import { NEEDS, stepNeeds } from './needs';
import { heightAt, waterDepthAt } from './terrain';
import { HERRERASAURUS } from './species';
import { wrapAngle } from './math';
import { rng } from './rng';
import { HYPERODAPEDON, stepHerbivore, type Herbivore, type Herd, type Predator } from './herbivore';
import { plume } from './scent';
import { createSauro, SAUROSUCHUS, stepSauro, type Quarry, type Sauro } from './saurosuchus';
import { biteDamage } from './combat';
import { bodyOf, GROWTH } from './growth';

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

export const HERDS = {
  count: 3,
  size: 7,
  minTotal: 18, // below this, newcomers wander in from the edge
  every: 120, // s between newcomers
};

export const BITE = {
  reach: 0.6, // m past the snout
  cone: 0.7, // rad either side of straight ahead
  cooldown: 0.8, // s
  stamina: 0.06,
  bleed: 20, // s a bitten animal bleeds (and smells of blood)
};

export const SAUROS = {
  homes: [{ x: -38, z: -34 }], // one apex predator for this valley (dlist/E9: predators are rare)
  respawn: 600, // s after one dies before another moves in
};

export const PLAYER_ID = 0; // ids from nextId start at 1

export interface Death {
  age: number; // s it lived
  growth: number;
  cause: 'hunger' | 'thirst' | 'Saurosuchus';
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
  herds: Herd[];
  herbivores: Herbivore[];
  sauros: Sauro[];
  sauroGoneAt: number; // world time the last one died, -1 if alive
  startGrowth: number; // what new animals hatch at (0 = hatchling)
}

// startGrowth: 0 hatches every new animal as a hatchling (the game); tests and ?adult start grown.
export function createWorld(seed = 1, needScale = 1, startGrowth = 0): World {
  const rand = rng(seed);
  const w: World = {
    tick: 0, seed, rand, player: spawnDino(rand, startGrowth), carcasses: [], nextId: 1, lastDeath: null, lives: 1, needScale,
    herds: [], herbivores: [], sauros: [], sauroGoneAt: -1, startGrowth,
  };
  for (const h of SAUROS.homes) w.sauros.push(createSauro(w.nextId++, h.x, h.z));
  for (let i = 0; i < CARCASS.start; i++) placeCarcass(w);
  for (let i = 0; i < HERDS.count; i++) {
    const a = (i / HERDS.count) * Math.PI * 2 + 0.5;
    const herd: Herd = { id: i, goalX: 0, goalZ: 0 };
    w.herds.push(herd);
    pickGoal(w, herd);
    for (let k = 0; k < HERDS.size; k++) addHerbivore(w, herd, Math.cos(a) * 32 + (w.rand() - 0.5) * 10, Math.sin(a) * 32 + (w.rand() - 0.5) * 10);
  }
  return w;
}

function dry(x: number, z: number): boolean {
  return waterDepthAt(x, z) <= 0 && heightAt(x, z) < 3;
}

function pickGoal(w: World, herd: Herd): void {
  for (let tries = 0; tries < 30; tries++) {
    const a = w.rand() * Math.PI * 2, r = 10 + w.rand() * 45;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (dry(x, z)) {
      herd.goalX = x;
      herd.goalZ = z;
      return;
    }
  }
}

function addHerbivore(w: World, herd: Herd, x: number, z: number): void {
  w.herbivores.push({
    id: w.nextId++, herd: herd.id, x, z, yaw: w.rand() * Math.PI * 2, speed: 0, health: 1, stamina: 1,
    state: 'graze', stateT: w.rand() * 6, threatX: 0, threatZ: 0, alarmAt: -99, bleeding: 0, aim: w.rand() * Math.PI * 2,
  });
}

// What the herbivores can sense of the player this tick. Footsteps carry further the faster
// and heavier it goes.
const noiseOf = (speed: number, mass: number): number => (speed < 0.3 ? 0 : (3 + speed * 3) * Math.cbrt(mass / 350));
function predatorOf(d: Dino): Predator {
  return { x: d.x, z: d.z, speed: d.speed, noise: noiseOf(d.speed, d.body.mass), alive: d.alive, mass: d.body.mass, stealth: 1 };
}
function predatorOfSauro(s: Sauro): Predator {
  return {
    x: s.x, z: s.z, speed: s.speed, noise: noiseOf(s.speed, SAUROSUCHUS.mass) * (s.state === 'stalk' ? 0.4 : 1),
    alive: s.state !== 'dead', mass: SAUROSUCHUS.mass, stealth: s.state === 'stalk' ? SAUROSUCHUS.stealth : 1,
  };
}

// Something alive in reach of the jaws, straight ahead.
type Target = { kind: 'herb'; h: Herbivore } | { kind: 'sauro'; s: Sauro };
function preyInReach(w: World, d: Dino): Target | null {
  let best: Target | null = null, bestD = Infinity;
  const consider = (x: number, z: number, radius: number, t: Target): void => {
    const dist = Math.hypot(x - d.x, z - d.z);
    if (dist < d.body.snout + BITE.reach + radius && dist < bestD
      && Math.abs(wrapAngle(Math.atan2(x - d.x, z - d.z) - d.yaw)) < BITE.cone) {
      best = t;
      bestD = dist;
    }
  };
  for (const h of w.herbivores) if (h.state !== 'dead') consider(h.x, h.z, HYPERODAPEDON.length / 2, { kind: 'herb', h });
  for (const s of w.sauros) if (s.state !== 'dead') consider(s.x, s.z, 1.4, { kind: 'sauro', s });
  return best;
}

// Strongest smell at the snout: carcasses, and anything bleeding.
function smell(w: World, d: Dino): { yaw: number; strength: number } | null {
  let best: { yaw: number; strength: number } | null = null;
  const consider = (x: number, z: number, s: number): void => {
    const c = plume(x, z, s, d.x, d.z);
    if (c > 0.02 && (!best || c > best.strength)) best = { yaw: Math.atan2(x - d.x, z - d.z), strength: c };
  };
  for (const c of w.carcasses) consider(c.x, c.z, 0.5 + c.meat / 100);
  for (const h of w.herbivores) if (h.bleeding > 0) consider(h.x, h.z, 1.5);
  return best;
}

function spawnDino(rand: () => number, growth: number): Dino {
  const s = SPAWNS[Math.floor(rand() * SPAWNS.length)];
  return createDino(HERRERASAURUS, s.x, s.z, s.yaw, growth);
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
  placeCarcassAt(w, x, z, w.rand() * Math.PI * 2, m);
}

function placeCarcassAt(w: World, x: number, z: number, yaw: number, meat: number): void {
  w.carcasses.push({ id: w.nextId++, x, z, yaw, meat, meat0: meat });
}

// Nearest water within reach of the hips, searched in 24 directions.
function findWater(d: Dino): { yaw: number; dist: number } | null {
  let best: { yaw: number; dist: number } | null = null;
  for (let i = 0; i < 24; i++) {
    const yaw = (i / 24) * Math.PI * 2;
    for (let r = Math.min(0.6, d.body.reach / 2); r <= d.body.reach; r += 0.2) {
      if (waterDepthAt(d.x + Math.sin(yaw) * r, d.z + Math.cos(yaw) * r) > 0.05) {
        if (!best || r < best.dist) best = { yaw, dist: r };
        break;
      }
    }
  }
  return best;
}

function killPlayer(w: World, cause: Death['cause']): void {
  const d = w.player;
  d.alive = false;
  d.act = 'none';
  d.needs.health = 0;
  w.lastDeath = { age: d.age, growth: d.growth, cause };
  // Its body stays in the world as a carcass others can eat, from the moment it dies.
  placeCarcassAt(w, d.x, d.z, d.yaw, d.body.meat);
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
      w.player = spawnDino(w.rand, w.startGrowth);
      w.lives++;
    }
  } else {
    // Hold to drink or eat. Drinking wins if both are in reach.
    let ov: Override | undefined;
    let act: Act = 'none';
    let food: Carcass | null = null;
    d.biteT += dt;
    d.sniff = null;
    const prey = cmd.eat ? preyInReach(w, d) : null;
    if (cmd.drink) {
      const water = findWater(d);
      if (water) ({ act, ov } = approach(d, water.yaw, water.dist, d.body.snout, 'drink'));
      else {
        // No water in reach: stand and sniff the air.
        act = 'sniff';
        ov = { yaw: d.yaw, target: 0, turnCap: 0, steer: false };
        d.sniff = smell(w, d);
      }
    } else if (prey) {
      act = 'bite';
      if (d.biteT >= BITE.cooldown && d.stamina > BITE.stamina) {
        d.biteT = 0;
        d.stamina -= BITE.stamina;
        if (prey.kind === 'herb') {
          const h = prey.h;
          h.health -= biteDamage(d.body.mass, HYPERODAPEDON.mass);
          h.bleeding = BITE.bleed;
          h.threatX = d.x;
          h.threatZ = d.z;
          h.alarmAt = w.tick * TICK_DT;
          if (h.health <= 0) h.state = 'dead';
        } else {
          const s = prey.s;
          s.health -= biteDamage(d.body.mass, SAUROSUCHUS.mass);
          if (s.health <= 0) s.state = 'dead';
          // Bitten, it turns on whatever bit it, hungry or not.
          else if (s.state !== 'retreat' && s.state !== 'charge') {
            s.target = PLAYER_ID;
            s.state = 'charge';
            s.stateT = 0;
          }
        }
      }
    } else if (cmd.eat) {
      let bestD = d.body.reach + CARCASS.radius;
      for (const c of w.carcasses) {
        const dist = Math.hypot(c.x - d.x, c.z - d.z);
        if (dist < bestD) {
          bestD = dist;
          food = c;
        }
      }
      if (food) {
        const yaw = Math.atan2(food.x - d.x, food.z - d.z);
        ({ act, ov } = approach(d, yaw, bestD, d.body.snout + CARCASS.radius, 'eat'));
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
    d.hitT += dt;
    // Grows only while fed and watered.
    if (d.growth < 1 && n.hunger > GROWTH.fedAbove && n.thirst > GROWTH.fedAbove) {
      d.growth = Math.min(1, d.growth + (dt * w.needScale) / GROWTH.toAdult);
      d.body = bodyOf(d.species, d.growth);
    }
  }

  // Saurosuchus: hunts the player and the herds, eats carcasses.
  const now = w.tick * TICK_DT;
  const quarry: Quarry[] = [];
  if (w.player.alive) {
    const p = w.player;
    quarry.push({ id: PLAYER_ID, x: p.x, z: p.z, speed: p.speed, topSpeed: p.body.sprintMax, mass: p.body.mass, noise: noiseOf(p.speed, p.body.mass) });
  }
  for (const h of w.herbivores) {
    if (h.state !== 'dead') quarry.push({ id: h.id, x: h.x, z: h.z, speed: h.speed, topSpeed: HYPERODAPEDON.flee, mass: HYPERODAPEDON.mass, noise: noiseOf(h.speed, HYPERODAPEDON.mass) });
  }
  for (const s of w.sauros) {
    stepSauro(s, {
      now, rand: w.rand, quarry, carcasses: w.carcasses,
      bite: (id) => {
        if (id === PLAYER_ID) {
          const p = w.player;
          p.needs.health = Math.max(0, p.needs.health - biteDamage(SAUROSUCHUS.mass, p.body.mass, SAUROSUCHUS.biteMult));
          p.hitT = 0;
          if (p.needs.health <= 0 && p.alive) killPlayer(w, 'Saurosuchus');
        } else {
          const h = w.herbivores.find((k) => k.id === id);
          if (!h) return;
          h.health -= biteDamage(SAUROSUCHUS.mass, HYPERODAPEDON.mass, SAUROSUCHUS.biteMult);
          h.bleeding = BITE.bleed;
          h.threatX = s.x;
          h.threatZ = s.z;
          h.alarmAt = now;
          if (h.health <= 0) h.state = 'dead';
        }
      },
      eat: (id, kg) => {
        const c = w.carcasses.find((k) => k.id === id);
        if (!c) return 0;
        const e = Math.min(c.meat, kg);
        c.meat -= e;
        return e;
      },
    }, dt);
    // A kill becomes a carcass where it fell; it eats from that.
    if (s.target !== -1 && s.state !== 'eat') {
      const dead = w.herbivores.find((h) => h.id === s.target && h.state === 'dead');
      if (dead) {
        placeCarcassAt(w, dead.x, dead.z, dead.yaw, HYPERODAPEDON.meat);
        dead.state = 'dead';
        s.target = w.carcasses[w.carcasses.length - 1].id;
        s.state = 'eat';
        s.stateT = 0;
        dead.health = -1; // already turned into a carcass
      }
    }
  }
  for (const s of w.sauros) {
    if (s.state === 'dead' && s.health > -1) {
      placeCarcassAt(w, s.x, s.z, s.yaw, SAUROSUCHUS.meat);
      s.health = -1;
      w.sauroGoneAt = now;
    }
  }
  w.sauros = w.sauros.filter((s) => s.state !== 'dead');
  if (!w.sauros.length && w.sauroGoneAt >= 0 && now - w.sauroGoneAt > SAUROS.respawn) {
    const h = SAUROS.homes[0];
    w.sauros.push(createSauro(w.nextId++, h.x, h.z));
    w.sauroGoneAt = -1;
  }
  if (w.player.alive && w.player.needs.health <= 0) killPlayer(w, w.player.needs.thirst <= 0 ? 'thirst' : 'hunger');

  const preds = [predatorOf(w.player), ...w.sauros.map(predatorOfSauro)];
  for (const h of w.herbivores) {
    const herd = w.herds[h.herd];
    stepHerbivore(h, herd, w.herbivores, preds, w.rand, dt, now);
  }
  for (const h of w.herbivores) {
    if (h.state === 'dead' && h.health > -1) placeCarcassAt(w, h.x, h.z, h.yaw, HYPERODAPEDON.meat);
  }
  w.herbivores = w.herbivores.filter((h) => h.state !== 'dead');
  // A calm herd moves on once it reaches where it was heading.
  for (const herd of w.herds) {
    const m = w.herbivores.filter((h) => h.herd === herd.id);
    if (!m.length) continue;
    const cx = m.reduce((s, h) => s + h.x, 0) / m.length, cz = m.reduce((s, h) => s + h.z, 0) / m.length;
    if (Math.hypot(herd.goalX - cx, herd.goalZ - cz) < 6) pickGoal(w, herd);
  }

  // Carcasses rot away; new ones turn up now and then.
  for (const c of w.carcasses) c.meat -= CARCASS.rot * dt;
  w.carcasses = w.carcasses.filter((c) => c.meat > 0.5);
  w.tick++;
  if (w.tick % Math.round(CARCASS.every * TICK_HZ) === 0 && w.carcasses.length < CARCASS.max) placeCarcass(w);
  // Newcomers wander in from the edge to keep the valley stocked.
  if (w.tick % Math.round(HERDS.every * TICK_HZ) === 0 && w.herbivores.length < HERDS.minTotal) {
    const herd = w.herds[Math.floor(w.rand() * w.herds.length)];
    const a = w.rand() * Math.PI * 2;
    if (dry(Math.cos(a) * 60, Math.sin(a) * 60)) addHerbivore(w, herd, Math.cos(a) * 60, Math.sin(a) * 60);
  }
}
