// Low-slung quadrupeds from a handful of measurements: rhynchosaurs, cynodonts, early archosauromorphs,
// lizards. `lowQuadruped(p)` builds the joints, lofted parts, eyes, claws, colours, gait and checks from
// real dimensions in metres (+z forward, feet at y = 0), so a new animal is a parameter set, not a spec.
// Limbs can sprawl (the knee and elbow swing out to the side and the foot comes back under).
// Three Triassic animals below, from fossil descriptions; colours are guesses.
import * as THREE from 'three';
import { mirror } from '../body.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const A = (v) => v.toArray().map((n) => +n.toFixed(4));
const UP = V(0, 1, 0);

export function lowQuadruped(p) {
  const { name, trunk, tail, neck, head, jaw, legs, look } = p;
  const yb = trunk.y, zP = trunk.pelvisZ, zC = trunk.chestZ, zM = (zP + zC) / 2;
  const joints = [
    { name: 'pelvis', at: [0, yb, zP], group: 'body' },
    { name: 'spine1', parent: 'pelvis', at: [0, yb + trunk.h * 0.06, zM], group: 'body' },
    { name: 'chest', parent: 'spine1', at: [0, yb + trunk.h * 0.04, zC], group: 'body' },
    { name: 'neck1', parent: 'chest', at: [0, yb + neck.rise * 0.5, zC + neck.len * 0.5], group: 'neck' },
    { name: 'head', parent: 'neck1', at: [0, yb + neck.rise, zC + neck.len], group: 'head' },
    { name: 'snout', parent: 'head', at: [0, yb + neck.rise - head.drop, zC + neck.len + head.len], group: 'head', bone: false },
  ];
  const hz = zC + neck.len, hy = yb + neck.rise;
  joints.push({ name: 'jaw', parent: 'head', at: [0, hy - head.h * 0.55, hz + head.len * 0.08], group: 'head' },
    { name: 'jawTip', parent: 'jaw', at: [0, hy - head.h * 0.55 - head.drop * 0.6, hz + head.len * jaw.len], group: 'head', bone: false });
  // Tail: n joints along a drooping curve.
  const tn = tail.n ?? 5, tNames = [];
  for (let k = 0; k < tn; k++) {
    const f = (k + 1) / (tn + 1), z = zP - tail.len * f, y = yb - tail.droop * f * f - trunk.h * 0.05 * f;
    tNames.push('tail' + k); joints.push({ name: 'tail' + k, parent: k ? 'tail' + (k - 1) : 'pelvis', at: [0, y, z], group: 'tail' });
  }
  joints.push({ name: 'tailEnd', parent: 'tail' + (tn - 1), at: [0, yb - tail.droop - trunk.h * 0.05, zP - tail.len], group: 'tail', bone: false });

  // Limbs (left side, mirrored). Sprawl tips the upper limb out to the side by that many radians; the
  // lower limb comes back under so the foot plants beside the body, not under it.
  const limbJ = [], limbP = [], limbA = [];
  const limb = (tag, rootJ, parent, x, z, y0, L) => {
    const s = L.sprawl ?? 0, up = L.up, lo = L.lo;
    const hip = V(x, y0, z), knee = hip.clone().add(V(Math.sin(s) * up, -Math.cos(s) * up, L.kneeZ ?? 0));
    const ankle = V(x + Math.sin(s) * up * (1 - (L.under ?? 0.45)), L.foot * 0.35, z + (L.ankleZ ?? 0));
    const ball = ankle.clone().add(V(0, -L.foot * 0.2, L.foot * 0.7));
    const [hn, kn, an, bn] = tag === 'leg' ? ['hipL', 'kneeL', 'ankleL', 'ballL'] : ['shoulderL', 'elbowL', 'wristL', 'palmL'];
    limbJ.push({ name: tag + 'RootL', parent, at: A(V(x * 0.7, y0 + L.r * 1.2, z)), group: tag, bone: false },
      { name: hn, parent, at: A(hip), group: tag }, { name: kn, parent: hn, at: A(knee), group: tag },
      { name: an, parent: kn, at: A(ankle), group: tag }, { name: bn, parent: an, at: A(ball), group: tag, bone: tag === 'leg' });
    limbP.push({ name: tag + 'L', chain: [tag + 'RootL', hn, kn, an, bn], startBone: parent, fuzz: p.fur ? 0.8 : 0, ring: 14, step: Math.max(0.01, L.r * 0.4), stripe: 0, join: 'body', blend: L.r * 0.8, keys: [
      { at: tag + 'RootL', w: L.r * 1.2, h: L.r * 1.5 }, { at: hn, w: L.r * 1.3, h: L.r * 1.5 }, { at: hn, off: up * 0.45, w: L.r, h: L.r * 1.1 },
      { at: kn, w: L.r * 0.7, h: L.r * 0.72, lm: 0.5 }, { at: an, w: L.r * 0.5, h: L.r * 0.5, lm: 1 }, { at: bn, w: L.r * 0.62, h: L.r * 0.28, flatB: 0.4, lm: 1 }] });
    // Toes: short, splayed, each with a small claw.
    const fwd = ball.clone().sub(ankle).setY(0).normalize();
    (L.toes ?? [-0.5, -0.17, 0.17, 0.5]).forEach((ang, k) => {
      const d = fwd.clone().applyAxisAngle(UP, -ang), a = ball.clone().addScaledVector(d, L.foot * 0.08); a.y = L.foot * 0.12;
      const b = a.clone().addScaledVector(d, L.foot * (0.42 - Math.abs(ang) * 0.25)); b.y = L.foot * 0.07;
      limbJ.push({ name: `${tag}t${k}aL`, parent: an, at: A(a), group: tag, bone: false }, { name: `${tag}t${k}bL`, parent: `${tag}t${k}aL`, at: A(b), group: tag, bone: false });
      limbP.push({ chain: [`${tag}t${k}aL`, `${tag}t${k}bL`], join: tag + 'L', blend: L.r * 0.15, keys: [{ at: `${tag}t${k}aL`, w: L.r * 0.22, h: L.r * 0.16 }, { at: `${tag}t${k}bL`, w: L.r * 0.13, h: L.r * 0.1 }], ring: 8, step: Math.max(0.005, L.foot * 0.12), side: [0, 1, 0], stripe: 0, limb: 1 });
      limbA.push({ type: 'claw', bone: an, at: A(b), dir: A(d.clone().add(V(0, -0.25, 0)).normalize()), len: L.r * 0.35, curl: 0.5, w: L.r * 0.12 });
    });
  };
  limb('leg', 'hip', 'pelvis', legs.hind.x, zP + (legs.hind.z ?? 0), yb - trunk.h * 0.35, legs.hind);
  limb('arm', 'shoulder', 'chest', legs.fore.x, zC - (legs.fore.z ?? 0), yb - trunk.h * 0.38, legs.fore);

  const body = ['tailEnd', ...tNames.slice().reverse(), 'pelvis', 'spine1', 'chest', 'neck1', 'head', 'snout'];
  const tk = tNames.map((n, k) => { const f = 1 - (k + 1) / (tn + 1); return { at: n, w: tail.w * Math.pow(f, tail.taper ?? 1.2), h: tail.h * Math.pow(f, tail.taper ?? 1.2) }; }).reverse();
  const parts = [
    { name: 'body', chain: body, fuzz: p.fur ? 1 : 0, ring: 26, step: Math.max(0.01, trunk.w * 0.12), capE: 1.3, keys: [
      { at: 'tailEnd', w: tail.w * 0.06, h: tail.h * 0.06 }, ...tk,
      { at: 'pelvis', w: trunk.w * 0.72, h: trunk.h * 0.78, topN: 0.06 },
      { at: 'spine1', w: trunk.w, h: trunk.h, yo: -trunk.h * (trunk.sag ?? 0.12), flatB: 0.12, topN: 0.1 },
      { at: 'chest', w: trunk.w * 0.82, h: trunk.h * 0.85, yo: -trunk.h * 0.06, topN: 0.08 },
      { at: 'neck1', w: neck.w, h: neck.h },
      ...head.keys.map((k) => ({ at: 'head', off: k.off * head.len, w: k.w * head.w, h: k.h * head.h, yo: (k.yo ?? 0) * head.h, flatB: k.flatB ?? 0.15, topN: k.topN ?? 0.05, e: k.e ?? 2.6, st: 0 })),
      { at: 'snout', w: head.w * head.tip, h: head.h * head.tip * 1.1, st: 0 }] },
    { name: 'jaw', chain: ['jaw', 'jawTip'], ring: 14, step: Math.max(0.006, head.len * 0.06), stripe: 0, keys: [
      { at: 'jaw', w: head.w * jaw.w, h: head.h * 0.24, flatT: 0.5 }, { at: 'jaw', off: head.len * jaw.len * 0.5, w: head.w * jaw.w * 0.7, h: head.h * 0.2, flatT: 0.5 },
      { at: 'jawTip', w: head.w * 0.18, h: head.h * 0.12, flatT: 0.5 }] },
    ...mirror(limbP),
  ];
  const attach = [
    { type: 'eye', bone: 'head', at: [head.w * head.eye[0], hy + head.h * head.eye[1], hz + head.len * head.eye[2]], r: head.h * head.eyeR, iris: look.iris || '#6a4a1c' },
    ...mirror(limbA),
  ];
  // A hooked beak (rhynchosaurs): a short, dark, downturned lofted horn at the snout.
  if (p.beak) {
    const sn = V(0, hy - head.drop, hz + head.len);
    joints.push({ name: 'beakA', parent: 'head', at: A(sn.clone().add(V(0, head.h * 0.1, -head.len * 0.06))), group: 'head', bone: false },
      { name: 'beakB', parent: 'beakA', at: A(sn.clone().add(V(0, -head.h * 0.15, head.len * 0.08))), group: 'head', bone: false },
      { name: 'beakC', parent: 'beakB', at: A(sn.clone().add(V(0, -head.h * p.beak, head.len * 0.06))), group: 'head', bone: false });
    parts.push({ chain: ['beakA', 'beakB', 'beakC'], join: 'body', blend: head.h * 0.08, ring: 12, step: head.len * 0.03, stripe: 0, tint: look.beak || '#2c2620', tipCap: 0.5, capE: 1, keys: [
      { at: 'beakA', w: head.w * 0.16, h: head.h * 0.2 }, { at: 'beakB', w: head.w * 0.12, h: head.h * 0.16 }, { at: 'beakC', w: head.w * 0.03, h: head.h * 0.03 }] });
  }
  const total = trunk.chestZ + neck.len + head.len - (zP - tail.len);
  return {
    name, joints: [...joints, ...mirror(limbJ)], parts, attach,
    look: { limb: look.flank, stripe: { freq: 1.6 / total, depth: 0.18 }, scales: { size: 90 / Math.max(0.05, total), depth: 0.3 }, mottle: 0.45, ...look },
    gait: {
      stride: (legs.hind.up + legs.hind.lo) * 0.6, duty: 0.6, lift: legs.hind.foot * 0.4, speed: 0.5 * total,
      legs: [
        { hip: 'hipL', knee: 'kneeL', ankle: 'ankleL', foot: 'ballL', phase: 0, pole: [0.5, 0.4, 0.5] },
        { hip: 'shoulderL', knee: 'elbowL', ankle: 'wristL', phase: 0.25, pole: [0.5, 0.4, -0.3] },
        { hip: 'hipR', knee: 'kneeR', ankle: 'ankleR', foot: 'ballR', phase: 0.5, pole: [-0.5, 0.4, 0.5] },
        { hip: 'shoulderR', knee: 'elbowR', ankle: 'wristR', phase: 0.75, pole: [-0.5, 0.4, -0.3] },
      ],
      lag: [{ bones: tNames, gain: 0.12, w: 5, falloff: 0.85 }],
    },
    checks: [{ name: 'Length', value: (m) => m.length, min: p.length[0], max: p.length[1], unit: 'm' }, ...(p.checks || [])],
  };
}

// Hyperodapedon sanjuanensis (Ischigualasto, about 1.3-1.6 m, 80 kg): a barrel-bodied rhynchosaur on sprawling
// limbs; a broad triangular skull much wider at the cheeks than long, narrowing fast to a hooked beak.
export const hyperodapedon = lowQuadruped({
  name: 'Hyperodapedon', length: [1.25, 1.65],
  trunk: { y: 0.44, pelvisZ: -0.32, chestZ: 0.3, w: 0.33, h: 0.26, sag: 0.18 },
  tail: { len: 0.5, n: 5, droop: 0.24, w: 0.19, h: 0.17, taper: 1.1 },
  neck: { len: 0.13, rise: 0.04, w: 0.17, h: 0.15 },
  head: { len: 0.3, w: 0.2, h: 0.13, drop: 0.06, tip: 0.18, eyeR: 0.17, eye: [0.55, 0.28, 0.24],
    keys: [{ off: -0.05, w: 0.85, h: 0.95 }, { off: 0.12, w: 1, h: 1, flatB: 0.2, topN: 0.02, e: 3 }, { off: 0.45, w: 0.62, h: 0.82, yo: -0.1, e: 2.8 }, { off: 0.75, w: 0.3, h: 0.55, yo: -0.25 }] },
  jaw: { len: 0.82, w: 0.82 },
  legs: { hind: { x: 0.2, up: 0.2, lo: 0.2, r: 0.075, foot: 0.13, sprawl: 0.55, under: 0.5 }, fore: { x: 0.19, up: 0.18, lo: 0.19, r: 0.065, foot: 0.11, sprawl: 0.6, under: 0.5, z: 0.04 } },
  beak: 0.5,
  look: { back: '#5c5236', flank: '#857653', belly: '#b9a77f', beak: '#2e2a22', iris: '#5a3d16' },
  checks: [{ name: 'Skull wider than long', value: (m) => (2 * 0.2) / (m.J('snout')[2] - m.J('head')[2]), min: 1.0, max: 1.6 }],
});

// Exaeretodon (about 1.6 m): a stocky, deep-skulled plant-eating cynodont with near-erect limbs and a short
// tail; a mammal relative, so a soft furred coat.
export const exaeretodon = lowQuadruped({
  name: 'Exaeretodon', length: [1.45, 1.8],
  trunk: { y: 0.4, pelvisZ: -0.42, chestZ: 0.32, w: 0.2, h: 0.21, sag: 0.1 },
  tail: { len: 0.38, n: 4, droop: 0.16, w: 0.11, h: 0.11, taper: 1.4 },
  neck: { len: 0.2, rise: 0.06, w: 0.13, h: 0.14 },
  head: { len: 0.32, w: 0.11, h: 0.12, drop: 0.06, tip: 0.28, eyeR: 0.16, eye: [0.7, 0.4, 0.42],
    keys: [{ off: -0.04, w: 0.9, h: 0.95 }, { off: 0.25, w: 1, h: 1, e: 2.4 }, { off: 0.62, w: 0.68, h: 0.72, yo: -0.12, e: 2.4 }] },
  jaw: { len: 0.85, w: 0.75 },
  fur: true,
  legs: { hind: { x: 0.15, up: 0.2, lo: 0.17, r: 0.05, foot: 0.11, sprawl: 0.18, under: 0.6 }, fore: { x: 0.14, up: 0.18, lo: 0.16, r: 0.045, foot: 0.1, sprawl: 0.25, under: 0.6, z: 0.04 } },
  look: { back: '#4f4434', flank: '#7a6a50', belly: '#b3a083', iris: '#2a1a10', scales: { size: 160, depth: 0.02 }, mottle: 0.3,
    fuzz: { len: 0.012, layers: 4, density: 0.004, root: '#3f3628', tipA: '#7d6a4e', tipB: '#4a3e2e', below: -0.6 } },
});

// A small burrowing cynodont (about 0.3 m): slim and weasel-like, short legs, a longer tail, rounded head.
export const smallCynodont = lowQuadruped({
  name: 'Small cynodont', length: [0.26, 0.36],
  trunk: { y: 0.055, pelvisZ: -0.07, chestZ: 0.05, w: 0.033, h: 0.03, sag: 0.05 },
  tail: { len: 0.12, n: 4, droop: 0.02, w: 0.016, h: 0.016, taper: 1.3 },
  neck: { len: 0.025, rise: 0.008, w: 0.024, h: 0.024 },
  head: { len: 0.05, w: 0.02, h: 0.018, drop: 0.006, tip: 0.3, eyeR: 0.2, eye: [0.65, 0.35, 0.4],
    keys: [{ off: 0, w: 1, h: 1, e: 2.2 }, { off: 0.55, w: 0.65, h: 0.7, yo: -0.1, e: 2.2 }] },
  jaw: { len: 0.82, w: 0.7 },
  fur: true,
  legs: { hind: { x: 0.024, up: 0.026, lo: 0.024, r: 0.008, foot: 0.018, sprawl: 0.5, under: 0.5 }, fore: { x: 0.022, up: 0.022, lo: 0.022, r: 0.007, foot: 0.015, sprawl: 0.55, under: 0.5, z: 0.004 } },
  look: { back: '#5a4129', flank: '#8a6a48', belly: '#c4a882', iris: '#140c08', scales: { size: 900, depth: 0.02 }, mottle: 0.35,
    fuzz: { len: 0.0025, layers: 4, density: 0.0007, root: '#4a3420', tipA: '#94704a', tipB: '#5a4129', below: -0.6 } },
});
