/**
 * synergy.test.ts — Unit tests for cross-building synergies.
 *
 * Each building grants a distinct global perk on top of its passive output.
 * Defaults (all building levels 0) must leave every multiplier neutral so the
 * rest of the suite stays green.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EconomyEngine } from '../src/EconomyEngine.js';
import { SlotEngine } from '../src/SlotEngine.js';
import { GameStateManager } from '../src/GameStateManager.js';
import { VillageEngine } from '../src/VillageEngine.js';
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

// --- Neutral at defaults -----------------------------------------------------

test('all synergies are neutral for a default profile', () => {
  const p = profile();
  assert.equal(VillageEngine.getSpinGoldMultiplier(p), 1);
  assert.equal(VillageEngine.getBossDamageMultiplier(p), 1);
  assert.equal(VillageEngine.getProductionSynergy(p), 1);
  assert.equal(VillageEngine.getMarketGemBonus(p), 0);
  // Farm at 0 preserves the legacy 50% efficiency / 8h cap.
  assert.equal(VillageEngine.getOfflineEfficiency(p), 0.5);
  assert.equal(VillageEngine.getOfflineCapSeconds(p), 8 * 3600);
});

// --- Formula correctness -----------------------------------------------------

test('mine raises slot gold multiplier by 2% per level', () => {
  const p = profile({ buildings: withBuildings({ mine: 10 }) });
  assert.ok(Math.abs(VillageEngine.getSpinGoldMultiplier(p) - 1.2) < 1e-9);
});

test('blacksmith raises boss damage multiplier by 3% per level', () => {
  const p = profile({ buildings: withBuildings({ blacksmith: 5 }) });
  assert.ok(Math.abs(VillageEngine.getBossDamageMultiplier(p) - 1.15) < 1e-9);
});

test('sawmill and castle compound into production synergy', () => {
  const p = profile({ buildings: withBuildings({ sawmill: 10, castle: 5 }) });
  // 1 + 0.015*10 + 0.02*5 = 1.25
  assert.ok(Math.abs(VillageEngine.getProductionSynergy(p) - 1.25) < 1e-9);
});

test('market grants one bonus jackpot gem per 8 levels', () => {
  assert.equal(VillageEngine.getMarketGemBonus(profile({ buildings: withBuildings({ market: 7 }) })), 0);
  assert.equal(VillageEngine.getMarketGemBonus(profile({ buildings: withBuildings({ market: 8 }) })), 1);
  assert.equal(VillageEngine.getMarketGemBonus(profile({ buildings: withBuildings({ market: 16 }) })), 2);
});

test('farm raises offline efficiency and caps it at 100%', () => {
  assert.ok(Math.abs(VillageEngine.getOfflineEfficiency(profile({ buildings: withBuildings({ farm: 20 }) })) - 0.7) < 1e-9);
  // 60 levels would imply 1.1; clamped to 1.0.
  assert.equal(VillageEngine.getOfflineEfficiency(profile({ buildings: withBuildings({ farm: 60 }) })), 1);
});

test('farm extends the offline window by one hour per 5 levels', () => {
  assert.equal(VillageEngine.getOfflineCapSeconds(profile({ buildings: withBuildings({ farm: 4 }) })), 8 * 3600);
  assert.equal(VillageEngine.getOfflineCapSeconds(profile({ buildings: withBuildings({ farm: 5 }) })), 9 * 3600);
  assert.equal(VillageEngine.getOfflineCapSeconds(profile({ buildings: withBuildings({ farm: 25 }) })), 13 * 3600);
});

// --- EconomyEngine integration ----------------------------------------------

test('production synergy folds into the global multiplier', () => {
  const base = profile();
  const boosted = profile({ buildings: withBuildings({ sawmill: 10, castle: 10 }) });
  const ratio = EconomyEngine.getGlobalMultiplier(boosted) / EconomyEngine.getGlobalMultiplier(base);
  // sawmill 10 -> +0.15, castle 10 -> +0.20 => ×1.35
  assert.ok(Math.abs(ratio - 1.35) < 1e-9);
});

// --- SlotEngine integration --------------------------------------------------

/** A roll that lands on COIN (weight 0.38, the first reel entry). */
const COIN_ROLL = 0;

test('mine synergy increases slot payout', () => {
  const plain = profile({ energy: 5 });
  const mined = profile({ energy: 5, buildings: withBuildings({ mine: 25 }) });
  const a = SlotEngine.executeSpin(plain, [COIN_ROLL, COIN_ROLL, COIN_ROLL]);
  const b = SlotEngine.executeSpin(mined, [COIN_ROLL, COIN_ROLL, COIN_ROLL]);
  assert.equal(a.outcome, 'JACKPOT');
  assert.equal(b.outcome, 'JACKPOT');
  // mine 25 -> ×1.5 on slot gold.
  assert.ok(b.goldGained > a.goldGained);
  assert.ok(Math.abs(b.goldGained / a.goldGained - 1.5) < 0.001);
});

test('market synergy adds bonus gems on a GEM jackpot', () => {
  // GEM is reel entry 5: cumulative weight up to GEM is 0.38+0.18+0.16+0.12=0.84,
  // so a roll in [0.84, 0.93) draws GEM.
  const gemRoll = 0.9;
  const plain = profile({ energy: 5 });
  const market = profile({ energy: 5, buildings: withBuildings({ market: 16 }) });
  const a = SlotEngine.executeSpin(plain, [gemRoll, gemRoll, gemRoll]);
  const b = SlotEngine.executeSpin(market, [gemRoll, gemRoll, gemRoll]);
  assert.equal(a.gemsGained, 3);
  assert.equal(b.gemsGained, 5); // 3 base + 2 from market 16
});

test('blacksmith synergy sharpens boss damage', () => {
  const swordRoll = 0.6; // COIN+BAG+SWORD cumulative => SWORD band
  const plain = profile({ energy: 5, bossHp: 100_000 });
  const forge = profile({ energy: 5, bossHp: 100_000, buildings: withBuildings({ blacksmith: 10 }) });
  const a = SlotEngine.executeSpin(plain, [swordRoll, swordRoll, swordRoll]);
  const b = SlotEngine.executeSpin(forge, [swordRoll, swordRoll, swordRoll]);
  assert.ok(a.bossDamage > 0);
  // blacksmith 10 -> ×1.30 boss damage.
  assert.ok(Math.abs(b.bossDamage / a.bossDamage - 1.3) < 0.001);
});

// --- Offline integration -----------------------------------------------------

const neverRaid = (): number => 0.99;

test('farm synergy increases offline passive earnings', () => {
  const gsm = new GameStateManager('synergy-offline', neverRaid);
  const seed = (farm: number): UserProfile =>
    profile({ gold: 0, buildings: withBuildings({ mine: 50, farm }) });

  const sixHours = 6 * 3600; // within both the 8h base cap and the extended cap
  const plainGold = gsm.applyOfflineRegen(seed(0), sixHours).state.gold;
  const farmGold = gsm.applyOfflineRegen(seed(40), sixHours).state.gold;

  // farm 40 raises offline efficiency (90% vs 50%) and adds its own output, so
  // the farmed run must earn strictly more over the same window.
  assert.ok(farmGold > plainGold);
});

// --- UI helper ---------------------------------------------------------------

test('getSynergyText returns a non-empty string for every building type', () => {
  for (const type of ['mine', 'farm', 'sawmill', 'market', 'blacksmith', 'castle'] as BuildingType[]) {
    const text = VillageEngine.getSynergyText(type, 12);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0);
  }
});
