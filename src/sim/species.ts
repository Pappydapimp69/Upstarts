// Playable species, with measured sizes (owner: "correct weights and measures"). Every mass is anchored on a bone or
// a published estimate, one method for the whole roster (Brain dlist/E93, E96), and where nothing is published the
// estimate and its basis are written down. Speeds follow leg length (equal Froude number) times a build factor, and
// are tuning, not facts (blueprint §2, §3). Hatchlings are sized from egg mass, not as a fixed fraction of the adult
// (Brain dlist/E92: egg = 0.090 x adult^0.311 kg, hatchling about 0.7 of the egg).
import type { CallStyle } from './calls';

export type Diet = 'carnivore' | 'omnivore' | 'rooter';
export type Plan = 'biped' | 'quad';

export interface Species {
  id: SpeciesId;
  name: string;
  binomial: string;
  blurb: string;
  plan: Plan; // two legs or four: four can't jump and don't go down when they lose their footing (owner)
  ecto: boolean; // a cold-blooded reptile: eats and drinks far less, and is sluggish at night
  length: number; // nose to tail, m
  hip: number; // hip height, m
  leg: number; // leg length, m
  mass: number; // kg
  walk: number; // full-stick speed without sprint, m/s
  sprintMin: number; // sprint speed at a light trigger press
  sprintMax: number; // top speed, m/s
  swim: number; // swimming speed, m/s (0: can't swim, wades only)
  reach: number; // how far from the hips it notices water to drink, m
  snout: number; // hips to lowered snout, m
  meat: number; // kg of meat its own carcass holds
  diet: Diet; // carnivore: meat only; omnivore: meat and ferns; rooter: ferns, roots and grubs, carrion, no hunting
  biteMult: number; // bite strength beyond what its mass gives
  // How it fights (world.ts). attack, with the jaws: bite; grab (bites and holds smaller prey in its hands while it
  // bites again); nip (quick bites, a long bleed, and it skips back out of reach); grip (a water ambusher holds on
  // and drowns); none (it doesn't bite to fight). defend, a move for what's behind or beside it: kick, swipe (tail).
  attack: 'bite' | 'grab' | 'nip' | 'grip' | 'none';
  defend: 'kick' | 'swipe' | null;
  hide: number; // armour: bites on it do 1/hide of the damage
  hatchSize: number; // hatchling length as a fraction of adult (from egg mass, below)
  toAdult: number; // s of well-fed play from hatching to adult
  calls: CallStyle; // what Y gives when it isn't a condition roar
}

export type SpeciesId = 'herrerasaurus' | 'eodromaeus' | 'panphagia' | 'proterochampsa' | 'aetosauroides' | 'sanjuansaurus';

// Hatchling length fraction from egg mass: hatchling = 0.7 x 0.090 x adult^0.311 kg, scaled isometrically.
export const hatchFraction = (adultMass: number): number => Math.cbrt((0.7 * 0.09 * Math.pow(adultMass, 0.311)) / adultMass);

// Speeds from hip height: walk 3.4 and sprint 7.4 m/s at a 1.15 m hip, scaled by sqrt(hip), times a build factor.
type In = Omit<Species, 'walk' | 'sprintMin' | 'sprintMax' | 'leg' | 'reach' | 'snout' | 'meat' | 'hatchSize'> & {
  build: number; neck?: number; legK?: number; walkK?: number; sprintK?: number;
};
function make(o: In): Species {
  const v = Math.sqrt(o.hip / 1.15) * o.build, k = o.length / 5.2;
  const { build: _b, neck = 1, legK = 1.026, walkK = 1, sprintK = 1, ...rest } = o;
  void _b;
  return {
    ...rest,
    leg: o.hip * legK,
    walk: 3.4 * v * walkK,
    sprintMin: 3.6 * v * Math.min(1, sprintK * 1.4) * walkK,
    sprintMax: 7.4 * v * sprintK,
    reach: 2.8 * k * neck,
    snout: 1.8 * k * neck,
    meat: o.mass * 0.4,
    hatchSize: hatchFraction(o.mass),
  };
}

// Herrerasaurus ischigualastensis: 270 kg (Brain dlist/E93: the biped-corrected Campione law gives 274 kg for the
// holotype PVL 2566; Benson et al. 2014 give 260 kg from limb circumferences). Hip 1.05 m from the 473 mm femur
// (femur + tibia at 0.9 femur + metatarsus, flexed). Length 4.8 m: 6 m and about 350 kg is the largest specimen
// (PVSJ 53), scaled by the cube root of mass. Hatches at about 0.36 kg.
export const HERRERASAURUS: Species = make({
  id: 'herrerasaurus', name: 'Herrerasaurus', binomial: 'Herrerasaurus ischigualastensis', plan: 'biped', ecto: false,
  length: 4.8, hip: 1.05, mass: 270, diet: 'carnivore', biteMult: 1, hide: 1, build: 1, swim: 0, calls: 'roar',
  // Long grasping hands with big curved claws, and a jaw joint that let it grip struggling prey (Sereno and Novas
  // 1993): it grabs and holds what it bites, if it can overpower it.
  attack: 'grab', defend: null,
  toAdult: 2.5 * 3600,
  blurb: 'The biggest dinosaur predator in the valley. Fully grown, even Saurosuchus gives it room.',
});

// Eodromaeus murphi: 1.2 m, 5 kg (Brain dlist/E90; published 4.5 to 7.1 kg). Femur 160 mm and a longer tibia
// (165 mm), hindlimb about 420 mm, so a 0.37 m hip; second only to Marasuchus for running build among Triassic
// archosaurs (Kubo and Kubo 2012).
export const EODROMAEUS: Species = make({
  id: 'eodromaeus', name: 'Eodromaeus', binomial: 'Eodromaeus murphi', plan: 'biped', ecto: false,
  length: 1.2, hip: 0.37, mass: 5, diet: 'carnivore', biteMult: 0.9, hide: 1, build: 0.95, legK: 1.1, swim: 0, calls: 'chuff',
  attack: 'nip', defend: null, // too small to hold anything: quick slashing bites, then out of reach (game design)
  toAdult: 1.2 * 3600,
  blurb: 'Small, quick and fragile. Hunts lizards, grubs and baby cynodonts, and lives by staying out of sight of everything bigger.',
});

// Panphagia protos: the holotype (PVSJ 874) is an immature 1.3 m animal (tibia 157 mm); an adult about 1.6 m,
// 12 kg scaled from Eodromaeus (Brain dlist/E95). Hip 0.42 m. An early sauropodomorph: longer neck, small head,
// leaf-shaped serrated teeth, an omnivore ("eats everything").
export const PANPHAGIA: Species = make({
  id: 'panphagia', name: 'Panphagia', binomial: 'Panphagia protos', plan: 'biped', ecto: false,
  length: 1.6, hip: 0.42, mass: 12, diet: 'omnivore', biteMult: 0.6, hide: 1, build: 0.9, neck: 1.4, swim: 0, calls: 'chuff',
  // Bites small prey, but defends with its long hind legs: a kick at whatever is behind or beside it (game design;
  // no fossil records how it fought).
  attack: 'bite', defend: 'kick',
  toAdult: 1.5 * 3600,
  blurb: 'An early long-necked dinosaur that eats ferns and whatever small thing it can catch. Never far from a meal, never safe.',
});

// Proterochampsa barrionuevoi: skull up to about 50 cm (Dilkes and Arcucci 2012), a low flat croc-like skull with the
// eyes and nostrils on top, which several authors read as semi-aquatic; non-cursorial limbs (tibia about 75% of the
// femur, Trotteyn 2011). Usually 1.8 to 2 m, up to about 3.5 m; we use a 2.5 m adult. No published mass: 60 kg is an
// estimate from crocodile-shaped animals of that length. A cold-blooded ambusher at the water's edge.
export const PROTEROCHAMPSA: Species = make({
  id: 'proterochampsa', name: 'Proterochampsa', binomial: 'Proterochampsa barrionuevoi', plan: 'quad', ecto: true,
  length: 2.5, hip: 0.36, mass: 60, diet: 'carnivore', biteMult: 1.3, hide: 1.2, build: 0.55, sprintK: 1, neck: 1.3, swim: 1.6, calls: 'hiss',
  attack: 'grip', defend: null,
  toAdult: 2 * 3600,
  blurb: 'A crocodile-like hunter that waits in the pond with only its eyes out, for whatever comes down to drink. Slow on land.',
});

// Aetosauroides scagliai: most individuals about 1.3 m, the largest about 2.4 m and 23 years old (Taborda et al.
// 2013); we use a 2.2 m adult. Mass not published: 160 kg is an estimate between the cube-scaled 1.3 m (about 45 kg)
// and 2.4 m sizes. Erect limbs, hind longer than fore (bone histology: terrestrial). A carapace of paired osteoderms
// from neck to tail. A shovel snout with a toothless tip and many small teeth: an omnivore that rooted for food
// (Paes Neto et al. 2021). Cold-blooded.
export const AETOSAUROIDES: Species = make({
  id: 'aetosauroides', name: 'Aetosauroides', binomial: 'Aetosauroides scagliai', plan: 'quad', ecto: true,
  length: 2.2, hip: 0.55, mass: 160, diet: 'rooter', biteMult: 0.35, hide: 2.2, build: 0.6, sprintK: 0.6, neck: 0.7, swim: 0, calls: 'hiss',
  // It doesn't bite to fight: it swings its long armoured tail at whatever is behind or beside it (game design).
  attack: 'none', defend: 'swipe',
  toAdult: 2.5 * 3600,
  blurb: 'Armoured from neck to tail. Roots up grubs and browses ferns. When something comes at it, it swings its tail, or lies flat and lets its plates take it.',
});

// Sanjuansaurus gordilloi: parked (it played like a small Herrerasaurus). Measured anyway: its 395 mm femur gives
// 102 to 169 kg (middle 133), hip about 0.86 m, length about 4.1 m (Brain dlist/E97).
export const SANJUANSAURUS: Species = make({
  id: 'sanjuansaurus', name: 'Sanjuansaurus', binomial: 'Sanjuansaurus gordilloi', plan: 'biped', ecto: false,
  length: 4.1, hip: 0.86, mass: 133, diet: 'carnivore', biteMult: 1.05, hide: 1, build: 1.02, swim: 0, calls: 'growl',
  attack: 'bite', defend: null,
  toAdult: 2 * 3600,
  blurb: 'A mid-sized cousin of Herrerasaurus.',
});

export const SPECIES: Record<SpeciesId, Species> = {
  herrerasaurus: HERRERASAURUS,
  eodromaeus: EODROMAEUS,
  panphagia: PANPHAGIA,
  proterochampsa: PROTEROCHAMPSA,
  aetosauroides: AETOSAUROIDES,
  sanjuansaurus: SANJUANSAURUS,
};
// The picker. Sanjuansaurus is parked: still in the data, not offered.
export const SPECIES_ORDER: SpeciesId[] = ['herrerasaurus', 'eodromaeus', 'panphagia', 'proterochampsa', 'aetosauroides'];
