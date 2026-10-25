// Audio layer, ported from the Dlist demo's createAudioLayer. It plays sound events through the
// vendored procedural engine (public/sound-engine; every sound is synthesized, D8) and never feeds
// anything back into the sim. Variation comes from its own seeded RNG (Brain: sound-engine/E7).
// Engine plane is top-down: world x -> x, world z -> y, height -> z.
import { rng } from '../sim/rng';
import { lerp } from '../sim/math';
import type { SoundEvent } from '../sim/events';
import { CALLS, type CallStyle } from '../sim/calls';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Src = any;
type Pos = { x: number; y: number; z: number };

export type Surface = 'packedDirt' | 'sand' | 'sandstone' | 'wood' | 'mud' | 'water';

// dB at 1 m: 62 for an adult walking at 3.4 m/s, +10 dB per tenfold mass, +4.5 dB per doubling of impact speed.
export const STEP_DB = (mass: number, speed: number): number => 62 + 10 * Math.log10(mass / 350) + 15 * Math.log10(Math.max(speed, 0.3) / 3.4);

const audioRng = rng(0xa0d10);
// The sim's surfaces as the engine's footstep materials.
const ENGINE_SURFACE: Record<NonNullable<SoundEvent['surface']>, Surface> = { water: 'water', mud: 'mud', rock: 'sandstone', log: 'wood', dirt: 'packedDirt' };
const vary = (db: number): number => 10 ** (((audioRng() * 2 - 1) * db) / 20);

export class AudioLayer {
  private ctx: AudioContext | null = null;
  private engine: any = null;
  private S: Record<string, Src> = {};
  private herdFeet: Src[] = [];
  private herdNext = 0;
  private later: { at: number; run: () => void }[] = [];
  failed: unknown = null;
  out: AudioNode | null = null; // final stereo output, after the left/right fix
  onState: () => void = () => {};

  get live(): boolean {
    return !!(this.engine && this.ctx && this.ctx.state === 'running');
  }
  get status(): 'on' | 'starting' | 'waiting' | 'failed' {
    if (this.failed) return 'failed';
    if (this.live) return 'on';
    return this.ctx ? 'starting' : 'waiting';
  }

  // Call from inside a user gesture (key, click, tap; a controller press where the browser allows it):
  // the AudioContext has to be made and resumed right there, or Safari and iOS keep it silent.
  start(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return;
    }
    const C = window.AudioContext || (window as any).webkitAudioContext;
    if (!C) return;
    try {
      // Phones get a bigger audio buffer: the smallest one leaves no slack, and a late block is a crackle.
      this.ctx = new C({ latencyHint: matchMedia('(pointer: coarse)').matches ? 'balanced' : 'interactive' });
    } catch {
      return;
    }
    const ctx = this.ctx!;
    ctx.onstatechange = () => this.onState();
    ctx.resume().catch(() => {});
    this.load(ctx).catch((e) => {
      this.failed = e;
      console.warn('sound engine', e);
    }).finally(() => this.onState());
    this.onState();
  }

  private async load(ctx: AudioContext): Promise<void> {
    const url = new URL('sound-engine/index.js', document.baseURI).href;
    const { SoundEngine } = await import(/* @vite-ignore */ url);
    const device = matchMedia('(pointer: coarse)').matches ? 'unknown' : 'headphones';
    const engine = await SoundEngine.create({ context: ctx, zone: 'openPlain', device });
    // Three.js seen from above is mirrored against the engine plane (facing +z, +x is on the LEFT; facing +y in
    // the engine, +x is on the right), so with x -> x, z -> y every pan comes out reversed. Swap the channels once
    // at the output: level and interaural timing swap together, so the cues stay consistent (Dlist PORTING.md).
    const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 }), merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    engine.limiter.disconnect();
    engine.limiter.connect(split);
    split.connect(merge, 0, 1);
    split.connect(merge, 1, 0);
    merge.connect(ctx.destination);
    this.out = merge;
    // Wind bed: low-passed brown noise straight to the output (a bed, not an event).
    const len = ctx.sampleRate * 2, bb = ctx.createBuffer(1, len, ctx.sampleRate), b = bb.getChannelData(0);
    let l = 0;
    for (let i = 0; i < len; i++) {
      l = (l + 0.02 * (audioRng() * 2 - 1)) / 1.02;
      b[i] = l * 3.5;
    }
    const wind = new AudioBufferSourceNode(ctx, { buffer: bb, loop: true });
    wind.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 420 })).connect(new GainNode(ctx, { gain: 0.12 })).connect(ctx.destination);
    wind.start();

    const S = this.S;
    S.voice = engine.createSource('voice', { realism: true, creature: 'herrerasaurus', priority: 20, level: 100, seed: 11 });
    S.feet = engine.createSource('footsteps', { priority: 6, seed: 12 });
    // Teeth meeting: a hard, heavily damped click (many inharmonic modes, ~10 ms ring), not a ringing block.
    S.jaw = engine.createSource('modal', { modes: [1800, 2650, 3300, 4700, 6100, 6900, 9100].map((freq, i) => ({ freq, gain: 1 / (1 + 0.4 * i) })), lossFactor: 0.12, level: 88, priority: 8, seed: 13 });
    S.mouth = engine.createSource('water', { preset: 'splash', level: 52, seed: 14 });
    // Drops falling from the jaws back into the pond: single bubbles whose pitch rises as they surface.
    S.drips = engine.createSource('water', { preset: { rate: 0, gamma: 1, minRadius: 0.0015, maxRadius: 0.004, rising: 1 }, level: 45, seed: 19 });
    // Swallowing: water moving down the throat, big low bubbles, heard through the neck (muffled by occlusion).
    S.throat = engine.createSource('water', { preset: { rate: 0, gamma: 1.5, minRadius: 0.004, maxRadius: 0.014, rising: 0.2 }, level: 50, seed: 20 });
    S.nose = engine.createSource('voice', { realism: true, tract: 0.06, sac: 0.05, level: 54, seed: 15 }); // nostrils: short tube, resonances from 1.4 kHz up
    S.crunch = engine.createSource('footsteps', { level: 60, seed: 16 }); // tearing meat at the mouth
    S.prey = engine.createSource('voice', { realism: true, tract: 0.12, sac: 0.06, level: 74, priority: 8, seed: 17 }); // Hyperodapedon
    S.sauro = engine.createSource('voice', { realism: true, creature: 'large', level: 104, priority: 18, seed: 18 });
    S.sauroFeet = engine.createSource('footsteps', { priority: 9, seed: 21 });
    S.sauroJaw = engine.createSource('modal', { modes: [900, 1400, 2100, 3300, 4400].map((freq, i) => ({ freq, gain: 1 / (1 + 0.4 * i) })), lossFactor: 0.1, level: 96, priority: 9, seed: 22 });
    S.hit = engine.createSource('footsteps', { priority: 8, seed: 23 });
    for (let i = 0; i < 4; i++) this.herdFeet.push(engine.createSource('footsteps', { priority: 3, seed: 30 + i }));
    this.engine = engine;
  }

  private at(src: Src, p: Pos): void {
    src.setPosition(p.x, p.z, p.y);
  }

  // Footfalls, from the client's animators. mic: extra mix gain for your own small feet (only the mix,
  // never what animals hear).
  step(who: 'player' | 'prey' | 'saurosuchus', p: Pos, mass: number, speed: number, surface: Surface, mic = 1): void {
    if (!this.live) return;
    const src = who === 'player' ? this.S.feet : who === 'saurosuchus' ? this.S.sauroFeet : this.herdFeet[this.herdNext++ % this.herdFeet.length];
    this.at(src, p);
    src.step({ mass, speed, surface, claws: who !== 'prey', gain: mic * vary(1.5) });
  }

  // Mouth and body sounds from the player's animator.
  body(kind: 'lap' | 'drip' | 'gulp' | 'sniff' | 'tear' | 'thud', p: Pos, mass: number): void {
    if (!this.live) return;
    const S = this.S, now = this.ctx!.currentTime;
    switch (kind) {
      case 'lap':
        this.at(S.mouth, p);
        S.mouth.splash(16 + Math.round(10 * audioRng()), 0.35);
        break;
      case 'drip': {
        this.at(S.drips, p);
        const n = 3 + Math.round(3 * audioRng());
        for (let k = 0; k < n; k++) this.later.push({ at: now + 0.05 + 0.5 * audioRng(), run: () => S.drips.splash(1, 1.6 + 1.6 * audioRng()) });
        break;
      }
      case 'gulp':
        this.at(S.throat, p);
        S.throat.setOcclusion(0.3);
        S.throat.splash(4 + Math.round(3 * audioRng()), 1.2);
        this.later.push({ at: now + 0.09, run: () => S.throat.splash(3, 0.8) });
        break;
      // A sniff is breath noise through the nasal passage, no voicing: a 4 Hz "pitch" leaves only the aspiration.
      case 'sniff':
        this.at(S.nose, p);
        S.nose.call({ mode: 'open', duration: 0.07, f0: 4, f0End: 4, amp: 1.4, breath: 1, roughness: 0, jitter: 0 });
        break;
      // Tearing meat: wet suction as it pulls, with gristle crackle.
      case 'tear':
        this.at(S.crunch, p);
        S.crunch.step({ mass: 3, speed: 2, surface: 'mud', claws: false, gain: 1.2 });
        S.crunch.step({ mass: 1, speed: 2, surface: 'packedDirt', claws: false, gain: 0.6, delay: 0.04 });
        break;
      case 'thud':
        this.at(S.feet, p);
        S.feet.step({ mass: mass * 3, speed: 4, surface: 'packedDirt', claws: false, gain: 1.4 });
        break;
    }
  }

  // Sim events: bites, hits, calls. tract: the player's vocal tract length (m), for its call pitch.
  play(ev: SoundEvent, tract: number): void {
    if (!this.live) return;
    const S = this.S;
    switch (ev.kind) {
      // Footfall events are for hearing; their sound is played in time with the animated feet instead.
      case 'step':
        break;
      case 'bite': {
        const src = ev.who === 'saurosuchus' ? S.sauroJaw : S.jaw;
        this.at(src, ev);
        src.strike(12 * vary(1), ev.who === 'saurosuchus' ? 0.6 : 0.85);
        break;
      }
      // A skid is stick-slip: a dense run of tiny contacts as the foot drags (Dlist demo). Grit on dirt, claw scrapes on
      // rock, suction in mud, bubbles in water, slowing and fading as it catches.
      case 'skid': {
        this.at(S.feet, ev);
        const dur = ev.dur ?? 0.3, n = Math.max(6, Math.round(dur * 55)), surface = ENGINE_SURFACE[ev.surface ?? 'dirt'];
        for (let k = 0; k < n; k++) {
          const u = k / n;
          S.feet.step({ mass: (ev.mass ?? 350) * 0.06, speed: 0.3 + 0.5 * (1 - u), surface, claws: true, gain: 0.5 * (1 - u) ** 0.6 * (0.6 + 0.4 * audioRng()), delay: u * dur + 0.006 * audioRng() });
        }
        break;
      }
      // The body hitting the ground in a fall: one heavy, soft contact.
      case 'thud':
        this.at(S.feet, ev);
        S.feet.step({ mass: (ev.mass ?? 350) * 3, speed: 4, surface: ENGINE_SURFACE[ev.surface ?? 'dirt'], claws: false, gain: 1.4 });
        break;
      // Claws scraping up an edge after a short leap.
      case 'scramble': {
        this.at(S.feet, ev);
        const surface = ev.surface === 'dirt' || !ev.surface ? 'sandstone' : ENGINE_SURFACE[ev.surface];
        for (let k = 0; k < 3; k++) S.feet.step({ mass: (ev.mass ?? 350) * 0.6, speed: 2, surface, claws: true, gain: 0.6, delay: 0.07 * k });
        break;
      }
      // A bite landing: a wet blow (suction and a soft heavy contact) at the bite point.
      case 'hit': {
        const share = ev.share ?? 0.3;
        this.at(S.hit, ev);
        S.hit.step({ mass: 20 + 60 * share, speed: 3, surface: 'mud', claws: false, gain: 0.9 + share });
        S.hit.step({ mass: 2, speed: 2, surface: 'packedDirt', claws: false, gain: 0.5, delay: 0.03 });
        break;
      }
      case 'call': {
        if (ev.call === 'squeak') {
          this.at(S.prey, ev);
          const f0 = 380 * (0.9 + 0.2 * audioRng());
          S.prey.call({ mode: 'open', duration: 0.22, f0, f0End: f0 * 0.7, roughness: 0.6, breath: 0.5, jitter: 1, amp: 1 });
        } else if (ev.call === 'growl') {
          this.at(S.sauro, ev);
          S.sauro.call({ mode: 'open', duration: 0.9 * (0.9 + 0.2 * audioRng()), roughness: 0.95, breath: 0.25, jitter: 0.6, amp: 2.2 });
        } else if (ev.call && ev.call in CALLS) {
          this.playerCall(ev.call as CallStyle, ev, tract);
        }
        break;
      }
    }
  }

  // A call from the table (Dlist demo). Pitch is a fraction of the tract's highest clean open-mouth pitch
  // (0.3 F1, Brain: dlist E8), so it scales from adult to hatchling. No two calls on exactly the same pitch.
  private playerCall(style: CallStyle, ev: SoundEvent, tract: number): void {
    const S = this.S, c = CALLS[style];
    this.at(S.voice, ev);
    const vp = c.f0abs ? 1 : 0.94 + 0.12 * audioRng();
    const cap = (0.3 * 343) / (4 * tract);
    const f0 = c.f0abs ?? (c.f0k ? cap * c.f0k * vp : undefined);
    const o: Record<string, unknown> = { mode: c.mode, duration: c.duration * (0.92 + 0.16 * audioRng()), roughness: c.roughness ?? 0.3,
      amp: c.amp, breath: c.breath ?? 0.15, jitter: c.jitter ?? 0.2,
      ...(f0 ? { f0, f0End: c.f0abs ?? (c.f0Endk ? cap * c.f0Endk * vp : f0 * 0.75) } : {}) };
    S.voice.call(o);
    // Animals repeat a note a little lower and never on an exact beat; a fixed +12% second note read as a cartoon.
    if ((c.notes ?? 1) > 1) {
      const k = 0.88 + 0.1 * audioRng();
      this.later.push({ at: this.ctx!.currentTime + (c.gap ?? 0.3) * (0.8 + 0.4 * audioRng()), run: () => S.voice.call({ ...o,
        duration: (o.duration as number) * (0.8 + 0.3 * audioRng()), ...(f0 ? { f0: (o.f0 as number) * k, f0End: (o.f0End as number) * k } : {}) }) });
    }
  }

  // Once per rendered frame: listener at the camera, facing along it; voices follow their animals.
  update(cam: Pos, camYaw: number, mouth: Pos, sauro: Pos | null, tract: number): void {
    if (!this.live) return;
    const e = this.engine, S = this.S;
    // The camera looks toward -(sin yaw, cos yaw) in world x/z, which is (x, y) on the engine plane.
    e.setListener({ x: cam.x, y: cam.z, z: cam.y, yaw: Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)) });
    for (const s of [S.voice, S.jaw, S.mouth, S.nose, S.crunch, S.throat]) this.at(s, mouth);
    if (sauro) for (const s of [S.sauro, S.sauroFeet, S.sauroJaw]) this.at(s, sauro);
    if (Math.abs(tract - (S.voice._tract ?? 0)) > 0.02) {
      S.voice._tract = tract;
      S.voice.node.port.postMessage({ type: 'size', tract, sac: tract / 2 }); // grows with the animal
    }
    const now = this.ctx!.currentTime;
    for (let i = this.later.length - 1; i >= 0; i--) {
      if (now >= this.later[i].at) {
        this.later[i].run();
        this.later.splice(i, 1);
      }
    }
    e.update();
  }
}

// A Herrerasaurus's vocal tract: about 0.7 m as an adult, scaling with size (a hatchling ~0.15 m).
export const tractOf = (size: number): number => lerp(0.15, 0.7, (size - 0.22) / 0.78);
