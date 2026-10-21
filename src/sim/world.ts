// Game state and rules. No Three.js or DOM here: the sim must be able to run
// in a Web Worker or on a server unchanged (blueprint D2, D7).

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

export interface World {
  tick: number;
}

export function createWorld(): World {
  return { tick: 0 };
}

export function step(world: World): void {
  world.tick++;
}
