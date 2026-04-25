// Lightweight input validators. All return null on invalid, sanitized value otherwise.
const { USERNAME_MIN, USERNAME_MAX, PASSWORD_MIN } = require('../shared/constants');

const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

function validAngle(v) {
  if (!isFiniteNumber(v)) return null;
  // normalize to [-PI, PI]
  let a = v;
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function validBoolean(v) { return typeof v === 'boolean' ? v : !!v; }

function validString(s, max = 60) {
  if (typeof s !== 'string') return null;
  // strip control chars + angle brackets to mitigate XSS sinks
  const cleaned = s.replace(/[\x00-\x1F<>]/g, '').trim();
  if (!cleaned.length) return null;
  return cleaned.slice(0, max);
}

function validUsername(u) {
  if (typeof u !== 'string') return null;
  const cleaned = u.trim();
  if (cleaned.length < USERNAME_MIN || cleaned.length > USERNAME_MAX) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) return null;
  return cleaned;
}

function validPassword(p) {
  if (typeof p !== 'string') return null;
  if (p.length < PASSWORD_MIN || p.length > 200) return null;
  return p;
}

function validEmote(e) {
  return ['😂', '😎', '👋', '💀'].includes(e) ? e : null;
}

function validRoomId(s) {
  if (typeof s !== 'string') return null;
  if (!/^r[A-Za-z0-9]+$/.test(s) || s.length > 32) return null;
  return s;
}

function validMode(m, allowed) {
  return allowed.includes(m) ? m : null;
}

function validMapId(m, allowed) {
  return allowed.includes(m) ? m : null;
}

module.exports = {
  validAngle, validBoolean, validString, validUsername, validPassword,
  validEmote, validRoomId, validMode, validMapId, isFiniteNumber,
};
