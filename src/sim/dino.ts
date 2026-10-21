import { clamp, damp, lerp, smooth, wrapAngle } from './math';
import { gradeAlong, MAP_RADIUS, TOO_DEEP, waterDepthAt } from './terrain';
import { groundAt, groundInfo, mudDepthAt, surfaceAt, TIER } from './ground';
import { newCoat, soak, stepCoat, type Coat } from './coat';
import { footCheck, startFall, stepFall, type Fall } from './balance';
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
  scrambled: number; // the tick a leap came up short and it clawed up over the edge: how far short, m; else 0
  coat: Coat; // wet and mud up the body
  fall: Fall | null; // a slip, stumble or trip in progress
  fallThud: boolean; // the tick a trip's body hit the ground
  fallStart: Fall | null; // the fall that started this tick, for its sound
}

// A leap (Dlist demo): a short crouch, then a ballistic arc, heavier on the way down.
export interface Jump {
  ph: 'crouch' | 'air';
  t: number;
  dur: number; // crouch length, s
  clear: number; // height it will reach, m
  vy: number;
  land: number; // landing speed, m/s (set on touchdown, for footfall loudness)
  y: number; // feet height in the air, absolute (rocks and ledges make "above the ground" a moving target)
  y0: number; // feet height at takeoff
  push: number; // forward speed it leaves the ground with when aiming for a ledge, m/s (0: none)
  drop: boolean; // stepped off an edge rather than jumped
}

// Jumps and rest, from the Dlist demo. Standing hop about 0.4 m for an adult, a running leap up to about 1 m; the
// height scales with leg length and a little against mass (^-1/6). Stamina recovers at 2.75%/s on its feet and
// 30%/s lying down (the demo cut walking recovery to a quarter so resting matters).
export const JUMP = { minStamina: 0.06, g: 9.81, fall: 1.4 };
export const STAMINA = { sprint: -0.02, walk: 0.0275, rest: 0.3 };

export function createDino(species: Species, x: number, z: number, yaw: number, growth = 1): Dino {
  return {
    species, owner: -1, growth, body: bodyOf(species, growth), x, y: groundAt(x, z), z, yaw, speed: 0, yawRate: 0, accel: 0, grade: 0, stamina: 1,
    needs: fullNeeds(), act: 'none', alive: true, age: 0, biteT: 9, hitT: 9, callT: 9, callDur: 0, gait: 0, sniff: null, egg: 0,
    jump: null, air: 0, resting: false, rest: 0, jumpLanded: 0, snap: false, scrambled: 0, coat: newCoat(), fall: null, fallThud: false, fallStart: null,
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
  // Mid-fall (demo): down, it can't move or steer; a slip barely checks it; a stumble halves its speed and its turning.
  d.fallThud = false;
  d.fallStart = null;
  if (d.fall) {
    const f = stepFall(d.fall, dt);
    d.fallThud = f.thud;
    if (f.done) d.fall = null;
  }
  if (d.fall) {
    if (d.fall.down) {
      target = 0;
      steer = false;
    } else if (d.fall.level === 'slip') target *= 0.9;
    else {
      target *= 0.5;
      turnCap = Math.min(turnCap, 1);
    }
  }

  // Wading slows it, up to about half speed at hip depth.
  const depth = waterDepthAt(d.x, d.z);
  target *= 1 - clamp(depth / 1.2, 0, 1) * 0.55;
  // Mud drags at the legs: up to half speed with it at three quarters of the hip (demo: 0.85 m on an adult).
  target *= 1 - clamp(mudDepthAt(d.x, d.z) / (0.74 * sp.hip), 0, 1) * 0.5;
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
  if (d.jump?.ph !== 'air') d.speed = d.speed < target ? Math.min(target, d.speed + up * dt) : Math.max(target, d.speed - (d.alive && !d.fall?.down ? 4 : 9) * dt); // down, it skids to a stop
  d.accel = damp(d.accel, (d.speed - prev) / dt, 6, dt);

  const sprinting = isSprinting(d, cmd);
  // Rest: lie down while held and nearly still; stands back up when let go.
  if (d.resting) d.resting = !!cmd.rest && d.alive;
  else if (cmd.rest && d.alive && !d.jump && !d.fall && !ov && d.speed < 0.6) d.resting = true;
  d.rest = damp(d.rest, d.resting ? 1 : 0, d.resting ? 2.2 : 3.5, dt);
  if (cmd.jump && d.alive && !d.jump && !d.fall && !ov && !d.resting && d.rest < 0.3) startJump(d);
  stepJump(d, dt);

  if (d.alive) d.stamina = clamp(d.stamina + (sprinting ? STAMINA.sprint : d.jump ? 0 : d.rest > 0.8 ? STAMINA.rest : STAMINA.walk) * dt, 0, 1);

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
  d.scrambled = 0;
  d.jumpLanded = footing(d, nx, nz, cmd, ov);
  if (d.alive) {
    const wd = waterDepthAt(d.x, d.z), md = mudDepthAt(d.x, d.z);
    // Coming down in water or mud throws it up the body, higher the harder it lands (demo jumpLand).
    if (d.jumpLanded > 0 && (wd > 0 || md > 0)) {
      const imp = clamp(d.jumpLanded / 5, 0, 1.3), k = sp.hip / 1.15;
      soak(d.coat, sp.hip, (wd > 0 ? wd + (0.3 + 0.3 * imp) * k : md + (0.25 + 0.25 * imp) * k), surfaceAt(d.x, d.z) === 'mud');
    }
    stepCoat(d.coat, sp.hip, wd, md, d.rest, d.speed > 0.3 && !d.jump, dt);
    // A bad landing on a rock, or one foot up and one down, gets the same stability check as a step (demo jumpLand).
    // A scramble comes in slow: the edge is the risk, not the impact.
    if (d.jumpLanded > 0 && !d.fall) {
      const imp = clamp(d.jumpLanded / 5, 0, 1.3), sx = Math.cos(d.yaw) * 0.13 * sp.size, sz = -Math.sin(d.yaw) * 0.13 * sp.size;
      const gL = groundAt(d.x - sx, d.z - sz), gR = groundAt(d.x + sx, d.z + sz), uneven = Math.abs(gL - gR) / (TIER.step * sp.hip);
      for (const side of [1, -1]) {
        const fx = d.x + side * sx, fz = d.z + side * sz;
        const c = footCheck(d, fx, fz, fx, fz, 0, d.scrambled ? imp * 0.5 : imp + uneven * 0.6, false);
        if (c && c.outcome !== 'ok') {
          d.fall = d.fallStart = startFall(d, c, side);
          break;
        }
      }
    }
  }
}

// A footfall, from the world's gait counter: where this foot lands and whether it holds (sim/balance.ts).
// side +1 right, -1 left; stride: m per full cycle (two footfalls).
export function footfall(d: Dino, side: number, stride: number, sprinting: boolean): void {
  if (!d.alive || d.fall || d.jump || d.air > 0) return;
  const v = d.speed, hip = d.body.hip, Fr = (v * v) / (9.81 * hip);
  const duty = 0.5 + 0.14 * Math.tanh((0.5 - Fr) / 0.25);
  const along = 0.5 * stride * duty; // it lands this far ahead of the hip
  const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), rx = Math.cos(d.yaw), rz = -Math.sin(d.yaw), lat = 0.13 * d.body.size * side;
  const x = d.x + fx * along + rx * lat, z = d.z + fz * along + rz * lat;
  const c = footCheck(d, x, z, x - fx * stride, z - fz * stride, along, 0, sprinting);
  if (c && c.outcome !== 'ok') d.fall = d.fallStart = startFall(d, c, side);
}

// Rocks, logs and ledges (demo: "Ground the movement stands on", "Jumps and ledges"), all against this animal's
// own hip height. A rise up to a step it walks up, paying a little speed; anything higher is a wall it slides along.
// A drop bigger than a step: pushing on, it steps off and falls; with the stick let go it stops at the edge.
// Returns the landing speed on the tick it comes down from a jump or a fall, else 0.
function footing(d: Dino, nx: number, nz: number, cmd: Command, ov?: Override): number {
  const hip = d.body.hip, stepH = TIER.step * hip, feet = d.y - d.air;
  const j = d.jump;
  if (j?.ph === 'air') {
    // In the air the feet clear anything below them; a face above the scramble height stops it dead.
    let g = groundAt(nx, nz);
    if (g > j.y + TIER.scramble * hip) {
      nx = d.x;
      nz = d.z;
      d.speed *= 0.3;
      g = groundAt(nx, nz);
    }
    d.x = nx;
    d.z = nz;
    if (j.vy < 0 && j.y <= g) {
      const short = g - j.y; // came down below the top: the feet caught the edge
      d.jump = null;
      d.air = 0;
      d.y = g;
      d.speed *= 0.9;
      if (g - j.y0 > stepH) d.speed *= 0.7; // landing up on a ledge checks the run
      if (short > 0.06 * d.body.size) {
        d.speed *= 0.6;
        d.stamina = Math.max(0, d.stamina - 0.05 * short / (TIER.scramble * hip));
        d.scrambled = short;
      }
      return -j.vy;
    }
    d.air = Math.max(0, j.y - g);
    d.y = j.y;
    return 0;
  }
  let g = groundAt(nx, nz);
  if (g - feet > stepH) {
    // A wall for this animal: slide along it if one axis is free, else stop.
    const gx = groundAt(nx, d.z), gz = groundAt(d.x, nz);
    if (gx - feet <= stepH) {
      nz = d.z;
      g = gx;
    } else if (gz - feet <= stepH) {
      nx = d.x;
      g = gz;
    } else {
      nx = d.x;
      nz = d.z;
      g = feet;
      d.speed = Math.min(d.speed, 0.3);
    }
    d.speed *= 0.85;
  } else if (feet - g > stepH && !j) {
    const pushing = !ov && Math.hypot(cmd.moveX, cmd.moveZ) > 0.2;
    if (pushing) {
      d.x = nx;
      d.z = nz;
      d.jump = { ph: 'air', t: 0, dur: 0, clear: 0, vy: 0, land: 0, y: feet, y0: feet, push: 0, drop: true };
      d.air = feet - g;
      d.y = feet;
      return 0;
    }
    nx = d.x;
    nz = d.z;
    g = feet;
    d.speed = 0;
  }
  // Stepping on or off a rock costs a little speed; plain terrain height is the grade model's job.
  const dh = g - feet;
  if (Math.abs(dh) > 0.5 * TIER.pebble * hip && (groundInfo(nx, nz).rock >= 0 || groundInfo(d.x, d.z).rock >= 0)) {
    d.speed *= 1 - Math.min(0.1, ((dh > 0 ? 0.16 : 0.08) * Math.abs(dh)) / hip);
  }
  d.x = nx;
  d.z = nz;
  d.air = 0;
  d.y = g;
  return 0;
}

function startJump(d: Dino): void {
  if (d.stamina < JUMP.minStamina || waterDepthAt(d.x, d.z) > 0.4 * d.body.hip) return;
  const sz = d.body.size, run = smooth(0.5 * Math.sqrt(sz), 4.2 * Math.sqrt(sz), d.speed), cost = lerp(0.12, 0.22, run);
  const k = clamp(d.stamina / cost, 0.4, 1);
  d.stamina = Math.max(0, d.stamina - cost * k);
  const K = Math.pow(d.body.mass / 350, -1 / 6) * d.body.hip / 1.15;
  const fresh = K * lerp(0.55, 1, (k - 0.4) / 0.6);
  let clear = lerp(0.4, 1.0, run) * lerp(1, 0.75, smooth(4.5, 7.4, d.speed / Math.sqrt(sz))) * fresh, push = 0;
  // A ledge ahead within reach: it crouches deeper, jumps just high enough and pushes forward enough to land on top,
  // so a standing jump onto a waist-high block works (demo ledge aim).
  const hip = d.body.hip, L = hip / 1.15, fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), feet = d.y - d.air;
  for (let a = 0.4 * L; a <= 3.4 * L; a += 0.1 * L) {
    if (groundAt(d.x + fx * a, d.z + fz * a) - feet <= TIER.step * hip) continue;
    let h = 0;
    for (let e = a; e <= a + 0.8 * L; e += 0.1 * L) h = Math.max(h, groundAt(d.x + fx * e, d.z + fz * e) - feet);
    const cap = lerp(0.85, 1.0, run) * fresh;
    if (h - TIER.scramble * hip < cap) {
      clear = clamp(h + 0.12 * L, clear, cap);
      const vy = Math.sqrt(2 * JUMP.g * clear), T = vy / JUMP.g + Math.sqrt((2 * Math.max(0, clear - h)) / (JUMP.g * JUMP.fall));
      push = Math.min(4.5 * Math.sqrt(L), (a + 0.6 * L) / T);
    }
    break;
  }
  d.jump = { ph: 'crouch', t: 0, dur: lerp(0.3, 0.22, run) * Math.sqrt(Math.max(sz, 0.3)) + (push ? 0.06 : 0), clear, vy: 0, land: 0, y: feet, y0: feet, push, drop: false };
}

// Advance a jump: the crouch, then the ballistic arc of the feet, heavier on the way down. Touchdown is decided by
// footing(), against the ground wherever it has got to.
function stepJump(d: Dino, dt: number): void {
  const j = d.jump;
  if (!j) return;
  j.t += dt;
  if (j.ph === 'crouch') {
    if (j.t >= j.dur) {
      j.ph = 'air';
      j.t = 0;
      j.vy = Math.sqrt(2 * JUMP.g * j.clear) + JUMP.g * dt * 0.5; // half-step so the fixed-step arc peaks at the target
      j.y = j.y0 = d.y - d.air;
      if (j.push) d.speed = Math.max(d.speed * 0.92, j.push);
    }
    return;
  }
  j.vy -= JUMP.g * (j.vy < 0 ? JUMP.fall : 1) * dt;
  j.y += j.vy * dt;
}

// Above about two thirds of top speed (5 m/s for an adult) with the trigger held.
export const isSprinting = (d: Dino, cmd: Command): boolean => d.speed > 0.68 * d.body.sprintMax && cmd.sprint > 0.25;
