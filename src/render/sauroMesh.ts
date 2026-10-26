import * as THREE from 'three';
import { wrapAngle } from '../sim/math';
import type { Sauro } from '../sim/saurosuchus';
import { QuadAnimator } from './quadruped';

// Saurosuchus: a skinned model (dlist/quadModel.js SAUROSUCHUS_SPEC) on the four-legged animator the players use,
// driven from the sim state: planted feet, a spine that swings with the stride, the jaws on a bite.
class SMesh {
  readonly a = new QuadAnimator('saurosuchus');
  px = 0; pz = 0; pyaw = 0;
  lastYaw = 0;
  lastSpeed = 0;
  quiet = 1;
}

export class SauroMeshes {
  // Called on each hind footfall: position, speed, and how softly it steps (1 = normal).
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
        m.pyaw = m.lastYaw = s.yaw;
        const mm = m;
        m.a.onStep = (foot, _side, front) => {
          if (!front) this.onStep?.(foot.x, foot.z, s.speed, mm.quiet);
        };
        this.meshes.set(s.id, m);
        this.group.add(m.a.root);
      }
      const x = m.px + (s.x - m.px) * alpha, z = m.pz + (s.z - m.pz) * alpha;
      const yaw = m.pyaw + wrapAngle(s.yaw - m.pyaw) * alpha;
      const yawRate = dt > 0 ? wrapAngle(yaw - m.lastYaw) / dt : 0, accel = dt > 0 ? (s.speed - m.lastSpeed) / dt : 0;
      m.lastYaw = yaw;
      m.lastSpeed = s.speed;
      // Stalking, it places its feet softly and goes low; asleep, it lies on its belly.
      m.quiet = s.state === 'stalk' ? 0.3 : 1;
      m.a.update({
        x, z, yaw, speed: s.speed, accel, yawRate, act: s.state === 'eat' ? 'eat' : 'none', alive: s.state !== 'dead',
        biteT: s.biteT < 0.56 ? s.biteT : -1, sprinting: s.state === 'charge', size: 1,
        rest: s.state === 'sleep' ? 1 : s.state === 'stalk' ? 0.3 : 0, swim: 0, under: 0,
      }, dt);
    }
    for (const [id, m] of this.meshes) {
      if (!live.has(id)) {
        this.group.remove(m.a.root);
        this.meshes.delete(id);
      }
    }
  }
}
