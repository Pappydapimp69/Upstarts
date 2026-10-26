import * as THREE from 'three';
import type { Sky } from '../sim/weather';

// Rain streaks and drifting ash, in a box that follows the camera. One Points object per kind; the sim's
// weather says how much of each to show.
const N = 2600, BOX = 34, TOP = 18;

function points(color: number, size: number, opacity: number): THREE.Points {
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * BOX;
    pos[i * 3 + 1] = Math.random() * TOP;
    pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true }));
  p.frustumCulled = false;
  return p;
}

export class WeatherFx {
  readonly group = new THREE.Group();
  private readonly rain = points(0xb8c8d8, 0.11, 0.7);
  private readonly ash = points(0x9a948c, 0.09, 0.8);

  constructor() {
    this.group.add(this.rain, this.ash);
  }

  // amount: 0..1 of each sky (blended across a change).
  update(dt: number, at: THREE.Vector3, amount: Record<Sky, number>, t: number): void {
    this.fall(this.rain, dt, at, amount.rain, 14, 0.8, t);
    this.fall(this.ash, dt, at, amount.ash, 0.7, 0.5, t);
  }

  private fall(p: THREE.Points, dt: number, at: THREE.Vector3, k: number, speed: number, sway: number, t: number): void {
    p.visible = k > 0.01;
    if (!p.visible) return;
    (p.material as THREE.PointsMaterial).opacity = (p === this.rain ? 0.7 : 0.8) * k;
    p.geometry.setDrawRange(0, Math.floor(N * k));
    const a = p.geometry.attributes.position as THREE.BufferAttribute, v = a.array as Float32Array;
    const h = BOX / 2;
    for (let i = 0; i < N * k; i++) {
      const j = i * 3;
      v[j + 1] -= speed * dt;
      v[j] += Math.sin(t * 0.7 + i) * sway * dt;
      if (v[j + 1] < at.y - 4) v[j + 1] += TOP;
      // Wrap round the camera so the box never runs out.
      if (v[j] < at.x - h) v[j] += BOX; else if (v[j] > at.x + h) v[j] -= BOX;
      if (v[j + 2] < at.z - h) v[j + 2] += BOX; else if (v[j + 2] > at.z + h) v[j + 2] -= BOX;
    }
    a.needsUpdate = true;
  }
}
