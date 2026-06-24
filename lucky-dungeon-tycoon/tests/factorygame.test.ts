/**
 * factorygame.test.ts — Controller tests with a fake store and clock.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FactoryGame, KeyValueStore } from '../src/factory/FactoryGame.js';

class MemStore implements KeyValueStore {
  private m = new Map<string, string>();
  public getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  public setItem(k: string, v: string): void { this.m.set(k, v); }
  public removeItem(k: string): void { this.m.delete(k); }
}

function makeClock(start: number): { now: () => number; set: (t: number) => void } {
  let t = start;
  return { now: () => t, set: (v: number) => { t = v; } };
}

test('a fresh game boots with a built line and 25 gems', () => {
  const game = new FactoryGame(new MemStore(), () => 1_000_000);
  game.start();
  const s = game.getState();
  assert.equal(s.gems, 25);
  assert.equal(s.stations.cooking.level, 1);
});

test('progress persists across reloads through the store', () => {
  const store = new MemStore();
  const clock = makeClock(1_000_000);
  const g1 = new FactoryGame(store, clock.now);
  g1.start();
  for (let i = 0; i < 200; i++) g1.tick(0.1); // prime + earn
  const cash = g1.getState().cash;
  assert.ok(cash > 0);
  // New instance over the same store reloads the save.
  const g2 = new FactoryGame(store, clock.now);
  g2.start();
  assert.ok(Math.abs(g2.getState().cash - cash) < cash * 0.2 + 1);
});

test('an absence credits offline cash on start', () => {
  const store = new MemStore();
  const clock = makeClock(1_000_000);
  const g1 = new FactoryGame(store, clock.now);
  g1.start();
  const before = g1.getState().cash;
  // Jump the clock two hours forward and reload.
  clock.set(1_000_000 + 2 * 3600 * 1000);
  const g2 = new FactoryGame(store, clock.now);
  let offlineCash = 0;
  g2.on('offline', (r) => { offlineCash = r.cash; });
  g2.start();
  assert.ok(offlineCash > 0, 'offline cash credited');
  assert.ok(g2.getState().cash > before, 'cash increased while away');
});

test('the daily reward is offered once per day and grants gems + cash', () => {
  const store = new MemStore();
  const clock = makeClock(5 * 86_400_000);
  const game = new FactoryGame(store, clock.now);
  let offered = 0;
  game.on('daily', () => { offered += 1; });
  game.start();
  assert.equal(offered, 1);
  const gemsBefore = game.getState().gems;
  const reward = game.claimDaily();
  assert.ok(reward && reward.gemReward > 0);
  assert.equal(game.getState().gems, gemsBefore + reward.gemReward);
  // Claiming again same day does nothing.
  assert.equal(game.claimDaily(), null);
});

test('export/import round-trips the save and rejects junk', () => {
  const game = new FactoryGame(new MemStore(), () => 1_000_000);
  game.start();
  for (let i = 0; i < 300; i++) game.tick(0.1); // earn enough to upgrade
  game.upgradeStation('cooking', 1);
  const code = game.exportSave();
  const other = new FactoryGame(new MemStore(), () => 1_000_000);
  other.start();
  assert.ok(other.importSave(code));
  assert.equal(other.getState().stations.cooking.level, game.getState().stations.cooking.level);
  assert.equal(other.importSave('not-a-code'), false);
});

test('sanitize clamps hostile values', () => {
  const game = new FactoryGame(new MemStore(), () => 1_000_000);
  const dirty = {
    kind: 'factory' as const,
    stations: { cooking: { level: -5, workers: NaN, output: Infinity } },
    cash: -1, gems: 'lots' as unknown as number,
  };
  const clean = game.sanitize(dirty as never);
  assert.equal(clean.stations.cooking.level, 1);
  assert.equal(clean.stations.cooking.workers, 0);
  assert.equal(clean.cash, 0);
  assert.ok(Number.isFinite(clean.stations.cooking.output));
});
