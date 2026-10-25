'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { arenaWorld, usd, totalMoney, runTicks } = require('./helpers');
const { createArena, splitEvenly } = require('../src/economy/arena');

const profile = name => ({ name, skin: 'solid', customSkin: null, cosmetics: null, emotes: ['😂'] });

function startMatch(w, names) {
  const users = names.map(n => w.user(n, usd(10)));
  for (const u of users) assert.equal(w.arena.queue({ user: u, tierId: 't1', socketId: null, profile: profile(u.username) }).ok, true);
  w.arena.tick();
  const room = w.rooms[w.rooms.length - 1];
  assert.ok(room, 'match room created');
  runTicks(room, 80); // 3 s countdown
  assert.equal(room.phase, 'playing');
  const byName = Object.fromEntries(room.humans().map(p => [p.name, p]));
  return { users, room, byName };
}

test('splitEvenly keeps every unit', () => {
  assert.deepEqual(splitEvenly(10, [1, 2, 3]), [4, 3, 3]);
  assert.deepEqual(splitEvenly(0, [1, 2]), [0, 0]);
  assert.equal(splitEvenly(999999, Array(7).fill(0)).reduce((a, b) => a + b, 0), 999999);
});

test('queue debits the entry and leaving refunds it', () => {
  const w = arenaWorld();
  const alice = w.user('alice', usd(10));
  assert.equal(w.arena.queue({ user: alice, tierId: 't1', socketId: null, profile: profile('alice') }).ok, true);
  assert.equal(w.ledger.balance(alice.id, 'DEMO'), usd(9));
  assert.equal(w.arena.queue({ user: alice, tierId: 't1', socketId: null, profile: profile('alice') }).error, 'already_in_arena');
  assert.equal(w.arena.leaveQueue(alice.id).ok, true);
  assert.equal(w.ledger.balance(alice.id, 'DEMO'), usd(10));
  assert.equal(w.db.prepare('SELECT status FROM matches').get().status, 'cancelled');
});

test('eligibility checks', () => {
  const w = arenaWorld();
  const poor = w.user('poor', usd(0.5));
  assert.equal(w.arena.queue({ user: poor, tierId: 't1', socketId: null, profile: profile('poor') }).error, 'insufficient_funds');
  assert.equal(w.ledger.balance(poor.id, 'DEMO'), usd(0.5));
  w.db.prepare("INSERT INTO users(username,password_hash) VALUES('kid','x')").run();
  const kid = w.db.prepare("SELECT * FROM users WHERE username='kid'").get();
  assert.equal(w.arena.queue({ user: kid, tierId: 't1', socketId: null, profile: profile('kid') }).error, 'compliance_required');
  assert.equal(w.arena.queue({ user: null, tierId: 't1' }).error, 'login_required');
  const ex = w.user('ex', usd(10));
  w.db.prepare('UPDATE users SET excluded_until=? WHERE id=?').run(Math.floor(Date.now() / 1000) + 3600, ex.id);
  assert.equal(w.arena.queue({ user: w.db.prepare('SELECT * FROM users WHERE id=?').get(ex.id), tierId: 't1' }).error, 'self_excluded');
});

test('equal start: same length, same value, protected spawn', () => {
  const w = arenaWorld();
  const { room } = startMatch(w, ['a', 'b', 'c']);
  const humans = room.humans();
  assert.equal(new Set(humans.map(p => p.segs.length)).size, 1);
  assert.ok(humans.every(p => p.value === usd(0.95)));
  assert.equal(room.bots.size, 0, 'no bots in paid matches');
  assert.equal(room.powerups.length, 0, 'no random power-ups in paid matches');
});

test('kill transfers value, lone deaths drop orbs, survivor collects everything', () => {
  const w = arenaWorld();
  const before = totalMoney(w.db, 'DEMO');
  const { room, byName, users } = startMatch(w, ['alice', 'bob', 'carol']);
  room.killSnake(byName.carol, { killer: byName.bob, reason: 'snake' });
  assert.equal(byName.bob.value, usd(1.9));
  room.killSnake(byName.alice, { killer: null, reason: 'zone' });
  const orbTotal = room.orbs.reduce((s, o) => s + o.v, 0);
  assert.equal(orbTotal, usd(0.95));
  // Bob eats whatever orbs are under his head.
  const orb = room.orbs[0];
  byName.bob.segs[0] = { x: orb.x, y: orb.y };
  room.eatOrbs(byName.bob, byName.bob.segs[0]);
  const eaten = orbTotal - room.orbs.reduce((s, o) => s + o.v, 0);
  assert.ok(eaten >= orb.v);
  assert.equal(byName.bob.value, usd(1.9) + eaten);
  room.checkRoundEnd(); // only bob left
  assert.equal(room.phase, 'ended');
  const [alice, bob, carol] = users;
  assert.equal(w.ledger.balance(alice.id, 'DEMO'), usd(9));
  assert.equal(w.ledger.balance(carol.id, 'DEMO'), usd(9));
  assert.equal(w.ledger.balance(bob.id, 'DEMO'), usd(9) + usd(2.85));
  assert.equal(w.ledger.balance(0, 'DEMO'), usd(0.15));
  assert.equal(totalMoney(w.db, 'DEMO'), before + usd(30), 'no money created or lost');
  assert.equal(w.db.prepare('SELECT status FROM matches').get().status, 'settled');
});

test('cash-out pays immediately and the match keeps going', () => {
  const w = arenaWorld();
  const { room, byName, users } = startMatch(w, ['alice', 'bob', 'carol']);
  byName.alice.cashoutHold = true;
  byName.alice.boosting = false;
  for (let i = 0; i < 30 && byName.alice.alive; i++) room.tick();
  assert.equal(byName.alice.alive, false);
  assert.equal(byName.alice.cashedOut, true);
  assert.equal(w.ledger.balance(users[0].id, 'DEMO'), usd(9.95));
  assert.equal(room.phase, 'playing');
  room.killSnake(byName.carol, { killer: byName.bob });
  room.checkRoundEnd();
  assert.equal(w.ledger.balance(users[1].id, 'DEMO'), usd(9) + usd(1.9));
  assert.equal(totalMoney(w.db, 'DEMO'), usd(30));
});

test('boosting cancels the cash-out channel', () => {
  const w = arenaWorld();
  const { room, byName } = startMatch(w, ['alice', 'bob']);
  byName.alice.cashoutHold = true;
  byName.alice.boosting = true;
  runTicks(room, 40);
  assert.equal(byName.alice.cashedOut, undefined);
});

test('time limit pays every survivor', () => {
  const w = arenaWorld({ ARENA_MATCH_SECONDS: 2 });
  const { room, users } = startMatch(w, ['alice', 'bob']);
  // Keep them apart and alive.
  room.humans().forEach(p => { p.protect = 1e9; });
  runTicks(room, 60);
  assert.equal(room.phase, 'ended');
  for (const u of users) assert.equal(w.ledger.balance(u.id, 'DEMO'), usd(9.95));
});

test('everyone dying at once shares the leftover orbs', () => {
  const w = arenaWorld();
  const { room, byName, users } = startMatch(w, ['alice', 'bob']);
  room.killSnake(byName.alice, { reason: 'zone' });
  room.killSnake(byName.bob, { reason: 'zone' });
  room.checkRoundEnd();
  const a = w.ledger.balance(users[0].id, 'DEMO'), b = w.ledger.balance(users[1].id, 'DEMO');
  assert.equal(a + b + w.ledger.balance(0, 'DEMO'), usd(20));
});

test('crash recovery refunds queued players and settles running matches', () => {
  const w = arenaWorld();
  const { byName, users, room } = startMatch(w, ['alice', 'bob', 'carol']);
  room.killSnake(byName.carol, { killer: byName.bob });
  const dave = w.user('dave', usd(10));
  w.arena.queue({ user: dave, tierId: 't1', socketId: null, profile: profile('dave') });
  // "Restart": a fresh arena instance over the same database.
  const fresh = createArena({ db: w.db, ledger: w.ledger, config: w.config, stats: w.stats });
  const r = fresh.recover();
  assert.equal(r.refunded, 1);
  assert.equal(r.settled, 1);
  assert.equal(w.ledger.balance(dave.id, 'DEMO'), usd(10));
  assert.equal(w.ledger.balance(users[0].id, 'DEMO'), usd(9.95));
  assert.equal(w.ledger.balance(users[1].id, 'DEMO'), usd(10.9));
  assert.equal(totalMoney(w.db, 'DEMO'), usd(40));
});

test('shutdown settles everything', () => {
  const w = arenaWorld();
  const { users } = startMatch(w, ['alice', 'bob']);
  const carol = w.user('carol', usd(10));
  w.arena.queue({ user: carol, tierId: 't1', socketId: null, profile: profile('carol') });
  w.arena.shutdown();
  assert.equal(w.ledger.balance(carol.id, 'DEMO'), usd(10));
  for (const u of users) assert.equal(w.ledger.balance(u.id, 'DEMO'), usd(9.95));
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status IN ('forming','running')").get().n, 0);
});
