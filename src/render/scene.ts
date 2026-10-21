import * as THREE from 'three';
import { buildTerrain } from './terrainMesh';

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.5);
  private readonly sunDir = new THREE.Vector3(0.3, 1, 0.2).normalize();

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    parent.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xc9d6e3);
    this.scene.fog = new THREE.Fog(0xc9d6e3, 60, 260);

    // The shadow camera follows the player, so keep it tight.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -25;
    sc.right = sc.top = 25;
    sc.far = 150;
    this.scene.add(this.sun, this.sun.target, new THREE.HemisphereLight(0xdfe9f3, 0x8a6a4a, 1.2));
    this.scene.add(buildTerrain());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  followSun(x: number, y: number, z: number): void {
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x, y, z).addScaledVector(this.sunDir, 60);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
