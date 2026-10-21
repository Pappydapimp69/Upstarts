import { footfallRumble, mix, ZERO, type Footfall, type Rumble } from './rumbleMath';

// Sends footfall rumble to the controller. Web haptics only works where the pad exposes a
// vibration actuator (Chromium; not iOS Safari), so check it rather than assume it.
const KEY = 'upstarts.rumble';
type Effect = 'dual-rumble' | 'trigger-rumble';
interface Actuator {
  effects?: Effect[];
  playEffect?: (type: Effect, params: Record<string, number>) => Promise<unknown>;
}

export class FootfallRumble {
  enabled = true;
  private frame: Rumble = ZERO;
  private lastSent = 0;
  private lastPeak = 0;

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

  step(f: Footfall): void {
    this.frame = mix(this.frame, footfallRumble(f));
  }

  // Once per frame: play what this frame's footfalls added up to.
  flush(now: number, active: boolean): void {
    const r = this.frame;
    this.frame = ZERO;
    if (!this.enabled || !active) return;
    const peak = Math.max(r.strong, r.weak, r.left, r.right);
    if (peak < 0.02) return;
    // Don't restart a pulse more than every 40 ms unless this one is stronger.
    if (now - this.lastSent < 40 && peak <= this.lastPeak) return;
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    const act = (pad as unknown as { vibrationActuator?: Actuator } | undefined)?.vibrationActuator;
    if (!act?.playEffect) return;
    this.lastSent = now;
    this.lastPeak = peak;
    const duration = 50 + 60 * peak;
    // Xbox-style triggers carry direction best; otherwise lean on the left/right body motors.
    const type: Effect = act.effects?.includes('trigger-rumble') ? 'trigger-rumble' : 'dual-rumble';
    const params: Record<string, number> = { startDelay: 0, duration, strongMagnitude: r.strong, weakMagnitude: r.weak };
    if (type === 'trigger-rumble') {
      params.leftTrigger = r.left;
      params.rightTrigger = r.right;
    }
    act.playEffect(type, params).catch(() => {});
  }
}
