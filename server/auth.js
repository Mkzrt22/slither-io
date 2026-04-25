// Session token (HMAC) helpers with expiration.
const crypto = require('crypto');
const { SESSION_TOKEN_TTL_MS } = require('../shared/constants');

function makeSessionToken(userId, secret) {
  const payload = `uid:${userId}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split(':');
  if (parts.length !== 4) return null;
  const sig = parts.pop();
  const payload = parts.join(':');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch { return null; }
  const uid = parseInt(parts[1], 10);
  const issuedAt = parseInt(parts[2], 10);
  if (!Number.isFinite(uid) || !Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > SESSION_TOKEN_TTL_MS) return null;
  return uid;
}

module.exports = { makeSessionToken, verifySessionToken };
