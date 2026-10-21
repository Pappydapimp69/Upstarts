// Body numbers per species. Herrerasaurus is the reference every scale factor is relative to.
export interface Species {
  name: string;
  hip: number; // hip height, m
  leg: number; // leg length, m
  mass: number; // kg
  walk: number; // full-stick speed without sprint, m/s
  sprintMin: number; // sprint speed at a light trigger press
  sprintMax: number; // top speed, m/s
}

export const HERRERASAURUS: Species = {
  name: 'Herrerasaurus',
  hip: 1.15,
  leg: 1.18,
  mass: 350,
  walk: 3.4,
  sprintMin: 3.6,
  sprintMax: 7.4,
};
