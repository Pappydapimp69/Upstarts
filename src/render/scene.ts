import * as THREE from 'three';
import type { World } from '../sim/world';

// Draws the world. Reads sim state, never writes it.
export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    parent.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xc9d6e3);
    this.scene.fog = new THREE.Fog(0xc9d6e3, 60, 400);

    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(30, 80, 20);
    sun.castShadow = true;
    this.scene.add(sun, new THREE.HemisphereLight(0xdfe9f3, 0x8a6a4a, 1.2));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0xb08a5e, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.camera.position.set(0, 4, 10);
    this.camera.lookAt(0, 1, 0);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // alpha: fraction of the way to the next sim tick, for interpolation later.
  render(_world: World, _alpha: number): void {
    this.renderer.render(this.scene, this.camera);
  }
}
