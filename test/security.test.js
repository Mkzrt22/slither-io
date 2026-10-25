'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/util');
const auth = require('../src/auth');
const { computeElo } = require('../src/stats');
const { createPayments } = require('../src/payments');
const { arenaWorld, usd } = require('./helpers');

test('custom skins are validated', () => {
  const row = () => Array(15).fill(null);
  assert.equal(U.cleanCustomSkin('x'), null);
  assert.equal(U.cleanCustomSkin([row(), row()]), null);
  assert.equal(U.cleanCustomSkin([row(), row(), row()]), null, 'empty skin');
  const ok = [row(), row(), row()];
  ok[1][3] = '#FF00aa';
  ok[2][4] = 'red;background:url(x)';
  const clean = U.cleanCustomSkin(ok);
  assert.equal(clean[1][3], '#ff00aa');
  assert.equal(clean[2][4], null);
  assert.equal(U.cleanCustomSkin([Array(5000).fill('#ffffff'), row(), row()]), null, 'oversized rows rejected');
});

test('names and chat are cleaned and filtered', () => {
  assert.equal(U.cleanName('  <b>Bob</b>\u0000 '), 'bBob/b');
  assert.equal(U.cleanName(''), 'Anonymous');
  assert.equal(U.cleanName('x'.repeat(40)).length, 16);
  assert.equal(U.filterText('quelle salope'), 'quelle ******');
  assert.equal(U.filterText('passage'), 'passage');
  assert.equal(U.cleanSkin('hacker'), 'solid');
});

test('rate limiter', () => {
  const rl = new U.RateLimiter();
  assert.equal(rl.allow('k', 2, 0), true);
  assert.equal(rl.allow('k', 2, 0), true);
  assert.equal(rl.allow('k', 2, 0), false);
});

test('session tokens expire and cannot be forged', () => {
  const tok = auth.makeSessionToken(42);
  assert.equal(auth.verifySessionToken(tok), 42);
  const parts = tok.split('.');
  assert.equal(auth.verifySessionToken(`v2.43.${parts[2]}.${parts[3]}`), null);
  assert.equal(auth.verifySessionToken(`v2.42.${Date.now() - 1000}.${parts[3]}`), null);
  assert.equal(auth.verifySessionToken('garbage'), null);
  assert.equal(auth.verifySessionToken('uid:1:2:zz'), null);
  assert.equal(auth.verifySupporterToken('a:b:zz'), false, 'malformed supporter token does not throw');
  assert.equal(auth.verifySupporterToken(auth.makeSupporterToken('cs_test_1')), true);
});

test('pairwise Elo is zero-sum and rewards the winner', () => {
  const r = computeElo([{ elo: 1000 }, { elo: 1000 }, { elo: 1000 }]);
  assert.ok(r[0].change > 0 && r[2].change < 0);
  assert.ok(Math.abs(r.reduce((s, x) => s + x.change, 0)) <= 1);
});

test('demo mode: faucet cooldown and no withdrawals', () => {
  const w = arenaWorld();
  const payments = createPayments({ db: w.db, ledger: w.ledger, config: w.config, getUser: () => null });
  const u = w.user('d', 0);
  assert.equal(payments.faucet(u).ok, true);
  assert.equal(payments.faucet(u).error, 'faucet_cooldown');
  assert.equal(w.ledger.balance(u.id, 'DEMO'), usd(10));
  assert.equal(payments.requestWithdrawal(u, null, 'SOL', usd(5)).error, 'demo_no_withdraw');
});
