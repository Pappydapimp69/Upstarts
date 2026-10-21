import type { QuadLook } from './quadruped';

// The four-legged players' bodies, in adult metres (+z forward, origin on the ground under the hips). Proportions from
// the fossil descriptions (species.ts has the sources); colours and patterns are guesses.

// Proterochampsa barrionuevoi, 2.5 m: a low, flat-bodied croc-like animal on sprawling limbs, the tibia about three
// quarters of the femur. A big, flat, triangular skull, a fifth of the body (about 0.5 m), with the eyes and
// nostrils on top, a short neck, a row of small osteoderms down the back, and a long, deep tail to swim with.
export const PROTEROCHAMPSA_LOOK: QuadLook = {
  palette: { dorsal: '#2e3326', flank: '#55573e', belly: '#a39a78', band: 0.1 },
  hipH: 0.36, shoulderH: 0.32, hipZ: 0, shoulderZ: 0.5,
  trunk: [[-0.2, 0.3, 0.14, 0.11], [0.0, 0.31, 0.19, 0.13], [0.25, 0.31, 0.2, 0.13], [0.5, 0.29, 0.16, 0.11], [0.6, 0.29, 0.11, 0.09]],
  neckBase: [0.58, 0.3],
  neck: [[0, 0, 0.1, 0.08], [0.2, 0.0, 0.1, 0.065]],
  head: [[0, 0.01, 0.13, 0.065], [0.12, 0.0, 0.14, 0.055], [0.3, -0.01, 0.09, 0.04], [0.45, -0.015, 0.05, 0.03], [0.52, -0.02, 0.03, 0.02]],
  jawAt: [-0.04, 0.02],
  jaw: [[0, 0, 0.12, 0.025], [0.3, 0, 0.08, 0.02], [0.48, 0, 0.03, 0.015]],
  eye: [0.06, 0.065, 0.1, 0.02],
  tail: [
    [[0, 0, 0.11, 0.09], [-0.35, -0.02, 0.07, 0.08], [-0.55, -0.03, 0.05, 0.07]],
    [[0, 0, 0.05, 0.07], [-0.3, -0.01, 0.025, 0.05], [-0.5, 0, 0.008, 0.02]],
  ],
  hindLeg: [0.21, 0.16, 0.055, 0.13],
  foreLeg: [0.16, 0.13, 0.045, 0.09],
  stance: 0.26, sprawl: 0.7,
  armour: { rows: 1, plate: [0.05, 0.012, 0.06] },
  teeth: 14,
};

// Aetosauroides scagliai, 2.2 m: an erect-limbed armoured quadruped, hind legs longer than the fore, a broad flat
// trunk carapace of paired plates in rows from neck to tail, a small head (the skull only a few centimetres tall)
// with a shovel-shaped, toothless snout tip, and a long armoured tail.
export const AETOSAUROIDES_LOOK: QuadLook = {
  palette: { dorsal: '#4a4033', flank: '#6e5f49', belly: '#b19f80', band: 0.05 },
  hipH: 0.55, shoulderH: 0.45, hipZ: 0, shoulderZ: 0.55,
  trunk: [[-0.25, 0.5, 0.19, 0.17], [0.0, 0.52, 0.27, 0.21], [0.3, 0.5, 0.29, 0.21], [0.55, 0.46, 0.23, 0.17], [0.65, 0.45, 0.16, 0.12]],
  neckBase: [0.62, 0.46],
  neck: [[0, 0, 0.11, 0.09], [0.2, -0.02, 0.08, 0.07]],
  head: [[0, 0, 0.06, 0.055], [0.08, -0.005, 0.055, 0.045], [0.16, -0.02, 0.045, 0.03], [0.21, -0.03, 0.045, 0.02]],
  jawAt: [-0.035, 0.01],
  jaw: [[0, 0, 0.05, 0.018], [0.14, 0, 0.04, 0.014], [0.19, 0, 0.035, 0.01]],
  eye: [0.045, 0.025, 0.06, 0.012],
  tail: [
    [[0, 0, 0.16, 0.12], [-0.35, -0.04, 0.11, 0.1], [-0.55, -0.06, 0.08, 0.08]],
    [[0, 0, 0.08, 0.08], [-0.3, -0.03, 0.04, 0.05], [-0.45, -0.04, 0.01, 0.015]],
  ],
  hindLeg: [0.28, 0.26, 0.08, 0.14],
  foreLeg: [0.22, 0.21, 0.07, 0.11],
  stance: 0.24, sprawl: 0.25,
  armour: { rows: 4, plate: [0.09, 0.015, 0.09], spikes: 0.035 },
};

export const QUAD_LOOKS: Record<string, QuadLook> = { proterochampsa: PROTEROCHAMPSA_LOOK, aetosauroides: AETOSAUROIDES_LOOK };
