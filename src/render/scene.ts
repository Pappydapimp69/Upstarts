import * as THREE from 'three';
import { buildPlants, buildSkyAndLights, buildTerrain, buildWater, setupRenderer, SUN_DIR, uTime } from './dlist/env.js';

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  readonly sun: THREE.DirectionalLight;

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.id = 'view';
    setupRenderer(this.renderer);
    parent.prepend(this.renderer.domElement);

    ({ sun: this.sun } = buildSkyAndLights(this.scene, this.renderer));
    buildTerrain(this.scene);
    buildWater(this.scene);
    buildPlants(this.scene);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // The shadow camera follows the player, so keep it tight.
  followSun(x: number, y: number, z: number): void {
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x, y, z).addScaledVector(SUN_DIR, 60);
  }

  render(dt: number): void {
    uTime.value += dt;
    this.renderer.render(this.scene, this.camera);
  }
}
