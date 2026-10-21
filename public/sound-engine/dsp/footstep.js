import { Noise } from './noise.js';
import { Biquad } from './biquad.js';
import { surfaceBank } from './modal.js';
import { WaterSource } from './bubbles.js';
import { effectiveModulus, hertzContactTime, MODULI } from './contact.js';

/**
 * Footsteps from physics (dlist/E17). Each step has two parts:
 *  - the pad impact: a half-sine force pulse of Hertz contact time
 *    tc ~ M^0.33 v^-0.2, low-passed contact noise riding on it. Heavier is
 *    darker; sprinting only a little brighter. Ground hardness barely moves
 *    tc under a soft pad, except mud.
 *  - the surface's own response: modes for stone/wood (rung by claw clicks),
 *    debris grains for dirt/sand, slow suction for mud, bubbles for water.
 */
export const SURFACES = ['packedDirt', 'sand', 'sandstone', 'wood', 'mud', 'water'];

export class FootstepSynth {
  constructor(fs, seed = 7) {
    this.fs = fs;
    this.noise = new Noise(seed);
    this.events = [];
    this.banks = {
      sandstone: surfaceBank(fs, 'sandstone'),
      wood: surfaceBank(fs, 'wood'),
    };
    this.water = new WaterSource(fs, 'splash', seed + 1);
    this.mudBubbles = new WaterSource(fs, { rate: 0, gamma: 1, minRadius: 0.004, maxRadius: 0.012, rising: 0.3 }, seed + 2);
    this.lp = new Biquad(fs).lowpass(400);
    this.debrisBp = new Biquad(fs).bandpass(3000, 0.8);
    this.suctionLp = new Biquad(fs).lowpass(500);
  }

  /**
   * @param {object} o
   * @param {number} o.mass body mass (kg)
   * @param {number} o.speed walking/running speed (m/s)
   * @param {string} o.surface one of SURFACES
   * @param {boolean} [o.claws] hard claws touch the ground
   * @param {number} [o.gain] overall level
   * @param {number} [o.delay] seconds from now
   */
  step({ mass, speed, surface = 'packedDirt', claws = false, gain = 1, delay = 0 }) {
    const footMass = 0.2 * mass;
    const radius = 0.02 * Math.cbrt(mass);
    const impactV = 0.3 + 0.25 * speed;            // foot strike speed grows with gait speed
    const ground = MODULI[surface] ?? MODULI.packedDirt;
    const tc = hertzContactTime(footMass, impactV, radius, effectiveModulus(MODULI.pad, ground));
    const level = gain * Math.min(1, Math.log10(1 + footMass * impactV) / 2.5);
    const start = Math.round(delay * this.fs);
    this.events.push({ kind: 'pad', at: start, len: Math.round(tc * this.fs), level, t: 0 });
    this.lp.lowpass(Math.min(2000, 4 / tc));

    if (claws && (surface === 'sandstone' || surface === 'wood')) {
      const tcc = hertzContactTime(footMass * 0.05, impactV, 0.002, effectiveModulus(MODULI.claw, ground));
      const brightness = Math.min(1, 0.0008 / tcc);
      for (let k = 0; k < 3; k++) {
        this.events.push({ kind: 'claw', at: start + Math.round((0.004 + 0.006 * k) * this.fs), level: level * 0.4, brightness, surface, t: 0 });
      }
    } else if (surface === 'sandstone' || surface === 'wood') {
      this.events.push({ kind: 'claw', at: start, level: level * 0.12, brightness: 0.15, surface, t: 0 });
    }
    if (surface === 'packedDirt' || surface === 'sand') {
      const grains = Math.round(6 + 10 * speed * (surface === 'sand' ? 1.6 : 1));
      for (let k = 0; k < grains; k++) {
        const dt = (0.002 + this.noise.uniform() * (surface === 'sand' ? 0.09 : 0.05)) * this.fs;
        this.events.push({ kind: 'grain', at: start + Math.round(dt), len: Math.round(0.002 * this.fs), level: level * 0.25 * this.noise.uniform(), t: 0 });
      }
    }
    if (surface === 'mud') {
      this.events.push({ kind: 'suction', at: start + Math.round(0.06 * this.fs), len: Math.round(0.25 * this.fs), level: level * 0.5, t: 0 });
      this.events.push({ kind: 'mudpop', at: start + Math.round(0.18 * this.fs), level, n: 1 + Math.round(2 * this.noise.uniform()), t: 0 });
    }
    if (surface === 'water') {
      this.events.push({ kind: 'splash', at: start, level, n: Math.round(10 + 40 * Math.min(1, footMass * impactV / 40)), t: 0 });
    }
  }

  process() {
    let y = 0;
    let padIn = 0, grainIn = 0, suctionIn = 0;
    const keep = [];
    for (const e of this.events) {
      if (e.at > 0) { e.at--; keep.push(e); continue; }
      switch (e.kind) {
        case 'pad': {
          const ph = e.t / e.len;
          padIn += e.level * Math.sin(Math.PI * ph) * (0.6 + 0.4 * this.noise.bipolar());
          if (++e.t < e.len) keep.push(e);
          break;
        }
        case 'grain':
          grainIn += e.level * this.noise.bipolar() * (1 - e.t / e.len);
          if (++e.t < e.len) keep.push(e);
          break;
        case 'suction': {
          const ph = e.t / e.len;
          suctionIn += e.level * this.noise.bipolar() * Math.sin(Math.PI * ph) ** 2;
          if (++e.t < e.len) keep.push(e);
          break;
        }
        case 'claw':
          this.banks[e.surface].strike(e.level, e.brightness);
          break;
        case 'splash':
          this.water.burst(e.n, e.level);
          break;
        case 'mudpop':
          this.mudBubbles.burst(e.n, e.level * 0.6);
          break;
      }
    }
    this.events = keep;
    y += this.lp.process(padIn) * 2;
    y += this.debrisBp.process(grainIn);
    y += this.suctionLp.process(suctionIn);
    y += (this.banks.sandstone.process() + this.banks.wood.process()) * 0.3;
    y += this.water.process() * 0.3 + this.mudBubbles.process() * 0.3;
    return y;
  }
}
