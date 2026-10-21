/* AudioWorklet processors. Load with
 *   await ctx.audioWorklet.addModule(new URL('./processors.js', import.meta.url))
 * All DSP lives in ../dsp so it is unit-tested outside the browser. */
import { CreatureVoice, CREATURES } from '../dsp/voice.js';
import { FootstepSynth } from '../dsp/footstep.js';
import { WaterSource } from '../dsp/bubbles.js';
import { ModalBank } from '../dsp/modal.js';
import { Spatializer } from '../dsp/spatial.js';
import { FDNReverb, ZONES } from '../dsp/fdn.js';
import { Ramp } from '../dsp/smoother.js';

/**
 * One sound source: a generator (voice | footsteps | water | modal) feeding a
 * spatializer (Doppler delay, occlusion, distance gain, pan).
 * Output 0: stereo direct. Output 1: mono reverb send.
 * Messages: {type:'spatial', p}, {type:'call', ...}, {type:'step', ...},
 * {type:'water', preset}, {type:'burst', n, energy}, {type:'strike', amp, brightness},
 * {type:'size', creature | tract, sac}, {type:'send', value}, {type:'mute'},
 * {type:'dispose'}.
 */
class SourceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    const fs = sampleRate;
    this.kind = o.kind || 'voice';
    if (this.kind === 'voice') {
      const size = CREATURES[o.creature] || { tract: o.tract ?? 0.7, sac: o.sac ?? 0.35 };
      this.gen = new CreatureVoice(fs, { ...size, seed: o.seed ?? 3 });
    } else if (this.kind === 'footsteps') {
      this.gen = new FootstepSynth(fs, o.seed ?? 7);
    } else if (this.kind === 'water') {
      this.gen = new WaterSource(fs, o.preset || 'stream', o.seed ?? 1);
    } else if (this.kind === 'modal') {
      this.gen = new ModalBank(fs, o.modes || [{ freq: 440, gain: 1 }], o.lossFactor ?? 0.01);
    }
    this.spatial = new Spatializer(fs, {
      interp: o.interp || 'lagrange4', law: o.law || 'equal-power', binaural: !!o.binaural,
      frameSamples: o.frameSamples, atmosphere: o.atmosphere,
    });
    this.send = new Ramp(o.send ?? 0.2);
    this.mute = new Ramp(1);
    this.alive = true;
    this.out = [0, 0];
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    switch (m.type) {
      case 'spatial': this.spatial.update(m.p); break;
      case 'call': this.mute.setTarget(1, 64); this.gen.call?.(m); break;
      case 'step': this.mute.setTarget(1, 64); this.gen.step?.(m); break;
      case 'water': this.gen.setPreset?.(m.preset); break;
      case 'burst': this.gen.burst?.(m.n, m.energy ?? 1); break;
      case 'strike': this.gen.strike?.(m.amp ?? 1, m.brightness ?? 0.5); break;
      case 'gain': if (this.gen) this.gen.gain = m.value; break;
      case 'size': {
        const s = CREATURES[m.creature] || m;
        this.gen.setSize?.(s.tract, s.sac);
        break;
      }
      case 'send': this.send.setTarget(m.value, 800); break;
      case 'law': this.spatial.law = m.law; this.spatial.binaural = !!m.binaural; break;
      case 'atmosphere': this.spatial.air.setAtmosphere(m.atmosphere); break;
      case 'mute': this.mute.setTarget(0, 256); break;  // stolen: fade fast, never click
      case 'unmute': this.mute.setTarget(1, 2048); break;
      case 'dispose': this.alive = false; break;
    }
  }

  process(inputs, outputs) {
    const [L, R] = outputs[0];
    const S = outputs[1] && outputs[1][0];
    const n = L.length;
    for (let i = 0; i < n; i++) {
      const x = this.gen.process() * this.mute.next();
      this.spatial.process(x, this.out);
      L[i] = this.out[0];
      if (R) R[i] = this.out[1];
      if (S) S[i] = this.spatial.send * this.send.next();   // tapped before the distance gain
    }
    return this.alive;
  }
}

/**
 * Shared FDN reverb bus: mono in, stereo out.
 * Zone changes on the same network size glide the absorption coefficients
 * (seamless); a size change runs a second network and equal-power crossfades
 * (the two are uncorrelated: linear dipped -2.2 dB, equal-power held).
 * Messages: {type:'zone', name} | {type:'decay', t60Low, t60High, size}.
 */
class ReverbProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const z = ZONES[(options.processorOptions || {}).zone] || ZONES.openPlain;
    this.a = new FDNReverb(sampleRate, z);
    this.size = z.size;
    this.b = null;
    this.fade = 0;
    this.fadeLen = Math.round(0.4 * sampleRate);
    this.oa = [0, 0];
    this.ob = [0, 0];
    this.port.onmessage = (e) => {
      const m = e.data;
      const z2 = m.type === 'zone' ? ZONES[m.name] : m.type === 'decay' ? { ...m, size: m.size ?? this.size } : null;
      if (!z2) return;
      if (Math.abs((z2.size ?? this.size) - this.size) < 1e-6) {
        this.a.glideDecay(z2.t60Low, z2.t60High);
      } else {
        if (this.b) { this.a = this.b; }           // finish any fade in progress at once
        this.b = new FDNReverb(sampleRate, z2);
        this.size = z2.size;
        this.fade = 0;
      }
    };
  }

  process(inputs, outputs) {
    const inp = inputs[0] && inputs[0][0];
    const [L, R] = outputs[0];
    for (let i = 0; i < L.length; i++) {
      const x = inp ? inp[i] : 0;
      this.a.process(this.b ? x * (this.fade < this.fadeLen ? 1 : 0) : x, this.oa);
      if (this.b) {
        this.b.process(x, this.ob);
        const u = Math.min(1, this.fade++ / this.fadeLen);
        const ga = Math.cos(u * Math.PI / 2), gb = Math.sin(u * Math.PI / 2);
        L[i] = ga * this.oa[0] + gb * this.ob[0];
        if (R) R[i] = ga * this.oa[1] + gb * this.ob[1];
        if (u >= 1) { this.a = this.b; this.b = null; }
      } else {
        L[i] = this.oa[0];
        if (R) R[i] = this.oa[1];
      }
    }
    return true;
  }
}

registerProcessor('se-source', SourceProcessor);
registerProcessor('se-reverb', ReverbProcessor);
