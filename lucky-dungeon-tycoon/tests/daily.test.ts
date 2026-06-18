/**
 * daily.test.ts — Daily reward streak + save export/import.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DailyEngine } from '../src/DailyEngine.js';
import { EventBus } from '../src/EventBus.js';
import { GameController } from '../src/GameController.js';
import { GameStateManager } from '../src/GameStateManager.js';
import { UserProfile, createDefaultProfile } from '../src/types.js';

const HOUR = 60 * 60 * 1000;

class FakeStore {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { ...createDefaultProfile(), ...overrides };
}

// ---------------------------------------------------------------------------
// DailyEngine
// ---------------------------------------------------------------------------

test('first-ever daily is claimable with streak 1', () => {
  const s = DailyEngine.status(profile({ lastDailyClaim: 0 }), 1_000_000, 0);
  assert.equal(s.claimable, true);
  assert.equal(s.streak, 1);
  assert.equal(s.gemReward, 3); // 2 + min(1,7)
  assert.equal(s.goldReward, 200); // floor of the scaled minimum
});

test('a just-claimed daily is not claimable again', () => {
  const now = 5_000_000;
  const s = DailyEngine.status(profile({ lastDailyClaim: now, dailyStreak: 1 }), now + HOUR, 0);
  assert.equal(s.claimable, false);
  assert.equal(s.streak, 1);
});

test('claiming the next day continues the streak; a missed day resets it', () => {
  const base = profile({ lastDailyClaim: 1_000_000, dailyStreak: 3 });
  // 24h later: claimable, streak 4.
  const next = DailyEngine.status(base, 1_000_000 + 24 * HOUR, 0);
  assert.equal(next.claimable, true);
  assert.equal(next.streak, 4);
  // 3 days later (> 48h): streak resets to 1.
  const missed = DailyEngine.status(base, 1_000_000 + 72 * HOUR, 0);
  assert.equal(missed.claimable, true);
  assert.equal(missed.streak, 1);
});

test('gold reward scales to ~30 minutes of production', () => {
  assert.equal(DailyEngine.goldReward(100), 100 * 1800);
  assert.equal(DailyEngine.gemReward(20), 9); // capped at streak 7 -> 2+7
});

// ---------------------------------------------------------------------------
// Controller: claim flow + boot event
// ---------------------------------------------------------------------------

function controllerWith(seed: Partial<UserProfile>, now: () => number): GameController {
  const store = new FakeStore();
  store.setItem('dk', JSON.stringify({ ...createDefaultProfile(), lastSaveTimestamp: now(), ...seed }));
  const gsm = new GameStateManager('dk', () => 0.99, store);
  return new GameController(gsm, new EventBus(), now);
}

test('claimDaily grants the reward once and blocks repeats', () => {
  let t = 10_000_000;
  const ctrl = controllerWith({ gems: 0, gold: 0, lastDailyClaim: 0 }, () => t);
  const first = ctrl.claimDaily();
  assert.ok(first);
  assert.equal(first.streak, 1);
  assert.equal(ctrl.getState().gems, first.gems);
  assert.equal(ctrl.getState().dailyStreak, 1);
  // Same day: nothing more.
  assert.equal(ctrl.claimDaily(), null);
});

test('the daily modal event fires on boot when claimable', () => {
  const store = new FakeStore();
  store.setItem('dk', JSON.stringify({ ...createDefaultProfile(), lastSaveTimestamp: Date.now(), lastDailyClaim: 0 }));
  const gsm = new GameStateManager('dk', () => 0.99, store);
  const bus = new EventBus();
  const fired: number[] = [];
  bus.on('ui:daily', (d) => fired.push(d.streak));
  new GameController(gsm, bus);
  assert.equal(fired.length, 1);
});

// ---------------------------------------------------------------------------
// Save export / import
// ---------------------------------------------------------------------------

test('a save round-trips through export then import', () => {
  const storeA = new FakeStore();
  storeA.setItem('ex', JSON.stringify(profile({
    gold: 123456, village: 4, gems: 77, lastSaveTimestamp: Date.now(),
  })));
  const gsmA = new GameStateManager('ex', () => 0.99, storeA);
  const code = new GameController(gsmA, new EventBus()).exportSave();
  assert.ok(code.length > 0);

  const storeB = new FakeStore();
  const gsmB = new GameStateManager('ex', () => 0.99, storeB);
  assert.equal(gsmB.importSave(code), true);
  const loaded = gsmB.loadState();
  assert.equal(loaded.gold, 123456);
  assert.equal(loaded.village, 4);
  assert.equal(loaded.gems, 77);
});

test('importing a malformed code fails without touching storage', () => {
  const store = new FakeStore();
  const gsm = new GameStateManager('ex', () => 0.99, store);
  assert.equal(gsm.importSave('not-base64!!'), false);
  assert.equal(gsm.importSave(''), false);
  assert.equal(store.getItem('ex'), null);
});
