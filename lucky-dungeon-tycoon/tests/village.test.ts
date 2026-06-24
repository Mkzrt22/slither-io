/**
 * village.test.ts — Unit tests for the village/building progression system.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EconomyEngine } from '../src/EconomyEngine.js';
import { EventBus, GameEventMap } from '../src/EventBus.js';
import { GameController } from '../src/GameController.js';
import { GameStateManager } from '../src/GameStateManager.js';
import { BUILDING_CONFIGS, VillageEngine } from '../src/VillageEngine.js';
import {
  BuildingType,
  UserProfile,
  createDefaultProfile,
  createEmptyBuildings,
} from '../src/types.js';

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { ...createDefaultProfile(), ...overrides };
}

function withBuildings(levels: Partial<Record<BuildingType, number>>): Record<BuildingType, number> {
  return { ...createEmptyBuildings(), ...levels };
}

class FakeStore {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}

function harness(seed?: Partial<UserProfile>): {
  controller: GameController;
  notes: GameEventMap['ui:notification'][];
} {
  const store = new FakeStore();
  if (seed) {
    store.setItem('vk', JSON.stringify({ ...createDefaultProfile(), lastSaveTimestamp: Date.now(), ...seed }));
  }
  const gsm = new GameStateManager('vk', () => 0.99, store);
  const bus = new EventBus();
  const notes: GameEventMap['ui:notification'][] = [];
  bus.on('ui:notification', (n) => notes.push(n));
  return { controller: new GameController(gsm, bus), notes };
}

// ---------------------------------------------------------------------------
// VillageEngine formulas
// ---------------------------------------------------------------------------

test('building cost grows geometrically per level', () => {
  const cfg = BUILDING_CONFIGS.mine;
  assert.equal(VillageEngine.getBuildingCost('mine', 0), cfg.baseCost);
  assert.equal(
    VillageEngine.getBuildingCost('mine', 8),
    Math.round(cfg.baseCost * Math.pow(cfg.costGrowth, 8)),
  );
});

test('building production is linear in level', () => {
  assert.equal(VillageEngine.getBuildingProduction('mine', 0), 0);
  assert.equal(VillageEngine.getBuildingProduction('farm', 5), BUILDING_CONFIGS.farm.baseProd * 5);
});

test('total levels sums all buildings', () => {
  const p = profile({ buildings: withBuildings({ mine: 4, farm: 3, castle: 2 }) });
  assert.equal(VillageEngine.getTotalLevels(p), 9);
});

test('required levels grow super-linearly with village', () => {
  assert.equal(VillageEngine.getRequiredLevels(1), 24); // 18 + 6
  assert.equal(VillageEngine.getRequiredLevels(2), 60); // 36 + 24
  assert.ok(VillageEngine.getRequiredLevels(3) > VillageEngine.getRequiredLevels(2));
});

test('canAdvance flips at the required total', () => {
  assert.equal(VillageEngine.canAdvance(profile({ buildings: withBuildings({ mine: 23 }) })), false);
  assert.equal(VillageEngine.canAdvance(profile({ buildings: withBuildings({ mine: 24 }) })), true);
});

test('village multiplier is 1.7^(v-1) and feeds the global multiplier', () => {
  assert.equal(VillageEngine.getVillageMultiplier(1), 1);
  assert.equal(VillageEngine.getVillageMultiplier(3), 1.7 * 1.7);
  const p = profile({ village: 2 });
  assert.equal(EconomyEngine.getGlobalMultiplier(p), 1.7); // floor1 × relic0 × village2
});

test('passive rate includes buildings scaled by the global multiplier', () => {
  const p = profile({ buildings: withBuildings({ mine: 10 }) });
  assert.equal(EconomyEngine.getPassiveRate(p), 10); // 1×10 × ×1

  p.village = 2; // ×1.7
  assert.equal(EconomyEngine.getPassiveRate(p), 17);
});

test('village names cycle with a tier marker', () => {
  assert.equal(VillageEngine.getVillageName(1), 'Food Truck');
  assert.equal(VillageEngine.getVillageName(3), 'Bistro');
  assert.equal(VillageEngine.getVillageName(9), 'Food Truck ✦2');
});

// ---------------------------------------------------------------------------
// Controller: upgrade & advance
// ---------------------------------------------------------------------------

test('upgradeBuilding deducts gold and raises the level and next cost', () => {
  const { controller } = harness({ gold: 100 });
  assert.equal(controller.getBuildingCost('mine'), 30);
  assert.equal(controller.upgradeBuilding('mine'), true);
  const s = controller.getState();
  assert.equal(s.buildings.mine, 1);
  assert.equal(s.gold, 70);
  assert.equal(controller.getBuildingCost('mine'), VillageEngine.getBuildingCost('mine', 1));
});

test('an unaffordable building upgrade warns and changes nothing', () => {
  const { controller, notes } = harness({ gold: 5 });
  assert.equal(controller.upgradeBuilding('castle'), false);
  assert.equal(controller.getState().buildings.castle, 0);
  assert.equal(controller.getState().gold, 5);
  assert.ok(notes.some((n) => n.severity === 'warning'));
});

test('bulk cost sums consecutive level costs', () => {
  const a = VillageEngine.getBuildingCost('mine', 0);
  const b = VillageEngine.getBuildingCost('mine', 1);
  const c = VillageEngine.getBuildingCost('mine', 2);
  assert.equal(VillageEngine.getBulkCost('mine', 0, 3), a + b + c);
});

test('getMaxAffordable returns the largest batch within budget', () => {
  const budget = VillageEngine.getBulkCost('mine', 0, 5);
  const max = VillageEngine.getMaxAffordable('mine', 0, budget);
  assert.equal(max.count, 5);
  assert.equal(max.cost, budget);
  // One gold short of the 5th level only affords 4.
  assert.equal(VillageEngine.getMaxAffordable('mine', 0, budget - 1).count, 4);
});

test('buyBuilding ×10 requires affording the whole batch', () => {
  const cost10 = VillageEngine.getBulkCost('mine', 0, 10);
  const poor = harness({ gold: cost10 - 1 });
  assert.equal(poor.controller.buyBuilding('mine', 10), 0);
  assert.equal(poor.controller.getState().buildings.mine, 0);

  const rich = harness({ gold: cost10 });
  assert.equal(rich.controller.buyBuilding('mine', 10), 10);
  assert.equal(rich.controller.getState().buildings.mine, 10);
  assert.equal(rich.controller.getState().gold, 0);
});

test('buyBuilding max buys as many levels as gold allows', () => {
  const budget = VillageEngine.getBulkCost('farm', 0, 7) + 3;
  const { controller } = harness({ gold: budget });
  const bought = controller.buyBuilding('farm', 'max');
  assert.equal(bought, 7);
  assert.equal(controller.getState().buildings.farm, 7);
  assert.equal(controller.getState().gold, 3); // remainder below the 8th cost
});

test('grantBonusGold credits gold and lifetime stats', () => {
  const { controller } = harness({ gold: 100 });
  controller.grantBonusGold(250);
  const s = controller.getState();
  assert.equal(s.gold, 350);
  assert.equal(s.stats.goldEarnedAll, 250);
});

test('milestone multiplier doubles production every 25 levels', () => {
  assert.equal(VillageEngine.getBuildingMultiplier(0), 1);
  assert.equal(VillageEngine.getBuildingMultiplier(24), 1);
  assert.equal(VillageEngine.getBuildingMultiplier(25), 2);
  assert.equal(VillageEngine.getBuildingMultiplier(50), 4);
  assert.equal(
    VillageEngine.getBuildingProduction('mine', 25),
    BUILDING_CONFIGS.mine.baseProd * 25 * 2,
  );
});

test('levelsToNextMilestone counts down within each band', () => {
  assert.equal(VillageEngine.levelsToNextMilestone(0), 25);
  assert.equal(VillageEngine.levelsToNextMilestone(24), 1);
  assert.equal(VillageEngine.levelsToNextMilestone(25), 25);
});

test('Rush boost doubles live passive income until it expires', () => {
  const store = new FakeStore();
  store.setItem('bk', JSON.stringify({
    ...createDefaultProfile(), lastSaveTimestamp: Date.now(),
    gold: 0, buildings: withBuildings({ mine: 1 }), // 1 gold/s
  }));
  let t = 1_000_000;
  const gsm = new GameStateManager('bk', () => 0.99, store);
  const ctrl = new GameController(gsm, new EventBus(), () => t);

  assert.equal(ctrl.getBoostFactor(), 1);
  ctrl.activateBoost();
  assert.equal(ctrl.getBoostFactor(), 2);

  ctrl.tickPassive(t);   // anchor
  t += 10_000;
  ctrl.tickPassive(t);   // 10s × 1/s × boost 2 = 20
  assert.equal(ctrl.getState().gold, 20);

  t += 60_000;           // boost expired
  assert.equal(ctrl.getBoostFactor(), 1);
});

test('a future-tampered boost is capped at 24h', () => {
  const store = new FakeStore();
  const now = Date.now();
  store.setItem('bc', JSON.stringify({
    ...createDefaultProfile(), lastSaveTimestamp: now,
    boostEndsAt: now + 10 * 24 * 3600 * 1000,
  }));
  const gsm = new GameStateManager('bc', () => 0.99, store);
  const s = gsm.loadState();
  assert.ok(s.boostEndsAt > now && s.boostEndsAt <= now + 24 * 3600 * 1000 + 5000);
});

test('advanceVillage requires the threshold, then boosts production permanently', () => {
  const notReady = harness({ gold: 0, buildings: withBuildings({ mine: 10 }) });
  assert.equal(notReady.controller.canAdvanceVillage(), false);
  assert.equal(notReady.controller.advanceVillage(), false);
  assert.equal(notReady.controller.getState().village, 1);

  const ready = harness({ gold: 999, buildings: withBuildings({ mine: 24 }) });
  assert.equal(ready.controller.canAdvanceVillage(), true);
  const rateBefore = EconomyEngine.getPassiveRate(ready.controller.getState());
  assert.equal(ready.controller.advanceVillage(), true);

  const s = ready.controller.getState();
  assert.equal(s.village, 2);
  assert.equal(s.buildings.mine, 24); // buildings kept (pure progression)
  assert.equal(s.gold, 999); // gold kept
  // Same buildings now produce 1.7× more.
  assert.equal(EconomyEngine.getPassiveRate(s), rateBefore * 1.7);
});

test('ascension resets village and buildings along with the run', () => {
  const { controller } = harness({
    gold: 5_000,
    village: 4,
    buildings: withBuildings({ mine: 10, castle: 3 }),
    stats: {
      goldEarnedRun: 5_000_000, goldEarnedAll: 5_000_000,
      totalSpins: 0, bossesKilled: 0, prestiges: 0,
    },
  });
  assert.equal(controller.ascend(), true);
  const s = controller.getState();
  assert.equal(s.village, 1);
  assert.deepEqual(s.buildings, createEmptyBuildings());
  assert.ok(s.relics >= 1);
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

test('village and buildings round-trip through save/load', () => {
  const store = new FakeStore();
  const gsm = new GameStateManager('rt', () => 0.99, store);
  const state = gsm.loadState();
  state.village = 5;
  state.buildings.market = 12;
  state.buildings.castle = 3;
  gsm.saveState(state);

  const reloaded = gsm.loadState();
  assert.equal(reloaded.village, 5);
  assert.equal(reloaded.buildings.market, 12);
  assert.equal(reloaded.buildings.castle, 3);
});

test('a save without village fields migrates to village 1 / empty buildings', () => {
  const store = new FakeStore();
  store.setItem('mig', JSON.stringify({
    id: 'ldt_old', gold: 100, gems: 5, energy: 10, maxEnergy: 30,
    dungeonLevel: 0, shields: 0, lastSaveTimestamp: Date.now(),
  }));
  const gsm = new GameStateManager('mig', () => 0.99, store);
  const s = gsm.loadState();
  assert.equal(s.village, 1);
  assert.deepEqual(s.buildings, createEmptyBuildings());
});

test('tampered village fields are clamped', () => {
  const store = new FakeStore();
  store.setItem('tam', JSON.stringify({
    ...createDefaultProfile(), lastSaveTimestamp: Date.now(),
    village: -3,
    buildings: { mine: -5, farm: 2.9, sawmill: 'x', market: null, blacksmith: 4, castle: 1 },
  }));
  const gsm = new GameStateManager('tam', () => 0.99, store);
  const s = gsm.loadState();
  assert.equal(s.village, 1);
  assert.deepEqual(s.buildings, withBuildings({ farm: 2, blacksmith: 4, castle: 1 }));
});
