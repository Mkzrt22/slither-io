/**
 * factory.test.ts — Unit tests for the production-line simulation.
 *
 * Validates the genuinely simulated behaviour: flow through the line,
 * bottleneck detection, buffer back-pressure, upgrades/workers/menu, prestige
 * reset rules, and offline accrual. Deterministic — no RNG in the engine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FactoryEngine } from '../src/factory/FactoryEngine.js';
import { createDefaultFactory, STATION_IDS, FactoryState } from '../src/factory/types.js';

const NOW = 1_000_000;

function fresh(): FactoryState {
  return createDefaultFactory(NOW);
}

/** Runs the tick repeatedly to approximate a duration in small steps. */
function run(state: FactoryState, seconds: number, step = 0.1): number {
  let cash = 0;
  for (let t = 0; t < seconds; t += step) {
    cash += FactoryEngine.tick(state, step, NOW).cashEarned;
  }
  return cash;
}

test('a fresh factory is a fully built 5-station line', () => {
  const s = fresh();
  assert.equal(STATION_IDS.length, 5);
  for (const id of STATION_IDS) assert.equal(s.stations[id].level, 1);
  assert.equal(s.cash, 0);
});

test('the line produces and sells dishes over time', () => {
  const s = fresh();
  const cash = run(s, 30);
  assert.ok(cash > 0, 'cash earned');
  assert.ok(s.stats.dishesSold > 0, 'dishes sold');
  assert.equal(Math.round(s.cash), Math.round(cash));
});

test('throughput is gated by the slowest station (bottleneck)', () => {
  const s = fresh();
  // Starve cooking by raising every other station far above it.
  for (const id of STATION_IDS) {
    if (id !== 'cooking') s.stations[id].level = 50;
  }
  assert.equal(FactoryEngine.bottleneck(s, NOW), 'cooking');
  const slow = FactoryEngine.lineThroughput(s, NOW);
  // Upgrading the bottleneck raises throughput; upgrading a fast station does not.
  const before = FactoryEngine.lineThroughput(s, NOW);
  s.stations.delivery.level += 20; // already fast — no effect on the min
  assert.equal(FactoryEngine.lineThroughput(s, NOW), before);
  s.stations.cooking.level += 20; // the actual bottleneck — throughput rises
  assert.ok(FactoryEngine.lineThroughput(s, NOW) > slow);
});

test('a slow downstream station backs pressure up into upstream buffers', () => {
  const s = fresh();
  // Fast receiving/prep, very slow cooking → prep output should fill its cap.
  s.stations.receiving.level = 40;
  s.stations.prep.level = 40;
  s.stations.cooking.level = 1;
  run(s, 40);
  const prepCap = FactoryEngine.stationCapacity(s, 'prep');
  assert.ok(s.stations.prep.output >= prepCap * 0.9, 'prep buffer near full under back-pressure');
});

test('buffers never exceed capacity and outputs never go negative', () => {
  const s = fresh();
  for (const id of STATION_IDS) s.stations[id].level = 5 + Math.floor(Math.random() * 10);
  run(s, 60);
  for (const id of STATION_IDS) {
    assert.ok(s.stations[id].output >= -1e-9, `${id} output non-negative`);
    if (id !== 'delivery') {
      assert.ok(s.stations[id].output <= FactoryEngine.stationCapacity(s, id) + 1e-6, `${id} within cap`);
    }
  }
});

test('upgrading a station costs cash and raises its level', () => {
  const s = fresh();
  s.cash = 10_000;
  const cost = FactoryEngine.upgradeCost(s, 'cooking');
  const bought = FactoryEngine.buyUpgrade(s, 'cooking', 1);
  assert.equal(bought, 1);
  assert.equal(s.stations.cooking.level, 2);
  assert.equal(s.cash, 10_000 - cost);
});

test('max-buy spends down to what is affordable', () => {
  const s = fresh();
  s.cash = 1_000;
  const plan = FactoryEngine.maxAffordableUpgrades(s, 'prep');
  const bought = FactoryEngine.buyUpgrade(s, 'prep', 'max');
  assert.equal(bought, plan.count);
  assert.ok(s.cash >= 0 && s.cash < FactoryEngine.upgradeCost(s, 'prep'));
});

test('workers are hired into a pool, assigned, and boost cadence', () => {
  const s = fresh();
  s.cash = 100_000;
  const rateBefore = FactoryEngine.stationRate(s, 'cooking', NOW);
  assert.ok(FactoryEngine.hireWorker(s));
  assert.equal(s.workersIdle, 1);
  assert.ok(FactoryEngine.assignWorker(s, 'cooking'));
  assert.equal(s.workersIdle, 0);
  assert.equal(s.stations.cooking.workers, 1);
  assert.ok(FactoryEngine.stationRate(s, 'cooking', NOW) > rateBefore, 'worker raises cadence');
  assert.ok(FactoryEngine.unassignWorker(s, 'cooking'));
  assert.equal(s.workersIdle, 1);
});

test('hiring fails without cash; assigning fails with an empty pool', () => {
  const s = fresh();
  s.cash = 0;
  assert.equal(FactoryEngine.hireWorker(s), false);
  assert.equal(FactoryEngine.assignWorker(s, 'prep'), false);
});

test('menu upgrades raise the dish price', () => {
  const s = fresh();
  s.cash = 10_000;
  const p0 = FactoryEngine.dishPrice(s);
  assert.ok(FactoryEngine.buyMenu(s));
  assert.ok(FactoryEngine.dishPrice(s) > p0);
});

test('research raises the matching multiplier and is gated by currency', () => {
  const s = fresh();
  s.cash = 5_000;
  const r0 = FactoryEngine.stationRate(s, 'prep', NOW);
  assert.ok(FactoryEngine.buyResearch(s, 'sharp_knives'));
  assert.ok(FactoryEngine.stationRate(s, 'prep', NOW) > r0, 'rate research boosts cadence');
  // Star-currency research is unaffordable without stars.
  s.stars = 0;
  assert.equal(FactoryEngine.buyResearch(s, 'master_recipe'), false);
});

test('prestige requires the threshold, grants stars, and resets the line', () => {
  const s = fresh();
  assert.equal(FactoryEngine.pendingStars(s), 0);
  s.stats.cashRun = 4_000_000; // 4× threshold → sqrt(4)=2 stars
  s.stations.cooking.level = 25;
  s.menuLevel = 5;
  s.research['sharp_knives'] = 4; // cash research — should reset
  s.research['master_recipe'] = 3; // star research — should survive
  const granted = FactoryEngine.prestige(s);
  assert.equal(granted, 2);
  assert.equal(s.stars, 2);
  assert.equal(s.stations.cooking.level, 1, 'line reset');
  assert.equal(s.menuLevel, 0, 'menu reset');
  assert.equal(s.stats.cashRun, 0, 'run cash reset');
  assert.equal(FactoryEngine.researchLevel(s, 'sharp_knives'), 0, 'cash research reset');
  assert.equal(FactoryEngine.researchLevel(s, 'master_recipe'), 3, 'star research survives');
  assert.ok(FactoryEngine.starMultiplier(s) > 1, 'stars boost production');
});

test('offline accrual is steady-state, capped, and efficiency-scaled', () => {
  const s = fresh();
  const rev = FactoryEngine.revenuePerSecond(s, NOW);
  const eff = FactoryEngine.offlineEfficiency(s);
  const cap = FactoryEngine.offlineCapSeconds(s);
  // A short window credits rev * seconds * efficiency.
  const short = FactoryEngine.accrueOffline(s, 100, NOW);
  assert.equal(short.seconds, 100);
  assert.ok(Math.abs(short.cash - rev * 100 * eff) < 1e-6);
  // A huge window is capped.
  const s2 = fresh();
  const long = FactoryEngine.accrueOffline(s2, cap * 5, NOW);
  assert.equal(long.seconds, cap);
});

test('a production rush multiplies throughput while active', () => {
  const s = fresh();
  const base = FactoryEngine.lineThroughput(s, NOW);
  s.rushEndsAt = NOW + 10_000;
  assert.ok(FactoryEngine.lineThroughput(s, NOW) > base * 2.5, 'rush ~3× throughput');
  assert.equal(FactoryEngine.rushActive(s, NOW + 20_000), false, 'rush expires');
});

// --- Recipes ----------------------------------------------------------------

test('a fresh factory cooks the starter recipe only', () => {
  const s = fresh();
  assert.equal(s.activeRecipeId, 'fast_food_burger');
  assert.deepEqual(s.unlockedRecipes, ['fast_food_burger']);
  assert.equal(FactoryEngine.isRecipeUnlocked(s, 'bento_box'), false);
});

test('unlocking a recipe costs cash and is gated', () => {
  const s = fresh();
  assert.equal(FactoryEngine.unlockRecipe(s, 'bento_box'), false); // no cash
  s.cash = 30_000;
  assert.equal(FactoryEngine.unlockRecipe(s, 'bento_box'), true);
  assert.ok(s.unlockedRecipes.includes('bento_box'));
  assert.equal(s.cash, 30_000 - 25_000);
  assert.equal(FactoryEngine.unlockRecipe(s, 'bento_box'), false); // already owned
});

test('switching recipe changes value and shifts the bottleneck', () => {
  const s = fresh();
  s.cash = 30_000; FactoryEngine.unlockRecipe(s, 'bento_box');
  const burgerPrice = FactoryEngine.dishPrice(s);
  const burgerNeck = FactoryEngine.bottleneck(s, NOW);
  assert.equal(burgerNeck, 'cooking'); // starter bottleneck
  assert.ok(FactoryEngine.switchRecipe(s, 'bento_box'));
  assert.ok(FactoryEngine.dishPrice(s) > burgerPrice, 'pricier dish');
  // Bento's plating complexity (1.8) makes dressage/plating the slowest now.
  assert.equal(FactoryEngine.bottleneck(s, NOW), 'plating');
});

test('switching recipe cannot select a locked dish and clears buffers', () => {
  const s = fresh();
  for (const id of STATION_IDS) s.stations[id].output = 5;
  assert.equal(FactoryEngine.switchRecipe(s, 'gourmet_lobster'), false); // locked
  s.cash = 30_000; FactoryEngine.unlockRecipe(s, 'bento_box');
  assert.ok(FactoryEngine.switchRecipe(s, 'bento_box'));
  for (const id of STATION_IDS) assert.equal(s.stations[id].output, 0, 'changeover empties the line');
});

test('Michelin stars raise value, not speed', () => {
  const s = fresh();
  const tp0 = FactoryEngine.lineThroughput(s, NOW);
  const price0 = FactoryEngine.dishPrice(s);
  s.stars = 5;
  assert.equal(FactoryEngine.lineThroughput(s, NOW), tp0, 'stars do not speed the line');
  assert.ok(FactoryEngine.dishPrice(s) > price0, 'stars raise dish value');
});
