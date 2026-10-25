import * as THREE from 'three';
import { clamp, damp, lerp, smooth } from '../sim/math';
import { groundAt } from '../sim/ground';
import { WATER_Y } from '../sim/terrain';
import { COAT, type Coat } from '../sim/coat';
import { buildQuadModel, QUAD_SPECS, reptileU } from './dlist/quadModel.js';

// Four-legged players (Proterochampsa, Aetosauroides): one lofted, skinned body over a bone chain (dlist/quadModel.js),
// animated the way the Herrerasaurus is (dlist/E2-E6): gait clock on the Froude number, stride from Alexander's
// relation, each foot planted where the body will be at touchdown and reached by two-bone IK, the trunk pitched and
// rolled by where the feet stand. A lateral-sequence walk blends into a trot; a sprawler's spine swings side to side
// with its stride. In water a swimmer tucks its legs and drives with its tail. No jumping and no falling over (four
// legs; the owner's rule), but a slip still shows. Built in adult metres, +z forward, origin on the ground under the
// hips; scaled for growth.

const V = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

type Bone = THREE.Bone;
interface LegRig {
  S: string; front: boolean; sx: number; thigh: Bone; shin: Bone; meta: Bone; toe: Bone;
  thighRest: THREE.Vector3; shinRest: THREE.Vector3; metaRest: THREE.Vector3;
  thighLen: number; shinLen: number; metaLen: number; neutral: THREE.Vector3;
}
interface QLeg extends LegRig {
  off: number; // gait phase offset
  planted: THREE.Vector3;
  footPos: THREE.Vector3;
  liftPos: THREE.Vector3;
  swing: boolean;
  liftS: number;
  groundY: number;
  centre: number; // stance-centring offset, frozen at lift-off (Brain: dlist E6)
}
interface QuadModel {
  rig: THREE.Group; B: Record<string, Bone>; bodyMesh: THREE.SkinnedMesh; legs: LegRig[]; tails: Bone[]; hip: number; bodyVEnd: number;
}
interface QuadSpec { J: Record<string, THREE.Vector3>; hind: { hip: number[] }; fore: { hip: number[] } }

// Turn bone so its rest direction (in the bind frame) points along world target; returns its new world rotation.
function aimBone(bone: Bone, parentQ: THREE.Quaternion, rest: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
  const cur = rest.clone().applyQuaternion(parentQ);
  const worldQ = new THREE.Quaternion().setFromUnitVectors(cur.normalize(), target.clone().normalize()).multiply(parentQ);
  bone.quaternion.copy(parentQ.clone().invert().multiply(worldQ));
  return worldQ;
}
function solveKnee(H: THREE.Vector3, A: THREE.Vector3, a: number, b: number, pole: THREE.Vector3): THREE.Vector3 {
  const d0 = A.clone().sub(H);
  let d = d0.length();
  const dir = d0.divideScalar(d || 1);
  d = clamp(d, Math.abs(a - b) + 0.02, a + b - 0.001);
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return H.clone().addScaledVector(dir, x).addScaledVector(perp, h);
}

// Per-frame state from the sim, as the Herrerasaurus animator takes it, plus swim (0 on land .. 1 floating) and
// under (0 at the surface .. 1 lying low with only eyes and nostrils out).
export interface QuadState {
  x: number; z: number; yaw: number; speed: number; accel: number; yawRate: number; act: string; alive: boolean;
  biteT: number; sprinting: boolean; size: number; dipY?: number; rest: number; swim: number; under: number;
  biteHit?: boolean; hurtT?: number; hurtSide?: number; hurtK?: number;
  strike?: { kind: 'kick' | 'swipe'; t: number; side: number } | null; // a tail swipe in progress
  holding?: boolean; // gripping prey
  fall?: { level: string; t: number; dur: number; side: number; sev: number } | null;
  [extra: string]: unknown; // the biped's inputs it ignores (crouch, air, bodyK)
}

export const isQuad = (id: string): boolean => id in QUAD_SPECS;

export class QuadAnimator {
  readonly quad = true;
  readonly root: THREE.Group;
  readonly rigHip: number;
  readonly speciesId: string;
  onStep: ((foot: THREE.Vector3, side: number) => void) | null = null;
  onSound: ((kind: 'lap' | 'drip' | 'gulp' | 'sniff' | 'tear' | 'thud', at: THREE.Vector3) => void) | null = null;
  private readonly m: QuadModel;
  private readonly legs: QLeg[];
  private readonly J: Record<string, THREE.Vector3>;
  private readonly sprawl: number; // how far the knees and elbows stand out (0 upright)
  private readonly stance: number; // half-width between the feet
  private readonly span: number; // hips to shoulders
  private readonly bands: number[][]; // body vertices by coat band, for drips and flakes
  private readonly rest0: Record<string, THREE.Vector3> = {};
  private phase = 0;
  private cycleT = 1;
  private size = 1;
  private placed = false;
  private rootG = 0;
  private bodyY = 0;
  private pitch = 0;
  private roll = 0;
  private lie = 0;
  private time = 0;
  private act = 'none';
  private actT = 0;
  private hd = 0; // head down 0..1
  private tailYaw = 0;
  private tailV = 0;
  private lastK = 0; // where the eating cycle was last frame (for its sounds)
  private readonly side = 1;

  constructor(speciesId: string) {
    this.speciesId = speciesId;
    const spec = (QUAD_SPECS as unknown as Record<string, QuadSpec>)[speciesId];
    this.m = buildQuadModel(spec) as unknown as QuadModel;
    this.J = spec.J;
    this.root = this.m.rig;
    this.rigHip = this.m.hip;
    for (const [k, b] of Object.entries(this.m.B)) this.rest0[k] = b.position.clone();
    this.legs = this.m.legs.map((L) => ({ ...L, off: 0, planted: V(), footPos: V(), liftPos: V(), swing: false, liftS: 0, groundY: 0, centre: 0 }));
    const hind = this.legs.find((L) => !L.front)!, fore = this.legs.find((L) => L.front)!;
    this.stance = (Math.abs(hind.neutral.x) + Math.abs(fore.neutral.x)) / 2;
    // The sprawl: how far out the knee stands beyond the hip, against the leg's length.
    this.sprawl = clamp((Math.abs(hind.neutral.x) - Math.abs(spec.hind.hip[0])) / (hind.thighLen + hind.shinLen) * 3, 0, 1);
    this.span = fore.neutral.z - hind.neutral.z;
    // Bind-pose heights of the body surface, banded the way the coat is.
    const pos = this.m.bodyMesh.geometry.attributes.position, bh = COAT.band * this.rigHip;
    this.bands = Array.from({ length: COAT.bands }, () => []);
    for (let i = 0; i < this.m.bodyVEnd; i++) this.bands[clamp(Math.floor(pos.getY(i) / bh), 0, COAT.bands - 1)].push(i);
  }

  private neutralW(L: QLeg, x: number, z: number, yaw: number, sz: number): THREE.Vector3 {
    return L.neutral.clone().multiplyScalar(sz).applyAxisAngle(UP, yaw).add(V(x, 0, z));
  }

  plant(x: number, z: number, yaw: number, size: number): void {
    this.size = size;
    for (const L of this.legs) {
      const w = this.neutralW(L, x, z, yaw, size);
      w.y = groundAt(w.x, w.z);
      L.planted.copy(w);
      L.footPos.copy(w);
      L.liftPos.copy(w);
      L.swing = false;
      L.liftS = 0;
      L.groundY = w.y;
    }
    this.rootG = groundAt(x, z);
    this.phase = 0;
    this.placed = true;
  }

  // The coat (wet and mud bands) on this body. The shader bands are bind-pose heights: fractions of the rig's hip.
  setCoat(c: Coat, _hip: number, alive: boolean): void {
    reptileU.qWet.value.set(c.wet);
    reptileU.qMud.value.set(c.mud);
    reptileU.qDry.value.set(c.dry);
    reptileU.qFlake.value.set(c.flake);
    reptileU.qBandH.value = COAT.band * this.rigHip;
    reptileU.qLive.value = alive ? 1 : 0;
  }

  // A point on the body surface at about height h (world metres) above the ground, for drips and flakes.
  bodyPoint(h: number, out: THREE.Vector3): boolean {
    const b = clamp(Math.round(h / this.size / (COAT.band * this.rigHip)), 0, COAT.bands - 1);
    const list = this.bands[b];
    if (!list.length) return false;
    const body = this.m.bodyMesh;
    body.getVertexPosition(list[(Math.random() * list.length) | 0], out);
    out.applyMatrix4(body.matrixWorld);
    return true;
  }

  snout(): THREE.Vector3 {
    return this.m.B.head.localToWorld(this.J.snout.clone().sub(this.J.head));
  }
  chest(out: THREE.Vector3): THREE.Vector3 {
    return this.m.B.spine2.getWorldPosition(out);
  }

  update(s: QuadState, dt: number): void {
    const sz = s.size, B = this.m.B, legs = this.legs, hipH = this.rigHip;
    if (!this.placed || legs.some((L) => Math.hypot(L.planted.x - s.x, L.planted.z - s.z) > 4 * sz) || (Math.abs(sz - this.size) > 0.02 && !s.speed)) this.plant(s.x, s.z, s.yaw, sz);
    this.size = sz;
    this.time += dt;
    if (s.act !== this.act) {
      this.act = s.act;
      this.actT = 0;
    } else this.actT += dt;
    const fwd = V(Math.sin(s.yaw), 0, Math.cos(s.yaw)), right = V(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const gHere = groundAt(s.x, s.z);
    this.rootG = Math.abs(gHere - this.rootG) > 2 * sz ? gHere : damp(this.rootG, gHere, 10, dt);
    const swim = s.swim, onLand = 1 - swim;

    // ---- gait: phase clock on the Froude number of the hind leg; lateral-sequence walk blending to a trot ----
    const hl = legs.find((L) => !L.front)!;
    const legL = (hl.thighLen + hl.shinLen) * sz, v = s.speed, Fr = (v * v) / (9.81 * legL);
    const duty = clamp(0.6 + 0.16 * Math.tanh((0.5 - Fr) / 0.3), 0.38, 0.8);
    const stride = Math.max(0.5 * sz, 2.3 * legL * Math.pow(Math.max(Fr, 0.01), 0.3)) * lerp(1, 0.8, this.sprawl); // sprawlers step short
    const trot = smooth(0.4, 1.0, Fr);
    for (const L of legs) {
      const walkOff = L.front ? (L.sx > 0 ? 0.25 : 0.75) : L.sx > 0 ? 0 : 0.5;
      const trotOff = L.front ? (L.sx > 0 ? 0.5 : 0) : L.sx > 0 ? 0 : 0.5;
      L.off = lerp(walkOff, trotOff, trot);
    }
    if (s.alive && swim < 0.5) {
      const anySwing = legs.some((L) => L.swing);
      const anyErr = legs.some((L) => !L.swing && L.planted.distanceTo(this.neutralW(L, s.x, s.z, s.yaw, sz).setY(L.planted.y)) > 0.3 * sz);
      if (v > 0.08 * sz || anySwing || anyErr) {
        const f = Math.max(v / stride, 0.9 / Math.sqrt(sz));
        this.phase = (this.phase + f * dt) % 1;
        this.cycleT = 1 / f;
      }
      for (const L of legs) {
        const q = (((this.phase + L.off) % 1) + 1) % 1;
        if (q < duty) {
          if (L.swing) {
            L.planted.copy(L.footPos);
            L.planted.y = groundAt(L.planted.x, L.planted.z);
            this.onStep?.(L.planted, L.sx);
          }
          L.swing = false;
          L.footPos.copy(L.planted);
          L.liftS = 0;
          L.groundY = L.planted.y;
          continue;
        }
        if (!L.swing) {
          L.swing = true;
          L.liftPos.copy(L.planted);
          // Freeze the whole centring offset at lift-off: recomputed from the live speed it drags the landing
          // spot forward while the body speeds up, so the foot skids as it lands (Brain: dlist E6, audited).
          L.centre = 0.5 * v * duty * this.cycleT;
        }
        const sw = (q - duty) / (1 - duty), rem = (1 - sw) * (1 - duty) * this.cycleT;
        const yawL = s.yaw + s.yawRate * rem, ym = s.yaw + s.yawRate * rem * 0.5;
        const n = L.neutral.clone().multiplyScalar(sz).add(V(0, 0, L.centre)).applyAxisAngle(UP, yawL);
        const landX = s.x + n.x + Math.sin(ym) * v * rem, landZ = s.z + n.z + Math.cos(ym) * v * rem;
        const e = sw * sw * (3 - 2 * sw);
        L.footPos.x = lerp(L.liftPos.x, landX, e);
        L.footPos.z = lerp(L.liftPos.z, landZ, e);
        L.footPos.y = lerp(L.liftPos.y, groundAt(landX, landZ), e) + Math.sin(Math.PI * sw) * Math.min(0.3, 0.12 + 0.05 * v) * hipH * sz;
        L.liftS = sw;
        L.groundY = groundAt(L.footPos.x, L.footPos.z);
      }
    }

    // ---- death: roll onto its side ----
    const lie0 = this.lie;
    this.lie = s.alive ? 0 : Math.min(1, this.lie + dt / 0.6);
    if (this.lie >= 1 && lie0 < 1) this.onSound?.('thud', V(s.x, this.rootG, s.z));
    const lie = this.lie * this.lie;

    // ---- trunk: height and pitch from the feet; lies on its belly to rest; floats when swimming ----
    const avg = (ls: QLeg[]): number => ls.reduce((a, L) => a + L.groundY, 0) / ls.length;
    const hind = legs.filter((L) => !L.front), fore = legs.filter((L) => L.front);
    const gH = avg(hind), gF = avg(fore);
    const pitchT = onLand * clamp(-Math.atan2(gF - gH, Math.max(0.2, this.span * sz)), -0.45, 0.45);
    const rollT = onLand * clamp(((avg(legs.filter((L) => L.sx > 0)) - avg(legs.filter((L) => L.sx < 0))) / (2 * this.stance * sz)) * 0.6, -0.25, 0.25);
    this.pitch = damp(this.pitch, pitchT, 6, dt);
    this.roll = damp(this.roll, rollT, 6, dt);
    this.bodyY = damp(this.bodyY, clamp(gH - this.rootG, -0.4 * sz, 0.6 * sz), 10, dt);
    const rest = s.rest || 0;
    const F = s.alive ? s.fall : null;
    const slipE = F ? smooth(0, 0.06, F.t) * (1 - smooth(0.1, F.dur, F.t)) * (F.level === 'slip' ? 0.5 : 1) * F.sev : 0;
    // Resting it lowers onto its belly; the feet stay where they are and the legs fold.
    const restDrop = rest * hipH * 0.55;
    // Afloat: the hips sit below the waterline; lying low only the eyes and nostrils are out.
    const floatY = WATER_Y - hipH * sz * lerp(0.6, 0.95, s.under);
    const landY = this.rootG + this.bodyY;
    const ph = this.phase * Math.PI * 2, mf = smooth(0.05, 0.6, v / Math.sqrt(sz)) * onLand;
    // Each footfall bobs the trunk a little (twice a stride).
    const bob = -0.025 * hipH * Math.cos(2 * ph) * mf;
    this.root.position.set(s.x, lerp(landY, floatY, swim), s.z);
    this.root.rotation.set(0, s.yaw, 0);
    this.root.scale.setScalar(sz);
    const hurtE = s.hurtT !== undefined && s.hurtT < 0.8 ? (s.hurtK || 0) * Math.exp(-s.hurtT * 6) * smooth(0, 0.04, s.hurtT) : 0;
    B.pelvis.position.copy(this.rest0.pelvis).add(V(this.side * 0.6 * this.stance * lie, bob - restDrop * onLand - 0.08 * slipE * hipH - 0.35 * hipH * lie, 0));
    B.pelvis.rotation.set(this.pitch + 0.04 * rest, 0, this.roll - this.side * 1.45 * lie + (F ? F.side : 0) * 0.12 * slipE - (s.hurtSide || 0) * 0.1 * hurtE);
    // The spine swings side to side with the stride (strongly in a sprawler, a wave down the body when swimming) and
    // bends into turns.
    const sway = (0.05 + 0.13 * this.sprawl) * Math.sin(ph) * mf;
    const wave = (k: number): number => swim * (0.04 + 0.08 * smooth(0.1, 1.5, v)) * Math.sin(this.time * (3 + 2 * v) - k * 0.9);
    const bend = clamp(s.yawRate * 0.08, -0.15, 0.15);
    B.spine1.rotation.set(0, sway * 0.6 + bend + wave(0), 0);
    B.spine2.rotation.set(0, -sway * 0.2 + bend + wave(-1), 0);
    B.chest.rotation.set(0, -sway * 0.7 + bend + wave(-2), 0);

    // ---- head and neck: drink, eat, browse, dig, bite, sniff ----
    let hdT = 0, jawOpen = 0, lunge = 0, nodY = 0, twist = 0, toss = 0;
    const u = this.actT;
    if (this.act === 'drink') hdT = 1;
    else if (this.act === 'eat') {
      // On a kill: jaws onto the meat, clamp and wrench the head sideways to tear, haul back, then toss the head up to
      // swallow the piece (a crocodile can't chew).
      const P = 1.6, k = u % P;
      if (k < 0.3) { hdT = 1; jawOpen = 0.55 * smooth(0, 0.25, k); }
      else if (k < 0.6) { hdT = 1; jawOpen = 0.55 * (1 - smooth(0.3, 0.36, k)); twist = 0.45 * Math.sin((k - 0.3) * 21); }
      else if (k < 0.9) { hdT = lerp(1, 0.6, smooth(0.6, 0.85, k)); lunge = -0.7 * Math.sin(Math.PI * (k - 0.6) / 0.3); }
      else if (k < 1.35) { hdT = 0; toss = Math.sin(Math.PI * (k - 0.9) / 0.45); jawOpen = 0.25 * toss; }
      if (k >= 0.62 && (this.lastK < 0.62 || this.lastK > k)) this.onSound?.('tear', this.snout());
      if (k >= 1.1 && this.lastK < 1.1) this.onSound?.('gulp', this.snout());
      this.lastK = k;
    } else if (this.act === 'browse') {
      // Ferns: head low, sweeping side to side, cropping as it goes.
      hdT = 0.85;
      twist = 0.3 * Math.sin(u * 2);
      jawOpen = 0.14 * Math.max(0, Math.sin(u * 8));
    } else if (this.act === 'dig') {
      // Rooting: the shovel snout shoved into the dirt and levered up, again and again.
      hdT = 1;
      nodY = 0.22 * Math.max(0, Math.sin(u * 7));
      lunge = 0.4 * Math.max(0, Math.sin(u * 7));
    } else if (this.act === 'turn' || this.act === 'shuffle') hdT = 0.4;
    // Holding on (a water ambusher's grip): head low, wrenching and rolling against the prey.
    if (s.holding) {
      hdT = Math.max(hdT, 0.6);
      twist += 0.3 * Math.sin(this.time * 7);
    }
    // A tail swipe: cock the tail away, then swing it hard through the target's side and recover; the hips swing the
    // other way and the head looks back at what it's hitting.
    const SW = s.strike && s.strike.kind === 'swipe' ? s.strike : null;
    const cock = SW ? smooth(0, 0.18, SW.t) * (1 - smooth(0.2, 0.3, SW.t)) : 0;
    const swing = SW ? smooth(0.2, 0.32, SW.t) * (1 - smooth(0.42, 0.85, SW.t)) : 0;
    const swipeYaw = SW ? SW.side * (0.55 * cock - 1.25 * swing) : 0;
    const look = SW ? SW.side * 0.7 * Math.max(cock, swing) : 0;
    if (s.biteT >= 0 && s.biteT < 0.56) {
      const o = s.biteT;
      jawOpen = Math.max(jawOpen, (o < 0.16 ? smooth(0, 0.16, o) : o < 0.24 ? 1 - smooth(0.16, 0.24, o) : 0) * 0.75);
      lunge = o < 0.14 ? -0.3 * smooth(0, 0.14, o) : o < 0.26 ? lerp(-0.3, 1, smooth(0.14, 0.26, o)) : 1 - smooth(0.26, 0.55, o);
    }
    this.hd = damp(this.hd, hdT, 4, dt);
    const shake = s.biteHit && s.biteT > 0.24 && s.biteT < 0.62 ? 0.3 * Math.sin((s.biteT - 0.24) * 30) * (1 - smooth(0.3, 0.62, s.biteT)) : 0;
    // A croc-line head snaps sideways at prey and counters the spine's sway, so the head holds its line.
    const neckX = 0.4 * this.hd - this.pitch * 0.6 + nodY - 0.15 * swim * (1 - s.under) + 0.25 * rest * onLand - 0.5 * toss;
    const neckY = s.yawRate * 0.05 + shake + (s.hurtSide || 0) * -0.4 * hurtE + sway * 0.5 + twist + look;
    B.neck1.rotation.set(neckX * 0.55, neckY * 0.5, 0.5 * this.side * lie);
    B.neck2.rotation.set(neckX * 0.45, neckY * 0.5, 0);
    B.neck1.position.copy(this.rest0.neck1).add(V(0, 0, lunge * 0.08 * hipH));
    B.head.rotation.set(0.25 * this.hd - lunge * 0.08 + 0.12 * swim - 0.1 * rest * onLand - 0.35 * toss, 0, 0.6 * twist * (s.holding ? 1 : 0.4));
    B.pelvis.rotation.y = -0.3 * swipeYaw;
    B.jaw.rotation.set(jawOpen, 0, 0);
    if (this.act === 'drink') {
      const k = (u * 1.3) % 1;
      if (k < dt * 1.3) this.onSound?.('lap', this.snout());
    }
    if (this.act === 'sniff' && Math.sin(u * 12) > 0.97) this.onSound?.('sniff', this.snout());

    // ---- tail: follows the spine's sway, swung to the inside of turns; in water it drives the swim ----
    const tailCmd = -clamp(s.yawRate * 0.4, -0.5, 0.5) - this.side * 0.4 * lie;
    const w = 2 * Math.PI * 2.5;
    this.tailV += (w * w * (tailCmd - this.tailYaw) - 2 * w * this.tailV) * dt;
    this.tailYaw += this.tailV * dt;
    const swimAmp = swim * (0.12 + 0.3 * smooth(0.1, 1.5, v));
    const nT = this.m.tails.length;
    this.m.tails.forEach((b, k) => {
      const wv = Math.sin(this.time * (3 + 2 * v) - (k + 2) * 0.9);
      const walk = -(0.05 + 0.13 * this.sprawl) * 0.8 * Math.sin(ph - (k + 1) * 0.6);
      // Resting it lies along the ground; standing, the root lifts it clear and the tip trails.
      const droop = (0.04 + 0.03 * k / nT) * onLand * (1 - rest) - 0.05 * rest;
      b.rotation.set(-droop * (k === 0 ? -1 : 0.5), this.tailYaw * (k < 2 ? 0.35 : 0.2) + walk * mf + swimAmp * wv * (0.4 + 0.3 * k) + swipeYaw * (k < 2 ? 0.3 : 0.12), 0);
    });

    this.root.updateMatrixWorld(true);
    // ---- legs: two-bone IK to the planted feet, the foot kept flat; folded to the body afloat; limp in death ----
    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, s.yaw);
    for (const L of legs) {
      const girdle = L.front ? B.chest : B.pelvis;
      const parentQ = girdle.getWorldQuaternion(new THREE.Quaternion());
      const H = L.thigh.getWorldPosition(V());
      const Fp = L.footPos.clone();
      if (swim > 0.01) {
        // Tucked back along the flanks, paddling a little.
        const tuck = girdle.localToWorld(V(L.sx * this.stance * 1.1, -hipH * 0.2 + 0.03 * Math.sin(this.time * 2 + L.off * 6), -(L.front ? 0.25 : 0.55) * hipH));
        Fp.lerp(tuck, swim);
      }
      if (!s.alive) Fp.lerp(girdle.localToWorld(V(L.sx * this.stance * 1.5, -hipH * 0.55, 0)), smooth(0, 0.7, this.lie));
      // The ball of the foot sits on the ground; the metatarsus keeps its rest slope (lifting the heel in swing),
      // and the ankle is where the thigh and shin have to reach.
      const lift = L.swing ? Math.sin(Math.PI * L.liftS) * 0.5 : 0;
      const metaDir = L.metaRest.clone().applyAxisAngle(V(1, 0, 0), -lift).applyQuaternion(yawQ);
      let A = Fp.clone().addScaledVector(metaDir, -L.metaLen * sz);
      // Knees point forward and elbows back; the sprawl pushes both out to the side.
      const pole = fwd.clone().multiplyScalar(L.front ? -0.6 : 0.6).addScaledVector(right, L.sx * (0.4 + 1.2 * this.sprawl)).add(V(0, 0.3, 0));
      const K = solveKnee(H, A, L.thighLen * sz, L.shinLen * sz, pole);
      let q = aimBone(L.thigh, parentQ, L.thighRest, K.clone().sub(H));
      const shinDir = A.clone().sub(K).normalize();
      q = aimBone(L.shin, q, L.shinRest, shinDir);
      A = K.clone().addScaledVector(shinDir, L.shinLen * sz);
      q = aimBone(L.meta, q, L.metaRest, Fp.clone().sub(A));
      // The toes lie flat on the ground, pointing the way the body faces.
      L.toe.quaternion.copy(q.clone().invert().multiply(yawQ));
    }
    this.root.updateMatrixWorld(true);
  }
}
