'use strict';
const { open } = require('../src/db');
const { createLedger } = require('../src/economy/ledger');
const { createArena } = require('../src/economy/arena');
const { createStats } = require('../src/stats');
const { Room } = require('../src/game/room');
const { MONEY_SCALE } = require('../shared/constants');

const usd = n => Math.round(n * MONEY_SCALE);

function testConfig(overrides = {}) {
  return {
    CURRENCY: 'DEMO', PAYMENTS_MODE: 'demo', HOUSE_FEE_BPS: 500,
    ARENA_TIERS: [{ id: 't1', fee: usd(1) }],
    ARENA_MIN_PLAYERS: 2, ARENA_MAX_PLAYERS: 4, ARENA_COUNTDOWN_SECONDS: 0, ARENA_MATCH_SECONDS: 300, ARENA_CASHOUT_SECONDS: 1,
    DEMO_FAUCET_AMOUNT: usd(10), DEMO_FAUCET_HOURS: 6, MIN_DEPOSIT: usd(5), MAX_DEPOSIT: usd(500), MIN_WITHDRAWAL: usd(5),
    WITHDRAW_NETWORKS: ['USDC-SOL'], PUBLIC_URL: 'http://localhost', NOWPAYMENTS: { apiKey: 'k', ipnSecret: 'ipn-secret', sandbox: true },
    ...overrides,
  };
}

// In-memory world: DB, ledger, stats and an arena whose rooms are real Room instances.
function arenaWorld(configOverrides) {
  const db = open(':memory:');
  const config = testConfig(configOverrides);
  const ledger = createLedger(db);
  const stats = createStats(db);
  const arena = createArena({ db, ledger, config, stats });
  const rooms = [];
  arena.setBridge({
    createArenaRoom: ({ hooks }) => { const r = new Room({ id: 'a' + rooms.length, mode: 'arena', arena: hooks }); rooms.push(r); return r; },
    addToRoom: (room, e) => room.addHuman({ socketId: null, userId: e.userId, profile: e.profile }),
    toSocket: () => {},
    walletChanged: () => {},
  });
  const insertUser = db.prepare("INSERT INTO users(username,password_hash,age_confirmed_at,terms_accepted_at) VALUES(?, 'x', 1, 1)");
  function user(name, balance) {
    const id = Number(insertUser.run(name).lastInsertRowid);
    if (balance) ledger.transfer(id, config.CURRENCY, balance, 'faucet', null);
    return db.prepare('SELECT * FROM users WHERE id=?').get(id);
  }
  return { db, config, ledger, stats, arena, rooms, user };
}

// Sum of every ledger delta for a currency: deposits/faucet in minus nothing else.
function totalMoney(db, currency) {
  return db.prepare('SELECT COALESCE(SUM(balance),0) AS s FROM wallets WHERE currency=?').get(currency).s;
}

function runTicks(room, n) { for (let i = 0; i < n; i++) room.tick(); }

module.exports = { usd, testConfig, arenaWorld, totalMoney, runTicks };
