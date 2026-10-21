import * as THREE from 'three';
import { smooth } from '../sim/math';
import { heightAt } from '../sim/terrain';
import { exposed, SMALL, type Grub, type Small, type SmallKind } from '../sim/smallprey';

// Greybox small prey: furry low-slung cynodonts and the stockier Exaeretodon, built from the same
// parts at different proportions; plus burrow mouths and grub dig sites.
class SmallMesh {
  readonly root = new THREE.Group();
  readonly legs: THREE.Object3D[] = [];
  phase = Math.random();
  px = 0; pz = 0; pyaw = 0;

  constructor(kind: SmallKind, size: number, fur: THREE.Material, dark: THREE.Material) {
    const sp = SMALL[kind];
    const L = sp.length * size, hip = sp.hip * size;
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      return m;
    };
    const body = part(new THREE.SphereGeometry(0.5, 10, 8), fur);
    body.scale.set(L * 0.42, L * 0.36, L * 0.7);
    body.position.y = hip + L * 0.1;
    this.root.add(body);
    const head = part(new THREE.SphereGeometry(0.5, 10, 8), dark);
    const hs = kind === 'exaeretodon' ? 0.42 : 0.32; // Exaeretodon: a big, deep-jawed head
    head.scale.set(L * hs * 0.8, L * hs * 0.75, L * hs * 1.2);
    head.position.set(0, hip + L * 0.16, L * 0.45);
    this.root.add(head);
    const tail = part(new THREE.ConeGeometry(L * 0.08, L * 0.5, 6), fur);
    tail.rotation.x = -Math.PI / 2 - 0.2;
    tail.position.set(0, hip + L * 0.05, -L * 0.55);
    this.root.add(tail);
    for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x * L * 0.16, hip + L * 0.05, z * L * 0.22);
      const leg = part(new THREE.CylinderGeometry(L * 0.04, L * 0.035, hip + L * 0.05, 5), dark);
      leg.position.y = -(hip + L * 0.05) / 2;
      pivot.add(leg);
      this.root.add(pivot);
      this.legs.push(pivot);
    }
  }
}

export class SmallMeshes {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, SmallMesh>();
  private readonly grubMeshes = new Map<number, THREE.Mesh>();
  private burrowsBuilt = false;
  private readonly cynFur = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 });
  private readonly cynDark = new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 1 });
  private readonly exFur = new THREE.MeshStandardMaterial({ color: 0x7a7258, roughness: 0.95 });
  private readonly exDark = new THREE.MeshStandardMaterial({ color: 0x4c4636, roughness: 0.95 });
  private readonly soil = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
  private readonly dug = new THREE.MeshStandardMaterial({ color: 0x2e2218, roughness: 1 });
  private readonly hole = new THREE.MeshBasicMaterial({ color: 0x0d0906 });

  beforeTick(ss: Small[]): void {
    for (const s of ss) {
      const m = this.meshes.get(s.id);
      if (m) {
        m.px = s.x;
        m.pz = s.z;
        m.pyaw = s.yaw;
      }
    }
  }

  private burrows(ss: Small[]): void {
    this.burrowsBuilt = true;
    const seen = new Set<string>();
    for (const s of ss) {
      if (s.kind !== 'cynodont') continue;
      const key = `${s.homeX.toFixed(2)},${s.homeZ.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const y = heightAt(s.homeX, s.homeZ);
      const mound = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.soil);
      mound.scale.set(1, 0.35, 1);
      mound.position.set(s.homeX, y - 0.02, s.homeZ);
      mound.receiveShadow = true;
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.09, 10), this.hole);
      mouth.rotation.x = -Math.PI / 2;
      mouth.position.set(s.homeX, y + 0.11, s.homeZ);
      this.group.add(mound, mouth);
    }
  }

  update(ss: Small[], grubs: Grub[], now: number, alpha: number, dt: number): void {
    if (!this.burrowsBuilt) this.burrows(ss);
    for (const s of ss) {
      let m = this.meshes.get(s.id);
      if (!m) {
        const size = s.kind === 'cynodont' ? Math.cbrt(s.mass / 0.75) : Math.cbrt(s.mass / SMALL.exaeretodon.adult);
        m = s.kind === 'cynodont' ? new SmallMesh(s.kind, size, this.cynFur, this.cynDark) : new SmallMesh(s.kind, size, this.exFur, this.exDark);
        m.px = s.x;
        m.pz = s.z;
        m.pyaw = s.yaw;
        this.meshes.set(s.id, m);
        this.group.add(m.root);
      }
      m.root.visible = exposed(s);
      if (!m.root.visible) {
        m.px = s.x;
        m.pz = s.z;
        continue;
      }
      const x = m.px + (s.x - m.px) * alpha, z = m.pz + (s.z - m.pz) * alpha;
      const yaw = m.pyaw + Math.atan2(Math.sin(s.yaw - m.pyaw), Math.cos(s.yaw - m.pyaw)) * alpha;
      m.root.position.set(x, heightAt(x, z), z);
      m.root.rotation.y = yaw;
      const stride = SMALL[s.kind].length * 0.8;
      m.phase = (m.phase + (s.speed / stride) * dt) % 1;
      const swing = 0.7 * smooth(0.03, 0.4, s.speed);
      m.legs.forEach((l, i) => {
        const diag = i === 0 || i === 3 ? 0 : 0.5;
        l.rotation.x = Math.sin((m!.phase + diag) * Math.PI * 2) * swing;
      });
    }
    // Grub sites: a little heap of loose earth, dark and flat once dug out.
    for (const g of grubs) {
      let mesh = this.grubMeshes.get(g.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), this.soil);
        mesh.position.set(g.x, heightAt(g.x, g.z) - 0.01, g.z);
        mesh.receiveShadow = true;
        this.grubMeshes.set(g.id, mesh);
        this.group.add(mesh);
      }
      const ready = g.readyAt <= now;
      mesh.material = ready ? this.soil : this.dug;
      mesh.scale.set(1, ready ? 0.5 - 0.3 * Math.min(1, g.dug) : 0.12, 1);
    }
  }
}
