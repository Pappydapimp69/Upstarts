import * as THREE from 'three';
import { PONDS, WATER_Y } from '../sim/terrain';
import type { Carcass } from '../sim/world';

export function buildWater(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x5c8a96, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 });
  for (const p of PONDS) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(p.r + 2, 48), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, WATER_Y, p.z);
    g.add(m);
  }
  return g;
}

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

  sync(carcasses: Carcass[], heightAt: (x: number, z: number) => number): void {
    const live = new Set<number>();
    for (const c of carcasses) {
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
