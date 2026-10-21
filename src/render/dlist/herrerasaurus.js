// Herrerasaurus model ported verbatim from the Dlist demo (demos/skin-test): a lofted,
// skinned body with lips, mid-jaw joint, teeth, claws and dewclaws, a procedural skin
// shader (scales, scutes, stripes, antorbital fenestra) and shell fuzz. Wet and mud
// bands are wired but held at zero until those systems come over.
import * as THREE from 'three';
import { clamp, lerp, smooth } from '../../sim/math';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const M4 = () => new THREE.Matrix4();

// Wet and mud state is tracked in horizontal bands up the body (bind-pose height).
const BANDS = 24, BAND_H = 0.085;
const skinU = {
  uWet: { value: new Float32Array(BANDS) },
  uMudCover: { value: new Float32Array(BANDS) },
  uMudDry: { value: new Float32Array(BANDS) },
  uMudFlake: { value: new Float32Array(BANDS) },
  uBandH: { value: BAND_H },
  uGulp: { value: new THREE.Vector4(0, 0, 0, 0) },
  // Antorbital fenestra and nostril on each side of the snout (bind pose: centre z, y, half length, half height).
  uFen: { value: new THREE.Vector4(2.05, 1.622, 0.046, 0.02) },
  uNar: { value: new THREE.Vector4(2.3, 1.567, 0.02, 0.0105) },
  // Palette (set per species; colors are invented, the fossils don't record them).
  uBack: { value: new THREE.Vector3(0.075, 0.06, 0.042) }, uFlank: { value: new THREE.Vector3(0.25, 0.155, 0.08) },
  uBelly: { value: new THREE.Vector3(0.50, 0.42, 0.31) }, uStripe: { value: 1 },
  uFurA: { value: new THREE.Vector3(0.27, 0.17, 0.09) }, uFurB: { value: new THREE.Vector3(0.10, 0.075, 0.05) },
};

class SkinBuilder {
  constructor() { this.p = []; this.c = []; this.i = []; this.si = []; this.sw = []; }
  get n() { return this.p.length / 3; }
  vert(pos, skin, col) {
    const m = new Map();
    for (const [b, w] of skin) if (w > 1e-4) m.set(b, (m.get(b) || 0) + w);
    const s = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = s.reduce((a, q) => a + q[1], 0) || 1;
    this.p.push(pos.x, pos.y, pos.z);
    for (let k = 0; k < 4; k++) { this.si.push(s[k] ? s[k][0] : 0); this.sw.push(s[k] ? s[k][1] / tot : 0); }
    const cc = col || { r: 1, g: 1, b: 1 };
    this.c.push(cc.r, cc.g, cc.b);
    return this.n - 1;
  }
  prim(geo, matrix, bone, col) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
    const p = g.attributes.position; const start = this.n;
    for (let k = 0; k < p.count; k++) this.vert(V(p.getX(k), p.getY(k), p.getZ(k)), [[bone, 1]], col);
    for (let k = 0; k < p.count; k += 3) this.i.push(start + k, start + k + 1, start + k + 2);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
}

// Interpolated profile keyed by arc length (Catmull-Rom between keys).
function makeProfile(keys) {
  keys.sort((a, b) => a.s - b.s);
  const fields = ['w', 'h', 'yo', 'flatB', 'flatT', 'topN', 'e', 'lip', 'lipT'];
  const def = { e: 2.3 };
  return (s) => {
    let j = 0; while (j < keys.length - 2 && s > keys[j + 1].s) j++;
    const k0 = keys[Math.max(0, j - 1)], k1 = keys[j], k2 = keys[j + 1], k3 = keys[Math.min(keys.length - 1, j + 2)];
    const t = clamp((s - k1.s) / ((k2.s - k1.s) || 1), 0, 1);
    const out = {};
    for (const f of fields) {
      const d0 = def[f] ?? 0, p0 = k0[f] ?? d0, p1 = k1[f] ?? d0, p2 = k2[f] ?? d0, p3 = k3[f] ?? d0;
      const t2 = t * t, t3 = t2 * t;
      const v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      out[f] = (f === 'w' || f === 'h') ? Math.max(v, 0.004) : v;
    }
    return out;
  };
}
function arcLengths(pts) { const L = [0]; for (let k = 1; k < pts.length; k++) L.push(L[k - 1] + pts[k].distanceTo(pts[k - 1])); return L; }

// Sweep a superellipse cross-section along a joint chain, skinned to the chain's bones.
function loft(sb, pts, segBones, prof, opt = {}) {
  const N = opt.ring || 20, step = opt.step || 0.035, side = opt.side || V(1, 0, 0), e = opt.e || 2.3;
  const L = arcLengths(pts); const total = L[L.length - 1];
  const rings = Math.max(2, Math.ceil(total / step) + 1);
  const dirs = []; for (let k = 0; k < pts.length - 1; k++) dirs.push(pts[k + 1].clone().sub(pts[k]).normalize());
  const starts = []; const centers = []; const tans = []; const ringSkins = [];
  for (let r = 0; r < rings; r++) {
    const s = total * r / (rings - 1);
    let j = 0; while (j < pts.length - 2 && s > L[j + 1]) j++;
    const t = clamp((s - L[j]) / ((L[j + 1] - L[j]) || 1), 0, 1);
    const c = pts[j].clone().lerp(pts[j + 1], t);
    const tan = dirs[j].clone();
    if (t < 0.5 && j > 0) tan.lerp(dirs[j - 1], 0.5 * (1 - smooth(0, 0.5, t))).normalize();
    if (t > 0.5 && j < dirs.length - 1) tan.lerp(dirs[j + 1], 0.5 * smooth(0.5, 1, t)).normalize();
    const right = side.clone().addScaledVector(tan, -side.dot(tan)).normalize();
    const up = V().crossVectors(tan, right);
    const P = prof(s, total);
    const own = segBones[j];
    const prev = j > 0 ? segBones[j - 1] : (opt.startBone ?? own);
    const next = j < segBones.length - 1 ? segBones[j + 1] : (opt.endBone ?? own);
    const b = 0.32;
    const wp = t < b ? 0.5 * (1 - smooth(0, 1, t / b)) : 0;
    const wn = t > 1 - b ? 0.5 * smooth(0, 1, (t - (1 - b)) / b) : 0;
    const skin = [[own, 1 - wp - wn], [prev, wp], [next, wn]];
    starts.push(sb.n); centers.push(c.clone().addScaledVector(up, P.yo)); tans.push(tan); ringSkins.push(skin);
    const ee = opt.e || P.e;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2; const ca = Math.cos(a), sa = Math.sin(a);
      let x = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / ee) * P.w;
      let y = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / ee) * P.h;
      let vs = skin;
      // Lips: the side walls hang below the palate (upper) or rise above the jaw top (lower) as a skirt.
      const m = smooth(0.5, 0.92, Math.abs(ca));
      if (sa > 1e-6) { x *= 1 - P.topN * sa; y *= 1 - P.flatT; if (P.lipT > 0.002) y = lerp(y, P.h * (1 - P.flatT) + P.lipT, m); }
      else {
        y *= 1 - P.flatB;
        if (P.lip > 0.002) { y = lerp(y, -P.h * (1 - P.flatB) - P.lip, m); if (opt.lipBone != null) { const wl = 0.9 * m * smooth(0.002, 0.02, P.lip); vs = [...skin.map(([b, w]) => [b, w * (1 - wl)]), [opt.lipBone, wl]]; } }
      }
      sb.vert(c.clone().addScaledVector(right, x).addScaledVector(up, y + P.yo), vs, opt.col);
    }
  }
  for (let r = 0; r < rings - 1; r++) for (let k = 0; k < N; k++) {
    const a = starts[r] + k, b2 = starts[r] + (k + 1) % N, c = starts[r + 1] + k, d = starts[r + 1] + (k + 1) % N;
    sb.i.push(a, b2, c, b2, d, c);
  }
  const P0 = prof(0, total), P1 = prof(total, total);
  const c0 = sb.vert(centers[0].clone().addScaledVector(tans[0], -Math.min(P0.w, P0.h) * 0.7), ringSkins[0], opt.col);
  for (let k = 0; k < N; k++) sb.i.push(c0, starts[0] + (k + 1) % N, starts[0] + k);
  const last = rings - 1;
  const c1 = sb.vert(centers[last].clone().addScaledVector(tans[last], Math.min(P1.w, P1.h) * (opt.tipCap ?? 0.7)), ringSkins[last], opt.col);
  for (let k = 0; k < N; k++) sb.i.push(c1, starts[last] + k, starts[last] + (k + 1) % N);
}

const skinGLSL = /* glsl */`
  varying vec3 vBindPos; varying vec3 vBindN;
  uniform float uWet[${BANDS}]; uniform float uMudCover[${BANDS}]; uniform float uMudDry[${BANDS}]; uniform float uMudFlake[${BANDS}];
  uniform float uBandH; uniform vec4 uFen; uniform vec4 uNar; varying float vFz;
  uniform vec3 uBack; uniform vec3 uFlank; uniform vec3 uBelly; uniform float uStripe; uniform vec3 uFurA; uniform vec3 uFurB;
  float ovalD(vec3 p, vec4 e){ float k = clamp((e.x + e.z - p.z) / (2.0 * e.z), 0.0, 1.0); vec2 q = vec2((p.z - e.x) / e.z, (p.y - e.y) / (e.w * (0.45 + 0.55 * k))); return dot(q, q); }
  ${['uWet', 'uMudCover', 'uMudDry', 'uMudFlake'].map((n) => `
  float b_${n}(float y){ float f = clamp(y / uBandH, 0.0, ${BANDS - 1}.0); int i = int(floor(f)); int j = min(i + 1, ${BANDS - 1}); return mix(${n}[i], ${n}[j], f - float(i)); }`).join('')}
  float skH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float skNoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(skH(i), skH(i + vec3(1,0,0)), f.x), mix(skH(i + vec3(0,1,0)), skH(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(skH(i + vec3(0,0,1)), skH(i + vec3(1,0,1)), f.x), mix(skH(i + vec3(0,1,1)), skH(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float skFbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * skNoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / 0.9375; }
  vec3 skHash3(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453123); }
  vec3 skVor(vec3 x){ vec3 p = floor(x); vec3 f = fract(x); float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec3 b = vec3(float(i), float(j), float(k)); vec3 h = skHash3(p + b); vec3 r = b + h - f; float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h.x; } else if (d < d2) { d2 = d; } }
    return vec3(sqrt(d1), sqrt(d2), id); }
  vec3 skPerturb(vec3 surf_pos, vec3 surf_norm, float h){
    vec3 sx = dFdx(surf_pos); vec3 sy = dFdy(surf_pos);
    vec3 r1 = cross(sy, surf_norm); vec3 r2 = cross(surf_norm, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    float gl = length(grad), lim = abs(det) * 0.45;
    if (gl > lim) grad *= lim / gl;
    vec3 n2 = abs(det) * surf_norm - grad;
    return dot(n2, n2) > 1e-20 ? normalize(n2) : surf_norm; }
`;
const skinColorGLSL = /* glsl */`
  vec3 P = vBindPos; vec3 BN = normalize(vBindN);
  float viewD = length(vViewPosition);
  float fw = length(fwidth(P));
  float detail = (1.0 - smoothstep(6.0, 24.0, viewD)) * (1.0 - smoothstep(0.006, 0.014, fw));
  float plateAA = 1.0 - smoothstep(0.03, 0.07, fw);
  float dors = smoothstep(-0.15, 0.75, BN.y);
  float vent = smoothstep(0.05, -0.65, BN.y);
  float limbLow = 1.0 - smoothstep(0.32, 0.68, P.y);
  float onBody = smoothstep(0.6, 0.85, P.y);
  vec3 cBack = uBack;
  vec3 cFlank = uFlank;
  vec3 cBelly = uBelly;
  vec3 skin = mix(cFlank, cBack, dors);
  skin = mix(skin, cBelly, vent * onBody);
  // Dark transverse bands across back and tail (invented pattern; colors are unknown from fossils).
  float bodyZone = onBody * (1.0 - smoothstep(1.2, 1.5, P.z));
  float bc = P.z * 2.5 + skFbm(P * 3.0) * 0.9;
  float stripe = smoothstep(0.34, 0.12, abs(fract(bc) - 0.5));
  skin *= mix(1.0, max(0.0, 1.0 - 0.58 * uStripe), stripe * bodyZone * (1.0 - vent));
  float headZ = smoothstep(1.62, 1.95, P.z) * smoothstep(1.25, 1.45, P.y);
  skin = mix(skin, skin * vec3(1.3, 0.85, 0.7), headZ * (1.0 - vent * 0.6));
  skin = mix(skin, vec3(0.105, 0.09, 0.075), limbLow * 0.8);
  skin *= 0.8 + 0.4 * skFbm(P * 11.0);
  // Pebbly scales everywhere, with a row of larger scales down the spine.
  vec3 vo = skVor(P * 64.0);
  float scaleH = smoothstep(0.0, 0.42, vo.y - vo.x);
  skin *= mix(1.0, mix(0.6, 1.05, scaleH) * (0.9 + 0.18 * vo.z), 0.35 + 0.65 * detail);
  float mid = (1.0 - smoothstep(0.025, 0.065, abs(P.x))) * smoothstep(0.55, 0.9, BN.y) * (1.0 - step(1.4, P.z));
  vec3 vo2 = skVor(P * vec3(28.0, 28.0, 15.0));
  float scuteH = smoothstep(0.0, 0.3, vo2.y - vo2.x);
  float hSkin = mix(scaleH, 1.25 * scuteH, mid * plateAA);
  skin = mix(skin, skin * mix(0.62, 1.0, scuteH), mid * plateAA);
  float sideF = smoothstep(0.25, 0.6, abs(BN.x)) * step(1.9, P.z);
  float fd = ovalD(P, uFen), nd = ovalD(P, uNar);
  float fen = (1.0 - smoothstep(0.65, 1.0, fd)) * sideF, nar = (1.0 - smoothstep(0.55, 1.0, nd)) * sideF;
  float rim = smoothstep(0.8, 1.0, fd) * (1.0 - smoothstep(1.0, 1.7, fd)) * sideF;
  skin *= (1.0 - 0.55 * fen * (0.6 + 0.4 * smoothstep(1.0, 0.2, fd))) * (1.0 - 0.85 * nar) * (1.0 + 0.3 * rim);
  hSkin *= 1.0 - max(fen, nar);
  // Under the fuzz the skin takes the dark root colour, so gaps between filaments don't show scales.
  float fzM = smoothstep(0.05, 0.4, vFz);
  skin = mix(skin, vec3(0.07, 0.05, 0.034) * (0.8 + 0.4 * skFbm(P * 9.0)), fzM);
  hSkin *= 1.0 - fzM;
  // Wetness and mud, looked up by height up the body with a ragged edge.
  float yj = P.y + (skNoise(P * 7.0) - 0.5) * 0.07;
  float wet = b_uWet(yj);
  float wetV = smoothstep(0.0, 0.22, wet - skNoise(P * 4.0 + 3.1) * 0.78);
  float cover = b_uMudCover(yj);
  float mDry = b_uMudDry(yj);
  float mFl = b_uMudFlake(yj);
  vec3 pl = skVor(P * 17.0 + 7.3);
  float alive = step(mFl * 1.001, pl.z * 0.98 + 0.01);
  float mudM = smoothstep(0.3, 0.7, cover) * alive;
  float dryV = smoothstep(0.0, 0.25, mDry - skNoise(P * 3.3 + 11.0) * 0.75);
  vec3 mudWetC = vec3(0.055, 0.036, 0.022) * (0.85 + 0.3 * skNoise(P * 18.0));
  vec3 mudDryC = vec3(0.13, 0.094, 0.06) * (0.82 + 0.3 * pl.z) * (0.78 + 0.44 * skFbm(P * 30.0));
  float crack = (1.0 - smoothstep(0.008, 0.035, pl.y - pl.x)) * plateAA;
  mudDryC *= mix(1.0, 0.3, crack);
  vec3 mudC = mix(mudWetC, mudDryC, dryV);
  float plate = smoothstep(0.0, 0.09, pl.y - pl.x);
  float hMud = mix(1.25 + skFbm(P * 22.0) * 0.9, 1.0 + plate * 1.3, dryV);
  vec3 skinW = mix(skin, pow(skin, vec3(1.12)) * 0.42, wetV);
  float gH = mix(hSkin * mix(1.0, 0.55, wetV), hMud, mudM);
  float gRough = mix(mix(0.72, 0.3, wetV), mix(0.3, 0.97, dryV), mudM);
  float gCoat = mix(wetV * 0.9, (1.0 - dryV) * 0.45, mudM);
  float gCoatR = mix(0.06, 0.2, mudM);
  diffuseColor.rgb = mix(skinW, mudC, mudM);
`;

const skinMat = new THREE.MeshPhysicalMaterial({ roughness: 0.72, metalness: 0, envMapIntensity: 0.9, clearcoat: 1, clearcoatRoughness: 0.08, specularIntensity: 0.7 });
skinMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, skinU);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBindPos; varying vec3 vBindN; attribute float aFz; varying float vFz; uniform vec4 uGulp; attribute vec3 aBind; attribute vec3 aBindN;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      // aBind/aBindN: the original Herrerasaurus surface, so the pattern stays put when a species reshapes the body.
      vBindPos = aBind; vBindN = aBindN; vFz = aFz;
      { vec3 dg = aBind - uGulp.xyz; transformed += normal * uGulp.w * exp(-dot(dg, dg) / 0.006) * smoothstep(0.1, -0.5, normal.y); }`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + skinGLSL)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + skinColorGLSL)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nfloat ndv = abs(dot(normal, normalize(vViewPosition)));\nnormal = skPerturb(-vViewPosition, normal, gH * 0.003 * detail * smoothstep(0.12, 0.45, ndv));')
    .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.clearcoat = gCoat; material.clearcoatRoughness = max(gCoatR, 0.0525);');
};
skinMat.customProgramCacheKey = () => 'herrera-skin-v3';

// A curved, laterally flattened claw swept along an arc that curls toward `down`.
function curvedClaw(sb, base, dir, down, len, curl, w, bone, col) {
  const dn = down.clone().addScaledVector(dir, -down.dot(dir)).normalize(), R0 = len / curl, pts = [];
  for (let i = 0; i <= 6; i++) { const a = curl * i / 6; pts.push(base.clone().addScaledVector(dir, R0 * Math.sin(a)).addScaledVector(dn, R0 * (1 - Math.cos(a)))); }
  const L = arcLengths(pts);
  loft(sb, pts, Array(6).fill(bone), makeProfile([{ s: 0, w: w * 0.5, h: w }, { s: L[6] * 0.5, w: w * 0.36, h: w * 0.66 }, { s: L[6], w: 0.0012, h: 0.0015 }]),
    { ring: 8, step: len / 8, side: V().crossVectors(dir, dn).normalize(), col, e: 2, tipCap: 0.2 });
}
// Shell fuzz: copies of the fuzzy body triangles, each layer pushed out along the normal in the shader.
const FUR = { layers: 10, len: 0.06 };
function buildFur(src, iEnd, fz) {
  const idx = src.index.array, sel = [];
  for (let t = 0; t < iEnd; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (fz[a] + fz[b] + fz[c] > 0.06) sel.push(a, b, c); }
  const verts = [...new Set(sel)], map = new Map(verts.map((v, i) => [v, i])), nv = verts.length, NL = FUR.layers;
  const P = src.attributes.position.array, N = src.attributes.normal.array, SI = src.attributes.skinIndex.array, SW = src.attributes.skinWeight.array;
  const pos = new Float32Array(nv * NL * 3), nor = new Float32Array(nv * NL * 3), si = new Uint16Array(nv * NL * 4), sw = new Float32Array(nv * NL * 4), afz = new Float32Array(nv * NL), ah = new Float32Array(nv * NL), index = [];
  for (let l = 0; l < NL; l++) {
    verts.forEach((v, i) => {
      const o = l * nv + i;
      for (let k = 0; k < 3; k++) { pos[o * 3 + k] = P[v * 3 + k]; nor[o * 3 + k] = N[v * 3 + k]; }
      for (let k = 0; k < 4; k++) { si[o * 4 + k] = SI[v * 4 + k]; sw[o * 4 + k] = SW[v * 4 + k]; }
      afz[o] = fz[v]; ah[o] = (l + 1) / NL;
    });
    for (const v of sel) index.push(l * nv + map.get(v));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('aFz', new THREE.BufferAttribute(afz, 1)); g.setAttribute('aH', new THREE.BufferAttribute(ah, 1));
  g.setIndex(index);
  return g;
}
const furMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, envMapIntensity: 0.55, alphaToCoverage: true });
furMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, skinU); sh.uniforms.uFurLen = { value: FUR.len };
  const band = (n) => `float v_${n}(float y){ float f = clamp(y / uBandH, 0.0, ${BANDS - 1}.0); int i = int(floor(f)); int j = min(i + 1, ${BANDS - 1}); return mix(${n}[i], ${n}[j], f - float(i)); }`;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
    attribute float aFz; attribute float aH; attribute vec3 aBind; attribute vec3 aBindN; varying vec3 vBindPos; varying vec3 vBindN; varying float vFz; varying float vH;
    uniform float uWet[${BANDS}]; uniform float uMudCover[${BANDS}]; uniform float uMudFlake[${BANDS}]; uniform float uBandH; uniform float uFurLen;
    ${band('uWet')} ${band('uMudCover')} ${band('uMudFlake')}`)
    .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
      vBindPos = aBind; vBindN = aBindN; vFz = aFz; vH = aH;
      // Wet fuzz lies flatter and shorter; mud mats it down harder.
      float fw = v_uWet(aBind.y), fm = smoothstep(0.3, 0.7, v_uMudCover(aBind.y)) * (1.0 - v_uMudFlake(aBind.y));
      float fl = uFurLen * smoothstep(0.0, 0.5, aFz) * mix(1.0, 0.55, fw) * mix(1.0, 0.35, fm);
      transformed += normal * fl * aH + vec3(0.0, -0.35, -1.0) * fl * aH * aH * mix(0.7, 1.4, max(fw, fm));`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + skinGLSL + '\nvarying float vH;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 P = vBindPos; float h = vH;
      float wet = b_uWet(P.y), cover = b_uMudCover(P.y), mDry = b_uMudDry(P.y), mFl = b_uMudFlake(P.y);
      float mud = smoothstep(0.3, 0.7, cover) * step(mFl * 1.001, skH(floor(P * 17.0) + 0.5) * 0.98 + 0.01);
      // Clumping: wet or muddy filament tips are pulled toward clump centres, so they gather into points.
      float clump = min(0.9, max(wet * 0.8, mud * 0.9)) * h;
      vec3 ci = floor(P / 0.032); vec3 cc = (ci + 0.5 + (skHash3(ci) - 0.5) * 0.6) * 0.032;
      vec3 g = (cc + (P - cc) / (1.0 - clump)) / 0.0105, gi = floor(g), rn = skHash3(gi);
      vec3 f = fract(g) - 0.5 - (rn - 0.5) * 0.45;
      float sl = mix(0.5, 1.0, rn.z), rad = 0.5 * (1.0 - h / sl);
      float d = length(f), aa = max(fwidth(d), 0.02);
      float strand = h < sl ? 1.0 - smoothstep(rad - aa, rad + aa, d) : 0.0;
      strand = mix(strand, 0.5 * max(0.0, 1.0 - h / 0.8), smoothstep(0.9, 2.2, max(max(fwidth(g.x), fwidth(g.y)), fwidth(g.z)))) * smoothstep(0.02, 0.25, vFz);
      if (strand < 0.04) discard;
      diffuseColor.a = strand;
      float bc = P.z * 2.5 + skFbm(P * 3.0) * 0.9;
      float stripe = smoothstep(0.34, 0.12, abs(fract(bc) - 0.5)) * (1.0 - smoothstep(1.2, 1.5, P.z));
      vec3 fc = mix(uFurA, uFurB, smoothstep(-0.1, 0.8, vBindN.y));
      fc *= mix(1.0, max(0.0, 1.0 - 0.5 * uStripe), stripe) * (0.7 + 0.6 * rn.x) * mix(0.4, 1.25, h / sl);
      float wetV = smoothstep(0.0, 0.25, wet);
      fc = mix(fc, pow(fc, vec3(1.15)) * 0.42, wetV);
      float dryV = smoothstep(0.0, 0.25, mDry - skNoise(P * 3.3 + 11.0) * 0.75);
      vec3 mudC = mix(vec3(0.05, 0.034, 0.021), vec3(0.13, 0.094, 0.06) * (0.8 + 0.4 * skNoise(P * 30.0)), dryV);
      fc = mix(fc, mudC, mud);
      float fRough = mix(mix(0.86, 0.38, wetV), mix(0.32, 0.97, dryV), mud);
      diffuseColor.rgb = fc;`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;');
};
furMat.customProgramCacheKey = () => 'herrera-fur-v1';

// Reshape the built Herrerasaurus into another species' proportions (Upstarts addition). Bones are scaled
// (neck, head, tail, legs, arms), the mesh is deformed through its own skin weights, and the result is
// baked as the new rest pose with unit bone scales, so animation rotations never shear a scaled parent.
// shape: { neck, neckGirth, head, tail, tailGirth, legs, arms } (1 = Herrerasaurus).
function reshape({ rig, bones, B, skeleton, meshes, legs, shape }) {
  const n = shape.neck ?? 1, ng = shape.neckGirth ?? 1, h = shape.head ?? 1, t = shape.tail ?? 1, tg = shape.tailGirth ?? 1;
  const l = shape.legs ?? 1, a = shape.arms ?? 1;
  const toeTip = legs.map((L) => L.toeTip.clone().sub(L.ball)); // feet keep their size
  const plain = n === 1 && ng === 1 && h === 1 && t === 1 && tg === 1 && l === 1 && a === 1;
  if (!plain) {
    B.neck1.scale.set(ng, n, n);
    B.head.scale.set(h / ng, h / n, h / n);
    B.tail0.scale.set(tg, tg, t);
    for (const S of ['L', 'R']) {
      B['thigh' + S].scale.set(1, l, l);
      B['toe' + S].scale.set(1, 1 / l, 1 / l);
      B['upper' + S].scale.set(a, a, a);
    }
    B.pelvis.position.y += (l - 1) * 1.105; // longer legs lift the body, feet stay on the ground
    rig.updateMatrixWorld(true);
    skeleton.update();
    const v = V();
    for (const m of meshes) {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        m.applyBoneTransform(i, v);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      pos.needsUpdate = true;
      m.geometry.computeVertexNormals();
    }
    // Bake: bones at their new positions with unit scale, then bind again.
    const abs = bones.map((b) => b.getWorldPosition(V()));
    for (const b of bones) b.scale.set(1, 1, 1);
    bones.forEach((b, i) => {
      const pi = bones.indexOf(b.parent);
      b.position.copy(abs[i]).sub(pi >= 0 ? abs[pi] : V());
      b.userData.abs = abs[i].clone();
    });
    rig.updateMatrixWorld(true);
    for (const m of meshes) m.bind(skeleton);
  }
  const at = (b) => b.userData.abs.clone();
  const out = legs.map((L, i) => {
    const S = L.S;
    const hip = at(B['thigh' + S]), knee = at(B['shin' + S]), ankle = at(B['meta' + S]), ball = at(B['toe' + S]);
    return { ...L, hip, knee, ankle, ball, toeTip: ball.clone().add(toeTip[i]) };
  });
  const L0 = out[0];
  return { legs: out, pelvisY: at(B.pelvis).y, hip: L0.hip.y, leg: L0.knee.distanceTo(L0.hip) + L0.ankle.distanceTo(L0.knee) + L0.ball.distanceTo(L0.ankle) };
}

function buildHerrerasaurus(shape = {}) {
  const J = {
    pelvis: V(0, 1.18, 0), spine1: V(0, 1.2, 0.38), spine2: V(0, 1.19, 0.74), chest: V(0, 1.15, 1.05),
    neck1: V(0, 1.2, 1.3), neck2: V(0, 1.36, 1.5), neck3: V(0, 1.52, 1.66), head: V(0, 1.62, 1.8), snout: V(0, 1.53, 2.36),
    jaw: V(0, 1.555, 1.84), jaw2: V(0, 1.515, 2.06), jawTip: V(0, 1.47, 2.31),
    tail: [V(0, 1.17, -0.3), V(0, 1.14, -0.7), V(0, 1.1, -1.1), V(0, 1.05, -1.5), V(0, 1.0, -1.88), V(0, 0.95, -2.24), V(0, 0.9, -2.56)],
    tailEnd: V(0, 0.86, -2.86),
  };
  const bones = []; const B = {};
  const mk = (name, parent, abs) => {
    const b = new THREE.Bone(); b.name = name; b.userData.abs = abs.clone();
    if (parent) { b.position.copy(abs).sub(parent.userData.abs); parent.add(b); } else b.position.copy(abs);
    b.userData.index = bones.length; bones.push(b); B[name] = b; return b;
  };
  const I = (name) => B[name].userData.index;
  mk('pelvis', null, J.pelvis);
  mk('spine1', B.pelvis, J.spine1); mk('spine2', B.spine1, J.spine2); mk('chest', B.spine2, J.chest);
  mk('neck1', B.chest, J.neck1); mk('neck2', B.neck1, J.neck2); mk('neck3', B.neck2, J.neck3); mk('head', B.neck3, J.head); mk('jaw', B.head, J.jaw);
  mk('jaw2', B.jaw, J.jaw2); mk('lipU', B.head, V(0, 1.55, 2.08)); // mid-jaw flex joint; upper lip pulls back as the mouth opens
  let tp = B.pelvis; J.tail.forEach((a, k) => { tp = mk('tail' + k, tp, a); });
  const legs = [], arms = [];
  for (const sx of [1, -1]) {
    const S = sx > 0 ? 'L' : 'R';
    const hip = V(sx * 0.17, 1.14, 0.02), knee = V(sx * 0.22, 0.66, 0.22), ankle = V(sx * 0.2, 0.2, -0.06), ball = V(sx * 0.19, 0.035, 0.1), toeTip = V(sx * 0.19, 0.02, 0.34);
    mk('thigh' + S, B.pelvis, hip); mk('shin' + S, B['thigh' + S], knee); mk('meta' + S, B['shin' + S], ankle); mk('toe' + S, B['meta' + S], ball);
    legs.push({ sx, S, hip, knee, ankle, ball, toeTip });
    const shoulder = V(sx * 0.13, 1.0, 1.08), elbow = V(sx * 0.17, 0.8, 1.16), wrist = V(sx * 0.155, 0.64, 1.3);
    mk('upper' + S, B.chest, shoulder); mk('fore' + S, B['upper' + S], elbow); mk('hand' + S, B['fore' + S], wrist);
    arms.push({ sx, S, shoulder, elbow, wrist });
  }

  const body = new SkinBuilder(); const horn = new SkinBuilder(); const eyes = new SkinBuilder();
  // Body and tail: one continuous sweep from tail tip to snout.
  const bodyPts = [J.tailEnd, ...J.tail.slice().reverse(), J.pelvis, J.spine1, J.spine2, J.chest, J.neck1, J.neck2, J.neck3, J.head, J.snout];
  const bodySeg = [...[6, 5, 4, 3, 2, 1, 0].map((k) => I('tail' + k)), I('pelvis'), I('pelvis'), I('spine1'), I('spine2'), I('chest'), I('neck1'), I('neck2'), I('neck3'), I('head')];
  const BL = arcLengths(bodyPts);
  const at = (ji, off = 0) => BL[ji] + off;
  const bodyProf = makeProfile([
    { s: at(0), w: 0.016, h: 0.02 },
    { s: at(1), w: 0.045, h: 0.056 }, { s: at(2), w: 0.066, h: 0.082 }, { s: at(3), w: 0.086, h: 0.112 },
    { s: at(4), w: 0.106, h: 0.142 }, { s: at(5), w: 0.13, h: 0.182 }, { s: at(6), w: 0.156, h: 0.222, yo: -0.01 },
    { s: at(7), w: 0.186, h: 0.266, yo: -0.02 }, { s: at(8), w: 0.226, h: 0.3, yo: -0.03, topN: 0.12 },
    { s: at(9), w: 0.256, h: 0.336, yo: -0.07, topN: 0.16 }, { s: at(10), w: 0.266, h: 0.346, yo: -0.1, topN: 0.18 },
    { s: at(11), w: 0.236, h: 0.31, yo: -0.1, topN: 0.16 }, { s: at(12), w: 0.14, h: 0.172, yo: -0.04, topN: 0.08 },
    { s: at(13), w: 0.104, h: 0.128 }, { s: at(14), w: 0.09, h: 0.108 },
    // Skull: deep and boxy behind the eyes where the jaw muscles sat, lipped along the tooth row.
    { s: at(15, -0.02), w: 0.1, h: 0.13, e: 2.7 },
    { s: at(15, 0.08), w: 0.112, h: 0.162, yo: 0.026, flatB: 0.3, topN: 0.06, e: 3.4, lip: 0.03 },
    { s: at(15, 0.22), w: 0.09, h: 0.13, yo: 0.016, flatB: 0.4, topN: 0.08, e: 3.0, lip: 0.042 },
    { s: at(15, 0.4), w: 0.063, h: 0.092, yo: 0.004, flatB: 0.42, topN: 0.08, e: 2.6, lip: 0.038 },
    { s: at(16), w: 0.026, h: 0.036, flatB: 0.3, lip: 0.022 },
  ]);
  loft(body, bodyPts, bodySeg, bodyProf, { ring: 24, step: 0.032, lipBone: I('lipU') });
  const bodyVEnd = body.n, bodyIEnd = body.i.length;
  // Shallow dents for the antorbital fenestra and the nostril; the skin shader darkens the same ovals.
  for (let v = 0; v < bodyVEnd; v++) {
    const x = body.p[v * 3], y = body.p[v * 3 + 1], z = body.p[v * 3 + 2];
    if (z < 1.9 || Math.abs(x) < 0.02) continue;
    for (const [e, dep] of [[skinU.uFen.value, 0.014], [skinU.uNar.value, 0.007]]) {
      const k = clamp((e.x + e.z - z) / (2 * e.z), 0, 1), d = ((z - e.x) / e.z) ** 2 + ((y - e.y) / (e.w * (0.45 + 0.55 * k))) ** 2;
      if (d < 1.4) body.p[v * 3] -= Math.sign(x) * dep * (1 - smooth(0.4, 1.4, d));
    }
  }

  // Lower jaw.
  const jawPts = [V(0, 1.56, 1.82), V(0, 1.515, 2.06), J.jawTip];
  const jL = arcLengths(jawPts);
  const jawProf = makeProfile([
    { s: 0, w: 0.078, h: 0.07, yo: -0.036, flatT: 0.5 }, { s: jL[1] * 0.4, w: 0.07, h: 0.058, yo: -0.03, flatT: 0.5, lipT: 0.008 },
    { s: jL[1], w: 0.06, h: 0.045, yo: -0.025, flatT: 0.55, lipT: 0.008 }, { s: jL[2], w: 0.02, h: 0.02, yo: -0.012, flatT: 0.5, lipT: 0.004 },
  ]);
  loft(body, jawPts, [I('jaw'), I('jaw2')], jawProf, { ring: 16, step: 0.03 });

  // Teeth: recurved blades along both jaws.
  const ivory = new THREE.Color('#d6cbb0'), claw = new THREE.Color('#211a15');
  const headDir = J.snout.clone().sub(J.head); const headLen = headDir.length(); headDir.normalize();
  const tooth = new THREE.ConeGeometry(0.0075, 0.034, 5);
  for (let z = 1.98; z <= 2.27; z += 0.026) {
    const t = (z - J.head.z) / (J.snout.z - J.head.z);
    const P = bodyProf(BL[15] + t * headLen);
    const c = J.head.clone().addScaledVector(headDir, t * headLen);
    const yb = c.y + P.yo - P.h * (1 - P.flatB);
    for (const sx of [1, -1]) {
      horn.prim(tooth, M4().makeRotationX(Math.PI).setPosition(sx * P.w * 0.8, yb - 0.012, c.z), I('head'), ivory);
    }
  }
  for (let k = 0; k < 11; k++) {
    const t = 0.18 + k * 0.066, sj = t * jL[2];
    const p = sj < jL[1] ? jawPts[0].clone().lerp(jawPts[1], sj / jL[1]) : jawPts[1].clone().lerp(J.jawTip, (sj - jL[1]) / (jL[2] - jL[1]));
    const w = jawProf(sj).w;
    for (const sx of [1, -1]) horn.prim(tooth, M4().makeScale(0.8, 0.8, 0.8).setPosition(sx * w * 0.72, p.y + 0.004, p.z), p.z > J.jaw2.z ? I('jaw2') : I('jaw'), ivory);
  }
  // Eyes.
  const eyeC = new THREE.Color('#a86d1a'), pupilC = new THREE.Color('#0b0806');
  for (const sx of [1, -1]) {
    eyes.prim(new THREE.SphereGeometry(0.026, 14, 10), M4().makeTranslation(sx * 0.074, 1.64, 1.925), I('head'), eyeC);
    eyes.prim(new THREE.SphereGeometry(0.012, 10, 8), M4().makeScale(0.6, 1.2, 0.9).setPosition(sx * 0.097, 1.64, 1.93), I('head'), pupilC);
  }

  // Legs, feet and arms.
  for (const L of legs) {
    const S = L.S;
    const pts = [V(L.sx * 0.14, 1.3, 0.04), L.hip, L.knee, L.ankle, L.ball];
    const ll = arcLengths(pts);
    const prof = makeProfile([
      { s: 0, w: 0.13, h: 0.18 }, { s: ll[1], w: 0.165, h: 0.235 }, { s: lerp(ll[1], ll[2], 0.4), w: 0.135, h: 0.18 },
      { s: ll[2], w: 0.074, h: 0.084 }, { s: lerp(ll[2], ll[3], 0.35), w: 0.062, h: 0.07, yo: -0.02 },
      { s: ll[3], w: 0.04, h: 0.046 }, { s: ll[4], w: 0.034, h: 0.038 },
    ]);
    loft(body, pts, [I('thigh' + S), I('thigh' + S), I('shin' + S), I('meta' + S)], prof, { ring: 16, step: 0.03, startBone: I('pelvis'), endBone: I('toe' + S) });
    const toeDir = L.toeTip.clone().sub(L.ball).normalize();
    for (const [ang, len] of [[0.36 * L.sx, 0.19], [0, 0.24], [-0.36 * L.sx, 0.17]]) {
      const d = toeDir.clone().applyAxisAngle(UP, ang);
      const a = L.ball.clone().addScaledVector(d, 0.02); a.y = 0.03;
      const b = a.clone().addScaledVector(d, len); b.y = 0.018;
      const tl = a.distanceTo(b);
      loft(body, [a, b], [I('toe' + S)], makeProfile([{ s: 0, w: 0.028, h: 0.022 }, { s: tl, w: 0.012, h: 0.01 }]), { ring: 10, step: 0.03, side: V(0, 1, 0) });
      curvedClaw(horn, b.clone().addScaledVector(d, -0.004).add(V(0, 0.004, 0)), d.clone().add(V(0, -0.12, 0)).normalize(), V(0, -1, 0), 0.048, 0.7, 0.013, I('toe' + S), claw);
    }
    // Digit I (dewclaw): short, set high on the inner side of the metatarsus, clear of the ground.
    const dcB = L.ball.clone().lerp(L.ankle, 0.3).add(V(-L.sx * 0.03, 0, 0)), dcD = V(-L.sx * 0.35, -0.5, -0.8).normalize(), dcE = dcB.clone().addScaledVector(dcD, 0.055);
    loft(body, [dcB, dcE], [I('meta' + S)], makeProfile([{ s: 0, w: 0.018, h: 0.018 }, { s: 0.055, w: 0.009, h: 0.009 }]), { ring: 8, step: 0.03 });
    curvedClaw(horn, dcE.clone().addScaledVector(dcD, -0.004), dcD, V(0, -1, 0), 0.032, 1.1, 0.009, I('meta' + S), claw);
  }
  for (const A of arms) {
    const S = A.S;
    const pts = [V(A.sx * 0.08, 1.04, 1.05), A.shoulder, A.elbow, A.wrist];
    const al = arcLengths(pts);
    loft(body, pts, [I('upper' + S), I('upper' + S), I('fore' + S)], makeProfile([
      { s: 0, w: 0.06, h: 0.07 }, { s: al[1], w: 0.056, h: 0.064 }, { s: al[2], w: 0.04, h: 0.044 }, { s: al[3], w: 0.03, h: 0.032 },
    ]), { ring: 12, step: 0.03, startBone: I('chest'), endBone: I('hand' + S) });
    const fwdDown = V(-A.sx * 0.05, -0.55, 1).normalize();
    // Digits I-III carry big, strongly curved claws; IV and V are tiny vestigial nubs on the outside.
    for (const [ang, len, cl, w0] of [[-0.34, 0.075, 0.078, 0.021], [0, 0.14, 0.086, 0.02], [0.24, 0.12, 0.07, 0.018], [0.47, 0.034, 0, 0.011], [0.64, 0.02, 0, 0.008]]) {
      const d = fwdDown.clone().applyAxisAngle(UP, ang * A.sx);
      const a = A.wrist.clone().addScaledVector(d, 0.02).add(V(A.sx * ang * 0.02, 0, 0)); const b = a.clone().addScaledVector(d, len);
      loft(body, [a, b], [I('hand' + S)], makeProfile([{ s: 0, w: w0, h: w0 }, { s: len, w: w0 * 0.5, h: w0 * 0.5 }]), { ring: 8, step: 0.03, side: V(1, 0, 0) });
      if (cl) curvedClaw(horn, b.clone().addScaledVector(d, -0.004), d, V(0, -1, 0), cl, 1.5, 0.017, I('hand' + S), claw);
    }
  }

  const rig = new THREE.Group();
  rig.add(B.pelvis);
  const bodyGeo = body.build();
  // Fuzz coverage per vertex: back, neck and upper tail; snout, belly and limbs stay scaly.
  const fzA = new Float32Array(bodyGeo.attributes.position.count), bpA = bodyGeo.attributes.position, bnA = bodyGeo.attributes.normal;
  for (let v = 0; v < bodyVEnd; v++) { const z = bpA.getZ(v); fzA[v] = smooth(-0.2, 0.4, bnA.getY(v)) * smooth(-2.3, -1.75, z) * (1 - smooth(1.7, 1.86, z)); }
  bodyGeo.setAttribute('aFz', new THREE.BufferAttribute(fzA, 1));
  const furMesh = new THREE.SkinnedMesh(buildFur(bodyGeo, bodyIEnd, fzA), furMat);
  furMesh.receiveShadow = true; furMesh.frustumCulled = false; rig.add(furMesh);
  const bodyMesh = new THREE.SkinnedMesh(bodyGeo, skinMat);
  const hornMesh = new THREE.SkinnedMesh(horn.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, envMapIntensity: 0.8 }));
  const eyeMesh = new THREE.SkinnedMesh(eyes.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, envMapIntensity: 1.4 }));
  for (const m of [bodyMesh, hornMesh, eyeMesh]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; rig.add(m); }
  rig.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  for (const m of [bodyMesh, hornMesh, eyeMesh, furMesh]) m.bind(skeleton);
  // The original surface, for the skin shader's patterns (see aBind in the shaders).
  for (const g of [bodyGeo, furMesh.geometry]) {
    g.setAttribute('aBind', g.attributes.position.clone());
    g.setAttribute('aBindN', g.attributes.normal.clone());
  }
  const rest = reshape({ rig, bones, B, skeleton, meshes: [bodyMesh, hornMesh, eyeMesh, furMesh], legs, shape });

  // Vertex lists per height band, used to emit drips and mud flakes from the real skin surface.
  const bandVerts = Array.from({ length: BANDS }, () => []);
  const bp = bodyGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) { const b = Math.round(bp.getY(i) / BAND_H); if (b >= 0 && b < BANDS) bandVerts[b].push(i); }

  const legRig = rest.legs.map((L, i) => ({
    sx: L.sx, thigh: B['thigh' + L.S], shin: B['shin' + L.S], meta: B['meta' + L.S], toe: B['toe' + L.S],
    thighRest: L.knee.clone().sub(L.hip).normalize(), shinRest: L.ankle.clone().sub(L.knee).normalize(),
    metaRest: L.ball.clone().sub(L.ankle).normalize(), toeRest: L.toeTip.clone().sub(L.ball).normalize(),
    thighLen: L.knee.distanceTo(L.hip), shinLen: L.ankle.distanceTo(L.knee), metaLen: L.ball.distanceTo(L.ankle),
    neutral: V(L.ball.x, 0, L.ball.z), off: i * 0.5,
    planted: V(), footPos: V(), liftPos: V(), swing: false, groundY: 0,
  }));
  return { rig, B, bones, skeleton, bodyMesh, furMesh, legs: legRig, bandVerts, tails: J.tail.map((_, k) => B['tail' + k]),
    pelvisY: rest.pelvisY, hip: rest.hip, leg: rest.leg };
}

export { buildHerrerasaurus, skinU, BANDS, BAND_H };
