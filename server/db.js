// SQLite schema + helpers. Maps_played is now a real table instead of a JSON column.
const fs = require('fs');
const path = require('path');
const log = require('./logger');

// Persistent data dir (DATA_DIR env, default: project root). Created if missing.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_PATH  = path.join(DATA_DIR, 'data.db');

let db = null;
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
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
      powerups_collected INTEGER DEFAULT 0,
      ghost_count INTEGER DEFAULT 0,
      ranked_games INTEGER DEFAULT 0,
      teams_wins INTEGER DEFAULT 0,
      max_kills_game INTEGER DEFAULT 0,
      total_survive_ticks INTEGER DEFAULT 0,
      elo INTEGER DEFAULT 1000,
      elo_wins INTEGER DEFAULT 0,
      elo_losses INTEGER DEFAULT 0,
      elo_streak INTEGER DEFAULT 0,
      prestige INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS achievements (
      user_id INTEGER REFERENCES users(id),
      achievement_id TEXT NOT NULL,
      unlocked_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY(user_id, achievement_id)
    );
    CREATE TABLE IF NOT EXISTS user_maps (
      user_id INTEGER REFERENCES users(id),
      map_id TEXT NOT NULL,
      games INTEGER DEFAULT 0,
      PRIMARY KEY(user_id, map_id)
    );
    CREATE TABLE IF NOT EXISTS friends (
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY(user_id, friend_id)
    );
    CREATE TABLE IF NOT EXISTS purchases (
      session_id TEXT PRIMARY KEY,
      user_id INTEGER,
      product TEXT NOT NULL,
      paid_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS mutes (
      user_id INTEGER NOT NULL,
      muted_username TEXT NOT NULL,
      PRIMARY KEY(user_id, muted_username)
    );
  `);
  // Migration: drop legacy JSON column quietly
  try { db.exec('ALTER TABLE stats DROP COLUMN maps_played'); } catch {}

  log.info('SQLite DB ready');
} catch (e) {
  log.warn('SQLite unavailable — running without persistence: ' + e.message);
  db = null;
}

const getUser = (username) =>
  db?.prepare('SELECT * FROM users WHERE username=?').get(username);

const getUserById = (id) =>
  db?.prepare('SELECT * FROM users WHERE id=?').get(id);

function getStats(userId) {
  if (!db) return null;
  let s = db.prepare('SELECT * FROM stats WHERE user_id=?').get(userId);
  if (!s) {
    db.prepare('INSERT OR IGNORE INTO stats(user_id) VALUES(?)').run(userId);
    s = db.prepare('SELECT * FROM stats WHERE user_id=?').get(userId);
  }
  return s;
}

function saveStats(userId, patch) {
  if (!db || !Object.keys(patch).length) return;
  const cols = Object.keys(patch).map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE stats SET ${cols} WHERE user_id=?`).run(...Object.values(patch), userId);
}

const getAchievements = (userId) =>
  db?.prepare('SELECT achievement_id FROM achievements WHERE user_id=?')
    .all(userId).map(r => r.achievement_id) || [];

function unlockAchievement(userId, id) {
  if (!db) return false;
  return db.prepare('INSERT OR IGNORE INTO achievements(user_id,achievement_id) VALUES(?,?)')
    .run(userId, id).changes > 0;
}

function incMapPlayed(userId, mapId) {
  if (!db) return;
  db.prepare(`INSERT INTO user_maps(user_id, map_id, games) VALUES(?,?,1)
              ON CONFLICT(user_id, map_id) DO UPDATE SET games = games + 1`)
    .run(userId, mapId);
}

function getMapsPlayed(userId) {
  if (!db) return {};
  const rows = db.prepare('SELECT map_id, games FROM user_maps WHERE user_id=?').all(userId);
  const out = {};
  for (const r of rows) out[r.map_id] = r.games;
  return out;
}

function recordPurchase(sessionId, userId, product) {
  if (!db) return;
  db.prepare('INSERT OR IGNORE INTO purchases(session_id, user_id, product) VALUES(?,?,?)')
    .run(sessionId, userId, product);
}

function getPurchase(sessionId) {
  return db?.prepare('SELECT * FROM purchases WHERE session_id=?').get(sessionId);
}

function getPurchasesByUser(userId) {
  return db?.prepare('SELECT * FROM purchases WHERE user_id=?').all(userId) || [];
}

function addFriend(userId, friendId) {
  if (!db || userId === friendId) return false;
  return db.prepare('INSERT OR IGNORE INTO friends(user_id, friend_id) VALUES(?,?)')
    .run(userId, friendId).changes > 0;
}

function removeFriend(userId, friendId) {
  if (!db) return;
  db.prepare('DELETE FROM friends WHERE user_id=? AND friend_id=?').run(userId, friendId);
}

function listFriends(userId) {
  if (!db) return [];
  return db.prepare(`SELECT u.id, u.username FROM friends f
                     JOIN users u ON u.id = f.friend_id
                     WHERE f.user_id=?`).all(userId);
}

function muteUser(userId, mutedName) {
  if (!db) return;
  db.prepare('INSERT OR IGNORE INTO mutes(user_id, muted_username) VALUES(?,?)')
    .run(userId, mutedName);
}

function listMutes(userId) {
  if (!db) return [];
  return db.prepare('SELECT muted_username FROM mutes WHERE user_id=?').all(userId)
    .map(r => r.muted_username);
}

module.exports = {
  db,
  getUser, getUserById, getStats, saveStats,
  getAchievements, unlockAchievement,
  incMapPlayed, getMapsPlayed,
  recordPurchase, getPurchase, getPurchasesByUser,
  addFriend, removeFriend, listFriends,
  muteUser, listMutes,
};
