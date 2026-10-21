import { clamp } from './math';

// Bite damage as a fraction of the defender's health. Size ratio matters a lot
// (blueprint §4): it scales with the square root of attacker over defender mass.
// Tuned so an adult Herrerasaurus kills a Hyperodapedon in three bites and loses
// one-on-one to an adult Saurosuchus (blueprint §3).
export const BITE_BASE = 0.16;

export function biteDamage(attackerMass: number, defenderMass: number, mult = 1): number {
  return clamp(BITE_BASE * Math.sqrt(attackerMass / defenderMass) * mult, 0, 1);
}
