import * as THREE from 'three';
import { lerp, smooth } from '../sim/math';
import { vnoise } from '../sim/noise';

// Procedural NPC bodies in the Dlist demo's style: each part is a superellipse cross-section swept along z through
// keys [z, centreY, halfWidth, halfHeight], coloured by which way the surface faces (dark back, paler flanks and
// belly) with value-noise mottling and faint cross-bands. Real metres, +z forward. Colours are guesses.

export interface Palette { dorsal: string; flank: string; belly: string; band?: number }
type Key = [number, number, number, number];

export function sweeper(mat: THREE.Material, pal: Palette) {
  const cD = new THREE.Color(pal.dorsal), cF = new THREE.Color(pal.flank), cB = new THREE.Color(pal.belly), band = pal.band ?? 0.08;
  return (keys: Key[], { ring = 18, ex = 2.4, seed = 0, cap = true, scale = 1 } = {}): THREE.Mesh => {
    const pos: number[] = [], col: number[] = [], idx: number[] = [], n = keys.length, c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const [z, y, w, h] = keys[i];
      for (let j = 0; j < ring; j++) {
        const a = (j / ring) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const x = Math.sign(ca) * Math.abs(ca) ** (2 / ex) * w, yy = Math.sign(sa) * Math.abs(sa) ** (2 / ex) * h;
        pos.push(x, y + yy, z);
        const mott = vnoise((x * 6) / scale + seed, (z * 3.2 + yy * 5) / scale, 61 + seed), b = 0.5 + 0.5 * Math.sin((z * 4.1) / scale + seed);
        c.copy(sa > 0.35 ? cD : cF).lerp(cB, smooth(-0.1, -0.75, sa));
        c.multiplyScalar(0.82 + 0.3 * mott - (sa > 0.2 ? band * b : 0));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < ring; j++) {
        const a = i * ring + j, b = i * ring + ((j + 1) % ring);
        idx.push(a, a + ring, b, b, a + ring, b + ring);
      }
    }
    if (cap) {
      for (const [i, flip] of [[0, true], [n - 1, false]] as const) {
        const [z, y] = keys[i];
        const ci = pos.length / 3;
        pos.push(0, y, z);
        col.push(...col.slice(i * ring * 3, i * ring * 3 + 3));
        for (let j = 0; j < ring; j++) {
          const a = i * ring + j, b = i * ring + ((j + 1) % ring);
          idx.push(...(flip ? [ci, b, a] : [ci, a, b]));
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  };
}

export interface Leg { hip: THREE.Group; knee: THREE.Group; front: boolean; side: number }
export interface Body { root: THREE.Group; head: THREE.Group; jaw: THREE.Group; tail: THREE.Group; tail2: THREE.Group; legs: Leg[] }

// A two-segment leg with a knee and a foot. sprawl tips the whole leg outward (rhynchosaurs and small cynodonts
// held their limbs partly out to the side; Saurosuchus stood upright).
function leg(sweep: ReturnType<typeof sweeper>, at: [number, number, number], up: number, lo: number, r: number, foot: number, sprawl: number, seed: number): Leg {
  const hip = new THREE.Group();
  hip.position.set(...at);
  const side = Math.sign(at[0]) || 1;
  hip.rotation.z = side * sprawl;
  const thigh = sweep([[0, 0, r, r * 1.15], [-up * 0.5, -0.01, r * 0.8, r * 0.9], [-up, 0, r * 0.55, r * 0.6]], { seed, ring: 10 });
  thigh.rotation.set(-Math.PI / 2, 0, 0); // the sweep runs along -z; turned to hang down
  hip.add(thigh);
  const knee = new THREE.Group();
  knee.position.set(0, -up, 0);
  knee.rotation.z = -side * sprawl * 1.4; // the shin comes back under to plant the foot
  hip.add(knee);
  const shin = sweep([[0, 0, r * 0.55, r * 0.6], [-lo, 0, r * 0.4, r * 0.42]], { seed: seed + 1, ring: 10 });
  shin.rotation.set(-Math.PI / 2, 0, 0);
  knee.add(shin);
  const f = sweep([[-foot * 0.25, 0, foot * 0.45, foot * 0.2], [foot * 0.5, 0, foot * 0.5, foot * 0.18], [foot, -0.01, foot * 0.3, foot * 0.12]], { seed: seed + 2, ring: 10 });
  f.position.set(0, -lo + foot * 0.12, 0);
  knee.add(f);
  return { hip, knee, front: at[2] > 0, side };
}

function eyes(head: THREE.Group, x: number, y: number, z: number, r: number): void {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a3d16'), roughness: 0.12, envMapIntensity: 0.9 });
  for (const sx of [1, -1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    e.position.set(sx * x, y, z);
    head.add(e);
  }
}

// Saurosuchus galilei, about 6.5 m (ported from the Dlist demo): deep trunk, upright columnar limbs (hind longer),
// a long tail, a tall narrow skull about 0.9 m long, paired osteoderms down the back.
export function buildSaurosuchus(): Body {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, envMapIntensity: 0.4 });
  const sweep = sweeper(mat, { dorsal: '#3a3229', flank: '#5b4a37', belly: '#a08a6a' });
  const root = new THREE.Group();
  const TRUNK: Key[] = [[-0.95, 1.18, 0.36, 0.38], [-0.5, 1.22, 0.44, 0.47], [0.1, 1.24, 0.47, 0.52], [0.7, 1.25, 0.43, 0.48], [1.1, 1.3, 0.32, 0.36], [1.45, 1.36, 0.24, 0.29]];
  root.add(sweep(TRUNK, { seed: 1 }));
  const tail = new THREE.Group();
  tail.position.set(0, 1.16, -0.9);
  root.add(tail);
  tail.add(sweep([[0, 0, 0.36, 0.38], [-0.6, -0.04, 0.28, 0.31], [-1.3, -0.1, 0.18, 0.22]], { seed: 2 }));
  const tail2 = new THREE.Group();
  tail2.position.set(0, -0.1, -1.3);
  tail.add(tail2);
  tail2.add(sweep([[0, 0, 0.18, 0.22], [-0.8, -0.1, 0.09, 0.12], [-1.5, -0.2, 0.025, 0.03]], { seed: 3 }));
  const head = new THREE.Group();
  head.position.set(0, 1.38, 1.45);
  root.add(head);
  head.add(sweep([[0, 0.02, 0.22, 0.3], [0.3, 0.04, 0.2, 0.32], [0.6, 0.0, 0.15, 0.27], [0.88, -0.05, 0.1, 0.2], [1.08, -0.08, 0.06, 0.13]], { seed: 4, ex: 2.6 }));
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.2, 0.12);
  head.add(jaw);
  jaw.add(sweep([[0, 0, 0.19, 0.11], [0.4, -0.02, 0.15, 0.09], [0.75, -0.01, 0.09, 0.07], [0.96, 0.0, 0.05, 0.04]], { seed: 5 }));
  const toothMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d8cdb0'), roughness: 0.5 });
  const tooth = new THREE.ConeGeometry(0.018, 0.09, 5);
  tooth.rotateX(Math.PI);
  for (let t = 0; t < 9; t++) {
    for (const sx of [1, -1]) {
      const m = new THREE.Mesh(tooth, toothMat);
      m.position.set(sx * lerp(0.15, 0.06, t / 8) * 0.92, lerp(-0.2, -0.17, t / 8), 0.32 + t * 0.085);
      head.add(m);
    }
  }
  eyes(head, 0.165, 0.15, 0.3, 0.03);
  const plateGeo = new THREE.BoxGeometry(0.11, 0.035, 0.15);
  const plateMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2f2922'), roughness: 0.9, flatShading: true });
  const topAt = (z: number): number => {
    for (let i = 0; i < TRUNK.length - 1; i++) {
      const a = TRUNK[i], b = TRUNK[i + 1];
      if (z >= a[0] && z <= b[0]) return lerp(a[1] + a[3], b[1] + b[3], (z - a[0]) / (b[0] - a[0]));
    }
    return 1.6;
  };
  for (let z = 1.35; z > -0.9; z -= 0.17) {
    for (const sx of [1, -1]) {
      const m = new THREE.Mesh(plateGeo, plateMat);
      m.position.set(sx * 0.07, topAt(z) - 0.01, z);
      m.rotation.z = -sx * 0.25;
      m.castShadow = true;
      root.add(m);
    }
  }
  for (let z = -0.05; z > -1.25; z -= 0.17) {
    for (const sx of [1, -1]) {
      const m = new THREE.Mesh(plateGeo, plateMat);
      m.position.set(sx * 0.06, 0.37 - 0.12 * -z, z);
      m.scale.setScalar(0.8);
      tail.add(m);
    }
  }
  const legs = ([[0.4, 1.02, 0.85, 0.5, 0.48, 0.17], [-0.4, 1.02, 0.85, 0.5, 0.48, 0.17], [0.44, 1.08, -0.85, 0.56, 0.5, 0.21], [-0.44, 1.08, -0.85, 0.56, 0.5, 0.21]] as const)
    .map(([x, y, z, up, lo, r], i) => leg(sweep, [x, y, z], up, lo, r, 0.24, 0, 6 + i));
  for (const l of legs) root.add(l.hip);
  return { root, head, jaw, tail, tail2, legs };
}

// Hyperodapedon sanjuanensis, about 1.3-1.6 m, 80 kg: a barrel-bodied rhynchosaur on sprawling limbs, with a
// broad triangular skull wider than long at the back, a downturned beak (paired premaxillae) and grinding tooth
// plates; a moderately long tail. From the fossil descriptions; colours are guesses.
export function buildHyperodapedon(): Body {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, envMapIntensity: 0.35 });
  const sweep = sweeper(mat, { dorsal: '#5c5236', flank: '#857653', belly: '#b9a77f', band: 0.12 });
  const root = new THREE.Group();
  root.add(sweep([[-0.45, 0.42, 0.2, 0.18], [-0.25, 0.46, 0.3, 0.25], [0.05, 0.47, 0.34, 0.27], [0.32, 0.46, 0.3, 0.24], [0.52, 0.46, 0.2, 0.17], [0.62, 0.47, 0.13, 0.12]], { seed: 11, ex: 2.2 }));
  const tail = new THREE.Group();
  tail.position.set(0, 0.42, -0.42);
  root.add(tail);
  tail.add(sweep([[0, 0, 0.2, 0.18], [-0.3, -0.04, 0.13, 0.12], [-0.6, -0.1, 0.07, 0.07]], { seed: 12 }));
  const tail2 = new THREE.Group();
  tail2.position.set(0, -0.1, -0.6);
  tail.add(tail2);
  tail2.add(sweep([[0, 0, 0.07, 0.07], [-0.3, -0.05, 0.035, 0.035], [-0.5, -0.08, 0.01, 0.01]], { seed: 13 }));
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.62);
  root.add(head);
  // Skull: very wide at the cheeks, narrowing fast to the beak; flat-topped.
  head.add(sweep([[0, 0.02, 0.17, 0.13], [0.08, 0.03, 0.2, 0.13], [0.16, 0.02, 0.15, 0.11], [0.24, 0.0, 0.08, 0.08], [0.3, -0.03, 0.04, 0.05]], { seed: 14, ex: 2.8 }));
  const beakMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2e2a22'), roughness: 0.55 });
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.09, 6), beakMat);
  beak.rotation.x = Math.PI * 0.85; // hooks down over the lower jaw
  beak.position.set(0, -0.06, 0.32);
  head.add(beak);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.07, 0.06);
  head.add(jaw);
  jaw.add(sweep([[0, 0, 0.13, 0.05], [0.12, -0.01, 0.1, 0.05], [0.22, 0, 0.04, 0.03]], { seed: 15 }));
  eyes(head, 0.13, 0.08, 0.1, 0.022);
  const legs = ([[0.24, 0.4, 0.38, 0.2, 0.22, 0.07], [-0.24, 0.4, 0.38, 0.2, 0.22, 0.07], [0.26, 0.4, -0.3, 0.22, 0.22, 0.085], [-0.26, 0.4, -0.3, 0.22, 0.22, 0.085]] as const)
    .map(([x, y, z, up, lo, r], i) => leg(sweep, [x, y, z], up, lo, r, 0.12, 0.45, 16 + i));
  for (const l of legs) root.add(l.hip);
  return { root, head, jaw, tail, tail2, legs };
}

// Cynodonts, built at unit length (scale by body length): Exaeretodon (a stocky, deep-skulled plant-eater with
// erect-ish limbs) and the small burrowers (a slim weasel-like body). Furred: mammal relatives, probably hairy.
export function buildCynodont(kind: 'cynodont' | 'exaeretodon'): Body {
  const ex = kind === 'exaeretodon';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, envMapIntensity: 0.25 });
  const sweep = sweeper(mat, ex ? { dorsal: '#4f4434', flank: '#7a6a50', belly: '#b3a083', band: 0.05 } : { dorsal: '#5a4129', flank: '#8a6a48', belly: '#c4a882', band: 0.14 });
  const s = 1 / (ex ? 1.6 : 0.3); // keys below are for a real-size animal; scale to unit length
  const k = (keys: Key[]): Key[] => keys.map(([z, y, w, h]) => [z * s, y * s, w * s, h * s]);
  const root = new THREE.Group();
  const h0 = ex ? 0.36 : 0.06, L = ex ? 1.6 : 0.3;
  const W = ex ? 0.2 : 0.035, H = ex ? 0.2 : 0.032;
  root.add(sweep(k([[-0.3 * L, h0, W * 0.7, H * 0.75], [-0.12 * L, h0 + H * 0.1, W, H], [0.08 * L, h0 + H * 0.12, W, H], [0.24 * L, h0 + H * 0.15, W * 0.75, H * 0.8], [0.33 * L, h0 + H * 0.3, W * 0.5, H * 0.55]]), { seed: 21, scale: 1 / L, ex: 2.1 }));
  const tail = new THREE.Group();
  tail.position.set(0, h0 * s, -0.3 * L * s);
  root.add(tail);
  const tl = ex ? 0.25 : 0.45; // Exaeretodon's tail was short; the small ones carried a longer one
  tail.add(sweep(k([[0, 0, W * 0.6, H * 0.6], [-tl * L * 0.5, -H * 0.2, W * 0.3, H * 0.3], [-tl * L, -H * 0.4, W * 0.05, H * 0.05]]), { seed: 22, scale: 1 / L }));
  const tail2 = new THREE.Group();
  tail.add(tail2);
  const head = new THREE.Group();
  head.position.set(0, (h0 + H * 0.45) * s, 0.36 * L * s);
  root.add(head);
  const hw = ex ? 0.11 : 0.02, hh = ex ? 0.12 : 0.018, hl = ex ? 0.32 : 0.06;
  head.add(sweep(k([[0, 0, hw, hh], [hl * 0.4, 0.0, hw * 0.95, hh * 0.9], [hl * 0.8, -hh * 0.2, hw * 0.55, hh * 0.55], [hl, -hh * 0.35, hw * 0.25, hh * 0.3]]), { seed: 23, scale: 1 / L, ex: 2.3 }));
  const jaw = new THREE.Group();
  jaw.position.set(0, -hh * 0.6 * s, hl * 0.15 * s);
  head.add(jaw);
  jaw.add(sweep(k([[0, 0, hw * 0.8, hh * 0.35], [hl * 0.6, 0, hw * 0.45, hh * 0.25], [hl * 0.8, 0.0, hw * 0.2, hh * 0.15]]), { seed: 24, scale: 1 / L }));
  eyes(head, hw * 0.75 * s, hh * 0.35 * s, hl * 0.45 * s, hw * 0.16 * s);
  // Ears: little rounded flaps on the furry small ones (a guess, for read at a distance).
  const up = ex ? 0.17 : 0.03, lo = ex ? 0.16 : 0.03, r = ex ? 0.06 : 0.011;
  const legs = ([[W * 0.85, h0, 0.2 * L], [-W * 0.85, h0, 0.2 * L], [W * 0.9, h0, -0.2 * L], [-W * 0.9, h0, -0.2 * L]] as const)
    .map(([x, y, z], i) => leg(sweep, [x * s, y * s, z * s], up * s, lo * s, r * s, (ex ? 0.1 : 0.022) * s, ex ? 0.2 : 0.5, 25 + i));
  for (const l of legs) root.add(l.hip);
  return { root, head, jaw, tail, tail2, legs };
}

// Walk cycle for four legs in diagonal pairs: hips swing, knees fold on the forward swing.
export function animateLegs(b: Body, phase: number, swing: number, sleep = 0): void {
  const ph = phase * Math.PI * 2;
  b.legs.forEach((l, i) => {
    const p = ph + (i === 0 || i === 3 ? 0 : Math.PI);
    l.hip.rotation.x = Math.sin(p) * swing;
    l.knee.rotation.x = (l.front ? -1 : 1) * Math.max(0, Math.cos(p)) * swing * 1.4 + (l.front ? -1 : 1) * 0.9 * sleep;
  });
  b.tail.rotation.y = 0.1 * Math.sin(ph) * Math.min(1, swing * 2);
  b.tail2.rotation.y = 0.16 * Math.sin(ph - 0.8) * Math.min(1, swing * 2);
}
