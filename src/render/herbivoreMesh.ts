import * as THREE from 'three';
import { damp, smooth } from '../sim/math';
import { heightAt } from '../sim/terrain';
import type { Herbivore } from '../sim/herbivore';
import { animateLegs, buildHyperodapedon, type Body } from './creatures';

// Hyperodapedon: procedural rhynchosaur (creatures.ts), animated from the sim state.
class HerbMesh {
  readonly b: Body = buildHyperodapedon();
  readonly root = this.b.root;
  phase = Math.random();
  headUp = 0;
  sleep = 0; // 0 standing .. 1 lying asleep
  // Interpolation between ticks.
  px = 0; pz = 0; pyaw = 0;
}

export class HerbivoreMeshes {
  // Called on each footfall pair: position, speed, and how softly it steps (1 = normal).
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
        m.pyaw = h.yaw;
        this.meshes.set(h.id, m);
        this.group.add(m.root);
      }
      const x = m.px + (h.x - m.px) * alpha, z = m.pz + (h.z - m.pz) * alpha;
      const yaw = m.pyaw + Math.atan2(Math.sin(h.yaw - m.pyaw), Math.cos(h.yaw - m.pyaw)) * alpha;
      m.sleep = damp(m.sleep, h.state === 'sleep' ? 1 : 0, h.state === 'sleep' ? 1 : 4, dt);
      m.root.position.set(x, heightAt(x, z) - m.sleep * 0.24, z);
      m.root.rotation.y = yaw;
      // Sprawling diagonal gait: legs swing in diagonal pairs.
      const half0 = Math.floor(m.phase * 2);
      m.phase = (m.phase + (h.speed / 0.9) * dt) % 1;
      if (Math.floor(m.phase * 2) !== half0 && h.speed > 0.15) this.onStep?.(x, z, h.speed, 1);
      animateLegs(m.b, m.phase, 0.6 * smooth(0.05, 0.5, h.speed), m.sleep);
      // Head down to crop plants while grazing and still, up when alert or running.
      const down = h.state === 'graze' && h.speed < 0.2 ? 1 : 0;
      m.headUp = damp(m.headUp, h.state === 'alert' ? -1 : down, 6, dt);
      const nibble = down ? Math.sin(performance.now() / 180 + h.id) * 0.08 : 0;
      m.b.head.rotation.x = m.headUp * 0.5 + nibble + m.sleep * 0.3;
      m.b.jaw.rotation.x = down ? Math.max(0, Math.sin(performance.now() / 160 + h.id)) * 0.18 : 0; // cropping
    }
    for (const [id, m] of this.meshes) {
      if (!live.has(id)) {
        this.group.remove(m.root);
        this.meshes.delete(id);
      }
    }
  }
}
