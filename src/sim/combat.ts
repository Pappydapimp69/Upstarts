import { clamp } from './math';

// Hit points come from the body: bigger, heavier animals have more. Max HP scales with mass^(2/3),
// the body's cross-section (it grows with both size and weight), 100 HP for an adult Herrerasaurus.
// Bite damage in HP scales the same way with the attacker (bite force goes with muscle cross-section),
// times a per-species bite strength. Size ratio still matters a lot: an adult Herrerasaurus takes a
// Hyperodapedon in two bites, a hatchling needs about two dozen, and Saurosuchus beats an adult one-on-one.
export const HP_REF = 100; // adult Herrerasaurus, 350 kg
export const BITE_REF = 33; // HP an adult Herrerasaurus bite takes

export const maxHp = (mass: number): number => HP_REF * Math.pow(mass / 350, 2 / 3);
export const biteHp = (attackerMass: number, mult = 1): number => BITE_REF * Math.pow(attackerMass / 350, 2 / 3) * mult;

// The fraction of the defender's health one bite takes (health is stored as 0..1 of max HP).
// hide: armor on the defender divides the damage (Saurosuchus's osteoderms).
export function biteDamage(attackerMass: number, defenderMass: number, mult = 1, hide = 1): number {
  return clamp(biteHp(attackerMass, mult) / hide / maxHp(defenderMass), 0, 1);
}

// Bites to kill from full health (for tuning and tests).
export const bitesToKill = (attackerMass: number, defenderMass: number, mult = 1, hide = 1): number =>
  Math.ceil((maxHp(defenderMass) * hide) / biteHp(attackerMass, mult) - 1e-9);
