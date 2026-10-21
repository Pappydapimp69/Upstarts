// Procedural animation for the Dlist Herrerasaurus, ported from the demo's simStep:
// Froude-number gait and Alexander stride (dlist/E2-E3), feet planted with heading
// prediction (E6), lean from the feet (E4), heel lift, two-bone leg IK, the active
// tail held on the inside of turns (E7), walk-to-sprint posture, and the drink, sniff,
// eat, bite and pant poses. Rocks, stumbles and jumps are left out until those systems
// exist in Upstarts. Everything scales with body size so hatchlings animate too.
import * as THREE from 'three';
import { clamp, damp, lerp, smooth, wrapAngle } from '../../sim/math';
import { heightAt, WATER_Y } from '../../sim/terrain';
import { WIND_FROM_YAW } from '../../sim/scent';
import { buildHerrerasaurus, skinU } from './herrerasaurus.js';
import { LOOKS } from './shapes.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const AX = V(1, 0, 0);
const TAIL_W = [0.33, 0.32, 0.15, 0.1, 0.034, 0.033, 0.033]; // bend concentrated at the base: the rear tail was stiffened
const GULP_A = V(0, 1.42, 1.7), GULP_B = V(0, 1.06, 1.3);

const tmp = { v: V(), v2: V(), v3: V() };
function aimBone(bone, parentQ, rest, target) {
  const cur = tmp.v3.copy(rest).applyQuaternion(parentQ);
  const q = new THREE.Quaternion().setFromUnitVectors(cur, target.clone().normalize());
  const worldQ = q.multiply(parentQ);
  bone.quaternion.copy(parentQ.clone().invert().multiply(worldQ));
  return worldQ;
}
function solveKnee(H, A, a, b, pole) {
  const d0 = A.clone().sub(H); let d = d0.length(); const dir = d0.divideScalar(d || 1);
  d = clamp(d, Math.abs(a - b) + 0.02, a + b - 0.001);
  const x = (a * a - b * b + d * d) / (2 * d); const h = Math.sqrt(Math.max(a * a - x * x, 0));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return H.clone().addScaledVector(dir, x).addScaledVector(p, h);
}

export class HerreraAnimator {
  // speciesId: which body plan and palette to build (src/render/dlist/shapes.js).
  constructor(speciesId = 'herrerasaurus') {
    const look = LOOKS[speciesId] || LOOKS.herrerasaurus;
    const P = look.palette, U = skinU;
    U.uBack.value.copy(P.back); U.uFlank.value.copy(P.flank); U.uBelly.value.copy(P.belly);
    U.uStripe.value = P.stripe; U.uFurA.value.copy(P.furA); U.uFurB.value.copy(P.furB);
    this.speciesId = speciesId;
    this.dino = buildHerrerasaurus(look.shape);
    // The rig's own measurements (a reshaped species differs from the Herrerasaurus's 1.18 m pelvis).
    this.pelvisY = this.dino.pelvisY;
    this.rigHip = this.dino.hip;
    this.rigLeg = this.dino.leg;
    this.root = this.dino.rig;
    this.dino.B.lipU.userData.rest = this.dino.B.lipU.position.clone();
    this.size = 1;
    this.D = { phase: 0, cycleT: 1, run: 0, roll: 0, pitchF: 0, bodyY: 0, tailYaw: 0, tailYawV: 0, tailTurnYaw: 0, tailTurnSign: 0,
      hd: 0, hu: 0, tilt: 0, hyaw: 0, dip: 0, act: 'none', actT: 0, actU: 0, sprintT: 0, time: 0, lie: 0, side: 1 };
    this.placed = false;
    this.onStep = null; // (footPosition, side) on each touchdown
    this.onSound = null; // (kind, snoutPosition) for drinking, sniffing, tearing and the fall
  }

  // Put the feet down under the body (on spawn or a teleport).
  plant(x, z, yaw, size) {
    this.size = size;
    for (const L of this.dino.legs) {
      const w = L.neutral.clone().multiplyScalar(size).applyAxisAngle(UP, yaw).add(V(x, 0, z));
      w.y = heightAt(w.x, w.z) + 0.035 * size;
      L.planted.copy(w); L.footPos.copy(w); L.liftPos.copy(w); L.swing = false; L.groundY = w.y - 0.035 * size;
      L.liftS = 0; L.stanceU = 0; L.centre = 0;
    }
    Object.assign(this.D, { phase: 0, cycleT: 1, roll: 0, pitchF: 0, bodyY: 0, tailYaw: 0, tailYawV: 0, tailTurnYaw: yaw, lie: 0 });
    this.placed = true;
  }

  // s: { x, z, yaw, speed, accel, yawRate, act, alive, biteT, sprinting, size, dipY }
  update(s, dt) {
    const D = this.D, dino = this.dino, B = dino.B, sz = s.size;
    // Re-plant after a jump in position (spawn, teleport) or a growth step while standing.
    const far = this.dino.legs.some((L) => Math.hypot(L.planted.x - s.x, L.planted.z - s.z) > 3 * sz);
    if (!this.placed || far || (Math.abs(sz - this.size) > 0.02 && !s.speed)) this.plant(s.x, s.z, s.yaw, sz);
    this.size = sz;
    D.time += dt;
    if (s.act !== D.act) { D.act = s.act; D.actT = 0; D.actU = 0; } else D.actT += dt;
    D.sprintT = s.sprinting ? D.sprintT + dt : Math.max(0, D.sprintT - dt * 0.6);
    const fwd = V(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    const pos = V(s.x, 0, s.z);
    // Speeds in "adult" terms, so a hatchling's gait and posture blend like a scaled adult's.
    const vN = s.speed / Math.sqrt(sz);

    // ---- gait ----
    const HIP = this.rigHip, LEG = this.rigLeg;
    const v = s.speed, Fr = v * v / (9.81 * HIP * sz);
    const duty = 0.5 + 0.14 * Math.tanh((0.5 - Fr) / 0.25);
    const legL = LEG * sz;
    const stride = Math.max(0.8 * sz, 2.3 * legL * Math.pow(v * v / (9.81 * legL), 0.3));
    const rootG = heightAt(s.x, s.z);
    const legs = dino.legs, L0 = legs[0], L1 = legs[1];
    if (s.alive) {
      const anySwing = legs.some((L) => L.swing);
      const neutralW = (L) => L.neutral.clone().multiplyScalar(sz).applyAxisAngle(UP, s.yaw).add(pos);
      const anyErr = legs.some((L) => !L.swing && Math.hypot(L.planted.x - neutralW(L).x, L.planted.z - neutralW(L).z) > 0.3 * sz);
      if (v > 0.12 * sz || anySwing || anyErr) { const f = Math.max(v / stride, 0.95 / Math.sqrt(sz)); D.phase = (D.phase + f * dt) % 1; D.cycleT = 1 / f; }
      // Lean comes from the feet: plant the support window back when accelerating, forward when braking (E4).
      const lean = -0.11 * clamp(s.accel, -4, 2.1) * sz;
      for (const L of legs) {
        const q = (((D.phase + L.off) % 1) + 1) % 1;
        if (q < duty) {
          if (L.swing) { L.planted.copy(L.footPos); L.planted.y = heightAt(L.planted.x, L.planted.z) + 0.035 * sz; this.onStep?.(L.planted, L.sx); } // touchdown
          L.swing = false;
          L.footPos.copy(L.planted); L.liftS = 0; L.stanceU = q / duty; L.groundY = L.planted.y - 0.035 * sz;
          continue;
        }
        if (!L.swing) {
          L.swing = true; L.liftPos.copy(L.planted);
          L.centre = 0.5 * v * duty * D.cycleT; // speed frozen at lift-off (E6)
        }
        const sw = (q - duty) / (1 - duty), rem = (1 - sw) * (1 - duty) * D.cycleT;
        // Predict the heading at touchdown, and where the body will be by then (E6).
        const yawL = s.yaw + s.yawRate * rem, ym = s.yaw + s.yawRate * rem * 0.5;
        const lx = L.neutral.x * sz, lz = L.neutral.z * sz + L.centre + lean;
        const landX = s.x + lx * Math.cos(yawL) + lz * Math.sin(yawL) + Math.sin(ym) * v * rem;
        const landZ = s.z - lx * Math.sin(yawL) + lz * Math.cos(yawL) + Math.cos(ym) * v * rem;
        const gL = heightAt(landX, landZ);
        const e = sw * sw * (3 - 2 * sw);
        L.footPos.x = lerp(L.liftPos.x, landX, e); L.footPos.z = lerp(L.liftPos.z, landZ, e);
        const baseY = lerp(L.liftPos.y, gL + 0.035 * sz, e);
        L.footPos.y = baseY + Math.sin(Math.PI * sw) * Math.min(0.42, 0.12 + 0.045 * vN) * sz;
        L.liftS = sw; L.stanceU = 0; L.groundY = heightAt(L.footPos.x, L.footPos.z);
      }
    }

    // ---- death: topple onto its side ----
    const lie0 = D.lie;
    D.lie = s.alive ? 0 : Math.min(1, D.lie + dt / 0.45);
    if (D.lie >= 1 && lie0 < 1) this.onSound?.('thud', V(s.x, rootG, s.z));
    const lie = s.alive ? 0 : D.lie * D.lie;
    const fallRoll = -D.side * 1.35 * lie, fallDrop = 0.86 * lie, fallShift = D.side * 0.72 * lie;

    // ---- actions ----
    let jawOpen = 0, lunge = 0, flex = 0;
    if (s.biteT >= 0 && s.biteT < 0.56) {
      const o = s.biteT;
      const open = o < 0.16 ? smooth(0, 0.16, o) : o < 0.24 ? 1 - smooth(0.16, 0.24, o) : 0;
      jawOpen = Math.max(jawOpen, open * 0.62);
      lunge = o < 0.14 ? -0.35 * smooth(0, 0.14, o) : o < 0.26 ? lerp(-0.35, 1, smooth(0.14, 0.26, o)) : 1 - smooth(0.26, 0.55, o);
      // The mid-jaw joint lets the front of the lower jaw flex: down as it gapes, up as it clamps.
      flex = o < 0.16 ? 0.13 * smooth(0, 0.16, o) : o < 0.3 ? lerp(0.13, -0.09, smooth(0.16, 0.26, o)) : -0.09 * (1 - smooth(0.3, 0.52, o));
    }
    const pant = smooth(2, 5, D.sprintT);
    jawOpen = Math.max(jawOpen, pant * (0.12 + 0.06 * Math.sin(D.time * 9)));

    // ---- drink / sniff / eat head targets ----
    const snout = B.head.localToWorld(tmp.v.set(0, -0.09, 0.55));
    let hdT = 0, huT = 0, tiltT = 0, hyawT = 0, dipTo = null, scoop = 0, nose = 0, gulp = -1;
    if (D.act === 'turn') huT = 0.15;
    else if (D.act === 'shuffle') hdT = 0.35;
    else if (D.act === 'drink') {
      // Bird-style: lower, dip and scoop, lift and tip back to swallow, repeat.
      const t0 = 0.8, P = 2.3, c = D.actT, u = c < t0 ? -1 : (c - t0) % P;
      if (u < 0) { hdT = 1; dipTo = WATER_Y - 0.01; }
      else if (u < 0.55) { hdT = 1; dipTo = WATER_Y - 0.05; scoop = Math.sin(Math.PI * u / 0.55); }
      else if (u < 1.05) { hdT = lerp(1, 0.1, smooth(0.55, 1.0, u)); tiltT = smooth(0.75, 1.05, u); }
      else if (u < 1.8) { hdT = 0.1; tiltT = 1; gulp = (u - 1.05) / 0.75; }
      else { hdT = lerp(0.1, 1, smooth(1.8, 2.3, u)); tiltT = 1 - smooth(1.8, 2.1, u); }
      const pu = D.actU;
      if (u >= 0.15 && (pu < 0.15 || pu > u)) this.onSound?.('lap', snout);
      if (u >= 0.62 && pu < 0.62) this.onSound?.('drip', snout); // head coming up: water runs off the jaws
      if (u >= 1.12 && pu < 1.12) this.onSound?.('gulp', snout);
      D.actU = u;
    } else if (D.act === 'sniff') {
      // Head up, snout into the wind, short sharp sniffs in bursts of three with small scanning turns.
      hyawT = clamp(wrapAngle(WIND_FROM_YAW - s.yaw), -1.1, 1.1) + 0.16 * Math.sin(D.actT * 1.1); huT = 1;
      const bt = D.actT % 1.5;
      for (const ti of [0.1, 0.26, 0.42]) { nose += Math.exp(-(((bt - ti) / 0.035) ** 2)); if (bt >= ti && (D.actU < ti || D.actU > bt)) this.onSound?.('sniff', snout); }
      D.actU = bt;
    } else if (D.act === 'eat' || D.act === 'browse') {
      // Head down on the kill: grip, tear back, swallow.
      dipTo = s.dipY ?? null;
      hdT = 1; const P = 1.1, u = D.actT % P;
      jawOpen = Math.max(jawOpen, u < 0.35 ? 0.45 * smooth(0, 0.3, u) : 0.45 * (1 - smooth(0.35, 0.45, u)));
      tiltT = u > 0.45 && u < 0.85 ? 0.35 : 0;
      if (u >= 0.42 && (D.actU < 0.42 || D.actU > u)) this.onSound?.('tear', snout);
      D.actU = u;
    }
    D.hd = damp(D.hd, hdT, 5, dt); D.hu = damp(D.hu, huT, 4, dt); D.tilt = damp(D.tilt, tiltT, 6, dt); D.hyaw = damp(D.hyaw, hyawT, 4, dt);
    if (dipTo != null && D.hd > 0.6) D.dip = clamp(D.dip + (snout.y - dipTo) / sz * 2.5 * dt, -0.3, 0.8); else D.dip = damp(D.dip, 0, 2, dt);
    const gv = skinU.uGulp.value;
    if (gulp >= 0) { gv.copy(tmp.v2.copy(GULP_A).lerp(GULP_B, gulp)); gv.w = 0.045 * Math.sin(Math.PI * gulp); } else gv.w = 0;
    jawOpen = Math.max(jawOpen, scoop * 0.2);

    // ---- body pose ----
    D.run = damp(D.run, smooth(2.4, 6.6, vN), 2.5, dt);
    const run = D.run, mf = smooth(0.05, 0.6, vN) * (s.alive ? 1 : 0);
    const ph = D.phase * Math.PI * 2;
    const bob = -(0.012 + 0.016 * vN) * mf * (0.5 + 0.5 * Math.cos(2 * ph));
    const gF = heightAt(s.x + fwd.x * 1.2 * sz, s.z + fwd.z * 1.2 * sz), gB = heightAt(s.x - fwd.x * 1.2 * sz, s.z - fwd.z * 1.2 * sz);
    const slope = Math.atan2(gF - gB, 2.4 * sz);
    const fdz = (L0.footPos.x - L1.footPos.x) * fwd.x + (L0.footPos.z - L1.footPos.z) * fwd.z;
    const rollT = clamp((L0.groundY - L1.groundY) / sz * 0.9, -0.22, 0.22);
    const pitchT = Math.abs(fdz) < 0.25 * sz ? 0 : clamp(-Math.atan2((L0.groundY - L1.groundY) * Math.sign(fdz), Math.abs(fdz)) * 0.5, -0.2, 0.2);
    D.roll = damp(D.roll, rollT, 6, dt); D.pitchF = damp(D.pitchF, pitchT, 6, dt);
    const footLow = Math.min(L0.groundY, L1.groundY), footAvg = (L0.groundY + L1.groundY) / 2;
    D.bodyY = damp(D.bodyY, clamp(lerp(footAvg, footLow, 0.4) - rootG, -0.35 * sz, 0.55 * sz) * 0.85, 10, dt);
    dino.rig.position.set(s.x, rootG, s.z);
    dino.rig.rotation.set(0, s.yaw, 0);
    dino.rig.scale.setScalar(sz);
    const hd = D.hd, dip = D.dip * D.hd;
    // Walk: trunk a little nose-up. Sprint: trunk level and leaned forward, legs more bent.
    const pelvisPitch = -slope * 0.75 + D.pitchF + lerp(-0.03, 0.09, run) + hd * 0.22 + dip * 0.1 + lunge * 0.05;
    B.pelvis.position.set(fallShift, this.pelvisY - 0.085 * run + bob - hd * 0.16 - dip * 0.08 + D.bodyY / sz - fallDrop, 0);
    B.pelvis.rotation.set(pelvisPitch, 0.045 * Math.sin(ph) * mf, D.roll + fallRoll + 0.035 * Math.sin(ph) * mf);
    B.spine1.rotation.set(0, -0.025 * Math.sin(ph) * mf, 0);
    B.spine2.rotation.set(0, -0.02 * Math.sin(ph) * mf, 0);
    B.chest.rotation.set(0.008 * Math.sin(D.time * 1.6), 0, 0);
    const look = (1 - mf) * 0.14 * Math.sin(D.time * 0.37) * Math.sin(D.time * 0.23 + 1) * (D.act === 'none' ? 1 : 0);
    // Head counterbalances body roll on uneven footing (toward the high side).
    const nYaw = s.yawRate * 0.05 + D.hyaw + D.roll * 0.8;
    // Walk: relaxed S-curve neck, head high. Sprint: neck straight out and low, head in line with it.
    B.neck1.rotation.set(lerp(-0.14, 0.32, run) * (1 - hd) + hd * 0.62 + dip * 0.35 - D.hu * 0.22 - D.tilt * 0.04 + lunge * 0.1 - 0.35 * lie, nYaw * 0.25, 0.55 * D.side * lie);
    B.neck2.rotation.set(lerp(0.04, 0.17, run) * (1 - hd) + hd * 0.3 + dip * 0.2 - D.hu * 0.14 - D.tilt * 0.12 + lunge * 0.08, nYaw * 0.35 + look, 0.4 * D.side * lie);
    B.neck3.rotation.set(lerp(0.24, 0.05, run) * (1 - hd) + hd * 0.02 - D.hu * 0.06 - D.tilt * 0.22 + lunge * 0.04, nYaw * 0.25 + look * 0.6, 0);
    B.head.rotation.set(lerp(-0.08, -0.56, run) * (1 - hd) + slope * 0.35 + hd * 0.1 - D.hu * 0.22 - D.tilt * 0.45 + lunge * 0.05 - bob * 1.5 - nose * 0.05 - D.pitchF * 0.6, nYaw * 0.15, 0);
    B.jaw.rotation.set(jawOpen, 0, 0);
    B.jaw2.rotation.set(flex + scoop * 0.05, 0, 0);
    B.lipU.position.copy(B.lipU.userData.rest); B.lipU.position.y += 0.026 * smooth(0.04, 0.45, jawOpen);

    // ---- tail: active balance, held on the inside of the turn (E7) ----
    const aC = vN * Math.abs(s.yawRate);
    const hold = Math.asin(Math.min(Math.sin(0.5), 0.49 * aC));
    const sgn = Math.abs(s.yawRate) > 0.05 ? Math.sign(s.yawRate) : 0;
    if (sgn && sgn !== D.tailTurnSign) D.tailTurnYaw = s.yaw;
    D.tailTurnSign = sgn;
    const th = sgn ? Math.min(hold, Math.abs(wrapAngle(s.yaw - D.tailTurnYaw))) : hold;
    const cmd = -Math.sign(s.yawRate) * th - D.roll * 0.8 - D.side * 0.35 * lie;
    const w = 2 * Math.PI * 3;
    D.tailYawV += (w * w * (cmd - D.tailYaw) - 2 * w * D.tailYawV) * dt;
    D.tailYaw += D.tailYawV * dt;
    const wag = 0.07 * Math.sin(ph + 1.3) * mf * (1 - 0.5 * run) + 0.04 * Math.sin(D.time * 0.8) * (1 - mf);
    // Walk: slight droop. Sprint: held straight out.
    const tailPitch = lerp(-0.02, 0.03, run) + bob * 0.6 - lie * 0.06;
    dino.tails.forEach((t, k) => t.rotation.set(tailPitch * (1 + k * 0.1) + (k === 0 ? slope * 0.5 - D.pitchF * 0.5 - hd * 0.12 : 0), TAIL_W[k] * (D.tailYaw + wag), 0));
    for (const S of ['L', 'R']) {
      const sgnA = S === 'L' ? 1 : -1;
      B['upper' + S].rotation.set(0.12 * Math.sin(ph + (sgnA > 0 ? 0 : Math.PI)) * mf + lunge * 0.15 - lie * 0.4, 0, 0);
      B['fore' + S].rotation.set(-0.15, 0, 0);
      B['hand' + S].rotation.set(0.1 * Math.sin(D.time * 1.1 + sgnA), 0, 0);
    }
    dino.rig.updateMatrixWorld(true);

    // ---- leg IK ----
    const pelvisQ = B.pelvis.getWorldQuaternion(new THREE.Quaternion());
    for (const L of legs) {
      const H = L.thigh.getWorldPosition(V());
      const F = L.footPos.clone();
      if (!s.alive) {
        // On its side the feet leave the ground and hang below the hip in the body's own frame.
        const tgt = B.pelvis.localToWorld(V(L.sx * 0.2, -0.82, 0.18));
        F.lerp(tgt, smooth(0, 0.6, D.lie));
      }
      const swing = (L.liftS || 0) > 0;
      // Heel lifts through stance toward toe-off; more if the hip would otherwise be out of reach (E3).
      let lift = swing ? -Math.sin(Math.PI * L.liftS) * 0.45 : 0.45 * smooth(0.35, 1, L.stanceU || 0) * smooth(0.8, 4, vN);
      const reach = (L.thighLen + L.shinLen - 0.015) * sz;
      let metaDir, A;
      for (let it = 0; it < 8; it++) {
        metaDir = L.metaRest.clone().applyAxisAngle(AX, lift).applyAxisAngle(UP, s.yaw);
        A = F.clone().addScaledVector(metaDir, -L.metaLen * sz);
        if (A.distanceTo(H) <= reach) break;
        lift += 0.14;
      }
      const side = V(1, 0, 0).applyAxisAngle(UP, s.yaw);
      const pole = fwd.clone().addScaledVector(side, L.sx * 0.12);
      const K = solveKnee(H, A, L.thighLen * sz, L.shinLen * sz, pole);
      let q = aimBone(L.thigh, pelvisQ, L.thighRest, K.clone().sub(H));
      const shinDir = A.clone().sub(K).normalize();
      q = aimBone(L.shin, q, L.shinRest, shinDir);
      A = K.clone().addScaledVector(shinDir, L.shinLen * sz);
      q = aimBone(L.meta, q, L.metaRest, F.clone().sub(A));
      const curl = swing ? Math.sin(Math.PI * L.liftS) * 0.6 : 0;
      const toeDir = fwd.clone().multiplyScalar(Math.cos(curl)).add(V(0, -Math.sin(curl) - 0.06, 0));
      aimBone(L.toe, q, L.toeRest, toeDir);
    }
    dino.rig.updateMatrixWorld(true);
  }

  // World position of the chest, for the camera to follow.
  chest(out) { return this.dino.B.spine2.getWorldPosition(out); }
  // World position of the snout tip, where mouth sounds come from.
  snout() { return this.dino.B.head.localToWorld(V(0, -0.09, 0.55)); }
}
