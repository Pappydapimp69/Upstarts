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
  kgPerHunger: 25, // kg of meat that fills an empty stomach
};

export interface Needs {
  hunger: number;
  thirst: number;
  health: number;
}

export const fullNeeds = (): Needs => ({ hunger: 1, thirst: 1, health: 1 });

// scale speeds the clock up for testing (?fast in the URL).
export function stepNeeds(n: Needs, sprinting: boolean, dt: number, scale = 1): void {
  const t = dt * scale;
  const healing = n.health < 1 && n.hunger > NEEDS.healAbove && n.thirst > NEEDS.healAbove;
  n.thirst = clamp(n.thirst - (t / NEEDS.thirstEmpty) * (sprinting ? NEEDS.sprintThirst : 1), 0, 1);
  n.hunger = clamp(n.hunger - (t / NEEDS.hungerEmpty) * (sprinting ? NEEDS.sprintHunger : 1) * (healing ? NEEDS.healHunger : 1), 0, 1);
  if (n.hunger <= 0 || n.thirst <= 0) n.health = clamp(n.health - NEEDS.starveDamage * t * ((n.hunger <= 0 ? 1 : 0) + (n.thirst <= 0 ? 1 : 0)), 0, 1);
  else if (healing) n.health = clamp(n.health + NEEDS.healRate * t, 0, 1);
}
