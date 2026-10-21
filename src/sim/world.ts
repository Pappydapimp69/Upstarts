// Game state and rules. No Three.js or DOM here: the sim must be able to run
// in a Web Worker or on a server unchanged (blueprint D2, D7).
import { createDino, IDLE, isSprinting, stepDino, type Act, type Command, type Dino, type Override } from './dino';
import { NEEDS, needPace, stepNeeds } from './needs';
import { browseAt } from './flora';
import { heightAt, SPAWNS, waterDepthAt } from './terrain';
import { SPECIES, type SpeciesId } from './species';
import { lerp, wrapAngle } from './math';
import { rng } from './rng';
import { HYPERODAPEDON, stepHerbivore, type Herbivore, type Herd, type Predator } from './herbivore';
import { plume } from './scent';
import { createSauro, SAUROSUCHUS, stepSauro, type Quarry, type Sauro } from './saurosuchus';
import { biteDamage } from './combat';
import { bodyOf, GROWTH } from './growth';
import type { SoundEvent } from './events';
import { SPRINT_DB, STEP_DB } from './hearing';
import { createSmall, exaeretodonHome, exposed, GRUB, placeBurrows, placeGrubs, respawnSmall, SMALL, SMALL_POP, smallMass, stepSmall, SWALLOW_BELOW, type Grub, type Small } from './smallprey';
import { dayTime, isNight } from './clock';
import { CALLS, callLevel, heardAt, HERD_HEARS, roarStyle, SAURO_HEARS } from './calls';

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

export { SPAWNS } from './terrain';

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

export const PLAYER_ID = 0; // the local player's creature; other players' are -1, -2, ... (nextId starts at 1)

// A player in the world (blueprint §6: player identity lives in the world state from day one, open tension
// T3). Solo play has one slot; co-op adds more. A slot owns its creature, its choice of species and its
// history; creatures record their owner, so nothing assumes there is only one player.
export interface PlayerSlot {
  id: number; // player number, 0 = local
  entity: number; // its creature's entity id (PLAYER_ID - id), stable across deaths
  speciesId: SpeciesId; // what it hatches as next
  dino: Dino;
  lives: number;
  lastDeath: Death | null;
}

export interface Death {
  age: number; // s it lived
  growth: number;
  cause: 'hunger' | 'thirst' | 'Saurosuchus';
  carcassId: number; // its own body, lying where it fell
}

export interface World {
  tick: number;
  seed: number;
  // One seeded stream per system, so a change in how often one system draws never shifts another's rolls
  // (Brain: test E2, prologue E22).
  rng: { spawn: () => number; herd: () => number; carcass: () => number; ai: () => number; prey: () => number };
  players: PlayerSlot[];
  // The local player (players[0]): its creature, last death, lives and species. Accessors, kept so the
  // client and tests can address "the player" without knowing about slots.
  player: Dino;
  lastDeath: Death | null;
  lives: number;
  carcasses: Carcass[];
  nextId: number;
  needScale: number; // 1 = real time; tests and ?fast speed it up
  growScale: number; // extra multiplier on growth only (the owner's testing setting); 1 = real time
  herds: Herd[];
  herbivores: Herbivore[];
  sauros: Sauro[];
  smalls: Small[]; // small cynodonts and Exaeretodon
  grubs: Grub[]; // dig sites
  sauroGoneAt: number; // world time the last one died, -1 if alive
  startGrowth: number; // what new animals hatch at (0 = hatchling)
  speciesId: SpeciesId; // what the local player hatches as next (accessor)
  events: SoundEvent[]; // sounds made this tick; the client drains them
  eggs: boolean; // new hatchlings start inside an egg (the game; tests start hatched)
}

// startGrowth: 0 hatches every new animal as a hatchling (the game); tests and ?adult start grown.
export function createWorld(seed = 1, needScale = 1, startGrowth = 0, speciesId: SpeciesId = 'herrerasaurus', eggs = false): World {
  const streams = { spawn: rng(seed ^ 0x51a7), herd: rng(seed ^ 0x4e2d), carcass: rng(seed ^ 0xca2c), ai: rng(seed ^ 0xa1a1), prey: rng(seed ^ 0x9e37) };
  const w = {
    tick: 0, seed, rng: streams, players: [] as PlayerSlot[], carcasses: [], nextId: 1, needScale, growScale: 1,
    herds: [], herbivores: [], sauros: [], smalls: [], grubs: [], sauroGoneAt: -1, startGrowth, events: [], eggs,
  } as unknown as World;
  const local = (): PlayerSlot => w.players[0];
  Object.defineProperties(w, {
    player: { get: () => local().dino, set: (d: Dino) => { d.owner = local().id; local().dino = d; }, enumerable: true },
    lastDeath: { get: () => local().lastDeath, set: (v: Death | null) => (local().lastDeath = v), enumerable: true },
    lives: { get: () => local().lives, set: (v: number) => (local().lives = v), enumerable: true },
    speciesId: { get: () => local().speciesId, set: (v: SpeciesId) => (local().speciesId = v), enumerable: true },
  });
  addPlayer(w, speciesId);
  for (const h of SAUROS.homes) w.sauros.push(createSauro(w.nextId++, h.x, h.z));
  for (let i = 0; i < CARCASS.start; i++) placeCarcass(w);
  for (let i = 0; i < HERDS.count; i++) {
    const a = (i / HERDS.count) * Math.PI * 2 + 0.5;
    const herd: Herd = { id: i, goalX: 0, goalZ: 0 };
    w.herds.push(herd);
    pickGoal(w, herd);
    for (let k = 0; k < HERDS.size; k++) addHerbivore(w, herd, Math.cos(a) * 32 + (w.rng.herd() - 0.5) * 10, Math.sin(a) * 32 + (w.rng.herd() - 0.5) * 10);
  }
  addSmallPrey(w);
  return w;
}

// The small end of the food chain, all from the prey stream: cynodont burrows, one Exaeretodon group, grubs.
function addSmallPrey(w: World): void {
  const r = w.rng.prey;
  for (const b of placeBurrows(r)) {
    for (let k = 0; k < SMALL_POP.perBurrow; k++) w.smalls.push(createSmall(w.nextId++, 'cynodont', b.x, b.z, smallMass('cynodont', r), r));
  }
  const home = exaeretodonHome(r), ex = SMALL_POP.exaeretodon;
  for (let k = 0; k < ex.adults + ex.juveniles; k++) {
    w.smalls.push(createSmall(w.nextId++, 'exaeretodon', home.x, home.z, smallMass('exaeretodon', r, k >= ex.adults), r));
  }
  w.grubs = placeGrubs(r, w.nextId);
  w.nextId += w.grubs.length;
}

// How much meat fills this animal's empty stomach: 25 kg for an adult Herrerasaurus, scaled by mass.
const stomachOf = (d: Dino): number => NEEDS.kgPerHunger * (d.body.mass / 350);

// Put meat in its stomach; whatever doesn't fit is wasted.
function feed(d: Dino, kg: number): void {
  d.needs.hunger = Math.min(1, d.needs.hunger + kg / stomachOf(d));
}

function dry(x: number, z: number): boolean {
  return waterDepthAt(x, z) <= 0 && heightAt(x, z) < 3;
}

function pickGoal(w: World, herd: Herd): void {
  for (let tries = 0; tries < 30; tries++) {
    const a = w.rng.herd() * Math.PI * 2, r = 10 + w.rng.herd() * 45;
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
    id: w.nextId++, herd: herd.id, x, z, yaw: w.rng.herd() * Math.PI * 2, speed: 0, health: 1, stamina: 1,
    state: 'graze', stateT: w.rng.herd() * 6, threatX: 0, threatZ: 0, alarmAt: -99, startleAt: -99, bleeding: 0, aim: w.rng.herd() * Math.PI * 2, gait: 0,
  });
}

// What the herbivores can see of a predator this tick (hearing goes through sound events).
function predatorOf(slot: PlayerSlot): Predator {
  const d = slot.dino;
  // Lying down in cover it's harder to pick out.
  return { id: slot.entity, x: d.x, z: d.z, speed: d.speed, alive: d.alive, mass: d.body.mass, stealth: lerp(1, 0.5, d.rest) };
}
function predatorOfSauro(s: Sauro): Predator {
  return {
    id: s.id, x: s.x, z: s.z, speed: s.speed,
    alive: s.state !== 'dead', mass: SAUROSUCHUS.mass, stealth: s.state === 'stalk' ? SAUROSUCHUS.stealth : 1,
  };
}

// Footfall sound events, timed by each animal's gait: `per` footfalls per stride of length `stride` m.
// quiet (dB) is taken off a deliberately soft step (a stalking Saurosuchus).
function footfalls(w: World, o: { gait: number }, id: number, x: number, z: number, mass: number, speed: number,
  stride: number, per: number, dt: number, extraDb = 0): void {
  if (speed < 0.05) return;
  const g0 = Math.floor(o.gait);
  o.gait += (speed / stride) * per * dt;
  if (Math.floor(o.gait) === g0) return;
  w.events.push({ kind: 'step', who: id <= PLAYER_ID ? 'player' : 'prey', id, x, y: heightAt(x, z), z, level: STEP_DB(mass, speed) + extraDb });
}

// The nearest dig site with a grub in it, under the snout.
function grubInReach(w: World, d: Dino, now: number): Grub | null {
  let best: Grub | null = null, bestD = d.body.snout + GRUB.reach + 0.6;
  for (const g of w.grubs) {
    const dist = Math.hypot(g.x - d.x, g.z - d.z);
    if (g.readyAt <= now && dist < bestD) {
      best = g;
      bestD = dist;
    }
  }
  return best;
}

// Something alive in reach of the jaws, straight ahead.
type Target = { kind: 'herb'; h: Herbivore } | { kind: 'sauro'; s: Sauro } | { kind: 'small'; m: Small };
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
  for (const m of w.smalls) if (exposed(m)) consider(m.x, m.z, SMALL[m.kind].length / 2, { kind: 'small', m });
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
  for (const m of w.smalls) if (m.bleeding > 0 && exposed(m)) consider(m.x, m.z, 0.3 + m.mass / 50);
  return best;
}

// Hatch sequence (Dlist tutorial egg): a soft leathery egg the hatchling tears out of with repeated presses.
export const EGG = { presses: 4 };

function spawnDino(w: World, id: SpeciesId): Dino {
  const s = SPAWNS[Math.floor(w.rng.spawn() * SPAWNS.length)];
  const d = createDino(SPECIES[id], s.x, s.z, s.yaw, w.startGrowth);
  if (w.eggs && w.startGrowth === 0) d.egg = EGG.presses;
  return d;
}

// Somewhere on the dry valley floor.
function placeCarcass(w: World, x?: number, z?: number, meat?: number): void {
  for (let tries = 0; x === undefined && tries < 50; tries++) {
    const a = w.rng.carcass() * Math.PI * 2, r = 6 + w.rng.carcass() * 30;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    if (waterDepthAt(cx, cz) > 0 || waterDepthAt(cx + 3, cz) > 0 || waterDepthAt(cx - 3, cz) > 0 || heightAt(cx, cz) > 2.5) continue;
    x = cx;
    z = cz;
  }
  if (x === undefined || z === undefined) return;
  const m = meat ?? CARCASS.meatMin + w.rng.carcass() * (CARCASS.meatMax - CARCASS.meatMin);
  placeCarcassAt(w, x, z, w.rng.carcass() * Math.PI * 2, m);
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

const groundY = (x: number, z: number): number => heightAt(x, z);
// The snout of an animal standing at (x, z) facing yaw, reach metres ahead and `up` above the ground.
function mouth(x: number, z: number, yaw: number, reach: number, up: number): { x: number; y: number; z: number } {
  const mx = x + Math.sin(yaw) * reach, mz = z + Math.cos(yaw) * reach;
  return { x: mx, y: groundY(mx, mz) + up, z: mz };
}

// Join a player: a new slot with a fresh hatchling. Returns the slot.
export function addPlayer(w: World, speciesId: SpeciesId): PlayerSlot {
  const id = w.players.length;
  const slot: PlayerSlot = { id, entity: PLAYER_ID - id, speciesId, dino: spawnDino(w, speciesId), lives: 1, lastDeath: null };
  slot.dino.owner = id;
  w.players.push(slot);
  return slot;
}

// Before the game starts: hatch a player as another species at a fresh spawn.
export function hatchAs(w: World, id: SpeciesId, player = 0): void {
  const slot = w.players[player];
  slot.speciesId = id;
  slot.dino = spawnDino(w, id);
  slot.dino.owner = slot.id;
}

function killPlayer(w: World, slot: PlayerSlot, cause: Death['cause']): void {
  const d = slot.dino;
  d.alive = false;
  d.act = 'none';
  d.needs.health = 0;
  // Its body stays in the world as a carcass others can eat, from the moment it dies.
  placeCarcassAt(w, d.x, d.z, d.yaw, d.body.meat);
  slot.lastDeath = { age: d.age, growth: d.growth, cause, carcassId: w.carcasses[w.carcasses.length - 1].id };
}

// Turn to face a point, creep up until the lowered snout is over it, then act.
function approach(d: Dino, yaw: number, dist: number, reach: number, act: Act): { act: Act; ov: Override } {
  const off = Math.abs(wrapAngle(yaw - d.yaw));
  if (off > 0.45) return { act: 'turn', ov: { yaw, target: 0, turnCap: 1.4, steer: true } };
  if (dist > reach) return { act: 'shuffle', ov: { yaw, target: 0.6, turnCap: 1.4, steer: true } };
  return { act, ov: { yaw, target: 0, turnCap: 1.4, steer: true } };
}

// One player's creature for one tick: its actions, needs, footfalls, calls and growth.
function stepPlayer(w: World, slot: PlayerSlot, cmd: Command, dt: number): void {
  const d = slot.dino;
  if (!d.alive) {
    stepDino(d, cmd, dt);
    if (cmd.respawn) {
      if (cmd.species) slot.speciesId = cmd.species;
      slot.dino = spawnDino(w, slot.speciesId);
      slot.dino.owner = slot.id;
      slot.lives++;
    }
  } else if (d.egg > 0) {
    // Inside the egg: no movement or actions of any kind (blocked here, not left to each action to ignore;
    // ZaneGPT review), but still a body something can find and bite. Each press tears the shell and chirps.
    d.act = 'none';
    stepDino(d, IDLE, dt);
    d.callT += dt;
    if (cmd.respawn) {
      d.egg--;
      const level = callLevel('chirp', d.body.mass);
      w.events.push({ kind: 'call', who: 'player', call: 'chirp', id: slot.entity, x: d.x, y: groundY(d.x, d.z) + 0.6 * d.body.hip, z: d.z, level });
      d.callT = 0;
      d.callDur = CALLS.chirp.duration;
    }
  } else {
    // Hold to drink or eat. Drinking wins if both are in reach.
    let ov: Override | undefined;
    let act: Act = 'none';
    let food: Carcass | null = null;
    d.biteT += dt;
    d.sniff = null;
    // Lying down or mid-jump, it can't drink, eat or bite.
    const free = !d.resting && d.rest < 0.3 && !d.jump;
    const wantEat = free && !!cmd.eat, wantDrink = free && !!cmd.drink;
    const prey = wantEat ? preyInReach(w, d) : null;
    if (wantDrink) {
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
        w.events.push({ kind: 'bite', who: 'player', ...mouth(d.x, d.z, d.yaw, d.body.snout, 0.8 * d.body.hip), level: 88 + 10 * Math.log10(d.body.mass / 350) });
        if (prey.kind === 'herb') {
          const h = prey.h;
          const share = biteDamage(d.body.mass, HYPERODAPEDON.mass, d.species.biteMult);
          h.health -= share;
          w.events.push({ kind: 'hit', who: 'player', x: h.x, y: groundY(h.x, h.z) + 0.3, z: h.z, level: 76 + 8 * share, share });
          w.events.push({ kind: 'call', who: 'prey', call: 'squeak', x: h.x, y: groundY(h.x, h.z) + 0.4, z: h.z, level: 74 });
          h.bleeding = BITE.bleed;
          h.threatX = d.x;
          h.threatZ = d.z;
          h.alarmAt = w.tick * TICK_DT;
          if (h.health <= 0) h.state = 'dead';
        } else if (prey.kind === 'small') {
          const m = prey.m;
          const share = biteDamage(d.body.mass, m.mass, d.species.biteMult);
          m.health -= share;
          const y = groundY(m.x, m.z) + SMALL[m.kind].hip;
          w.events.push({ kind: 'hit', who: 'player', x: m.x, y, z: m.z, level: 66 + 10 * Math.log10(m.mass) + 8 * share, share });
          w.events.push({ kind: 'call', who: 'prey', call: 'squeak', x: m.x, y, z: m.z, level: 60 + 10 * Math.log10(m.mass) });
          m.bleeding = BITE.bleed;
          m.threatX = d.x;
          m.threatZ = d.z;
          m.alarmAt = w.tick * TICK_DT;
          if (m.health <= 0) {
            // Small enough to swallow whole; anything bigger leaves a carcass.
            if (m.mass < SWALLOW_BELOW) feed(d, m.mass * 0.6);
            else placeCarcassAt(w, m.x, m.z, m.yaw, m.mass * 0.5);
            m.state = 'gone';
            m.stateT = 0;
          }
        } else {
          const s = prey.s;
          const share = biteDamage(d.body.mass, SAUROSUCHUS.mass, d.species.biteMult, SAUROSUCHUS.hide);
          s.health -= share;
          w.events.push({ kind: 'hit', who: 'player', x: s.x, y: groundY(s.x, s.z) + 0.8, z: s.z, level: 76 + 8 * share, share });
          w.events.push({ kind: 'call', who: 'saurosuchus', call: 'growl', ...mouth(s.x, s.z, s.yaw, 0.4 * SAUROSUCHUS.length, 1.1), level: 100 });
          if (s.health <= 0) s.state = 'dead';
          // Bitten, it turns on whatever bit it, hungry or not.
          else if (s.state !== 'retreat' && s.state !== 'charge') {
            s.target = slot.entity;
            s.state = 'charge';
            s.stateT = 0;
          }
        }
      }
    } else if (wantEat) {
      let bestD = d.body.reach + CARCASS.radius;
      for (const c of w.carcasses) {
        const dist = Math.hypot(c.x - d.x, c.z - d.z);
        if (dist < bestD) {
          bestD = dist;
          food = c;
        }
      }
      const now = w.tick * TICK_DT;
      const grub = food ? null : grubInReach(w, d, now);
      if (food) {
        const yaw = Math.atan2(food.x - d.x, food.z - d.z);
        ({ act, ov } = approach(d, yaw, bestD, d.body.snout + CARCASS.radius, 'eat'));
      } else if (grub) {
        // Dig it out: a second or so of scratching, then one mouthful.
        const dist = Math.hypot(grub.x - d.x, grub.z - d.z);
        ({ act, ov } = approach(d, Math.atan2(grub.x - d.x, grub.z - d.z), dist, d.body.snout + GRUB.reach, 'dig'));
        if (act === 'dig') {
          grub.dug += dt;
          if (grub.dug >= GRUB.dig) {
            feed(d, GRUB.kg);
            grub.dug = 0;
            grub.readyAt = now + GRUB.respawn;
          }
        }
      } else if (d.species.diet === 'omnivore' && browseAt(d.x, d.z) > 0.5) {
        // Nothing to eat but ferns: an omnivore browses where it stands.
        act = 'browse';
        ov = { yaw: d.yaw, target: 0, turnCap: 0, steer: false };
      }
    }
    d.act = act;
    stepDino(d, cmd, dt, ov);

    const n = d.needs;
    if (act === 'drink') n.thirst = Math.min(1, n.thirst + NEEDS.drinkRate * dt);
    if (act === 'eat' && food && n.hunger < 1) {
      // Stomach and bite size scale with the animal: an empty stomach holds 25 kg for an adult Herrerasaurus
      // and fills in about 12 s; a hatchling's fills in about 4 s from a few hundred grams.
      const m = d.body.mass / 350;
      const stomach = stomachOf(d), rate = NEEDS.eatRate * Math.pow(m, 0.75);
      const kg = Math.min(food.meat, rate * dt, (1 - n.hunger) * stomach);
      food.meat -= kg;
      n.hunger = Math.min(1, n.hunger + kg / stomach);
    }
    if (act === 'browse') n.hunger = Math.min(1, n.hunger + NEEDS.browseRate * dt);
    stepNeeds(n, isSprinting(d, cmd), dt, w.needScale, needPace(d.species.mass));
    d.age += dt;
    d.hitT += dt;
    // Footfalls: stride from Alexander's relation, two feet per stride; a sprint slams (+10 dB noise rating).
    const v = d.speed, legL = d.body.leg;
    const stride = Math.max(0.8 * d.body.size, 2.3 * legL * Math.pow((v * v) / (9.81 * legL), 0.3));
    if (d.air <= 0) footfalls(w, d, slot.entity, d.x, d.z, d.body.mass, v, stride, 2, dt, isSprinting(d, cmd) ? SPRINT_DB : 0);
    // Landing from a jump: both feet at once, louder the harder it comes down.
    if (d.jumpLanded > 0) w.events.push({ kind: 'step', who: 'player', id: slot.entity, x: d.x, y: heightAt(d.x, d.z), z: d.z, level: STEP_DB(d.body.mass, d.jumpLanded) + 6 });
    d.callT += dt;
    // Calls: one at a time. Loud ones startle the herds that hear them, and draw a hungry Saurosuchus.
    if (cmd.call && d.callT >= d.callDur) {
      const style = cmd.call === 'auto' ? roarStyle(d.stamina, n.thirst, n.hunger) : cmd.call;
      const c = CALLS[style];
      d.callT = 0;
      d.callDur = c.duration + (c.notes && c.notes > 1 ? (c.gap ?? 0.3) * (c.notes - 1) : 0);
      const level = callLevel(style, d.body.mass);
      w.events.push({ kind: 'call', who: 'player', call: style, ...mouth(d.x, d.z, d.yaw, d.body.snout, 0.9 * d.body.hip), level });
      const now = w.tick * TICK_DT;
      for (const h of w.herbivores) {
        if (d.body.mass >= HYPERODAPEDON.ignoreBelow && heardAt(level, Math.hypot(h.x - d.x, h.z - d.z)) >= HERD_HEARS) {
          h.threatX = d.x;
          h.threatZ = d.z;
          h.alarmAt = now;
          h.startleAt = now;
        }
      }
      for (const s of w.sauros) {
        if (s.state === 'patrol' || s.state === 'rest') {
          if (heardAt(level, Math.hypot(s.x - d.x, s.z - d.z)) >= SAURO_HEARS) {
            s.wanderX = d.x;
            s.wanderZ = d.z;
            s.state = 'patrol';
            s.stateT = 0;
          }
        }
      }
    }
    // Grows only while fed and watered.
    if (d.growth < 1 && n.hunger > GROWTH.fedAbove && n.thirst > GROWTH.fedAbove) {
      d.growth = Math.min(1, d.growth + (dt * w.needScale * w.growScale) / d.species.toAdult);
      d.body = bodyOf(d.species, d.growth);
    }
  }
}

// cmd: the local player's command, or one per player number for co-op.
export function step(w: World, cmd: Command | Record<number, Command>): void {
  const dt = TICK_DT;
  // Last tick's sounds are what everyone hears this tick (an order-free snapshot); this tick's start empty.
  const heard = w.events.slice();
  w.events.length = 0;
  const cmds: Record<number, Command> = 'moveX' in cmd ? { 0: cmd as Command } : (cmd as Record<number, Command>);
  for (const slot of w.players) stepPlayer(w, slot, cmds[slot.id] ?? IDLE, dt);

  // Saurosuchus: hunts the player and the herds, eats carcasses.
  const now = w.tick * TICK_DT;
  const night = isNight(dayTime(now));
  const quarry: Quarry[] = [];
  for (const slot of w.players) {
    const p = slot.dino;
    if (p.alive) quarry.push({ id: slot.entity, x: p.x, z: p.z, speed: p.speed, topSpeed: p.body.sprintMax, mass: p.body.mass });
  }
  for (const h of w.herbivores) {
    if (h.state !== 'dead') quarry.push({ id: h.id, x: h.x, z: h.z, speed: h.speed, topSpeed: HYPERODAPEDON.flee, mass: HYPERODAPEDON.mass });
  }
  for (const s of w.sauros) {
    const was = s.state;
    stepSauro(s, {
      now, rand: w.rng.ai, quarry, heard, night, carcasses: w.carcasses,
      bite: (id) => {
        w.events.push({ kind: 'bite', who: 'saurosuchus', ...mouth(s.x, s.z, s.yaw, 0.4 * SAUROSUCHUS.length, 0.9), level: 96 });
        const slot = w.players.find((k) => k.entity === id);
        if (slot) {
          const p = slot.dino;
          const share = biteDamage(SAUROSUCHUS.mass, p.body.mass, SAUROSUCHUS.biteMult);
          p.needs.health = Math.max(0, p.needs.health - share);
          w.events.push({ kind: 'hit', who: 'saurosuchus', x: p.x, y: groundY(p.x, p.z) + 0.8 * p.body.hip, z: p.z, level: 80 + 8 * share, share });
          w.events.push({ kind: 'call', who: 'player', call: 'yelp', ...mouth(p.x, p.z, p.yaw, p.body.snout, 0.9 * p.body.hip), level: 92 + 10 * Math.log10(p.body.mass / 350) });
          p.hitT = 0;
          if (p.needs.health <= 0 && p.alive) killPlayer(w, slot, 'Saurosuchus');
        } else {
          const h = w.herbivores.find((k) => k.id === id);
          if (!h) return;
          const share = biteDamage(SAUROSUCHUS.mass, HYPERODAPEDON.mass, SAUROSUCHUS.biteMult);
          h.health -= share;
          w.events.push({ kind: 'hit', who: 'saurosuchus', x: h.x, y: groundY(h.x, h.z) + 0.3, z: h.z, level: 80 + 8 * share, share });
          w.events.push({ kind: 'call', who: 'prey', call: 'squeak', x: h.x, y: groundY(h.x, h.z) + 0.4, z: h.z, level: 74 });
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
    // Four footfalls per stride; stalking, it places its feet softly (-10 dB).
    footfalls(w, s, s.id, s.x, s.z, SAUROSUCHUS.mass, s.speed, 2.2, 4, dt, s.state === 'stalk' ? -10 : 0);
    // The charge starts with a growl: the ambush gives itself away at the last moment.
    if (s.state === 'charge' && was !== 'charge') w.events.push({ kind: 'call', who: 'saurosuchus', call: 'growl', ...mouth(s.x, s.z, s.yaw, 0.4 * SAUROSUCHUS.length, 1.1), level: 100 });
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
  for (const slot of w.players) {
    const p = slot.dino;
    if (p.alive && p.needs.health <= 0) killPlayer(w, slot, p.needs.thirst <= 0 ? 'thirst' : 'hunger');
  }

  const preds = [...w.players.map(predatorOf), ...w.sauros.map(predatorOfSauro)];
  for (const h of w.herbivores) {
    const herd = w.herds[h.herd];
    stepHerbivore(h, herd, w.herbivores, preds, w.rng.ai, dt, now, heard, night);
    footfalls(w, h, h.id, h.x, h.z, HYPERODAPEDON.mass, h.speed, 0.9, 4, dt);
  }
  for (const m of w.smalls) {
    stepSmall(m, preds, w.rng.prey, dt, now, heard);
    if (m.kind === 'exaeretodon' && exposed(m)) footfalls(w, m, m.id, m.x, m.z, m.mass, m.speed, 0.7 * Math.cbrt(m.mass / 50), 4, dt);
    if (m.state === 'gone' && m.stateT > SMALL[m.kind].respawn) respawnSmall(m, w.rng.prey);
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
    const herd = w.herds[Math.floor(w.rng.herd() * w.herds.length)];
    const a = w.rng.herd() * Math.PI * 2;
    if (dry(Math.cos(a) * 60, Math.sin(a) * 60)) addHerbivore(w, herd, Math.cos(a) * 60, Math.sin(a) * 60);
  }
}
