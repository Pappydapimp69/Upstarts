// Versioned saves (blueprint §6, gap list "saves"). The whole world as JSON: every entity, the tick, and
// where each RNG stream is, so a loaded world plays on exactly as the saved one would have. No DOM here;
// the client decides where the text is kept (browser storage, an exported file).
import { createWorld, setConditions, type PlayerSlot, type World } from './world';
import { bodyOf } from './growth';
import { SPECIES, type SpeciesId } from './species';
import type { Dino } from './dino';

export const SAVE_VERSION = 1;

type StreamName = keyof World['rng'];
const STREAMS: StreamName[] = ['spawn', 'herd', 'carcass', 'ai', 'prey', 'injury', 'weather'];

// A creature without its derived parts: species by id, body recomputed on load.
type SavedDino = Omit<Dino, 'species' | 'body'> & { species: SpeciesId };
interface SavedSlot extends Omit<PlayerSlot, 'dino'> { dino: SavedDino }

export interface SaveFile {
  version: number;
  savedAt: number; // ms since 1970, for "saved 3 minutes ago"
  seed: number;
  needScale: number;
  startGrowth: number;
  eggs: boolean;
  tick: number;
  nextId: number;
  sauroGoneAt: number;
  rng: Record<StreamName, number>;
  players: SavedSlot[];
  carcasses: World['carcasses'];
  herds: World['herds'];
  herbivores: World['herbivores'];
  sauros: World['sauros'];
  smalls: World['smalls'];
  grubs: World['grubs'];
  nests: World['nests'];
  blood: World['blood'];
  weather?: World['weather'];
  extra?: Record<string, unknown>; // later systems' state, by name (older saves just lack it)
}

const packDino = (d: Dino): SavedDino => {
  const { species, body: _b, ...rest } = d;
  void _b;
  // -Infinity (never laid) doesn't survive JSON.
  return { ...structuredClone(rest), species: species.id, lastClutch: Number.isFinite(d.lastClutch) ? d.lastClutch : -1e12 };
};
const unpackDino = (s: SavedDino): Dino => {
  const species = SPECIES[s.species];
  return { ...structuredClone(s), species, body: bodyOf(species, s.growth) };
};

// Hooks for systems added later to put their own state in the save.
export const saveHooks: { name: string; save: (w: World) => unknown; load: (w: World, v: unknown) => void }[] = [];

export function saveWorld(w: World, now = Date.now()): string {
  const f: SaveFile = {
    version: SAVE_VERSION, savedAt: now, seed: w.seed, needScale: w.needScale, startGrowth: w.startGrowth, eggs: w.eggs,
    tick: w.tick, nextId: w.nextId, sauroGoneAt: w.sauroGoneAt,
    rng: Object.fromEntries(STREAMS.map((k) => [k, w.rng[k].state])) as Record<StreamName, number>,
    players: w.players.map((p) => ({ ...p, dino: packDino(p.dino) })),
    carcasses: w.carcasses, herds: w.herds, herbivores: w.herbivores, sauros: w.sauros, smalls: w.smalls, grubs: w.grubs,
    nests: w.nests, blood: w.blood, weather: w.weather,
    extra: Object.fromEntries(saveHooks.map((h) => [h.name, h.save(w)])),
  };
  return JSON.stringify(f);
}

// Throws on a file that isn't an Upstarts save or is from a newer version.
export function loadWorld(text: string): World {
  const f = JSON.parse(text) as SaveFile;
  if (typeof f !== 'object' || f === null || typeof f.version !== 'number' || !Array.isArray(f.players)) throw new Error('not an Upstarts save');
  if (f.version > SAVE_VERSION) throw new Error(`save is from a newer version (${f.version})`);
  const w = createWorld(f.seed, f.needScale, f.startGrowth, f.players[0]?.speciesId ?? 'herrerasaurus', f.eggs);
  for (const k of STREAMS) if (typeof f.rng[k] === 'number') w.rng[k].state = f.rng[k];
  w.players.length = 0;
  for (const p of f.players) w.players.push({ ...p, dino: unpackDino(p.dino) });
  Object.assign(w, {
    tick: f.tick, nextId: f.nextId, sauroGoneAt: f.sauroGoneAt, carcasses: f.carcasses, herds: f.herds, herbivores: f.herbivores,
    sauros: f.sauros, smalls: f.smalls, grubs: f.grubs, nests: f.nests ?? [], blood: f.blood ?? [], events: [], weather: f.weather ?? w.weather,
  });
  for (const h of saveHooks) if (f.extra && h.name in f.extra) h.load(w, f.extra[h.name]);
  setConditions(w);
  return w;
}

// One line for a "continue" button.
export function describeSave(text: string): { species: SpeciesId; growth: number; alive: boolean; savedAt: number } | null {
  try {
    const f = JSON.parse(text) as SaveFile;
    const d = f.players[0].dino;
    return { species: d.species, growth: d.growth, alive: d.alive, savedAt: f.savedAt };
  } catch {
    return null;
  }
}
