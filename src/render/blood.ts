import * as THREE from 'three';

// Drops thrown about by the world (the Dlist demo's particle pools): a fixed pool of points that fly under gravity,
// land, lie a moment and fade. One pool per kind of drop: blood from bites, water splashing and dripping off a wet
// body, mud splatting, dry mud flaking. Render only; their randomness never touches the sim.
export interface DropKind {
  color: number;
  size: number; // m
  opacity: number;
  ground: number; // s a drop lies on the ground before it goes (0: gone on landing)
  count?: number;
}

export class Drops {
  readonly points: THREE.Points;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array; // s left, 0 = free
  private readonly landed: Uint8Array;
  private next = 0;

  constructor(private readonly groundAt: (x: number, z: number) => number, private readonly kind: DropKind) {
    this.n = kind.count ?? 600;
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n);
    this.landed = new Uint8Array(this.n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const m = new THREE.PointsMaterial({ color: kind.color, size: kind.size, sizeAttenuation: true, transparent: true, opacity: kind.opacity, depthWrite: false });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -999;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const i = this.next, j = i * 3;
    this.next = (this.next + 1) % this.n;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.vel[j] = vx;
    this.vel[j + 1] = vy;
    this.vel[j + 2] = vz;
    this.life[i] = life;
    this.landed[i] = 0;
  }

  // A spray along a heading (a bite): share is how bad the wound is (more drops), scale the victim's size.
  spray(x: number, y: number, z: number, yaw: number, share: number, scale = 1): void {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), n = 6 + Math.round(30 * share);
    for (let k = 0; k < n; k++) {
      const s = scale * (0.6 + Math.random() * 0.8);
      this.spawn(x, y, z, (fx * 1.2 + (Math.random() - 0.5) * 2.4) * s, (0.6 + Math.random() * 1.6) * s, (fz * 1.2 + (Math.random() - 0.5) * 2.4) * s, 1.2 + Math.random() * 0.8);
    }
  }

  // A burst thrown up all round a point (a foot coming down in water or mud).
  burst(x: number, y: number, z: number, n: number, up: number, out: number, life = 2): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, r = out * (0.3 + Math.random() * 0.7);
      this.spawn(x, y, z, Math.cos(a) * r, up * (0.6 + Math.random() * 0.8), Math.sin(a) * r, life);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const j = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -999;
        continue;
      }
      if (this.landed[i]) continue;
      const gy = this.groundAt(this.pos[j], this.pos[j + 2]) + 0.01;
      this.vel[j + 1] -= 9.81 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] <= gy) {
        this.pos[j + 1] = gy;
        this.landed[i] = 1;
        this.life[i] = Math.min(this.life[i], this.kind.ground);
        if (this.kind.ground <= 0) this.pos[j + 1] = -999;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export const BLOOD: DropKind = { color: 0x6e0f0a, size: 0.07, opacity: 0.9, ground: 1.5 };
export const WATER_DROPS: DropKind = { color: 0xcfe0e6, size: 0.04, opacity: 0.6, ground: 0, count: 800 };
export const MUD_DROPS: DropKind = { color: 0x2a1c12, size: 0.06, opacity: 0.95, ground: 3, count: 500 };
export const FLAKES: DropKind = { color: 0x7d6a55, size: 0.07, opacity: 1, ground: 6, count: 500 };
