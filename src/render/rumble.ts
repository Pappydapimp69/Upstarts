import { addStep, decay, emptyBed, mixRumble, ownStep, type Pulse } from './rumbleMath';

// Delivers haptics, ported from the Dlist demo: one mixed frame to the controller about every 50 ms
// (sooner when something new lands), by whatever path the browser has: the standard vibration actuator
// (trigger rumble where the pad reports it, else dual rumble), else the older hapticActuators API. A refusal
// is remembered. On touch, the phone's own motor (Android; iOS browsers have none) gets short pulses.
const KEY = 'upstarts.rumble';
type Effect = 'dual-rumble' | 'trigger-rumble';
interface Actuator {
  effects?: Effect[];
  playEffect?: (type: Effect, params: Record<string, number>) => Promise<string>;
}
interface Legacy {
  pulse?: (value: number, duration: number) => Promise<boolean>;
}

export class FootfallRumble {
  enabled = true;
  padOk: boolean | null = null; // null until the pad has answered once
  private bed = emptyBed();
  private pulses: (Pulse & { end: number })[] = [];
  private fresh = false;
  private sentT = 0;
  private on = false;
  private vibT = 0;

  constructor() {
    try {
      this.enabled = localStorage.getItem(KEY) !== 'off';
    } catch {
      /* default on */
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(KEY, this.enabled ? 'on' : 'off');
    } catch {
      /* not persisted */
    }
    return this.enabled;
  }

  // Your own footfall.
  own(mass: number, speed: number, topSpeed: number, now: number, touch: boolean): void {
    if (!this.enabled) return;
    const p = ownStep(mass, speed, topSpeed);
    if (touch) {
      this.buzz(60 * Math.max(p.weak, p.strong), now, 0.2);
      return;
    }
    this.pulses.push({ ...p, end: now + 60 });
    this.fresh = true;
  }

  // A pulse of your own that isn't a step (a bite landing, being bitten).
  hit(weak: number, strong: number, ms: number, now: number, touch: boolean): void {
    if (!this.enabled) return;
    if (touch) {
      this.buzz(ms * Math.max(weak, strong), now, 0.08);
      return;
    }
    this.pulses.push({ weak, strong, end: now + ms });
    this.fresh = true;
  }

  // Another animal's footfall: adds to the ground bed.
  step(mass: number, speed: number, dist: number, pan: number, quiet: number, now: number, touch: boolean): void {
    if (!this.enabled) return;
    const before = this.bed.g2;
    addStep(this.bed, mass, speed, dist, pan, quiet);
    const a = Math.sqrt(this.bed.g2 - before);
    if (touch && a > 0.12) this.buzz(a * 40, now, 0); // a phone feels the big ones
  }

  private buzz(ms: number, now: number, min: number): void {
    if (!navigator.vibrate || ms <= min * 60 || now - this.vibT < 70) return;
    this.vibT = now;
    try {
      navigator.vibrate(Math.round(Math.min(Math.max(ms, 6), 40)));
    } catch {
      /* no motor */
    }
  }

  // Once per frame.
  flush(now: number, dt: number, active: boolean): void {
    decay(this.bed, dt);
    this.pulses = this.pulses.filter((p) => p.end > now);
    if (!this.enabled || !active) return;
    const r = mixRumble(this.bed, this.pulses);
    const live = r.weak + r.strong > 0.03;
    if (!((this.fresh || now - this.sentT > 50) && (live || this.on))) return;
    this.sentT = now;
    this.fresh = false;
    this.on = live;
    const rest = this.pulses.reduce((m, p) => Math.max(m, p.end - now), 0);
    const duration = Math.sqrt(this.bed.g2) > 0.03 ? 80 : Math.min(80, Math.max(30, rest));
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (!pad) return;
    const act = (pad as unknown as { vibrationActuator?: Actuator }).vibrationActuator;
    const legacy = (pad as unknown as { hapticActuators?: Legacy[] }).hapticActuators?.[0];
    if (act?.playEffect && this.padOk !== false) {
      const type: Effect = act.effects?.includes('trigger-rumble') ? 'trigger-rumble' : 'dual-rumble';
      const params: Record<string, number> = { startDelay: 0, duration, strongMagnitude: r.strong, weakMagnitude: r.weak };
      if (type === 'trigger-rumble') {
        params.leftTrigger = r.left;
        params.rightTrigger = r.right;
      }
      act.playEffect(type, params)
        .then((res) => {
          if (res === 'complete' || res === 'preempted') this.padOk = true;
          else if (res === 'invalid-parameter' || res === 'not-supported') this.padOk = false;
        })
        .catch(() => (this.padOk = false));
    } else if (legacy?.pulse) {
      legacy.pulse(Math.max(r.weak, r.strong), duration).catch(() => {});
    }
  }
}
