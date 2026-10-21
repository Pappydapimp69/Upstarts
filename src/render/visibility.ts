import * as THREE from 'three';

// Test metric for the fern cutout (ZaneGPT review, Q3: at least 60% of the player's pixels visible):
// draws the body in flat red with and without the rest of the scene and compares pixel counts.
const RED = new THREE.MeshBasicMaterial({ color: 0xff0000, fog: false, toneMapped: false });

export function visibleFraction(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, body: THREE.Object3D): number {
  const mine = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) mine.set(o as THREE.Mesh, (o as THREE.Mesh).material);
  });
  const gl = renderer.getContext();
  const count = (): number => {
    renderer.render(scene, camera);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 250 && px[i + 1] < 8 && px[i + 2] < 8) n++;
    return n;
  };
  for (const m of mine.keys()) m.material = RED;
  const seen = count();
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !mine.has(o as THREE.Mesh) && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  const all = count();
  for (const o of hidden) o.visible = true;
  for (const [m, mat] of mine) m.material = mat;
  return all ? seen / all : 0;
}
