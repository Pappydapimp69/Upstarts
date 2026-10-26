// Strand hair: tapered ribbons grown from the scalp. Roots are scattered over the body triangles the
// fuzz coverage marks (so hair grows where the spec already says fur goes), each strand bends from the
// scalp normal toward a flow (away from a part line, back and down under gravity), is kept outside the
// head by the head part's distance field, and its tip is pulled toward a clump guide. Every strand
// is skinned like its root, so it moves with the head.
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Deterministic PRNG (mulberry32), so the same spec always grows the same hair.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// geo: the built body geometry (positions, normals, skin, aEx.x = fuzz coverage); sdf: distance to the
// part the hair must stay outside of; h: the spec's look.hair.
export function buildHair(geo, sdf, h) {
  const R = rng(h.seed ?? 7), P = geo.attributes.position, N = geo.attributes.normal, EX = geo.attributes.aEx;
  const SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight, idx = geo.index.array;
  // Root candidates: triangles weighted by area x coverage.
  const tris = [], cum = []; let total = 0;
  const a = V(), b = V(), c = V();
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    const cov = (EX.getX(i0) + EX.getX(i1) + EX.getX(i2)) / 3;
    if (cov < (h.minCover ?? 0.35)) continue;
    a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5 * cov;
    if (area <= 0) continue;
    total += area; tris.push([i0, i1, i2]); cum.push(total);
  }
  if (!tris.length) return null;
  const pick = () => { const x = R() * total; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } return tris[lo]; };
  const root = (tri) => {
    let u = R(), v = R(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = [1 - u - v, u, v], p = V(), n = V();
    tri.forEach((i, k) => { p.addScaledVector(V().fromBufferAttribute(P, i), w[k]); n.addScaledVector(V().fromBufferAttribute(N, i), w[k]); });
    const main = tri[w.indexOf(Math.max(...w))];
    return { p, n: n.normalize(), cov: tri.reduce((s, i, k) => s + EX.getX(i) * w[k], 0), si: [0, 1, 2, 3].map((k) => SI.getComponent(main, k)), sw: [0, 1, 2, 3].map((k) => SW.getComponent(main, k)) };
  };

  const seg = h.segments ?? 8, len0 = h.length ?? 0.08, partX = h.part ?? null;
  const flow = h.flow || {}, lift = h.lift ?? 0.003, minGap = h.gap ?? 0.004, vol = h.volume ?? 0.014;
  // Grow one strand as a polyline from a root.
  const centre = V(); for (let k = 0; k < 64; k++) centre.add(root(pick()).p); centre.divideScalar(64);
  const grow = (r, len) => {
    const pts = [r.p.clone().addScaledVector(r.n, lift)], d = r.n.clone();
    const side = partX == null ? Math.sign(r.p.x || 1) : Math.sign(r.p.x - partX || 1);
    // flow.out pushes strands away from the head's centre line (a crown or mane); flow.droop bends the
    // outer part of each strand down under its own weight.
    const out = V(r.p.x - centre.x, 0, r.p.z - centre.z); if (out.lengthSq() > 1e-10) out.normalize();
    const target = V(side * (flow.side ?? 0.5), -(flow.down ?? 0.5), -(flow.back ?? 0.7)).addScaledVector(out, flow.out ?? 0).normalize();
    const grad = (p) => { const e = 0.002; return V(sdf(V(p.x + e, p.y, p.z)) - sdf(V(p.x - e, p.y, p.z)), sdf(V(p.x, p.y + e, p.z)) - sdf(V(p.x, p.y - e, p.z)), sdf(V(p.x, p.y, p.z + e)) - sdf(V(p.x, p.y, p.z - e))).normalize(); };
    for (let i = 1; i <= seg; i++) {
      const t = i / seg;
      // Flow along the scalp: the target direction with its into/out-of-head part removed.
      let want = target;
      if (sdf) { const g = grad(pts[i - 1]); want = target.clone().addScaledVector(g, -target.dot(g)).normalize(); }
      if (flow.droop) want = want.clone().add(V(0, -(flow.droop) * t * t, 0)).normalize();
      d.lerp(want, clamp((1 - (h.stiffness ?? 0.65)) + t * 0.6, 0, 1)).normalize();
      const p = pts[i - 1].clone().addScaledVector(d, len / seg);
      // Keep the strand inside a shell [gap, volume] above the head.
      if (sdf) {
        const dd = sdf(p), g = grad(p);
        if (dd < minGap) { p.addScaledVector(g, minGap - dd); d.addScaledVector(g, Math.max(0, -d.dot(g))).normalize(); }
        else if (dd > vol) p.addScaledVector(g, -(dd - vol) * 0.7);
      }
      pts.push(p);
    }
    return pts;
  };

  const count = h.count ?? 3000, nClump = h.clumps ?? Math.max(8, Math.round(count / 30));
  const guides = [];
  for (let k = 0; k < nClump; k++) { const r = root(pick()); guides.push({ r, pts: grow(r, len0) }); }
  const pos = [], nor = [], col = [], si = [], sw = [], index = [], along = [];
  const cRoot = new THREE.Color(h.root || '#1a120c'), cTip = new THREE.Color(h.tip || '#4a301c'), cc = new THREE.Color();
  for (let s = 0; s < count; s++) {
    const r = root(pick());
    // Longer on top, shorter at the sides and nape; a little random variation per strand.
    const len = len0 * (1 - (h.sideShort ?? 0.5) * (1 - clamp(r.n.y, 0, 1))) * (1 - (h.lengthVar ?? 0.25) * R()) * clamp(r.cov * 1.4, 0.3, 1);
    const pts = grow(r, len);
    // Clump: pull toward the nearest guide's matching point, more at the tip.
    let best = guides[0], bd = Infinity;
    for (const g of guides) { const d = g.r.p.distanceToSquared(r.p); if (d < bd) { bd = d; best = g; } }
    const cl = h.clump ?? 0.45;
    for (let i = 1; i < pts.length; i++) {
      const t = i / seg, gp = best.pts[i].clone().sub(best.r.p).add(r.p);
      pts[i].lerp(gp, cl * t * t);
    }
    // Ribbon: width across the strand, facing out from the scalp; tapers to the tip.
    const base = pos.length / 3, w0 = (h.width ?? 0.004) * (0.7 + 0.6 * R()), tint = 0.85 + 0.3 * R();
    for (let i = 0; i < pts.length; i++) {
      const t = i / seg, tan = (i < seg ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      const across = tan.clone().cross(r.n); if (across.lengthSq() < 1e-8) across.set(1, 0, 0); across.normalize();
      const face = across.clone().cross(tan).normalize(), w = w0 * (1 - 0.85 * t);
      for (const sgn of [-1, 1]) {
        const p = pts[i].clone().addScaledVector(across, sgn * w * 0.5);
        pos.push(p.x, p.y, p.z); nor.push(face.x, face.y, face.z);
        cc.copy(cRoot).lerp(cTip, Math.pow(t, 0.7)).multiplyScalar(tint); col.push(cc.r, cc.g, cc.b);
        si.push(...r.si); sw.push(...r.sw); along.push(t);
      }
      if (i < seg) { const q = base + i * 2; index.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  // aT: 0 at the root, 1 at the tip, so motion can bend a strand more the further out it is.
  g.setAttribute('aT', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(index);
  return g;
}

// Secondary motion: uSway (in the head's own frame, metres at the tip) bends each strand by aT squared,
// so roots stay put and tips trail; a faint idle stir keeps hair from looking glued on. animate.js's
// hairSway drives uSway from the head's motion through a spring.
export function hairMaterial(h = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: h.roughness ?? 0.55, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  const U = { uSway: { value: new THREE.Vector3() }, uTime: { value: 0 }, uStir: { value: h.stir ?? 0.0025 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aT; uniform vec3 uSway; uniform float uTime; uniform float uStir;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float k = aT * aT; vec3 stir = vec3(sin(uTime * 1.7 + position.x * 40.0 + position.z * 23.0), 0.0, cos(uTime * 1.3 + position.y * 31.0)) * uStir;
          transformed += (uSway + stir) * k; }`);
  };
  mat.customProgramCacheKey = () => 'procedural-body-hair-v1';
  mat.userData.uniforms = U;
  return mat;
}
