import type { Dino } from '../sim/dino';
import type { World } from '../sim/world';

// Records are the only thing that outlives a creature (D13). Kept in this browser.
const KEY = 'upstarts.records';
interface Records { longestLife: number; lives: number }
function loadRecords(): Records {
  try {
    return { longestLife: 0, lives: 0, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { longestLife: 0, lives: 0 };
  }
}
function saveRecords(r: Records): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* private mode: records just don't persist */
  }
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  private readonly bars = new Map<string, HTMLElement>();
  private readonly prompt: HTMLElement;
  private readonly death: HTMLElement;
  private readonly records = loadRecords();
  private seenDeath: unknown = null;

  constructor(root: HTMLElement) {
    for (const name of ['health', 'hunger', 'thirst', 'stamina']) {
      const row = document.createElement('div');
      row.className = 'bar';
      row.innerHTML = `<span>${name}</span><i><b></b></i>`;
      root.querySelector('#bars')!.appendChild(row);
      this.bars.set(name, row.querySelector('b')!);
    }
    this.prompt = root.querySelector('#prompt')!;
    this.death = root.querySelector('#death')!;
  }

  update(w: World, nearWater: boolean, nearFood: boolean): void {
    const d: Dino = w.player;
    const v = { health: d.needs.health, hunger: d.needs.hunger, thirst: d.needs.thirst, stamina: d.stamina };
    for (const [k, el] of this.bars) {
      const f = v[k as keyof typeof v];
      el.style.width = `${(f * 100).toFixed(1)}%`;
      el.classList.toggle('low', f < 0.25);
    }

    const hint = d.act === 'drink' ? 'Drinking' : d.act === 'eat' ? 'Eating'
      : nearWater ? 'Hold G / B to drink' : nearFood ? 'Hold E / X to eat' : '';
    this.prompt.textContent = d.alive ? hint : '';

    if (!d.alive && w.lastDeath && this.seenDeath !== w.lastDeath) {
      this.seenDeath = w.lastDeath;
      const best = w.lastDeath.age > this.records.longestLife;
      this.records.longestLife = Math.max(this.records.longestLife, w.lastDeath.age);
      this.records.lives++;
      saveRecords(this.records);
      this.death.innerHTML = `<h2>Died of ${w.lastDeath.cause}</h2>
        <p>Lived ${fmt(w.lastDeath.age)}${best ? ' · new record' : ''}</p>
        <p>Longest life ${fmt(this.records.longestLife)} · ${this.records.lives} ${this.records.lives === 1 ? 'life' : 'lives'}</p>
        <p class="go">Enter / A to hatch again</p>`;
    }
    this.death.hidden = d.alive;
  }
}
