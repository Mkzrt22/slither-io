/**
 * relicshop.test.ts — Unit tests for the prestige relic shop.
 *
 * Relic upgrades are permanent meta-progression bought with relics. At default
 * (no upgrades owned) every multiplier must be neutral so the rest of the suite
 * is unaffected.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EconomyEngine } from '../src/EconomyEngine.js';
import { GameStateManager } from '../src/GameStateManager.js';
import { RELIC_UPGRADES, RelicShopEngine } from '../src/RelicShopEngine.js';
import { SlotEngine } from '../src/SlotEngine.js';
import { UserProfile, createDefaultProfile } from '../src/types.js';

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { ...createDefaultProfile(), ...overrides };
}

class FakeStore {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}

// --- Neutral at defaults -----------------------------------------------------

test('relic multipliers are neutral for a default profile', () => {
  const p = profile();
  assert.equal(RelicShopEngine.getGoldMultiplier(p), 1);
  assert.equal(RelicShopEngine.getSlotMultiplier(p), 1);
  assert.equal(RelicShopEngine.getBossMultiplier(p), 1);
  assert.equal(RelicShopEngine.getOfflineMultiplier(p), 1);
});

// --- Cost & purchase ---------------------------------------------------------

test('first-level cost equals the base cost', () => {
  const p = profile();
  for (const def of RELIC_UPGRADES) {
    assert.equal(RelicShopEngine.getCost(p, def.id), def.baseCost);
  }
});

test('cost grows geometrically with owned level', () => {
  const p = profile({ relicUpgrades: { fortune: 2 } });
  // round(1 * 1.6^2) = round(2.56) = 3
  assert.equal(RelicShopEngine.getCost(p, 'fortune'), 3);
});

test('unknown ids have no cost and cannot be bought', () => {
  const p = profile({ relics: 100 });
  assert.equal(RelicShopEngine.getCost(p, 'nope'), null);
  assert.equal(RelicShopEngine.purchase(p, 'nope'), false);
  assert.equal(p.relics, 100);
});

test('purchase deducts relics and raises the level', () => {
  const p = profile({ relics: 5 });
  assert.ok(RelicShopEngine.purchase(p, 'fortune'));
  assert.equal(RelicShopEngine.getLevel(p, 'fortune'), 1);
  assert.equal(p.relics, 4); // 5 - 1
  assert.ok(RelicShopEngine.purchase(p, 'fortune'));
  assert.equal(RelicShopEngine.getLevel(p, 'fortune'), 2);
  assert.equal(p.relics, 2); // 4 - round(1.6^1)=2
});

test('purchase fails when relics are insufficient', () => {
  const p = profile({ relics: 0 });
  assert.equal(RelicShopEngine.canAfford(p, 'fortune'), false);
  assert.equal(RelicShopEngine.purchase(p, 'fortune'), false);
  assert.equal(RelicShopEngine.getLevel(p, 'fortune'), 0);
});

test('an upgrade cannot exceed its max level', () => {
  const def = RELIC_UPGRADES[0];
  const p = profile({ relics: 1, relicUpgrades: { [def.id]: def.maxLevel } });
  assert.ok(RelicShopEngine.isMaxed(p, def.id));
  assert.equal(RelicShopEngine.getCost(p, def.id), null);
  assert.equal(RelicShopEngine.purchase(p, def.id), false);
});

// --- Effect math -------------------------------------------------------------

test('fortune raises the global multiplier by 6% per level', () => {
  const base = profile();
  const boosted = profile({ relicUpgrades: { fortune: 10 } });
  const ratio =
    EconomyEngine.getGlobalMultiplier(boosted) / EconomyEngine.getGlobalMultiplier(base);
  // 1 + 0.06*10 = 1.6
  assert.ok(Math.abs(ratio - 1.6) < 1e-9);
});

test('slot and boss multipliers scale with their upgrades', () => {
  assert.ok(Math.abs(RelicShopEngine.getSlotMultiplier(profile({ relicUpgrades: { butin: 5 } })) - 1.4) < 1e-9);
  assert.ok(Math.abs(RelicShopEngine.getBossMultiplier(profile({ relicUpgrades: { frappe: 5 } })) - 1.5) < 1e-9);
  assert.ok(Math.abs(RelicShopEngine.getOfflineMultiplier(profile({ relicUpgrades: { eveil: 4 } })) - 1.2) < 1e-9);
});

// --- SlotEngine integration --------------------------------------------------

test('butin upgrade increases slot payout', () => {
  const plain = profile({ energy: 5 });
  const rich = profile({ energy: 5, relicUpgrades: { butin: 10 } });
  const a = SlotEngine.executeSpin(plain, [0, 0, 0]); // COIN jackpot
  const b = SlotEngine.executeSpin(rich, [0, 0, 0]);
  assert.equal(a.outcome, 'JACKPOT');
  // butin 10 -> +80% slot gold.
  assert.ok(Math.abs(b.goldGained / a.goldGained - 1.8) < 0.001);
});

test('frappe upgrade increases boss damage', () => {
  const swordRoll = 0.6;
  const plain = profile({ energy: 5, bossHp: 100_000 });
  const rich = profile({ energy: 5, bossHp: 100_000, relicUpgrades: { frappe: 10 } });
  const a = SlotEngine.executeSpin(plain, [swordRoll, swordRoll, swordRoll]);
  const b = SlotEngine.executeSpin(rich, [swordRoll, swordRoll, swordRoll]);
  assert.ok(a.bossDamage > 0);
  // frappe 10 -> ×2 boss damage.
  assert.ok(Math.abs(b.bossDamage / a.bossDamage - 2) < 0.001);
});

// --- Persistence & anti-tamper ----------------------------------------------

test('relic upgrades round-trip through save/load', () => {
  const store = new FakeStore();
  const gsm = new GameStateManager('rk', () => 0.99, store as unknown as Storage);
  const state = gsm.loadState();
  state.relicUpgrades = { fortune: 3, butin: 1 };
  gsm.saveState(state);
  const reloaded = gsm.loadState();
  assert.equal(reloaded.relicUpgrades.fortune, 3);
  assert.equal(reloaded.relicUpgrades.butin, 1);
});

test('tampered relic upgrades are clamped and unknown ids dropped', () => {
  const store = new FakeStore();
  store.setItem('rk', JSON.stringify({
    id: 'ldt_player',
    lastSaveTimestamp: Date.now(),
    relicUpgrades: { fortune: 9_999, frappe: -4, hack: 50, ghost: 'x' },
  }));
  const gsm = new GameStateManager('rk', () => 0.99, store as unknown as Storage);
  const state = gsm.loadState();
  const fortuneMax = RELIC_UPGRADES.find((u) => u.id === 'fortune')!.maxLevel;
  assert.equal(state.relicUpgrades.fortune, fortuneMax); // over max -> clamped
  assert.equal(state.relicUpgrades.frappe, undefined);   // negative -> dropped
  assert.equal(state.relicUpgrades.hack, undefined);     // unknown id -> dropped
  assert.equal(state.relicUpgrades.ghost, undefined);    // wrong type -> dropped
});

// --- Catalogue integrity -----------------------------------------------------

test('every upgrade has a positive cost curve and a sane max', () => {
  const ids = new Set<string>();
  for (const def of RELIC_UPGRADES) {
    assert.equal(ids.has(def.id), false, `duplicate id ${def.id}`);
    ids.add(def.id);
    assert.ok(def.baseCost >= 1);
    assert.ok(def.costGrowth > 1);
    assert.ok(def.maxLevel >= 1);
    assert.ok(def.perLevel > 0);
    assert.equal(typeof RelicShopEngine.effectText(def, 3), 'string');
  }
});
