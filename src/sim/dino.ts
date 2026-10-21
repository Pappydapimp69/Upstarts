import { clamp, damp, lerp, smooth, wrapAngle } from './math';
import { gradeAlong, heightAt, MAP_RADIUS, TOO_DEEP, waterDepthAt } from './terrain';
import { fullNeeds, type Needs } from './needs';
import { bodyOf, type Body } from './growth';
import { pushOutOfTrees } from './flora';
import type { Species } from './species';

// What a player (or AI, or remote client) asks for this tick. World-space, so the
// sim never needs to know where a camera is.
export interface Command {
  moveX: number; // desired heading, world x (east)
  moveZ: number; // desired heading, world z; |(moveX, moveZ)| is stick strength 0..1
  sprint: number; // 0..1 trigger
  drink?: boolean; // held: drinks in reach of water, sniffs the air otherwise
  eat?: boolean; // held: bites live prey in front, eats a carcass otherwise
  respawn?: boolean; // pressed, only read while dead
}

export const IDLE: Command = { moveX: 0, moveZ: 0, sprint: 0 };

export type Act = 'none' | 'turn' | 'shuffle' | 'drink' | 'eat' | 'bite' | 'sniff';

export interface Dino {
  species: Species;
  growth: number; // 0 hatchling .. 1 adult
  body: Body; // species numbers at the current growth
  x: number;
  y: number;
  z: number;
  yaw: number; // 0 faces +z
  speed: number;
  yawRate: number;
  accel: number;
  grade: number;
  stamina: number; // 0..1
  needs: Needs;
  act: Act;
  alive: boolean;
  age: number; // s alive
  biteT: number; // s since the last bite
  hitT: number; // s since it was last bitten
  sniff: { yaw: number; strength: number } | null; // strongest scent while sniffing
}

export function createDino(species: Species, x: number, z: number, yaw: number, growth = 1): Dino {
  return {
    species, growth, body: bodyOf(species, growth), x, y: heightAt(x, z), z, yaw, speed: 0, yawRate: 0, accel: 0, grade: 0, stamina: 1,
    needs: fullNeeds(), act: 'none', alive: true, age: 0, biteT: 9, hitT: 9, sniff: null,
  };
}

// Steering the world hands the controller instead of the stick: turn toward a
// point, then creep up to it (drinking, eating).
export interface Override {
  yaw: number;
  target: number; // speed, m/s
  turnCap: number; // rad/s
  steer: boolean;
}

// Movement controller ported from the Dlist demo (gait tuning lessons dlist/E2-E6).
export function stepDino(d: Dino, cmd: Command, dt: number, ov?: Override): void {
  const sp = d.body;
  let target = 0, desiredYaw = d.yaw, steer = false, turnCap = 9;
  if (!d.alive) {
    steer = false;
  } else if (ov) {
    ({ yaw: desiredYaw, target, turnCap, steer } = ov);
  } else {
    const mag = Math.min(1, Math.hypot(cmd.moveX, cmd.moveZ));
    if (mag > 0.02) {
      steer = true;
      desiredYaw = Math.atan2(cmd.moveX, cmd.moveZ);
      target = cmd.sprint > 0.25
        ? lerp(sp.sprintMin, sp.sprintMax, cmd.sprint) * Math.max(mag, 0.65)
        : sp.walk * mag;
    }
  }

  // Wading slows it, up to about half speed at hip depth.
  const depth = waterDepthAt(d.x, d.z);
  target *= 1 - clamp(depth / 1.2, 0, 1) * 0.55;

  // Hills: climbing costs work against gravity, so the slowdown scales with grade.
  // Gentle downhill helps a little; steep downhill has to be braked.
  const grade = gradeAlong(d.x, d.z, d.yaw);
  const k = lerp(1.2, 2.5, smooth(1.5, sp.sprintMax, target));
  d.grade = grade;
  target *= grade >= 0
    ? Math.max(0.6, 1 / (1 + k * grade))
    : clamp(1 + 0.25 * Math.min(-grade, 0.12) - 1.5 * Math.max(0, -grade - 0.15), 0.65, 1.04);

  // Turn rate falls with speed: 2.7 rad/s standing, 1.35 at a full sprint.
  const dy = wrapAngle(desiredYaw - d.yaw);
  const maxTurn = Math.min(turnCap, lerp(2.7, 1.35, clamp(d.speed / sp.sprintMax, 0, 1)));
  const turn = steer ? clamp(dy, -maxTurn * dt, maxTurn * dt) : 0;
  d.yaw = wrapAngle(d.yaw + turn);
  d.yawRate = damp(d.yawRate, turn / dt, 8, dt);
  if (Math.abs(dy) > 1.7 && !ov) target *= 0.35; // reversing: slow down and come round

  // Acceleration is capped by what the feet can carry (2.1 m/s^2 up to 5 m/s, 1.2 near 7); braking 4 m/s^2.
  const prev = d.speed;
  const up = lerp(2.1, 1.2, smooth(5, 7, d.speed));
  d.speed = d.speed < target ? Math.min(target, d.speed + up * dt) : Math.max(target, d.speed - (d.alive ? 4 : 9) * dt);
  d.accel = damp(d.accel, (d.speed - prev) / dt, 6, dt);

  const sprinting = isSprinting(d, cmd);
  if (d.alive) d.stamina = clamp(d.stamina + (sprinting ? -0.02 : 0.11) * dt, 0, 1);

  const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
  let nx = d.x + fx * d.speed * dt;
  let nz = d.z + fz * d.speed * dt;
  // Won't wade in over its depth: it pulls up at the edge.
  if (waterDepthAt(nx, nz) > TOO_DEEP || waterDepthAt(nx + fx * 1.6, nz + fz * 1.6) > TOO_DEEP + 0.1) {
    d.speed = Math.max(0, d.speed - 12 * dt);
    nx = d.x;
    nz = d.z;
  }
  // Soft map edge until the world has real bounds.
  const r = Math.hypot(nx, nz);
  if (r > MAP_RADIUS) {
    nx *= MAP_RADIUS / r;
    nz *= MAP_RADIUS / r;
  }
  [nx, nz] = pushOutOfTrees(nx, nz, 0.45 * sp.size);
  d.x = nx;
  d.z = nz;
  d.y = heightAt(nx, nz);
}

// Above about two thirds of top speed (5 m/s for an adult) with the trigger held.
export const isSprinting = (d: Dino, cmd: Command): boolean => d.speed > 0.68 * d.body.sprintMax && cmd.sprint > 0.25;
