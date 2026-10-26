import { clamp, lerp, smooth } from './math';
import type { Diet } from './species';

// Nutrients (The Isle's diet system): protein, lipids and carbohydrates, each 0..1, on top of hunger.
// Hunger says how full the stomach is; nutrients say whether what went in was any good. They drain
// slower than hunger, so one meal doesn't settle them, and a one-food diet runs one of them down.
// Carnivores track protein and lipids; omnivores carbohydrates too. Profiles are game design, not
// measurements: lean meat is mostly protein, a fat herbivore and grubs carry the lipids, ferns the carbs.
export type Nutrient = 'protein' | 'lipid' | 'carb';
export interface Nutrients {
  protein: number;
  lipid: number;
  carb: number;
}

export type Food = 'meat' | 'lean' | 'fatty' | 'grub' | 'whole' | 'fern';

export const DIET = {
  empty: 50 * 60, // s from full to empty, at the species' need pace
  goodAbove: 0.6, // the lowest tracked nutrient above this: no penalty
  // What one full stomach of each food adds to each nutrient.
  foods: {
    meat: { protein: 1.2, lipid: 0.35, carb: 0 }, // an ordinary carcass found lying about
    lean: { protein: 1.4, lipid: 0.15, carb: 0 }, // a dinosaur or Saurosuchus: muscle, little fat
    fatty: { protein: 0.9, lipid: 1.0, carb: 0 }, // Hyperodapedon, Exaeretodon: bulky, well-fed herbivores
    grub: { protein: 0.6, lipid: 2.5, carb: 0 }, // insect larvae are mostly fat
    whole: { protein: 1.0, lipid: 0.8, carb: 0 }, // a small animal swallowed whole, bones and all
    fern: { protein: 0.1, lipid: 0, carb: 1.5 },
  } as Record<Food, Nutrients>,
  tracked: { carnivore: ['protein', 'lipid'], omnivore: ['protein', 'lipid', 'carb'] } as Record<Diet, Nutrient[]>,
};

export const fullNutrients = (): Nutrients => ({ protein: 1, lipid: 1, carb: 1 });

// fill: how much of an empty stomach this mouthful is (0..1).
export function nourish(n: Nutrients, food: Food, fill: number): void {
  const f = DIET.foods[food];
  n.protein = clamp(n.protein + f.protein * fill, 0, 1);
  n.lipid = clamp(n.lipid + f.lipid * fill, 0, 1);
  n.carb = clamp(n.carb + f.carb * fill, 0, 1);
}

export function stepNutrients(n: Nutrients, diet: Diet, dt: number, scale = 1, pace = 1): void {
  const k = (dt * scale * pace) / DIET.empty;
  for (const key of DIET.tracked[diet]) n[key] = clamp(n[key] - k, 0, 1);
}

// The weakest tracked nutrient: a diet is only as good as what it's shortest of.
export function balance(n: Nutrients, diet: Diet): number {
  return Math.min(...DIET.tracked[diet].map((k) => n[k]));
}
export const lowest = (n: Nutrients, diet: Diet): Nutrient =>
  DIET.tracked[diet].reduce((a, b) => (n[b] < n[a] ? b : a));

// A poor diet slows growth (to a third at nothing) and healing (to half).
export const dietGrowth = (b: number): number => lerp(0.35, 1, smooth(0, DIET.goodAbove, b));
export const dietHeal = (b: number): number => lerp(0.5, 1, smooth(0, DIET.goodAbove, b));
