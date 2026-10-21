import type { SoundEvent } from './events';

// Hearing from sim sound events (blueprint §9, Brain: sound-engine/E7). Animals hear the events the sim
// emitted on the previous tick, never what the audio engine played, so what you hear and what they hear
// agree, and a replay is identical with sound on, off or muted.

// dB at 1 m for a footfall: 62 for an adult Herrerasaurus walking at 3.4 m/s, +10 dB per tenfold mass,
// +4.5 dB per doubling of impact speed (Dlist demo). Physical loudness can't tell a small animal's walk from
// its sprint (only about 7 dB apart), so a sprint footfall gets a +10 dB noise rating on top (Dlist E31).
export const STEP_DB = (mass: number, speed: number): number => 62 + 10 * Math.log10(mass / 350) + 15 * Math.log10(Math.max(speed, 0.3) / 3.4);
export const SPRINT_DB = 10;

// Level heard at distance d (spherical spreading).
export const atDistance = (level: number, d: number): number => level - 20 * Math.log10(Math.max(1, d));

// Did a listener at (x, z) hear anything from source `id` at or above `threshold` dB? Returns where.
export function heardFrom(events: SoundEvent[], id: number, x: number, z: number, threshold: number): SoundEvent | null {
  for (const ev of events) {
    if (ev.id !== id) continue;
    if (atDistance(ev.level, Math.hypot(ev.x - x, ev.z - z)) >= threshold) return ev;
  }
  return null;
}
