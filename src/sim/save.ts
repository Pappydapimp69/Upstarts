// Saves: the whole world as plain data, so a life carries on after the page is closed. Death stays permanent: the
// game saves where you are, dead or alive, and there is only ever the latest save, so a reload can't undo anything.
// A species is stored by its id and its numbers come from the current code on load (Brain save-system#E1: content by
// stable id, so fixes flow in); every RNG stream by its state. A save from another version is refused, not guessed at.
import { createWorld, type World } from './world';
import { SPECIES, type SpeciesId } from './species';
import { bodyOf } from './growth';
import type { Dino } from './dino';
import type { Coat } from './coat';
import type { Rng } from './rng';

export const SAVE_VERSION = 1;

const STREAMS = ['spawn', 'herd', 'carcass', 'ai', 'prey'] as const;

// The coat's bands are typed arrays in the sim; plain arrays in a save (JSON).
type SavedCoat = Record<keyof Coat, number[]>;
interface SavedDino extends Omit<Dino, 'species' | 'body' | 'coat'> {
  species: SpeciesId;
  coat: SavedCoat;
}
export interface Save {
  v: number;
  savedAt: number; // wall-clock ms, for the "continue" card
  seed: number;
  tick: number;
  needScale: number;
  growScale: number;
  startGrowth: number;
  eggs: boolean;
  nextId: number;
  sauroGoneAt: number;
  rng: Record<(typeof STREAMS)[number], number>;
  players: { id: number; entity: number; speciesId: SpeciesId; lives: number; lastDeath: World['lastDeath']; dino: SavedDino }[];
  carcasses: World['carcasses'];
  herds: World['herds'];
  herbivores: World['herbivores'];
  sauros: World['sauros'];
  smalls: World['smalls'];
  grubs: World['grubs'];
  knocks: World['knocks'];
  counters: World['counters'];
  trails: World['trails'];
}

export function snapshot(w: World, now = 0): Save {
  const rngs = {} as Save['rng'];
  for (const k of STREAMS) rngs[k] = (w.rng[k] as Rng).state();
  return structuredClone({
    v: SAVE_VERSION, savedAt: now, seed: w.seed, tick: w.tick, needScale: w.needScale, growScale: w.growScale,
    startGrowth: w.startGrowth, eggs: w.eggs, nextId: w.nextId, sauroGoneAt: w.sauroGoneAt, rng: rngs,
    players: w.players.map((s) => {
      const { species, body: _b, coat, ...rest } = s.dino;
      void _b;
      const saved = Object.fromEntries(Object.entries(coat).map(([k, a]) => [k, Array.from(a as Float32Array)])) as SavedCoat;
      return { id: s.id, entity: s.entity, speciesId: s.speciesId, lives: s.lives, lastDeath: s.lastDeath, dino: { ...rest, coat: saved, species: species.id } };
    }),
    carcasses: w.carcasses, herds: w.herds, herbivores: w.herbivores, sauros: w.sauros, smalls: w.smalls, grubs: w.grubs,
    knocks: w.knocks, counters: w.counters, trails: w.trails,
  });
}

// A world from a save, or null if it isn't one this version can read.
export function restore(raw: unknown): World | null {
  const s = raw as Save;
  if (!s || typeof s !== 'object' || s.v !== SAVE_VERSION || !Array.isArray(s.players) || !s.players.length) return null;
  if (s.players.some((p) => !(p.dino.species in SPECIES) || !(p.speciesId in SPECIES))) return null;
  const c = structuredClone(s);
  const w = createWorld(c.seed, c.needScale, c.startGrowth, c.players[0].speciesId, c.eggs);
  for (const k of STREAMS) (w.rng[k] as Rng).setState(c.rng[k]);
  Object.assign(w, {
    tick: c.tick, growScale: c.growScale, nextId: c.nextId, sauroGoneAt: c.sauroGoneAt, carcasses: c.carcasses, herds: c.herds,
    herbivores: c.herbivores, sauros: c.sauros, smalls: c.smalls, grubs: c.grubs, knocks: c.knocks, counters: c.counters, trails: c.trails,
    events: [],
  });
  w.players.length = 0;
  for (const p of c.players) {
    const species = SPECIES[p.dino.species];
    const coat = Object.fromEntries(Object.entries(p.dino.coat).map(([k, a]) => [k, Float32Array.from(a)])) as unknown as Coat;
    const dino = { ...p.dino, species, body: bodyOf(species, p.dino.growth), coat } as Dino;
    w.players.push({ id: p.id, entity: p.entity, speciesId: p.speciesId, lives: p.lives, lastDeath: p.lastDeath, dino });
  }
  return w;
}
