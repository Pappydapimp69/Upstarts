/**
 * Circular delay line with fractional reads. Doppler is a read position that
 * slides by v/c samples per sample; a fraction-dependent interpolator then
 * amplitude-modulates the signal. Linear left 8 kHz spurs at -29 dB whether
 * walking or sprinting; 4-point Lagrange -43 dB, 6-point -57 dB (dlist/E23).
 */
export class DelayLine {
  /** @param {number} maxSamples longest delay needed */
  constructor(maxSamples) {
    let n = 8;
    while (n < maxSamples + 8) n <<= 1;
    this.buf = new Float32Array(n);
    this.mask = n - 1;
    this.w = 0;
  }

  write(x) {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }

  /**
   * Read `delay` samples behind the most recent write.
   * @param {number} delay fractional delay in samples (>= 3 for lagrange6)
   * @param {'linear'|'lagrange4'|'lagrange6'} mode
   */
  read(delay, mode = 'lagrange4') {
    const pos = this.w - 1 - delay;
    const i = Math.floor(pos);
    const a = pos - i;
    const b = this.buf, m = this.mask;
    const at = (k) => b[(i + k) & m];
    if (mode === 'linear') return (1 - a) * at(0) + a * at(1);
    if (mode === 'lagrange6') {
      let y = 0;
      for (let j = -2; j <= 3; j++) {
        let L = 1;
        for (let k = -2; k <= 3; k++) if (k !== j) L *= (a - k) / (j - k);
        y += L * at(j);
      }
      return y;
    }
    const xm1 = at(-1), x0 = at(0), x1 = at(1), x2 = at(2);
    return (-a * (a - 1) * (a - 2) / 6) * xm1
      + ((a + 1) * (a - 1) * (a - 2) / 2) * x0
      - ((a + 1) * a * (a - 2) / 2) * x1
      + ((a + 1) * a * (a - 1) / 6) * x2;
  }

  /** Integer tap, used by the reverb. */
  tap(delay) {
    return this.buf[(this.w - 1 - delay) & this.mask];
  }
}
