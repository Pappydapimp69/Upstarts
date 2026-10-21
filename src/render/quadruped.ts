import * as THREE from 'three';
import { clamp, damp, lerp, smooth, wrapAngle } from '../sim/math';
import { groundAt } from '../sim/ground';
import { WATER_Y } from '../sim/terrain';
import { COAT, type Coat } from '../sim/coat';
import { sweeper, type Palette } from './creatures';

// Four-legged players (Proterochampsa, Aetosauroides): a procedural body of swept parts on a group rig, animated
// the way the Herrerasaurus is (dlist/E2-E6): gait clock on the Froude number, stride from Alexander's relation,
// each foot planted where the body will be at touchdown and reached by two-bone IK, the trunk pitched and rolled by
// where the feet stand. A lateral-sequence walk blends into a trot. In water a swimmer tucks its legs and drives
// with its tail. No jumping and no falling over (four legs; the owner's rule), but a slip still shows.
// Built in adult metres, +z forward, origin on the ground under the hips; scaled for growth.

type Key = [number, number, number, number];
const V = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

export interface QuadLook {
  palette: Palette;
  hipH: number; // hind hip height
  shoulderH: number;
  hipZ: number; // hips and shoulders along the body
  shoulderZ: number;
  trunk: Key[]; // [z, centreY, halfWidth, halfHeight]
  neck: Key[]; // from the shoulders forward, relative to the neck base
  neckBase: [number, number]; // [z, y]
  head: Key[]; // from the head joint forward
  jaw: Key[];
  jawAt: [number, number]; // [y, z] in the head
  eye: [number, number, number, number]; // x, y, z, r in the head
  tail: Key[][]; // segments, each relative to its joint
  hindLeg: [number, number, number, number]; // upper, lower, girth, foot length
  foreLeg: [number, number, number, number];
  stance: number; // half-width between the feet
  sprawl: number; // how far the knees and elbows stand out to the side (0 upright)
  armour?: { rows: number; plate: [number, number, number]; spikes?: number }; // osteoderm rows along the back
  teeth?: number;
}

interface QLeg {
  front: boolean;
  side: number; // +1 left (+x), -1 right
  joint: THREE.Group; // hip or shoulder, in the trunk
  upper: THREE.Group;
  lower: THREE.Group;
  foot: THREE.Group;
  up: number;
  lo: number;
  footLen: number;
  neutral: THREE.Vector3; // where the foot stands, relative to the root at rest
  off: number; // gait phase offset
  planted: THREE.Vector3;
  footPos: THREE.Vector3;
  liftPos: THREE.Vector3;
  swing: boolean;
  liftS: number;
  groundY: number;
}

// Coat bands drawn by height above the ground, the same bands the sim keeps (sim/coat.ts).
const coatU = {
  uQWet: { value: new Float32Array(COAT.bands) },
  uQMud: { value: new Float32Array(COAT.bands) },
  uQDry: { value: new Float32Array(COAT.bands) },
  uQFlake: { value: new Float32Array(COAT.bands) },
  uQGround: { value: 0 },
  uQBandH: { value: 0.1 },
  uQLive: { value: 1 },
};
function coatMaterial(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, coatU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vQH;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvQH = (modelMatrix * vec4(transformed, 1.0)).y;');
    const band = (n: string): string => `float q_${n}(float h){ float f = clamp(h, 0.0, ${COAT.bands - 1}.0); int i = int(floor(f)); int j = min(i + 1, ${COAT.bands - 1}); return mix(${n}[i], ${n}[j], f - float(i)); }`;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vQH; uniform float uQWet[${COAT.bands}]; uniform float uQMud[${COAT.bands}]; uniform float uQDry[${COAT.bands}]; uniform float uQFlake[${COAT.bands}];
      uniform float uQGround; uniform float uQBandH; uniform float uQLive;
      ${band('uQWet')} ${band('uQMud')} ${band('uQDry')} ${band('uQFlake')}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float qh = (vQH - uQGround) / uQBandH;
      float qWet = q_uQWet(qh) * uQLive, qMud = smoothstep(0.3, 0.7, q_uQMud(qh)) * (1.0 - q_uQFlake(qh)) * uQLive, qDry = q_uQDry(qh);
      diffuseColor.rgb *= mix(1.0, 0.62, qWet);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.05, 0.034, 0.021), vec3(0.13, 0.094, 0.06), qDry), qMud);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(mix(roughnessFactor, 0.3, qWet), mix(0.3, 0.97, qDry), qMud);`);
  };
  return m;
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
// Turn group g (whose rest direction is straight down in its parent) to point along world dir.
const DOWN = V(0, -1, 0);
function aim(g: THREE.Group, dir: THREE.Vector3): void {
  const pq = g.parent!.getWorldQuaternion(new THREE.Quaternion());
  const local = dir.clone().normalize().applyQuaternion(pq.clone().invert());
  g.quaternion.setFromUnitVectors(DOWN, local);
}

export function buildQuad(look: QuadLook): { root: THREE.Group; trunk: THREE.Group; chest: THREE.Group; neck: THREE.Group; head: THREE.Group; jaw: THREE.Group; tail: THREE.Group[]; legs: QLeg[]; mats: THREE.Material[] } {
  const mat = coatMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.45 }));
  const sweep = sweeper(mat, look.palette);
  const root = new THREE.Group();
  // The trunk pivots at the hips, so pitching it lifts the shoulders.
  const trunk = new THREE.Group();
  trunk.position.set(0, look.hipH, look.hipZ);
  root.add(trunk);
  const body = sweep(look.trunk.map(([z, y, w, h]) => [z - look.hipZ, y - look.hipH, w, h] as Key), { seed: 1, ex: 2.2 });
  trunk.add(body);
  const chest = new THREE.Group();
  chest.position.set(0, look.shoulderH - look.hipH, look.shoulderZ - look.hipZ);
  trunk.add(chest);
  const neck = new THREE.Group();
  neck.position.set(0, look.neckBase[1] - look.shoulderH, look.neckBase[0] - look.shoulderZ);
  chest.add(neck);
  neck.add(sweep(look.neck, { seed: 2 }));
  const head = new THREE.Group();
  const nEnd = look.neck[look.neck.length - 1];
  head.position.set(0, nEnd[1], nEnd[0]);
  neck.add(head);
  head.add(sweep(look.head, { seed: 3, ex: 2.6 }));
  const jaw = new THREE.Group();
  jaw.position.set(0, look.jawAt[0], look.jawAt[1]);
  head.add(jaw);
  jaw.add(sweep(look.jaw, { seed: 4 }));
  const eyeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a3412'), roughness: 0.12, envMapIntensity: 0.9 });
  for (const sx of [1, -1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(look.eye[3], 10, 8), eyeMat);
    e.position.set(sx * look.eye[0], look.eye[1], look.eye[2]);
    head.add(e);
  }
  if (look.teeth) {
    const tm = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d8cdb0'), roughness: 0.5 }), tg = new THREE.ConeGeometry(0.006, 0.025, 5);
    tg.rotateX(Math.PI);
    const h0 = look.head[0], h1 = look.head[look.head.length - 1];
    for (let t = 0; t < look.teeth; t++) {
      for (const sx of [1, -1]) {
        const u = t / Math.max(1, look.teeth - 1), z = lerp(h0[0] + (h1[0] - h0[0]) * 0.25, h1[0] - 0.02, u);
        const w = lerp(look.head[1][2], h1[2], u) * 0.85;
        const m = new THREE.Mesh(tg, tm);
        m.position.set(sx * w, look.jawAt[0] + 0.012, z);
        head.add(m);
      }
    }
  }
  // Tail: a chain of segments from the hips back.
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = trunk, at = V(0, look.trunk[0][1] - look.hipH, look.trunk[0][0] - look.hipZ);
  for (const [i, seg] of look.tail.entries()) {
    const g = new THREE.Group();
    g.position.copy(at);
    parent.add(g);
    g.add(sweep(seg, { seed: 5 + i, ex: 2.2 }));
    tail.push(g);
    const last = seg[seg.length - 1];
    at = V(0, last[1], last[0]);
    parent = g;
  }
  // Osteoderms: paired rows of plates down the back and tail (aetosaurs: a full carapace of rows).
  if (look.armour) {
    const pm = coatMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color(look.palette.dorsal).multiplyScalar(0.8), roughness: 0.9, flatShading: true }));
    const pg = new THREE.BoxGeometry(...look.armour.plate);
    const topAt = (keys: Key[], z: number): [number, number] => {
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        if (z >= a[0] && z <= b[0]) {
          const u = (z - a[0]) / (b[0] - a[0]);
          return [lerp(a[1], b[1], u), lerp(a[2], b[2], u) + 0 * lerp(a[3], b[3], u)];
        }
      }
      return [keys[0][1], keys[0][2]];
    };
    const tk = look.trunk.map(([z, y, w, h]) => [z - look.hipZ, y - look.hipH, w, h] as Key);
    const step = look.armour.plate[2] * 1.05;
    for (let z = tk[0][0]; z < tk[tk.length - 1][0]; z += step) {
      const [cy] = topAt(tk, z), i = tk.findIndex((k) => k[0] >= z), k = tk[Math.max(0, i)];
      for (let r = 0; r < look.armour.rows; r++) {
        // Rows wrap over the back and down the flanks.
        const a = (r + 0.5) / look.armour.rows * Math.PI * 0.62, sx = 1;
        for (const s of [sx, -sx]) {
          const m = new THREE.Mesh(pg, pm);
          m.position.set(s * Math.sin(a) * k[2] * 1.02, cy + Math.cos(a) * k[3] * 1.02, z);
          m.rotation.z = -s * a;
          m.castShadow = true;
          trunk.add(m);
          if (look.armour.spikes && r === look.armour.rows - 1) {
            const sp = new THREE.Mesh(new THREE.ConeGeometry(look.armour.plate[0] * 0.35, look.armour.spikes, 5), pm);
            sp.position.copy(m.position).add(V(s * look.armour.spikes * 0.4, 0, 0));
            sp.rotation.z = -s * (a + 0.6);
            trunk.add(sp);
          }
        }
      }
    }
    // Two rows along the tail.
    for (const g of tail) {
      const seg = look.tail[tail.indexOf(g)];
      for (let z = seg[0][0]; z > seg[seg.length - 1][0] + step; z -= step) {
        const u = (z - seg[0][0]) / (seg[seg.length - 1][0] - seg[0][0]), w = lerp(seg[0][2], seg[seg.length - 1][2], u), h = lerp(seg[0][3], seg[seg.length - 1][3], u);
        for (const s of [1, -1]) {
          const m = new THREE.Mesh(pg, pm);
          m.position.set(s * w * 0.45, lerp(seg[0][1], seg[seg.length - 1][1], u) + h * 0.95, z);
          m.rotation.z = -s * 0.35;
          m.scale.setScalar(lerp(1, 0.5, u));
          g.add(m);
        }
      }
    }
  }
  // Legs: a hip (or shoulder) joint in the trunk, an upper and a lower segment hanging down, a flat foot.
  const legs: QLeg[] = [];
  for (const front of [false, true]) {
    for (const side of [1, -1]) {
      const [up, lo, r, fl] = front ? look.foreLeg : look.hindLeg;
      const jy = (front ? look.shoulderH : look.hipH) - look.hipH, jz = (front ? look.shoulderZ : look.hipZ) - look.hipZ;
      const k = front ? look.trunk.reduce((b, t) => (Math.abs(t[0] - look.shoulderZ) < Math.abs(b[0] - look.shoulderZ) ? t : b)) : look.trunk.reduce((b, t) => (Math.abs(t[0] - look.hipZ) < Math.abs(b[0] - look.hipZ) ? t : b));
      const joint = new THREE.Group();
      joint.position.set(side * k[2] * 0.78, jy - k[3] * 0.25, jz);
      trunk.add(joint);
      const upper = new THREE.Group();
      joint.add(upper);
      const um = sweep([[0, 0, r, r * 1.15], [-up * 0.5, 0, r * 0.82, r * 0.9], [-up, 0, r * 0.58, r * 0.62]], { seed: 9 + legs.length, ring: 10 });
      um.rotation.x = -Math.PI / 2; // the sweep runs along -z; turned to hang down
      upper.add(um);
      const lower = new THREE.Group();
      lower.position.set(0, -up, 0);
      upper.add(lower);
      const lm = sweep([[0, 0, r * 0.62, r * 0.66], [-lo * 0.6, 0, r * 0.55, r * 0.58], [-lo, 0, r * 0.5, r * 0.52]], { seed: 13 + legs.length, ring: 10 });
      lm.rotation.x = -Math.PI / 2;
      lower.add(lm);
      const foot = new THREE.Group();
      foot.position.set(0, -lo, 0);
      lower.add(foot);
      const fm = sweep([[-fl * 0.25, 0, fl * 0.42, fl * 0.16], [fl * 0.45, -0.005, fl * 0.5, fl * 0.12], [fl, -0.01, fl * 0.34, fl * 0.07]], { seed: 17 + legs.length, ring: 10 });
      fm.position.y = fl * 0.1;
      foot.add(fm);
      const nx = side * look.stance, nz = jz + look.hipZ + (front ? 0.04 : -0.02) * look.hipH;
      legs.push({
        front, side, joint, upper, lower, foot, up, lo, footLen: fl, neutral: V(nx, 0, nz),
        off: 0, planted: V(), footPos: V(), liftPos: V(), swing: false, liftS: 0, groundY: 0,
      });
    }
  }
  return { root, trunk, chest, neck, head, jaw, tail, legs, mats: [mat] };
}

// Per-frame state from the sim, as the Herrerasaurus animator takes it, plus swim (0 on land .. 1 floating) and
// under (0 at the surface .. 1 lying low with only eyes and nostrils out).
export interface QuadState {
  x: number; z: number; yaw: number; speed: number; accel: number; yawRate: number; act: string; alive: boolean;
  biteT: number; sprinting: boolean; size: number; dipY?: number; rest: number; swim: number; under: number;
  biteHit?: boolean; hurtT?: number; hurtSide?: number; hurtK?: number;
  fall?: { level: string; t: number; dur: number; side: number; sev: number } | null;
  [extra: string]: unknown; // the biped's inputs it ignores (crouch, air, bodyK)
}

export class QuadAnimator {
  readonly quad = true;
  readonly root: THREE.Group;
  readonly rigHip: number;
  readonly speciesId: string;
  onStep: ((foot: THREE.Vector3, side: number) => void) | null = null;
  onSound: ((kind: 'lap' | 'drip' | 'gulp' | 'sniff' | 'tear' | 'thud', at: THREE.Vector3) => void) | null = null;
  private readonly m: ReturnType<typeof buildQuad>;
  private readonly look: QuadLook;
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
  private side = 1;

  constructor(speciesId: string, look: QuadLook) {
    this.speciesId = speciesId;
    this.look = look;
    this.m = buildQuad(look);
    this.root = this.m.root;
    this.rigHip = look.hipH;
  }

  private neutralW(L: QLeg, x: number, z: number, yaw: number, sz: number): THREE.Vector3 {
    return L.neutral.clone().multiplyScalar(sz).applyAxisAngle(UP, yaw).add(V(x, 0, z));
  }

  plant(x: number, z: number, yaw: number, size: number): void {
    this.size = size;
    for (const L of this.m.legs) {
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

  // The coat (wet and mud bands) on this body, by height above the ground it stands on.
  setCoat(c: Coat, hip: number, alive: boolean): void {
    coatU.uQWet.value.set(c.wet);
    coatU.uQMud.value.set(c.mud);
    coatU.uQDry.value.set(c.dry);
    coatU.uQFlake.value.set(c.flake);
    coatU.uQGround.value = this.rootG;
    coatU.uQBandH.value = COAT.band * hip;
    coatU.uQLive.value = alive ? 1 : 0;
  }

  // A point on the body surface at about height h above the ground (for drips and flakes).
  bodyPoint(h: number, out: THREE.Vector3): boolean {
    const t = this.m.trunk, L = this.look, k = L.trunk[(Math.random() * L.trunk.length) | 0], sz = this.size;
    const a = Math.random() < 0.5 ? 1 : -1;
    out.set(a * k[2] * 0.95, clamp(h / sz - L.hipH + 0.0, k[1] - L.hipH - k[3], k[1] - L.hipH + k[3]), k[0] - L.hipZ);
    t.localToWorld(out);
    return true;
  }

  snout(): THREE.Vector3 {
    const h = this.look.head[this.look.head.length - 1];
    return this.m.head.localToWorld(V(0, h[1], h[0]));
  }
  chest(out: THREE.Vector3): THREE.Vector3 {
    return this.m.chest.getWorldPosition(out);
  }

  update(s: QuadState, dt: number): void {
    const sz = s.size, M = this.m, look = this.look;
    if (!this.placed || M.legs.some((L) => Math.hypot(L.planted.x - s.x, L.planted.z - s.z) > 4 * sz) || (Math.abs(sz - this.size) > 0.02 && !s.speed)) this.plant(s.x, s.z, s.yaw, sz);
    this.size = sz;
    this.time += dt;
    if (s.act !== this.act) {
      this.act = s.act;
      this.actT = 0;
    } else this.actT += dt;
    const fwd = V(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    const gHere = groundAt(s.x, s.z);
    this.rootG = Math.abs(gHere - this.rootG) > 2 * sz ? gHere : damp(this.rootG, gHere, 10, dt);
    const swim = s.swim, onLand = 1 - swim;

    // ---- gait: phase clock on the Froude number of the hind leg; lateral-sequence walk blending to a trot ----
    const legL = (look.hindLeg[0] + look.hindLeg[1]) * sz, v = s.speed, Fr = (v * v) / (9.81 * legL);
    const duty = clamp(0.6 + 0.16 * Math.tanh((0.5 - Fr) / 0.3), 0.38, 0.8);
    const stride = Math.max(0.6 * sz, 2.3 * legL * Math.pow(Math.max(Fr, 0.01), 0.3)) * lerp(1, 0.8, look.sprawl); // sprawlers step short
    const trot = smooth(0.4, 1.0, Fr);
    for (const L of M.legs) {
      const walkOff = L.front ? (L.side > 0 ? 0.25 : 0.75) : L.side > 0 ? 0 : 0.5;
      const trotOff = L.front ? (L.side > 0 ? 0.5 : 0) : L.side > 0 ? 0 : 0.5;
      L.off = lerp(walkOff, trotOff, trot);
    }
    if (s.alive && swim < 0.5) {
      const anySwing = M.legs.some((L) => L.swing);
      const anyErr = M.legs.some((L) => !L.swing && L.planted.distanceTo(this.neutralW(L, s.x, s.z, s.yaw, sz).setY(L.planted.y)) > 0.3 * sz);
      if (v > 0.08 * sz || anySwing || anyErr) {
        const f = Math.max(v / stride, 0.9 / Math.sqrt(sz));
        this.phase = (this.phase + f * dt) % 1;
        this.cycleT = 1 / f;
      }
      for (const L of M.legs) {
        const q = (((this.phase + L.off) % 1) + 1) % 1;
        if (q < duty) {
          if (L.swing) {
            L.planted.copy(L.footPos);
            L.planted.y = groundAt(L.planted.x, L.planted.z);
            this.onStep?.(L.planted, L.side);
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
        }
        const sw = (q - duty) / (1 - duty), rem = (1 - sw) * (1 - duty) * this.cycleT;
        const yawL = s.yaw + s.yawRate * rem, ym = s.yaw + s.yawRate * rem * 0.5;
        const centre = 0.5 * v * duty * this.cycleT;
        const n = L.neutral.clone().multiplyScalar(sz).add(V(0, 0, centre)).applyAxisAngle(UP, yawL);
        const landX = s.x + n.x + Math.sin(ym) * v * rem, landZ = s.z + n.z + Math.cos(ym) * v * rem;
        const e = sw * sw * (3 - 2 * sw);
        L.footPos.x = lerp(L.liftPos.x, landX, e);
        L.footPos.z = lerp(L.liftPos.z, landZ, e);
        L.footPos.y = lerp(L.liftPos.y, groundAt(landX, landZ), e) + Math.sin(Math.PI * sw) * Math.min(0.25, 0.08 + 0.05 * v) * sz;
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
    const hind = M.legs.filter((L) => !L.front), fore = M.legs.filter((L) => L.front);
    const avg = (ls: QLeg[]): number => ls.reduce((a, L) => a + L.groundY, 0) / ls.length;
    const gH = avg(hind), gF = avg(fore), span = Math.max(0.2, (look.shoulderZ - look.hipZ) * sz);
    const pitchT = onLand * clamp(-Math.atan2(gF - gH, span), -0.45, 0.45);
    const lft = M.legs.filter((L) => L.side > 0), rgt = M.legs.filter((L) => L.side < 0);
    const rollT = onLand * clamp(((avg(lft) - avg(rgt)) / (2 * look.stance * sz)) * 0.6, -0.25, 0.25);
    this.pitch = damp(this.pitch, pitchT, 6, dt);
    this.roll = damp(this.roll, rollT, 6, dt);
    this.bodyY = damp(this.bodyY, clamp(gH - this.rootG, -0.4 * sz, 0.6 * sz), 10, dt);
    const rest = s.rest || 0;
    const F = s.alive ? s.fall : null;
    const slipE = F ? smooth(0, 0.06, F.t) * (1 - smooth(0.1, F.dur, F.t)) * (F.level === 'slip' ? 0.5 : 1) * F.sev : 0;
    const belly = look.hipH - (look.trunk.reduce((a, k) => Math.min(a, k[1] - k[3]), 9)); // how far the belly sits below the hips
    const restDrop = rest * Math.max(0, look.hipH - belly - 0.02);
    // Afloat: hips at the waterline minus most of the body depth; under, only the eyes stay out.
    const floatY = WATER_Y - look.hipH * sz * lerp(0.55, 0.85, s.under);
    const landY = this.rootG + this.bodyY - (restDrop + 0.08 * slipE * look.hipH) * sz;
    M.root.position.set(s.x, lerp(landY, floatY, swim), s.z);
    M.root.rotation.set(0, s.yaw, 0);
    M.root.scale.setScalar(sz);
    const hurtE = s.hurtT !== undefined && s.hurtT < 0.8 ? (s.hurtK || 0) * Math.exp(-s.hurtT * 6) * smooth(0, 0.04, s.hurtT) : 0;
    M.trunk.rotation.set(this.pitch + 0.04 * rest, 0, this.roll - this.side * 1.4 * lie + (F ? F.side : 0) * 0.12 * slipE - (s.hurtSide || 0) * 0.1 * hurtE);
    M.trunk.position.x = this.side * 0.5 * look.stance * lie;

    // ---- head and neck: drink, eat, browse, dig, bite, sniff ----
    let hdT = 0, jawOpen = 0, lunge = 0, nodY = 0;
    const u = this.actT;
    if (this.act === 'drink') hdT = 1;
    else if (this.act === 'eat' || this.act === 'browse' || this.act === 'dig') {
      hdT = 0.9;
      nodY = 0.12 * Math.sin(u * (this.act === 'dig' ? 9 : 5));
      jawOpen = this.act === 'eat' ? 0.25 + 0.2 * Math.max(0, Math.sin(u * 6)) : 0.1 * Math.max(0, Math.sin(u * 7));
      if (this.act === 'eat' && Math.sin(u * 6) > 0.98) this.onSound?.('tear', this.snout());
    } else if (this.act === 'turn' || this.act === 'shuffle') hdT = 0.4;
    if (s.biteT >= 0 && s.biteT < 0.56) {
      const o = s.biteT;
      jawOpen = Math.max(jawOpen, (o < 0.16 ? smooth(0, 0.16, o) : o < 0.24 ? 1 - smooth(0.16, 0.24, o) : 0) * 0.8);
      lunge = o < 0.14 ? -0.3 * smooth(0, 0.14, o) : o < 0.26 ? lerp(-0.3, 1, smooth(0.14, 0.26, o)) : 1 - smooth(0.26, 0.55, o);
    }
    this.hd = damp(this.hd, hdT, 4, dt);
    const shake = s.biteHit && s.biteT > 0.24 && s.biteT < 0.62 ? 0.3 * Math.sin((s.biteT - 0.24) * 30) * (1 - smooth(0.3, 0.62, s.biteT)) : 0;
    // A croc-line head snaps sideways at prey; everything bobs a little with the stride.
    const ph = this.phase * Math.PI * 2, mf = smooth(0.05, 0.6, v / Math.sqrt(sz)) * onLand;
    M.neck.rotation.set(0.75 * this.hd - this.pitch * 0.6 + nodY + 0.05 * Math.sin(2 * ph) * mf - 0.25 * swim * (1 - s.under) + 0.3 * rest, s.yawRate * 0.06 + shake + (s.hurtSide || 0) * -0.4 * hurtE, 0.5 * this.side * lie);
    M.head.rotation.set(0.25 * this.hd - lunge * 0.08 + 0.15 * swim, 0, 0);
    M.neck.position.z = M.neck.userData.z0 ?? (M.neck.userData.z0 = M.neck.position.z);
    M.neck.position.z = M.neck.userData.z0 + lunge * 0.12 * look.hipH;
    M.jaw.rotation.set(jawOpen, 0, 0);
    if (this.act === 'drink') {
      const k = (u * 1.3) % 1;
      if (k < dt * 1.3) this.onSound?.('lap', this.snout());
    }
    if (this.act === 'sniff' && Math.sin(u * 12) > 0.97) this.onSound?.('sniff', this.snout());

    // ---- tail: held out on land, swung to the inside of turns; in water it drives the swim ----
    const tailCmd = -clamp(s.yawRate * 0.4, -0.5, 0.5) - this.side * 0.4 * lie;
    const w = 2 * Math.PI * 2.5;
    this.tailV += (w * w * (tailCmd - this.tailYaw) - 2 * w * this.tailV) * dt;
    this.tailYaw += this.tailV * dt;
    const swimAmp = swim * (0.15 + 0.35 * smooth(0.1, 1.5, v));
    M.tail.forEach((g, k) => {
      const wave = Math.sin(this.time * (3 + 2 * v) - k * 1.1);
      g.rotation.set(-0.04 * rest + 0.02 * k * onLand, this.tailYaw * (k === 0 ? 0.5 : 0.3) + 0.06 * Math.sin(ph + k) * mf + swimAmp * wave * (0.5 + 0.4 * k), 0);
    });

    M.root.updateMatrixWorld(true);
    // ---- legs: two-bone IK to the planted feet; folded to the body afloat; limp in death ----
    for (const L of M.legs) {
      const H = L.joint.getWorldPosition(V());
      let Fp = L.footPos.clone();
      if (swim > 0.01) {
        // Tucked along the body, paddling slowly.
        const tuck = M.trunk.localToWorld(V(L.side * look.stance * 0.9, -look.hipH * 0.35 + 0.05 * Math.sin(this.time * 2 + L.off * 6), (L.front ? look.shoulderZ : look.hipZ) - look.hipZ - (L.front ? 0.1 : 0.35) * look.hipH));
        Fp.lerp(tuck, swim);
      }
      if (!s.alive) Fp.lerp(M.trunk.localToWorld(V(L.side * look.stance * 1.4, -look.hipH * 0.5, (L.front ? look.shoulderZ : look.hipZ) - look.hipZ)), smooth(0, 0.7, this.lie));
      const ankle = Fp.clone().add(V(0, L.footLen * 0.12 * sz, 0));
      // Knees point forward, elbows back; the sprawl pushes both out to the side.
      const side = V(Math.cos(s.yaw), 0, -Math.sin(s.yaw)).multiplyScalar(L.side * look.sprawl);
      const pole = fwd.clone().multiplyScalar(L.front ? -1 : 1).add(side);
      const K = solveKnee(H, ankle, L.up * sz, L.lo * sz, pole);
      aim(L.upper, K.clone().sub(H));
      L.upper.updateMatrixWorld(true);
      aim(L.lower, ankle.clone().sub(K));
      L.lower.updateMatrixWorld(true);
      // The foot stays flat on the ground, pointing the way the body faces.
      const pq = L.foot.parent!.getWorldQuaternion(new THREE.Quaternion());
      L.foot.quaternion.copy(pq.invert().multiply(new THREE.Quaternion().setFromAxisAngle(UP, s.yaw)));
      void Fp;
      Fp = Fp;
    }
    M.root.updateMatrixWorld(true);
    void wrapAngle;
  }
}
