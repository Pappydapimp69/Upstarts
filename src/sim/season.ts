import { CLOCK } from './clock';

// Seasons (the owner handed the call over; Ischigualasto was seasonal: wet and dry, Currie et al. 2009). A cycle runs
// over two days of the 80-minute clock: it starts in the wet, dries out through the first day to the height of the
// dry season, and the rains come back through the second. In the dry the pond shrinks (the water drops half a metre,
// so the shore moves out and the shallows are gone), the ferns give half as much to a browser, grubs come back half
// as fast, and the herds go down to the water twice as often.
export const SEASON = {
  days: 2, // day cycles per cycle of seasons
  drop: 0.5, // m the water falls at the height of the dry
  browse: 0.5, // what browsing gives, at the height of the dry
  grubs: 2, // how much slower grubs come back
  herdWater: 2, // how much more often the herds go to drink
};

// 0 at the height of the wet .. 1 at the height of the dry. t: world time, s.
export function dryness(t: number): number {
  const u = (((t + CLOCK.start) / (CLOCK.cycle * SEASON.days)) % 1 + 1) % 1;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
}

// What a player would call it.
export function seasonName(t: number): string {
  const d = dryness(t), u = (((t + CLOCK.start) / (CLOCK.cycle * SEASON.days)) % 1 + 1) % 1;
  return d < 0.25 ? 'wet season' : d > 0.75 ? 'dry season' : u < 0.5 ? 'drying out' : 'the rains coming';
}
