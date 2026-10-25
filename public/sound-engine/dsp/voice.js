import { Biquad } from './biquad.js';
import { Noise } from './noise.js';

const C = 343;

/**
 * Open-mouth tract: tube closed at the glottis, open at the mouth.
 * F_n = (2n - 1) c / (4 L).
 */
export function tractFormants(length, n = 5) {
  return Array.from({ length: n }, (_, i) => ((2 * i + 1) * C) / (4 * length));
}

/**
 * Highest f0 that keeps the heard F1 within 15%: the heard peak is the nearest
 * harmonic (error up to f0 / 2F1), so cap f0 at 0.3 F1; f0 at F1/2 can read
 * 20% off and a 200 Hz roar on a 0.7 m tract reads F1 at 200 Hz (dlist/E8).
 */
export const maxOpenF0 = (length) => 0.3 * tractFormants(length, 1)[0];

/**
 * Closed-mouth calls radiate through an inflated throat sac with one
 * resonance (Fletcher et al. 2004, dove coo ~600 Hz at a 35 mm sac). Scale by
 * size^-1 (wall mass ~ volume) to size^-0.5 (fixed wall thickness);
 * exponent 0.75 sits between (dlist/E16).
 */
export function sacResonance(sacDiameter, exponent = 0.75) {
  return 600 * (0.035 / sacDiameter) ** exponent;
}

/**
 * Size presets: vocal tract length and throat-sac diameter in metres.
 * Game estimates for the Dlist cast plus generic sizes.
 */
export const CREATURES = {
  small: { tract: 0.12, sac: 0.05 },
  eodromaeus: { tract: 0.2, sac: 0.08 },
  medium: { tract: 0.4, sac: 0.18 },
  herrerasaurus: { tract: 0.7, sac: 0.35 },
  large: { tract: 1.2, sac: 0.6 },
};

/**
 * Source-filter creature voice. Open mode: glottal pulses through a parallel
 * formant bank set by tract length, with f0 capped at 0.3 F1. Closed mode: no
 * formants, one sac resonance (Q ~10) with f0 locked within 10% of it, so the
 * call is a near pure tone (99% in the fundamental at resonance).
 */
export class CreatureVoice {
  // realism: opt-in voice style (per-call glottal phase, jitter and shimmer, aspiration on the open phase). Off by
  // default so the classic voice never changes under a project that didn't ask for it.
  constructor(fs, { tract = 0.7, sac = 0.35, seed = 3, realism = false } = {}) {
    this.fs = fs;
    this.realism = realism;
    this.noise = new Noise(seed);
    this.setSize(tract, sac);
    this.calls = [];
    this.phase = 0;
    this.sub = 0;
  }

  setSize(tract, sac) {
    this.tract = tract;
    this.sac = sac;
    this.formants = tractFormants(tract);
    this.bank = this.formants.map((f, i) => ({
      g: 1 / (1 + i * 0.7),
      bq: new Biquad(this.fs).bandpass(f, f / (50 + 0.06 * f)),
    }));
    this.sacFreq = sacResonance(sac);
    this.sacBq = new Biquad(this.fs).bandpass(this.sacFreq, 10);
  }

  /**
   * Start a call.
   * @param {object} o
   * @param {'open'|'closed'} [o.mode]
   * @param {number} [o.duration] seconds
   * @param {number} [o.f0] start pitch (Hz); clamped per mode
   * @param {number} [o.f0End] end pitch
   * @param {number} [o.amp]
   * @param {number} [o.roughness] 0..1 period doubling / growl
   * @param {number} [o.breath] 0..1 aspiration noise
   * @param {number} [o.jitter] 0..1 pitch wobble
   */
  call({ mode = 'open', duration = 1.2, f0, f0End, amp = 0.8, roughness = 0.3, breath = 0.15, jitter = 0.2 } = {}) {
    let a, b;
    if (mode === 'closed') {
      const lock = (x) => Math.min(this.sacFreq * 1.1, Math.max(this.sacFreq * 0.9, x ?? this.sacFreq));
      a = lock(f0); b = lock(f0End ?? a * 0.95);
    } else {
      const cap = maxOpenF0(this.tract);
      a = Math.min(f0 ?? cap * 0.8, cap);
      b = Math.min(f0End ?? a * 0.7, cap);
    }
    this.calls.push({ mode, len: Math.round(duration * this.fs), t: 0, a, b, amp, roughness, breath, jitter, wob: 0, phase: 0, sub: 0, pj: 1, sh: 1 });
  }

  get active() {
    return this.calls.length > 0;
  }

  /** Rosenberg glottal flow derivative over one period (phase 0..1). */
  static pulse(ph) {
    const tp = 0.4, tn = 0.16;
    if (ph < tp) return Math.sin((Math.PI * ph) / tp) * (Math.PI / tp) * 0.5;
    if (ph < tp + tn) return -Math.sin((Math.PI * (ph - tp)) / (2 * tn)) * (Math.PI / (2 * tn));
    return 0;
  }

  process() {
    let open = 0, closed = 0;
    const keep = [];
    for (const c of this.calls) {
      const u = c.t / c.len;
      const env = Math.min(1, u / 0.06) * Math.min(1, (1 - u) / 0.25);
      c.wob += (this.noise.bipolar() * 0.02 - c.wob * 0.001) * c.jitter;
      if (!this.realism) {
        // The classic voice: one shared glottal phase, flat breath noise.
        const f0 = (c.a * (c.b / c.a) ** u) * (1 + c.wob * 0.05);
        this.phase += f0 / this.fs;
        if (this.phase >= 1) { this.phase -= 1; this.sub ^= 1; }
        let s = CreatureVoice.pulse(this.phase) * (1 - c.roughness * 0.5 * this.sub);
        s += c.breath * this.noise.bipolar() * 0.5;
        s *= env * c.amp;
        if (c.mode === 'closed') closed += s; else open += s;
        if (++c.t < c.len) keep.push(c);
        continue;
      }
      // Each call keeps its own glottal phase. Per period: cycle-to-cycle jitter (~1-2% of the period) and shimmer
      // (~1 dB of loudness), the irregularity real voices have and a clean pulse train lacks.
      const f0 = (c.a * (c.b / c.a) ** u) * (1 + c.wob * 0.05) * c.pj;
      c.phase += f0 / this.fs;
      if (c.phase >= 1) {
        c.phase -= 1; c.sub ^= 1;
        c.pj = 1 + c.jitter * 0.015 * this.noise.bipolar();
        c.sh = 1 + c.jitter * 0.12 * this.noise.bipolar();
      }
      let s = CreatureVoice.pulse(c.phase) * (1 - c.roughness * 0.5 * c.sub) * c.sh;
      // Aspiration: turbulence through the opening glottis, so it rides the open phase and is scaled to the pulse
      // (the old flat 0.5 x noise sat ~20 dB under the pulses: breath 1 was nearly inaudible).
      s += c.breath * this.noise.bipolar() * 3 * (c.phase < 0.56 ? 1 : 0.35);
      s *= env * c.amp;
      if (c.mode === 'closed') closed += s; else open += s;
      if (++c.t < c.len) keep.push(c);
    }
    this.calls = keep;
    let y = 0;
    for (const f of this.bank) y += f.g * f.bq.process(open);
    y += this.sacBq.process(closed) * 1.5;
    return y * 0.5;
  }
}
