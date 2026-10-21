import * as THREE from 'three';
import { damp, smooth } from '../sim/math';
import { heightAt } from '../sim/terrain';
import { SAUROSUCHUS, type Sauro } from '../sim/saurosuchus';
import { animateLegs, buildSaurosuchus, type Body } from './creatures';

// Saurosuchus: the Dlist demo's procedural model (creatures.ts), animated from the sim state.
class SMesh {
  readonly b: Body = buildSaurosuchus();
  readonly root = this.b.root;
  phase = 0;
  px = 0; pz = 0; pyaw = 0;
  lowered = 0;
  sleep = 0;
  // The model is built at the 6.5 m first-pass size; the sim's animal is the scaled-back 4.1 m sub-adult.
  readonly k = SAUROSUCHUS.length / 6.5;
  constructor() {
    this.root.scale.setScalar(this.k);
  }
}

export class SauroMeshes {
  // Called on each footfall pair: position, speed, and how softly it steps (1 = normal).
  onStep: ((x: number, z: number, speed: number, quiet: number) => void) | null = null;
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, SMesh>();

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
        m = new SMesh();
        m.px = s.x;
        m.pz = s.z;
        m.pyaw = s.yaw;
        this.meshes.set(s.id, m);
        this.group.add(m.root);
      }
      const x = m.px + (s.x - m.px) * alpha, z = m.pz + (s.z - m.pz) * alpha;
      const yaw = m.pyaw + Math.atan2(Math.sin(s.yaw - m.pyaw), Math.cos(s.yaw - m.pyaw)) * alpha;
      // Low and crouched while stalking.
      m.lowered = damp(m.lowered, s.state === 'stalk' ? 1 : 0, 3, dt);
      m.sleep = damp(m.sleep, s.state === 'sleep' ? 1 : 0, s.state === 'sleep' ? 1 : 3, dt); // asleep: belly on the ground
      m.root.position.set(x, heightAt(x, z) - (m.lowered * 0.22 + m.sleep * 0.62) * m.k, z);
      m.root.rotation.y = yaw;
      const half0 = Math.floor(m.phase * 2);
      m.phase = (m.phase + (s.speed / (2.2 * m.k)) * dt) % 1; // shorter legs, quicker stride
      // Stalking, it places its feet softly.
      if (Math.floor(m.phase * 2) !== half0 && s.speed > 0.15) this.onStep?.(x, z, s.speed, s.state === 'stalk' ? 0.3 : 1);
      animateLegs(m.b, m.phase, 0.5 * smooth(0.05, 0.6, s.speed), m.sleep + 0.3 * m.lowered);
      // Jaws snap on a bite; head down to tear at a carcass.
      const snap = s.biteT < 0.4 ? Math.sin((s.biteT / 0.4) * Math.PI) : 0;
      m.b.jaw.rotation.x = snap * 0.7 + (s.state === 'eat' ? 0.25 + Math.max(0, Math.sin(performance.now() / 300)) * 0.3 : 0);
      m.b.head.rotation.x = s.state === 'eat' ? 0.45 : s.state === 'sleep' ? 0.12 * m.sleep : -snap * 0.15;
    }
    for (const [id, m] of this.meshes) {
      if (!live.has(id)) {
        this.group.remove(m.root);
        this.meshes.delete(id);
      }
    }
  }
}
