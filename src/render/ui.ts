// HUD and menus in the Dlist demo's field-specimen style (index.html holds the markup and CSS).
import type { Dino } from '../sim/dino';
import type { World } from '../sim/world';
import { stageOf } from '../sim/growth';
import { onDevice, pressConfirm, state as inputState, type Device } from '../input/input';

// Records are the only thing that outlives a creature (D13). Kept in this browser.
const KEY = 'upstarts.records';
interface Records { longestLife: number; lives: number; largest: number }
function loadRecords(): Records {
  try {
    return { longestLife: 0, lives: 0, largest: 0, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { longestLife: 0, lives: 0, largest: 0 };
  }
}
function saveRecords(r: Records): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* private mode: records just don't persist */
  }
}

const fmt = (s: number): string => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
const ADULT_LENGTH = 5.2; // m nose to tail

const KEYS: Record<Device, [string, string][]> = {
  pad: [['Move', 'Left stick'], ['Camera', 'Right stick'], ['Sprint', 'Right trigger (hold)'], ['Drink / sniff', 'B (hold)'],
    ['Eat / bite', 'X (hold)'], ['Camera behind', 'Click right stick'], ['Menu', 'Start']],
  keys: [['Move', 'W A S D'], ['Camera', 'Drag the mouse'], ['Sprint', 'Shift (hold)'], ['Drink / sniff', 'G (hold)'],
    ['Eat / bite', 'E or F (hold)'], ['Camera behind', 'C'], ['Menu', 'Esc']],
  touch: [['Move', 'Left thumb (push to the edge to sprint)'], ['Camera', 'Drag on the right'], ['Drink / sniff', 'B (hold)'],
    ['Eat / bite', 'X (hold)'], ['Camera behind', '↺'], ['Menu', '☰']],
};
const BTN: Record<Device, { drink: string; eat: string; go: string }> = {
  pad: { drink: 'B', eat: 'X', go: 'A' },
  keys: { drink: 'G', eat: 'E', go: 'Enter' },
  touch: { drink: 'B', eat: 'X', go: 'tap' },
};

function word(v: number, words: [number, string][]): string {
  for (const [t, w] of words) if (v >= t) return w;
  return words[words.length - 1][1];
}

export class Ui {
  private readonly bars = new Map<string, HTMLElement>();
  private readonly vals = new Map<string, HTMLElement>();
  private readonly el = (id: string): HTMLElement => document.getElementById(id)!;
  private readonly records = loadRecords();
  private seenDeath: unknown = null;

  constructor() {
    document.querySelectorAll<HTMLElement>('.readout [data-k]').forEach((e) => this.bars.set(e.dataset.k!, e));
    document.querySelectorAll<HTMLElement>('.readout [data-v]').forEach((e) => this.vals.set(e.dataset.v!, e));
    onDevice((d) => this.setDevice(d));
    this.setDevice(inputState.device);
    // A tap or click anywhere on a card counts as confirm (hatch, resume).
    for (const id of ['intro', 'death', 'pause']) this.el(id).addEventListener('click', () => pressConfirm());
  }

  setDevice(d: Device): void {
    document.body.classList.toggle('touch', d === 'touch');
    this.el('keysTitle').textContent = d === 'pad' ? 'Controller' : d === 'touch' ? 'Touch' : 'Keyboard and mouse';
    this.el('keysList').innerHTML = KEYS[d].map(([a, b]) => `<div style="display:contents"><dt>${a}</dt><dd>${b}</dd></div>`).join('');
    const go = BTN[d].go;
    this.el('deathCta').textContent = d === 'touch' ? 'Tap to hatch again' : `Press ${go} to hatch again`;
    this.el('pauseHint').textContent = d === 'touch' ? 'Tap to resume' : d === 'pad' ? 'Start or A to resume' : 'Esc or Enter to resume';
  }

  showIntro(on: boolean): void {
    this.el('intro').hidden = !on;
    document.body.classList.toggle('playing', !on);
  }

  showPause(on: boolean): void {
    this.el('pause').hidden = !on;
  }

  update(w: World, near: { water: boolean; food: boolean; prey: boolean }, camYaw: number): void {
    const d: Dino = w.player;
    const dev = inputState.device, btn = BTN[dev];
    this.el('padChip').hidden = inputState.padSeen || dev !== 'pad';

    const stage = stageOf(d.growth);
    this.el('meta').textContent = `${cap(stage)} · about ${(ADULT_LENGTH * d.body.size).toFixed(1)} m nose to tail · Ischigualasto, about 231 million years ago`;

    const n = d.needs;
    const v: Record<string, number> = { health: n.health, hunger: n.hunger, thirst: n.thirst, stamina: d.stamina, growth: d.growth };
    for (const [k, el] of this.bars) {
      el.style.width = `${(v[k] * 100).toFixed(1)}%`;
      el.parentElement!.classList.toggle('low', k !== 'growth' && v[k] < 0.25);
    }
    const txt: Record<string, string> = {
      health: word(n.health, [[0.9, 'Healthy'], [0.6, 'Hurt'], [0.3, 'Badly hurt'], [0, 'Dying']]),
      hunger: word(n.hunger, [[0.8, 'Fed'], [0.5, 'Peckish'], [0.2, 'Hungry'], [0, 'Starving']]),
      thirst: word(n.thirst, [[0.8, 'Watered'], [0.5, 'Thirsty'], [0.2, 'Parched'], [0, 'Dehydrated']]),
      stamina: word(d.stamina, [[0.8, 'Fresh'], [0.5, 'Winded'], [0.2, 'Tired'], [0, 'Spent']]),
      growth: `${cap(stage)} ${Math.round(d.growth * 100)}%`,
    };
    for (const [k, el] of this.vals) el.textContent = txt[k];
    const sp = d.speed;
    this.el('pace').textContent = !d.alive ? 'Dead'
      : sp < 0.15 ? 'Standing' : `${sp < 0.68 * d.body.sprintMax ? (sp < 1.6 * d.body.size ** 0.5 ? 'Walking' : 'Running') : 'Sprinting'} · ${sp.toFixed(1)} m/s`;

    const hint = d.act === 'drink' ? 'Drinking' : d.act === 'eat' ? 'Eating' : d.act === 'bite' ? 'Biting'
      : d.act === 'turn' || d.act === 'shuffle' ? 'Heading for the water'
      : d.act === 'sniff' ? (d.sniff ? (d.sniff.strength > 0.5 ? 'Strong scent on the wind' : 'Faint scent on the wind') : 'Nothing on the wind')
      : near.prey ? `Hold <b>${btn.eat}</b> to bite` : near.water ? `Hold <b>${btn.drink}</b> to drink`
      : near.food ? `Hold <b>${btn.eat}</b> to eat` : '';
    this.el('prompt').innerHTML = d.alive ? hint : '';

    // Sniffing: an arrow pointing the way the scent comes from, relative to the camera.
    const arrow = this.el('scent');
    if (d.alive && d.act === 'sniff' && d.sniff) {
      arrow.hidden = false;
      const rel = d.sniff.yaw - (camYaw + Math.PI);
      arrow.style.transform = `rotate(${-rel}rad)`;
      arrow.style.opacity = String(0.4 + 0.6 * Math.min(1, d.sniff.strength));
    } else arrow.hidden = true;

    this.el('hurt').style.opacity = d.alive && d.hitT < 0.6 ? String(1 - d.hitT / 0.6) : '0';

    if (!d.alive && w.lastDeath && this.seenDeath !== w.lastDeath) {
      this.seenDeath = w.lastDeath;
      const L = w.lastDeath;
      const best = L.age > this.records.longestLife;
      this.records.longestLife = Math.max(this.records.longestLife, L.age);
      this.records.largest = Math.max(this.records.largest, L.growth);
      this.records.lives++;
      saveRecords(this.records);
      this.el('deathTitle').textContent = L.cause === 'Saurosuchus' ? 'Killed by Saurosuchus' : `Died of ${L.cause}`;
      this.el('deathStats').innerHTML = [
        ['Lived', `${fmt(L.age)}${best ? ' · new record' : ''}`],
        ['Reached', `${cap(stageOf(L.growth))} (${Math.round(L.growth * 100)}%)`],
        ['Longest life', fmt(this.records.longestLife)],
        ['Lives', String(this.records.lives)],
      ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    }
    this.el('death').hidden = d.alive;
  }
}
