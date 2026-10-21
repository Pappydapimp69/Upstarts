// How each playable species differs from the Herrerasaurus model: proportions (1 = Herrerasaurus) and an
// invented palette. Body plans follow the fossils loosely: Eodromaeus is a slim long-legged runner,
// Panphagia an early sauropodomorph with a long neck, small head and longer arms, Sanjuansaurus a smaller
// herrerasaurid. Colors and patterns are guesses (blueprint §2).
import * as THREE from 'three';

const C = (r, g, b) => new THREE.Vector3(r, g, b);

export const LOOKS = {
  herrerasaurus: {
    shape: {},
    palette: { back: C(0.075, 0.06, 0.042), flank: C(0.25, 0.155, 0.08), belly: C(0.5, 0.42, 0.31), stripe: 1, furA: C(0.27, 0.17, 0.09), furB: C(0.10, 0.075, 0.05) },
  },
  eodromaeus: {
    // A light, long-legged runner: tibia longer than the femur (165 vs 160 mm) and long metatarsals, a slender trunk,
    // a long low skull with big orbits, a long tail (Martinez et al. 2011).
    shape: { neck: 1.12, neckGirth: 0.72, head: 0.92, headL: 1.05, headD: 0.78, headW: 0.78, torsoL: 0.95, torsoD: 0.82, torsoW: 0.78,
      tail: 1.18, tailGirth: 0.72, legs: 1.08, femur: 0.95, tibia: 1.2, meta: 1.3, arms: 0.85 },
    palette: { back: C(0.11, 0.085, 0.055), flank: C(0.42, 0.3, 0.17), belly: C(0.62, 0.55, 0.42), stripe: 0.6, furA: C(0.45, 0.33, 0.19), furB: C(0.16, 0.12, 0.07) },
  },
  panphagia: {
    // An early sauropodomorph: a small head with a short, deep snout and leaf-shaped teeth, a long thin neck, a deep
    // gut-filled trunk, longer arms with big hands, legs less built for running (femur and tibia about equal).
    // Scaly: no filaments are known in the group.
    shape: { neck: 1.55, neckGirth: 0.55, neckTilt: 0.6, head: 0.56, headL: 0.82, headD: 1.05, headW: 1.0, torsoL: 1.12, torsoD: 1.15, torsoW: 1.1,
      tail: 1.15, tailGirth: 1.0, legs: 0.98, femur: 1.02, tibia: 0.95, meta: 0.85, arms: 1.3, fur: 0 },
    palette: { back: C(0.07, 0.08, 0.05), flank: C(0.24, 0.25, 0.13), belly: C(0.5, 0.48, 0.34), stripe: 0.4, furA: C(0.3, 0.3, 0.15), furB: C(0.1, 0.11, 0.06) },
  },
  sanjuansaurus: {
    shape: { neck: 1, head: 1.05, tail: 1, legs: 1.05, arms: 1 },
    palette: { back: C(0.06, 0.06, 0.06), flank: C(0.2, 0.17, 0.14), belly: C(0.48, 0.44, 0.38), stripe: 1.3, furA: C(0.22, 0.19, 0.15), furB: C(0.07, 0.065, 0.06) },
  },
};
