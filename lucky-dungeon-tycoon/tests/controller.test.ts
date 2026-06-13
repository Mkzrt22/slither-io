/**
 * controller.test.ts — Unit tests for the GameController application layer.
 *
 * Each test wires a controller to an isolated in-memory store and a private
 * EventBus, then asserts both the state transitions and the events broadcast
 * to the (absent) view.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EconomyEngine } from '../src/EconomyEngine.js';
import { EventBus, GameEventMap } from '../src/EventBus.js';
import { GameController } from '../src/GameController.js';
import { GameStateManager } from '../src/GameStateManager.js';
import { UserProfile, createDefaultProfile } from '../src/types.js';

class FakeStore {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}

interface Harness {
  controller: GameController;
  bus: EventBus;
  store: FakeStore;
  gsm: GameStateManager;
  events: { [E in keyof GameEventMap]: GameEventMap[E][] };
}

/** Builds a controller over a seeded profile and records every bus event. */
function harness(seed?: Partial<UserProfile>): Harness {
  const store = new FakeStore();
  if (seed) {
    store.setItem('hkey', JSON.stringify({
      ...createDefaultProfile(),
      lastSaveTimestamp: Date.now(),
      ...seed,
    }));
  }
  const gsm = new GameStateManager('hkey', () => 0.99, store);
  const bus = new EventBus();

  const events: Harness['events'] = {
    'state:updated': [],
    'spin:result': [],
    'ui:popup_energy': [],
    'ui:notification': [],
  };
  bus.on('state:updated', (p) => events['state:updated'].push(p));
  bus.on('spin:result', (r) => events['spin:result'].push(r));
  bus.on('ui:popup_energy', (p) => events['ui:popup_energy'].push(p));
  bus.on('ui:notification', (n) => events['ui:notification'].push(n));

  const controller = new GameController(gsm, bus);
  return { controller, bus, store, gsm, events };
}

test('construction announces the loaded state on the bus', () => {
  const { controller, events } = harness({ gold: 555 });
  assert.equal(events['state:updated'].length, 1);
  assert.equal(events['state:updated'][0].gold, 555);
  assert.equal(controller.getState().gold, 555);
});

test('offline raid logs are replayed as notifications on boot', () => {
  const store = new FakeStore();
  const fourHoursAgo = Date.now() - 14_400_000;
  store.setItem('hkey', JSON.stringify({
    ...createDefaultProfile(fourHoursAgo),
    gold: 1_000,
    shields: 0,
    lastSaveTimestamp: fourHoursAgo,
  }));
  const gsm = new GameStateManager('hkey', () => 0.0, store); // raid guaranteed
  const bus = new EventBus();
  const notes: GameEventMap['ui:notification'][] = [];
  bus.on('ui:notification', (n) => notes.push(n));

  new GameController(gsm, bus);
  const raidNote = notes.find((n) => n.message.includes('Raid stole'));
  assert.ok(raidNote);
  assert.equal(raidNote.severity, 'warning');
});

test('spin broadcasts the result and the persisted state', () => {
  const { controller, events, gsm } = harness();
  const result = controller.spin([0.1, 0.1, 0.1]); // triple COIN jackpot

  assert.ok(result);
  assert.equal(result.outcome, 'JACKPOT');
  assert.equal(events['spin:result'].length, 1);
  assert.equal(events['state:updated'].length, 2); // boot + spin
  assert.equal(gsm.loadState().gold, result.stateSnapshot.gold);
});

test('spinning with no energy requests the refill popup instead of throwing', () => {
  const { controller, events } = harness({ energy: 0 });
  const result = controller.spin([0.1, 0.5, 0.9]);

  assert.equal(result, null);
  assert.equal(events['spin:result'].length, 0);
  assert.equal(events['ui:popup_energy'].length, 1);
  assert.equal(events['ui:popup_energy'][0].energy, 0);
});

test('emitted state is a snapshot, not a live reference', () => {
  const { controller, events } = harness();
  controller.spin([0.1, 0.5, 0.9]);
  const broadcast = events['state:updated'][1];
  broadcast.gold = -1;
  assert.notEqual(controller.getState().gold, -1);
});

test('upgradeDungeon deducts the curve cost and bumps the level', () => {
  const cost = EconomyEngine.getUpgradeCost(0);
  const { controller, events } = harness({ gold: cost + 5 });

  assert.equal(controller.upgradeDungeon(), true);
  const state = controller.getState();
  assert.equal(state.gold, 5);
  assert.equal(state.dungeonLevel, 1);
  assert.equal(controller.getNextUpgradeCost(), EconomyEngine.getUpgradeCost(1));
  assert.ok(events['ui:notification'].some((n) => n.severity === 'success'));
});

test('an unaffordable upgrade warns and changes nothing', () => {
  const { controller, events } = harness({ gold: 10 });
  assert.equal(controller.upgradeDungeon(), false);
  assert.equal(controller.getState().gold, 10);
  assert.equal(controller.getState().dungeonLevel, 0);
  assert.equal(events['ui:notification'][0].severity, 'warning');
});

test('buyEnergyWithGems applies the purchase atomically', () => {
  const { controller } = harness({ gems: 10, energy: 1 });
  assert.equal(controller.buyEnergyWithGems(), true);
  const state = controller.getState();
  assert.equal(state.gems, 0);
  assert.equal(state.energy, 51);
});

test('a declined gem purchase emits an error and leaves state intact', () => {
  const { controller, events } = harness({ gems: 9, energy: 1 });
  assert.equal(controller.buyEnergyWithGems(), false);
  assert.equal(controller.getState().gems, 9);
  assert.equal(controller.getState().energy, 1);
  assert.ok(events['ui:notification'].some((n) => n.severity === 'error'));
});

test('tickRegen grants 1 energy per 300s and preserves partial progress', () => {
  const { controller } = harness({ energy: 0, maxEnergy: 30 });
  const t0 = Date.now();

  controller.tickRegen(t0 + 299_000);
  assert.equal(controller.getState().energy, 0);

  controller.tickRegen(t0 + 450_000); // 1.5 intervals -> 1 point, 0.5 banked
  assert.equal(controller.getState().energy, 1);

  controller.tickRegen(t0 + 600_000); // completes the banked half-interval
  assert.equal(controller.getState().energy, 2);
});

test('tickRegen clamps at maxEnergy and does not bank time while full', () => {
  const { controller } = harness({ energy: 29, maxEnergy: 30 });
  const t0 = Date.now();

  controller.tickRegen(t0 + 3_000_000); // 10 intervals, but only 1 slot free
  assert.equal(controller.getState().energy, 30);

  // A long stretch at full tank must not pay out retroactively after a spend.
  controller.tickRegen(t0 + 9_000_000);
  controller.spin([0.1, 0.5, 0.9]);
  controller.tickRegen(t0 + 9_001_000);
  assert.equal(controller.getState().energy, 29);
});

test('stop() persists the final state', () => {
  const { controller, gsm } = harness({ gold: 0 });
  controller.spin([0.1, 0.5, 0.9]);
  controller.stop();
  assert.equal(gsm.loadState().gold, controller.getState().gold);
});
