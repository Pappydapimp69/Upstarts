import { clamp, damp, lerp, smooth, wrapAngle } from './math';
import { gradeAlong, heightAt, MAP_RADIUS, TOO_DEEP, waterDepthAt } from './terrain';
import { fullNeeds, type Needs } from './needs';
import { bodyOf, type Body } from './growth';
import { pushOutOfTrees } from './flora';
import type { CallStyle } from './calls';
import type { Species, SpeciesId } from './species';

// What a player (or AI, or remote client) asks for this tick. World-space, so the
// sim never needs to know where a camera is.
export interface Command {
  moveX: number; // desired heading, world x (east)
  moveZ: number; // desired heading, world z; |(moveX, moveZ)| is stick strength 0..1
  sprint: number; // 0..1 trigger
  drink?: boolean; // held: drinks in reach of water, sniffs the air otherwise
  eat?: boolean; // held: bites live prey in front, eats a carcass otherwise
  respawn?: boolean; // pressed: respawn while dead, tear at the shell while in the egg
  species?: SpeciesId; // what to hatch as on respawn
  call?: CallStyle | 'auto'; // pressed: a call from the wheel, or 'auto' for Y's condition roar
  jump?: boolean; // pressed: crouch and leap
  rest?: boolean; // held: lie down and get its breath back
}

export const IDLE: Command = { moveX: 0, moveZ: 0, sprint: 0 };

export type Act = 'none' | 'turn' | 'shuffle' | 'drink' | 'eat' | 'browse' | 'bite' | 'sniff' | 'dig';

export interface Dino {
  species: Species;
  owner: number; // player number that controls it (-1: nobody)
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
  callT: number; // s since its last call started
  callDur: number; // length of that call, s
  gait: number; // footfalls so far (2 per stride), for footstep events
  sniff: { yaw: number; strength: number } | null; // strongest scent while sniffing
  egg: number; // presses left to tear out of its egg (0: hatched). In the egg it can't move or act.
  jump: Jump | null;
  air: number; // m above the ground (a jump)
  resting: boolean; // lying down (held)
  rest: number; // 0 standing .. 1 fully down, eased
  jumpLanded: number; // landing speed on the tick it touched down, else 0
  snap: boolean; // a bite on its way: the jaws close BITE.snap s after the press, on whatever is there then
}

// A leap (Dlist demo): a short crouch, then a ballistic arc, heavier on the way down.
export interface Jump {
  ph: 'crouch' | 'air';
  t: number;
  dur: number; // crouch length, s
  clear: number; // height it will reach, m
  vy: number;
  land: number; // landing speed, m/s (set on touchdown, for footfall loudness)
}

// Jumps and rest, from the Dlist demo. Standing hop about 0.4 m for an adult, a running leap up to about 1 m; the
// height scales with leg length and a little against mass (^-1/6). Stamina recovers at 2.75%/s on its feet and
// 30%/s lying down (the demo cut walking recovery to a quarter so resting matters).
export const JUMP = { minStamina: 0.06, g: 9.81, fall: 1.4 };
export const STAMINA = { sprint: -0.02, walk: 0.0275, rest: 0.3 };

export function createDino(species: Species, x: number, z: number, yaw: number, growth = 1): Dino {
  return {
    species, owner: -1, growth, body: bodyOf(species, growth), x, y: heightAt(x, z), z, yaw, speed: 0, yawRate: 0, accel: 0, grade: 0, stamina: 1,
    needs: fullNeeds(), act: 'none', alive: true, age: 0, biteT: 9, hitT: 9, callT: 9, callDur: 0, gait: 0, sniff: null, egg: 0,
    jump: null, air: 0, resting: false, rest: 0, jumpLanded: 0, snap: false,
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
  } else if (d.jump?.ph === 'air') {
    // Committed to the arc: no steering or pushing off in mid-air.
    target = d.speed;
    turnCap = 0;
  } else if (d.resting || d.rest > 0.3) {
    steer = false; // lying down, or still getting up
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
  // Badly hurt, it limps: down to 60% speed at the edge of death (the Dlist demo's limp, below 30%).
  if (d.alive && d.needs.health < 0.3) target *= lerp(0.6, 1, d.needs.health / 0.3);

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
  if (d.jump?.ph !== 'air') d.speed = d.speed < target ? Math.min(target, d.speed + up * dt) : Math.max(target, d.speed - (d.alive ? 4 : 9) * dt);
  d.accel = damp(d.accel, (d.speed - prev) / dt, 6, dt);

  const sprinting = isSprinting(d, cmd);
  // Rest: lie down while held and nearly still; stands back up when let go.
  if (d.resting) d.resting = !!cmd.rest && d.alive;
  else if (cmd.rest && d.alive && !d.jump && !ov && d.speed < 0.6) d.resting = true;
  d.rest = damp(d.rest, d.resting ? 1 : 0, d.resting ? 2.2 : 3.5, dt);
  if (cmd.jump && d.alive && !d.jump && !ov && !d.resting && d.rest < 0.3) startJump(d);
  const landed = stepJump(d, dt);

  if (d.alive) d.stamina = clamp(d.stamina + (sprinting ? STAMINA.sprint : d.jump ? 0 : d.rest > 0.8 ? STAMINA.rest : STAMINA.walk) * dt, 0, 1);
  d.jumpLanded = landed;

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
  d.y = heightAt(nx, nz) + d.air;
}

function startJump(d: Dino): void {
  if (d.stamina < JUMP.minStamina || waterDepthAt(d.x, d.z) > 0.4 * d.body.hip) return;
  const sz = d.body.size, run = smooth(0.5 * Math.sqrt(sz), 4.2 * Math.sqrt(sz), d.speed), cost = lerp(0.12, 0.22, run);
  const k = clamp(d.stamina / cost, 0.4, 1);
  d.stamina = Math.max(0, d.stamina - cost * k);
  const K = Math.pow(d.body.mass / 350, -1 / 6) * d.body.hip / 1.15;
  const fresh = K * lerp(0.55, 1, (k - 0.4) / 0.6);
  const clear = lerp(0.4, 1.0, run) * lerp(1, 0.75, smooth(4.5, 7.4, d.speed / Math.sqrt(sz))) * fresh;
  d.jump = { ph: 'crouch', t: 0, dur: lerp(0.3, 0.22, run) * Math.sqrt(Math.max(sz, 0.3)), clear, vy: 0, land: 0 };
}

// Advance a jump. Returns the landing speed on the tick it touches down, else 0.
function stepJump(d: Dino, dt: number): number {
  const j = d.jump;
  if (!j) return 0;
  j.t += dt;
  if (j.ph === 'crouch') {
    if (j.t >= j.dur) {
      j.ph = 'air';
      j.t = 0;
      j.vy = Math.sqrt(2 * JUMP.g * j.clear) + JUMP.g * dt * 0.5; // half-step so the fixed-step arc peaks at the target
    }
    return 0;
  }
  j.vy -= JUMP.g * (j.vy < 0 ? JUMP.fall : 1) * dt;
  d.air = Math.max(0, d.air + j.vy * dt);
  if (j.vy < 0 && d.air <= 0) {
    const v = -j.vy;
    d.air = 0;
    d.jump = null;
    d.speed *= 0.9;
    return v;
  }
  return 0;
}

// Above about two thirds of top speed (5 m/s for an adult) with the trigger held.
export const isSprinting = (d: Dino, cmd: Command): boolean => d.speed > 0.68 * d.body.sprintMax && cmd.sprint > 0.25;
