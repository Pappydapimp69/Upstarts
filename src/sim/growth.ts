import { lerp } from './math';
import type { Species } from './species';

// Growth (blueprint §4): hatchling -> juvenile -> sub-adult -> adult. Grows only
// while fed and watered. Time to adult is a single tunable (open decision #2).
export const GROWTH = {
  toAdult: 2.5 * 60 * 60, // s of well-fed play from hatching to adult
  hatchSize: 0.22, // hatchling length as a fraction of adult
  fedAbove: 0.5, // hunger and thirst both above this to grow
};

export type Stage = 'hatchling' | 'juvenile' | 'sub-adult' | 'adult';

export function stageOf(growth: number): Stage {
  return growth < 0.25 ? 'hatchling' : growth < 0.55 ? 'juvenile' : growth < 0.85 ? 'sub-adult' : 'adult';
}

// Body numbers at a given growth. Lengths scale with size, mass with size cubed,
// and speeds with the square root of leg length (equal Froude number, as in the gait model).
export interface Body {
  size: number; // linear fraction of adult
  hip: number;
  leg: number;
  mass: number;
  walk: number;
  sprintMin: number;
  sprintMax: number;
  reach: number;
  snout: number;
  meat: number;
}

export function bodyOf(sp: Species, growth: number): Body {
  const s = lerp(GROWTH.hatchSize, 1, growth);
  const v = Math.sqrt(s);
  return {
    size: s,
    hip: sp.hip * s,
    leg: sp.leg * s,
    mass: sp.mass * s * s * s,
    walk: sp.walk * v,
    sprintMin: sp.sprintMin * v,
    sprintMax: sp.sprintMax * v,
    reach: sp.reach * s,
    snout: sp.snout * s,
    meat: sp.meat * s * s * s,
  };
}
