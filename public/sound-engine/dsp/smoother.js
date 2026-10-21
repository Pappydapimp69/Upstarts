/**
 * Per-sample linear ramp toward a target. Game code writes targets once per
 * frame; ramping across the next frame removes the staircase that raw
 * frame-rate writes leave (60 fps steps on a 12 dB/s fade spur at -49 dB,
 * a ramp matches per-sample gain at -72 dB; see dlist/E25).
 */
export class Ramp {
  constructor(value = 0) {
    this.value = value;
    this.target = value;
    this.step = 0;
    this.remaining = 0;
  }

  /**
   * @param {number} target value to reach
   * @param {number} samples ramp length; use one frame (e.g. 800 at 48 kHz / 60 fps)
   */
  setTarget(target, samples) {
    this.target = target;
    if (samples <= 0) {
      this.value = target;
      this.remaining = 0;
      this.step = 0;
      return;
    }
    this.remaining = Math.round(samples);
    this.step = (target - this.value) / this.remaining;
  }

  /** Jump without a ramp (use only while silent). */
  reset(value) {
    this.value = this.target = value;
    this.remaining = 0;
    this.step = 0;
  }

  next() {
    if (this.remaining > 0) {
      this.value += this.step;
      if (--this.remaining === 0) this.value = this.target;
    }
    return this.value;
  }
}
