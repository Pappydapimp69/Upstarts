// Raw player input from keyboard and mouse, gamepad, or touch. Camera-relative; the
// camera turns it into a world-space sim Command. Touch controls are the Dlist demo's:
// a floating stick on the left (push past the ring to sprint), drag on the right to look.
import { smooth } from '../sim/math';

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
  confirm: boolean; // pressed
  menu: boolean; // pressed
  toggle: boolean; // pressed: the option on the pause card (rumble)
}

const keys = new Set<string>();
let dragX = 0, dragY = 0, dragging = false, recenter = false, confirm = false, menu = false, toggle = false;
let padToggleWas = false;
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

const touch = { mf: 0, mr: 0, sprint: 0, b: false, x: false, stickId: -1, lookId: -1, ox: 0, oy: 0, lx: 0, ly: 0 };

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
    if (e.code === 'Escape' && !e.repeat) menu = true;
    if (e.code === 'KeyR' && !e.repeat) toggle = true;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    setDevice('keys');
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
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
      else if (k === 'cam') recenter = true;
      else if (k === 'menu') menu = true;
    });
    const up = (): void => {
      b.classList.remove('down');
      if (k === 'b') touch.b = false;
      if (k === 'x') touch.x = false;
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(ev, up);
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
  let drink = keys.has('KeyG'), eat = keys.has('KeyE') || keys.has('KeyF');

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
    lookX = rx;
    lookY = ry;
    sprint = Math.max(sprint, pad.buttons[7]?.value ?? 0); // right trigger
    if (pad.buttons[11]?.pressed) recenter = true; // right stick click
    drink ||= !!pad.buttons[1]?.pressed; // B (hold)
    eat ||= !!pad.buttons[2]?.pressed; // X (hold)
    const a = !!pad.buttons[0]?.pressed; // A
    if (a && !padConfirmWas) confirm = true;
    padConfirmWas = a;
    const xb = !!pad.buttons[2]?.pressed; // X (also eat; only read as a toggle while paused)
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
  }

  const m = Math.hypot(moveF, moveR);
  if (m > 1) {
    moveF /= m;
    moveR /= m;
  }
  const out: RawInput = { moveF, moveR, sprint, lookX, lookY, dragX, dragY, recenter, drink, eat, confirm, menu, toggle };
  dragX = dragY = 0;
  recenter = confirm = menu = toggle = false;
  return out;
}
