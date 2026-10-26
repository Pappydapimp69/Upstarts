// HUD and menus in the Dlist demo's field-specimen style (index.html holds the markup and CSS).
import type { Dino } from '../sim/dino';
import { EGG, TICK_DT, type World } from '../sim/world';
import { CLOCK, dayTime } from '../sim/clock';
import { stageOf } from '../sim/growth';
import { maxHp } from '../sim/combat';
import { SPECIES, SPECIES_ORDER, type SpeciesId } from '../sim/species';
import type { Objective } from '../sim/objective';
import type { TrailRead } from '../sim/trails';
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
// What the nose found on the ground: how fresh, whose, and which way it went from where the camera looks.
const LAYER: Record<TrailRead['what'], string> = { Hyperodapedon: 'a Hyperodapedon', Exaeretodon: 'an Exaeretodon', cynodont: 'a small cynodont', Saurosuchus: 'Saurosuchus', you: 'another animal' };
function trailText(r: TrailRead, camYaw: number): string {
  const fresh = r.age < 30 ? 'Fresh' : r.age < 120 ? 'Recent' : 'Old';
  const what = `${fresh} ${r.kind === 'blood' ? 'blood' : 'trail'}: ${LAYER[r.what]}`;
  if (r.yaw === null) return r.kind === 'blood' ? `${what}, it stood here bleeding` : what;
  const rel = Math.atan2(Math.sin(r.yaw - camYaw - Math.PI), Math.cos(r.yaw - camYaw - Math.PI));
  const way = Math.abs(rel) < 0.6 ? 'went on ahead' : Math.abs(rel) > 2.5 ? 'went back behind you' : rel > 0 ? 'went off to the left' : 'went off to the right';
  return `${what}, it ${way}`;
}
// What a player would call the time (D11: 10 min dawn, 40 min high sun, 10 min dusk, 20 min night).
function partOfDay(u: number): string {
  const { dawn, high, dusk } = CLOCK;
  return u < dawn ? 'Dawn' : u < dawn + high * 0.35 ? 'Morning' : u < dawn + high * 0.65 ? 'Midday' : u < dawn + high ? 'Afternoon'
    : u < dawn + high + dusk ? 'Dusk' : 'Night';
}
const PICK_KEY = 'upstarts.species';

const KEYS: Record<Device, [string, string][]> = {
  pad: [['Move', 'Left stick'], ['Camera', 'Right stick'], ['Sprint', 'Right trigger (hold)'], ['Drink / sniff', 'B (hold)'],
    ['Eat / bite', 'X (hold)'], ['Jump', 'A'], ['Rest', 'Left trigger (hold)'], ['Roar', 'Y'], ['Calls', 'Click right stick'], ['Camera behind', 'Click left stick'], ['Menu', 'Start']],
  keys: [['Move', 'W A S D'], ['Camera', 'Drag the mouse'], ['Sprint', 'Shift (hold)'], ['Drink / sniff', 'G (hold)'],
    ['Eat / bite', 'E or F (hold)'], ['Jump', 'Space'], ['Rest', 'Z (hold)'], ['Roar', 'R'], ['Calls', 'Hold R, or 1 to 6'], ['Camera behind', 'C'], ['Menu', 'Esc']],
  touch: [['Move', 'Left thumb (push to the edge to sprint)'], ['Camera', 'Drag on the right'], ['Drink / sniff', 'B (hold)'],
    ['Eat / bite', 'X (hold)'], ['Jump', 'A'], ['Rest', 'LT (hold)'], ['Roar', 'Y'], ['Calls', 'Hold Y'], ['Camera behind', '\u21BA'], ['Menu', '\u2630']],
};
const BTN: Record<Device, { drink: string; eat: string; go: string; rest: string; tear: string }> = {
  pad: { drink: 'B', eat: 'X', go: 'A', rest: 'LT', tear: 'A' },
  keys: { drink: 'G', eat: 'E', go: 'Enter', rest: 'Z', tear: 'Enter' },
  touch: { drink: 'B', eat: 'X', go: 'tap', rest: 'LT', tear: 'A' },
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
  private flashText = '';
  private flashT = 9;
  private goalKey = '';
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
          <span class="ssize">${sp.length} m · ${sp.mass} kg · ${sp.diet === 'omnivore' ? 'plants and meat' : sp.diet === 'rooter' ? 'ferns, roots, grubs' : 'meat'}${sp.plan === 'quad' ? ' · four legs' : ''}${sp.swim > 0 ? ' · swims' : ''}</span>
          <span class="sdesc">${sp.blurb}</span></button>`;
      }).join('');
      this.el(id).querySelectorAll<HTMLElement>('.sp').forEach((b) => b.addEventListener('click', () => this.pick(b.dataset.sp as SpeciesId)));
    }
    this.pick(this.selected);
  }

  pick(id: SpeciesId): void {
    this.selected = id;
    document.querySelectorAll<HTMLElement>('.sp').forEach((b) => b.classList.toggle('on', b.dataset.sp === id));
    this.introCta();
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

  private plan: 'biped' | 'quad' = 'biped';

  setDevice(d: Device): void {
    document.body.classList.toggle('touch', d === 'touch');
    this.el('keysTitle').textContent = d === 'pad' ? 'Controller' : d === 'touch' ? 'Touch' : 'Keyboard and mouse';
    // Four legs don't jump (owner): say so rather than offer a button that does nothing.
    this.el('keysList').innerHTML = KEYS[d].map(([a, b]) => (a === 'Jump' && this.plan === 'quad' ? [a, 'No (four legs)'] : [a, b]))
      .map(([a, b]) => `<div style="display:contents"><dt>${a}</dt><dd>${b}</dd></div>`).join('');
    const go = BTN[d].go;
    this.el('deathCta').textContent = d === 'touch' ? 'Tap a dinosaur to hatch again' : `Left and right to choose · ${go} to hatch again`;
    this.device = d;
    this.introCta();
    this.el('pauseHint').textContent = d === 'touch' ? 'Tap to resume' : d === 'pad' ? 'X toggles rumble · Start or A to resume' : 'V toggles rumble · Esc or Enter to resume';
  }

  // A saved life to carry on (render/saveStore.ts): the start card offers it; picking another species starts over.
  private saved: { id: SpeciesId; text: string } | null = null;
  private device: Device = inputState.device;
  setContinue(d: Dino | null): void {
    this.saved = d ? { id: d.species.id, text: `your ${d.species.name}, ${d.alive ? `${stageOf(d.growth)}, alive ${fmt(d.age)}` : 'dead'}` } : null;
    if (d) this.pick(d.species.id);
    this.introCta();
  }
  private introCta(): void {
    const el = document.getElementById('introCta');
    if (!el) return;
    const touch = this.device === 'touch', go = BTN[this.device].go, s = this.saved;
    el.textContent = !s ? (touch ? 'Tap a dinosaur to hatch' : `Left and right to choose · ${go} to hatch`)
      : this.selected === s.id ? `${touch ? 'Tap' : go} to carry on: ${s.text}`
      : `${touch ? 'Tap' : go} to start a new life as ${SPECIES[this.selected].name}. Your saved one ends.`;
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

  // A line about the last blow ("Missed", "Badly wounded"), shown in place of the prompt for a moment.
  flash(text: string): void {
    this.flashText = text;
    this.flashT = 0;
  }

  update(w: World, near: { water: boolean; food: boolean; prey: boolean; browse: boolean }, camYaw: number, goal: Objective | null = null, dt = 0): void {
    const d: Dino = w.player;
    const dev = inputState.device, btn = BTN[dev];
    this.el('padChip').hidden = inputState.padSeen || dev !== 'pad';

    if (d.species.plan !== this.plan) {
      this.plan = d.species.plan;
      this.setDevice(inputState.device);
    }
    const stage = stageOf(d.growth);
    document.querySelector('.binomial')!.textContent = d.species.binomial;
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
      : d.swim > 0.5 ? (d.under > 0.6 ? 'Lying low in the water' : `Swimming · ${d.speed.toFixed(1)} m/s`)
      : d.fall ? (d.fall.down ? (d.fall.t < d.fall.tT + d.fall.tL ? 'Down' : 'Getting back up') : d.fall.level === 'slip' ? 'Slipped' : 'Stumbling')
      : d.jump ? (d.jump.ph === 'crouch' ? 'Crouching to jump' : 'Airborne')
      : d.resting ? (d.stamina < 0.995 ? 'Lying down, resting' : 'Lying down, rested') : d.rest > 0.05 ? 'Getting up'
      : sp < 0.15 ? 'Standing' : `${sp > 1.08 * d.body.walk ? (sp < 0.68 * d.body.sprintMax ? 'Running' : 'Sprinting') : 'Walking'} · ${sp.toFixed(1)} m/s`;
    if (d.alive && d.hidden > 0.6) this.el('pace').textContent += ' · hidden in the plants';
    else if (d.alive && d.hidden > 0.3) this.el('pace').textContent += ' · half hidden';

    const hint = d.act === 'drink' ? 'Drinking' : d.act === 'eat' ? 'Eating' : d.act === 'browse' ? 'Browsing' : d.act === 'dig' ? 'Digging for grubs'
      : d.act === 'bite' ? (d.grip >= 0 && d.species.attack === 'grab' ? 'Holding it down and biting' : d.grip >= 0 ? 'Holding on' : 'Biting')
      : d.act === 'kick' ? 'Kicking' : d.act === 'swipe' ? 'Swinging the tail'
      : d.act === 'turn' || d.act === 'shuffle' ? 'Heading for the water'
      : d.act === 'sniff' ? (d.trail ? trailText(d.trail, camYaw)
        : d.sniff ? (d.sniff.strength > 0.5 ? 'Strong scent on the wind' : 'Faint scent on the wind') : 'Nothing on the wind')
      : near.prey && d.species.attack !== 'none' ? `Hold <b>${btn.eat}</b> to bite` : near.water ? `Hold <b>${btn.drink}</b> to drink`
      : near.food ? `Hold <b>${btn.eat}</b> to eat` : near.browse ? `Hold <b>${btn.eat}</b> to browse the ferns` : '';
    const tear = `Press <b>${btn.go === 'tap' ? 'A' : btn.go}</b> again and again to tear free of the egg · ${EGG.presses - d.egg} of ${EGG.presses}`;
    this.flashT += dt;
    this.el('prompt').innerHTML = !d.alive ? '' : d.egg > 0 ? tear : this.flashT < 1.6 ? this.flashText : hint;

    // The objective, under the title plate. It glows for a moment when it changes.
    const fill = (t: string): string => t.replace(/\{(eat|drink|go|rest)\}/g, (_, k: 'eat' | 'drink' | 'go' | 'rest') => `<b>${k === 'go' ? btn.tear : btn[k]}</b>`);
    const goalEl = this.el('goal');
    goalEl.hidden = !goal;
    if (goal) {
      this.el('goalSay').innerHTML = fill(goal.say);
      this.el('goalSub').innerHTML = fill(goal.sub);
      if (goal.key !== this.goalKey) {
        this.goalKey = goal.key;
        goalEl.classList.remove('new');
        void goalEl.offsetWidth; // restart the animation
        goalEl.classList.add('new');
      }
      goalEl.classList.toggle('danger', goal.key === 'danger' || goal.key === 'drinkNow' || goal.key === 'eatNow');
    }

    // Sniffing: an arrow relative to the camera, along a trail on the ground if the nose is on one, else the way the
    // scent on the wind comes from.
    const arrow = this.el('scent');
    const onTrail = d.trail && d.trail.yaw !== null ? d.trail : null;
    if (d.alive && d.act === 'sniff' && (onTrail || d.sniff)) {
      arrow.hidden = false;
      const rel = (onTrail ? onTrail.yaw! : d.sniff!.yaw) - (camYaw + Math.PI);
      arrow.style.transform = `rotate(${-rel}rad)`;
      arrow.style.opacity = String(0.4 + 0.6 * Math.min(1, onTrail ? onTrail.strength : d.sniff!.strength));
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
      this.el('deathTitle').textContent = L.cause === 'hunger' || L.cause === 'thirst' ? `Died of ${L.cause}` : `Killed by ${L.cause}`;
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
