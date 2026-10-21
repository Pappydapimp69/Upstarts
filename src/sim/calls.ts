// Calls, from the Dlist demo. f0k is pitch as a fraction of the vocal tract's highest clean open-mouth pitch
// (0.3 F1, Brain: dlist E8), so one table scales from adult to hatchling. amp is mixed so a roar sits about
// 10 dB over a footstep. level: dB at 1 m for an adult Herrerasaurus (smaller animals are quieter).
// challenge: a call a rival would answer.
export interface CallDef {
  label: string;
  note: string;
  mode: 'open' | 'closed';
  duration: number; // s
  f0k?: number;
  f0Endk?: number;
  f0abs?: number; // absolute pitch (a hiss is breath, not voice)
  roughness?: number;
  breath?: number;
  jitter?: number;
  amp: number;
  level: number;
  notes?: number;
  gap?: number;
  challenge?: boolean;
}

const TABLE = {
  roar: { label: 'Roar', note: 'challenge', mode: 'open', duration: 1.6, f0k: 0.8, f0Endk: 0.56, roughness: 0.55, amp: 3.2, level: 108, challenge: true },
  bellow: { label: 'Bellow', note: 'long call', mode: 'open', duration: 2.6, f0k: 0.7, f0Endk: 0.48, roughness: 0.25, breath: 0.1, amp: 3.0, level: 110, challenge: true },
  growl: { label: 'Growl', note: 'threat', mode: 'open', duration: 1.1, f0k: 0.45, f0Endk: 0.4, roughness: 0.95, breath: 0.25, jitter: 0.6, amp: 2.2, level: 92, challenge: true },
  boom: { label: 'Boom', note: 'closed mouth', mode: 'closed', duration: 1.9, roughness: 0.05, amp: 2.4, level: 98 },
  hiss: { label: 'Hiss', note: 'warning', mode: 'open', duration: 0.8, f0abs: 4, breath: 1, roughness: 0, jitter: 0, amp: 1.6, level: 80 },
  chuff: { label: 'Chuff', note: 'friendly', mode: 'open', duration: 0.22, notes: 2, gap: 0.3, f0k: 0.9, roughness: 0.2, breath: 0.5, amp: 1.6, level: 85 },
  // What Y plays depends on how the animal is: worn out, parched, starving, or fine.
  winded: { label: 'Winded roar', note: 'low stamina', mode: 'open', duration: 0.9, f0k: 0.7, f0Endk: 0.45, roughness: 0.35, breath: 0.6, amp: 2.0, level: 100, challenge: true },
  parched: { label: 'Parched roar', note: 'thirsty', mode: 'open', duration: 1.3, f0k: 0.8, f0Endk: 0.6, roughness: 0.8, breath: 0.55, amp: 2.6, level: 104, challenge: true },
  hungry: { label: 'Hungry roar', note: 'starving', mode: 'open', duration: 2.0, f0k: 0.6, f0Endk: 0.45, roughness: 0.7, breath: 0.2, amp: 3.2, level: 108, challenge: true },
  yelp: { label: 'Yelp', note: 'hurt', mode: 'open', duration: 0.3, f0k: 1.0, f0Endk: 0.7, roughness: 0.6, breath: 0.4, amp: 2.0, level: 92 },
} satisfies Record<string, CallDef>;

export type CallStyle = keyof typeof TABLE;
export const CALLS: Record<CallStyle, CallDef> = TABLE;
export const WHEEL: CallStyle[] = ['roar', 'bellow', 'growl', 'boom', 'hiss', 'chuff']; // clockwise from the top

// Y: the roar that fits how the animal is.
export function roarStyle(stamina: number, thirst: number, hunger: number): CallStyle {
  if (stamina < 0.3) return 'winded';
  if (thirst < 0.4) return 'parched';
  if (hunger < 0.4) return 'hungry';
  return 'roar';
}

// Loudness at 1 m for an animal of this mass: -10 dB per tenfold lighter, like footsteps.
export const callLevel = (style: CallStyle, mass: number): number => CALLS[style].level + 10 * Math.log10(mass / 350);

// Level heard at distance d (spherical spreading).
export const heardAt = (level: number, d: number): number => level - 20 * Math.log10(Math.max(1, d));
export const HERD_HEARS = 45; // dB: a Hyperodapedon startles at a call this loud
export const SAURO_HEARS = 45; // dB: a hungry Saurosuchus comes to look
