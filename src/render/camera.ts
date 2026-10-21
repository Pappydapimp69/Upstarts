import * as THREE from 'three';
import { clamp, damp, smooth, wrapAngle } from '../sim/math';
import { heightAt } from '../sim/terrain';
import type { Command } from '../sim/dino';
import type { RawInput } from '../input/input';

// Third-person follow camera, tuned like the demo: orbits on the right stick or
// mouse drag, drifts back behind the animal when the player stops steering it.
export class FollowCamera {
  yaw: number;
  pitch = 0.26;
  dist = 6.6;
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
    };
  }

  update(inp: RawInput, dt: number, dino: { x: number; y: number; z: number; yaw: number; speed: number }): void {
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
    this.target.y = damp(this.target.y, dino.y + 1.4, 6, dt);

    const c = this.camera;
    c.position.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist,
    );
    c.position.y = Math.max(c.position.y, heightAt(c.position.x, c.position.z) + 0.45);
    c.lookAt(this.target.x, this.target.y + 0.2, this.target.z);

    // A little FOV widening at a sprint sells the speed.
    this.fov = damp(this.fov, 55 + 7 * smooth(4.5, 7.4, dino.speed), 3, dt);
    if (Math.abs(c.fov - this.fov) > 0.01) {
      c.fov = this.fov;
      c.updateProjectionMatrix();
    }
  }
}
