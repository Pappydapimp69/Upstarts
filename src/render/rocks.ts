import * as THREE from 'three';
import { ROCKS, rockY, type Rock } from '../sim/ground';
import { vnoise } from '../sim/noise';

// Rocks and logs drawn from the sim's own shapes (sim/ground.ts), so a foot lands exactly on what you see.
// Rocks: one merged, flat-shaded mesh in the demo's red sandstone and grey mudstone. Logs: one instanced cylinder.
const RINGS = 9, SEGS = 28;

function rockGeometry(rocks: Rock[]): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const sand = new THREE.Color('#7a5a48'), mudstone = new THREE.Color('#6e6a62'), top = new THREE.Color('#9a7a62'), c = new THREE.Color();
  for (const k of rocks) {
    const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw);
    const grey = vnoise(k.x * 0.3, k.z * 0.3, 17) > 0.62;
    // Vertex grid: rings out from the centre, the last ring a skirt below the ground.
    const P: THREE.Vector3[][] = [];
    for (let i = 0; i <= RINGS; i++) {
      const row: THREE.Vector3[] = [];
      for (let j = 0; j < SEGS; j++) {
        const a = (j / SEGS) * Math.PI * 2, lump = 1 + k.lump * (0.5 * Math.sin(3 * a + k.seed) + 0.3 * Math.sin(5 * a + 2 * k.seed) + 0.2 * Math.sin(9 * a + 3 * k.seed));
        const t = Math.min(i, RINGS - 1) / (RINGS - 1) * 0.999;
        const u = Math.cos(a) * k.rx * lump * t, w = Math.sin(a) * k.rz * lump * t;
        const x = k.x + u * cs + w * sn, z = k.z - u * sn + w * cs;
        let y = rockY(k, x, z);
        if (!Number.isFinite(y)) y = k.base;
        if (i === RINGS) y = k.base - 0.25;
        row.push(new THREE.Vector3(x, y, z));
      }
      P.push(row);
    }
    const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3): void => {
      for (const v of [a, b, d]) {
        pos.push(v.x, v.y, v.z);
        const f = THREE.MathUtils.clamp((v.y - k.ground) / Math.max(0.1, k.h), 0, 1);
        c.copy(grey ? mudstone : sand).lerp(top, 0.35 * f).multiplyScalar(0.85 + 0.3 * vnoise(v.x * 3, v.z * 3 + v.y * 3, 23));
        col.push(c.r, c.g, c.b);
      }
    };
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const a = P[i][j], b = P[i][(j + 1) % SEGS], d = P[i + 1][j], e = P[i + 1][(j + 1) % SEGS];
        tri(a, b, d); // ring 0 is the centre point, so the first ring of quads is the cap
        tri(b, e, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildRocks(scene: THREE.Scene): void {
  const rocks = ROCKS.filter((k) => !k.log), logs = ROCKS.filter((k) => k.log);
  const rockMesh = new THREE.Mesh(rockGeometry(rocks), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true, envMapIntensity: 0.4 }));
  rockMesh.castShadow = rockMesh.receiveShadow = true;
  scene.add(rockMesh);

  // Bark: dark with lighter streaks along the grain.
  const lg = new THREE.CylinderGeometry(1, 1.04, 1, 14, 1);
  lg.rotateZ(Math.PI / 2);
  const p = lg.attributes.position, lc = new Float32Array(p.count * 3), a = new THREE.Color('#3e2c21'), b = new THREE.Color('#5a4330'), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.copy(a).lerp(b, 0.5 + 0.5 * Math.sin(Math.atan2(p.getZ(i), p.getY(i)) * 7 + p.getX(i) * 9));
    lc.set([c.r, c.g, c.b], i * 3);
  }
  lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  const im = new THREE.InstancedMesh(lg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), Math.max(1, logs.length));
  im.count = logs.length;
  im.castShadow = im.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  logs.forEach((k, i) => {
    // The sim's log axis is local u, which a three.js y-rotation by yaw maps local +x onto.
    im.setMatrixAt(i, m.compose(new THREE.Vector3(k.x, k.cy, k.z), q.setFromEuler(new THREE.Euler(0, k.yaw, 0)), new THREE.Vector3(k.len, k.rad, k.rad)));
  });
  scene.add(im);
}
