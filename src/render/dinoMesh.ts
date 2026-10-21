import * as THREE from 'three';
import { clamp, damp, smooth } from '../sim/math';
import type { Species } from '../sim/species';

// Greybox Herrerasaurus: primitive shapes on a simple rig, enough to read
// heading, speed and gait. The procedural model from the demo replaces it in M5.
export class DinoMesh {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly tail = new THREE.Group();
  private readonly legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private phase = 0;
  private sprintBlend = 0;
  private headDown = 0;
  private sniffUp = 0;
  private dead = 0;

  constructor(private readonly sp: Species) {
    const skin = new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4e3e2e, roughness: 0.9 });
    const part = (geo: THREE.BufferGeometry, mat = skin): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      return m;
    };

    this.body.position.y = sp.hip;
    this.root.add(this.body);
    const trunk = part(new THREE.SphereGeometry(0.5, 16, 12));
    trunk.scale.set(0.75, 0.85, 1.6);
    trunk.position.z = 0.25;
    this.body.add(trunk);

    this.neck.position.set(0, 0.2, 0.95);
    this.body.add(this.neck);
    const neckMesh = part(new THREE.CylinderGeometry(0.13, 0.2, 0.75, 10));
    neckMesh.position.set(0, 0.3, 0.12);
    neckMesh.rotation.x = 0.4;
    this.neck.add(neckMesh);
    const head = part(new THREE.BoxGeometry(0.26, 0.3, 0.62), dark);
    head.position.set(0, 0.65, 0.42);
    this.neck.add(head);

    this.tail.position.set(0, 0.05, -0.55);
    this.body.add(this.tail);
    const tailMesh = part(new THREE.ConeGeometry(0.28, 2.6, 10));
    tailMesh.rotation.x = -Math.PI / 2;
    tailMesh.position.z = -1.3;
    this.tail.add(tailMesh);

    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.3, 0, 0);
      this.body.add(hip);
      const thigh = part(new THREE.CylinderGeometry(0.12, 0.09, sp.leg * 0.5, 8));
      thigh.position.y = -sp.leg * 0.25;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -sp.leg * 0.5;
      hip.add(knee);
      const shin = part(new THREE.CylinderGeometry(0.08, 0.06, sp.hip - sp.leg * 0.5 + 0.05, 8), dark);
      shin.position.y = -(sp.hip - sp.leg * 0.5) / 2;
      knee.add(shin);
      this.legs.push({ hip, knee });
    }
  }

  update(x: number, y: number, z: number, yaw: number, speed: number, accel: number, grade: number, dt: number,
    feeding = false, alive = true, biteT = 9, sniffing = false, size = 1): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.root.scale.setScalar(size);
    // Dead: its body is a carcass in the world now; hide the live model once it has fallen.
    this.root.visible = alive || this.dead < 0.95;

    // Stride from Alexander's relation (dlist/E3); one phase cycle per stride.
    const v = Math.max(speed, 0.01);
    const leg = this.sp.leg * size;
    const stride = 2.3 * leg * Math.pow((v * v) / (9.81 * leg), 0.3);
    this.phase = (this.phase + (speed / stride) * dt) % 1;
    const moving = smooth(0.05, 0.6, speed);
    const swing = 0.55 * moving * (0.6 + 0.4 * smooth(2, 7, speed));
    this.legs.forEach((l, i) => {
      const p = (this.phase + i * 0.5) * Math.PI * 2;
      l.hip.rotation.x = Math.sin(p) * swing;
      l.knee.rotation.x = -Math.max(0, Math.cos(p)) * swing * 1.4; // knee folds on the swing
    });

    // Walk-to-sprint posture (blended 2.4 to 6.6 m/s): trunk leans forward, neck levels, tail lifts.
    this.sprintBlend = damp(this.sprintBlend, smooth(2.4, 6.6, speed / Math.sqrt(size)), 4, dt);
    const s = this.sprintBlend;
    const bob = Math.abs(Math.sin(this.phase * Math.PI * 2)) * 0.04 * moving;
    this.body.position.y = this.sp.hip - 0.19 * s + bob;
    this.body.rotation.x = -0.05 * (1 - s) + 0.12 * s - clamp(grade, -0.4, 0.4) * 0.5 + clamp(accel, -4, 4) * 0.02;
    // Head down to drink or eat: the neck swings the snout to the ground ahead.
    this.headDown = damp(this.headDown, feeding ? 1 : 0, 5, dt);
    const sip = feeding ? Math.max(0, Math.sin(performance.now() / 1000 * Math.PI * 2 / 2.3)) * 0.25 : 0;
    this.neck.rotation.x = (-0.35 * (1 - s) + 0.35 * s) * (1 - this.headDown) + (1.25 - sip) * this.headDown;
    // Bite: a quick lunge of the neck down and forward. Sniff: head up into the air, short jerks.
    const lunge = biteT < 0.35 ? Math.sin((biteT / 0.35) * Math.PI) : 0;
    this.neck.rotation.x += lunge * 0.7;
    this.sniffUp = damp(this.sniffUp, sniffing ? 1 : 0, 6, dt);
    this.neck.rotation.x -= this.sniffUp * (0.35 + Math.max(0, Math.sin(performance.now() / 90)) * 0.06);
    // Dead: rolled onto its side.
    this.dead = damp(this.dead, alive ? 0 : 1, 3, dt);
    this.root.rotation.z = this.dead * Math.PI / 2;
    // Rolling 90° about the long axis swings the hip-high body out sideways to ground level;
    // lift it by the trunk's half-width so it lies on the ground, not in it.
    this.root.position.y = y + this.dead * 0.38 * size;
    this.tail.rotation.x = 0.24 * (1 - s) - 0.12 * s;
  }
}
