'use strict';
const crypto = require('crypto');
const { LedgerError, HOUSE_USER_ID } = require('./economy/ledger');
const { formatMoney, MONEY_SCALE } = require('../shared/constants');

// Deposits / withdrawals.
//  - demo: free demo credits (faucet). Nothing has real value. This is the default.
//  - nowpayments: crypto deposits through NOWPayments hosted invoices, credited by signed IPN.
//    Withdrawals are always queued for manual approval in the admin page.

function sortObject(obj) {
  if (Array.isArray(obj)) return obj.map(sortObject);
  if (!obj || typeof obj !== 'object') return obj;
  return Object.keys(obj).sort().reduce((acc, k) => { acc[k] = sortObject(obj[k]); return acc; }, {});
}
function nowpaymentsSignature(body, secret) {
  return crypto.createHmac('sha512', secret).update(JSON.stringify(sortObject(body))).digest('hex');
}

function createPayments({ db, ledger, config, getUser, onWalletChange = () => {} }) {
  const enabled = !!(db && ledger);
  const currency = config.CURRENCY;
  const mode = config.PAYMENTS_MODE;
  const apiBase = config.NOWPAYMENTS.sandbox ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1';

  const q = enabled ? {
    insertDeposit: db.prepare('INSERT INTO deposits(user_id,provider,currency,amount,status) VALUES(?,?,?,?,?)'),
    getDeposit: db.prepare('SELECT * FROM deposits WHERE id=?'),
    setDeposit: db.prepare("UPDATE deposits SET status=?, provider_ref=COALESCE(?,provider_ref), raw=COALESCE(?,raw), updated_at=strftime('%s','now') WHERE id=?"),
    listDeposits: db.prepare('SELECT d.*, u.username FROM deposits d LEFT JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT ?'),
    insertWithdrawal: db.prepare("INSERT INTO withdrawals(user_id,currency,amount,network,address,status) VALUES(?,?,?,?,?,'pending')"),
    getWithdrawal: db.prepare('SELECT * FROM withdrawals WHERE id=?'),
    setWithdrawal: db.prepare("UPDATE withdrawals SET status=?, txid=?, admin_note=?, updated_at=strftime('%s','now') WHERE id=?"),
    listWithdrawals: db.prepare('SELECT w.*, u.username FROM withdrawals w LEFT JOIN users u ON u.id=w.user_id WHERE (?=\'all\' OR w.status=?) ORDER BY w.id DESC LIMIT 200'),
    userWithdrawals: db.prepare('SELECT id, amount, network, address, status, txid, created_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 10'),
    sumKind: db.prepare('SELECT COALESCE(SUM(delta),0) AS s FROM ledger WHERE currency=? AND kind=?'),
    userByName: db.prepare('SELECT id, username FROM users WHERE username=?'),
  } : null;

  function walletInfo(userId) {
    if (!enabled || !userId) return null;
    const w = ledger.wallet(userId, currency);
    const nextFaucet = (w.last_faucet_at || 0) + config.DEMO_FAUCET_HOURS * 3600000;
    return {
      currency, mode, balance: w.balance,
      faucet: mode === 'demo' ? { amount: config.DEMO_FAUCET_AMOUNT, availableIn: Math.max(0, Math.ceil((nextFaucet - Date.now()) / 1000)) } : null,
      minDeposit: config.MIN_DEPOSIT, maxDeposit: config.MAX_DEPOSIT, minWithdrawal: config.MIN_WITHDRAWAL,
      networks: config.WITHDRAW_NETWORKS,
      withdrawals: q.userWithdrawals.all(userId),
      history: ledger.history(userId, currency, 15),
    };
  }

  function blocked(user) {
    if (!user) return 'login_required';
    if (user.banned) return 'banned';
    if (!user.age_confirmed_at || !user.terms_accepted_at) return 'compliance_required';
    if (user.excluded_until && user.excluded_until * 1000 > Date.now()) return 'self_excluded';
    return null;
  }

  function faucet(user) {
    if (mode !== 'demo') return { ok: false, error: 'not_demo' };
    const err = blocked(user);
    if (err) return { ok: false, error: err };
    const w = ledger.wallet(user.id, currency);
    if (Date.now() - (w.last_faucet_at || 0) < config.DEMO_FAUCET_HOURS * 3600000) return { ok: false, error: 'faucet_cooldown' };
    db.transaction(() => {
      ledger.apply(user.id, currency, config.DEMO_FAUCET_AMOUNT, 'faucet', null);
      ledger.setFaucetAt(user.id, currency, Date.now());
    })();
    onWalletChange(user.id);
    return { ok: true };
  }

  async function createDeposit(user, amountUnits) {
    if (mode !== 'nowpayments') return { ok: false, error: 'deposits_disabled' };
    const err = blocked(user);
    if (err) return { ok: false, error: err };
    if (!Number.isInteger(amountUnits) || amountUnits < config.MIN_DEPOSIT || amountUnits > config.MAX_DEPOSIT) return { ok: false, error: 'invalid_amount' };
    const r = q.insertDeposit.run(user.id, 'nowpayments', currency, amountUnits, 'pending');
    const depositId = Number(r.lastInsertRowid);
    try {
      const res = await fetch(apiBase + '/invoice', {
        method: 'POST',
        headers: { 'x-api-key': config.NOWPAYMENTS.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price_amount: amountUnits / MONEY_SCALE,
          price_currency: 'usd',
          order_id: 'dep_' + depositId,
          order_description: 'NeonSlither balance top-up',
          ipn_callback_url: config.PUBLIC_URL + '/api/payments/nowpayments/ipn',
          success_url: config.PUBLIC_URL + '/?deposit=ok',
          cancel_url: config.PUBLIC_URL + '/?deposit=cancel',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.invoice_url) {
        q.setDeposit.run('failed', null, JSON.stringify(data).slice(0, 2000), depositId);
        return { ok: false, error: 'provider_error' };
      }
      q.setDeposit.run('pending', String(data.id || ''), null, depositId);
      return { ok: true, url: data.invoice_url };
    } catch (e) {
      q.setDeposit.run('failed', null, String(e.message).slice(0, 500), depositId);
      return { ok: false, error: 'provider_error' };
    }
  }

  // NOWPayments instant payment notification. Returns an HTTP status code.
  function handleNowpaymentsIpn(body, signature) {
    if (mode !== 'nowpayments') return 404;
    if (!signature || !body || typeof body !== 'object') return 400;
    const expected = nowpaymentsSignature(body, config.NOWPAYMENTS.ipnSecret);
    const a = Buffer.from(String(signature)), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 401;
    const m = /^dep_(\d+)$/.exec(String(body.order_id || ''));
    if (!m) return 200;
    const dep = q.getDeposit.get(Number(m[1]));
    if (!dep || dep.status === 'credited') return 200;
    const status = String(body.payment_status || '');
    const raw = JSON.stringify(body).slice(0, 4000);
    if (status === 'finished') {
      const paidUsd = Number(body.price_amount);
      const currencyOk = String(body.price_currency || '').toLowerCase() === 'usd';
      if (!currencyOk || Math.abs(paidUsd * MONEY_SCALE - dep.amount) > 1) {
        q.setDeposit.run('review', String(body.payment_id || ''), raw, dep.id);
        return 200;
      }
      db.transaction(() => {
        ledger.apply(dep.user_id, dep.currency, dep.amount, 'deposit', 'dep_' + dep.id);
        q.setDeposit.run('credited', String(body.payment_id || ''), raw, dep.id);
      })();
      onWalletChange(dep.user_id);
    } else if (['failed', 'expired', 'refunded'].includes(status)) {
      q.setDeposit.run(status, String(body.payment_id || ''), raw, dep.id);
    } else if (status === 'partially_paid') {
      q.setDeposit.run('review', String(body.payment_id || ''), raw, dep.id);
    }
    return 200;
  }

  function requestWithdrawal(user, amountUnits, network, address) {
    if (mode === 'demo') return { ok: false, error: 'demo_no_withdraw' };
    const err = blocked(user);
    if (err) return { ok: false, error: err };
    if (!Number.isInteger(amountUnits) || amountUnits < config.MIN_WITHDRAWAL) return { ok: false, error: 'invalid_amount' };
    if (!config.WITHDRAW_NETWORKS.includes(network)) return { ok: false, error: 'invalid_network' };
    const addr = String(address || '').trim();
    if (!/^[A-Za-z0-9:_-]{20,128}$/.test(addr)) return { ok: false, error: 'invalid_address' };
    try {
      db.transaction(() => {
        const r = q.insertWithdrawal.run(user.id, currency, amountUnits, network, addr);
        ledger.apply(user.id, currency, -amountUnits, 'withdrawal_hold', 'wd_' + r.lastInsertRowid);
      })();
    } catch (e) {
      if (e instanceof LedgerError) return { ok: false, error: e.code };
      throw e;
    }
    onWalletChange(user.id);
    return { ok: true };
  }

  // ── Admin ──────────────────────────────────────────────────────────────────
  const admin = {
    overview() {
      return {
        mode, currency,
        house: ledger.balance(HOUSE_USER_ID, currency),
        rake: q.sumKind.get(currency, 'arena_rake').s,
        deposits: q.sumKind.get(currency, 'deposit').s,
        withdrawals: -q.sumKind.get(currency, 'withdrawal_hold').s - q.sumKind.get(currency, 'withdrawal_refund').s,
        faucet: q.sumKind.get(currency, 'faucet').s,
        pendingWithdrawals: q.listWithdrawals.all('pending', 'pending').length,
      };
    },
    withdrawals: status => q.listWithdrawals.all(status || 'pending', status || 'pending'),
    deposits: () => q.listDeposits.all(100),
    markSent(id, txid) {
      const w = q.getWithdrawal.get(id);
      if (!w || w.status !== 'pending') return { ok: false, error: 'not_pending' };
      q.setWithdrawal.run('sent', String(txid || '').slice(0, 200), null, id);
      onWalletChange(w.user_id);
      return { ok: true };
    },
    reject(id, note) {
      const w = q.getWithdrawal.get(id);
      if (!w || w.status !== 'pending') return { ok: false, error: 'not_pending' };
      db.transaction(() => {
        ledger.apply(w.user_id, w.currency, w.amount, 'withdrawal_refund', 'wd_' + id);
        q.setWithdrawal.run('rejected', null, String(note || '').slice(0, 500), id);
      })();
      onWalletChange(w.user_id);
      return { ok: true };
    },
    adjust(username, amountUnits, note) {
      const u = q.userByName.get(String(username || ''));
      if (!u) return { ok: false, error: 'user_not_found' };
      if (!Number.isInteger(amountUnits) || amountUnits === 0) return { ok: false, error: 'invalid_amount' };
      try { ledger.transfer(u.id, currency, amountUnits, 'adjust', String(note || '').slice(0, 200)); }
      catch (e) { if (e instanceof LedgerError) return { ok: false, error: e.code }; throw e; }
      onWalletChange(u.id);
      return { ok: true, balance: formatMoney(ledger.balance(u.id, currency), currency) };
    },
  };

  return { enabled, mode, currency, walletInfo, faucet, createDeposit, handleNowpaymentsIpn, requestWithdrawal, admin, blocked, getUser };
}

module.exports = { createPayments, nowpaymentsSignature, sortObject };
