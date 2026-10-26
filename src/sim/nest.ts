import type { SpeciesId } from './species';

// Nests and family (The Isle): an adult that is well fed scrapes a nest and lays a clutch. When one of
// your creatures dies you can hatch again from your own nest instead of at a random spawn: your next
// life starts there, a generation on. Eggs need guarding: left alone too long, egg thieves (small
// cynodonts and the like, off-screen) take them one at a time, and unhatched eggs go bad in time.
// In co-op, another player hatching as that species can hatch from your nest too.
export const NEST = {
  minGrowth: 0.85, // adult
  fedAbove: 0.6, // hunger and thirst both above this
  build: 8, // s of scraping
  cost: { hunger: 0.35, thirst: 0.2 },
  clutch: { herrerasaurus: 3, sanjuansaurus: 4, eodromaeus: 6, panphagia: 5 } as Record<SpeciesId, number>,
  every: 10 * 60, // s between clutches
  guard: 20, // m: a living adult of the same species this close keeps the thieves off
  raidEvery: 4 * 60, // s unguarded before thieves take an egg
  life: 45 * 60, // s before unhatched eggs go bad
  spacing: 12, // m from another nest
};

export interface Nest {
  id: number;
  x: number;
  z: number;
  yaw: number;
  species: SpeciesId;
  owner: number; // player number that laid it
  generation: number; // the parent's generation; hatchlings from it are one more
  eggs: number;
  laidAt: number; // world time, s
  unguarded: number; // s since anything kept watch
}
