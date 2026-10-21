// Game state and rules. No Three.js or DOM here: the sim must be able to run
// in a Web Worker or on a server unchanged (blueprint D2, D7).
import { createDino, stepDino, type Command, type Dino } from './dino';
import { HERRERASAURUS } from './species';

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

export const SPAWN = { x: 0, z: 15, yaw: Math.PI };

export interface World {
  tick: number;
  player: Dino;
}

export function createWorld(): World {
  return { tick: 0, player: createDino(HERRERASAURUS, SPAWN.x, SPAWN.z, SPAWN.yaw) };
}

export function step(world: World, cmd: Command): void {
  stepDino(world.player, cmd, TICK_DT);
  world.tick++;
}
