import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
// Brain's creature kit (vendored in ./body): one skinned, lofted mesh per animal instead of stacked tubes.
import { buildBody } from './body/body.js';
import { saurosuchus } from './body/specs/quadruped.js';
import type { Body, Leg } from './creatures';

// Building a kit body bakes its occlusion and lofts every part, about half a second, so each species is
// built once (at a lighter detail level) and every animal is a clone sharing its geometry and materials.
const templates = new Map<string, THREE.Object3D>();
function instance(spec: { name: string }, lod: number): THREE.Group {
  let t = templates.get(spec.name);
  if (!t) {
    t = (buildBody(spec, { lod }) as { root: THREE.Object3D }).root;
    templates.set(spec.name, t);
  }
  return cloneSkinned(t) as THREE.Group;
}

// The game animates a Body (hip and knee pitch per leg, tail yaw, jaw and head pitch); the kit's bones are
// Object3Ds with the same rest orientation, so they take those rotations directly.
interface Rig { head: string; jaw: string; tail: string; tail2: string; legs: [hip: string, knee: string, front: boolean, side: number][] }
function adapt(root: THREE.Group, rig: Rig): Body {
  const b = (n: string): THREE.Group => {
    const o = root.getObjectByName(n);
    if (!o) throw new Error(`kit body has no bone '${n}'`);
    return o as unknown as THREE.Group;
  };
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
  const legs: Leg[] = rig.legs.map(([hip, knee, front, side]) => ({ hip: b(hip), knee: b(knee), front, side }));
  return { root, head: b(rig.head), jaw: b(rig.jaw), tail: b(rig.tail), tail2: b(rig.tail2), legs };
}

// Saurosuchus galilei from the kit's spec (specs/quadruped.js), in the same frame and scale as the game's:
// metres, +z forward, feet at y = 0. Leg order matches buildSaurosuchus: front left, front right, hind left, hind right.
export function buildKitSaurosuchus(): Body {
  return adapt(instance(saurosuchus, 1), {
    head: 'head', jaw: 'jaw', tail: 'tail1', tail2: 'tail3',
    legs: [['shoulderL', 'elbowL', true, 1], ['shoulderR', 'elbowR', true, -1], ['hipL', 'kneeL', false, 1], ['hipR', 'kneeR', false, -1]],
  });
}
