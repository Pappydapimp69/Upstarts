import * as THREE from 'three';
import { buildPlants, buildSkyAndLights, buildTerrain, buildWater, FOG_COLOR, setupRenderer, SUN_DIR, uTime } from './dlist/env.js';
import { daylight, sunDir, sunElevation } from '../sim/clock';
import { lerp, smooth } from '../sim/math';

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly water: THREE.Mesh[];
  private fogK = 1; // fog density multiplier from the weather
  private overcast = 0; // 0 clear .. 1 a heavy sky: dims the sun
  private ashTint = 0;
  private readonly lightDir = SUN_DIR.clone(); // toward whichever light casts shadows: the sun, or the moon at night

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.id = 'view';
    setupRenderer(this.renderer);
    parent.prepend(this.renderer.domElement);

    ({ sun: this.sun, hemi: this.hemi, skyMat: this.skyMat } = buildSkyAndLights(this.scene, this.renderer));
    buildTerrain(this.scene);
    this.water = buildWater(this.scene) as THREE.Mesh[];
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
    this.sun.position.set(x, y, z).addScaledVector(this.lightDir, 60);
  }

  // The season's pond level and the weather: denser fog, a dimmer sun, ash browning the air.
  setWeather(level: number, fog: number, overcast: number, ash: number): void {
    for (const m of this.water) m.position.y = level;
    this.fogK = fog;
    this.overcast = overcast;
    this.ashTint = ash;
  }

  // Light the valley for a time of day (seconds into the 80-minute cycle, D11).
  setTime(u: number): void {
    const s = sunDir(u), el = sunElevation(u), day = daylight(u);
    const dusk = smooth(-6, 2, el) * (1 - smooth(4, 20, el)); // the low-sun glow at dawn and dusk
    const sun = new THREE.Vector3(s.x, s.y, s.z);
    (this.skyMat.uniforms.uSun.value as THREE.Vector3).copy(sun);
    this.skyMat.uniforms.uDay.value = day;
    this.skyMat.uniforms.uDusk.value = dusk;
    // Shadows come from the sun by day and from the moon (opposite it) by night.
    const up = el > -3;
    this.lightDir.copy(up ? sun : sun.clone().negate());
    if (this.lightDir.y < 0.15) this.lightDir.y = 0.15;
    this.lightDir.normalize();
    const warm = new THREE.Color(1.0, 0.55, 0.3), noon = new THREE.Color(1.0, 0.93, 0.82), moon = new THREE.Color(0.55, 0.65, 0.9);
    this.sun.color.copy(up ? warm.lerp(noon, smooth(3, 30, el)) : moon);
    this.sun.intensity = (up ? 3.2 * smooth(-3, 12, el) : 0.35) * (1 - 0.7 * this.overcast);
    this.hemi.intensity = lerp(0.12, 0.55, day);
    this.hemi.color.setRGB(lerp(0.25, 0.55, day), lerp(0.3, 0.6, day), lerp(0.45, 0.68, day));
    const fog = (this.scene.fog as THREE.FogExp2).color;
    fog.setRGB(0.035, 0.04, 0.06).lerp(FOG_COLOR, day).lerp(new THREE.Color(0.6, 0.42, 0.3), dusk * 0.45)
      .lerp(new THREE.Color(0.42 * day + 0.04, 0.36 * day + 0.04, 0.3 * day + 0.04), this.ashTint * 0.7);
    (this.scene.fog as THREE.FogExp2).density = 0.0115 * this.fogK;
    this.renderer.toneMappingExposure = lerp(0.42, 1, day);
  }

  render(dt: number): void {
    uTime.value += dt;
    this.renderer.render(this.scene, this.camera);
  }
}
