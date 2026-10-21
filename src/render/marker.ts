import * as THREE from 'three';

// The objective marker: a soft light shaft standing in the world with a ring at its foot, so it never needs a
// screen projection (Brain: waypoint marker lesson; the Dlist tutorial's). It fades as you arrive.
export class Marker {
  readonly g = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private t = 0;

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#e8b46a'), transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 30, 20, 1, true), mat);
    this.beam.position.y = 15;
    this.beam.renderOrder = 4;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e8b46a'), transparent: true, opacity: 0.6, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 4;
    this.g.add(this.beam, this.ring);
    this.g.visible = false;
  }

  // at: where to stand it (null hides it); groundY: the ground there; near: the player's distance to it, m.
  update(at: { x: number; z: number } | null, groundY: number, near: number, dt: number): void {
    this.t += dt;
    this.g.visible = !!at;
    if (!at) return;
    this.g.position.set(at.x, groundY + 0.05, at.z);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = (0.06 + 0.16 * THREE.MathUtils.smoothstep(near, 3, 14)) * (0.8 + 0.2 * Math.sin(this.t * 3));
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.35 * THREE.MathUtils.smoothstep(near, 1.5, 6);
  }
}
