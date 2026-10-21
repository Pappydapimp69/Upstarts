import * as THREE from 'three';
import { damp, smooth } from '../sim/math';
import { heightAt } from '../sim/terrain';
import { HYPERODAPEDON, type Herbivore } from '../sim/herbivore';

// Greybox Hyperodapedon: a low, barrel-bodied four-legged reptile with a broad
// triangular head and a hooked beak. Replaced by the procedural model in M5.
class HerbMesh {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  readonly legs: THREE.Object3D[] = [];
  phase = Math.random();
  headUp = 0;
  // Interpolation between ticks.
  px = 0; pz = 0; pyaw = 0;
  cx = 0; cz = 0; cyaw = 0;

  constructor(skin: THREE.Material, dark: THREE.Material, beak: THREE.Material) {
    const sp = HYPERODAPEDON;
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      return m;
    };
    const body = part(new THREE.SphereGeometry(0.3, 12, 8), skin);
    body.scale.set(1.15, 0.85, 1.6);
    body.position.y = sp.hip + 0.05;
    this.root.add(body);
    const tail = part(new THREE.ConeGeometry(0.16, 0.8, 8), skin);
    tail.rotation.x = -Math.PI / 2 - 0.15;
    tail.position.set(0, sp.hip, -0.8);
    this.root.add(tail);
    this.head.position.set(0, sp.hip + 0.12, 0.5);
    this.root.add(this.head);
    const skull = part(new THREE.ConeGeometry(0.2, 0.36, 3), dark);
    skull.rotation.set(Math.PI / 2, 0, 0); // tip forward: broad at the back, narrowing to the beak
    skull.scale.set(1.2, 1, 0.7);
    skull.position.z = 0.16;
    this.head.add(skull);
    const bk = part(new THREE.ConeGeometry(0.05, 0.14, 6), beak);
    bk.rotation.x = Math.PI;
    bk.position.set(0, -0.06, 0.34);
    this.head.add(bk);
    for (const [x, z] of [[-0.28, 0.3], [0.28, 0.3], [-0.3, -0.3], [0.3, -0.3]]) {
      const hip = new THREE.Group();
      hip.position.set(x, sp.hip, z);
      const leg = part(new THREE.CylinderGeometry(0.06, 0.05, sp.hip, 6), dark);
      leg.position.y = -sp.hip / 2;
      hip.add(leg);
      this.root.add(hip);
      this.legs.push(hip);
    }
  }
}

export class HerbivoreMeshes {
  // Called on each footfall pair: position, speed, and how softly it steps (1 = normal).
  onStep: ((x: number, z: number, speed: number, quiet: number) => void) | null = null;
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, HerbMesh>();
  private readonly skin = new THREE.MeshStandardMaterial({ color: 0x8c8460, roughness: 0.9 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x5e5840, roughness: 0.9 });
  private readonly beak = new THREE.MeshStandardMaterial({ color: 0x2d2a22, roughness: 0.6 });

  // Called once per sim tick, before stepping, to keep the previous pose for interpolation.
  beforeTick(hs: Herbivore[]): void {
    for (const h of hs) {
      const m = this.meshes.get(h.id);
      if (m) {
        m.px = h.x;
        m.pz = h.z;
        m.pyaw = h.yaw;
      }
    }
  }

  update(hs: Herbivore[], alpha: number, dt: number): void {
    const live = new Set<number>();
    for (const h of hs) {
      live.add(h.id);
      let m = this.meshes.get(h.id);
      if (!m) {
        m = new HerbMesh(this.skin, this.dark, this.beak);
        m.px = h.x;
        m.pz = h.z;
        m.pyaw = h.yaw;
        this.meshes.set(h.id, m);
        this.group.add(m.root);
      }
      const x = m.px + (h.x - m.px) * alpha, z = m.pz + (h.z - m.pz) * alpha;
      const yaw = m.pyaw + Math.atan2(Math.sin(h.yaw - m.pyaw), Math.cos(h.yaw - m.pyaw)) * alpha;
      m.root.position.set(x, heightAt(x, z), z);
      m.root.rotation.y = yaw;
      // Sprawling diagonal gait: legs swing in diagonal pairs.
      const half0 = Math.floor(m.phase * 2);
      m.phase = (m.phase + (h.speed / 0.9) * dt) % 1;
      if (Math.floor(m.phase * 2) !== half0 && h.speed > 0.15) this.onStep?.(x, z, h.speed, 1);
      const swing = 0.6 * smooth(0.05, 0.5, h.speed);
      m.legs.forEach((l, i) => {
        const diag = i === 0 || i === 3 ? 0 : 0.5;
        l.rotation.x = Math.sin((m!.phase + diag) * Math.PI * 2) * swing;
      });
      // Head down to crop plants while grazing and still, up when alert or running.
      const down = h.state === 'graze' && h.speed < 0.2 ? 1 : 0;
      m.headUp = damp(m.headUp, h.state === 'alert' ? -1 : down, 6, dt);
      const nibble = down ? Math.sin(performance.now() / 180 + h.id) * 0.08 : 0;
      m.head.rotation.x = m.headUp * 0.5 + nibble;
    }
    for (const [id, m] of this.meshes) {
      if (!live.has(id)) {
        this.group.remove(m.root);
        this.meshes.delete(id);
      }
    }
  }
}
