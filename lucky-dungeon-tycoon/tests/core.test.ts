/**
 * core.test.ts — Unit tests for the Lucky Dungeon Tycoon core architecture.
 *
 * Runs on Node's built-in test runner (node --test); no test framework
 * dependency. Randomness is controlled everywhere via the injectable RNG
 * (GameStateManager) and roll parameter (SpinEngine), so every assertion is
 * deterministic except the explicitly probabilistic rewarded-ad check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EconomyEngine } from '../src/EconomyEngine.js';
import { SpinEngine } from '../src/SpinEngine.js';
import { GameStateManager } from '../src/GameStateManager.js';
import { MonetizationBridge } from '../src/MonetizationBridge.js';
import { EventBus } from '../src/EventBus.js';
import {
  MAX_SHIELDS,
  UserProfile,
  cloneProfile,
  createDefaultProfile,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// EconomyEngine — curves
// ---------------------------------------------------------------------------

test('getUpgradeCost follows 100 * 1.62^level, rounded', () => {
  assert.equal(EconomyEngine.getUpgradeCost(0), 100);
  assert.equal(EconomyEngine.getUpgradeCost(1), Math.round(100 * 1.62));
  assert.equal(EconomyEngine.getUpgradeCost(10), Math.round(100 * Math.pow(1.62, 10)));
});

test('getBaseGain follows 10 * 1.45^level, rounded', () => {
  assert.equal(EconomyEngine.getBaseGain(0), 10);
  assert.equal(EconomyEngine.getBaseGain(1), Math.round(10 * 1.45));
  assert.equal(EconomyEngine.getBaseGain(20), Math.round(10 * Math.pow(1.45, 20)));
});

test('curves clamp invalid levels to 0', () => {
  assert.equal(EconomyEngine.getUpgradeCost(-5), 100);
  assert.equal(EconomyEngine.getUpgradeCost(NaN), 100);
  assert.equal(EconomyEngine.getBaseGain(-1), 10);
  assert.equal(EconomyEngine.getBaseGain(Infinity), 10);
  // Fractional levels floor to the integer level below.
  assert.equal(EconomyEngine.getBaseGain(2.9), EconomyEngine.getBaseGain(2));
});

// ---------------------------------------------------------------------------
// EconomyEngine — short-scale formatter
// ---------------------------------------------------------------------------

test('formatCurrency matches the spec examples', () => {
  assert.equal(EconomyEngine.formatCurrency(1_250_000), '1.25M');
  assert.equal(EconomyEngine.formatCurrency(5_400_000_000_000), '5.40T');
});

test('formatCurrency renders sub-1000 values as whole numbers', () => {
  assert.equal(EconomyEngine.formatCurrency(0), '0');
  assert.equal(EconomyEngine.formatCurrency(999), '999');
  assert.equal(EconomyEngine.formatCurrency(999.99), '999');
  assert.equal(EconomyEngine.formatCurrency(-12.7), '-12');
});

test('formatCurrency tier boundaries and truncation', () => {
  assert.equal(EconomyEngine.formatCurrency(1_000), '1.00K');
  // Truncation, not rounding: 999,999 must not display as "1000.00K".
  assert.equal(EconomyEngine.formatCurrency(999_999), '999.99K');
  assert.equal(EconomyEngine.formatCurrency(1_000_000), '1.00M');
  assert.equal(EconomyEngine.formatCurrency(1e9), '1.00B');
  assert.equal(EconomyEngine.formatCurrency(1e12), '1.00T');
  assert.equal(EconomyEngine.formatCurrency(1e15), '1.00Qa');
  assert.equal(EconomyEngine.formatCurrency(1e18), '1.00Qi');
  assert.equal(EconomyEngine.formatCurrency(1e21), '1.00Sx');
  assert.equal(EconomyEngine.formatCurrency(1e24), '1.00Sp');
  assert.equal(EconomyEngine.formatCurrency(1e27), '1.00Oc');
  assert.equal(EconomyEngine.formatCurrency(1e30), '1.00No');
  assert.equal(EconomyEngine.formatCurrency(1e33), '1.00Dc');
});

test('formatCurrency falls back to scientific notation beyond Dc', () => {
  assert.equal(EconomyEngine.formatCurrency(1e36), '1.00e+36');
  assert.equal(EconomyEngine.formatCurrency(-2.5e40), '-2.50e+40');
});

test('formatCurrency is total over degenerate inputs', () => {
  assert.equal(EconomyEngine.formatCurrency(NaN), '0');
  assert.equal(EconomyEngine.formatCurrency(Infinity), '∞');
  assert.equal(EconomyEngine.formatCurrency(-Infinity), '-∞');
  assert.equal(EconomyEngine.formatCurrency(-1_250_000), '-1.25M');
});

// ---------------------------------------------------------------------------
// SpinEngine
// ---------------------------------------------------------------------------

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { ...createDefaultProfile(), ...overrides };
}

test('spin bands resolve per the 50/25/15/10 table, including boundaries', () => {
  const cases: Array<[number, string]> = [
    [0, 'GOLD_MIN'],
    [0.4999, 'GOLD_MIN'],
    [0.5, 'GOLD_MAJ'],
    [0.7499, 'GOLD_MAJ'],
    [0.75, 'SHIELD'],
    [0.8999, 'SHIELD'],
    [0.9, 'RAID'],
    [0.9999, 'RAID'],
  ];
  for (const [roll, expected] of cases) {
    const result = SpinEngine.executeSpin(profile(), roll);
    assert.equal(result.type, expected, `roll=${roll}`);
  }
});

test('out-of-range injected rolls are clamped, not dropped', () => {
  assert.equal(SpinEngine.executeSpin(profile(), -3).type, 'GOLD_MIN');
  assert.equal(SpinEngine.executeSpin(profile(), 1).type, 'RAID');
  assert.equal(SpinEngine.executeSpin(profile(), 7).type, 'RAID');
});

test('spin deducts exactly 1 energy and reports it', () => {
  const p = profile({ energy: 5 });
  const result = SpinEngine.executeSpin(p, 0.1);
  assert.equal(p.energy, 4);
  assert.equal(result.energyConsumed, 1);
});

test('spin throws on insufficient energy without side effects', () => {
  const p = profile({ energy: 0, gold: 50 });
  assert.throws(() => SpinEngine.executeSpin(p, 0.1), /INSUFFICIENT_ENERGY/);
  assert.equal(p.energy, 0);
  assert.equal(p.gold, 50);
});

test('gold payouts scale from getBaseGain at the dungeon level', () => {
  const level = 4;
  const gain = EconomyEngine.getBaseGain(level);

  const minor = profile({ dungeonLevel: level });
  assert.equal(SpinEngine.executeSpin(minor, 0.1).value, gain);
  assert.equal(minor.gold, gain);

  const major = profile({ dungeonLevel: level });
  assert.equal(SpinEngine.executeSpin(major, 0.6).value, gain * 3);

  const raid = profile({ dungeonLevel: level });
  assert.equal(SpinEngine.executeSpin(raid, 0.95).value, gain * 8);
});

test('SHIELD grants a shield below the cap, gold at the cap', () => {
  const below = profile({ shields: MAX_SHIELDS - 1 });
  const grant = SpinEngine.executeSpin(below, 0.8);
  assert.equal(below.shields, MAX_SHIELDS);
  assert.equal(grant.value, 1);
  assert.equal(below.gold, 0);

  const capped = profile({ shields: MAX_SHIELDS, dungeonLevel: 2 });
  const compensation = Math.round(EconomyEngine.getBaseGain(2) * 1.5);
  const comp = SpinEngine.executeSpin(capped, 0.8);
  assert.equal(capped.shields, MAX_SHIELDS);
  assert.equal(comp.value, compensation);
  assert.equal(capped.gold, compensation);
});

test('spin updates lastSaveTimestamp and snapshots deeply', () => {
  const p = profile({ lastSaveTimestamp: 1 });
  const before = Date.now();
  const result = SpinEngine.executeSpin(p, 0.1);
  assert.ok(p.lastSaveTimestamp >= before);
  assert.equal(result.timestamp, p.lastSaveTimestamp);

  assert.deepEqual(result.stateSnapshot, p);
  result.stateSnapshot.gold = -999;
  assert.notEqual(p.gold, -999);
});

// ---------------------------------------------------------------------------
// GameStateManager — offline simulation
// ---------------------------------------------------------------------------

const alwaysRaid = (): number => 0.0;
const neverRaid = (): number => 0.99;

test('offline regen grants 1 energy per 300s, capped at maxEnergy', () => {
  const gsm = new GameStateManager('t1', neverRaid);
  const base = profile({ energy: 0, maxEnergy: 30 });

  assert.equal(gsm.applyOfflineRegen(base, 299).state.energy, 0);
  assert.equal(gsm.applyOfflineRegen(base, 300).state.energy, 1);
  assert.equal(gsm.applyOfflineRegen(base, 3_000).state.energy, 10);
  assert.equal(gsm.applyOfflineRegen(base, 1_000_000).state.energy, 30);

  const full = profile({ energy: 30, maxEnergy: 30 });
  const out = gsm.applyOfflineRegen(full, 10_000);
  assert.equal(out.state.energy, 30);
  assert.equal(out.logs.length, 0);
});

test('raid determinator fires only at >= 4h and rng < 0.7', () => {
  const raid = new GameStateManager('t2', alwaysRaid);
  const rich = profile({ gold: 1_000, energy: 30 });

  // Below the threshold: never raids, even with a raid-guaranteeing rng.
  assert.equal(raid.applyOfflineRegen(rich, 14_399).state.gold, 1_000);

  // At the threshold with no shields: steals 15%, floored.
  const robbed = raid.applyOfflineRegen(rich, 14_400);
  assert.equal(robbed.state.gold, 850);
  assert.deepEqual(robbed.logs, ['Raid stole 150 gold']);

  // rng >= 0.7: eligible window but no attack.
  const safe = new GameStateManager('t3', neverRaid);
  assert.equal(safe.applyOfflineRegen(rich, 14_400).state.gold, 1_000);
});

test('a shield absorbs the raid and is consumed', () => {
  const gsm = new GameStateManager('t4', alwaysRaid);
  const guarded = profile({ gold: 1_000, energy: 30, shields: 2 });
  const out = gsm.applyOfflineRegen(guarded, 14_400);
  assert.equal(out.state.shields, 1);
  assert.equal(out.state.gold, 1_000);
  assert.deepEqual(out.logs, ['Shield blocked raid']);
});

test('applyOfflineRegen never mutates its input and tolerates bad windows', () => {
  const gsm = new GameStateManager('t5', alwaysRaid);
  const original = profile({ gold: 500, energy: 3, shields: 1 });
  const frozen = cloneProfile(original);

  gsm.applyOfflineRegen(original, 100_000);
  assert.deepEqual(original, frozen);

  for (const bad of [-5_000, NaN, Infinity]) {
    const out = gsm.applyOfflineRegen(original, bad);
    assert.deepEqual(out.state, frozen);
    assert.equal(out.logs.length, 0);
  }
});

test('raid floors the steal and gold never goes negative', () => {
  const gsm = new GameStateManager('t6', alwaysRaid);
  // 15% of 7 gold floors to 1; 15% of 0 floors to 0.
  assert.equal(gsm.applyOfflineRegen(profile({ gold: 7, energy: 30 }), 14_400).state.gold, 6);
  assert.equal(gsm.applyOfflineRegen(profile({ gold: 0, energy: 30 }), 14_400).state.gold, 0);
});

// ---------------------------------------------------------------------------
// GameStateManager — persistence & anti-cheat
// ---------------------------------------------------------------------------

/** Fresh isolated in-memory store per test. */
class FakeStore {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}

test('first launch initialises and persists a default profile', () => {
  const store = new FakeStore();
  const gsm = new GameStateManager('key', neverRaid, store);
  const state = gsm.loadState();
  assert.equal(state.gold, 0);
  assert.equal(state.energy, state.maxEnergy > 30 ? state.energy : 30);
  assert.ok(state.id.startsWith('ldt_'));
  assert.ok(store.getItem('key') !== null);
});

test('save/load round-trips the profile', () => {
  const store = new FakeStore();
  const gsm = new GameStateManager('key', neverRaid, store);
  const state = gsm.loadState();
  state.gold = 12_345;
  state.dungeonLevel = 7;
  gsm.saveState(state);

  const reloaded = gsm.loadState();
  assert.equal(reloaded.gold, 12_345);
  assert.equal(reloaded.dungeonLevel, 7);
  assert.equal(reloaded.id, state.id);
});

test('corrupted or non-object records yield a fresh profile', () => {
  for (const garbage of ['not json {{{', '[1,2,3]', '"a string"', 'null']) {
    const store = new FakeStore();
    store.setItem('key', garbage);
    const gsm = new GameStateManager('key', neverRaid, store);
    const state = gsm.loadState();
    assert.equal(state.gold, 0);
    assert.ok(state.id.startsWith('ldt_'));
  }
});

test('tampered fields are clamped to their documented domains', () => {
  const store = new FakeStore();
  store.setItem('key', JSON.stringify({
    id: 'ldt_player',
    gold: -9_999,            // negative -> default 0
    gems: 12.9,              // fractional -> floored
    energy: 500,             // over cap -> clamped to maxEnergy
    maxEnergy: 40,
    dungeonLevel: 'hacked',  // wrong type -> default 0
    shields: 99,             // over cap -> clamped to MAX_SHIELDS
    lastSaveTimestamp: Date.now(),
  }));
  const gsm = new GameStateManager('key', neverRaid, store);
  const state = gsm.loadState();
  assert.equal(state.id, 'ldt_player');
  assert.equal(state.gold, 0);
  assert.equal(state.gems, 12);
  assert.equal(state.energy, 40);
  assert.equal(state.maxEnergy, 40);
  assert.equal(state.dungeonLevel, 0);
  assert.equal(state.shields, MAX_SHIELDS);
});

test('future-dated save timestamps grant zero offline credit', () => {
  const store = new FakeStore();
  store.setItem('key', JSON.stringify({
    ...createDefaultProfile(),
    energy: 0,
    lastSaveTimestamp: Date.now() + 86_400_000, // one day in the future
  }));
  const gsm = new GameStateManager('key', alwaysRaid, store);
  const { state, logs } = gsm.loadStateWithLogs();
  assert.equal(state.energy, 0);
  assert.equal(logs.length, 0);
  assert.ok(state.lastSaveTimestamp <= Date.now());
});

test('loadStateWithLogs applies offline events on launch', () => {
  const store = new FakeStore();
  const fourHoursAgo = Date.now() - 14_400_000;
  store.setItem('key', JSON.stringify({
    ...createDefaultProfile(fourHoursAgo),
    gold: 1_000,
    energy: 0,
    lastSaveTimestamp: fourHoursAgo,
  }));
  const gsm = new GameStateManager('key', alwaysRaid, store);
  const { state, logs } = gsm.loadStateWithLogs();
  assert.equal(state.energy, 30); // 14400 / 300 = 48 regenerated, capped at 30
  assert.equal(state.gold, 850);
  assert.ok(logs.some((l) => l.includes('Raid stole 150 gold')));
});

test('clearState removes the record so the next load is fresh', () => {
  const store = new FakeStore();
  const gsm = new GameStateManager('key', neverRaid, store);
  const first = gsm.loadState();
  gsm.clearState();
  const second = gsm.loadState();
  assert.notEqual(second.id, first.id);
});

// ---------------------------------------------------------------------------
// MonetizationBridge
// ---------------------------------------------------------------------------

test('buyEnergyWithGems deducts 10 gems, adds 50 energy, never mutates input', () => {
  const before = profile({ gems: 25, energy: 30 });
  const after = MonetizationBridge.buyEnergyWithGems(before);
  assert.equal(after.gems, 15);
  assert.equal(after.energy, 80); // intentionally overfills past maxEnergy
  assert.equal(before.gems, 25);
  assert.equal(before.energy, 30);
});

test('buyEnergyWithGems throws on insufficient gems', () => {
  assert.throws(
    () => MonetizationBridge.buyEnergyWithGems(profile({ gems: 9 })),
    /INSUFFICIENT_GEMS/,
  );
  assert.throws(
    () => MonetizationBridge.buyEnergyWithGems(profile({ gems: NaN })),
    /INSUFFICIENT_GEMS/,
  );
});

test('showRewardedAd resolves a boolean after the simulated delay', async () => {
  const started = Date.now();
  const granted = await MonetizationBridge.showRewardedAd();
  assert.equal(typeof granted, 'boolean');
  assert.ok(Date.now() - started >= 950);
});

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

test('on/emit/off deliver and remove typed subscribers', () => {
  const bus = new EventBus();
  const seen: string[] = [];
  const cb = (n: { message: string; severity: 'info' | 'success' | 'warning' | 'error' }): void => {
    seen.push(n.message);
  };

  bus.on('ui:notification', cb);
  bus.emit('ui:notification', { message: 'a', severity: 'info' });
  bus.off('ui:notification', cb);
  bus.emit('ui:notification', { message: 'b', severity: 'info' });
  assert.deepEqual(seen, ['a']);
});

test('duplicate subscriptions are suppressed; thunk unsubscribes', () => {
  const bus = new EventBus();
  let hits = 0;
  const cb = (): void => { hits += 1; };
  const off = bus.on('ui:popup_energy', cb);
  bus.on('ui:popup_energy', cb);
  assert.equal(bus.listenerCount('ui:popup_energy'), 1);

  bus.emit('ui:popup_energy', { energy: 0, maxEnergy: 30 });
  assert.equal(hits, 1);

  off();
  bus.emit('ui:popup_energy', { energy: 0, maxEnergy: 30 });
  assert.equal(hits, 1);
  assert.equal(bus.listenerCount('ui:popup_energy'), 0);
});

test('once fires exactly one time', () => {
  const bus = new EventBus();
  let hits = 0;
  bus.once('state:updated', () => { hits += 1; });
  const p = profile();
  bus.emit('state:updated', p);
  bus.emit('state:updated', p);
  assert.equal(hits, 1);
  assert.equal(bus.listenerCount('state:updated'), 0);
});

test('a throwing subscriber does not block later subscribers', () => {
  const bus = new EventBus();
  const order: string[] = [];
  bus.on('ui:notification', () => { order.push('first'); });
  bus.on('ui:notification', () => { throw new Error('boom'); });
  bus.on('ui:notification', () => { order.push('third'); });
  bus.emit('ui:notification', { message: 'x', severity: 'error' });
  assert.deepEqual(order, ['first', 'third']);
});

test('subscribers may unsubscribe safely during emit', () => {
  const bus = new EventBus();
  let secondRan = false;
  const first = (): void => { bus.off('ui:notification', first); };
  bus.on('ui:notification', first);
  bus.on('ui:notification', () => { secondRan = true; });
  bus.emit('ui:notification', { message: 'x', severity: 'info' });
  assert.equal(secondRan, true);
  assert.equal(bus.listenerCount('ui:notification'), 1);
});

test('removeAllListeners drops every subscriber', () => {
  const bus = new EventBus();
  bus.on('state:updated', () => undefined);
  bus.on('spin:result', () => undefined);
  bus.removeAllListeners();
  assert.equal(bus.listenerCount('state:updated'), 0);
  assert.equal(bus.listenerCount('spin:result'), 0);
});

// ---------------------------------------------------------------------------
// Integration: full game loop
// ---------------------------------------------------------------------------

test('spin -> save -> reload preserves the exact post-spin state', () => {
  const store = new FakeStore();
  const gsm = new GameStateManager('loop', neverRaid, store);
  const state = gsm.loadState();

  const result = SpinEngine.executeSpin(state, 0.6); // GOLD_MAJ
  gsm.saveState(state);

  const reloaded = gsm.loadState();
  assert.equal(reloaded.gold, result.stateSnapshot.gold);
  assert.equal(reloaded.energy, result.stateSnapshot.energy);
  assert.equal(reloaded.id, state.id);
});
