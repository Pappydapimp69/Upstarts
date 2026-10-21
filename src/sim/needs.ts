import { clamp } from './math';

// Survival stats (blueprint §4, D12). All 0..1, 1 = full / healthy.
// Drain is a base rate over time plus extra for effort: a pure timer taxes exploring,
// a pure per-action meter makes standing still free (ideas: SURVIVAL/needs-meters).
export const NEEDS = {
  thirstEmpty: 10 * 60, // s from full to empty at rest
  hungerEmpty: 16 * 60,
  sprintThirst: 1.6, // multipliers while sprinting
  sprintHunger: 1.5,
  healHunger: 1.5, // multiplier while healing
  starveDamage: 1 / 120, // health/s at an empty hunger or thirst (2 min to die from full)
  healRate: 1 / 300, // health/s when fed and watered
  healAbove: 0.5, // both hunger and thirst above this to heal
  drinkRate: 0.15, // thirst/s while drinking (empty to full in about 7 s)
  eatRate: 2, // kg of meat/s while eating
  kgPerHunger: 25, // kg of meat that fills an adult Herrerasaurus's empty stomach (scales with body mass)
  browseRate: 1 / 40, // hunger/s while an omnivore browses ferns (empty to full in 40 s)
};

export interface Needs {
  hunger: number;
  thirst: number;
  health: number;
}

export const fullNeeds = (): Needs => ({ hunger: 1, thirst: 1, health: 1 });

// Small animals burn through food and water faster: hunger and thirst run at (350 / adult mass)^0.324,
// so Eodromaeus eats about every 4 minutes and Herrerasaurus every 16 (Brain: compress hunger with one
// factor for all species, keeping the real mass^0.324 spread).
export const needPace = (adultMass: number): number => Math.pow(350 / adultMass, 0.324);

// Cold-blooded reptiles run on far less: field metabolic rate (Nagy) puts endotherms 7.1x above ectotherms at 5 kg and
// 3.2x at 200 kg (Brain dlist: hunger from FMR). Hunger slows by that gap; thirst by its square root (less water lost
// through breath and skin, but they still drink).
export const ectoGap = (adultMass: number): number => 7.1 * Math.pow(adultMass / 5, -0.23);

// scale speeds the clock up for testing (?fast in the URL); pace is needPace for the species.
export function stepNeeds(n: Needs, sprinting: boolean, dt: number, scale = 1, pace = 1, gap = 1): void {
  const t = dt * scale;
  const tp = t * pace;
  const tpH = tp / gap, tpT = tp / Math.sqrt(gap);
  const healing = n.health < 1 && n.hunger > NEEDS.healAbove && n.thirst > NEEDS.healAbove;
  n.thirst = clamp(n.thirst - (tpT / NEEDS.thirstEmpty) * (sprinting ? NEEDS.sprintThirst : 1), 0, 1);
  n.hunger = clamp(n.hunger - (tpH / NEEDS.hungerEmpty) * (sprinting ? NEEDS.sprintHunger : 1) * (healing ? NEEDS.healHunger : 1), 0, 1);
  if (n.hunger <= 0 || n.thirst <= 0) n.health = clamp(n.health - NEEDS.starveDamage * t * ((n.hunger <= 0 ? 1 : 0) + (n.thirst <= 0 ? 1 : 0)), 0, 1);
  else if (healing) n.health = clamp(n.health + NEEDS.healRate * t, 0, 1);
}
