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
      const ok = await bcrypt.compare(String(password || ''), user.password_hash);
      if (!ok) return { ok: false, error: 'bad_credentials' };
      if (user.banned) return { ok: false, error: 'banned' };
      return { ok: true, user };
    },
  };
}

module.exports = { makeSessionToken, verifySessionToken, makeSupporterToken, verifySupporterToken, createAccounts };
