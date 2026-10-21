/**
 * Seeded xorshift32 noise. Deterministic: the same seed gives the same
 * stream, so tests and replays sound identical.
 */
export class Noise {
  /** @param {number} seed non-zero 32-bit seed */
  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0 || 1;
  }

  /** @returns {number} uniform in [0, 1) */
  uniform() {
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.state = x;
    return x / 4294967296;
  }

  /** @returns {number} uniform in [-1, 1) */
  bipolar() {
    return this.uniform() * 2 - 1;
  }

  /** Exponential gap for a Poisson process of `rate` events per second. */
  exponential(rate) {
    return -Math.log(1 - this.uniform()) / rate;
  }
}
