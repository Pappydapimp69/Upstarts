// Playable species. Herrerasaurus is the reference every scale factor is relative to. Sizes are adult
// estimates from the fossil literature, rounded; speeds follow leg length (equal Froude number) times a
// build factor; all are starting points for tuning, not facts (blueprint §2, §3).
export type Diet = 'carnivore' | 'omnivore';

export interface Species {
  id: SpeciesId;
  name: string;
  blurb: string;
  length: number; // nose to tail, m
  hip: number; // hip height, m
  leg: number; // leg length, m
  mass: number; // kg
  walk: number; // full-stick speed without sprint, m/s
  sprintMin: number; // sprint speed at a light trigger press
  sprintMax: number; // top speed, m/s
  reach: number; // how far from the hips it notices water to drink, m
  snout: number; // hips to lowered snout, m
  meat: number; // kg of meat its own carcass holds
  diet: Diet;
  biteMult: number; // bite strength beyond what its mass gives
  hatchSize: number; // hatchling length as a fraction of adult
  toAdult: number; // s of well-fed play from hatching to adult
}

export type SpeciesId = 'herrerasaurus' | 'eodromaeus' | 'panphagia' | 'sanjuansaurus';

// Speeds from hip height: walk 3.4 and sprint 7.4 m/s at Herrerasaurus's 1.15 m, scaled by sqrt(hip),
// times a build factor (a lightly built runner is faster for its size).
function make(o: Omit<Species, 'walk' | 'sprintMin' | 'sprintMax' | 'leg' | 'reach' | 'snout' | 'meat'> & { build: number; neck?: number }): Species {
  const v = Math.sqrt(o.hip / 1.15) * o.build, k = o.length / 5.2;
  const { build: _b, neck = 1, ...rest } = o;
  void _b;
  return {
    ...rest,
    leg: o.hip * 1.026,
    walk: 3.4 * v,
    sprintMin: 3.6 * v,
    sprintMax: 7.4 * v,
    reach: 2.8 * k * neck,
    snout: 1.8 * k * neck,
    meat: o.mass * 0.4,
  };
}

export const HERRERASAURUS: Species = make({
  id: 'herrerasaurus', name: 'Herrerasaurus', length: 5.2, hip: 1.15, mass: 350, diet: 'carnivore', biteMult: 1, build: 1,
  hatchSize: 0.22, toAdult: 2.5 * 3600,
  blurb: 'The biggest dinosaur predator in the valley. A strong bite, but it still loses one-on-one to an adult Saurosuchus.',
});

export const EODROMAEUS: Species = make({
  id: 'eodromaeus', name: 'Eodromaeus', length: 1.2, hip: 0.33, mass: 5, diet: 'carnivore', biteMult: 0.9, build: 0.9,
  hatchSize: 0.35, toAdult: 1.2 * 3600,
  blurb: 'Small and fragile. Scavenges and snaps up what it can, and survives by staying beneath notice.',
});

export const PANPHAGIA: Species = make({
  id: 'panphagia', name: 'Panphagia', length: 1.6, hip: 0.38, mass: 10, diet: 'omnivore', biteMult: 0.6, build: 1, neck: 1.4,
  hatchSize: 0.33, toAdult: 1.5 * 3600,
  blurb: 'An early long-necked plant eater that still takes meat. Browses ferns, so it rarely goes hungry: the easy start.',
});

export const SANJUANSAURUS: Species = make({
  id: 'sanjuansaurus', name: 'Sanjuansaurus', length: 3.0, hip: 0.68, mass: 60, diet: 'carnivore', biteMult: 1.1, build: 1.05,
  hatchSize: 0.27, toAdult: 2 * 3600,
  blurb: 'A mid-sized cousin of Herrerasaurus. Big enough to take Hyperodapedon, small enough to stay off Saurosuchus\'s menu for a while.',
});

export const SPECIES: Record<SpeciesId, Species> = {
  herrerasaurus: HERRERASAURUS,
  eodromaeus: EODROMAEUS,
  panphagia: PANPHAGIA,
  sanjuansaurus: SANJUANSAURUS,
};
export const SPECIES_ORDER: SpeciesId[] = ['herrerasaurus', 'sanjuansaurus', 'eodromaeus', 'panphagia'];
