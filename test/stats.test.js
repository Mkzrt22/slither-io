'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { createStats } = require('../src/stats');
const { getSeason } = require('../shared/constants');

function world() {
  const db = open(':memory:');
  const stats = createStats(db);
  const id = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES('u','x')").run().lastInsertRowid);
  return { db, stats, id };
}
const life = o => ({ score: 30, kills: 0, level: 1, xp: 10, mapId: 'classic', mode: 'classic', surviveTicks: 100, food: 5, pacifist: false, comeback: false, ...o });

test('recordLife updates stats and unlocks achievements', () => {
  const { stats, id } = world();
  let r = stats.recordLife(id, life({ score: 160, kills: 3 }));
  assert.equal(r.stats.games, 1);
  assert.equal(r.stats.best_score, 160);
  const ids = r.earned.map(a => a.id);
  for (const a of ['first_blood', 'hatchling', 'serpent', 'chain_killer']) assert.ok(ids.includes(a), a);
  r = stats.recordLife(id, life({ score: 20, surviveTicks: 25 * 181 }));
  assert.ok(r.earned.some(a => a.id === 'survivor'), 'survivor is per life');
  assert.equal(stats.recordLife(id, life({ score: 20 })).earned.length, 0, 'no duplicates');
});

test('survivor needs 3 minutes in a single life', () => {
  const { stats, id } = world();
  for (let i = 0; i < 4; i++) assert.ok(!stats.recordLife(id, life({ surviveTicks: 25 * 60 })).earned.some(a => a.id === 'survivor'));
});

test('speed demon after 5 speed power-ups', () => {
  const { stats, id } = world();
  let earned = [];
  for (let i = 0; i < 5; i++) earned = earned.concat(stats.onPowerup(id, 'speed'));
  assert.ok(earned.some(a => a.id === 'speed_demon'));
});

test('battle pass: season, tiers, permanent unlocks, premium', () => {
  const { stats, id, db } = world();
  let bp = stats.getBp(id);
  assert.equal(bp.season, getSeason().number);
  const r = stats.addBpXp(id, 1050);
  assert.equal(r.after, 10);
  assert.ok(r.earned.some(a => a.id === 'season1'));
  let un = stats.getUnlocks(id);
  assert.ok(un.titles.includes('Rookie'));
  assert.ok(!un.titles.includes('Viper'), 'premium reward locked');
  stats.setBpPremium(id, true);
  un = stats.getUnlocks(id);
  assert.ok(un.titles.includes('Viper'), 'premium unlocked retroactively');
  // New season: XP resets, cosmetics stay.
  db.prepare('UPDATE stats SET bp_season=bp_season-1 WHERE user_id=?').run(id);
  bp = stats.getBp(id);
  assert.equal(bp.xp, 0);
  assert.ok(stats.getUnlocks(id).titles.includes('Rookie'));
});

test('ranked Elo is stored per account', () => {
  const { stats, id, db } = world();
  const id2 = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES('v','x')").run().lastInsertRowid);
  const res = stats.applyElo([{ userId: id }, { userId: id2 }]);
  assert.equal(res[0].change, 16);
  assert.equal(stats.getElo(id), 1016);
  assert.equal(stats.getElo(id2), 984);
});

test('leaderboards keep one best score per player', () => {
  const { stats } = world();
  stats.addScore({ name: 'a', userId: null, score: 100, mode: 'classic', mapId: 'classic' });
  stats.addScore({ name: 'a', userId: null, score: 300, mode: 'classic', mapId: 'classic' });
  stats.addScore({ name: 'b', userId: null, score: 200, mode: 'classic', mapId: 'classic' });
  stats.addScore({ name: 'c', userId: null, score: 10, mode: 'classic', mapId: 'classic' });
  const lb = stats.getLeaderboards();
  assert.deepEqual(lb.global.map(s => [s.name, s.score]), [['a', 300], ['b', 200]]);
  assert.equal(lb.weekly.length, 2);
});
