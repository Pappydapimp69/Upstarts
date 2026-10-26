// Saurosuchus galilei (~6.5 m): deep trunk, upright columnar limbs (hind longer), long tail, a tall
// narrow skull about 0.9 m long, paired osteoderms down the back. From the fossil descriptions;
// colours are guesses. This is the hero version of the stacked-tube prop Upstarts first shipped.
import * as THREE from 'three';
import { mirror } from '../body.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const A = (v) => v.toArray().map((n) => +n.toFixed(4));
const UP = V(0, 1, 0);

const joints = [
  { name: 'pelvis', at: [0, 1.18, -0.75], group: 'body' },
  { name: 'spine1', parent: 'pelvis', at: [0, 1.22, -0.2], group: 'body' },
  { name: 'spine2', parent: 'spine1', at: [0, 1.24, 0.4], group: 'body' },
  { name: 'chest', parent: 'spine2', at: [0, 1.25, 0.95], group: 'body' },
  { name: 'neck1', parent: 'chest', at: [0, 1.32, 1.35], group: 'neck' },
  { name: 'head', parent: 'neck1', at: [0, 1.4, 1.64], group: 'head' },
  { name: 'snout', parent: 'head', at: [0, 1.28, 2.56], group: 'head', bone: false },
  { name: 'jaw', parent: 'head', at: [0, 1.2, 1.68], group: 'head' },
  { name: 'jawTip', parent: 'jaw', at: [0, 1.2, 2.52], group: 'head', bone: false },
];
const TAIL = [[1.13, -1.25], [1.06, -1.8], [0.97, -2.35], [0.86, -2.9], [0.74, -3.45], [0.62, -3.95], [0.52, -4.4]];
TAIL.forEach(([y, z], k) => joints.push({ name: 'tail' + k, parent: k ? 'tail' + (k - 1) : 'pelvis', at: [0, y, z], group: 'tail' }));
joints.push({ name: 'tailEnd', parent: 'tail6', at: [0, 0.44, -4.75], group: 'tail', bone: false });

const limbJ = [
  { name: 'hipRootL', parent: 'pelvis', at: [0.26, 1.28, -0.72], group: 'leg', bone: false },
  { name: 'hipL', parent: 'pelvis', at: [0.34, 1.02, -0.74], group: 'leg' },
  { name: 'kneeL', parent: 'hipL', at: [0.38, 0.58, -0.56], group: 'leg' },
  { name: 'ankleL', parent: 'kneeL', at: [0.37, 0.15, -0.74], group: 'leg' },
  { name: 'ballL', parent: 'ankleL', at: [0.37, 0.05, -0.52], group: 'leg' },
  { name: 'shoulderRootL', parent: 'chest', at: [0.24, 1.2, 0.95], group: 'arm', bone: false },
  { name: 'shoulderL', parent: 'chest', at: [0.33, 0.98, 0.95], group: 'arm' },
  { name: 'elbowL', parent: 'shoulderL', at: [0.37, 0.56, 0.8], group: 'arm' },
  { name: 'wristL', parent: 'elbowL', at: [0.36, 0.13, 0.94], group: 'arm' },
  { name: 'palmL', parent: 'wristL', at: [0.36, 0.05, 1.06], group: 'arm', bone: false },
];
const limbP = [
  { name: 'legL', chain: ['hipRootL', 'hipL', 'kneeL', 'ankleL', 'ballL'], startBone: 'pelvis', ring: 18, step: 0.045, stripe: 0, join: 'body', blend: 0.09, keys: [
    { at: 'hipRootL', w: 0.2, h: 0.28 }, { at: 'hipL', w: 0.24, h: 0.32 }, { at: 'hipL', off: 0.2, w: 0.2, h: 0.25 },
    { at: 'kneeL', w: 0.13, h: 0.14, lm: 0.5 }, { at: 'kneeL', off: 0.18, w: 0.11, h: 0.12, lm: 0.9 },
    { at: 'ankleL', w: 0.085, h: 0.09, lm: 1 }, { at: 'ballL', w: 0.09, h: 0.055, flatB: 0.4, lm: 1 }] },
  { name: 'armL', chain: ['shoulderRootL', 'shoulderL', 'elbowL', 'wristL', 'palmL'], startBone: 'chest', ring: 16, step: 0.045, stripe: 0, join: 'body', blend: 0.08, keys: [
    { at: 'shoulderRootL', w: 0.17, h: 0.22 }, { at: 'shoulderL', w: 0.17, h: 0.2 }, { at: 'elbowL', w: 0.11, h: 0.12, lm: 0.6 },
    { at: 'wristL', w: 0.075, h: 0.08, lm: 1 }, { at: 'palmL', w: 0.08, h: 0.045, flatB: 0.4, lm: 1 }] },
];
const limbA = [];
// Short blunt toes with small claws: four behind, five in front.
const toes = (base, fwd, bone, list, tag) => list.forEach(([ang, len, w], k) => {
  const d = fwd.clone().applyAxisAngle(UP, ang), a = base.clone().addScaledVector(d, 0.03); a.y = 0.04;
  const b = a.clone().addScaledVector(d, len); b.y = 0.025;
  limbJ.push({ name: `${tag}${k}aL`, parent: bone, at: A(a), group: 'leg', bone: false }, { name: `${tag}${k}bL`, parent: `${tag}${k}aL`, at: A(b), group: 'leg', bone: false });
  limbP.push({ chain: [`${tag}${k}aL`, `${tag}${k}bL`], join: tag === 'ht' ? 'legL' : 'armL', blend: 0.02, keys: [{ at: `${tag}${k}aL`, w, h: w * 0.75 }, { at: `${tag}${k}bL`, w: w * 0.6, h: w * 0.5 }], ring: 10, step: 0.03, side: [0, 1, 0], stripe: 0, limb: 1 });
  limbA.push({ type: 'claw', bone, at: A(b.clone().addScaledVector(d, -0.005)), dir: A(d.clone().add(V(0, -0.2, 0)).normalize()), len: w * 1.6, curl: 0.6, w: w * 0.55 });
});
toes(V(0.37, 0.05, -0.52), V(0.05, 0, 1).normalize(), 'ballL', [[0.42, 0.13, 0.04], [0.14, 0.17, 0.045], [-0.14, 0.17, 0.045], [-0.42, 0.13, 0.038]], 'ht');
toes(V(0.36, 0.05, 1.06), V(0.1, 0, 1).normalize(), 'wristL', [[0.6, 0.07, 0.03], [0.3, 0.1, 0.035], [0, 0.11, 0.036], [-0.3, 0.1, 0.034], [-0.6, 0.07, 0.028]], 'ft');

const BODY = ['tailEnd', 'tail6', 'tail5', 'tail4', 'tail3', 'tail2', 'tail1', 'tail0', 'pelvis', 'spine1', 'spine2', 'chest', 'neck1', 'head', 'snout'];

export const saurosuchus = {
  name: 'Saurosuchus',
  joints: [...joints, ...mirror(limbJ)],
  parts: [
    { name: 'body', chain: BODY, ring: 28, step: 0.05, capE: 1, keys: [
      { at: 'tailEnd', w: 0.02, h: 0.03 }, { at: 'tail6', w: 0.055, h: 0.08 }, { at: 'tail5', w: 0.085, h: 0.12 },
      { at: 'tail4', w: 0.12, h: 0.16 }, { at: 'tail3', w: 0.16, h: 0.21 }, { at: 'tail2', w: 0.21, h: 0.26 },
      { at: 'tail1', w: 0.26, h: 0.31, yo: -0.02 }, { at: 'tail0', w: 0.31, h: 0.36, yo: -0.03 },
      { at: 'pelvis', w: 0.37, h: 0.42, yo: -0.04, topN: 0.1 }, { at: 'spine1', w: 0.44, h: 0.5, yo: -0.07, topN: 0.14, flatB: 0.1 },
      { at: 'spine2', w: 0.47, h: 0.54, yo: -0.09, topN: 0.16, flatB: 0.12 }, { at: 'chest', w: 0.42, h: 0.5, yo: -0.08, topN: 0.14 },
      { at: 'neck1', w: 0.27, h: 0.3, yo: -0.02, topN: 0.08 },
      // Tall, narrow skull (oreinirostral), flat-sided and deep behind the eyes.
      { at: 'head', off: -0.06, w: 0.22, h: 0.24, e: 2.8, st: 0 },
      { at: 'head', off: 0.18, w: 0.2, h: 0.22, yo: 0.0, flatB: 0.15, topN: 0.1, e: 3.2, st: 0 },
      { at: 'head', off: 0.45, w: 0.13, h: 0.16, yo: -0.02, flatB: 0.2, topN: 0.12, e: 3.0, st: 0 },
      { at: 'head', off: 0.75, w: 0.08, h: 0.11, yo: -0.03, flatB: 0.2, topN: 0.1, e: 2.7, st: 0 },
      { at: 'snout', w: 0.05, h: 0.07, flatB: 0.2, st: 0 }] },
    { name: 'jaw', chain: ['jaw', 'jawTip'], ring: 16, step: 0.04, stripe: 0, keys: [
      { at: 'jaw', w: 0.19, h: 0.1, yo: -0.03, flatT: 0.5 }, { at: 'jaw', off: 0.35, w: 0.13, h: 0.075, yo: -0.03, flatT: 0.5 },
      { at: 'jawTip', w: 0.045, h: 0.04, yo: -0.02, flatT: 0.5 }] },
    ...mirror(limbP),
  ],
  attach: [
    { type: 'teeth', bone: 'head', from: [0.15, 1.19, 1.86], to: [0.045, 1.22, 2.48], count: 12, w: 0.016, len: 0.07 },
    { type: 'teeth', bone: 'jaw', from: [0.13, 1.21, 1.82], to: [0.035, 1.2, 2.44], count: 10, w: 0.013, len: 0.05, up: true },
    { type: 'eye', bone: 'head', at: [0.17, 1.5, 1.82], r: 0.036, iris: '#7a5a1c' },
    // Paired osteoderms down the back and tail, shrinking toward the tip.
    { type: 'row', part: 'body', from: 'neck1', to: 'tail3', count: 30, x: 0.18, size: [0.12, 0.04, 0.16], tilt: 0.3, scaleFrom: 0.8, scaleTo: 0.75 },
    { type: 'row', part: 'body', from: 'tail3', to: 'tail6', count: 12, x: 0.25, size: [0.08, 0.03, 0.11], tilt: 0.35 },
    ...mirror(limbA),
  ],
  look: {
    back: '#3a3229', flank: '#5b4a37', belly: '#a08a6a', limb: '#2e2820', plate: '#2a241d',
    stripe: { freq: 1.1, depth: 0.3 }, scales: { size: 26, depth: 0.45 }, mottle: 0.5,
    marks: [{ joint: 'head', at: [0.12, 1.43, 2.12], r: [0.09, 0.035], depth: 0.02 }, { joint: 'head', at: [0.04, 1.33, 2.5], r: [0.03, 0.015], depth: 0.01 }],
  },
  // Lateral-sequence walk (left hind, left fore, right hind, right fore), elbows back and knees forward.
  gait: {
    stride: 0.45, duty: 0.65, lift: 0.1, speed: 0.9,
    legs: [
      { hip: 'hipL', knee: 'kneeL', ankle: 'ankleL', foot: 'ballL', phase: 0, pole: [0.4, 0.6, 0.6] },
      { hip: 'shoulderL', knee: 'elbowL', ankle: 'wristL', phase: 0.25, pole: [0.4, 0.55, 0.2] },
      { hip: 'hipR', knee: 'kneeR', ankle: 'ankleR', foot: 'ballR', phase: 0.5, pole: [-0.4, 0.6, 0.6] },
      { hip: 'shoulderR', knee: 'elbowR', ankle: 'wristR', phase: 0.75, pole: [-0.4, 0.55, 0.2] },
    ],
    bob: { bone: 'pelvis', amp: 0.015 },
    lag: [{ bones: ['tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6'], gain: 0.1, w: 4, falloff: 0.85 }],
  },
  checks: [
    { name: 'Length', value: (m) => m.length, min: 6, max: 7.5, unit: 'm' },
    { name: 'Skull length', value: (m) => m.J('snout')[2] - m.J('head')[2] + 0.06, min: 0.8, max: 1.0, unit: 'm' },
    { name: 'Hind limb taller than fore', value: (m) => m.J('hipL')[1] - m.J('shoulderL')[1], min: 0.01, max: 0.3, unit: 'm' },
  ],
};
