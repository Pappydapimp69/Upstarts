import { restore, snapshot } from '../sim/save';
import type { World } from '../sim/world';

// The save in this browser: one slot, the latest only (sim/save.ts says why). Every write is wrapped: a full,
// blocked or private-mode localStorage just means no save, never a broken game.
const KEY = 'upstarts.save';

export function loadSave(): World | null {
  try {
    const t = localStorage.getItem(KEY);
    return t ? restore(JSON.parse(t)) : null;
  } catch {
    return null;
  }
}

export function writeSave(w: World): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot(w, Date.now())));
  } catch {
    /* no room, or no storage: play on unsaved */
  }
}
