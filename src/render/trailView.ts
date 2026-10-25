import * as THREE from 'three';
import { groundAt } from '../sim/ground';
import { TRAIL, type Trails } from '../sim/trails';

// Trails on the ground (sim/trails.ts), as the Dlist tutorial drew them: small gold marks for a living animal's
// scent, shown only while you sniff and for a few seconds after; red drops for blood, always there (blood is
// visible), glowing brighter while you sniff and darkening as they dry. Fresher marks are bigger.
const REVEAL = 5; // s the scent marks stay lit after the nose comes up
const GOLD = new THREE.Color('#ffc54a');
const RED = new THREE.Color('#8c0b06'), DRY = new THREE.Color('#2e0d07');

export class TrailView {
  readonly group = new THREE.Group();
  private readonly scent: THREE.InstancedMesh;
  private readonly blood: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private reveal = 0;
  private refresh = 0;

  constructor() {
    const disc = new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2);
    this.scent = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), TRAIL.max);
    this.blood = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), TRAIL.max);
    for (const k of [this.scent, this.blood]) {
      k.count = 0;
      k.frustumCulled = false;
      k.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(k);
    }
  }

  // sniffing: the player has its nose down this frame.
  update(tr: Trails, now: number, sniffing: boolean, dt: number): void {
    const was = this.reveal;
    this.reveal = sniffing ? Math.min(1, this.reveal + dt * 4) : Math.max(0, this.reveal - dt / REVEAL);
    this.refresh -= dt;
    if (this.refresh > 0 && Math.abs(this.reveal - was) < 1e-4) return;
    this.refresh = 0.25;
    let ns = 0, nb = 0;
    for (const k of tr.marks) {
      const age = now - k.t;
      if (k.kind === 'scent') {
        if (this.reveal <= 0.01) continue;
        const f = 1 - age / TRAIL.scentLife;
        this.place(this.scent, ns, k.x, k.z, 0.05 + 0.05 * f);
        this.scent.setColorAt(ns++, this.c.copy(GOLD).multiplyScalar(f * this.reveal));
      } else {
        const f = 1 - age / TRAIL.bloodLife;
        this.place(this.blood, nb, k.x, k.z, 0.04 + 0.05 * f);
        this.c.copy(DRY).lerp(RED, f).multiplyScalar(1 + 1.6 * this.reveal);
        this.blood.setColorAt(nb++, this.c);
      }
    }
    for (const [k, n] of [[this.scent, ns], [this.blood, nb]] as const) {
      k.count = n;
      k.instanceMatrix.needsUpdate = true;
      if (k.instanceColor) k.instanceColor.needsUpdate = true;
    }
  }

  private place(k: THREE.InstancedMesh, i: number, x: number, z: number, r: number): void {
    this.m.makeScale(r, 1, r).setPosition(x, groundAt(x, z) + 0.012, z);
    k.setMatrixAt(i, this.m);
  }
}
