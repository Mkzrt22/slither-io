'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

// SQLite is optional: without it the game runs, but accounts, leaderboards
// persistence and the arena wallet are disabled.
function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const legacy = path.join(__dirname, '..', 'data.db');
  if (!process.env.DATA_DIR && fs.existsSync(legacy)) return legacy;
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  return path.join(config.DATA_DIR, 'data.db');
}

function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}
function addColumn(db, table, col, def) {
  if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

const MIGRATIONS = [
  // 1: original schema
  db => db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS stats (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      games INTEGER DEFAULT 0,
      best_score INTEGER DEFAULT 0,
      total_kills INTEGER DEFAULT 0,
      total_food INTEGER DEFAULT 0,
      best_level INTEGER DEFAULT 0,
      total_xp INTEGER DEFAULT 0,
      maps_played TEXT DEFAULT '{}',
      powerups_collected INTEGER DEFAULT 0,
      ghost_count INTEGER DEFAULT 0,
      ranked_games INTEGER DEFAULT 0,
      teams_wins INTEGER DEFAULT 0,
      max_kills_game INTEGER DEFAULT 0,
      total_survive_ticks INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS achievements (
      user_id INTEGER REFERENCES users(id),
      achievement_id TEXT NOT NULL,
      unlocked_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY(user_id, achievement_id)
    );
  `),
  // 2: progression, leaderboards, compliance, wallet and arena
  db => {
    addColumn(db, 'users', 'supporter', 'INTEGER DEFAULT 0');
    addColumn(db, 'users', 'age_confirmed_at', 'INTEGER');
    addColumn(db, 'users', 'terms_accepted_at', 'INTEGER');
    addColumn(db, 'users', 'excluded_until', 'INTEGER DEFAULT 0');
    addColumn(db, 'users', 'banned', 'INTEGER DEFAULT 0');
    addColumn(db, 'stats', 'speed_count', 'INTEGER DEFAULT 0');
    addColumn(db, 'stats', 'max_survive_ticks', 'INTEGER DEFAULT 0');
    addColumn(db, 'stats', 'elo', 'INTEGER DEFAULT 1000');
    addColumn(db, 'stats', 'elo_games', 'INTEGER DEFAULT 0');
    addColumn(db, 'stats', 'elo_wins', 'INTEGER DEFAULT 0');
    addColumn(db, 'stats', 'bp_season', 'INTEGER DEFAULT 0');
    addColumn(db, 'stats', 'bp_xp', 'INTEGER DEFAULT 0');
    addColumn(db, 'stats', 'bp_premium', 'INTEGER DEFAULT 0');
    addColumn(db, 'stats', 'daily_done', "TEXT DEFAULT ''");
    addColumn(db, 'stats', 'arena_games', 'INTEGER DEFAULT 0');
    addColumn(db, 'stats', 'arena_profit', 'INTEGER DEFAULT 0');
    db.exec(`
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        mode TEXT,
        map_id TEXT,
        week_key TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_scores_week ON scores(week_key, score DESC);
      CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);

      CREATE TABLE IF NOT EXISTS unlocks (
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, kind, value)
      );

      CREATE TABLE IF NOT EXISTS wallets (
        user_id INTEGER NOT NULL,
        currency TEXT NOT NULL,
        balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
        last_faucet_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, currency)
      );
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        currency TEXT NOT NULL,
        delta INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        kind TEXT NOT NULL,
        ref TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id DESC);

      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tier_id TEXT NOT NULL,
        currency TEXT NOT NULL,
        entry_fee INTEGER NOT NULL,
        rake INTEGER NOT NULL,
        status TEXT NOT NULL,
        orb_pool INTEGER NOT NULL DEFAULT 0,
        end_reason TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        started_at INTEGER,
        ended_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS match_players (
        match_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        name TEXT,
        status TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        payout INTEGER NOT NULL DEFAULT 0,
        kills INTEGER NOT NULL DEFAULT 0,
        died_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL,
        currency TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL,
        provider_ref TEXT,
        raw TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        currency TEXT NOT NULL,
        amount INTEGER NOT NULL,
        network TEXT NOT NULL,
        address TEXT NOT NULL,
        status TEXT NOT NULL,
        txid TEXT,
        admin_note TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      );
    `);
  },
];

// 3: wallet sign-in and on-chain deposits / withdrawals
MIGRATIONS.push(db => {
  addColumn(db, 'users', 'auto_name', 'INTEGER DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_links (
      user_id INTEGER NOT NULL,
      family TEXT NOT NULL,
      address TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (family, address),
      UNIQUE (user_id, family)
    );
  `);
  for (const [col, def] of [['chain', 'TEXT'], ['asset', 'TEXT'], ['tx_hash', 'TEXT'], ['from_address', 'TEXT'], ['token_units', 'TEXT'], ['price_micros', 'INTEGER'], ['note', 'TEXT']]) addColumn(db, 'deposits', col, def);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_tx ON deposits(chain, tx_hash) WHERE tx_hash IS NOT NULL');
  for (const [col, def] of [['asset', 'TEXT'], ['chain', 'TEXT'], ['fee', 'INTEGER DEFAULT 0'], ['token_units', 'TEXT'], ['price_micros', 'INTEGER'], ['auto', 'INTEGER DEFAULT 0']]) addColumn(db, 'withdrawals', col, def);
});

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => { MIGRATIONS[v](db); db.pragma(`user_version = ${v + 1}`); })();
  }
}

function open(file) {
  const Database = require('better-sqlite3');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  migrate(db);
  return db;
}

function init() {
  try {
    const file = resolveDbPath();
    const db = open(file);
    console.log('✅ SQLite DB ready at', file);
    return db;
  } catch (e) {
    console.warn('⚠️  SQLite unavailable, running without persistence:', e.message);
    return null;
  }
}

module.exports = { init, open, migrate };
