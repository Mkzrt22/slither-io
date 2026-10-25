'use strict';
const crypto = require('crypto');
const { SKIN_ROWS, SKIN_COLS, SKIN_IDS } = require('../shared/constants');

const rnd = n => Math.random() * n;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const dist = (a, b) => Math.sqrt(dist2(a, b));
function wrapDist2(a, b, W, H) {
  let dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  if (dx > W / 2) dx = W - dx;
  if (dy > H / 2) dy = H - dy;
  return dx * dx + dy * dy;
}
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
const wrap = (v, size) => ((v % size) + size) % size;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── Text moderation ──────────────────────────────────────────────────────────
const BAD_WORDS = [
  'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut',
  'pute', 'salope', 'connard', 'connasse', 'encule', 'enculé', 'batard', 'bâtard', 'pd', 'nique', 'fdp', 'ntm',
];
const BAD_RE = new RegExp('(?<![\\p{L}\\p{N}])(' + BAD_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
function filterText(s) { return s.replace(BAD_RE, m => '*'.repeat(m.length)); }

function cleanText(input, max) {
  if (typeof input !== 'string') return '';
  // Strip control characters and angle brackets, collapse whitespace.
  return input.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanName(input, fallback = 'Anonymous') {
  const n = filterText(cleanText(input, 16));
  return n || fallback;
}

// ── Payload validation ───────────────────────────────────────────────────────
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
function cleanCustomSkin(cs) {
  if (!Array.isArray(cs) || cs.length !== SKIN_ROWS) return null;
  let any = false;
  const out = [];
  for (const row of cs) {
    if (!Array.isArray(row) || row.length !== SKIN_COLS) return null;
    out.push(row.map(c => {
      if (typeof c === 'string' && HEX_COLOR.test(c)) { any = true; return c.toLowerCase(); }
      return null;
    }));
  }
  return any ? out : null;
}
function cleanSkin(s) { return SKIN_IDS.includes(s) ? s : 'solid'; }
function isFiniteNumber(n) { return typeof n === 'number' && Number.isFinite(n); }

// ── Rate limiting (token bucket) ─────────────────────────────────────────────
class RateLimiter {
  constructor() { this.buckets = new Map(); }
  // capacity tokens, refilled at `perSec` tokens per second.
  allow(key, capacity, perSec) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: capacity, at: now }; this.buckets.set(key, b); }
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * perSec);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
  sweep(maxAgeMs = 10 * 60 * 1000) {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (now - b.at > maxAgeMs) this.buckets.delete(k);
  }
}

function clientIp(socketOrReq) {
  const headers = socketOrReq.handshake ? socketOrReq.handshake.headers : socketOrReq.headers;
  const fwd = headers && headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return socketOrReq.handshake ? socketOrReq.handshake.address : (socketOrReq.ip || '');
}

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function utcDateKey(date = new Date()) { return date.toISOString().slice(0, 10); }

module.exports = {
  rnd, pick, clamp, dist2, dist, wrapDist2, angleDiff, wrap, safeEqual,
  filterText, cleanText, cleanName, cleanCustomSkin, cleanSkin, isFiniteNumber,
  RateLimiter, clientIp, isoWeekKey, utcDateKey,
};
