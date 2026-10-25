'use strict';
const crypto = require('crypto');
const config = require('./config');
const { safeEqual } = require('./util');

const hmac = payload => crypto.createHmac('sha256', config.TOKEN_SECRET).update(payload).digest('hex');

function makeSessionToken(userId) {
  const exp = Date.now() + config.SESSION_DAYS * 86400000;
  const payload = `v2.${userId}.${exp}`;
  return `${payload}.${hmac(payload)}`;
}

// Returns the user id, or null when the token is invalid or expired.
function verifySessionToken(token) {
  if (typeof token !== 'string' || token.length > 300) return null;
  if (token.startsWith('v2.')) {
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [, uid, exp, sig] = parts;
    if (!safeEqual(sig, hmac(`v2.${uid}.${exp}`))) return null;
    if (Number(exp) < Date.now()) return null;
    const id = parseInt(uid, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
  // Legacy format uid:<id>:<issuedAt>:<sig>, accepted for SESSION_DAYS after issue.
  const parts = token.split(':');
  if (parts.length !== 4 || parts[0] !== 'uid') return null;
  const sig = parts.pop();
  if (!safeEqual(sig, hmac(parts.join(':')))) return null;
  if (Date.now() - Number(parts[2]) > config.SESSION_DAYS * 86400000) return null;
  const id = parseInt(parts[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function makeSupporterToken(sessionId) {
  const payload = `supporter:${sessionId}`;
  return `${payload}:${hmac(payload)}`;
}
function verifySupporterToken(token) {
  if (typeof token !== 'string' || token.length > 300) return false;
  const parts = token.split(':');
  if (parts.length !== 3 || parts[0] !== 'supporter') return false;
  return safeEqual(parts[2], hmac(`${parts[0]}:${parts[1]}`));
}

function createAccounts(db) {
  let bcrypt = null;
  try { bcrypt = require('bcryptjs'); } catch (e) { console.warn('bcryptjs missing, accounts disabled'); }
  const enabled = !!(db && bcrypt);
  // Compared against when the username does not exist, so both paths take the same time.
  const DUMMY_HASH = enabled ? bcrypt.hashSync('not-a-real-password', 10) : '';

  const q = enabled ? {
    byName: db.prepare('SELECT * FROM users WHERE username=?'),
    byId: db.prepare('SELECT * FROM users WHERE id=?'),
    insert: db.prepare('INSERT INTO users(username,password_hash) VALUES(?,?)'),
  } : null;

  return {
    enabled,
    getUser: id => (enabled ? q.byId.get(id) : null),
    setCompliance: id => db.prepare("UPDATE users SET age_confirmed_at=strftime('%s','now'), terms_accepted_at=strftime('%s','now') WHERE id=?").run(id),
    // Self-exclusion can only be extended, never shortened.
    setExcludedUntil: (id, untilSec) => db.prepare('UPDATE users SET excluded_until=MAX(COALESCE(excluded_until,0), ?) WHERE id=?').run(untilSec, id),
    setSupporter: id => db.prepare('UPDATE users SET supporter=1 WHERE id=?').run(id),
    setBanned(username, banned) {
      const r = db.prepare('UPDATE users SET banned=? WHERE username=?').run(banned ? 1 : 0, username);
      return r.changes ? { ok: true } : { ok: false, error: 'user_not_found' };
    },
    async register(username, password) {
      if (!enabled) return { ok: false, error: 'auth_unavailable' };
      const u = String(username || '').trim();
      const p = String(password || '');
      if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(u)) return { ok: false, error: 'username_invalid' };
      if (p.length < 6 || p.length > 72) return { ok: false, error: 'password_short' };
      if (q.byName.get(u)) return { ok: false, error: 'username_taken' };
      const hash = await bcrypt.hash(p, 10);
      try {
        const r = q.insert.run(u, hash);
        return { ok: true, user: q.byId.get(r.lastInsertRowid) };
      } catch (e) {
        return { ok: false, error: 'username_taken' };
      }
    },
    async login(username, password) {
      if (!enabled) return { ok: false, error: 'auth_unavailable' };
      const user = q.byName.get(String(username || '').trim());
      // Same error whether the user exists or not, to avoid account enumeration.
      if (!user) { await bcrypt.compare(String(password || ''), DUMMY_HASH); return { ok: false, error: 'bad_credentials' }; }
      // Wallet-only accounts have no password hash.
      const ok = String(user.password_hash).startsWith('$2') && await bcrypt.compare(String(password || ''), user.password_hash);
      if (!ok) return { ok: false, error: 'bad_credentials' };
      if (user.banned) return { ok: false, error: 'banned' };
      return { ok: true, user };
    },

    // ── Wallet accounts ──────────────────────────────────────────────────────
    links(userId) {
      if (!enabled) return {};
      const out = {};
      for (const r of db.prepare('SELECT family, address FROM wallet_links WHERE user_id=?').all(userId)) out[r.family] = r.address;
      return out;
    },
    userByWallet(family, address) {
      const r = enabled && db.prepare('SELECT user_id FROM wallet_links WHERE family=? AND address=?').get(family, address);
      return r ? q.byId.get(r.user_id) : null;
    },
    // Finds the account owning this wallet, or creates one named after the address.
    walletLogin(family, address) {
      if (!enabled) return { ok: false, error: 'auth_unavailable' };
      const existing = this.userByWallet(family, address);
      if (existing) return existing.banned ? { ok: false, error: 'banned' } : { ok: true, user: existing, created: false };
      const prefix = { solana: 'sol', evm: 'evm', tron: 'trx' }[family];
      const core = (family === 'evm' ? address.slice(2, 8) : address.slice(0, 6));
      let name = `${prefix}_${core}`;
      for (let i = 2; q.byName.get(name); i++) name = `${prefix}_${core}${i}`;
      const user = db.transaction(() => {
        const r = db.prepare("INSERT INTO users(username,password_hash,auto_name) VALUES(?, '!', 1)").run(name);
        db.prepare('INSERT INTO wallet_links(user_id,family,address) VALUES(?,?,?)').run(r.lastInsertRowid, family, address);
        return q.byId.get(r.lastInsertRowid);
      })();
      return { ok: true, user, created: true };
    },
    // Links a wallet to an existing account. The address can't be changed afterwards
    // (withdrawals always go to it), except by an admin.
    linkWallet(userId, family, address) {
      if (!enabled) return { ok: false, error: 'auth_unavailable' };
      const owner = this.userByWallet(family, address);
      if (owner && owner.id !== userId) return { ok: false, error: 'wallet_in_use' };
      if (owner) return { ok: true };
      if (this.links(userId)[family]) return { ok: false, error: 'wallet_already_linked' };
      db.prepare('INSERT INTO wallet_links(user_id,family,address) VALUES(?,?,?)').run(userId, family, address);
      return { ok: true };
    },
    unlinkWallet(username, family) {
      const u = q.byName.get(String(username || ''));
      if (!u) return { ok: false, error: 'user_not_found' };
      const r = db.prepare('DELETE FROM wallet_links WHERE user_id=? AND family=?').run(u.id, family);
      return r.changes ? { ok: true } : { ok: false, error: 'not_linked' };
    },
    // Accounts created from a wallet can pick a real username once.
    rename(userId, username) {
      const u = q.byId.get(userId);
      if (!u || !u.auto_name) return { ok: false, error: 'rename_not_allowed' };
      const name = String(username || '').trim();
      if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(name)) return { ok: false, error: 'username_invalid' };
      if (q.byName.get(name)) return { ok: false, error: 'username_taken' };
      db.prepare('UPDATE users SET username=?, auto_name=0 WHERE id=?').run(name, userId);
      return { ok: true, user: q.byId.get(userId) };
    },
  };
}

module.exports = { makeSessionToken, verifySessionToken, makeSupporterToken, verifySupporterToken, createAccounts };
