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

// Custom snake skin sent by clients. We only accept a small, predictable
// shape: a 3×15 grid of hex colour strings (or null). Anything larger or
// shaped differently is rejected so a malicious client can't broadcast
// a multi-MB blob to every other player through the state payload.
const CUSTOM_SKIN_ROWS = 3;
const CUSTOM_SKIN_COLS = 15;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function validCustomSkin(skin) {
  if (skin === null || skin === undefined) return null;
  if (typeof skin !== 'object' || Array.isArray(skin) === false) return null;
  if (skin.length !== CUSTOM_SKIN_ROWS) return null;
  const out = new Array(CUSTOM_SKIN_ROWS);
  for (let r = 0; r < CUSTOM_SKIN_ROWS; r++) {
    const row = skin[r];
    if (!Array.isArray(row) || row.length !== CUSTOM_SKIN_COLS) return null;
    const cleanRow = new Array(CUSTOM_SKIN_COLS);
    for (let c = 0; c < CUSTOM_SKIN_COLS; c++) {
      const cell = row[c];
      if (cell === null) { cleanRow[c] = null; continue; }
      if (typeof cell !== 'string' || cell.length > 9 || !HEX_RE.test(cell)) return null;
      cleanRow[c] = cell;
    }
    out[r] = cleanRow;
  }
  return out;
}

module.exports = {
  validAngle, validBoolean, validString, validUsername, validPassword,
  validEmote, validRoomId, validMode, validMapId, validCustomSkin, isFiniteNumber,
};
