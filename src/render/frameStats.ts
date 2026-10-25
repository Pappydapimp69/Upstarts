import type * as THREE from 'three';

// Frame meter (?fps): frames per second and where each frame's main-thread time goes, so a phone can be checked
// on the real site. Phases: sim (the fixed-step world), update (animators, meshes, camera), draw (three.js
// submitting the frame; the GPU's own time is not visible from here, so a low fps with small numbers means the GPU
// is the limit). Medians and 95th percentiles over the last 2 s, plus draw calls and triangles per frame.
const WINDOW = 2000; // ms

export class FrameStats {
  private readonly el: HTMLElement;
  private readonly rows: { t: number; sim: number; update: number; draw: number }[] = [];
  private mark = 0;
  private sim = 0;
  private update = 0;
  private shown = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;padding:6px 8px;border-radius:6px;'
      + 'background:rgba(0,0,0,.62);color:#e8e2d2;font:11px/1.35 ui-monospace,monospace;white-space:pre;pointer-events:none';
    document.body.appendChild(this.el);
  }

  begin(): void {
    this.mark = performance.now();
  }
  simDone(): void {
    const t = performance.now();
    this.sim = t - this.mark;
    this.mark = t;
  }
  updateDone(): void {
    const t = performance.now();
    this.update = t - this.mark;
    this.mark = t;
  }
  end(now: number, renderer: THREE.WebGLRenderer): void {
    const draw = performance.now() - this.mark;
    this.rows.push({ t: now, sim: this.sim, update: this.update, draw });
    while (this.rows.length && now - this.rows[0].t > WINDOW) this.rows.shift();
    if (now - this.shown < 500 || this.rows.length < 2) return;
    this.shown = now;
    const r = this.rows, n = r.length;
    const gaps = r.slice(1).map((x, i) => x.t - r[i].t);
    const q = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    const f = (k: 'sim' | 'update' | 'draw'): string => `${q(r.map((x) => x[k]), 0.5).toFixed(1)} / ${q(r.map((x) => x[k]), 0.95).toFixed(1)}`;
    const info = renderer.info.render;
    this.el.textContent = `${((n - 1) * 1000 / (r[n - 1].t - r[0].t)).toFixed(0)} fps   frame ${q(gaps, 0.5).toFixed(1)} / ${q(gaps, 0.95).toFixed(1)} ms\n`
      + `sim ${f('sim')}   update ${f('update')}   draw ${f('draw')} ms\n`
      + `${info.calls} draw calls   ${(info.triangles / 1000).toFixed(0)}k triangles   ${renderer.getPixelRatio().toFixed(2)}x pixels`;
  }
}
