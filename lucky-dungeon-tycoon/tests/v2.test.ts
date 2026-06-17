/**
 * v2.test.ts — Unit tests for the v2 systems: 3-reel slot machine, miners
 * and passive income, boss fights and floors, prestige, and quests.
 *
 * Reel bands (cumulative weights) used to force symbols deterministically:
 *   COIN  [0.00, 0.38)   BAG    [0.38, 0.56)   SWORD [0.56, 0.72)
 *   SHIELD[0.72, 0.84)   GEM    [0.84, 0.93)   SKULL [0.93, 1.00)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EconomyEngine, MINER_CONFIGS, PRESTIGE_THRESHOLD } from '../src/EconomyEngine.js';
import { EventBus, GameEventMap } from '../src/EventBus.js';
import { GameController } from '../src/GameController.js';
import { GameStateManager } from '../src/GameStateManager.js';
import { QUESTS, QuestEngine } from '../src/QuestEngine.js';
import { SlotEngine } from '../src/SlotEngine.js';
import {
  MAX_SHIELDS,
  UserProfile,
  createDefaultProfile,
} from '../src/types.js';

const COIN = 0.1;
const BAG = 0.4;
const SWORD = 0.6;
const SHIELD = 0.75;
const GEM = 0.85;
const SKULL = 0.95;

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { ...createDefaultProfile(), ...overrides };
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
    store.setItem('hkey', JSON.stringify({
      ...createDefaultProfile(),
      lastSaveTimestamp: Date.now(),
      ...seed,
    }));
  }
  const gsm = new GameStateManager('hkey', () => 0.99, store);
  const bus = new EventBus();
  const notes: GameEventMap['ui:notification'][] = [];
  bus.on('ui:notification', (n) => notes.push(n));
  return { controller: new GameController(gsm, bus), notes };
}

// ---------------------------------------------------------------------------
// SlotEngine — combinations
// ---------------------------------------------------------------------------

test('triple COIN pays the coin jackpot', () => {
  const p = profile();
  const r = SlotEngine.executeSpin(p, [COIN, COIN, COIN]);
  assert.deepEqual(r.symbols, ['COIN', 'COIN', 'COIN']);
  assert.equal(r.outcome, 'JACKPOT');
  assert.equal(r.goldGained, 120); // 10 base × 12, floor 1, no relics
  assert.equal(p.gold, 120);
  assert.equal(p.stats.totalSpins, 1);
});

test('triple GEM grants 3 gems plus gold', () => {
  const p = profile();
  const r = SlotEngine.executeSpin(p, [GEM, GEM, GEM]);
  assert.equal(r.gemsGained, 3);
  assert.equal(p.gems, 28);
  assert.ok(r.goldGained > 0);
});

test('triple SHIELD grants up to the cap and compensates the rest', () => {
  const fresh = profile({ shields: 0 });
  const r1 = SlotEngine.executeSpin(fresh, [SHIELD, SHIELD, SHIELD]);
  assert.equal(r1.shieldsGained, 2);
  assert.equal(fresh.shields, 2);

  const nearCap = profile({ shields: MAX_SHIELDS - 1 });
  const r2 = SlotEngine.executeSpin(nearCap, [SHIELD, SHIELD, SHIELD]);
  assert.equal(r2.shieldsGained, 1);
  assert.equal(nearCap.shields, MAX_SHIELDS);
  assert.ok(r2.goldGained > r1.goldGained); // overflow converted to gold
});

test('triple SKULL pays the cursed hoard but consumes a shield', () => {
  const p = profile({ shields: 2 });
  const r = SlotEngine.executeSpin(p, [SKULL, SKULL, SKULL]);
  assert.equal(r.outcome, 'JACKPOT');
  assert.equal(r.goldGained, 200); // 10 × 20
  assert.equal(p.shields, 1);
  assert.equal(r.shieldsGained, -1);
});

test('SKULL pair steals 5% of current gold', () => {
  const p = profile({ gold: 1_000 });
  const r = SlotEngine.executeSpin(p, [SKULL, SKULL, COIN]);
  assert.equal(r.outcome, 'PAIR');
  assert.equal(r.goldStolen, 50);
  assert.equal(p.gold, 1_000 - 50 + r.goldGained);
});

test('SHIELD pair grants one shield below the cap', () => {
  const p = profile({ shields: 0 });
  const r = SlotEngine.executeSpin(p, [SHIELD, COIN, SHIELD]);
  assert.equal(r.shieldsGained, 1);
  assert.equal(p.shields, 1);
});

test('scatter pays per symbol and never below the consolation floor', () => {
  const p = profile();
  const r = SlotEngine.executeSpin(p, [COIN, BAG, GEM]);
  assert.equal(r.outcome, 'SCATTER');
  assert.equal(r.goldGained, 20); // (0.4 + 1 + 0.6) × 10
  assert.ok(r.goldGained >= 2); // consolation floor is 0.2 × base
});

test('every spin pays at least the consolation floor', () => {
  const p = profile();
  // Sword/skull-heavy scatter has the lowest table value.
  const r = SlotEngine.executeSpin(p, [SWORD, SKULL, SHIELD]);
  assert.ok(r.goldGained >= 2, `paid ${r.goldGained}`);
});

test('floor and relic multipliers scale payouts', () => {
  const base = SlotEngine.executeSpin(profile(), [COIN, COIN, COIN]).goldGained;
  const boosted = SlotEngine.executeSpin(
    profile({ floor: 3, relics: 5 }),
    [COIN, COIN, COIN],
  ).goldGained;
  // ×1.3² (floor 3) ×1.5 (5 relics)
  assert.equal(boosted, Math.round(base * 1.69 * 1.5));
});

test('swords damage the boss only while a fight is active', () => {
  const idle = profile();
  assert.equal(SlotEngine.executeSpin(idle, [SWORD, SWORD, COIN]).bossDamage, 0);

  const fighting = profile({ bossHp: 300 });
  const r = SlotEngine.executeSpin(fighting, [SWORD, SWORD, COIN]);
  assert.equal(r.bossDamage, 80); // damageUnit 20 × pair multiplier 4
  assert.equal(fighting.bossHp, 220);
});

// ---------------------------------------------------------------------------
// Economy v2 — miners, bosses, prestige math
// ---------------------------------------------------------------------------

test('miner costs grow geometrically per unit owned', () => {
  const cfg = MINER_CONFIGS.goblin;
  assert.equal(EconomyEngine.getMinerCost('goblin', 0), cfg.baseCost);
  assert.equal(
    EconomyEngine.getMinerCost('goblin', 10),
    Math.round(cfg.baseCost * Math.pow(cfg.costGrowth, 10)),
  );
});

test('passive rate sums tiers and applies global multipliers', () => {
  const p = profile({ miners: { goblin: 10, skeleton: 2, golem: 0, dragon: 0 } });
  assert.equal(EconomyEngine.getPassiveRate(p), 10 * 1 + 2 * 9);

  p.relics = 10; // ×2
  assert.equal(EconomyEngine.getPassiveRate(p), 56);
});

test('boss HP and rewards grow with the floor', () => {
  assert.equal(EconomyEngine.getBossMaxHp(1), 300);
  assert.equal(EconomyEngine.getBossMaxHp(3), Math.round(300 * 2.2 * 2.2));
  assert.ok(EconomyEngine.getBossReward(5) > EconomyEngine.getBossReward(1));
});

test('prestige relics unlock at the threshold and grow sub-linearly', () => {
  assert.equal(EconomyEngine.getPrestigeRelics(PRESTIGE_THRESHOLD - 1), 0);
  assert.equal(EconomyEngine.getPrestigeRelics(PRESTIGE_THRESHOLD), 1);
  const tenX = EconomyEngine.getPrestigeRelics(PRESTIGE_THRESHOLD * 10);
  assert.ok(tenX >= 2 && tenX < 10);
});

// ---------------------------------------------------------------------------
// Offline passive income
// ---------------------------------------------------------------------------

test('miners earn at half rate offline, capped at 8 hours', () => {
  const gsm = new GameStateManager('off', () => 0.99);
  const p = profile({
    energy: 30,
    miners: { goblin: 10, skeleton: 0, golem: 0, dragon: 0 }, // 10 gold/s
  });

  const oneHour = gsm.applyOfflineRegen(p, 3_600);
  assert.equal(oneHour.state.gold, 10 * 3_600 * 0.5);
  assert.ok(oneHour.logs.some((l) => l.includes('hors-ligne')));
  assert.equal(oneHour.summary.goldEarned, 10 * 3_600 * 0.5);

  const twoDays = gsm.applyOfflineRegen(p, 48 * 3_600);
  assert.equal(twoDays.state.gold, 10 * 8 * 3_600 * 0.5); // 8h cap
});

test('offline passive income feeds the lifetime counters', () => {
  const gsm = new GameStateManager('off2', () => 0.99);
  const p = profile({ miners: { goblin: 1, skeleton: 0, golem: 0, dragon: 0 } });
  const out = gsm.applyOfflineRegen(p, 1_000);
  assert.equal(out.state.stats.goldEarnedAll, out.state.gold);
});

// ---------------------------------------------------------------------------
// Controller — miners, boss flow, prestige, quests, passive tick
// ---------------------------------------------------------------------------

test('hireMiner deducts gold and raises the next cost', () => {
  const { controller } = harness({ gold: 200 });
  assert.equal(controller.hireMiner('goblin'), true);
  const s = controller.getState();
  assert.equal(s.miners.goblin, 1);
  assert.equal(s.gold, 150);
  assert.equal(controller.getMinerCost('goblin'), EconomyEngine.getMinerCost('goblin', 1));

  assert.equal(controller.hireMiner('dragon'), false); // unaffordable
  assert.equal(controller.getState().miners.dragon, 0);
});

test('tickPassive credits miner output with fractional carry', () => {
  const { controller } = harness({
    gold: 0,
    miners: { goblin: 1, skeleton: 0, golem: 0, dragon: 0 }, // 1 gold/s
  });
  const t0 = Date.now();
  controller.tickPassive(t0 + 500); // 0.5 gold -> carried
  assert.equal(controller.getState().gold, 0);
  controller.tickPassive(t0 + 1_000); // carry completes 1 gold
  assert.equal(controller.getState().gold, 1);
});

test('full boss loop: engage, strike, kill, advance floor, loot gems', () => {
  const { controller, notes } = harness({ gold: 0, energy: 999, maxEnergy: 30 });
  assert.equal(controller.startBossFight(), true);
  assert.equal(controller.startBossFight(), false); // already fighting
  assert.equal(controller.getState().bossHp, 300);

  const gemsBefore = controller.getState().gems;
  // Triple swords deal 20 × 10 = 200; two hits kill the 300 HP boss.
  controller.spin([SWORD, SWORD, SWORD]);
  assert.equal(controller.getState().bossHp, 100);
  controller.spin([SWORD, SWORD, SWORD]);

  const s = controller.getState();
  assert.equal(s.bossHp, null);
  assert.equal(s.floor, 2);
  assert.equal(s.stats.bossesKilled, 1);
  assert.equal(s.gems, gemsBefore + EconomyEngine.getBossReward(1));
  assert.ok(notes.some((n) => n.message.includes('Boss vaincu')));
});

test('fleeBossFight clears the fight without rewards', () => {
  const { controller } = harness();
  controller.startBossFight();
  controller.fleeBossFight();
  const s = controller.getState();
  assert.equal(s.bossHp, null);
  assert.equal(s.floor, 1);
  assert.equal(s.stats.bossesKilled, 0);
});

test('ascend converts the run into relics and resets run state', () => {
  const { controller } = harness({
    gold: 5_000,
    dungeonLevel: 4,
    floor: 3,
    miners: { goblin: 5, skeleton: 1, golem: 0, dragon: 0 },
    stats: {
      goldEarnedRun: PRESTIGE_THRESHOLD * 2,
      goldEarnedAll: PRESTIGE_THRESHOLD * 2,
      totalSpins: 500,
      bossesKilled: 2,
      prestiges: 0,
    },
  });

  const expected = EconomyEngine.getPrestigeRelics(PRESTIGE_THRESHOLD * 2);
  assert.equal(controller.ascend(), true);
  const s = controller.getState();
  assert.equal(s.relics, expected);
  assert.equal(s.gold, 0);
  assert.equal(s.floor, 1);
  assert.equal(s.dungeonLevel, 0);
  assert.deepEqual(s.miners, { goblin: 0, skeleton: 0, golem: 0, dragon: 0 });
  assert.equal(s.stats.goldEarnedRun, 0);
  assert.equal(s.stats.goldEarnedAll, PRESTIGE_THRESHOLD * 2); // lifetime kept
  assert.equal(s.stats.prestiges, 1);
  assert.equal(s.energy, s.maxEnergy); // refilled as a send-off
});

test('ascend refuses below the threshold', () => {
  const { controller } = harness({ gold: 100 });
  assert.equal(controller.ascend(), false);
  assert.equal(controller.getState().relics, 0);
});

test('quests complete, claim once, and pay gems', () => {
  const { controller } = harness({
    stats: {
      goldEarnedRun: 2_000,
      goldEarnedAll: 2_000,
      totalSpins: 0,
      bossesKilled: 0,
      prestiges: 0,
    },
  });

  assert.ok(controller.getClaimableQuests().includes('first_vein'));
  const gemsBefore = controller.getState().gems;
  assert.equal(controller.claimQuest('first_vein'), true);
  const reward = QUESTS.find((q) => q.id === 'first_vein')!.reward;
  assert.equal(controller.getState().gems, gemsBefore + reward);

  assert.equal(controller.claimQuest('first_vein'), false); // already claimed
  assert.equal(controller.claimQuest('magnate'), false); // not complete
  assert.equal(controller.claimQuest('nope'), false); // unknown id
});

test('quest progress is clamped to [0, 1]', () => {
  const p = profile();
  p.stats.goldEarnedAll = 10_000_000;
  for (const quest of QUESTS) {
    const v = quest.progress(p);
    assert.ok(v >= 0 && v <= 1, `${quest.id} progress ${v}`);
  }
  assert.equal(QuestEngine.isClaimable(p, 'magnate'), true);
});

// ---------------------------------------------------------------------------
// Persistence of the v2 fields
// ---------------------------------------------------------------------------

test('v2 fields round-trip through save/load', () => {
  const store = new FakeStore();
  const gsm = new GameStateManager('rt', () => 0.99, store);
  const state = gsm.loadState();
  state.floor = 4;
  state.bossHp = 123;
  state.miners.golem = 7;
  state.relics = 3;
  state.stats.totalSpins = 42;
  state.claimedQuests.push('first_vein');
  gsm.saveState(state);

  const reloaded = gsm.loadState();
  assert.equal(reloaded.floor, 4);
  assert.equal(reloaded.bossHp, 123);
  assert.equal(reloaded.miners.golem, 7);
  assert.equal(reloaded.relics, 3);
  assert.equal(reloaded.stats.totalSpins, 42);
  assert.deepEqual(reloaded.claimedQuests, ['first_vein']);
});

test('a v1 save (without v2 fields) migrates to safe defaults', () => {
  const store = new FakeStore();
  store.setItem('mig', JSON.stringify({
    id: 'ldt_legacy',
    gold: 500,
    gems: 12,
    energy: 10,
    maxEnergy: 30,
    dungeonLevel: 3,
    shields: 1,
    lastSaveTimestamp: Date.now(),
  }));
  const gsm = new GameStateManager('mig', () => 0.99, store);
  const s = gsm.loadState();
  assert.equal(s.gold, 500);
  assert.equal(s.dungeonLevel, 3);
  assert.equal(s.floor, 1);
  assert.equal(s.bossHp, null);
  assert.deepEqual(s.miners, { goblin: 0, skeleton: 0, golem: 0, dragon: 0 });
  assert.equal(s.relics, 0);
  assert.equal(s.stats.totalSpins, 0);
  assert.deepEqual(s.claimedQuests, []);
});

test('tampered v2 fields are clamped', () => {
  const store = new FakeStore();
  store.setItem('tam', JSON.stringify({
    ...createDefaultProfile(),
    lastSaveTimestamp: Date.now(),
    floor: -5,
    bossHp: 'hacked',
    miners: { goblin: -3, skeleton: 'x', golem: 2.9, dragon: null },
    relics: -1,
    stats: { goldEarnedRun: -1, goldEarnedAll: Infinity, totalSpins: 3.7 },
    claimedQuests: ['ok', 42, 'ok', null],
  }));
  const gsm = new GameStateManager('tam', () => 0.99, store);
  const s = gsm.loadState();
  assert.equal(s.floor, 1);
  assert.equal(s.bossHp, null);
  assert.deepEqual(s.miners, { goblin: 0, skeleton: 0, golem: 2, dragon: 0 });
  assert.equal(s.relics, 0);
  assert.equal(s.stats.goldEarnedRun, 0);
  assert.equal(s.stats.goldEarnedAll, 0);
  assert.equal(s.stats.totalSpins, 3);
  assert.deepEqual(s.claimedQuests, ['ok']);
});
