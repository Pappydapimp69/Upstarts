import { describe, expect, it } from 'vitest';
import { createWorld, PLAYER_ID, step, TICK_HZ, type World } from '../src/sim/world';
import { createDino, type Command } from '../src/sim/dino';
import { HERRERASAURUS } from '../src/sim/species';
import { WIND } from '../src/sim/scent';
import { createSauro } from '../src/sim/saurosuchus';
import type { SoundEvent } from '../src/sim/events';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

// Record every footfall event over n ticks.
function run(w: World, cmd: Command, ticks: number): SoundEvent[] {
  const out: SoundEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(w, cmd);
    out.push(...w.events.filter((e) => e.kind === 'step'));
  }
  return out;
}

describe('footfall events', () => {
  it('a walking adult steps about twice a stride, at about 62 dB; a sprint is louder', () => {
    const w = createWorld(1, 1, 1);
    w.sauros = [];
    w.herbivores = [];
    w.player = createDino(HERRERASAURUS, -6, -32, 0, 1); // a long, flat run north through the valley floor
    const walk = run(w, { moveX: 0, moveZ: 1, sprint: 0 }, 5 * TICK_HZ).filter((e) => e.id === PLAYER_ID);
    expect(walk.length).toBeGreaterThan(6);
    expect(walk[walk.length - 1].level).toBeGreaterThan(58);
    expect(walk[walk.length - 1].level).toBeLessThan(64);
    const sprint = run(w, { moveX: 0, moveZ: 1, sprint: 1 }, 5 * TICK_HZ).filter((e) => e.id === PLAYER_ID);
    expect(Math.max(...sprint.map((e) => e.level))).toBeGreaterThan(Math.max(...walk.map((e) => e.level)) + 10);
  });

  it('a stalking Saurosuchus steps quieter than a patrolling one', () => {
    const w = createWorld(1, 1, 1);
    w.player.alive = false;
    w.herbivores = [];
    const s = createSauro(500, 0, 0);
    w.sauros = [s];
    s.lastMeal = 1e9;
    const patrol = run(w, idle, 4 * TICK_HZ).filter((e) => e.id === 500);
    s.state = 'stalk';
    s.target = -1;
    s.speed = 1.2;
    const quiet: SoundEvent[] = [];
    for (let i = 0; i < TICK_HZ; i++) {
      s.state = 'stalk';
      s.speed = 1.2;
      step(w, idle);
      quiet.push(...w.events.filter((e) => e.id === 500));
    }
    expect(patrol.length).toBeGreaterThan(0);
    if (quiet.length) expect(Math.max(...quiet.map((e) => e.level))).toBeLessThan(Math.max(...patrol.map((e) => e.level)));
  });
});

describe('hearing through events', () => {
  // A herd grazing, the player 30 m behind them, crosswind and outside their sight.
  function setup(): World {
    const w = createWorld(3, 1, 1);
    w.sauros = [];
    w.herbivores = w.herbivores.filter((h) => h.herd === 0);
    const cx = w.herbivores[0].x, cz = w.herbivores[0].z;
    w.herbivores.forEach((h, i) => {
      h.x = cx + (i % 3) * 2;
      h.z = cz + Math.floor(i / 3) * 2;
      h.yaw = Math.atan2(WIND.z, -WIND.x); // all facing crosswind, away from the player
      h.state = 'graze';
    });
    w.herds[0].goalX = cx;
    w.herds[0].goalZ = cz;
    w.player = createDino(HERRERASAURUS, cx - WIND.z * 30, cz + WIND.x * 30, Math.atan2(WIND.z, -WIND.x), 1);
    return w;
  }
  const fleeing = (w: World): number => w.herbivores.filter((h) => h.state === 'flee' || h.state === 'alert').length;

  it('standing still behind them, out of sight and smell, is not heard', () => {
    const quiet = setup();
    for (let i = 0; i < 3 * TICK_HZ; i++) step(quiet, idle);
    expect(fleeing(quiet)).toBe(0);
  });
});
