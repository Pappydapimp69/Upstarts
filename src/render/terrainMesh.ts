import * as THREE from 'three';
import { heightAt, MAP_RADIUS } from '../sim/terrain';

export function buildTerrain(): THREE.Mesh {
  const size = MAP_RADIUS * 2 + 60;
  const seg = 220;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const low = new THREE.Color(0xb08a5e), high = new THREE.Color(0x8f6f52), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    c.copy(low).lerp(high, Math.min(1, Math.max(0, (h - 1) / 8)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}
