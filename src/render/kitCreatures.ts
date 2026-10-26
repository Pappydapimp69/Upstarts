import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
// Brain's creature kit (vendored in ./body): one skinned, lofted mesh per animal instead of stacked tubes.
import { buildBody } from './body/body.js';
import { saurosuchus } from './body/specs/quadruped.js';
import { hyperodapedon, exaeretodon, smallCynodont } from './body/specs/basal.js';
import type { Body, Leg } from './creatures';

// Building a kit body bakes its occlusion and lofts every part, about half a second, so each species is
// built once (at a lighter detail level) and every animal is a clone sharing its geometry and materials.
const templates = new Map<string, THREE.Object3D>();
// unit: scale the template to unit length, for animals the game scales by their own length (the cynodonts).
function instance(spec: { name: string }, lod: number, unit = 0): THREE.Group {
  let t = templates.get(spec.name);
  if (!t) {
    const built = (buildBody(spec, { lod }) as { root: THREE.Object3D }).root;
    if (unit) {
      t = new THREE.Group();
      built.scale.setScalar(1 / unit);
      t.add(built);
    } else t = built;
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

const LEGS: Rig['legs'] = [['shoulderL', 'elbowL', true, 1], ['shoulderR', 'elbowR', true, -1], ['hipL', 'kneeL', false, 1], ['hipR', 'kneeR', false, -1]];

// Hyperodapedon from the kit's lowQuadruped (specs/basal.js), real size (about 1.6 m). Herds of about 20:
// the lightest detail level keeps the herd near 60k triangles.
export function buildKitHyperodapedon(): Body {
  return adapt(instance(hyperodapedon, 2), { head: 'head', jaw: 'jaw', tail: 'tail1', tail2: 'tail3', legs: LEGS });
}

// Cynodonts at unit length, as buildCynodont makes them: SmallMeshes scales the root by body length.
export function buildKitCynodont(kind: 'cynodont' | 'exaeretodon'): Body {
  const spec = kind === 'exaeretodon' ? exaeretodon : smallCynodont;
  // Small ones are many and tiny on screen: the lightest detail level, which also drops the fur shells.
  return adapt(instance(spec, kind === 'exaeretodon' ? 1 : 2, kind === 'exaeretodon' ? 1.666 : 0.32), { head: 'head', jaw: 'jaw', tail: 'tail1', tail2: 'tail3', legs: LEGS });
}
