import * as THREE from 'three';
import { COAT, mudFeet, wetFeet, type Coat } from '../sim/coat';
import type { Dino } from '../sim/dino';
import { groundAt, surfaceAt } from '../sim/ground';
import { MUD_Y, WATER_Y, waterDepthAt } from '../sim/terrain';
import { skinU, BANDS, BAND_H } from './dlist/herrerasaurus.js';
import { Drops, FLAKES, MUD_DROPS, WATER_DROPS } from './blood';

// The Herrerasaurus rig (a skinned mesh with height bands) or a four-legged one (its own coat shader, bodyPoint()).
type Animator = { rigHip: number; dino?: { bodyMesh: THREE.SkinnedMesh; bandVerts: number[][] }; quad?: boolean;
  setCoat?: (c: Coat, hip: number, alive: boolean) => void; bodyPoint?: (h: number, out: THREE.Vector3) => boolean };

// The player's coat made visible (the Dlist demo): the skin shader's wet and mud bands driven from the sim's coat,
// drips off wet skin, dry mud flaking off, water and mud thrown up by the feet, and tracks left by wet or muddy feet.
export class CoatView {
  readonly group = new THREE.Group();
  private readonly drips = new Drops(groundAt, { ...WATER_DROPS, ground: 0 });
  private readonly splash = new Drops((x, z) => Math.max(groundAt(x, z), waterDepthAt(x, z) > 0 ? WATER_Y : -1e9), WATER_DROPS);
  private readonly splat = new Drops((x, z) => Math.max(groundAt(x, z), MUD_Y - 0.02), MUD_DROPS);
  private readonly flakes = new Drops(groundAt, FLAKES);
  private readonly lastFlake = new Float32Array(COAT.bands);
  private flakeAcc = 0;
  private dripAcc = 0;
  private readonly prints: { x: number; z: number; y: number; yaw: number; t: number; life: number; mud: boolean; s: number; sz: number }[] = [];
  private readonly printMesh: THREE.InstancedMesh;
  private time = 0;
  private readonly v = new THREE.Vector3();

  constructor() {
    for (const d of [this.drips, this.splash, this.splat, this.flakes]) this.group.add(d.points);
    const g = new THREE.CircleGeometry(1, 10);
    g.rotateX(-Math.PI / 2);
    this.printMesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 240);
    this.printMesh.count = 0;
    this.printMesh.frustumCulled = false;
    this.group.add(this.printMesh);
  }

  // A foot comes down: water and mud fly up, and wet or muddy feet leave a track on dry ground.
  step(foot: { x: number; z: number }, d: Dino): void {
    const kind = surfaceAt(foot.x, foot.z), sz = d.body.size, v = d.speed;
    if (kind === 'water') this.splash.burst(foot.x, WATER_Y + 0.02, foot.z, 6 + Math.round(v * 3), (1.2 + v * 0.4) * Math.sqrt(sz), 0.8 * Math.sqrt(sz));
    else if (kind === 'mud') this.splat.burst(foot.x, MUD_Y + 0.02, foot.z, 4 + Math.round(v), (0.8 + 0.7 * Math.random()) * Math.sqrt(sz), 0.7 * Math.sqrt(sz), 3);
    else {
      const wet = wetFeet(d.coat) * 0.8, mud = mudFeet(d.coat);
      if (Math.max(wet, mud) > 0.12 && v > 0.3) {
        this.prints.push({ x: foot.x, z: foot.z, y: groundAt(foot.x, foot.z) + 0.008, yaw: d.yaw, t: this.time, life: mud > wet ? 90 : 30, mud: mud > wet, s: Math.min(1, Math.max(wet, mud)), sz });
        if (this.prints.length > 240) this.prints.shift();
      }
    }
  }

  update(d: Dino, a: Animator, dt: number): void {
    this.time += dt;
    const c = d.coat;
    // Shader bands are bind-pose heights on this species' rig; the coat's are fractions of the hip.
    const sample = (arr: Float32Array, b: number): number => {
      const f = (b * BAND_H) / a.rigHip / COAT.band, i = Math.min(COAT.bands - 1, Math.floor(f)), j = Math.min(COAT.bands - 1, i + 1);
      return arr[i] + (arr[j] - arr[i]) * (f - i);
    };
    if (a.setCoat) a.setCoat(c, d.body.hip, d.alive);
    else {
      for (let b = 0; b < BANDS; b++) {
        skinU.uWet.value[b] = d.alive ? sample(c.wet, b) : 0;
        skinU.uMudCover.value[b] = d.alive ? sample(c.mud, b) : 0;
        skinU.uMudDry.value[b] = sample(c.dry, b);
        skinU.uMudFlake.value[b] = sample(c.flake, b);
      }
    }

    const rigToWorld = d.body.hip / a.rigHip;
    const fromBand = (bWorld: number): boolean => {
      if (a.bodyPoint) return a.bodyPoint(bWorld * COAT.band * d.body.hip, this.v);
      const body = a.dino!.bodyMesh, bands = a.dino!.bandVerts;
      const rb = Math.round((bWorld * COAT.band * d.body.hip) / rigToWorld / BAND_H), list = bands[Math.max(0, Math.min(bands.length - 1, rb))];
      if (!list?.length) return false;
      body.getVertexPosition(list[(Math.random() * list.length) | 0], this.v);
      this.v.applyMatrix4(body.matrixWorld);
      return true;
    };
    // Drips fall from wet skin above the waterline for the first seconds out of the water.
    const wd = waterDepthAt(d.x, d.z);
    let budget = 0;
    const cand: number[] = [];
    for (let b = 0; b < COAT.bands; b++) {
      if (b * COAT.band * d.body.hip < wd) continue;
      budget += c.wet[b] * c.wet[b];
      if (c.wet[b] > 0.35) cand.push(b);
    }
    this.dripAcc += budget * 3.2 * dt * Math.min(1, d.body.size * 2);
    while (this.dripAcc >= 1 && cand.length) {
      this.dripAcc -= 1;
      if (fromBand(cand[(Math.random() * cand.length) | 0])) this.drips.spawn(this.v.x, this.v.y, this.v.z, 0, -0.2, 0, 3);
    }
    if (!cand.length) this.dripAcc = 0;
    // Dry mud flaking: as many flakes as the flaking has advanced, from the bands that are flaking.
    for (let b = 0; b < COAT.bands; b++) {
      const dF = c.flake[b] - this.lastFlake[b];
      this.lastFlake[b] = c.flake[b];
      if (dF <= 0) continue;
      this.flakeAcc += dF * 34 * Math.min(1, d.body.size * 1.5);
      while (this.flakeAcc >= 1) {
        this.flakeAcc -= 1;
        if (fromBand(b)) this.flakes.spawn(this.v.x, this.v.y, this.v.z, (Math.random() - 0.5) * 0.6 + Math.sin(d.yaw) * d.speed * 0.6, 0.2 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6 + Math.cos(d.yaw) * d.speed * 0.6, 6);
      }
    }
    for (const p of [this.drips, this.splash, this.splat, this.flakes]) p.update(dt);

    // Tracks fade by shrinking over the last quarter of their life.
    while (this.prints.length && this.time - this.prints[0].t > this.prints[0].life) this.prints.shift();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(), wetC = new THREE.Color('#3b2c20'), mudC = new THREE.Color('#1f150d');
    this.prints.forEach((p, i) => {
      const age = (this.time - p.t) / p.life, k = Math.min(1, (1 - age) / 0.25) * (0.6 + 0.4 * p.s);
      m.compose(this.v.set(p.x, p.y, p.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw), new THREE.Vector3(0.07 * p.sz * k + 0.01, 1, 0.13 * p.sz * k + 0.015));
      this.printMesh.setMatrixAt(i, m);
      this.printMesh.setColorAt(i, col.copy(p.mud ? mudC : wetC));
    });
    this.printMesh.count = this.prints.length;
    this.printMesh.instanceMatrix.needsUpdate = true;
    if (this.printMesh.instanceColor) this.printMesh.instanceColor.needsUpdate = true;
  }
}

// What the HUD says about the coat (the demo's Wet and Mud rows, in one line).
export function coatText(d: Dino): string {
  const c = d.coat, wd = waterDepthAt(d.x, d.z);
  let wet = 0, mud = 0, minDry = 1, flake = 0;
  for (let b = 0; b < COAT.bands; b++) {
    wet = Math.max(wet, c.wet[b]);
    if (c.mud[b] > 0.05) {
      mud++;
      minDry = Math.min(minDry, c.dry[b]);
      flake = Math.max(flake, c.flake[b]);
    }
  }
  const mudTxt = !mud ? '' : surfaceAt(d.x, d.z) === 'mud' ? 'Muddy, standing in the pit' : minDry < 1 ? `Wet mud, crusts in ${((1 - minDry) * COAT.crust).toFixed(0)} s`
    : flake > 0 ? `Mud flaking off, ${Math.round(flake * 100)}%` : 'Dry mud crust';
  const wetTxt = wd > 0.02 ? 'In the water' : wet > 0 ? `Wet, dry in ${(wet * COAT.dry).toFixed(0)} s` : '';
  return [wetTxt, mudTxt].filter(Boolean).join(' · ') || 'Dry';
}
