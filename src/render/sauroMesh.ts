import * as THREE from 'three';
import { damp, smooth } from '../sim/math';
import { heightAt } from '../sim/terrain';
import { SAUROSUCHUS, type Sauro } from '../sim/saurosuchus';

// Greybox Saurosuchus: a long, low crocodile-line body held up on fairly erect legs,
// a deep long skull and a heavy tail. Replaced by the procedural model in M5.
class SMesh {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  readonly jaw = new THREE.Group();
  readonly legs: THREE.Object3D[] = [];
  phase = 0;
  px = 0; pz = 0; pyaw = 0;
  lowered = 0;

  constructor(skin: THREE.Material, dark: THREE.Material, belly: THREE.Material) {
    const S = { hip: 0.9 }; // modelled at the 6.5 m first-pass size, then scaled to SAUROSUCHUS.length below
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      return m;
    };
    const body = part(new THREE.SphereGeometry(0.5, 16, 10), skin);
    body.scale.set(1.1, 0.95, 2.6);
    body.position.y = S.hip + 0.1;
    this.root.add(body);
    const bellyM = part(new THREE.SphereGeometry(0.45, 12, 8), belly);
    bellyM.scale.set(1.05, 0.6, 2.4);
    bellyM.position.y = S.hip - 0.12;
    this.root.add(bellyM);
    const tail = part(new THREE.ConeGeometry(0.42, 3.2, 10), skin);
    tail.rotation.x = -Math.PI / 2 - 0.08;
    tail.position.set(0, S.hip, -2.6);
    this.root.add(tail);
    // Osteoderm ridge down the back.
    for (let i = 0; i < 9; i++) {
      const plate = part(new THREE.BoxGeometry(0.22, 0.1, 0.24), dark);
      plate.position.set(0, S.hip + 0.55 - Math.abs(i - 3) * 0.03, 1.0 - i * 0.42);
      this.root.add(plate);
    }
    this.head.position.set(0, S.hip + 0.25, 1.45);
    this.root.add(this.head);
    const neck = part(new THREE.CylinderGeometry(0.32, 0.4, 0.6, 10), skin);
    neck.rotation.x = Math.PI / 2;
    neck.position.z = 0.1;
    this.head.add(neck);
    const skull = part(new THREE.BoxGeometry(0.45, 0.42, 1.0), dark);
    skull.position.set(0, 0.06, 0.75);
    this.head.add(skull);
    const snout = part(new THREE.BoxGeometry(0.32, 0.26, 0.45), dark);
    snout.position.set(0, 0, 1.4);
    this.head.add(snout);
    this.jaw.position.set(0, -0.15, 0.35);
    this.head.add(this.jaw);
    const jawM = part(new THREE.BoxGeometry(0.36, 0.12, 1.4), belly);
    jawM.position.z = 0.7;
    this.jaw.add(jawM);
    for (const [x, z] of [[-0.48, 0.8], [0.48, 0.8], [-0.52, -0.8], [0.52, -0.8]]) {
      const hip = new THREE.Group();
      hip.position.set(x, S.hip, z);
      const leg = part(new THREE.CylinderGeometry(0.14, 0.1, S.hip, 8), dark);
      leg.position.y = -S.hip / 2;
      hip.add(leg);
      this.root.add(hip);
      this.legs.push(hip);
    }
    this.root.scale.setScalar(SAUROSUCHUS.length / 6.5);
  }
}

export class SauroMeshes {
  // Called on each footfall pair: position, speed, and how softly it steps (1 = normal).
  onStep: ((x: number, z: number, speed: number, quiet: number) => void) | null = null;
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, SMesh>();
  private readonly skin = new THREE.MeshStandardMaterial({ color: 0x5b5e3e, roughness: 0.85 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x3c3d29, roughness: 0.85 });
  private readonly belly = new THREE.MeshStandardMaterial({ color: 0x9a9168, roughness: 0.9 });

  beforeTick(ss: Sauro[]): void {
    for (const s of ss) {
      const m = this.meshes.get(s.id);
      if (m) {
        m.px = s.x;
        m.pz = s.z;
        m.pyaw = s.yaw;
      }
    }
  }

  update(ss: Sauro[], alpha: number, dt: number): void {
    const live = new Set<number>();
    for (const s of ss) {
      live.add(s.id);
      let m = this.meshes.get(s.id);
      if (!m) {
        m = new SMesh(this.skin, this.dark, this.belly);
        m.px = s.x;
        m.pz = s.z;
        m.pyaw = s.yaw;
        this.meshes.set(s.id, m);
        this.group.add(m.root);
      }
      const x = m.px + (s.x - m.px) * alpha, z = m.pz + (s.z - m.pz) * alpha;
      const yaw = m.pyaw + Math.atan2(Math.sin(s.yaw - m.pyaw), Math.cos(s.yaw - m.pyaw)) * alpha;
      // Low and crouched while stalking.
      m.lowered = damp(m.lowered, s.state === 'stalk' ? 1 : s.state === 'sleep' ? 1.7 : 0, s.state === 'sleep' ? 1 : 3, dt); // asleep: belly on the ground
      m.root.position.set(x, heightAt(x, z) - m.lowered * 0.3, z);
      m.root.rotation.y = yaw;
      const half0 = Math.floor(m.phase * 2);
      m.phase = (m.phase + (s.speed / 2.2) * dt) % 1;
      // Stalking, it places its feet softly.
      if (Math.floor(m.phase * 2) !== half0 && s.speed > 0.15) this.onStep?.(x, z, s.speed, s.state === 'stalk' ? 0.3 : 1);
      const swing = 0.55 * smooth(0.05, 0.6, s.speed);
      m.legs.forEach((l, i) => {
        const diag = i === 0 || i === 3 ? 0 : 0.5;
        l.rotation.x = Math.sin((m!.phase + diag) * Math.PI * 2) * swing;
      });
      // Jaws snap on a bite; head down to tear at a carcass.
      const snap = s.biteT < 0.4 ? Math.sin((s.biteT / 0.4) * Math.PI) : 0;
      m.jaw.rotation.x = snap * 0.7 + (s.state === 'eat' ? 0.25 + Math.max(0, Math.sin(performance.now() / 300)) * 0.3 : 0);
      m.head.rotation.x = s.state === 'eat' ? 0.45 : -snap * 0.15;
    }
    for (const [id, m] of this.meshes) {
      if (!live.has(id)) {
        this.group.remove(m.root);
        this.meshes.delete(id);
      }
    }
  }
}
