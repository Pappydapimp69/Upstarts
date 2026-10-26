// mulberry32: small seeded generator, so world layouts and spawns replay exactly.
// state reads or restores where the stream is, so a save can carry it (blueprint §6: save full RNG state).
export type Rng = (() => number) & { state: number };

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const f = (() => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  Object.defineProperty(f, 'state', { get: () => a, set: (v: number) => (a = v | 0) });
  return f;
}
