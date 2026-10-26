import * as THREE from 'three';
import { wrapAngle } from '../sim/math';
import type { Herbivore } from '../sim/herbivore';
import { QuadAnimator } from './quadruped';

// Hyperodapedon: a skinned model (dlist/quadModel.js HYPERODAPEDON_SPEC) on the four-legged animator, driven from the
// sim state: grazing still, it crops the plants; asleep, it lies on its belly.
class HerbMesh {
  readonly a = new QuadAnimator('hyperodapedon');
  px = 0; pz = 0; pyaw = 0;
  lastYaw = 0;
  lastSpeed = 0;
}

export class HerbivoreMeshes {
  // Called on each hind footfall: position, speed, and how softly it steps (1 = normal).
  onStep: ((x: number, z: number, speed: number, quiet: number) => void) | null = null;
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, HerbMesh>();

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
        m = new HerbMesh();
        m.px = h.x;
        m.pz = h.z;
        m.pyaw = m.lastYaw = h.yaw;
        m.a.onStep = (foot, _side, front) => {
          if (!front) this.onStep?.(foot.x, foot.z, h.speed, 1);
        };
        this.meshes.set(h.id, m);
        this.group.add(m.a.root);
      }
      const x = m.px + (h.x - m.px) * alpha, z = m.pz + (h.z - m.pz) * alpha;
      const yaw = m.pyaw + wrapAngle(h.yaw - m.pyaw) * alpha;
      const yawRate = dt > 0 ? wrapAngle(yaw - m.lastYaw) / dt : 0, accel = dt > 0 ? (h.speed - m.lastSpeed) / dt : 0;
      m.lastYaw = yaw;
      m.lastSpeed = h.speed;
      m.a.update({
        x, z, yaw, speed: h.speed, accel, yawRate, act: h.state === 'graze' && h.speed < 0.2 ? 'browse' : 'none', alive: h.state !== 'dead',
        biteT: -1, sprinting: h.state === 'flee', size: 1, rest: h.state === 'sleep' ? 1 : 0, swim: 0, under: 0,
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
