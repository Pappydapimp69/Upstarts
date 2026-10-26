// mulberry32: small seeded generator, so world layouts and spawns replay exactly.
// A stream's state is its one number, so a save stores that (never a count of draws: Brain save-system#E2, a
// position in a draw sequence silently points somewhere else once the sequence changes).
export type Rng = (() => number) & { state: () => number; setState: (s: number) => void };

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (() => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.state = () => a;
  next.setState = (s: number) => {
    a = s | 0;
  };
  return next;
}
