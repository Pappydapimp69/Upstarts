import * as THREE from 'three';
import type { Carcass } from '../sim/world';
import type { Nest } from '../sim/nest';
import { bloodScent, type Blood } from '../sim/injury';

// Greybox carcass: a body on its side with ribs showing, shrinking as it's eaten or rots.
export class CarcassMeshes {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, THREE.Group>();
  private readonly flesh = new THREE.MeshStandardMaterial({ color: 0x7d3b2e, roughness: 0.8 });
  private readonly bone = new THREE.MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.9 });

  private build(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), this.flesh);
    body.scale.set(0.8, 0.5, 1.5);
    body.position.y = 0.25;
    body.castShadow = true;
    body.name = 'body';
    g.add(body);
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 6, 12, Math.PI), this.bone);
      rib.position.set(0, 0.25, -0.4 + i * 0.2);
      rib.castShadow = true;
      g.add(rib);
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.8, 8), this.flesh);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0.1, 0.15, -1.5);
    g.add(tail);
    return g;
  }

  // hideId: a carcass drawn by something else (the player's own body while the death screen is up).
  sync(carcasses: Carcass[], heightAt: (x: number, z: number) => number, hideId = -1): void {
    const live = new Set<number>();
    for (const c of carcasses) {
      if (c.id === hideId) continue;
      live.add(c.id);
      let g = this.meshes.get(c.id);
      if (!g) {
        g = this.build();
        g.position.set(c.x, heightAt(c.x, c.z), c.z);
        g.rotation.y = c.yaw;
        // Scale the greybox to the animal: an 80 kg Hyperodapedon is smaller than a 350 kg Herrerasaurus.
        g.scale.setScalar(Math.cbrt(Math.max(c.meat0, 10) / 140));
        this.meshes.set(c.id, g);
        this.group.add(g);
      }
      // Flesh shrinks toward the ribs as the meat goes.
      const f = Math.max(0.15, c.meat / Math.max(c.meat0, 1));
      const body = g.getObjectByName('body')!;
      body.scale.set(0.8 * (0.5 + 0.5 * f), 0.5 * f + 0.1, 1.5 * (0.7 + 0.3 * f));
    }
    for (const [id, g] of this.meshes) {
      if (!live.has(id)) {
        this.group.remove(g);
        this.meshes.delete(id);
      }
    }
  }
}

// A scraped hollow with a raised rim of mud and twigs, and the clutch in it.
export class NestMeshes {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, { g: THREE.Group; eggs: THREE.Mesh[] }>();
  private readonly mud = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
  private readonly shell = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.7 });
  private readonly rim = new THREE.TorusGeometry(0.55, 0.16, 6, 16);
  private readonly egg = new THREE.SphereGeometry(0.09, 10, 8);

  sync(nests: Nest[], heightAt: (x: number, z: number) => number): void {
    const live = new Set<number>();
    for (const n of nests) {
      live.add(n.id);
      let m = this.meshes.get(n.id);
      if (!m) {
        const g = new THREE.Group();
        const rim = new THREE.Mesh(this.rim, this.mud);
        rim.rotation.x = -Math.PI / 2;
        rim.scale.z = 0.5;
        rim.receiveShadow = true;
        g.add(rim);
        const eggs: THREE.Mesh[] = [];
        for (let i = 0; i < 8; i++) {
          const e = new THREE.Mesh(this.egg, this.shell);
          const a = (i / 8) * Math.PI * 2, r = i % 2 ? 0.22 : 0.12;
          e.position.set(Math.cos(a) * r, 0.06, Math.sin(a) * r);
          e.scale.set(1, 1.35, 1);
          e.castShadow = true;
          g.add(e);
          eggs.push(e);
        }
        g.position.set(n.x, heightAt(n.x, n.z), n.z);
        g.rotation.y = n.yaw;
        // Bigger parents, bigger nests.
        g.scale.setScalar({ herrerasaurus: 1.6, sanjuansaurus: 1.2, eodromaeus: 0.6, panphagia: 0.7 }[n.species]);
        m = { g, eggs };
        this.meshes.set(n.id, m);
        this.group.add(g);
      }
      m.eggs.forEach((e, i) => (e.visible = i < n.eggs));
    }
    for (const [id, m] of this.meshes) {
      if (!live.has(id)) {
        this.group.remove(m.g);
        this.meshes.delete(id);
      }
    }
  }
}

// Blood drops on the ground, fading as the scent goes. One instanced mesh.
export class BloodMeshes {
  private static readonly MAX = 256;
  readonly mesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.12, 8).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x5e0e0b, transparent: true, opacity: 0.8, depthWrite: false }), BloodMeshes.MAX);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor() {
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  sync(blood: Blood[], now: number, heightAt: (x: number, z: number) => number): void {
    const n = Math.min(blood.length, BloodMeshes.MAX);
    for (let i = 0; i < n; i++) {
      const b = blood[blood.length - n + i];
      const k = bloodScent(b, now) / Math.max(b.s, 1e-3);
      this.p.set(b.x, heightAt(b.x, b.z) + 0.02, b.z);
      this.s.setScalar(0.5 + b.s * (0.5 + 0.5 * k));
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
