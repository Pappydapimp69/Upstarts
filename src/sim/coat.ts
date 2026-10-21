// Wet and mud on the body (the Dlist demo's skin state): tracked in horizontal bands up the body, so wading in to the
// knees wets the legs and lying in the mud cakes the flanks. Water soaks a band at once and it dries in 8 s; mud
// coats it, crusts dry after 8 s, and after 30 s of walking on a dry crust it flakes off over 7 s. Standing in water
// washes mud off in about a second. The bands are fractions of the hip height, so a hatchling's knees and an adult's
// knees are the same band. The renderer drives the model's skin shader from these.
export const COAT = {
  bands: 24,
  band: 0.085 / 1.15, // band height as a fraction of hip height (the demo rig: 0.085 m bands on a 1.15 m hip)
  dry: 8, // s for a soaked band to dry
  crust: 8, // s for wet mud to crust
  walkOff: 30, // s of walking on a dry crust before it starts to flake
  flake: 7, // s to flake off completely
  wash: 1.2, // s for water to wash a band's mud off
  lie: 0.6, // lying down lowers the body this far, as a fraction of the hip, into whatever it is in
};

export interface Coat {
  wet: Float32Array; // 0 dry .. 1 soaked
  mud: Float32Array; // 0 clean .. 1 coated
  dry: Float32Array; // mud: 0 wet .. 1 crusted
  walk: Float32Array; // s walked on a dry crust
  flake: Float32Array; // 0 .. 1 flaked off
}

export function newCoat(): Coat {
  const n = COAT.bands;
  return { wet: new Float32Array(n), mud: new Float32Array(n), dry: new Float32Array(n), walk: new Float32Array(n), flake: new Float32Array(n) };
}

// One tick. waterDepth and mudDepth are metres over the footing; rest 0..1 lying down; walking: moving on its feet.
export function stepCoat(c: Coat, hip: number, waterDepth: number, mudDepth: number, rest: number, walking: boolean, dt: number): void {
  const down = COAT.lie * hip * rest;
  const wd = waterDepth > 0 ? waterDepth + down : 0, md = mudDepth > 0 ? mudDepth + down : 0;
  for (let b = 0; b < COAT.bands; b++) {
    const y = b * COAT.band * hip;
    const inWater = y < wd, inMud = y < md;
    if (inMud) {
      c.mud[b] = 1;
      c.dry[b] = c.walk[b] = c.flake[b] = c.wet[b] = 0;
      continue;
    }
    if (inWater) {
      c.wet[b] = 1;
      if (c.mud[b] > 0) {
        c.mud[b] = Math.max(0, c.mud[b] - dt / COAT.wash);
        if (c.mud[b] === 0) c.dry[b] = c.flake[b] = c.walk[b] = 0;
      }
      continue;
    }
    c.wet[b] = Math.max(0, c.wet[b] - dt / COAT.dry);
    if (c.mud[b] <= 0) continue;
    if (c.dry[b] < 1) c.dry[b] = Math.min(1, c.dry[b] + dt / COAT.crust);
    else {
      if (walking) c.walk[b] += dt;
      if (c.walk[b] >= COAT.walkOff) {
        c.flake[b] = Math.min(1, c.flake[b] + dt / COAT.flake);
        if (c.flake[b] >= 1) c.mud[b] = c.dry[b] = c.flake[b] = c.walk[b] = 0;
      }
    }
  }
}

// A sudden soaking above the waterline (landing in water, or in mud): every band up to `top` metres.
export function soak(c: Coat, hip: number, top: number, mud: boolean): void {
  for (let b = 0; b < COAT.bands; b++) {
    if (b * COAT.band * hip >= top) break;
    if (mud) {
      c.mud[b] = 1;
      c.dry[b] = c.walk[b] = c.flake[b] = c.wet[b] = 0;
    } else c.wet[b] = 1;
  }
}

// How wet and how muddy the feet are (the bottom two bands): what grip and footprints care about.
export const wetFeet = (c: Coat): number => Math.max(c.wet[0], c.wet[1]);
export const mudFeet = (c: Coat): number => c.mud[0] * (1 - c.flake[0]);
export const mudFeetDry = (c: Coat): number => c.dry[0];
