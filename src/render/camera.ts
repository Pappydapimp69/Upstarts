import * as THREE from 'three';
import { clamp, damp, lerp, smooth, wrapAngle } from '../sim/math';
import { heightAt } from '../sim/terrain';
import type { Command } from '../sim/dino';
import type { RawInput } from '../input/input';

// Third-person follow camera, tuned like the demo: orbits on the right stick or
// mouse drag, drifts back behind the animal when the player stops steering it.
// A creature's body as a capsule the camera must not end up inside or behind.
export interface Capsule {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  r: number;
}

function segDist(px: number, py: number, pz: number, c: Capsule): number {
  const dx = c.bx - c.ax, dy = c.by - c.ay, dz = c.bz - c.az;
  const L = dx * dx + dy * dy + dz * dz;
  const t = L > 0 ? clamp(((px - c.ax) * dx + (py - c.ay) * dy + (pz - c.az) * dz) / L, 0, 1) : 0;
  return Math.hypot(px - (c.ax + dx * t), py - (c.ay + dy * t), pz - (c.az + dz * t));
}

export class FollowCamera {
  yaw: number;
  pitch = 0.26;
  dist = 6.6;
  zoom = 1; // extra pull-back (framing the egg)
  private idle = 0;
  private recentering = false;
  private fov = 55;
  private readonly target = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera, dinoYaw: number, x: number, y: number, z: number) {
    this.yaw = dinoYaw + Math.PI;
    this.target.set(x, y + 1.4, z);
  }

  snapBehind(d: { x: number; y: number; z: number; yaw: number }): void {
    this.yaw = d.yaw + Math.PI;
    this.target.set(d.x, d.y + 1.4, d.z);
    this.recentering = false;
  }

  // Camera-relative stick to a world-space command.
  command(inp: RawInput): Command {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return {
      moveX: fx * inp.moveF + rx * inp.moveR,
      moveZ: fz * inp.moveF + rz * inp.moveR,
      sprint: inp.sprint,
      drink: inp.drink,
      eat: inp.eat,
      respawn: inp.confirm,
      jump: inp.confirm,
      rest: inp.rest,
      nest: inp.nest,
      call: inp.call ?? undefined,
    };
  }

  update(inp: RawInput, dt: number, dino: { x: number; y: number; z: number; yaw: number; speed: number }, size = 1, jolt = 0,
    blockers: Capsule[] = []): void {
    this.yaw -= inp.lookX * 2.5 * dt + inp.dragX * 0.005;
    this.pitch = clamp(this.pitch + inp.lookY * 1.6 * dt + inp.dragY * 0.004, -0.12, 1.05);
    if (Math.abs(inp.lookX) + Math.abs(inp.lookY) + Math.abs(inp.dragX) + Math.abs(inp.dragY) > 0.05) {
      this.idle = 0;
      this.recentering = false;
    } else this.idle += dt;
    if (inp.recenter) this.recentering = true;

    const behind = dino.yaw + Math.PI;
    const off = wrapAngle(behind - this.yaw);
    if (this.recentering) {
      this.yaw += off * (1 - Math.exp(-7 * dt));
      if (Math.abs(off) < 0.01) this.recentering = false;
    } else if (this.idle > 1.5 && dino.speed > 1.2) this.yaw += off * (1 - Math.exp(-0.7 * dt));

    this.target.x = damp(this.target.x, dino.x, 12, dt);
    this.target.z = damp(this.target.z, dino.z, 12, dt);
    this.target.y = damp(this.target.y, dino.y + 1.4 * size, 6, dt);
    // Pull in for a small animal, out for a big one.
    this.dist = damp(this.dist, 6.6 * (0.2 + 0.8 * size) * this.zoom, 1.2, dt);

    const c = this.camera;
    c.position.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist,
    );
    // Pull in in front of any big body between the camera and the player.
    const t0 = this.target;
    // A body standing on the focus point (feeding on it) can't be got in front of; ignore it.
    blockers = blockers.filter((b) => segDist(t0.x, t0.y, t0.z, b) > b.r);
    for (let i = 1; i <= 24 && blockers.length; i++) {
      const k = i / 24;
      const px = t0.x + (c.position.x - t0.x) * k, py = t0.y + (c.position.y - t0.y) * k, pz = t0.z + (c.position.z - t0.z) * k;
      if (blockers.some((b) => segDist(px, py, pz, b) < b.r)) {
        const back = Math.max(0.15, k - 0.06);
        c.position.set(t0.x + (c.position.x - t0.x) * back, t0.y + (c.position.y - t0.y) * back, t0.z + (c.position.z - t0.z) * back);
        break;
      }
    }
    // Eye floor: never down at fern height for a small animal (ZaneGPT review, Q3): 1.1 m up below a 0.5 m hip.
    const hip = size * 1.15;
    const floor = lerp(1.1, 0.45 * Math.max(size, 0.4), smooth(0.5, 0.7, hip));
    c.position.y = Math.max(c.position.y, heightAt(c.position.x, c.position.z) + floor);
    // A jolt when bitten (skipped for reduced motion).
    if (jolt > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) c.position.y -= jolt * 0.25;
    c.lookAt(this.target.x, this.target.y + 0.2, this.target.z);

    // A little FOV widening at a sprint sells the speed.
    this.fov = damp(this.fov, 55 + 7 * smooth(4.5, 7.4, dino.speed / Math.sqrt(size)), 3, dt);
    if (Math.abs(c.fov - this.fov) > 0.01) {
      c.fov = this.fov;
      c.updateProjectionMatrix();
    }
  }
}
