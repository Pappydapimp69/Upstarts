import * as THREE from 'three';
import { smooth } from '../sim/math';
import { vnoise } from '../sim/noise';

// Procedural bodies for the small animals (cynodonts, fish) in the Dlist demo's style; Saurosuchus and Hyperodapedon
// are skinned models now (dlist/quadModel.js). The style: each part is a superellipse cross-section swept along z through
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

// A ray-finned fish (Gyrolepidoides, Challaia: small heavy-scaled palaeoniscoids), unit length, +z forward: a
// spindle body with a forked, upturned (heterocercal) tail fin. Colours are guesses.
export function buildFish(): Body {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, envMapIntensity: 0.9 });
  const sweep = sweeper(mat, { dorsal: '#3a4436', flank: '#7d8a74', belly: '#c9c8b0', band: 0.05 });
  const root = new THREE.Group();
  root.add(sweep([[-0.3, 0, 0.04, 0.07], [-0.1, 0, 0.07, 0.11], [0.15, 0, 0.07, 0.1], [0.35, -0.01, 0.045, 0.06], [0.45, -0.015, 0.015, 0.025]], { seed: 31, ex: 2 }));
  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.3);
  root.add(tail);
  const fin = sweep([[0, 0, 0.012, 0.05], [-0.1, 0.03, 0.006, 0.09], [-0.17, 0.06, 0.003, 0.12]], { seed: 32, ex: 2, ring: 8 });
  tail.add(fin);
  const tail2 = new THREE.Group();
  tail.add(tail2);
  const head = new THREE.Group();
  head.position.set(0, 0, 0.3);
  root.add(head);
  const jaw = new THREE.Group();
  head.add(jaw);
  eyes(head, 0.045, 0.02, 0.06, 0.014);
  return { root, head, jaw, tail, tail2, legs: [] };
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
