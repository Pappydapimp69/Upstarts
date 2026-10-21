import { describe, expect, it } from 'vitest';
import { addPlayer, createWorld, PLAYER_ID, step, TICK_HZ } from '../src/sim/world';
import type { Command } from '../src/sim/dino';

const idle: Command = { moveX: 0, moveZ: 0, sprint: 0 };

describe('player identity', () => {
  it('player 0 is slot 0, and world.player still points at it', () => {
    const w = createWorld(5);
    expect(w.players.length).toBe(1);
    expect(w.players[0].entity).toBe(PLAYER_ID);
    expect(w.player).toBe(w.players[0].dino);
  });

  it('a second player gets its own creature and its own commands', () => {
    const w = createWorld(5);
    w.sauros = [];
    const two = addPlayer(w, 'eodromaeus');
    expect(two.entity).toBe(PLAYER_ID - 1);
    expect(two.dino.owner).toBe(1);
    const x0 = w.players[0].dino.x, z0 = w.players[0].dino.z;
    const x1 = two.dino.x;
    for (let i = 0; i < 2 * TICK_HZ; i++) step(w, { 0: idle, 1: { moveX: 1, moveZ: 0, sprint: 0 } });
    expect(Math.hypot(w.players[0].dino.x - x0, w.players[0].dino.z - z0)).toBeLessThan(0.01);
    expect(two.dino.x - x1).toBeGreaterThan(1);
  });

  it('one player dying leaves the other alive', () => {
    const w = createWorld(5);
    w.sauros = [];
    const two = addPlayer(w, 'herrerasaurus');
    two.dino.needs.thirst = 0;
    two.dino.needs.health = 0.001;
    for (let i = 0; i < 5 * TICK_HZ && two.dino.alive; i++) step(w, idle);
    expect(two.dino.alive).toBe(false);
    expect(w.players[0].dino.alive).toBe(true);
  });
});
