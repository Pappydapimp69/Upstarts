// Four-legged reptile bodies built the way the Herrerasaurus is: one continuous lofted, skinned surface from tail tip to
// snout over a bone chain, lofted limbs with toes and claws, teeth, eyes, and osteoderms as separate skinned plates,
// with a procedural reptile skin (small scales, larger dorsal scutes, countershading, blotches) and the wet and mud
// bands from the sim's coat. Built in adult metres, +z forward, origin on the ground under the hips.
import * as THREE from 'three';
import { clamp, lerp, smooth } from '../../sim/math';
import { SkinBuilder, loft, makeProfile, arcLengths, curvedClaw } from './herrerasaurus.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GEO = new WeakMap(); // spec -> shared geometry
const M4 = () => new THREE.Matrix4();
const BANDS = 24;

// Skin and coat uniforms, one set per model (the player, and every Saurosuchus and Hyperodapedon in view, each with
// its own palette and wet and mud bands).
const makeU = () => ({
  qWet: { value: new Float32Array(BANDS) }, qMud: { value: new Float32Array(BANDS) },
  qDry: { value: new Float32Array(BANDS) }, qFlake: { value: new Float32Array(BANDS) },
  qBandH: { value: 0.03 }, qLive: { value: 1 },
  qBack: { value: new THREE.Vector3() }, qFlank: { value: new THREE.Vector3() }, qBelly: { value: new THREE.Vector3() },
  qBlotch: { value: 1 }, qScale: { value: 60 }, qScute: { value: 1 }, qMidZ: { value: V(-1, 1, 0) },
});

const reptileGLSL = /* glsl */`
  varying vec3 vBP; varying vec3 vBN;
  uniform float qWet[${BANDS}]; uniform float qMud[${BANDS}]; uniform float qDry[${BANDS}]; uniform float qFlake[${BANDS}];
  uniform float qBandH; uniform float qLive; uniform vec3 qBack; uniform vec3 qFlank; uniform vec3 qBelly; uniform float qBlotch;
  uniform float qScale; uniform float qScute; uniform vec3 qMidZ;
  ${['qWet', 'qMud', 'qDry', 'qFlake'].map((n) => `float b_${n}(float y){ float f = clamp(y / qBandH, 0.0, ${BANDS - 1}.0); int i = int(floor(f)); int j = min(i + 1, ${BANDS - 1}); return mix(${n}[i], ${n}[j], f - float(i)); }`).join('\n  ')}
  float rH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float rN(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(rH(i), rH(i + vec3(1,0,0)), f.x), mix(rH(i + vec3(0,1,0)), rH(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(rH(i + vec3(0,0,1)), rH(i + vec3(1,0,1)), f.x), mix(rH(i + vec3(0,1,1)), rH(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float rF(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * rN(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / 0.9375; }
  vec3 rH3(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453123); }
  vec3 rV(vec3 x){ vec3 p = floor(x); vec3 f = fract(x); float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec3 b = vec3(float(i), float(j), float(k)); vec3 h = rH3(p + b); vec3 r = b + h - f; float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h.x; } else if (d < d2) { d2 = d; } }
    return vec3(sqrt(d1), sqrt(d2), id); }
  vec3 rPerturb(vec3 sp, vec3 sn, float h){
    vec3 sx = dFdx(sp); vec3 sy = dFdy(sp); vec3 r1 = cross(sy, sn); vec3 r2 = cross(sn, sx);
    float det = dot(sx, r1); vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    float gl = length(grad), lim = abs(det) * 0.45; if (gl > lim) grad *= lim / gl;
    vec3 n2 = abs(det) * sn - grad; return dot(n2, n2) > 1e-20 ? normalize(n2) : sn; }
`;
const reptileColorGLSL = /* glsl */`
  vec3 P = vBP; vec3 BN = normalize(vBN);
  float viewD = length(vViewPosition), fw = length(fwidth(P));
  float detail = (1.0 - smoothstep(4.0, 18.0, viewD)) * (1.0 - smoothstep(0.004, 0.01, fw));
  float dors = smoothstep(-0.2, 0.7, BN.y), vent = smoothstep(0.0, -0.7, BN.y);
  vec3 skin = mix(qFlank, qBack, dors);
  skin = mix(skin, qBelly, vent);
  // Irregular dark blotches across the back and flanks (colours are unknown from fossils).
  float bl = smoothstep(0.55, 0.72, rF(P * vec3(5.0, 5.0, 3.2) + 4.0)) * (1.0 - vent);
  skin *= 1.0 - 0.45 * qBlotch * bl;
  skin *= 0.82 + 0.36 * rF(P * 13.0);
  // Small pebbly scales everywhere; along the back, larger squarish scutes in rows.
  vec3 vo = rV(P * qScale);
  float scaleH = smoothstep(0.0, 0.4, vo.y - vo.x);
  skin *= mix(1.0, mix(0.62, 1.05, scaleH) * (0.9 + 0.18 * vo.z), 0.35 + 0.65 * detail);
  float back = smoothstep(0.45, 0.85, BN.y) * step(qMidZ.x, P.z) * step(P.z, qMidZ.y);
  vec3 vo2 = rV(P * vec3(qScale * 0.45, qScale * 0.45, qScale * 0.3));
  float scuteH = smoothstep(0.0, 0.25, vo2.y - vo2.x);
  float hSkin = mix(scaleH, 1.3 * scuteH, back * qScute);
  skin = mix(skin, skin * mix(0.6, 1.0, scuteH), back * qScute);
  // Wet and mud, by bind-pose height (bands of the coat), with a ragged edge.
  float yj = P.y + (rN(P * 7.0) - 0.5) * 0.04;
  float wet = b_qWet(yj) * qLive;
  float wetV = smoothstep(0.0, 0.22, wet - rN(P * 4.0 + 3.1) * 0.78);
  float cover = b_qMud(yj) * qLive, mDry = b_qDry(yj), mFl = b_qFlake(yj);
  vec3 pl = rV(P * 17.0 + 7.3);
  float mudM = smoothstep(0.3, 0.7, cover) * step(mFl * 1.001, pl.z * 0.98 + 0.01);
  float dryV = smoothstep(0.0, 0.25, mDry - rN(P * 3.3 + 11.0) * 0.75);
  vec3 mudC = mix(vec3(0.055, 0.036, 0.022), vec3(0.13, 0.094, 0.06) * (0.82 + 0.3 * pl.z), dryV);
  vec3 skinW = mix(skin, pow(skin, vec3(1.12)) * 0.45, wetV);
  float gH = mix(hSkin * mix(1.0, 0.55, wetV), 1.0 + smoothstep(0.0, 0.09, pl.y - pl.x) * 1.2, mudM);
  float gRough = mix(mix(0.7, 0.3, wetV), mix(0.3, 0.97, dryV), mudM);
  float gCoat = mix(wetV * 0.9, (1.0 - dryV) * 0.45, mudM);
  diffuseColor.rgb = mix(skinW, mudC, mudM);
`;
function reptileMaterial(u) {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.7, metalness: 0, envMapIntensity: 0.8, clearcoat: 1, clearcoatRoughness: 0.1, specularIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBP; varying vec3 vBN; attribute vec3 aBind; attribute vec3 aBindN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBP = aBind; vBN = aBindN;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + reptileGLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + reptileColorGLSL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = rPerturb(-vViewPosition, normal, gH * 0.0025 * detail);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.clearcoat = gCoat; material.clearcoatRoughness = 0.08;');
  };
  m.customProgramCacheKey = () => 'reptile-skin-v1';
  return m;
}

// The frame of a loft at arc length s along pts (centre, tangent, right, up), matching loft()'s own framing.
function frameAt(pts, s) {
  const L = arcLengths(pts);
  let j = 0; while (j < pts.length - 2 && s > L[j + 1]) j++;
  const t = clamp((s - L[j]) / ((L[j + 1] - L[j]) || 1), 0, 1);
  const c = pts[j].clone().lerp(pts[j + 1], t), tan = pts[j + 1].clone().sub(pts[j]).normalize();
  const side = V(1, 0, 0), right = side.clone().addScaledVector(tan, -side.dot(tan)).normalize(), up = V().crossVectors(tan, right);
  return { c, tan, right, up, j };
}
// A point on a superellipse cross-section at angle a (0 = right side, pi/2 = top).
function onRing(P, a) {
  const ca = Math.cos(a), sa = Math.sin(a), e = P.e;
  return [Math.sign(ca) * Math.pow(Math.abs(ca), 2 / e) * P.w, Math.sign(sa) * Math.pow(Math.abs(sa), 2 / e) * P.h * (sa > 0 ? 1 - P.flatT : 1 - P.flatB) + P.yo];
}

// spec: joints (J), body profile keys by joint index, limb joints and girths, osteoderm layout, palette, skin scale.
export function buildQuadModel(spec) {
  const J = spec.J;
  const bones = [], B = {};
  const mk = (name, parent, abs) => {
    const b = new THREE.Bone(); b.name = name; b.userData.abs = abs.clone();
    if (parent) { b.position.copy(abs).sub(parent.userData.abs); parent.add(b); } else b.position.copy(abs);
    b.userData.index = bones.length; bones.push(b); B[name] = b; return b;
  };
  const I = (name) => B[name].userData.index;
  mk('pelvis', null, J.pelvis);
  mk('spine1', B.pelvis, J.spine1); mk('spine2', B.spine1, J.spine2); mk('chest', B.spine2, J.chest);
  mk('neck1', B.chest, J.neck1); mk('neck2', B.neck1, J.neck2); mk('head', B.neck2, J.head); mk('jaw', B.head, J.jaw);
  let tp = B.pelvis; J.tail.forEach((a, k) => { tp = mk('tail' + k, tp, a); });
  const legs = [];
  for (const front of [false, true]) {
    for (const sx of [1, -1]) {
      const S = (front ? 'F' : 'H') + (sx > 0 ? 'L' : 'R');
      const g = front ? spec.fore : spec.hind, m = (p) => V(sx * p[0], p[1], p[2]);
      const hip = m(g.hip), knee = m(g.knee), ankle = m(g.ankle), ball = m(g.ball);
      mk('thigh' + S, front ? B.chest : B.pelvis, hip); mk('shin' + S, B['thigh' + S], knee); mk('meta' + S, B['shin' + S], ankle); mk('toe' + S, B['meta' + S], ball);
      legs.push({ S, front, sx, hip, knee, ankle, ball, g });
    }
  }

  // The geometry is the same for every animal of a species: built once and shared (each gets its own bones).
  let G = GEO.get(spec);
  if (!G) {
    G = makeGeo();
    GEO.set(spec, G);
  }
  function makeGeo() {
    const DK = spec.detail ?? 1; // coarser for the many animals the player isn't (fewer rings, longer steps)
    const body = new SkinBuilder(), horn = new SkinBuilder(), eyes = new SkinBuilder();
    const bodyPts = [J.tailEnd, ...J.tail.slice().reverse(), J.pelvis, J.spine1, J.spine2, J.chest, J.neck1, J.neck2, J.head, J.snout];
    const nT = J.tail.length;
    const bodySeg = [...J.tail.map((_, k) => I('tail' + (nT - 1 - k))), I('pelvis'), I('pelvis'), I('spine1'), I('spine2'), I('chest'), I('neck1'), I('neck2'), I('head')];
    const BL = arcLengths(bodyPts);
    // Profile keys: [joint index along bodyPts, offset along it (m), w, h, extras].
    const prof = makeProfile(spec.body.map(([ji, off, w, h, x = {}]) => ({ s: BL[ji] + off, w, h, ...x })));
    loft(body, bodyPts, bodySeg, prof, { ring: Math.round(28 / DK), step: 0.022 * DK });
    const bodyVEnd = body.n;
    // Lower jaw.
    const jawPts = spec.jawPts;
    const jL = arcLengths(jawPts);
    loft(body, jawPts, [I('jaw'), I('jaw')], makeProfile(spec.jaw.map(([u, w, h, x = {}]) => ({ s: u * jL[jL.length - 1], w, h, ...x }))), { ring: 16, step: 0.02 });

    // Limbs: a lofted leg from inside the body down to the foot, then toes with claws.
    const clawC = new THREE.Color('#1f1914'), ivory = new THREE.Color('#d8cdb0');
    for (const L of legs) {
      const S = L.S, g = L.g;
      const pts = [L.hip.clone().add(V(-L.sx * g.girth * 0.6, g.girth * 0.8, 0)), L.hip, L.knee, L.ankle, L.ball];
      const ll = arcLengths(pts);
      const lp = makeProfile([
        { s: 0, w: g.girth * 1.1, h: g.girth * 1.3 }, { s: ll[1], w: g.girth, h: g.girth * 1.25 }, { s: lerp(ll[1], ll[2], 0.5), w: g.girth * 0.8, h: g.girth * 0.95 },
        { s: ll[2], w: g.girth * 0.62, h: g.girth * 0.68 }, { s: lerp(ll[2], ll[3], 0.5), w: g.girth * 0.52, h: g.girth * 0.56 },
        { s: ll[3], w: g.girth * 0.44, h: g.girth * 0.42 }, { s: ll[4], w: g.girth * 0.5, h: g.girth * 0.24 },
      ]);
      loft(body, pts, [I(L.front ? 'chest' : 'pelvis'), I('thigh' + S), I('shin' + S), I('meta' + S)], lp, { ring: 14, step: 0.02, startBone: I(L.front ? 'chest' : 'pelvis'), endBone: I('toe' + S) });
      // Toes: spread forward and out, the outer ones shorter; claws on the inner three.
      const n = g.toes.length;
      g.toes.forEach((len, k) => {
        const ang = (k - (n - 1) / 2) * g.spread * L.sx * -1 + L.sx * g.splay;
        const d = V(Math.sin(ang), 0, Math.cos(ang));
        const a = L.ball.clone().add(V(0, -L.ball.y + g.girth * 0.18, 0)), b = a.clone().addScaledVector(d, len);
        b.y = g.girth * 0.1;
        loft(body, [a, b], [I('toe' + S)], makeProfile([{ s: 0, w: g.girth * 0.22, h: g.girth * 0.16 }, { s: len, w: g.girth * 0.1, h: g.girth * 0.08 }]), { ring: 8, step: 0.015, side: V(0, 1, 0) });
        if (k < 3) curvedClaw(horn, b.clone().addScaledVector(d, -0.003), d.clone().add(V(0, -0.15, 0)).normalize(), V(0, -1, 0), g.claw, 0.8, g.claw * 0.3, I('toe' + S), clawC);
      });
    }
    // Teeth along the upper and lower jaw (conical for the croc-like skull; none at the aetosaur's shovel tip).
    if (spec.teeth) {
      const tooth = new THREE.ConeGeometry(spec.teeth.r, spec.teeth.len, 5);
      const hs = BL[bodyPts.length - 2], he = BL[bodyPts.length - 1];
      for (let k = 0; k < spec.teeth.n; k++) {
        const u = lerp(spec.teeth.from, spec.teeth.to, k / (spec.teeth.n - 1)), s = lerp(hs, he, u), f = frameAt(bodyPts, s), P = prof(s);
        for (const sx of [1, -1]) {
          const p = f.c.clone().addScaledVector(f.right, sx * P.w * 0.86).addScaledVector(f.up, P.yo - P.h * (1 - P.flatB) + 0.004);
          horn.prim(tooth, M4().makeRotationX(Math.PI).setPosition(p), I('head'), ivory);
        }
      }
    }
    // Eyes: on top of the head for the croc, at the sides for the aetosaur.
    const eyeC = new THREE.Color(spec.eye.color), pupilC = new THREE.Color('#0b0806');
    for (const sx of [1, -1]) {
      const [x, y, z, r] = spec.eye.at;
      eyes.prim(new THREE.SphereGeometry(r, 14, 10), M4().makeTranslation(sx * x, y, z), I('head'), eyeC);
      eyes.prim(new THREE.SphereGeometry(r * 0.5, 10, 8), M4().makeScale(0.5, 1.2, 0.9).setPosition(sx * (x + r * 0.55 * spec.eye.out[0]), y + r * 0.55 * spec.eye.out[1], z), I('head'), pupilC);
    }
    // Osteoderms: rows of plates lying on the body surface, each skinned to the bone under it. rows: [angle around the
    // body from the spine (rad), plate width, length, thickness, keel height].
    if (spec.armour) {
      const A = spec.armour, plateC = new THREE.Color(A.color);
      for (let s = BL[A.from] + A.offFrom; s < BL[A.to] + A.offTo; s += A.step) {
        const f = frameAt(bodyPts, s), P = prof(s), bone = bodySeg[Math.min(bodySeg.length - 1, f.j)];
        const taper = clamp((s - BL[A.from]) / Math.max(0.01, BL[A.to] - BL[A.from]), 0, 1);
        for (const [ang, w, l, th, keel] of A.rows) {
          for (const sx of ang === 0 ? [1] : [1, -1]) {
            const a = Math.PI / 2 - sx * ang, [x, y] = onRing(P, a);
            const size = lerp(1, A.tailShrink ?? 1, smooth(A.shrinkFrom ?? 1, 1, 1 - taper));
            const pos = f.c.clone().addScaledVector(f.right, x).addScaledVector(f.up, y);
            // Plate normal: the ring's outward normal there (approximately the radial direction).
            const nrm = f.right.clone().multiplyScalar(x / Math.max(1e-4, P.w * P.w)).addScaledVector(f.up, (y - P.yo) / Math.max(1e-4, P.h * P.h)).normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), nrm);
            const geo = new THREE.BoxGeometry(w * size, th, l * size);
            horn.prim(geo, M4().compose(pos.addScaledVector(nrm, th * 0.3), q, V(1, 1, 1)), bone, plateC.clone().multiplyScalar(0.85 + 0.3 * Math.random()));
            if (keel) horn.prim(new THREE.ConeGeometry(w * size * 0.28, keel * size, 4), M4().compose(pos.clone().addScaledVector(nrm, th * 0.5 + keel * size * 0.5), q, V(1, 1, 1)), bone, plateC);
          }
        }
      }
    }
    const bodyGeo = body.build();
    bodyGeo.setAttribute('aBind', bodyGeo.attributes.position.clone());
    bodyGeo.setAttribute('aBindN', bodyGeo.attributes.normal.clone());
    return { bodyGeo, hornGeo: horn.build(), eyeGeo: eyes.build(), bodyVEnd };
  }

  const rig = new THREE.Group();
  rig.add(B.pelvis);
  const u = makeU();
  const bodyVEnd = G.bodyVEnd;
  const bodyMesh = new THREE.SkinnedMesh(G.bodyGeo, reptileMaterial(u));
  const hornMesh = new THREE.SkinnedMesh(G.hornGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, envMapIntensity: 0.6, flatShading: true }));
  const eyeMesh = new THREE.SkinnedMesh(G.eyeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, envMapIntensity: 1.4 }));
  for (const m of [bodyMesh, hornMesh, eyeMesh]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; rig.add(m); }
  rig.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  for (const m of [bodyMesh, hornMesh, eyeMesh]) m.bind(skeleton);
  // Palette and pattern for the shader.
  u.qBack.value.copy(spec.palette.back); u.qFlank.value.copy(spec.palette.flank); u.qBelly.value.copy(spec.palette.belly);
  u.qBlotch.value = spec.palette.blotch; u.qScale.value = spec.skin.scale; u.qScute.value = spec.skin.scute;
  u.qMidZ.value.set(spec.skin.scuteZ[0], spec.skin.scuteZ[1], 0);
  const bandVerts = Array.from({ length: BANDS }, () => []);
  const legRig = legs.map((L) => ({
    S: L.S, front: L.front, sx: L.sx, thigh: B['thigh' + L.S], shin: B['shin' + L.S], meta: B['meta' + L.S], toe: B['toe' + L.S],
    thighRest: L.knee.clone().sub(L.hip).normalize(), shinRest: L.ankle.clone().sub(L.knee).normalize(), metaRest: L.ball.clone().sub(L.ankle).normalize(),
    thighLen: L.knee.distanceTo(L.hip), shinLen: L.ankle.distanceTo(L.knee), metaLen: L.ball.distanceTo(L.ankle),
    neutral: V(L.ball.x, 0, L.ball.z), knee: L.knee.clone(), hip: L.hip.clone(),
  }));
  return { rig, B, bones, skeleton, bodyMesh, u, legs: legRig, bandVerts, tails: J.tail.map((_, k) => B['tail' + k]), hip: J.pelvis.y, bodyVEnd };
}

const C = (h) => { const c = new THREE.Color(h); return V(c.r, c.g, c.b); };

// Proterochampsa barrionuevoi, 2.5 m: a low, flat-bodied croc-like animal on sprawling limbs (tibia about three
// quarters of the femur). A big flat triangular skull about a fifth of the body with the eyes and nostrils on top,
// a short neck, a paired row of small osteoderms down the back, and a long, deep, laterally flattened tail.
export const PROTEROCHAMPSA_SPEC = {
  J: {
    pelvis: V(0, 0.33, 0), spine1: V(0, 0.34, 0.17), spine2: V(0, 0.34, 0.35), chest: V(0, 0.32, 0.52),
    neck1: V(0, 0.32, 0.64), neck2: V(0, 0.33, 0.73), head: V(0, 0.33, 0.8), snout: V(0, 0.285, 1.3), jaw: V(0, 0.31, 0.82),
    tail: [V(0, 0.33, -0.15), V(0, 0.32, -0.33), V(0, 0.3, -0.52), V(0, 0.27, -0.72), V(0, 0.24, -0.9), V(0, 0.2, -1.06)], tailEnd: V(0, 0.17, -1.2),
  },
  // [joint, offset, w, h, extras] along tailEnd(0) .. tail(1..6) .. pelvis(7) spine1(8) spine2(9) chest(10) neck1(11) neck2(12) head(13) snout(14)
  body: [
    [0, 0, 0.008, 0.02], [1, 0, 0.018, 0.045], [2, 0, 0.03, 0.06], [3, 0, 0.045, 0.072], [4, 0, 0.062, 0.088], [5, 0, 0.085, 0.1], [6, 0, 0.11, 0.11],
    [7, 0, 0.14, 0.12, { flatB: 0.12 }], [8, 0, 0.18, 0.135, { flatB: 0.2, e: 2.6 }], [9, 0, 0.19, 0.14, { flatB: 0.22, e: 2.7 }], [10, 0, 0.165, 0.125, { flatB: 0.2, e: 2.6 }],
    [11, 0, 0.11, 0.08], [12, 0, 0.1, 0.07],
    // The skull: wide and flat behind the eyes, tapering to a long triangular snout, the jaw line low.
    [13, 0.02, 0.12, 0.065, { flatB: 0.4, e: 2.9, yo: 0.008 }], [13, 0.14, 0.11, 0.05, { flatB: 0.45, e: 3.0, yo: 0.004 }],
    [13, 0.3, 0.075, 0.035, { flatB: 0.45, e: 2.8 }], [13, 0.44, 0.045, 0.026, { flatB: 0.4, e: 2.5 }], [14, 0, 0.022, 0.016, { flatB: 0.3 }],
  ],
  jawPts: [V(0, 0.29, 0.82), V(0, 0.27, 1.05), V(0, 0.255, 1.28)],
  jaw: [[0, 0.11, 0.035, { flatT: 0.6, yo: -0.012 }], [0.5, 0.075, 0.026, { flatT: 0.6 }], [1, 0.022, 0.014, { flatT: 0.5 }]],
  teeth: { n: 16, from: 0.18, to: 0.96, r: 0.005, len: 0.022 },
  eye: { at: [0.045, 0.37, 0.9, 0.019], out: [0.3, 0.9], color: '#9a7a24' },
  hind: { hip: [0.12, 0.3, 0.0], knee: [0.27, 0.22, 0.09], ankle: [0.26, 0.05, -0.05], ball: [0.27, 0.02, 0.04], girth: 0.068, toes: [0.085, 0.11, 0.12, 0.105, 0.065], spread: 0.28, splay: 0.25, claw: 0.022 },
  fore: { hip: [0.1, 0.27, 0.52], knee: [0.22, 0.18, 0.44], ankle: [0.21, 0.05, 0.52], ball: [0.215, 0.02, 0.57], girth: 0.055, toes: [0.055, 0.07, 0.075, 0.065, 0.045], spread: 0.32, splay: 0.35, claw: 0.016 },
  armour: { from: 3, to: 12, offFrom: 0, offTo: 0, step: 0.06, rows: [[0.12, 0.045, 0.052, 0.01, 0]], color: '#2c3123', tailShrink: 0.5, shrinkFrom: 0.6 },
  palette: { back: C('#2a2f22'), flank: C('#4a4d36'), belly: C('#a39a78'), blotch: 1.0 },
  skin: { scale: 70, scute: 1, scuteZ: [-1.2, 0.8] },
};

// Aetosauroides scagliai, 2.2 m: an erect-limbed armoured quadruped, hind legs longer than the fore, a broad flat trunk
// under a carapace of paired plates with lateral rows bearing small bosses, from the neck to the tail; a small head
// (the skull only a few centimetres tall) with a shovel-shaped toothless snout tip; a long armoured tail.
export const AETOSAUROIDES_SPEC = {
  J: {
    pelvis: V(0, 0.5, 0), spine1: V(0, 0.52, 0.2), spine2: V(0, 0.51, 0.4), chest: V(0, 0.47, 0.57),
    neck1: V(0, 0.45, 0.66), neck2: V(0, 0.44, 0.76), head: V(0, 0.43, 0.84), snout: V(0, 0.385, 1.04), jaw: V(0, 0.41, 0.85),
    tail: [V(0, 0.48, -0.2), V(0, 0.45, -0.4), V(0, 0.4, -0.6), V(0, 0.35, -0.78), V(0, 0.29, -0.95), V(0, 0.24, -1.08)], tailEnd: V(0, 0.2, -1.17),
  },
  body: [
    [0, 0, 0.008, 0.012], [1, 0, 0.03, 0.035], [2, 0, 0.05, 0.055], [3, 0, 0.075, 0.075], [4, 0, 0.1, 0.095], [5, 0, 0.13, 0.115], [6, 0, 0.16, 0.13],
    [7, 0, 0.2, 0.15, { flatT: 0.25, flatB: 0.1, e: 2.8 }], [8, 0, 0.27, 0.18, { flatT: 0.35, flatB: 0.15, e: 3.0 }], [9, 0, 0.29, 0.185, { flatT: 0.35, flatB: 0.15, e: 3.0 }],
    [10, 0, 0.24, 0.16, { flatT: 0.3, flatB: 0.1, e: 2.8 }], [11, 0, 0.12, 0.095], [12, 0, 0.085, 0.072],
    // A small head, deep at the back, with a flat shovel-tipped snout.
    [13, 0.01, 0.065, 0.058, { e: 2.6 }], [13, 0.09, 0.052, 0.045, { flatB: 0.2 }], [13, 0.16, 0.046, 0.03, { flatB: 0.35, e: 2.8 }], [14, 0, 0.044, 0.016, { flatB: 0.4, e: 3.2 }],
  ],
  jawPts: [V(0, 0.4, 0.85), V(0, 0.38, 0.95), V(0, 0.37, 1.03)],
  jaw: [[0, 0.055, 0.025, { flatT: 0.5 }], [0.6, 0.042, 0.018, { flatT: 0.5 }], [1, 0.04, 0.01, { flatT: 0.5 }]],
  teeth: { n: 8, from: 0.15, to: 0.6, r: 0.0035, len: 0.012 },
  eye: { at: [0.05, 0.445, 0.9, 0.012], out: [1, 0.2], color: '#7a5a20' },
  hind: { hip: [0.17, 0.47, 0.0], knee: [0.2, 0.27, 0.08], ankle: [0.19, 0.06, -0.04], ball: [0.2, 0.025, 0.05], girth: 0.095, toes: [0.07, 0.085, 0.09, 0.08, 0.05], spread: 0.25, splay: 0.12, claw: 0.025 },
  fore: { hip: [0.15, 0.4, 0.57], knee: [0.17, 0.24, 0.5], ankle: [0.17, 0.05, 0.56], ball: [0.17, 0.02, 0.6], girth: 0.08, toes: [0.05, 0.062, 0.066, 0.056, 0.035], spread: 0.28, splay: 0.15, claw: 0.018 },
  armour: {
    from: 1, to: 12, offFrom: 0, offTo: 0.02, step: 0.085, color: '#4a4033', tailShrink: 0.45, shrinkFrom: 0.55,
    // Paired paramedian plates either side of the spine, then lateral rows down the flanks with a small boss each.
    rows: [[0.2, 0.11, 0.082, 0.014, 0.008], [0.62, 0.09, 0.078, 0.014, 0.012], [1.05, 0.075, 0.07, 0.013, 0.02]],
  },
  palette: { back: C('#4a4033'), flank: C('#6a5c46'), belly: C('#b5a283'), blotch: 0.4 },
  skin: { scale: 55, scute: 0.5, scuteZ: [-1.2, 1.1] },
};

// Saurosuchus galilei (the valley's predator): a pseudosuchian with legs held under the body, a huge, deep, narrow
// skull full of serrated teeth, a paired row of osteoderms down the back, a long tail. Built at the sim's 3.5 m
// sub-adult (saurosuchus.ts). Colours are guesses. Coarser than a player model: it's rarely seen up close.
export const SAUROSUCHUS_SPEC = {
  detail: 1.3,
  J: {
    pelvis: V(0, 0.756, 0), spine1: V(0, 0.781, 0.2), spine2: V(0, 0.769, 0.4), chest: V(0, 0.708, 0.55),
    neck1: V(0, 0.732, 0.7), neck2: V(0, 0.781, 0.84), head: V(0, 0.805, 0.97), snout: V(0, 0.671, 1.55), jaw: V(0, 0.732, 1.0),
    tail: [V(0, 0.732, -0.25), V(0, 0.683, -0.55), V(0, 0.61, -0.85), V(0, 0.525, -1.15), V(0, 0.427, -1.45), V(0, 0.329, -1.72)], tailEnd: V(0, 0.244, -1.95),
  },
  body: [
    [0, 0, 0.01, 0.015], [1, 0, 0.035, 0.05], [2, 0, 0.055, 0.075], [3, 0, 0.08, 0.1], [4, 0, 0.1, 0.13], [5, 0, 0.13, 0.16], [6, 0, 0.16, 0.2],
    [7, 0, 0.19, 0.24, { flatB: 0.1 }], [8, 0, 0.21, 0.3, { flatB: 0.12 }], [9, 0, 0.22, 0.31, { flatB: 0.15 }], [10, 0, 0.19, 0.25, { flatB: 0.1 }],
    [11, 0, 0.12, 0.15], [12, 0, 0.1, 0.13],
    // The skull: deep and narrow, a long tall snout.
    [13, 0.02, 0.11, 0.15, { flatB: 0.2, e: 2.6 }], [13, 0.18, 0.095, 0.13, { flatB: 0.3, e: 2.7 }], [13, 0.36, 0.07, 0.1, { flatB: 0.35 }],
    [13, 0.5, 0.05, 0.075, { flatB: 0.35 }], [14, 0, 0.025, 0.035, { flatB: 0.3 }],
  ],
  jawPts: [V(0, 0.683, 1.0), V(0, 0.61, 1.25), V(0, 0.573, 1.52)],
  jaw: [[0, 0.1, 0.05, { flatT: 0.6, yo: -0.01 }], [0.5, 0.07, 0.04, { flatT: 0.6 }], [1, 0.025, 0.02, { flatT: 0.5 }]],
  teeth: { n: 14, from: 0.2, to: 0.95, r: 0.009, len: 0.045 },
  eye: { at: [0.075, 0.9, 1.12, 0.022], out: [1, 0.3], color: '#b08a2a' },
  hind: { hip: [0.15, 0.732, 0.0], knee: [0.19, 0.439, 0.12], ankle: [0.17, 0.122, -0.04], ball: [0.17, 0.0366, 0.07], girth: 0.12, toes: [0.09, 0.11, 0.12, 0.1, 0.05], spread: 0.22, splay: 0.1, claw: 0.035 },
  fore: { hip: [0.13, 0.634, 0.55], knee: [0.16, 0.39, 0.47], ankle: [0.15, 0.11, 0.55], ball: [0.15, 0.0366, 0.61], girth: 0.095, toes: [0.06, 0.075, 0.08, 0.07, 0.04], spread: 0.25, splay: 0.12, claw: 0.025 },
  armour: { from: 3, to: 12, offFrom: 0, offTo: 0, step: 0.07, rows: [[0.1, 0.06, 0.065, 0.012, 0]], color: '#3a2d22', tailShrink: 0.5, shrinkFrom: 0.6 },
  palette: { back: C('#3d3326'), flank: C('#6a5640'), belly: C('#b8a07a'), blotch: 0.7 },
  skin: { scale: 45, scute: 1, scuteZ: [-2, 1.0] },
};

// Hyperodapedon sanjuanensis: a rhynchosaur, the commonest big animal in the valley. 1.6 m, a barrel body on
// half-sprawled legs, a short neck, a skull wider at the back than it is long with a down-turned beak, big claws on
// the hind feet for digging. Many of them in view at once, so the coarsest of the models.
export const HYPERODAPEDON_SPEC = {
  detail: 1.8,
  J: {
    pelvis: V(0, 0.42, 0), spine1: V(0, 0.46, 0.12), spine2: V(0, 0.46, 0.24), chest: V(0, 0.42, 0.36),
    neck1: V(0, 0.43, 0.44), neck2: V(0, 0.44, 0.5), head: V(0, 0.44, 0.56), snout: V(0, 0.36, 0.78), jaw: V(0, 0.42, 0.58),
    tail: [V(0, 0.4, -0.13), V(0, 0.36, -0.28), V(0, 0.31, -0.43), V(0, 0.26, -0.57), V(0, 0.21, -0.69), V(0, 0.17, -0.79)], tailEnd: V(0, 0.14, -0.86),
  },
  body: [
    [0, 0, 0.01, 0.01], [1, 0, 0.025, 0.03], [2, 0, 0.04, 0.045], [3, 0, 0.06, 0.06], [4, 0, 0.08, 0.08], [5, 0, 0.11, 0.1], [6, 0, 0.14, 0.13],
    [7, 0, 0.19, 0.17, { flatB: 0.15, e: 2.4 }], [8, 0, 0.24, 0.2, { flatB: 0.2, e: 2.4 }], [9, 0, 0.25, 0.2, { flatB: 0.2, e: 2.4 }], [10, 0, 0.2, 0.17, { flatB: 0.15 }],
    [11, 0, 0.13, 0.11], [12, 0, 0.12, 0.1],
    // The skull: broad cheeks behind the eyes, narrowing fast to the beak.
    [13, 0, 0.15, 0.1, { flatB: 0.2, e: 2.6 }], [13, 0.07, 0.16, 0.095, { flatB: 0.25, e: 2.8 }], [13, 0.15, 0.1, 0.075, { flatB: 0.3 }],
    [14, -0.03, 0.035, 0.05], [14, 0, 0.025, 0.035],
  ],
  jawPts: [V(0, 0.4, 0.58), V(0, 0.35, 0.68), V(0, 0.32, 0.75)],
  jaw: [[0, 0.12, 0.04, { flatT: 0.6 }], [0.6, 0.07, 0.035, { flatT: 0.6 }], [1, 0.025, 0.02, { flatT: 0.5 }]],
  teeth: { n: 2, from: 0.9, to: 0.97, r: 0.008, len: 0.03 }, // the beak's two down-turned points
  eye: { at: [0.1, 0.5, 0.6, 0.016], out: [1, 0.2], color: '#5a3a14' },
  hind: { hip: [0.14, 0.4, 0.0], knee: [0.24, 0.27, 0.08], ankle: [0.22, 0.07, -0.03], ball: [0.23, 0.025, 0.05], girth: 0.07, toes: [0.05, 0.06, 0.065, 0.055, 0.035], spread: 0.28, splay: 0.2, claw: 0.03 },
  fore: { hip: [0.13, 0.37, 0.36], knee: [0.21, 0.25, 0.3], ankle: [0.2, 0.06, 0.37], ball: [0.2, 0.02, 0.42], girth: 0.06, toes: [0.04, 0.05, 0.055, 0.045, 0.03], spread: 0.3, splay: 0.25, claw: 0.016 },
  palette: { back: C('#5b4a36'), flank: C('#86704f'), belly: C('#c4b08a'), blotch: 0.5 },
  skin: { scale: 70, scute: 0.3, scuteZ: [-0.9, 0.5] },
};

export const QUAD_SPECS = { proterochampsa: PROTEROCHAMPSA_SPEC, aetosauroides: AETOSAUROIDES_SPEC };
// The valley's other animals, built the same way (render/sauroMesh.ts, render/herbivoreMesh.ts).
export const NPC_SPECS = { saurosuchus: SAUROSUCHUS_SPEC, hyperodapedon: HYPERODAPEDON_SPEC };
