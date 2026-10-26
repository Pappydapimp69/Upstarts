// Procedural lofted body: one continuous skinned mesh per part, swept along a joint chain.
// Generalised from the Dlist demo's Herrerasaurus (demos/skin-test). A creature is a spec (data):
// joints, parts (chains + cross-section profiles), attachments (claws, teeth, eyes) and a look.
// Real metres, +z forward, +y up. See README.md for the spec format.
import * as THREE from 'three';
import { skinMaterial, fuzzMaterial } from './skin.js';
import { buildHair, hairMaterial } from './hair.js';
import { glowMaterial, ribbonMaterial } from './materials.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Per-vertex extras carried with every vertex: fuzz coverage, stripe gate, limb tint, arc length.
class SkinBuilder {
  constructor() { this.p = []; this.c = []; this.i = []; this.si = []; this.sw = []; this.x = []; this.t = []; this.rd = []; this.uv = []; }
  get n() { return this.p.length / 3; }
  vert(pos, skin, col, ex) {
    const m = new Map();
    for (const [b, w] of skin) if (w > 1e-4) m.set(b, (m.get(b) || 0) + w);
    const s = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = s.reduce((a, q) => a + q[1], 0) || 1;
    this.p.push(pos.x, pos.y, pos.z);
    for (let k = 0; k < 4; k++) { this.si.push(s[k] ? s[k][0] : 0); this.sw.push(s[k] ? s[k][1] / tot : 0); }
    const cc = col || { r: 1, g: 1, b: 1 };
    this.c.push(cc.r, cc.g, cc.b);
    const e = ex || {};
    this.x.push(e.fz ?? 0, e.st ?? 0, e.lm ?? 0, e.s ?? 0);
    const tc = e.tc || { r: 1, g: 1, b: 1 };
    this.t.push(tc.r, tc.g, tc.b, e.tn ?? 0);
    this.uv.push(...(e.uv || [e.s ?? 0, 0, 0]));
    const rd = e.rd || pos;
    this.rd.push(rd.x, rd.y, rd.z);
    return this.n - 1;
  }
  prim(geo, matrix, bone, col) {
    const g = geo.clone().applyMatrix4(matrix);
    const p = g.attributes.position; const start = this.n;
    for (let k = 0; k < p.count; k++) this.vert(V(p.getX(k), p.getY(k), p.getZ(k)), [[bone, 1]], col);
    if (g.index) for (const k of g.index.array) this.i.push(start + k);
    else for (let k = 0; k < p.count; k += 3) this.i.push(start + k, start + k + 1, start + k + 2);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setAttribute('aEx', new THREE.Float32BufferAttribute(this.x, 4));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.t, 4));
    // aUV: arc length along the part, and the ring angle's cos/sin (for patterns across a ribbon).
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.uv, 3));
    // aOcc: ambient occlusion (0 = open, 1 = buried), baked after the body is built (bakeOcclusion).
    g.setAttribute('aOcc', new THREE.Float32BufferAttribute(new Float32Array(this.p.length / 3), 1));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
}

export function arcLengths(pts) { const L = [0]; for (let k = 1; k < pts.length; k++) L.push(L[k - 1] + pts[k].distanceTo(pts[k - 1])); return L; }

// Cross-section profile keyed by arc length, Catmull-Rom between keys. w/h are half width/height,
// e the superellipse exponent (2 round, higher boxier), yo a vertical offset, flatB/flatT flatten
// the bottom/top, topN narrows the top, fz/st/lm are fuzz, stripe and limb-tint amounts, tn how much
// of the part's `tint` colour covers the skin (clothing, markings, lips). lip / lipT hang a skirt of
// skin below the bottom (an upper lip over the teeth) or above the top (a lower lip), Dlist-style.
const FIELDS = ['w', 'h', 'yo', 'flatB', 'flatT', 'topN', 'e', 'fz', 'st', 'lm', 'tn', 'lip', 'lipT'];
export function makeProfile(keys, def = {}) {
  keys = keys.slice().sort((a, b) => a.s - b.s);
  const d = { e: 2.3, ...def };
  if (keys.length === 1) keys = [keys[0], { ...keys[0], s: keys[0].s + 1 }];
  return (s) => {
    let j = 0; while (j < keys.length - 2 && s > keys[j + 1].s) j++;
    const k0 = keys[Math.max(0, j - 1)], k1 = keys[j], k2 = keys[j + 1], k3 = keys[Math.min(keys.length - 1, j + 2)];
    const t = clamp((s - k1.s) / ((k2.s - k1.s) || 1), 0, 1);
    const out = {};
    for (const f of FIELDS) {
      const d0 = d[f] ?? 0, p0 = k0[f] ?? d0, p1 = k1[f] ?? d0, p2 = k2[f] ?? d0, p3 = k3[f] ?? d0;
      const t2 = t * t, t3 = t2 * t;
      const v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      out[f] = (f === 'w' || f === 'h') ? Math.max(v, 0.002) : v;
    }
    return out;
  };
}

// Sweep a superellipse cross-section along pts. segBones[j] owns the segment pts[j]..pts[j+1];
// each ring blends toward the neighbouring segment's bone near the joints so bends stay smooth.
export function loft(sb, pts, segBones, prof, opt = {}) {
  const N = opt.ring || 20, step = opt.step || 0.035, side = opt.side || V(1, 0, 0);
  const L = arcLengths(pts); const total = L[L.length - 1];
  const rings = Math.max(2, Math.ceil(total / step) + 1);
  const dirs = []; for (let k = 0; k < pts.length - 1; k++) dirs.push(pts[k + 1].clone().sub(pts[k]).normalize());
  const starts = [], centers = [], tans = [], ringSkins = [], ringEx = [];
  for (let r = 0; r < rings; r++) {
    const s = total * r / (rings - 1);
    let j = 0; while (j < pts.length - 2 && s > L[j + 1]) j++;
    const t = clamp((s - L[j]) / ((L[j + 1] - L[j]) || 1), 0, 1);
    const c = pts[j].clone().lerp(pts[j + 1], t);
    const tan = dirs[j].clone();
    if (t < 0.5 && j > 0) tan.lerp(dirs[j - 1], 0.5 * (1 - smooth(0, 0.5, t))).normalize();
    if (t > 0.5 && j < dirs.length - 1) tan.lerp(dirs[j + 1], 0.5 * smooth(0.5, 1, t)).normalize();
    let right = side.clone().addScaledVector(tan, -side.dot(tan));
    if (right.lengthSq() < 1e-8) right = V(0, 0, 1).addScaledVector(tan, -tan.z);
    right.normalize();
    const up = V().crossVectors(tan, right);
    const P = prof(s, total);
    const own = segBones[j];
    const prev = j > 0 ? segBones[j - 1] : (opt.startBone ?? own);
    const next = j < segBones.length - 1 ? segBones[j + 1] : (opt.endBone ?? own);
    const b = 0.32;
    const wp = t < b ? 0.5 * (1 - smooth(0, 1, t / b)) : 0;
    const wn = t > 1 - b ? 0.5 * smooth(0, 1, (t - (1 - b)) / b) : 0;
    const skin = [[own, 1 - wp - wn], [prev, wp], [next, wn]];
    const ex = { fz: P.fz, st: P.st, lm: P.lm, s: (opt.s0 || 0) + s, tn: clamp(P.tn, 0, 1), tc: opt.tint };
    starts.push(sb.n); centers.push(c.clone().addScaledVector(up, P.yo)); tans.push(tan); ringSkins.push(skin); ringEx.push(ex);
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2; const ca = Math.cos(a), sa = Math.sin(a);
      let x = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / P.e) * P.w;
      let y = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / P.e) * P.h;
      // Lips: the side walls hang below the bottom (upper lip) or rise above the top (lower lip) as a
      // skirt; an upper lip is skinned partly to `lipBone` so it can lift as the mouth opens.
      const m = smooth(0.5, 0.92, Math.abs(ca));
      let vs = skin;
      if (sa > 0) { x *= 1 - P.topN * sa; y *= 1 - P.flatT; if (P.lipT > 0.002) y = lerp(y, P.h * (1 - P.flatT) + P.lipT, m); }
      else {
        y *= 1 - P.flatB;
        if (P.lip > 0.002) {
          y = lerp(y, -P.h * (1 - P.flatB) - P.lip, m);
          if (opt.lipBone != null) { const wl = 0.9 * m * smooth(0.002, 0.02, P.lip); vs = [...skin.map(([bb, w]) => [bb, w * (1 - wl)]), [opt.lipBone, wl]]; }
        }
      }
      const rd = V().addScaledVector(right, x).addScaledVector(up, y);
      sb.vert(c.clone().addScaledVector(right, x).addScaledVector(up, y + P.yo), vs, opt.col, { ...ex, rd: rd.lengthSq() > 1e-12 ? rd.normalize() : up, uv: [ex.s, ca, sa] });
    }
  }
  for (let r = 0; r < rings - 1; r++) for (let k = 0; k < N; k++) {
    const a = starts[r] + k, b2 = starts[r] + (k + 1) % N, c = starts[r + 1] + k, d = starts[r + 1] + (k + 1) % N;
    sb.i.push(a, b2, c, b2, d, c);
  }
  // Rounded end caps: a few rings closing over a quarter ellipse, then a pole, so ends are domes
  // (a skull, a fingertip, a tail tip), not cones. Garments are open tubes (caps: false), but can close
  // one end (capStart / capEnd) where it tucks inside another garment, so its rim never shows.
  if (opt.caps === false && !opt.capStart && !opt.capEnd) return;
  const last = rings - 1;
  const dome = (ri, sign, len) => {
    // Big caps get more rings (one set per 5 cm), so a large dome stays round instead of faceted.
    const first = starts[ri], c0 = centers[ri], tan = tans[ri], M = len > 1e-6 ? (opt.dome ?? 4) * Math.min(4, Math.max(1, Math.round(len / 0.05))) : 0;
    let prev = first;
    // Cap profile: k = (1 - t^e)^(1/e) over the cap length; e = 1 is a cone (snouts, tails), 2 a dome
    // (skulls), the default 1.4 in between. Round caps space their rings by angle, so the last ring is
    // close to the pole and the top does not end in a small peak.
    const e = opt.capE ?? 1.4;
    for (let m = 1; m <= M; m++) {
      const t = e >= 1.5 ? Math.sin((Math.PI / 2) * m / (M + 1)) : m / (M + 1), k = Math.pow(1 - Math.pow(t, e), 1 / e), along = t * len * sign, phi = Math.atan2(t, k);
      const st = sb.n;
      for (let q = 0; q < N; q++) {
        const v = first + q, px = sb.p[v * 3] - c0.x, py = sb.p[v * 3 + 1] - c0.y, pz = sb.p[v * 3 + 2] - c0.z;
        sb.vert(V(c0.x + px * k + tan.x * along, c0.y + py * k + tan.y * along, c0.z + pz * k + tan.z * along), ringSkins[ri], opt.col, { ...ringEx[ri], rd: V(sb.rd[v * 3], sb.rd[v * 3 + 1], sb.rd[v * 3 + 2]).multiplyScalar(k).addScaledVector(tan, Math.sin(phi) * sign).normalize() });
      }
      for (let q = 0; q < N; q++) {
        const a = prev + q, b2 = prev + (q + 1) % N, c = st + q, d = st + (q + 1) % N;
        if (sign > 0) sb.i.push(a, b2, c, b2, d, c); else sb.i.push(a, c, b2, b2, c, d);
      }
      prev = st;
    }
    const pole = sb.vert(c0.clone().addScaledVector(tan, len * sign), ringSkins[ri], opt.col, { ...ringEx[ri], rd: tan.clone().multiplyScalar(sign) });
    for (let q = 0; q < N; q++) { if (sign > 0) sb.i.push(pole, prev + q, prev + (q + 1) % N); else sb.i.push(pole, prev + (q + 1) % N, prev + q); }
  };
  const P0 = prof(0, total), P1 = prof(total, total);
  if (opt.caps !== false || opt.capStart) dome(0, -1, Math.min(P0.w, P0.h) * (opt.baseCap ?? 0.7));
  if (opt.caps !== false || opt.capEnd) dome(last, 1, Math.min(P1.w, P1.h) * (opt.tipCap ?? 0.7));
}

const col = (c, d) => (Array.isArray(c) ? new THREE.Color().setRGB(c[0], c[1], c[2]) : new THREE.Color(c || d || '#2a2016'));

// The loft frame (centre, tangent, right, up) at arc length s; matches loft() exactly.
function frameAt(pt, s) {
  const { pts, L, side } = pt;
  let j = 0; while (j < pts.length - 2 && s > L[j + 1]) j++;
  const t = clamp((s - L[j]) / ((L[j + 1] - L[j]) || 1), 0, 1);
  const dirs = []; for (let k = 0; k < pts.length - 1; k++) dirs.push(pts[k + 1].clone().sub(pts[k]).normalize());
  const c = pts[j].clone().lerp(pts[j + 1], t), tan = dirs[j].clone();
  if (t < 0.5 && j > 0) tan.lerp(dirs[j - 1], 0.5 * (1 - smooth(0, 0.5, t))).normalize();
  if (t > 0.5 && j < dirs.length - 1) tan.lerp(dirs[j + 1], 0.5 * smooth(0.5, 1, t)).normalize();
  let right = side.clone().addScaledVector(tan, -side.dot(tan));
  if (right.lengthSq() < 1e-8) right = V(0, 0, 1).addScaledVector(tan, -tan.z);
  right.normalize();
  return { c, tan, right, up: V().crossVectors(tan, right), j };
}

// Cut a polyline (with its per-segment bones) to the arc-length window [s0, s1].
function cutChain(pts, L, segs, s0, s1) {
  const at = (s) => { let j = 0; while (j < pts.length - 2 && s > L[j + 1]) j++; const t = clamp((s - L[j]) / ((L[j + 1] - L[j]) || 1), 0, 1); return { j, p: pts[j].clone().lerp(pts[j + 1], t) }; };
  const a = at(s0), b = at(s1), out = [a.p], seg = [];
  for (let j = a.j + 1; j <= b.j; j++) { out.push(pts[j].clone()); seg.push(segs[j - 1]); }
  out.push(b.p); seg.push(segs[b.j]);
  return { pts: out, segs: seg };
}

// A garment: an open shell lofted over a stretch of another part, following its profile at an offset,
// with flared (or tightened) ends. `over` names the part, `chain` its stretch, `trim: [a, b]` metres cut
// from the start and end, `offset` the gap to the skin, `flare: [start, end]` extra radius at each
// opening over `flareLen`. It shares the body's bones, so it moves with whatever it covers.
function buildGarment(sb, g, target, chainPts, I, opt) {
  const base = target.L[target.chain.indexOf(g.chain[0])];
  const L = arcLengths(chainPts), total = L[L.length - 1];
  const s0 = (g.trim || [0, 0])[0], s1 = total - (g.trim || [0, 0])[1];
  const segs0 = g.chain.slice(0, -1).map((a, k) => target.segs[target.chain.indexOf(a)] ?? target.segs[target.segs.length - 1]);
  const cut = cutChain(chainPts, L, segs0, s0, s1), len = s1 - s0;
  const [fa, fb] = g.flare || [0, 0], fl = g.flareLen ?? 0.05, off = g.offset ?? 0.006;
  // drape (m): cloth bridges hollows (a tunic over a waist) instead of following them in. Each section
  // takes the parabolic dilation of the body profile, max over s' of w(s') - (s - s')^2 / (2 drape):
  // the shape a sheet with bending radius `drape` takes hanging over the body's high points. Off near
  // the openings, so hems and collars still fit.
  const dr = g.drape ?? 0;
  const prof = (s) => {
    const P = { ...target.prof(base + s0 + s) };
    if (dr > 0) {
      const k = smooth(0, fl, s) * smooth(0, fl, len - s), span = Math.sqrt(2 * dr * 0.03);
      let mw = P.w, mh = P.h;
      for (let i = -24; i <= 24; i++) {
        const ds = (span * i) / 24, Q = target.prof(base + s0 + s + ds), pen = (ds * ds) / (2 * dr);
        mw = Math.max(mw, Q.w - pen); mh = Math.max(mh, Q.h - pen);
      }
      P.w = lerp(P.w, mw, k); P.h = lerp(P.h, mh, k);
    }
    const grow = off + fa * (1 - smooth(0, fl, s)) + fb * smooth(len - fl, len, s);
    P.w += grow * (1 - P.topN * 0.5); P.h += grow; P.fz = 0; P.st = 0; P.lm = 0; P.tn = 1;
    return P;
  };
  loft(sb, cut.pts, cut.segs, prof, { ring: g.ring ?? target.ring, step: g.step ?? 0.012, side: target.side, caps: false, capStart: g.close === 'start', capEnd: g.close === 'end', baseCap: 0.4, tipCap: 0.4, tint: col(g.color), ...opt });
}

// Approximate signed distance from p to a lofted part (negative inside), from its profile, not its mesh.
// Frames are sampled once per part; the nearest centre point picks the cross-section.
function partSdf(pt, maxFrames = 1200) {
  const total = pt.L[pt.L.length - 1], n = Math.max(2, Math.min(maxFrames, Math.ceil(total / 0.004) + 1)), F = [];
  for (let i = 0; i < n; i++) { const s = total * i / (n - 1), f = frameAt(pt, s); F.push({ ...f, P: pt.prof(s, total) }); }
  const q = V();
  return (p) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = p.distanceToSquared(F[i].c); if (d < bd) { bd = d; bi = i; } }
    const f = F[bi], P = f.P;
    q.copy(p).sub(f.c);
    const along = q.dot(f.tan), x = q.dot(f.right), y = q.dot(f.up) - P.yo;
    const hh = y > 0 ? P.h * (1 - P.flatT) : P.h * (1 - P.flatB), ww = P.w * (y > 0 ? 1 - P.topN * clamp(y / hh, 0, 1) : 1);
    const rho = Math.hypot(x, y);
    // fr: radial position as a fraction of the cross-section's radius in that direction (1 = surface).
    const fr = rho > 1e-7 ? Math.pow(Math.pow(Math.abs(x) / ww, P.e) + Math.pow(Math.abs(y) / hh, P.e), 1 / P.e) : 0;
    const R = rho > 1e-7 ? rho / fr : Math.min(ww, hh);
    let d = rho - R;
    // Past either end the cap has the same superellipse profile loft() gives it, not a cylinder.
    const cap = Math.max(1e-4, Math.min(P.w, P.h) * (bi === 0 ? pt.baseCap ?? 0.7 : pt.tipCap ?? 0.7)), out = bi === 0 ? -along : bi === n - 1 ? along : 0;
    if (out > 0) { const ce = pt.capE ?? 1.4; d = (Math.pow(Math.pow(fr, ce) + Math.pow(out / cap, ce), 1 / ce) - 1) * Math.min(R, cap); }
    return d;
  };
}

// Ambient occlusion, baked per vertex from the parts' distance fields: march a few steps out along each
// vertex's normal and count how far the nearest surface cuts each step short (Quilez's SDF AO), so
// creases, armpits, the underside of a jaw and the skin under a garment's edge darken. Coarse fields
// (48 frames a part) and a box test per part keep it fast; the result is static, in the bind pose.
function bakeOcclusion(geos, recs, radius, steps = 4) {
  // Two scales: a tight one for facial creases and finger gaps, a wide one for limbs against the body.
  const radii = [radius * 0.4, radius * 1.4], reach = radii[1];
  const fields = recs.map((r) => ({ f: partSdf(r, 32), box: r.box.clone().expandByScalar(reach) }));
  const p = V(), n = V(), q = V(), t1 = V(), t2 = V(), dir = V();
  // A fan of five directions: the normal and four tilted 45 degrees off it, so a limb beside the
  // body (not straight in front of the normal) still shades it.
  const fan = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const geo of geos) {
    const P = geo.attributes.position, N = geo.attributes.normal, O = geo.attributes.aOcc;
    if (!O) continue;
    const raw = new Float32Array(P.count);
    for (let v = 0; v < P.count; v++) {
      p.fromBufferAttribute(P, v); n.fromBufferAttribute(N, v);
      const near = fields.filter((F) => F.box.containsPoint(p));
      if (!near.length) continue;
      t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize(); t2.crossVectors(n, t1);
      let open = 1;
      for (const r of radii) {
        let occ = 0, wsum = 0;
        for (const [a, b] of fan) {
          dir.copy(n).addScaledVector(t1, a).addScaledVector(t2, b).normalize();
          const wd = a || b ? 0.7 : 1;   // the straight-out sample counts most, as cosine weighting would
          const cz = dir.dot(n);   // over open, flat skin a tilted sample sits only h * cos(tilt) away
          for (let i = 1, w = 1; i <= steps; i++, w *= 0.7) {
            const h = (r * i) / steps, e = h * cz; q.copy(p).addScaledVector(dir, h);
            let d = Infinity; for (const F of near) d = Math.min(d, F.f(q));
            // the 0.12 bias forgives the coarse field's small error on open, convex skin
            occ += wd * w * clamp((e - d) / e - 0.12, 0, 1); wsum += wd * w;
          }
        }
        open *= 1 - clamp((occ / wsum) * 1.8, 0, 1);
      }
      raw[v] = 1 - open;
    }
    // Two smoothing passes over mesh neighbours: the coarse fields leave single-vertex speckles.
    const idx = geo.index.array, sum = new Float32Array(P.count), cnt = new Float32Array(P.count);
    let cur = raw;
    for (let pass = 0; pass < 2; pass++) {
      sum.set(cur); cnt.fill(1);
      for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = idx[t + k], b = idx[t + (k + 1) % 3]; sum[a] += cur[b]; cnt[a]++; sum[b] += cur[a]; cnt[b]++; }
      const next = new Float32Array(P.count); for (let v = 0; v < P.count; v++) next[v] = sum[v] / cnt[v]; cur = next;
    }
    for (let v = 0; v < P.count; v++) O.setX(v, cur[v]);
    O.needsUpdate = true;
  }
}

// Blend a part into the part(s) it joins with a smooth union: every vertex of either part that lies
// just outside the other is pushed out along its own radial direction by the polynomial smooth-min
// offset h^2 k / 4 (h = (k - d) / k). The crease fills in as a fillet instead of a hard seam or lump.
function blendJoins(body, built) {
  const byName = new Map(built.filter((b) => b.name).map((b) => [b.name, b]));
  const delta = new Float32Array(body.p.length), p = V();
  const push = (from, to, k) => {
    const sdf = to.sdf || (to.sdf = partSdf(to));
    const lo = to.box.min.clone().subScalar(k), hi = to.box.max.clone().addScalar(k);
    for (let v = from.v0; v < from.v1; v++) {
      p.set(body.p[v * 3], body.p[v * 3 + 1], body.p[v * 3 + 2]);
      if (p.x < lo.x || p.y < lo.y || p.z < lo.z || p.x > hi.x || p.y > hi.y || p.z > hi.z) continue;
      const d = sdf(p);
      if (d <= 0 || d >= k) continue;
      const h = (k - d) / k, o = h * h * k * 0.25;
      for (let a = 0; a < 3; a++) delta[v * 3 + a] += body.rd[v * 3 + a] * o;
    }
  };
  const pairs = [];
  for (const part of built) {
    for (const name of [].concat(part.join || [])) {
      const to = byName.get(name);
      if (!to) continue;
      const k = part.blend ?? 0.02;
      push(part, to, k); push(to, part, k); pairs.push([part, to, k]);
    }
  }
  for (let i = 0; i < delta.length; i++) body.p[i] += delta[i];
  return pairs;
}

// Across a join the two meshes still meet at a tessellated line; lighting hides it if both sides share
// a normal there. Within 2k of the other part, a vertex's normal leans toward the other part's SDF
// gradient, half-way at contact, so both surfaces shade as one.
function blendNormals(geo, pairs) {
  const P = geo.attributes.position, N = geo.attributes.normal, p = V(), n = V(), g = V(), e = 0.002;
  const lean = (from, to, k) => {
    const sdf = to.sdf, lo = to.box.min.clone().subScalar(2 * k), hi = to.box.max.clone().addScalar(2 * k);
    for (let v = from.v0; v < from.v1; v++) {
      p.fromBufferAttribute(P, v);
      if (p.x < lo.x || p.y < lo.y || p.z < lo.z || p.x > hi.x || p.y > hi.y || p.z > hi.z) continue;
      const d = sdf(p);
      if (d < -k || d > 2 * k) continue;
      g.set(sdf(V(p.x + e, p.y, p.z)) - sdf(V(p.x - e, p.y, p.z)), sdf(V(p.x, p.y + e, p.z)) - sdf(V(p.x, p.y - e, p.z)), sdf(V(p.x, p.y, p.z + e)) - sdf(V(p.x, p.y, p.z - e)));
      if (g.lengthSq() < 1e-12) continue;
      g.normalize(); n.fromBufferAttribute(N, v);
      const w = 0.5 * (1 - smooth(0, 2 * k, Math.max(d, 0)));
      n.lerp(g, w).normalize();
      N.setXYZ(v, n.x, n.y, n.z);
    }
  };
  for (const [a, b, k] of pairs) { lean(a, b, k); lean(b, a, k); }
  N.needsUpdate = true;
}

// Dents (eye sockets, fenestrae, nostrils, gill slits): pushed in along -dir, with an optional raised
// rim. `dir` defaults to straight out to the side; a mark off the midline is mirrored to both sides.
export function markFrames(m) {
  const dir = V(...(m.dir || [Math.sign(m.at[0]) || 1, 0, 0])).normalize();
  let u = V(0, 1, 0).cross(dir); if (u.lengthSq() < 1e-6) u = V(1, 0, 0); u.normalize();
  const sides = m.mirror ?? m.at[0] !== 0 ? [1, -1] : [1];
  return sides.map((sx) => {
    const S = (v) => V(v.x * sx, v.y, v.z);
    const D = S(dir), U = S(u);
    return { c: V(m.at[0] * sx, m.at[1], m.at[2]), D, U, W: V().crossVectors(D, U) };
  });
}
function applyMarks(body, marks) {
  const p = V(), q = V(), rd = V(), moved = [];
  for (const m of marks) {
    let n = 0;
    const [ra, rb] = m.r, depth = m.depth ?? 0.01, rim = m.rim ?? 0;
    for (const f of markFrames(m)) {
      for (let v = 0; v < body.n; v++) {
        p.set(body.p[v * 3], body.p[v * 3 + 1], body.p[v * 3 + 2]);
        rd.set(body.rd[v * 3], body.rd[v * 3 + 1], body.rd[v * 3 + 2]);
        if (rd.dot(f.D) < 0.2) continue;
        q.copy(p).sub(f.c);
        if (Math.abs(q.dot(f.D)) > 1.5 * Math.max(ra, rb)) continue;
        const d = (q.dot(f.U) / ra) ** 2 + (q.dot(f.W) / rb) ** 2;
        if (d > 2) continue;
        const o = -depth * (1 - smooth(0.4, 1.4, d)) + depth * rim * smooth(1, 1.3, d) * (1 - smooth(1.3, 1.9, d));
        body.p[v * 3] += f.D.x * o; body.p[v * 3 + 1] += f.D.y * o; body.p[v * 3 + 2] += f.D.z * o; n++;
      }
    }
    moved.push(n);
  }
  return moved;
}

// Proportion checks a spec carries (`checks: [{ name, value: (m) => number, min, max, unit }]`), run on
// the built body. m.J(name) gives a joint's bind position, m.box the body's bounds, m.attach(type)
// the first attachment of a type. Returns rows with ok flags, for contact sheets and test pages.
export function runChecks(c) {
  const spec = c.spec, J = new Map(spec.joints.map((j) => [j.name, j.at]));
  const box = new THREE.Box3().setFromBufferAttribute(c.meshes.body.geometry.attributes.position);
  const m = { spec, J: (n) => J.get(n), box, height: box.max.y - Math.min(0, box.min.y), length: box.max.z - box.min.z, attach: (t) => (spec.attach || []).find((a) => a.type === t) };
  return (spec.checks || []).map((k) => { const value = k.value(m); return { ...k, value, ok: value >= k.min && value <= k.max }; });
}

// A curved, laterally flattened claw (or horn, tooth, spine) swept along an arc curling toward `down`.
function curvedClaw(sb, base, dir, down, len, curl, w, bone, col) {
  const dn = down.clone().addScaledVector(dir, -down.dot(dir)).normalize(), pts = [];
  if (curl < 1e-3) { pts.push(base, base.clone().addScaledVector(dir, len)); }
  else { const R0 = len / curl; for (let i = 0; i <= 6; i++) { const a = curl * i / 6; pts.push(base.clone().addScaledVector(dir, R0 * Math.sin(a)).addScaledVector(dn, R0 * (1 - Math.cos(a)))); } }
  const L = arcLengths(pts), tot = L[L.length - 1];
  loft(sb, pts, Array(pts.length - 1).fill(bone), makeProfile([{ s: 0, w: w * 0.5, h: w }, { s: tot * 0.5, w: w * 0.36, h: w * 0.66 }, { s: tot, w: 0.0012, h: 0.0015 }], { e: 2 }),
    { ring: 8, step: tot / 8, side: V().crossVectors(dir, dn).normalize(), col, tipCap: 0.2, dome: 1 });
}

// Resolve variant multipliers into a new spec: length[group] scales each joint's offset from its
// parent (children follow), girth[group] scales w/h of profile keys anchored at that group's joints,
// size scales everything. Attachments and marks ride their bone/joint; surface detail keeps its
// real-world density (stripes, scales and fuzz are rescaled by 1/size unless the variant sets them).
export function applyVariant(spec, v = {}) {
  const len = v.length || {}, gir = v.girth || {}, size = v.size ?? 1;
  const byName = new Map(spec.joints.map((j) => [j.name, j]));
  // A joint's axis: toward its first child in the same group (head to crown on a person, head to snout
  // on a theropod), else along the bone from its parent. Not fixed x/y/z: heads point different ways.
  const axisOf = (j) => {
    const ch = spec.joints.find((c) => c.parent === j.name && c.group === j.group), par = j.parent && byName.get(j.parent);
    const d = ch ? V(...ch.at).sub(V(...j.at)) : par ? V(...j.at).sub(V(...par.at)) : V(0, 0, 1);
    return d.lengthSq() < 1e-12 ? V(0, 0, 1) : d.normalize();
  };
  const abs = new Map();
  const place = (j) => {
    if (abs.has(j.name)) return abs.get(j.name);
    let p;
    if (!j.parent) p = V(...j.at);
    else {
      const par = byName.get(j.parent), pp = place(par), o = V(...j.at).sub(V(...par.at));
      if (j.surface) {
        // A feature on its parent's surface (a nose on a head): along the parent's axis it scales with
        // the parent group's length, across it with its girth, so it stays on the resized surface.
        const d = axisOf(par), along = d.clone().multiplyScalar(o.dot(d)), across = o.clone().sub(along);
        p = pp.clone().add(along.multiplyScalar(len[par.group] ?? 1)).add(across.multiplyScalar(gir[par.group] ?? 1));
      } else p = pp.clone().add(o.multiplyScalar(len[j.group] ?? 1));
    }
    abs.set(j.name, p); return p;
  };
  spec.joints.forEach(place);
  // Longer or shorter legs move the feet off the ground plane: lift (or lower) everything so the
  // lowest joint keeps its original height.
  const minY = (ps) => Math.min(...ps.map((p) => p.y));
  const lift = minY(spec.joints.map((j) => V(...j.at))) - minY([...abs.values()]);
  for (const p of abs.values()) p.y += lift;
  const groupOf = (name) => byName.get(name)?.group;
  const at = (name) => abs.get(name).clone().multiplyScalar(size);
  // A point tied to a joint keeps its offset from it, scaled by size and (across the body) by girth.
  // Along that axis an offset scales with length; across it, with girth.
  const ride = (pt, joint) => {
    const j = byName.get(joint), o = V(...pt).sub(V(...j.at)), g = gir[groupOf(joint)] ?? 1, l = len[groupOf(joint)] ?? 1;
    const d = axisOf(j);
    const along = d.clone().multiplyScalar(o.dot(d)), across = o.clone().sub(along);
    return at(joint).add(along.multiplyScalar(l * size)).add(across.multiplyScalar(g * size)).toArray();
  };
  const joints = spec.joints.map((j) => ({ ...j, at: at(j.name).toArray() }));
  const parts = spec.parts.map((p) => p.over ? { ...p, offset: (p.offset ?? 0.006) * size, flare: (p.flare || [0, 0]).map((f) => f * size), flareLen: (p.flareLen ?? 0.05) * size, trim: (p.trim || [0, 0]).map((t) => t * size) } : ({
    ...p,
    keys: p.keys.map((k) => {
      const g = gir[groupOf(k.at)] ?? 1, o = { ...k };
      if (k.w != null) o.w = k.w * g * size;
      if (k.h != null) o.h = k.h * g * size;
      if (k.yo != null) o.yo = k.yo * g * size;
      if (k.off != null) o.off = k.off * size * (len[groupOf(k.at)] ?? 1);
      return o;
    }),
    step: (p.step ?? 0.035) * Math.max(size, 0.3),
  }));
  const attach = (spec.attach || []).map((a) => {
    const o = { ...a }, j = a.bone;
    for (const f of ['at', 'from', 'to']) if (a[f] && j) o[f] = ride(a[f], j);
    for (const f of ['len', 'w', 'r', 'depth']) if (a[f] != null) o[f] = Array.isArray(a[f]) ? a[f].map((x) => x * size) : a[f] * size;
    if (a.size) o.size = a.size.map((n) => n * size);
    return o;
  });
  const L0 = spec.look || {}, vl = v.look || {};
  const look = { ...L0, ...vl };
  if (!vl.stripe && L0.stripe) look.stripe = { ...L0.stripe, freq: (L0.stripe.freq ?? 2.5) / size };
  if (!vl.scales) look.scales = { ...(L0.scales || {}), size: ((L0.scales || {}).size ?? 64) / size };
  if (L0.fuzz || vl.fuzz) { const f = { ...(L0.fuzz || {}), ...(vl.fuzz || {}) }; look.fuzz = { ...f, len: (f.len ?? 0.06) * size, density: (f.density ?? 0.0105) * size }; }
  if (L0.marks) look.marks = L0.marks.map((m) => ({ ...m, at: m.joint ? ride(m.at, m.joint) : m.at.map((n) => n * size), r: m.r.map((n) => n * size), depth: (m.depth ?? 0.01) * size }));
  // Gait: strides, lifts and bob scale with size; foot-roll pivots ride their ankle and knee poles
  // scale, or a smaller body would walk on full-size feet.
  const g = spec.gait, gait = g && { ...g, ...(g.stride ? { stride: g.stride * size, lift: (g.lift ?? 0.08) * size, speed: (g.speed ?? 1) * Math.sqrt(size) } : {}),
    ...(g.bob ? { bob: { ...g.bob, amp: g.bob.amp * size, drop: (g.bob.drop ?? 0) * size } } : {}),
    ...(g.legs ? { legs: g.legs.map((l) => ({ ...l, pole: l.pole.map((x) => x * size),
      ...(l.roll ? { roll: { ...l.roll, heel: ride(l.roll.heel, l.ankle), ball: ride(l.roll.ball, l.ankle) } } : {}) })) } : {}) };
  // Painted weights, the mouth opening and face offsets are bind-space numbers too: they ride their
  // joint and scale like everything else, or a resized head keeps a full-size jaw and mouth.
  const gs = (j) => size * (gir[groupOf(j)] ?? 1);
  const paint = (spec.paint || []).map((pt) => ({ ...pt, center: ride(pt.center, pt.bone), radius: pt.radius.map((r) => r * gs(pt.bone)),
    ...(pt.below != null ? { below: ride([pt.center[0], pt.below, pt.center[2]], pt.bone)[1] } : {}) }));
  const m0 = spec.mouth, mouth = m0 && { ...m0, ...(m0.lip ? { lip: { ...m0.lip, lift: m0.lip.lift * size } } : {}),
    ...(m0.hole ? (() => { const hj = byName.get(m0.jaw).parent, q = ride([m0.hole.at[0], m0.hole.at[1], m0.hole.z], hj);
      return { hole: { ...m0.hole, at: [q[0], q[1]], z: q[2], w: m0.hole.w * gs(hj), h: m0.hole.h * gs(hj) } }; })() : {}) };
  const face = spec.face && { ...spec.face, browLift: (spec.face.browLift ?? 0.006) * size };
  return { ...spec, name: v.name || spec.name, joints, parts, attach, look, gait, paint, mouth, face, checks: v.checks || [] };
}

// Build a skinned creature from a spec. Returns { root, bones, B, skeleton, meshes }.
// opts.lod: 0 full detail; 1 half the rings, double the step; 2 a third of the rings, 3.5x the step,
// no fur, hair, eyes' sclera detail or dents. Lower levels keep every part, join and bone.
const LOD = [{ ring: 1, step: 1 }, { ring: 0.5, step: 2 }, { ring: 0.32, step: 3.5 }];
export function buildBody(spec, opts = {}) {
  const lod = LOD[opts.lod ?? 0] || LOD[0], lv = opts.lod ?? 0;
  const ringOf = (r) => Math.max(6, Math.round(r * lod.ring / 2) * 2), stepOf = (s) => s * lod.step;
  const byName = new Map(spec.joints.map((j) => [j.name, j]));
  const P = (name) => V(...byName.get(name).at);
  const bones = [], B = {}, depth = new Map();
  for (const j of spec.joints) {
    if (j.bone === false) continue;
    const b = new THREE.Bone(); b.name = j.name; b.userData.abs = P(j.name);
    let par = j.parent; while (par && byName.get(par).bone === false) par = byName.get(par).parent;
    if (par) { b.position.copy(b.userData.abs).sub(B[par].userData.abs); B[par].add(b); depth.set(j.name, depth.get(par) + 1); }
    else { b.position.copy(b.userData.abs); depth.set(j.name, 0); }
    b.userData.index = bones.length; bones.push(b); B[j.name] = b;
  }
  const I = (name) => B[name].userData.index;
  const nearestBone = (name) => { let n = name; while (n && !B[n]) n = byName.get(n).parent; return n; };
  // The bone owning a segment is the endpoint nearer the root; a non-bone tip defers to the other end.
  const owner = (a, b) => {
    if (!B[a]) return B[b] ? b : nearestBone(a);
    if (!B[b]) return a;
    return depth.get(a) <= depth.get(b) ? a : b;
  };

  const body = new SkinBuilder(), horn = new SkinBuilder(), eye = new SkinBuilder();
  // Parts with `material: name` go to their own mesh with look.materials[name] (glow, ribbon, ...);
  // the rest are the skin. Only skin parts join, dent and seat eyes.
  const matB = {};
  const parts = {}, built = [];
  for (const part of spec.parts) {
    if (part.over) continue;
    const sbP = part.material ? (matB[part.material] ??= new SkinBuilder()) : body;
    const v0 = body.n;
    const pts = part.chain.map(P);
    const L = arcLengths(pts);
    const segs = part.chain.slice(0, -1).map((a, k) => I(part.bones?.[k] ?? owner(a, part.chain[k + 1])));
    const keys = part.keys.map((k) => ({ ...k, s: (k.at != null ? L[part.chain.indexOf(k.at)] : 0) + (k.off || 0) }));
    const prof = makeProfile(keys, { fz: part.fuzz ?? 0, st: part.stripe ?? 1, lm: part.limb ?? 0, e: part.e ?? 2.3, tn: part.tint ? 1 : 0 });
    const first = byName.get(part.chain[0]), lastJ = part.chain[part.chain.length - 1];
    loft(sbP, pts, segs, prof, {
      ring: ringOf(part.ring ?? 20), step: stepOf(part.step ?? 0.035), side: part.side ? V(...part.side) : undefined,
      startBone: part.startBone ? I(part.startBone) : (first.parent && B[part.chain[0]] ? I(nearestBone(first.parent)) : undefined),
      endBone: part.endBone ? I(part.endBone) : (B[lastJ] ? I(lastJ) : undefined),
      tipCap: part.tipCap, baseCap: part.baseCap, capE: part.capE, dome: [4, 2, 1][lv] ?? 1, tint: part.tint ? col(part.tint) : undefined, lipBone: part.lipBone ? I(part.lipBone) : undefined,
    });
    const rec = { name: part.name, join: part.join, blend: part.blend, tipCap: part.tipCap, baseCap: part.baseCap, capE: part.capE, v0, v1: body.n, pts, L, prof, segs, chain: part.chain, ring: ringOf(part.ring ?? 20), side: part.side ? V(...part.side) : V(1, 0, 0), e: part.e ?? 2.3 };
    if (sbP !== body) continue;
    rec.box = new THREE.Box3().setFromArray(body.p.slice(v0 * 3, body.n * 3));
    built.push(rec);
    if (part.name) parts[part.name] = rec;
  }
  const pairs = blendJoins(body, built);
  // Painted weights: `paint: [{ part, bone, center, radius: [x, y, z], below? }]` moves vertices of a part
  // onto a bone inside a soft ellipsoid (and under a height, e.g. a mouth line), e.g. a jaw in a head loft.
  for (const pt of spec.paint || []) {
    const rec = parts[pt.part], bi = I(pt.bone), C = V(...pt.center), Rr = pt.radius;
    for (let v = rec.v0; v < rec.v1; v++) {
      const x = body.p[v * 3], y = body.p[v * 3 + 1], z = body.p[v * 3 + 2];
      const e = ((x - C.x) / Rr[0]) ** 2 + ((y - C.y) / Rr[1]) ** 2 + ((z - C.z) / Rr[2]) ** 2;
      let w = 1 - smooth(0.45, 1, e);
      if (pt.below != null) w *= 1 - smooth(pt.below - 0.004, pt.below + 0.004, y);
      if (w <= 1e-3) continue;
      const m = new Map();
      for (let k = 0; k < 4; k++) { const b = body.si[v * 4 + k], ww = body.sw[v * 4 + k] * (1 - w); if (ww > 0) m.set(b, (m.get(b) || 0) + ww); }
      m.set(bi, (m.get(bi) || 0) + w);
      const top = [...m.entries()].sort((a2, b2) => b2[1] - a2[1]).slice(0, 4), tot = top.reduce((a2, q2) => a2 + q2[1], 0);
      for (let k = 0; k < 4; k++) { body.si[v * 4 + k] = top[k] ? top[k][0] : 0; body.sw[v * 4 + k] = top[k] ? top[k][1] / tot : 0; }
    }
  }
  const cloth = new SkinBuilder();
  for (const g of spec.parts.filter((q) => q.over)) buildGarment(cloth, { ...g, step: stepOf(g.step ?? 0.012) }, parts[g.over], g.chain.map(P), I);

  const look = spec.look || {};
  const marks = (look.marks || []).slice(0, 8);
  const stats = { marks: lv < 2 ? applyMarks(body, marks) : [], joins: pairs.length };

  const hornC = new THREE.Color(look.horn || '#211a15'), toothC = new THREE.Color(look.tooth || '#d6cbb0');
  for (const a0 of spec.attach || []) {
    // Far levels drop teeth and claws and thin out plate rows.
    if (lv >= 2 && (a0.type === 'teeth' || a0.type === 'claw')) continue;
    const a = a0.type === 'row' && lv ? { ...a0, count: Math.max(2, Math.round(a0.count / (lv + 1))), size: [a0.size[0], a0.size[1], a0.size[2] * (lv + 1) * 0.8] } : a0;
    if (a.type === 'claw') {
      curvedClaw(horn, V(...a.at), V(...a.dir).normalize(), V(...(a.down || [0, -1, 0])), a.len, a.curl ?? 0.8, a.w, I(nearestBone(a.bone)), a.color ? col(a.color) : a.tooth ? toothC : hornC);
    } else if (a.type === 'teeth') {
      const from = V(...a.from), to = V(...a.to), g = a.shape === 'box' ? new THREE.BoxGeometry(a.w * 2, a.len, a.depth ?? a.w * 1.2) : new THREE.ConeGeometry(a.w, a.len, 5);
      if (a.up) g.translate(0, a.len / 2, 0); else { if (a.shape !== 'box') g.rotateX(Math.PI); g.translate(0, -a.len / 2, 0); }
      for (let k = 0; k < a.count; k++) {
        const p = from.clone().lerp(to, a.count > 1 ? k / (a.count - 1) : 0);
        for (const sx of [1, -1]) horn.prim(g, new THREE.Matrix4().setPosition(sx * p.x, p.y, p.z), I(nearestBone(a.bone)), toothC);
      }
    } else if (a.type === 'row') {
      // A row of plates or spikes riding the top of a part (osteoderms, dorsal spines, sail rays).
      const pt = parts[a.part], si = (n) => pt.L[spec.parts.find((q) => q.name === a.part).chain.indexOf(n)];
      const s0 = si(a.from), s1 = si(a.to), [bw, bh, bl] = a.size;
      const g = a.shape === 'spike' ? new THREE.ConeGeometry(bw, bh, 6).translate(0, bh / 2, 0) : new THREE.BoxGeometry(bw, bh, bl).translate(0, bh * 0.3, 0);
      for (let k = 0; k < a.count; k++) {
        const s = lerp(s0, s1, a.count > 1 ? k / (a.count - 1) : 0), f = frameAt(pt, s), Pp = pt.prof(s, pt.L[pt.L.length - 1]);
        const sc = lerp(a.scaleFrom ?? 1, a.scaleTo ?? 1, a.count > 1 ? k / (a.count - 1) : 0);
        for (const sx of a.x ? [1, -1] : [0]) {
          const fx = (a.x || 0) * sx, ee = Pp.e, top = Pp.h * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(fx), ee)), 1 / ee) * (1 - Pp.flatT);
          const pos = f.c.clone().addScaledVector(f.right, fx * Pp.w * (1 - Pp.topN)).addScaledVector(f.up, Pp.yo + top - (a.sink ?? 0.2) * bh);
          const m = new THREE.Matrix4().makeBasis(f.right, f.up, f.tan).multiply(new THREE.Matrix4().makeRotationZ(-sx * (a.tilt ?? 0.25))).multiply(new THREE.Matrix4().makeScale(sc, sc, sc));
          m.setPosition(pos);
          horn.prim(g, m, pt.segs[f.j], col(a.color, look.plate || look.back));
        }
      }
    } else if (a.type === 'blob') {
      // A plain ellipsoid on a bone: a mouth cavity, a gland, a wattle.
      horn.prim(new THREE.SphereGeometry(1, 16, 12), new THREE.Matrix4().compose(V(...a.at), new THREE.Quaternion(), V(...[].concat(a.r).flatMap((v, i, arr) => arr.length === 1 ? [v, v, v] : [v]))), I(nearestBone(a.bone)), col(a.color, '#2a0d0d'));
    } else if (a.type === 'eye') {
      // Eyes look along `look` (default: straight out to the side) and seat themselves on the skin:
      // among body vertices within ~r of the eye's line of sight, take the outermost along it.
      const r = a.r, bone = I(nearestBone(a.bone));
      for (const sx of a.single ? [1] : [1, -1]) {
        const c = V(a.at[0] * sx, a.at[1], a.at[2]);
        const look = (a.look ? V(a.look[0] * sx, a.look[1], a.look[2]) : V(sx * Math.sign(a.at[0] || 1), 0, 0)).normalize();
        if (a.seat !== false) {
          // Narrow first (a fine face), widening until the line of sight finds skin (a coarse skull may
          // have no vertex that close to the line on one side).
          let best = -Infinity; const d = V();
          for (const reach of [0.6, 1.2, 2.5, 5]) {
            for (let v = 0; v < body.n; v++) {
              d.set(body.p[v * 3], body.p[v * 3 + 1], body.p[v * 3 + 2]).sub(c);
              const along = d.dot(look);
              if (along > -4 * r && d.addScaledVector(look, -along).length() < r * reach) best = Math.max(best, along);
            }
            if (best > -Infinity) break;
          }
          if (best > -Infinity) c.addScaledVector(look, best - r * (a.sink ?? 0.45));
        }
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), look);
        const put = (rad, sc, off, colr) => eye.prim(new THREE.SphereGeometry(rad, 16, 12), new THREE.Matrix4().compose(c.clone().addScaledVector(look, off), q, V(...sc)), bone, new THREE.Color(colr));
        if (a.lids) {
          // Upper and lower lids: skin caps over the eyeball, each on its own bone at the eye's centre,
          // so rotating them about x closes the eye (setFace blinks).
          const S = sx > 0 ? 'L' : 'R', par = B[nearestBone(a.bone)];
          for (const [nm, t0, tl] of [['lidU_' + S, 0, Math.PI * (a.lids.upper ?? 0.4)], ['lidD_' + S, Math.PI * (1 - (a.lids.lower ?? 0.28)), Math.PI * (a.lids.lower ?? 0.28)]]) {
            const lb = new THREE.Bone(); lb.name = nm; lb.userData.abs = c.clone(); lb.position.copy(c).sub(par.userData.abs);
            par.add(lb); lb.userData.index = bones.length; bones.push(lb); B[nm] = lb;
            const lid = new THREE.SphereGeometry(r * 1.13, 28, 10, 0, Math.PI * 2, t0, tl);
            body.prim(lid, new THREE.Matrix4().compose(c, q, V(1, 1, 1)), lb.userData.index, null);
          }
        }
        if (a.sclera) {
          put(r, [1, 1, 1], 0, a.sclera);
          put(r * 0.5, [1, 1, 0.45], r * 0.8, a.iris || '#5a3a1a');
          put(r * 0.24, [1, 1, 0.5], r * 0.9, '#0b0806');
        } else {
          put(r, [1, 1, 1], 0, a.iris || '#a86d1a');
          put(r * 0.46, a.slit ? [0.45, 1.25, 0.9] : [1, 1, 0.9], r * 0.62, '#0b0806');
        }
      }
    }
  }

  const root = new THREE.Group();
  for (const b of bones) if (!b.parent) root.add(b);
  const bodyGeo = body.build();
  blendNormals(bodyGeo, pairs);
  // look.ao: { strength, radius } (default on; false turns it off). The radius scales with the body.
  const aoCfg = look.ao === false ? null : (look.ao || {});
  const clothGeo = cloth.n ? cloth.build() : null;
  if (aoCfg && built.length) {
    const size = new THREE.Box3().setFromBufferAttribute(bodyGeo.attributes.position).getSize(V()).length();
    bakeOcclusion([bodyGeo, clothGeo].filter(Boolean), built, aoCfg.radius ?? size * 0.035);
  }
  // Fuzz grows on surfaces facing `fuzz.dir` (default up) or sideways; bellies stay bare.
  if (look.fuzz) {
    const ex = bodyGeo.attributes.aEx, nr = bodyGeo.attributes.normal, lo = look.fuzz.below ?? -0.2, dir = V(...(look.fuzz.dir || [0, 1, 0])).normalize();
    for (let v = 0; v < ex.count; v++) ex.setX(v, ex.getX(v) * smooth(lo, 0.4, nr.getX(v) * dir.x + nr.getY(v) * dir.y + nr.getZ(v) * dir.z));
  }
  const meshes = { body: new THREE.SkinnedMesh(bodyGeo, skinMaterial(look, marks.flatMap((m) => markFrames(m).map((f) => ({ ...f, r: m.r, dark: m.dark ?? 0.7 }))))) };
  if (horn.n) meshes.horn = new THREE.SkinnedMesh(horn.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, envMapIntensity: 0.8 }));
  if (cloth.n) { meshes.cloth = new THREE.SkinnedMesh(clothGeo, skinMaterial({ ...look, sss: undefined, scales: { size: 1, depth: 0 }, mottle: 0.08, roughness: 0.9, gloss: 0 })); meshes.cloth.material.side = THREE.DoubleSide; }
  if (eye.n) meshes.eye = new THREE.SkinnedMesh(eye.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, envMapIntensity: 1.4 }));
  // layers: 0 keeps fur coverage (scalp darkening, hair roots) without drawing any shells.
  const fuzz = lv < 2 && look.fuzz && (look.fuzz.layers ?? 10) > 0 && buildFuzz(bodyGeo, Math.max(3, Math.round((look.fuzz.layers ?? 10) / (lv + 1))));
  if (fuzz) { meshes.fuzz = new THREE.SkinnedMesh(fuzz, fuzzMaterial(look)); meshes.fuzz.castShadow = false; }
  if (look.hair && lv < 2) {
    const hp = parts[look.hair.over], hg = buildHair(bodyGeo, hp ? (hp.sdf || (hp.sdf = partSdf(hp))) : null, lv ? { ...look.hair, count: Math.round((look.hair.count ?? 3000) / 3), segments: 4, width: (look.hair.width ?? 0.004) * 1.6 } : look.hair);
    if (hg) meshes.hair = new THREE.SkinnedMesh(hg, hairMaterial(look.hair));
  }
  for (const [name, sb] of Object.entries(matB)) {
    const mdef = (look.materials || {})[name] || {}, geo = sb.build();
    meshes['mat:' + name] = new THREE.SkinnedMesh(geo, mdef.kind === 'ribbon' ? ribbonMaterial(mdef) : mdef.kind === 'glow' ? glowMaterial(mdef) : skinMaterial({ ...look, ...mdef }));
  }
  // A see-through skin (look.shell) draws after everything inside it.
  if (look.shell) meshes.body.renderOrder = 2;
  for (const [name, mdef] of Object.entries(look.materials || {})) if (mdef.shell && meshes['mat:' + name]) meshes['mat:' + name].renderOrder = 2;
  for (const [k, m] of Object.entries(meshes)) { m.castShadow = k !== 'fuzz' && k !== 'hair' && !(look.shell && k === 'body'); m.receiveShadow = true; m.frustumCulled = false; root.add(m); }
  // look.light: a point light (and a soft halo sprite) on a bone, for a creature that glows.
  let glow = null;
  if (look.light && B[look.light.bone]) {
    const Lt = look.light, light = new THREE.PointLight(new THREE.Color(Lt.color || '#ffb35c'), Lt.intensity ?? 1.5, Lt.distance ?? 2, 2);
    light.position.set(...(Lt.at || [0, 0, 0])); B[Lt.bone].add(light);
    // Soft round glows are sprites (a radial gradient always facing the camera); a mesh always keeps
    // a hard silhouette. halo: a wide additive bloom for the dark. core: a tight warm glow inside the
    // body, blended normally so it reads as a gold glow in daylight as well as in the dark (premultiplying
    // a gamma-encoded gradient darkens its fringe into a grey ring on a light background).
    const sprite = (size, opacity, over, stops) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const gx = cv.getContext('2d'), gr = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
      for (const [t, c] of stops) gr.addColorStop(t, c);
      gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.SpriteMaterial({ map: tex, color: over ? 0xffffff : new THREE.Color(Lt.color || '#ffb35c'), depthWrite: false, transparent: true, opacity });
      m.blending = over ? THREE.NormalBlending : THREE.AdditiveBlending;
      const sp = new THREE.Sprite(m); sp.scale.setScalar(size); sp.position.copy(light.position); B[Lt.bone].add(sp); return sp;
    };
    if (typeof document !== 'undefined') {
      if (Lt.halo) {
        const halo = sprite(Lt.halo, Lt.haloOpacity ?? 0.6, false, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
        halo.renderOrder = 3; glow = { halo, haloScale: Lt.halo, haloOpacity: halo.material.opacity };
      }
      if (Lt.core) {
        const k = Lt.core, hot = new THREE.Color(k.heart || '#fff4dc'), warm = new THREE.Color(k.color || Lt.color || '#ffb35c');
        const rgba = (c, a) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
        const core = sprite(k.size ?? 0.2, k.opacity ?? 1, true, [[0, rgba(hot, 1)], [0.18, rgba(hot, 0.95)], [0.4, rgba(warm, 0.6)], [0.7, rgba(warm, 0.18)], [1, rgba(warm, 0)]]);
        core.renderOrder = 1; glow = { ...glow, core, coreScale: k.size ?? 0.2, coreOpacity: core.material.opacity };
      }
    }
    glow = { ...glow, light, intensity: light.intensity };
    // See-through skins glow near the light: hand each shell material the light's view-space position
    // just before it draws (look.light.shine sets how strongly, scaled by the light's current intensity).
    const g = glow, shine = Lt.shine ?? 1;
    for (const m of Object.values(meshes)) {
      const U = m.material.userData.uniforms; if (!U?.uGlowPos || !m.material.transparent) continue;
      m.onBeforeRender = (r, s, cam) => { light.getWorldPosition(U.uGlowPos.value).applyMatrix4(cam.matrixWorldInverse); U.uGlowI.value = shine * light.intensity / g.intensity; };
    }
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  for (const m of Object.values(meshes)) m.bind(skeleton);
  return { root, bones, B, skeleton, meshes, spec, stats, glow };
}

// Levels of detail that share one skeleton: level 0 owns the bones; the lower levels' meshes are
// rebound to it, so posing c.B drives every level. Returns the level-0 creature with root holding the
// bones and a THREE.LOD (c.lod) whose levels switch at `distances` (metres from the camera).
export function buildLOD(spec, distances = [0, 8, 24]) {
  const base = buildBody(spec, { lod: 0 }), lod = new THREE.LOD(), levels = [];
  distances.forEach((dist, i) => {
    const c = i ? buildBody(spec, { lod: i }) : base, g = new THREE.Group();
    for (const m of Object.values(c.meshes)) { c.root.remove(m); if (i) m.bind(base.skeleton, m.bindMatrix); g.add(m); }
    lod.addLevel(g, dist); levels.push({ group: g, meshes: c.meshes, tris: Object.values(c.meshes).reduce((n, m) => n + m.geometry.index.count / 3, 0) });
  });
  base.root.add(lod);
  return { ...base, lod, levels };
}

// Shell fuzz: copies of the fuzz-covered triangles, each layer pushed out along the normal in the shader.
function buildFuzz(src, NL) {
  const ex = src.attributes.aEx.array, idx = src.index.array, sel = [];
  const fz = (v) => ex[v * 4];
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (fz(a) + fz(b) + fz(c) > 0.06) sel.push(a, b, c); }
  if (!sel.length) return null;
  const verts = [...new Set(sel)], map = new Map(verts.map((v, i) => [v, i])), nv = verts.length;
  const A = src.attributes, Pp = A.position.array, Nn = A.normal.array, SI = A.skinIndex.array, SW = A.skinWeight.array;
  const pos = new Float32Array(nv * NL * 3), nor = new Float32Array(nv * NL * 3), si = new Uint16Array(nv * NL * 4), sw = new Float32Array(nv * NL * 4), aex = new Float32Array(nv * NL * 4), ah = new Float32Array(nv * NL), index = [];
  for (let l = 0; l < NL; l++) {
    verts.forEach((v, i) => {
      const o = l * nv + i;
      for (let k = 0; k < 3; k++) { pos[o * 3 + k] = Pp[v * 3 + k]; nor[o * 3 + k] = Nn[v * 3 + k]; }
      for (let k = 0; k < 4; k++) { si[o * 4 + k] = SI[v * 4 + k]; sw[o * 4 + k] = SW[v * 4 + k]; aex[o * 4 + k] = ex[v * 4 + k]; }
      ah[o] = (l + 1) / NL;
    });
    for (const v of sel) index.push(l * nv + map.get(v));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('aEx', new THREE.BufferAttribute(aex, 4)); g.setAttribute('aH', new THREE.BufferAttribute(ah, 1));
  g.setIndex(index);
  return g;
}

// Mirror helper for specs: a left-side joint/part/attachment list becomes left + right.
export function mirror(list, from = 'L', to = 'R') {
  const sw = (s) => (typeof s === 'string' ? s.replace(new RegExp(from + '$'), to) : s);
  const flip = (a) => (Array.isArray(a) && a.length === 3 && typeof a[0] === 'number' ? [-a[0], a[1], a[2]] : a);
  const m = (o) => {
    if (Array.isArray(o)) return o.length === 3 && typeof o[0] === 'number' ? flip(o) : o.map((x) => (typeof x === 'string' ? sw(x) : m(x)));
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? sw(v) : k === 'side' ? v : m(v)]));
    return o;
  };
  return [...list, ...list.map(m)];
}

export { lerp, smooth, clamp };
