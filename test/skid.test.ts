import { describe, expect, it } from 'vitest';
import { HerreraAnimator } from '../src/render/dlist/animator.js';
import { QuadAnimator } from '../src/render/quadruped';
import { SPECIES } from '../src/sim/species';

// Foot placement (Brain: dlist E6, audited 2026-10-23): a swing foot aims where the body will be at touchdown,
// heading included, and the stance-centring offset is frozen at lift-off. Skid: how fast the landing spot still
// moves over the ground in the last fifth of the swing, recovered from the eased path
// (foot = lift + (land - lift) x smoothstep). Near zero means the foot comes down where it was aimed.
const dt = 1 / 60;
type Anim = { rigHip: number; plant(x: number, z: number, yaw: number, s: number): void; update(s: object, dt: number): void };
type Leg = { swing: boolean; liftS: number; footPos: { x: number; z: number }; liftPos: { x: number; z: number } };

function skid(make: () => Anim, id: string, v0: number, acc: number, vMax: number, yawRate: number, T: number): number {
  const an = make(), sz = SPECIES[id].hip / an.rigHip;
  const legs: Leg[] = (an as unknown as { legs?: Leg[] }).legs ?? (an as unknown as { dino: { legs: Leg[] } }).dino.legs;
  let x = -40, z = -10, yaw = 0, v = v0, worst = 0;
  an.plant(x, z, yaw, sz);
  const last: ({ x: number; z: number } | null)[] = legs.map(() => null);
  for (let t = 0; t < T; t += dt) {
    const vN = Math.min(vMax, v + acc * dt), accel = (vN - v) / dt;
    v = vN;
    yaw += yawRate * dt;
    x += Math.sin(yaw) * v * dt;
    z += Math.cos(yaw) * v * dt;
    an.update({ x, z, yaw, speed: v, accel, yawRate, act: 'none', alive: true, biteT: -1, sprinting: v > 4, size: sz, rest: 0, swim: 0, under: 0, fall: null, bodyK: 1, air: 0, crouch: 0 }, dt);
    legs.forEach((L, i) => {
      if (!L.swing || L.liftS <= 0.8) return void (last[i] = null);
      const e = L.liftS * L.liftS * (3 - 2 * L.liftS);
      const p = { x: L.liftPos.x + (L.footPos.x - L.liftPos.x) / e, z: L.liftPos.z + (L.footPos.z - L.liftPos.z) / e };
      if (last[i] && t > 1) worst = Math.max(worst, Math.hypot(p.x - last[i]!.x, p.z - last[i]!.z) / dt);
      last[i] = p;
    });
  }
  return worst;
}

const RIGS: [string, () => Anim][] = [
  ['herrerasaurus', () => new HerreraAnimator('herrerasaurus') as unknown as Anim],
  ['aetosauroides', () => new QuadAnimator('aetosauroides') as unknown as Anim],
  ['proterochampsa', () => new QuadAnimator('proterochampsa') as unknown as Anim],
];

describe('feet land where they were aimed (E6)', () => {
  for (const [id, make] of RIGS) {
    it(`${id}: no skid walking straight or turning, little while speeding up`, () => {
      expect(skid(make, id, 2, 0, 2, 0, 5)).toBeLessThan(0.01);
      expect(skid(make, id, 2, 0, 2, 1, 5)).toBeLessThan(0.05); // heading predicted: without it about omega x offset
      // Speeding up at 3 m/s^2: the centring offset is frozen at lift-off (recomputed live it was 0.15-0.22 m/s).
      // The biped's worst frame is higher (its stride period changes faster with speed); a regression guard.
      expect(skid(make, id, 0.5, 3, 9, 0, 2.5)).toBeLessThan(id === 'herrerasaurus' ? 0.2 : 0.08);
    });
  }
});
