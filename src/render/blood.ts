import * as THREE from 'three';

// Blood spray from a bite (the Dlist demo's): a pool of droplets thrown along the strike, falling under gravity
// and lying on the ground a moment before they fade. Render only; its randomness never touches the sim.
const N = 600;

export class Blood {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(N * 3);
  private readonly vel = new Float32Array(N * 3);
  private readonly life = new Float32Array(N); // s left, 0 = free
  private next = 0;

  constructor(private readonly groundAt: (x: number, z: number) => number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const m = new THREE.PointsMaterial({ color: 0x6e0f0a, size: 0.05, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    for (let i = 0; i < N; i++) this.pos[i * 3 + 1] = -999;
  }

  // share: the fraction of health the bite took (more blood for a worse wound); scale: the victim's size.
  spray(x: number, y: number, z: number, yaw: number, share: number, scale = 1): void {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), n = 6 + Math.round(30 * share);
    for (let k = 0; k < n; k++) {
      const i = this.next, j = i * 3;
      this.next = (this.next + 1) % N;
      this.pos[j] = x;
      this.pos[j + 1] = y;
      this.pos[j + 2] = z;
      const s = scale * (0.6 + Math.random() * 0.8);
      this.vel[j] = (fx * 1.2 + (Math.random() - 0.5) * 2.4) * s;
      this.vel[j + 1] = (0.6 + Math.random() * 1.6) * s;
      this.vel[j + 2] = (fz * 1.2 + (Math.random() - 0.5) * 2.4) * s;
      this.life[i] = 1.2 + Math.random() * 0.8;
    }
    (this.points.material as THREE.PointsMaterial).size = 0.05 + 0.05 * Math.min(1.5, scale);
  }

  update(dt: number): void {
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      const j = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -999;
        continue;
      }
      const gy = this.groundAt(this.pos[j], this.pos[j + 2]) + 0.01;
      if (this.pos[j + 1] > gy) {
        this.vel[j + 1] -= 9.81 * dt;
        this.pos[j] += this.vel[j] * dt;
        this.pos[j + 1] = Math.max(gy, this.pos[j + 1] + this.vel[j + 1] * dt);
        this.pos[j + 2] += this.vel[j + 2] * dt;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
