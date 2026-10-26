// Raw player input from keyboard and mouse, gamepad, or touch. Camera-relative; the
// camera turns it into a world-space sim Command. Touch controls are the Dlist demo's:
// a floating stick on the left (push past the ring to sprint), drag on the right to look.
import { smooth } from '../sim/math';
import { CALLS, WHEEL, type CallStyle } from '../sim/calls';

export type Device = 'pad' | 'keys' | 'touch';

export interface RawInput {
  moveF: number; // -1..1 forward
  moveR: number; // -1..1 right
  sprint: number; // 0..1
  lookX: number; // stick, -1..1
  lookY: number;
  dragX: number; // mouse or touch drag pixels since last read
  dragY: number;
  recenter: boolean;
  drink: boolean; // held
  eat: boolean; // held
  rest: boolean; // held: lie down
  nest: boolean; // held: scrape a nest and lay (adults)
  confirm: boolean; // pressed
  menu: boolean; // pressed
  toggle: boolean; // pressed: the option on the pause card (rumble)
  call: CallStyle | 'auto' | null; // pressed: a call from the wheel or a number key, or 'auto' (Y / R tap)
  nav: -1 | 0 | 1; // pressed: left/right on a menu (species picker)
}

const keys = new Set<string>();
let dragX = 0, dragY = 0, dragging = false, recenter = false, confirm = false, menu = false, toggle = false;
let padToggleWas = false;
let call: CallStyle | 'auto' | null = null;
let nav: -1 | 0 | 1 = 0;
let navHold = 0;
const padWas: boolean[] = [];
let playing = false;
export const setPlaying = (p: boolean): void => {
  playing = p;
  if (!p && wheel.open) closeWheel(false);
};

/* ---- call wheel (Dlist demo) ----
   Controller: click the right stick to open it, tilt the stick to a call, click again or press A to call it,
   B closes. While it is open A and B belong to the wheel (and stay swallowed until released).
   Keyboard: tap R to roar; hold R and move the mouse to pick, release to call; 1-6 call directly.
   Touch: tap Y to roar; hold Y and slide toward a call, let go to call it. */
const wheel = { open: false, pick: -1, dev: '' as Device | '', wx: 0, wy: 0, rDown: -1, yDown: false, yTimer: 0, tx: 0, ty: 0, swallowAB: false };
let roarLabel = 'Roar';
export const setRoarLabel = (s: string): void => {
  roarLabel = s;
};
function renderWheel(): void {
  document.querySelectorAll('#callWheel .opt').forEach((o, i) => o.classList.toggle('on', i === wheel.pick));
  const st = wheel.pick >= 0 ? WHEEL[wheel.pick] : null;
  document.getElementById('wheelName')!.textContent = st ? CALLS[st].label : 'Choose a call';
  document.getElementById('wheelHint')!.textContent = st ? CALLS[st].note : `Y now: ${roarLabel.toLowerCase()}`;
}
function openWheel(dev: Device): void {
  Object.assign(wheel, { open: true, pick: -1, dev, wx: 0, wy: 0 });
  renderWheel();
  document.getElementById('callWheel')!.hidden = false;
}
// Direction picks a slot, clockwise from the top; inside the dead zone nothing is picked (letting go then cancels).
function pickWheel(x: number, y: number, dead: number): void {
  if (Math.hypot(x, y) < dead) return;
  const n = WHEEL.length, a = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2), i = Math.round(a / ((Math.PI * 2) / n)) % n;
  if (i !== wheel.pick) {
    wheel.pick = i;
    renderWheel();
  }
}
function closeWheel(fire: boolean): void {
  if (fire && wheel.pick >= 0) call = WHEEL[wheel.pick];
  Object.assign(wheel, { open: false, pick: -1 });
  document.getElementById('callWheel')!.hidden = true;
}
function buildWheel(): void {
  const el = document.getElementById('callWheel')!;
  WHEEL.forEach((st, i) => {
    const a = (i / WHEEL.length) * Math.PI * 2, o = document.createElement('div');
    o.className = 'opt';
    o.innerHTML = `${CALLS[st].label}<small>${i + 1} · ${CALLS[st].note}</small>`;
    o.style.transform = `translate(${Math.sin(a) * 104}px, ${-Math.cos(a) * 104}px)`;
    el.appendChild(o);
  });
}
let padConfirmWas = false, padMenuWas = false;
export const state = { device: (matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys') as Device, padSeen: false };
const listeners: ((d: Device) => void)[] = [];
export const onDevice = (f: (d: Device) => void): void => {
  listeners.push(f);
};
function setDevice(d: Device): void {
  if (state.device === d) return;
  state.device = d;
  if (d !== 'touch') Object.assign(touch, { mf: 0, mr: 0, sprint: 0, b: false, x: false });
  listeners.forEach((f) => f(d));
}

const touch = { mf: 0, mr: 0, sprint: 0, b: false, x: false, rest: false, nest: false, stickId: -1, lookId: -1, ox: 0, oy: 0, lx: 0, ly: 0 };

// Deadzone on the stick's length, not per axis, so diagonals aren't squashed.
function radial(x: number, y: number, inner = 0.16, outer = 0.96): [number, number] {
  const m = Math.hypot(x, y);
  if (m < inner) return [0, 0];
  const k = Math.min(1, (m - inner) / (outer - inner)) / m;
  return [x * k, y * k];
}

export function initInput(canvas: HTMLElement): void {
  window.addEventListener('keydown', (e) => {
    setDevice('keys');
    keys.add(e.code);
    if (e.code === 'KeyC') recenter = true;
    if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) confirm = true;
    if (e.code === 'Escape' && !e.repeat) {
      menu = true;
      if (wheel.open) closeWheel(false);
    }
    if (e.code === 'KeyV' && !e.repeat) toggle = true;
    if (!playing && (e.code === 'ArrowLeft' || e.code === 'KeyA')) nav = -1;
    if (!playing && (e.code === 'ArrowRight' || e.code === 'KeyD')) nav = 1;
    if (e.code === 'KeyR' && !e.repeat) wheel.rDown = performance.now(); // tap: roar on release; held: the wheel
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (digit && playing) {
      call = WHEEL[+digit[1] - 1];
      if (wheel.open) closeWheel(false);
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyR' && wheel.rDown >= 0) {
      if (wheel.open) closeWheel(true);
      else if (playing) call = 'auto';
      wheel.rDown = -1;
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (wheel.open && wheel.dev === 'keys') {
      wheel.wx += e.movementX;
      wheel.wy += e.movementY;
      pickWheel(wheel.wx, wheel.wy, 24);
    }
  });
  buildWheel();
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    setDevice('keys');
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || (wheel.open && wheel.dev === 'keys')) return;
    dragX += e.movementX;
    dragY += e.movementY;
  });
  // Any touch switches to touch mode; a key, the mouse or a controller switches back.
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') setDevice('touch');
  }, { capture: true });

  const stick = document.getElementById('tStick')!, knob = stick.firstElementChild as HTMLElement, R = 56;
  const move = document.getElementById('tMove')!, look = document.getElementById('tLook')!;
  const place = (): void => {
    stick.style.left = touch.ox + 'px';
    stick.style.top = touch.oy + 'px';
  };
  const stickTo = (e: PointerEvent): void => {
    let dx = e.clientX - touch.ox, dy = e.clientY - touch.oy;
    const d = Math.hypot(dx, dy), max = R * 1.4;
    if (d > max) {
      // The stick follows a thumb that runs off it.
      touch.ox += dx * (1 - max / d);
      touch.oy += dy * (1 - max / d);
      dx *= max / d;
      dy *= max / d;
      place();
    }
    const [x, y] = radial(dx / R, dy / R, 0.12, 1);
    touch.mr = x;
    touch.mf = -y;
    touch.sprint = smooth(1.08, 1.3, Math.hypot(dx, dy) / R);
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stick.classList.toggle('sprint', touch.sprint > 0.5);
  };
  move.addEventListener('pointerdown', (e) => {
    if (touch.stickId !== -1) return;
    touch.stickId = e.pointerId;
    move.setPointerCapture(e.pointerId);
    touch.ox = e.clientX;
    touch.oy = e.clientY;
    place();
    stick.classList.add('live');
    stickTo(e);
  });
  move.addEventListener('pointermove', (e) => {
    if (e.pointerId === touch.stickId) stickTo(e);
  });
  const stickEnd = (e: PointerEvent): void => {
    if (e.pointerId !== touch.stickId) return;
    touch.stickId = -1;
    touch.mf = touch.mr = touch.sprint = 0;
    knob.style.transform = '';
    stick.classList.remove('live', 'sprint');
    stick.style.left = stick.style.top = '';
  };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) move.addEventListener(ev, stickEnd);
  look.addEventListener('pointerdown', (e) => {
    if (touch.lookId !== -1) return;
    touch.lookId = e.pointerId;
    look.setPointerCapture(e.pointerId);
    touch.lx = e.clientX;
    touch.ly = e.clientY;
  });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch.lookId) return;
    dragX += e.clientX - touch.lx;
    dragY += e.clientY - touch.ly;
    touch.lx = e.clientX;
    touch.ly = e.clientY;
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    look.addEventListener(ev, (e) => {
      if (e.pointerId === touch.lookId) touch.lookId = -1;
    });
  }
  document.querySelectorAll<HTMLElement>('#touch .tbtn').forEach((b) => {
    const k = b.dataset.b;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('down');
      if (k === 'a') confirm = true;
      else if (k === 'b') touch.b = true;
      else if (k === 'x') touch.x = true;
      else if (k === 'rest') touch.rest = true;
      else if (k === 'nest') touch.nest = true;
      else if (k === 'cam') recenter = true;
      else if (k === 'menu') menu = true;
      else if (k === 'y') {
        // Tap: roar. Hold: the call wheel, centred on the button; slide toward a call and let go.
        const r = b.getBoundingClientRect();
        wheel.tx = r.left + r.width / 2;
        wheel.ty = r.top + r.height / 2;
        wheel.yDown = true;
        clearTimeout(wheel.yTimer);
        wheel.yTimer = window.setTimeout(() => {
          if (wheel.yDown && playing) openWheel('touch');
        }, 300);
      }
    });
    const up = (e: PointerEvent): void => {
      b.classList.remove('down');
      if (k === 'b') touch.b = false;
      if (k === 'x') touch.x = false;
      if (k === 'rest') touch.rest = false;
      if (k === 'nest') touch.nest = false;
      if (k === 'y' && wheel.yDown) {
        wheel.yDown = false;
        clearTimeout(wheel.yTimer);
        if (wheel.open) closeWheel(e.type === 'pointerup');
        else if (e.type === 'pointerup' && playing) call = 'auto';
      }
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(ev, up);
    if (k === 'y') {
      b.addEventListener('pointermove', (e) => {
        if (wheel.open && wheel.dev === 'touch') pickWheel(e.clientX - wheel.tx, e.clientY - wheel.ty, 28);
      });
    }
  });
  document.getElementById('touch')!.addEventListener('contextmenu', (e) => e.preventDefault());
}

// External confirm (a tap or click on an overlay card).
export const pressConfirm = (): void => {
  confirm = true;
};
export const pressMenu = (): void => {
  menu = true;
};

export function readInput(): RawInput {
  const k = (c: string): number => (keys.has(c) ? 1 : 0);
  let moveF = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
  let moveR = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
  let sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0;
  let lookX = 0, lookY = 0;
  let drink = keys.has('KeyG'), eat = keys.has('KeyE') || keys.has('KeyF'), rest = keys.has('KeyZ'), nest = keys.has('KeyN');

  const pad = navigator.getGamepads?.().find((p) => p && p.connected);
  if (pad) {
    state.padSeen = true;
    const [lx, ly] = radial(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const [rx, ry] = radial(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    const any = lx || ly || rx || ry || pad.buttons.some((b) => b.pressed);
    if (any) setDevice('pad');
    if (lx || ly) {
      moveR = lx;
      moveF = -ly;
    }
    const btn = (i: number): boolean => !!pad.buttons[i]?.pressed;
    const edge = (i: number): boolean => btn(i) && !padWas[i];
    let aEdge = edge(0), bHeld = btn(1);
    if (playing && wheel.open && wheel.dev === 'pad') {
      if (edge(11) || aEdge) closeWheel(true);
      else if (edge(1)) closeWheel(false);
      wheel.swallowAB = true;
    } else if (playing && edge(11)) openWheel('pad'); // right stick click
    if (wheel.swallowAB) {
      // A or B pressed to work the wheel must not also hatch, confirm or drink.
      aEdge = false;
      bHeld = false;
      if (!btn(0) && !btn(1)) wheel.swallowAB = false;
    }
    if (wheel.open && wheel.dev === 'pad') {
      pickWheel(rx, ry, 0.5); // the stick points at a call, not the camera
      lookX = lookY = 0;
    } else {
      lookX = rx;
      lookY = ry;
    }
    if (edge(3) && playing && !wheel.open) call = 'auto'; // Y: the roar that fits your condition
    if (!playing) {
      // Menus: D-pad left/right, or hold the stick over (repeats every 0.3 s).
      if (edge(14)) nav = -1;
      if (edge(15)) nav = 1;
      const ax = pad.axes[0] ?? 0, t = performance.now();
      if (Math.abs(ax) > 0.6) {
        if (t > navHold) {
          nav = ax > 0 ? 1 : -1;
          navHold = t + 300;
        }
      } else navHold = 0;
    }
    sprint = Math.max(sprint, pad.buttons[7]?.value ?? 0); // right trigger
    if (edge(10)) recenter = true; // left stick click: camera behind
    drink ||= bHeld; // B (hold)
    eat ||= btn(2) && !wheel.open; // X (hold)
    rest ||= (pad.buttons[6]?.value ?? 0) > 0.3; // left trigger (hold)
    nest ||= playing && btn(13); // D-pad down (hold)
    if (aEdge && !padConfirmWas) confirm = true;
    padConfirmWas = btn(0);
    pad.buttons.forEach((b, i) => (padWas[i] = b.pressed));
    const xb = !playing && !!pad.buttons[2]?.pressed; // X toggles rumble on the pause card
    if (xb && !padToggleWas) toggle = true;
    padToggleWas = xb;
    const st = !!pad.buttons[9]?.pressed; // Start
    if (st && !padMenuWas) menu = true;
    padMenuWas = st;
  }
  if (state.device === 'touch') {
    moveF = touch.mf;
    moveR = touch.mr;
    sprint = touch.sprint;
    drink ||= touch.b;
    eat ||= touch.x;
    rest ||= touch.rest;
    nest ||= touch.nest;
  }

  const m = Math.hypot(moveF, moveR);
  if (m > 1) {
    moveF /= m;
    moveR /= m;
  }
  // Held R past a quarter second opens the wheel.
  if (wheel.rDown >= 0 && !wheel.open && playing && performance.now() - wheel.rDown > 250) openWheel('keys');
  const out: RawInput = { moveF, moveR, sprint, lookX, lookY, dragX, dragY, recenter, drink, eat, rest, nest, confirm, menu, toggle, call, nav };
  dragX = dragY = 0;
  recenter = confirm = menu = toggle = false;
  call = null;
  nav = 0;
  return out;
}
