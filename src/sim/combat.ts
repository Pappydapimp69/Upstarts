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

// Per-bite cap on the share of the defender's max HP, gated by the mass ratio r = attacker / defender.
// No damage curve stops one-bite kills once r passes 5-10x; only a cap on the defender's own max HP does
// (Brain: sandbox-power-scaling E2). The cap is uniform (player bites too): 40% up to r = 3, rising on a
// log scale to 100% at r = 8, so an animal only dies in one bite when it's massively outclassed.
// Adult Herrerasaurus vs Saurosuchus: 3 bites instead of 2, and it still loses one-on-one.
export function biteCap(attackerMass: number, defenderMass: number): number {
  const r = attackerMass / defenderMass;
  if (r <= 3) return 0.4;
  if (r >= 8) return 1;
  return 0.4 + (0.6 * Math.log(r / 3)) / Math.log(8 / 3);
}

// The fraction of the defender's health one bite takes (health is stored as 0..1 of max HP).
// hide: armor on the defender divides the damage (Saurosuchus's osteoderms).
export function biteDamage(attackerMass: number, defenderMass: number, mult = 1, hide = 1): number {
  return clamp(Math.min(biteHp(attackerMass, mult) / hide / maxHp(defenderMass), biteCap(attackerMass, defenderMass)), 0, 1);
}

// Bites to kill from full health (for tuning and tests).
export const bitesToKill = (attackerMass: number, defenderMass: number, mult = 1, hide = 1): number =>
  Math.ceil(1 / biteDamage(attackerMass, defenderMass, mult, hide) - 1e-9);
