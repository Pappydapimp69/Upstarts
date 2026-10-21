import * as THREE from 'three';
import { fbm } from '../sim/noise';
import { heightAt } from '../sim/terrain';
import type { Dino } from '../sim/dino';

// The hatch, from the Dlist tutorial: a soft, leathery egg (early dinosaur eggs were likely soft: Norell et al.
// 2020) that wobbles with each press, sheds shell scraps, and is left as a torn cup once the hatchling is out.
// Sized to the hatchling: the demo's egg was 0.39 x 0.33 x 0.6 of the curled body's length.
interface Scrap { m: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; landed: boolean }

export class EggView {
  readonly group = new THREE.Group();
  private readonly whole: THREE.Mesh;
  private readonly cup: THREE.Mesh;
  private readonly scrapGeo: THREE.BufferGeometry;
  private readonly scrapMat = new THREE.MeshStandardMaterial({ color: 0xb9a37f, roughness: 0.9, side: THREE.DoubleSide });
  private readonly scraps: Scrap[] = [];
  private owner: Dino | null = null;
  private wob = 0;
  private t = 0;
  private S = new THREE.Vector3(1, 1, 1);
  private y = 0;

  constructor() {
    const g = new THREE.SphereGeometry(1, 40, 24), p = g.attributes.position, col: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const k = 0.82 + 0.18 * fbm(p.getX(i) * 6 + 2, p.getZ(i) * 6 + p.getY(i) * 4, 41);
      col.push(0.93 * k, 0.8 * k, 0.6 * k);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.whole = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, envMapIntensity: 0.3 }));
    const cg = new THREE.SphereGeometry(1, 40, 12, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4);
    cg.setAttribute('color', new THREE.Float32BufferAttribute(col.slice(0, cg.attributes.position.count * 3), 3));
    this.cup = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    for (const m of [this.whole, this.cup]) {
      m.castShadow = m.receiveShadow = true;
      m.visible = false;
      this.group.add(m);
    }
    const shape = new THREE.Shape();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2, r = 0.5 + 0.5 * ((k * 0.618) % 1);
      if (k) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    this.scrapGeo = new THREE.ShapeGeometry(shape);
  }

  // A new life inside an egg: put a fresh egg round it and clear the last one's debris.
  place(d: Dino): void {
    this.owner = d;
    for (const s of this.scraps) this.group.remove(s.m);
    this.scraps.length = 0;
    const L = d.species.length * d.body.size;
    this.S.set(0.39 * L, 0.33 * L, 0.6 * L);
    this.y = heightAt(d.x, d.z) + this.S.y * 0.86;
    this.whole.position.set(d.x, this.y, d.z);
    this.whole.rotation.set(0, d.yaw, 0);
    this.whole.scale.copy(this.S);
    this.whole.visible = true;
    this.cup.visible = false;
  }

  // One press landed: wobble, shed scraps; on the last, burst open and leave the cup behind the hatchling.
  tear(d: Dino): void {
    this.wob = 1;
    const done = d.egg === 0, n = done ? 18 : 3, L = d.species.length * d.body.size;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, up = Math.random();
      const m = new THREE.Mesh(this.scrapGeo, this.scrapMat);
      m.castShadow = true;
      m.scale.setScalar(L * 0.1 * (0.6 + Math.random() * 0.9));
      m.position.set(d.x + Math.cos(a) * this.S.x * 0.9, this.y + (up - 0.2) * this.S.y, d.z + Math.sin(a) * this.S.z * 0.8);
      const sp = Math.sqrt(L);
      this.scraps.push({ m, landed: false, v: new THREE.Vector3(Math.cos(a) * (1 + Math.random()) * sp, (1.5 + Math.random() * 2) * sp, Math.sin(a) * (1 + Math.random()) * sp),
        spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9) });
      this.group.add(m);
    }
    if (done) {
      this.whole.visible = false;
      this.cup.visible = true;
      this.cup.scale.copy(this.S).multiplyScalar(0.6);
      const bx = d.x - Math.sin(d.yaw) * L * 0.9, bz = d.z - Math.cos(d.yaw) * L * 0.9;
      this.cup.position.set(bx, heightAt(bx, bz) + this.S.y * 0.33, bz);
      this.cup.rotation.set(-0.9, d.yaw, 0.3, 'YXZ');
    }
  }

  update(d: Dino, dt: number): void {
    if (d.egg > 0 && this.owner !== d) this.place(d);
    this.t += dt;
    if (this.whole.visible) {
      this.wob = Math.max(0, this.wob - dt * 1.6);
      const idle = 0.03 * Math.sin(this.t * 2.1) * Math.max(0, Math.sin(this.t * 0.7)); // it shifts now and then on its own
      this.whole.rotation.z = idle + this.wob * 0.16 * Math.sin(this.t * 26);
      const sq = 1 + this.wob * 0.06 * Math.sin(this.t * 30);
      this.whole.scale.set(this.S.x * sq, this.S.y / sq, this.S.z * sq);
    }
    for (const s of this.scraps) {
      if (s.landed) continue;
      s.v.y -= 9.81 * dt;
      s.v.multiplyScalar(Math.exp(-1.2 * dt));
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.spin.x * dt;
      s.m.rotation.y += s.spin.y * dt;
      const gy = heightAt(s.m.position.x, s.m.position.z) + 0.005;
      if (s.m.position.y <= gy) {
        s.m.position.y = gy;
        s.m.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28); // lies flat where it fell
        s.landed = true;
      }
    }
  }
}
