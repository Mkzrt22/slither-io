'use strict';
const crypto = require('crypto');
const path = require('path');
const { MONEY_SCALE } = require('../shared/constants');

const env = process.env;
const warnings = [];

function num(v, d) { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; }

// ── Secrets ──────────────────────────────────────────────────────────────────
const PLACEHOLDER_SECRETS = ['', 'change-me-in-production', 'your-random-secret-here'];
let TOKEN_SECRET = env.TOKEN_SECRET || '';
let TOKEN_SECRET_EPHEMERAL = false;
if (PLACEHOLDER_SECRETS.includes(TOKEN_SECRET)) {
  TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
  TOKEN_SECRET_EPHEMERAL = true;
  warnings.push('TOKEN_SECRET is not set: using a random secret, sessions and supporter tokens reset on every restart.');
}

// ── Payments / arena ─────────────────────────────────────────────────────────
const tiersRaw = (env.ARENA_TIERS || '0.25,1,5,20').split(',').map(s => Number(s.trim())).filter(n => n > 0);
const ARENA_TIERS = tiersRaw.map((fee, i) => ({ id: 't' + (i + 1), fee: Math.round(fee * MONEY_SCALE) }));

const NOWPAYMENTS = {
  apiKey: env.NOWPAYMENTS_API_KEY || '',
  ipnSecret: env.NOWPAYMENTS_IPN_SECRET || '',
  sandbox: env.NOWPAYMENTS_SANDBOX === 'true',
};
const ADMIN_TOKEN = env.ADMIN_TOKEN || '';

let PAYMENTS_MODE = (env.PAYMENTS_MODE || 'demo').toLowerCase();
if (PAYMENTS_MODE === 'nowpayments') {
  const missing = [];
  if (!NOWPAYMENTS.apiKey) missing.push('NOWPAYMENTS_API_KEY');
  if (!NOWPAYMENTS.ipnSecret) missing.push('NOWPAYMENTS_IPN_SECRET');
  if (!ADMIN_TOKEN) missing.push('ADMIN_TOKEN');
  if (TOKEN_SECRET_EPHEMERAL) missing.push('TOKEN_SECRET');
  if (env.ARENA_REAL_MONEY !== 'true') missing.push('ARENA_REAL_MONEY=true');
  if (missing.length) {
    warnings.push('Real-money payments disabled, missing: ' + missing.join(', ') + '. Falling back to demo credits.');
    PAYMENTS_MODE = 'demo';
  }
} else if (PAYMENTS_MODE !== 'demo') {
  warnings.push(`Unknown PAYMENTS_MODE "${PAYMENTS_MODE}", using demo.`);
  PAYMENTS_MODE = 'demo';
}

module.exports = {
  PORT: num(env.PORT, 3000),
  IS_PROD: env.NODE_ENV === 'production',
  PUBLIC_URL: (env.PUBLIC_URL || 'http://localhost:' + num(env.PORT, 3000)).replace(/\/+$/, ''),
  DATA_DIR: env.DATA_DIR || path.join(__dirname, '..', 'data'),
  TOKEN_SECRET,
  TOKEN_SECRET_EPHEMERAL,
  SESSION_DAYS: num(env.SESSION_DAYS, 30),

  STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || '',
  STRIPE_PRICE_ID: env.STRIPE_PRICE_ID || '',
  STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || '',

  ADSENSE_CLIENT: env.ADSENSE_CLIENT || 'ca-pub-5085065422144308',
  ADSENSE_SLOT_LOBBY: env.ADSENSE_SLOT_LOBBY || '',
  ADSENSE_SLOT_DEATH: env.ADSENSE_SLOT_DEATH || '',
  PLAUSIBLE_DOMAIN: env.PLAUSIBLE_DOMAIN || '',

  PAYMENTS_MODE,
  CURRENCY: PAYMENTS_MODE === 'demo' ? 'DEMO' : 'USDC',
  NOWPAYMENTS,
  ADMIN_TOKEN,
  ARENA_TIERS,
  HOUSE_FEE_BPS: Math.max(0, Math.min(3000, num(env.HOUSE_FEE_BPS, 500))),
  ARENA_MIN_PLAYERS: Math.max(2, num(env.ARENA_MIN_PLAYERS, 2)),
  ARENA_MAX_PLAYERS: Math.max(2, Math.min(16, num(env.ARENA_MAX_PLAYERS, 10))),
  ARENA_COUNTDOWN_SECONDS: num(env.ARENA_COUNTDOWN_SECONDS, 20),
  ARENA_MATCH_SECONDS: num(env.ARENA_MATCH_SECONDS, 300),
  ARENA_CASHOUT_SECONDS: num(env.ARENA_CASHOUT_SECONDS, 3),
  DEMO_FAUCET_AMOUNT: Math.round(num(env.DEMO_FAUCET_AMOUNT, 10) * MONEY_SCALE),
  DEMO_FAUCET_HOURS: num(env.DEMO_FAUCET_HOURS, 6),
  MIN_DEPOSIT: Math.round(num(env.MIN_DEPOSIT, 5) * MONEY_SCALE),
  MAX_DEPOSIT: Math.round(num(env.MAX_DEPOSIT, 500) * MONEY_SCALE),
  MIN_WITHDRAWAL: Math.round(num(env.MIN_WITHDRAWAL, 5) * MONEY_SCALE),
  WITHDRAW_NETWORKS: (env.WITHDRAW_NETWORKS || 'USDC-SOL,USDC-POLYGON,USDC-ERC20,USDT-TRC20').split(',').map(s => s.trim()).filter(Boolean),

  MAX_ROOMS: num(env.MAX_ROOMS, 40),
  MAX_PLAYERS_PER_ROOM: num(env.MAX_PLAYERS_PER_ROOM, 30),

  warnings,
};
