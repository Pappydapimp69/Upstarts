// HUD and menus in the Dlist demo's field-specimen style (index.html holds the markup and CSS).
import type { Dino } from '../sim/dino';
import { EGG, TICK_DT, type World } from '../sim/world';
import { CLOCK, dayTime } from '../sim/clock';
import { stageOf } from '../sim/growth';
import { maxHp } from '../sim/combat';
import { SPECIES, SPECIES_ORDER, type SpeciesId } from '../sim/species';
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
// What a player would call the time (D11: 10 min dawn, 40 min high sun, 10 min dusk, 20 min night).
function partOfDay(u: number): string {
  const { dawn, high, dusk } = CLOCK;
  return u < dawn ? 'Dawn' : u < dawn + high * 0.35 ? 'Morning' : u < dawn + high * 0.65 ? 'Midday' : u < dawn + high ? 'Afternoon'
    : u < dawn + high + dusk ? 'Dusk' : 'Night';
}
const BINOMIAL: Record<SpeciesId, string> = {
  herrerasaurus: 'Herrerasaurus ischigualastensis',
  eodromaeus: 'Eodromaeus murphi',
  panphagia: 'Panphagia protos',
  sanjuansaurus: 'Sanjuansaurus gordilloi',
};
const PICK_KEY = 'upstarts.species';

const KEYS: Record<Device, [string, string][]> = {
  pad: [['Move', 'Left stick'], ['Camera', 'Right stick'], ['Sprint', 'Right trigger (hold)'], ['Drink / sniff', 'B (hold)'],
    ['Eat / bite', 'X (hold)'], ['Jump', 'A'], ['Rest', 'Left trigger (hold)'], ['Roar', 'Y'], ['Calls', 'Click right stick'], ['Camera behind', 'Click left stick'], ['Menu', 'Start']],
  keys: [['Move', 'W A S D'], ['Camera', 'Drag the mouse'], ['Sprint', 'Shift (hold)'], ['Drink / sniff', 'G (hold)'],
    ['Eat / bite', 'E or F (hold)'], ['Jump', 'Space'], ['Rest', 'Z (hold)'], ['Roar', 'R'], ['Calls', 'Hold R, or 1 to 6'], ['Camera behind', 'C'], ['Menu', 'Esc']],
  touch: [['Move', 'Left thumb (push to the edge to sprint)'], ['Camera', 'Drag on the right'], ['Drink / sniff', 'B (hold)'],
    ['Eat / bite', 'X (hold)'], ['Jump', 'A'], ['Rest', 'LT (hold)'], ['Roar', 'Y'], ['Calls', 'Hold Y'], ['Camera behind', '\u21BA'], ['Menu', '\u2630']],
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
  selected: SpeciesId = 'herrerasaurus';

  constructor() {
    document.querySelectorAll<HTMLElement>('.readout [data-k]').forEach((e) => this.bars.set(e.dataset.k!, e));
    document.querySelectorAll<HTMLElement>('.readout [data-v]').forEach((e) => this.vals.set(e.dataset.v!, e));
    onDevice((d) => this.setDevice(d));
    this.setDevice(inputState.device);
    // A tap or click anywhere on a card counts as confirm (hatch, resume).
    for (const id of ['intro', 'death', 'pause']) this.el(id).addEventListener('click', () => pressConfirm());
    try {
      const s = localStorage.getItem(PICK_KEY) as SpeciesId | null;
      if (s && s in SPECIES) this.selected = s;
    } catch {
      /* default */
    }
    // Species cards: tapping one picks it (and the card's click then hatches).
    for (const id of ['pickIntro', 'pickDeath']) {
      this.el(id).innerHTML = SPECIES_ORDER.map((k) => {
        const sp = SPECIES[k];
        return `<button type="button" class="sp" data-sp="${k}" role="option"><span class="sname">${sp.name}</span>
          <span class="ssize">${sp.length} m · ${sp.mass} kg · ${sp.diet === 'omnivore' ? 'plants and meat' : 'meat'}</span>
          <span class="sdesc">${sp.blurb}</span></button>`;
      }).join('');
      this.el(id).querySelectorAll<HTMLElement>('.sp').forEach((b) => b.addEventListener('click', () => this.pick(b.dataset.sp as SpeciesId)));
    }
    this.pick(this.selected);
  }

  pick(id: SpeciesId): void {
    this.selected = id;
    document.querySelectorAll<HTMLElement>('.sp').forEach((b) => b.classList.toggle('on', b.dataset.sp === id));
    try {
      localStorage.setItem(PICK_KEY, id);
    } catch {
      /* not remembered */
    }
  }

  move(d: number): void {
    const i = SPECIES_ORDER.indexOf(this.selected);
    this.pick(SPECIES_ORDER[(i + d + SPECIES_ORDER.length) % SPECIES_ORDER.length]);
  }

  setDevice(d: Device): void {
    document.body.classList.toggle('touch', d === 'touch');
    this.el('keysTitle').textContent = d === 'pad' ? 'Controller' : d === 'touch' ? 'Touch' : 'Keyboard and mouse';
    this.el('keysList').innerHTML = KEYS[d].map(([a, b]) => `<div style="display:contents"><dt>${a}</dt><dd>${b}</dd></div>`).join('');
    const go = BTN[d].go;
    this.el('deathCta').textContent = d === 'touch' ? 'Tap a dinosaur to hatch again' : `Left and right to choose · ${go} to hatch again`;
    this.el('introCta').textContent = d === 'touch' ? 'Tap a dinosaur to hatch' : `Left and right to choose · ${go} to hatch`;
    this.el('pauseHint').textContent = d === 'touch' ? 'Tap to resume' : d === 'pad' ? 'X toggles rumble · Start or A to resume' : 'V toggles rumble · Esc or Enter to resume';
  }

  showIntro(on: boolean): void {
    this.el('intro').hidden = !on;
    document.body.classList.toggle('playing', !on);
  }

  showPause(on: boolean): void {
    this.el('pause').hidden = !on;
  }

  setRumble(on: boolean): void {
    this.el('rumbleBtn').textContent = `Controller rumble: ${on ? 'on' : 'off'}`;
  }

  onRumbleButton(f: () => void): void {
    this.el('rumbleBtn').addEventListener('click', (e) => {
      e.stopPropagation(); // not a resume
      f();
    });
  }

  update(w: World, near: { water: boolean; food: boolean; prey: boolean; browse: boolean }, camYaw: number): void {
    const d: Dino = w.player;
    const dev = inputState.device, btn = BTN[dev];
    this.el('padChip').hidden = inputState.padSeen || dev !== 'pad';

    const stage = stageOf(d.growth);
    document.querySelector('.binomial')!.textContent = BINOMIAL[d.species.id];
    this.el('meta').textContent = `${cap(stage)} · about ${(d.species.length * d.body.size).toFixed(1)} m nose to tail · ${partOfDay(dayTime(w.tick * TICK_DT))} · Ischigualasto, about 231 million years ago`;

    const n = d.needs;
    const v: Record<string, number> = { health: n.health, hunger: n.hunger, thirst: n.thirst, stamina: d.stamina, growth: d.growth };
    for (const [k, el] of this.bars) {
      el.style.width = `${(v[k] * 100).toFixed(1)}%`;
      el.parentElement!.classList.toggle('low', k !== 'growth' && v[k] < 0.25);
    }
    const txt: Record<string, string> = {
      health: `${Math.ceil(n.health * maxHp(d.body.mass) - 1e-6)}/${Math.ceil(maxHp(d.body.mass) - 1e-6)} HP`,
      hunger: word(n.hunger, [[0.8, 'Fed'], [0.5, 'Peckish'], [0.2, 'Hungry'], [0, 'Starving']]),
      thirst: word(n.thirst, [[0.8, 'Watered'], [0.5, 'Thirsty'], [0.2, 'Parched'], [0, 'Dehydrated']]),
      stamina: word(d.stamina, [[0.8, 'Fresh'], [0.5, 'Winded'], [0.2, 'Tired'], [0, 'Spent']]),
      growth: `${cap(stage)} ${Math.round(d.growth * 100)}%`,
    };
    for (const [k, el] of this.vals) el.textContent = txt[k];
    const sp = d.speed;
    this.el('pace').textContent = !d.alive ? 'Dead' : d.egg > 0 ? 'Inside the egg'
      : d.jump ? (d.jump.ph === 'crouch' ? 'Crouching to jump' : 'Airborne')
      : d.resting ? (d.stamina < 0.995 ? 'Lying down, resting' : 'Lying down, rested') : d.rest > 0.05 ? 'Getting up'
      : sp < 0.15 ? 'Standing' : `${sp < 0.68 * d.body.sprintMax ? (sp < 1.6 * d.body.size ** 0.5 ? 'Walking' : 'Running') : 'Sprinting'} · ${sp.toFixed(1)} m/s`;

    const hint = d.act === 'drink' ? 'Drinking' : d.act === 'eat' ? 'Eating' : d.act === 'browse' ? 'Browsing' : d.act === 'dig' ? 'Digging for grubs' : d.act === 'bite' ? 'Biting'
      : d.act === 'turn' || d.act === 'shuffle' ? 'Heading for the water'
      : d.act === 'sniff' ? (d.sniff ? (d.sniff.strength > 0.5 ? 'Strong scent on the wind' : 'Faint scent on the wind') : 'Nothing on the wind')
      : near.prey ? `Hold <b>${btn.eat}</b> to bite` : near.water ? `Hold <b>${btn.drink}</b> to drink`
      : near.food ? `Hold <b>${btn.eat}</b> to eat` : near.browse ? `Hold <b>${btn.eat}</b> to browse the ferns` : '';
    const tear = `Press <b>${btn.go === 'tap' ? 'A' : btn.go}</b> again and again to tear free of the egg · ${EGG.presses - d.egg} of ${EGG.presses}`;
    this.el('prompt').innerHTML = !d.alive ? '' : d.egg > 0 ? tear : hint;

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
        ['Reached', `${cap(stageOf(L.growth))} ${d.species.name} (${Math.round(L.growth * 100)}%)`],
        ['Longest life', fmt(this.records.longestLife)],
        ['Lives', String(this.records.lives)],
      ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    }
    this.el('death').hidden = d.alive;
  }
}
