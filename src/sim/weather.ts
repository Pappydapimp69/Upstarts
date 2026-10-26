import { clamp, lerp } from './math';
import { CLOCK } from './clock';

// Seasons and weather (blueprint §2, §4). Ischigualasto had wet and dry seasons: in the dry one the ponds
// shrink and thirst comes faster. Weather comes in spells: rain (washes scent out of the air), fog (cuts
// how far anything can see), and now and then ashfall from the volcanoes (hard to see through, dries the
// throat). Durations are game choices, not climate data.
export const SEASON = {
  length: 3 * CLOCK.cycle, // one wet season, then one dry, each three days (4 h)
  dryDrop: 0.6, // m the ponds fall at the height of the dry season
  dryThirst: 1.3, // thirst drains this much faster at the height of the dry season
};

export type Sky = 'clear' | 'rain' | 'fog' | 'ash';

export const WEATHER = {
  minSpell: 8 * 60, // s a spell lasts, at least
  maxSpell: 22 * 60,
  // Chance of each next spell, wet season then dry.
  wet: { clear: 0.45, rain: 0.35, fog: 0.15, ash: 0.05 } as Record<Sky, number>,
  dry: { clear: 0.72, rain: 0.05, fog: 0.13, ash: 0.1 } as Record<Sky, number>,
  ease: 60, // s to blend from one sky to the next
  // What each sky does at full strength.
  sight: { clear: 1, rain: 0.75, fog: 0.4, ash: 0.5 } as Record<Sky, number>,
  scent: { clear: 1, rain: 0.45, fog: 1.1, ash: 0.8 } as Record<Sky, number>,
  thirst: { clear: 1, rain: 0.85, fog: 1, ash: 1.4 } as Record<Sky, number>,
};

export interface Weather {
  sky: Sky;
  prev: Sky;
  since: number; // world time this spell began, s
  until: number; // world time it ends
}

export const firstWeather = (): Weather => ({ sky: 'clear', prev: 'clear', since: -1e9, until: WEATHER.minSpell });

// 0 at the height of the wet season .. 1 at the height of the dry, easing between. A new world starts at
// the height of the wet season (ponds full).
export function dryness(t: number): number {
  return 0.5 - 0.5 * Math.cos((Math.PI * t) / SEASON.length);
}
export const isDrySeason = (t: number): boolean => dryness(t) > 0.5;

// Mean pond level drop, m (0 wet).
export const waterDrop = (t: number): number => SEASON.dryDrop * dryness(t);

export function stepWeather(w: Weather, t: number, rand: () => number): void {
  if (t < w.until) return;
  const table = isDrySeason(t) ? WEATHER.dry : WEATHER.wet;
  let r = rand(), next: Sky = 'clear';
  for (const k of Object.keys(table) as Sky[]) {
    if ((r -= table[k]) < 0) {
      next = k;
      break;
    }
  }
  w.prev = w.sky;
  w.sky = next;
  w.since = t;
  w.until = t + lerp(WEATHER.minSpell, WEATHER.maxSpell, rand());
}

// How far into the current sky it is (0 just changed .. 1 settled).
export const blend = (w: Weather, t: number): number => clamp((t - w.since) / WEATHER.ease, 0, 1);
export const mix = (w: Weather, t: number, table: Record<Sky, number>): number => lerp(table[w.prev], table[w.sky], blend(w, t));

// The air right now, read by sight and scent everywhere in the sim. Set at the start of every world step from
// that world's own weather (a pure function of its state), so it never carries one world's weather into another's.
export const AIR = { sight: 1, scent: 1, thirst: 1 };
export function setAir(w: Weather, t: number): void {
  AIR.sight = mix(w, t, WEATHER.sight);
  AIR.scent = mix(w, t, WEATHER.scent);
  AIR.thirst = mix(w, t, WEATHER.thirst) * lerp(1, SEASON.dryThirst, dryness(t));
}
