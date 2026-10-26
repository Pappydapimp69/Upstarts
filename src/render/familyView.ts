import * as THREE from 'three';
import { damp, wrapAngle } from '../sim/math';
import { groundAt } from '../sim/ground';
import { fbm } from '../sim/noise';
import { SPECIES } from '../sim/species';
import { bodyOf } from '../sim/growth';
import { eggKg, type Mate, type Nest } from '../sim/family';
import { HerreraAnimator } from './dlist/animator.js';
import { isQuad, QuadAnimator } from './quadruped';

// Family on screen (sim/family.ts): each nest is a scrape of turned earth with its eggs in it (sized from the egg
// mass), the shells broken open once they've hatched; a mate is a full model of its species on the same animators
// the players use.
type Anim = HerreraAnimator | QuadAnimator;

export class FamilyView {
  readonly group = new THREE.Group();
  private readonly nests = new Map<number, { g: THREE.Group; eggs: THREE.Mesh[]; shells: THREE.Mesh[] }>();
  private readonly mates = new Map<number, { a: Anim; lastYaw: number; lastSpeed: number; x: number; z: number }>();
  private readonly eggGeo: THREE.SphereGeometry;
  private readonly shellGeo = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
  private readonly eggMat: THREE.MeshStandardMaterial;
  private readonly scrapeMat = new THREE.MeshStandardMaterial({ color: 0x5e4232, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });

  constructor() {
    this.eggGeo = new THREE.SphereGeometry(1, 20, 14);
    const p = this.eggGeo.attributes.position, col: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const k = 0.85 + 0.15 * fbm(p.getX(i) * 5 + 2, p.getZ(i) * 5 + p.getY(i) * 3, 41);
      col.push(0.92 * k, 0.83 * k, 0.66 * k);
    }
    this.eggGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.eggMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, envMapIntensity: 0.3 });
  }

  update(nests: Nest[], mates: Mate[], alpha: number, dt: number): void {
    void alpha;
    const seen = new Set<number>();
    for (const n of nests) {
      seen.add(n.id);
      let v = this.nests.get(n.id);
      if (!v) v = this.buildNest(n);
      v.eggs.forEach((e, i) => (e.visible = i < n.eggs));
      v.shells.forEach((e, i) => (e.visible = n.eggs === 0 && i < v!.eggs.length));
    }
    for (const [id, v] of this.nests) {
      if (!seen.has(id)) {
        this.group.remove(v.g);
        this.nests.delete(id);
      }
    }
    const live = new Set<number>();
    for (const m of mates) {
      live.add(m.id);
      let v = this.mates.get(m.id);
      if (!v) {
        const a = isQuad(m.species) ? new QuadAnimator(m.species) : new HerreraAnimator(m.species);
        v = { a, lastYaw: m.yaw, lastSpeed: 0, x: m.x, z: m.z };
        this.mates.set(m.id, v);
        this.group.add(a.root);
      }
      const sp = SPECIES[m.species], size = bodyOf(sp, 1).hip / v.a.rigHip;
      const yawRate = dt > 0 ? wrapAngle(m.yaw - v.lastYaw) / dt : 0, accel = dt > 0 ? (m.speed - v.lastSpeed) / dt : 0;
      v.lastYaw = m.yaw;
      v.lastSpeed = m.speed;
      // Smoothed between sim ticks.
      v.x = damp(v.x, m.x, 20, dt);
      v.z = damp(v.z, m.z, 20, dt);
      v.a.update({
        x: v.x, z: v.z, yaw: m.yaw, speed: m.speed, accel, yawRate, act: 'none', alive: true, biteT: -1, sprinting: false, size,
        rest: 0, swim: 0, under: 0, fall: null, air: 0, crouch: 0,
      }, dt);
    }
    for (const [id, v] of this.mates) {
      if (!live.has(id)) {
        this.group.remove(v.a.root);
        this.mates.delete(id);
      }
    }
  }

  private buildNest(n: Nest): { g: THREE.Group; eggs: THREE.Mesh[]; shells: THREE.Mesh[] } {
    const g = new THREE.Group(), y = groundAt(n.x, n.z);
    g.position.set(n.x, y, n.z);
    // Egg size from egg mass (soft, slightly elongated; density about 1.1 g/cm3).
    const kg = eggKg(SPECIES[n.species].mass), r = Math.cbrt((kg / 1100) * 3 / (4 * Math.PI * 1.3)), count = n.eggs + n.young;
    const ring = r * 2.2 * Math.sqrt(count) + 0.15;
    const scrape = new THREE.Mesh(new THREE.RingGeometry(ring * 0.3, ring * 1.25, 18).rotateX(-Math.PI / 2), this.scrapeMat);
    scrape.position.y = 0.01;
    scrape.receiveShadow = true;
    g.add(scrape);
    const eggs: THREE.Mesh[] = [], shells: THREE.Mesh[] = [];
    for (let i = 0; i < count; i++) {
      const a = i * 2.4, d = ring * 0.55 * Math.sqrt((i + 0.5) / count);
      const e = new THREE.Mesh(this.eggGeo, this.eggMat);
      e.scale.set(r, r, r * 1.3);
      e.position.set(Math.cos(a) * d, r * 0.75, Math.sin(a) * d);
      e.rotation.set(0.2, a, 0.15);
      e.castShadow = true;
      eggs.push(e);
      const s = new THREE.Mesh(this.shellGeo, this.eggMat);
      s.scale.setScalar(r);
      s.position.copy(e.position).setY(r * 0.5);
      s.rotation.set(Math.PI + 0.3 * Math.sin(a), a, 0);
      shells.push(s);
      g.add(e, s);
    }
    this.group.add(g);
    const v = { g, eggs, shells };
    this.nests.set(n.id, v);
    return v;
  }
}
