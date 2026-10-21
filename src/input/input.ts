// Raw player input from keyboard, mouse and gamepad. Camera-relative; the
// camera turns it into a world-space sim Command.
export interface RawInput {
  moveF: number; // -1..1 forward
  moveR: number; // -1..1 right
  sprint: number; // 0..1
  lookX: number; // rad/s-ish camera yaw rate from a stick
  lookY: number;
  dragX: number; // mouse drag pixels since last read
  dragY: number;
  recenter: boolean;
  drink: boolean; // held
  eat: boolean; // held
  confirm: boolean; // pressed
}

const keys = new Set<string>();
let dragX = 0, dragY = 0, dragging = false, recenter = false, confirm = false;
let padConfirmWas = false;

export function initInput(canvas: HTMLElement): void {
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'KeyC') recenter = true;
    if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) confirm = true;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dragX += e.movementX;
    dragY += e.movementY;
  });
}

const dead = (v: number, z = 0.15): number => (Math.abs(v) < z ? 0 : (v - Math.sign(v) * z) / (1 - z));

export function readInput(): RawInput {
  const k = (c: string): number => (keys.has(c) ? 1 : 0);
  let moveF = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
  let moveR = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
  let sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0;
  let lookX = 0, lookY = 0;
  let drink = keys.has('KeyG'), eat = keys.has('KeyE');

  const pad = navigator.getGamepads?.().find((p) => p && p.connected);
  if (pad) {
    const lx = dead(pad.axes[0] ?? 0), ly = dead(pad.axes[1] ?? 0);
    if (lx || ly) {
      moveR = lx;
      moveF = -ly;
    }
    lookX = dead(pad.axes[2] ?? 0);
    lookY = dead(pad.axes[3] ?? 0);
    sprint = Math.max(sprint, pad.buttons[7]?.value ?? 0); // right trigger
    if (pad.buttons[11]?.pressed) recenter = true; // right stick click
    drink ||= !!pad.buttons[1]?.pressed; // B (hold)
    eat ||= !!pad.buttons[2]?.pressed; // X (hold)
    const a = !!pad.buttons[0]?.pressed; // A
    if (a && !padConfirmWas) confirm = true;
    padConfirmWas = a;
  }

  const m = Math.hypot(moveF, moveR);
  if (m > 1) {
    moveF /= m;
    moveR /= m;
  }
  const out: RawInput = { moveF, moveR, sprint, lookX, lookY, dragX, dragY, recenter, drink, eat, confirm };
  dragX = dragY = 0;
  recenter = confirm = false;
  return out;
}
