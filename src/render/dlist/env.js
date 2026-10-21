// Environment ported from the Dlist demo (demos/skin-test): sky, lighting, textured
// terrain, water, and the Triassic plants. Kept close to the original so the two stay
// easy to compare. Trees come from the sim (src/sim/flora.ts) because they're solid.
import * as THREE from 'three';
import { clamp, lerp, smooth } from '../../sim/math';
import { fbm, vnoise } from '../../sim/noise';
import { rng } from '../../sim/rng';
import { heightAt, PONDS, SPAWNS, WATER_Y, MAP_RADIUS } from '../../sim/terrain';
import { TREES } from '../../sim/flora';
import { WIND } from '../../sim/scent';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const M4 = () => new THREE.Matrix4();
const WIND_DIR = V(WIND.x, 0, WIND.z);
export const uTime = { value: 0 };
// Midday sun near its highest point (about 80 degrees up), so shadows are short.
export const SUN_DIR = V(-0.12, 0.985, 0.13).normalize();
export const FOG_COLOR = new THREE.Color().setRGB(0.47, 0.44, 0.38);

export function setupRenderer(renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

export function buildSkyAndLights(scene, renderer) {
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0115);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uSun; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zen = vec3(0.11, 0.2, 0.36);
        vec3 hor = vec3(0.52, 0.5, 0.45);
        vec3 gnd = vec3(0.30, 0.26, 0.21);
        vec3 col = mix(hor, zen, pow(smoothstep(0.0, 1.0, max(h, 0.0)), 0.5));
        col = mix(col, gnd, smoothstep(0.0, -0.3, h));
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.9, 0.74) * (pow(s, 6.0) * 0.32 + pow(s, 900.0) * 9.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), skyMat);
  scene.add(sky);
  {
    // Environment reflections come from the same sky, so wet skin and water reflect it.
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
  }
  const hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.55, 0.6, 0.68), new THREE.Color().setRGB(0.28, 0.2, 0.13), 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.93, 0.82), 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24; sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  return { sun, sky };
}

/* ============================== textures ============================== */
function noiseTexture(size, freq, seed, lo, hi) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
  const vn = (x, z, s, period) => {
    // Tiling value noise: wrap the lattice so the texture repeats seamlessly.
    let ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const w = (i) => ((i % period) + period) % period;
    const h = (a, b) => vnoise(w(a) + 0.0, w(b) + 0.0, s);
    return lerp(lerp(h(ix, iz), h(ix + 1, iz), ux), lerp(h(ix, iz + 1), h(ix + 1, iz + 1), ux), uz);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0, a = 0.5, f = freq, n = 0;
    for (let o = 0; o < 4; o++) { s += a * vn(x / size * f, y / size * f, seed + o * 31, f); n += a; a *= 0.5; f *= 2; }
    const v = Math.round(255 * lerp(lo, hi, s / n));
    const i = (y * size + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/* ============================== terrain ============================== */
export function buildTerrain(scene) {
  const T_SIZE = MAP_RADIUS * 2 + 60, T_SEG = 300;
  const groundDetail = noiseTexture(256, 8, 3, 0.62, 1.0);
  groundDetail.colorSpace = THREE.SRGBColorSpace;
  groundDetail.repeat.set(55 * T_SIZE / 180, 55 * T_SIZE / 180);
  const groundBump = noiseTexture(256, 16, 8, 0, 1);
  groundBump.repeat.copy(groundDetail.repeat);
  const g = new THREE.PlaneGeometry(T_SIZE, T_SIZE, T_SEG, T_SEG);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const C = (h) => new THREE.Color(h);
  const cDirt = C('#7d5642'), cPale = C('#9c7e61'), cGrey = C('#8a857b'), cMoss = C('#566131'),
    cRock = C('#6f6258'), cBank = C('#45372b'), cUnder = C('#3a3325');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = p.getY(i);
    const slope = 1 - n.getY(i), r = Math.hypot(x, z);
    c.copy(cDirt).lerp(cPale, fbm(x * 0.08, z * 0.08, 21));
    // Ischigualasto is famous for red and grey badland bands; show them on the outer hills.
    c.lerp(cGrey, smooth(0.5, 0.7, fbm(x * 0.02 + 4, z * 0.02, 33)) * smooth(28, 50, r) * 0.8);
    c.lerp(cMoss, smooth(0.52, 0.68, fbm(x * 0.14, z * 0.14, 44)) * (1 - smooth(0.12, 0.3, slope)) * 0.85);
    c.lerp(cRock, smooth(0.22, 0.45, slope));
    for (const w of PONDS) {
      const dp = Math.hypot(x - w.x, z - w.z);
      if (dp < w.r + 5) c.lerp(cBank, (1 - smooth(0.0, 0.45, h - WATER_Y)) * (1 - smooth(w.r, w.r + 5, dp)));
      if (h < WATER_Y && dp < w.r + 2) c.lerp(cUnder, smooth(0, -0.4, h));
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: groundDetail, bumpMap: groundBump, bumpScale: 1.4, roughness: 0.96, metalness: 0, envMapIntensity: 0.45 });
  const terrain = new THREE.Mesh(g, m);
  terrain.receiveShadow = true;
  scene.add(terrain);
}

/* ============================== water ============================== */
export function buildWater(scene) {
  const waterMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#14241f'), roughness: 0.06, metalness: 0, transparent: true, opacity: 0.9, envMapIntensity: 0.75 });
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nuniform float uTime;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 q = vWP.xz; float t = uTime;
        vec2 gr = vec2(0.0);
        gr += vec2(cos(q.x * 1.7 + t * 1.3), cos(q.y * 1.9 - t * 1.1)) * 0.03;
        gr += vec2(cos(dot(q, vec2(0.8, 0.6)) * 3.3 + t * 2.1)) * vec2(0.8, 0.6) * 0.018;
        gr += vec2(cos(dot(q, vec2(-0.5, 0.9)) * 5.7 - t * 2.7)) * vec2(-0.5, 0.9) * 0.012;
        vec3 nW = normalize(vec3(-gr.x, 1.0, -gr.y));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`);
  };
  waterMat.customProgramCacheKey = () => 'water-v1';
  for (const W of PONDS) {
    const g = new THREE.CircleGeometry(W.r + 2, 96); g.rotateX(-Math.PI / 2);
    const w = new THREE.Mesh(g, waterMat); w.position.set(W.x, WATER_Y, W.z); w.receiveShadow = true; w.renderOrder = 2;
    scene.add(w);
  }
}

/* ============================== plants & rocks ============================== */
function mergeColored(parts) {
  const pos = [], nor = [], col = [];
  for (const { geo, color, matrix } of parts) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (matrix) g.applyMatrix4(matrix);
    g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]);
      const c = typeof color === 'function' ? color(p[i], p[i + 1], p[i + 2]) : color;
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// A fern frond: an arching rachis with a leaflet triangle on each side of every segment.
function frondTriangles(out, colOut, base, dirH, len, tilt, droop, leafScale, cA, cB) {
  const N = 12; const pts = [];
  const side = V(-dirH.z, 0, dirH.x);
  let p = base.clone(); pts.push(p.clone());
  for (let i = 1; i <= N; i++) {
    const u = i / N; const e = tilt - u * (tilt + droop);
    p = p.clone().addScaledVector(dirH, Math.cos(e) * len / N).addScaledVector(UP, Math.sin(e) * len / N);
    pts.push(p);
  }
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[i + 1]; const u = (i + 0.5) / N;
    const tan = b.clone().sub(a).normalize();
    const L = leafScale * len * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.05)), 0.6);
    const c = cA.clone().lerp(cB, u);
    for (const s of [1, -1]) {
      const tip = a.clone().lerp(b, 0.5).addScaledVector(side, s * L).addScaledVector(tan, L * 0.45).addScaledVector(UP, -L * 0.18);
      if (s > 0) out.push(a.x, a.y, a.z, b.x, b.y, b.z, tip.x, tip.y, tip.z);
      else out.push(b.x, b.y, b.z, a.x, a.y, a.z, tip.x, tip.y, tip.z);
      for (let k = 0; k < 3; k++) colOut.push(c.r, c.g, c.b);
    }
  }
}
function fernGeometry(rand, fronds, lenLo, lenHi, cA, cB, tiltLo = 0.6, droop = 0.9, leaf = 0.17) {
  const pos = [], col = [];
  for (let f = 0; f < fronds; f++) {
    const ang = (f / fronds) * Math.PI * 2 + rand() * 0.5;
    const dirH = V(Math.cos(ang), 0, Math.sin(ang));
    frondTriangles(pos, col, V(0, 0.02, 0), dirH, lerp(lenLo, lenHi, rand()), tiltLo + rand() * 0.5, droop, leaf, cA, cB);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function addWind(mat, strength, key) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 ip = vec2(0.0);
        #endif
        float sw = sin(uTime * 1.25 + ip.x * 0.31 + ip.y * 0.23) + 0.4 * sin(uTime * 2.7 + ip.x * 0.9);
        transformed.x += (sw + 0.8) * ${(strength * WIND_DIR.x).toFixed(3)} * max(position.y, 0.0);
        transformed.z += (sw + 0.8) * ${(strength * WIND_DIR.z).toFixed(3)} * max(position.y, 0.0);`);
  };
  mat.customProgramCacheKey = () => 'wind-' + key;
}
function scatter(scene, geo, mat, list, { shadow = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  im.count = list.length;
  const m = M4(), q = new THREE.Quaternion(), s = V();
  list.forEach((it, i) => {
    q.setFromEuler(new THREE.Euler(it.tx || 0, it.ry || 0, it.tz || 0));
    s.set(it.s, it.sy || it.s, it.s);
    m.compose(V(it.x, it.y, it.z), q, s);
    im.setMatrixAt(i, m);
  });
  im.castShadow = shadow; im.receiveShadow = true;
  scene.add(im);
  return im;
}

export function buildPlants(scene) {
  const R = rng(20251021);
  const ringPoint = (rMin, rMax) => { const a = R() * Math.PI * 2, r = Math.sqrt(lerp(rMin * rMin, rMax * rMax, R())); return [Math.cos(a) * r, Math.sin(a) * r]; };
  const nearSpawn = (x, z, d) => SPAWNS.some((p) => Math.hypot(x - p.x, z - p.z) < d);

  // Ferns: the main ground cover. There was no grass yet.
  const fernA = fernGeometry(rng(11), 9, 0.8, 1.25, new THREE.Color('#3b5424'), new THREE.Color('#78893f'));
  const fernB = fernGeometry(rng(12), 7, 0.6, 1.0, new THREE.Color('#465a26'), new THREE.Color('#8a8a45'), 0.8, 0.8, 0.2);
  const fernMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  addWind(fernMat, 0.045, 'fern');
  const la = [], lb = [];
  for (let i = 0; i < 2400 && la.length + lb.length < 1300; i++) {
    const [x, z] = ringPoint(3, 80);
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.12 || nearSpawn(x, z, 3)) continue;
    const clump = fbm(x * 0.09, z * 0.09, 71);
    if (R() > smooth(0.35, 0.6, clump) + 0.12) continue;
    (R() < 0.55 ? la : lb).push({ x, y: h - 0.03, z, s: lerp(0.65, 1.45, R()), ry: R() * 6.28 });
  }
  scatter(scene, fernA, fernMat, la); scatter(scene, fernB, fernMat, lb);

  // Horsetails along the pond shore.
  const stemC = new THREE.Color('#56692f'), nodeC = new THREE.Color('#2e3a1b'), coneC = new THREE.Color('#4f4a2c');
  const hParts = []; const hr = rng(13);
  for (let k = 0; k < 9; k++) {
    const ox = (hr() - 0.5) * 0.7, oz = (hr() - 0.5) * 0.7, H = lerp(1.0, 2.4, hr()), rad = lerp(0.022, 0.04, hr());
    hParts.push({ geo: new THREE.CylinderGeometry(rad * 0.8, rad, H, 6, 1, true), color: stemC, matrix: M4().makeTranslation(ox, H / 2, oz) });
    for (let y = 0.25; y < H - 0.1; y += 0.22) hParts.push({ geo: new THREE.CylinderGeometry(rad * 1.35, rad * 1.35, 0.03, 6), color: nodeC, matrix: M4().makeTranslation(ox, y, oz) });
    hParts.push({ geo: new THREE.ConeGeometry(rad * 1.5, 0.12, 6), color: coneC, matrix: M4().makeTranslation(ox, H + 0.06, oz) });
  }
  const horsetailGeo = mergeColored(hParts);
  const hMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, envMapIntensity: 0.5 });
  addWind(hMat, 0.03, 'horsetail');
  const hl = [];
  for (let i = 0; i < 400 && hl.length < 85; i++) {
    const W = PONDS[(R() * PONDS.length) | 0], a = R() * 6.28, d = lerp(W.r - 2.6, W.r + 3.2, R());
    const x = W.x + Math.cos(a) * d, z = W.z + Math.sin(a) * d;
    const h = heightAt(x, z);
    if (h < WATER_Y - 0.3 || nearSpawn(x, z, 5)) continue;
    hl.push({ x, y: h - 0.05, z, s: lerp(0.75, 1.3, R()), ry: R() * 6.28 });
  }
  scatter(scene, horsetailGeo, hMat, hl);

  // Conifers.
  const trunkC = new THREE.Color('#47332a');
  const cParts = [{ geo: new THREE.CylinderGeometry(0.2, 0.42, 9, 8), color: trunkC, matrix: M4().makeTranslation(0, 4.5, 0) }];
  const cr = rng(14);
  for (let k = 0; k < 7; k++) {
    const rad = (1 - k / 7) * 2.5 + 0.45; const cone = new THREE.ConeGeometry(rad, 2.6, 9, 1);
    const pp = cone.attributes.position;
    for (let i = 0; i < pp.count; i++) { pp.setX(i, pp.getX(i) * (0.85 + cr() * 0.3)); pp.setZ(i, pp.getZ(i) * (0.85 + cr() * 0.3)); }
    const shade = new THREE.Color('#283722').lerp(new THREE.Color('#3d4c2c'), k / 7);
    cParts.push({ geo: cone, color: shade, matrix: M4().makeTranslation(0, 4.6 + k * 1.45, 0) });
  }
  const coniferGeo = mergeColored(cParts);
  const conMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.4 });
  scatter(scene, coniferGeo, conMat, TREES.filter((t) => t.kind === 'conifer'));

  // Dicroidium: the signature seed fern of the Triassic southern continents.
  const dParts = []; const dr = rng(15);
  const dTrunkC = new THREE.Color('#4d3a2b');
  dParts.push({ geo: new THREE.CylinderGeometry(0.1, 0.16, 2.4, 7), color: dTrunkC, matrix: M4().makeTranslation(0, 1.2, 0) });
  dParts.push({ geo: new THREE.CylinderGeometry(0.07, 0.1, 1.9, 7), color: dTrunkC, matrix: M4().makeRotationZ(0.18).setPosition(-0.17, 3.2, 0) });
  const crownTop = V(-0.33, 4.1, 0);
  const crownPos = [], crownCol = [];
  for (let f = 0; f < 11; f++) {
    const ang = (f / 11) * Math.PI * 2 + dr() * 0.4;
    frondTriangles(crownPos, crownCol, crownTop.clone().add(V((dr() - 0.5) * 0.3, (dr() - 0.5) * 0.3, (dr() - 0.5) * 0.3)), V(Math.cos(ang), 0, Math.sin(ang)),
      lerp(1.5, 2.2, dr()), 0.5 + dr() * 0.4, 1.3, 0.13, new THREE.Color('#4c5d26'), new THREE.Color('#8a8f42'));
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(crownPos, 3));
  crown.setAttribute('color', new THREE.Float32BufferAttribute(crownCol, 3));
  crown.computeVertexNormals();
  const dl = TREES.filter((t) => t.kind === 'dicroidium');
  scatter(scene, mergeColored(dParts), conMat, dl);
  const crownMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  addWind(crownMat, 0.012, 'crown');
  scatter(scene, crown, crownMat, dl);

  // Rocks: red sandstone and grey mudstone. Pebbles and low stones only for now: they're
  // scenery until rocks become footing (the demo's step-up and stumble systems).
  const rockGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 0.75 + 0.5 * vnoise(x * 1.7 + 3, z * 1.7 + y, 91); p.setXYZ(i, x * k, y * k * 0.7, z * k); }
    g.computeVertexNormals(); return g; })();
  const rl = [], gr = rng(77);
  for (let i = 0; i < 600 && rl.length < 90; i++) {
    const [x, z] = ringPoint(8, 80);
    if (PONDS.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 2) || nearSpawn(x, z, 6)) continue;
    const s = lerp(0.12, 0.35, R());
    rl.push({ x, y: heightAt(x, z) - s * 0.3, z, s, ry: R() * 6.28, tx: (gr() - 0.5) * 0.3, tz: (gr() - 0.5) * 0.3 });
  }
  const rockMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6b5547'), roughness: 0.92, flatShading: true, envMapIntensity: 0.4 });
  scatter(scene, rockGeo, rockMat, rl);
  void clamp;
}
