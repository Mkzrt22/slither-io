'use strict';
const { LedgerError, HOUSE_USER_ID } = require('./economy/ledger');
const { formatMoney, MONEY_SCALE } = require('../shared/constants');
const { unitsToUsd, usdToUnits, formatUnits } = require('./crypto/prices');

// Deposits and withdrawals.
//  - demo: free demo credits (faucet), nothing has real value. Default.
//  - crypto: players send SOL / ETH / BNB / USDC / TRX / USDT from their connected wallet to
//    the house address; the server checks the transaction on-chain and credits USD.
//    Withdrawals go to the player's linked wallet: automatic under a cap, manual above.

function createPayments({ db, ledger, config, crypto, getUser = () => null, getLinks = () => ({}), onWalletChange = () => {} }) {
  const enabled = !!(db && ledger);
  const currency = config.CURRENCY;
  const mode = config.PAYMENTS_MODE;
  const live = mode === 'crypto' && !!(crypto && crypto.enabled);
  const spread = config.PRICE_SPREAD_BPS || 0;
  const checking = new Set();

  const q = enabled ? {
    insertDeposit: db.prepare("INSERT INTO deposits(user_id,provider,currency,amount,status,chain,asset,tx_hash,from_address) VALUES(?,'wallet',?,0,'pending',?,?,?,?)"),
    depositByTx: db.prepare('SELECT * FROM deposits WHERE chain=? AND tx_hash=?'),
    getDeposit: db.prepare('SELECT * FROM deposits WHERE id=?'),
    pendingDeposits: db.prepare("SELECT * FROM deposits WHERE status='pending' AND tx_hash IS NOT NULL ORDER BY id LIMIT 50"),
    creditDeposit: db.prepare("UPDATE deposits SET status='credited', amount=?, token_units=?, price_micros=?, updated_at=strftime('%s','now') WHERE id=? AND status='pending'"),
    setDeposit: db.prepare("UPDATE deposits SET status=?, note=?, updated_at=strftime('%s','now') WHERE id=?"),
    userDeposits: db.prepare('SELECT id, asset, chain, amount, status, tx_hash, note, created_at FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 10'),
    listDeposits: db.prepare('SELECT d.*, u.username FROM deposits d LEFT JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 100'),
    insertWithdrawal: db.prepare("INSERT INTO withdrawals(user_id,currency,amount,network,address,status,asset,chain,fee,token_units,price_micros,auto) VALUES(?,?,?,?,?,'pending',?,?,?,?,?,?)"),
    getWithdrawal: db.prepare('SELECT * FROM withdrawals WHERE id=?'),
    claimWithdrawal: db.prepare("UPDATE withdrawals SET status='processing', updated_at=strftime('%s','now') WHERE id=? AND status='pending'"),
    setWithdrawal: db.prepare("UPDATE withdrawals SET status=?, txid=COALESCE(?,txid), admin_note=?, updated_at=strftime('%s','now') WHERE id=?"),
    listWithdrawals: db.prepare("SELECT w.*, u.username FROM withdrawals w LEFT JOIN users u ON u.id=w.user_id WHERE (?='all' OR w.status=?) ORDER BY w.id DESC LIMIT 200"),
    userWithdrawals: db.prepare('SELECT id, asset, chain, amount, fee, address, status, txid, created_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 10'),
    autoToday: db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM withdrawals WHERE user_id=? AND auto=1 AND status IN ('processing','sent','review') AND created_at > strftime('%s','now') - 86400"),
    countStatus: db.prepare('SELECT COUNT(*) AS n FROM withdrawals WHERE status=?'),
    sumKind: db.prepare('SELECT COALESCE(SUM(delta),0) AS s FROM ledger WHERE currency=? AND kind=?'),
    userByName: db.prepare('SELECT id, username FROM users WHERE username=?'),
  } : null;

  const asset = id => (live ? crypto.assets[id] : null);
  const adapter = a => crypto.adapters[a.chain];
  const explorer = (chain, tx) => (crypto && tx ? crypto.explorerUrl(chain, tx) : null);

  function blocked(user, country) {
    if (!user) return 'login_required';
    if (user.banned) return 'banned';
    if (country && config.BLOCKED_COUNTRIES.includes(country)) return 'region_blocked';
    if (!user.age_confirmed_at || !user.terms_accepted_at) return 'compliance_required';
    if (user.excluded_until && user.excluded_until * 1000 > Date.now()) return 'self_excluded';
    return null;
  }

  function walletInfo(userId) {
    if (!enabled || !userId) return null;
    const w = ledger.wallet(userId, currency);
    const nextFaucet = (w.last_faucet_at || 0) + config.DEMO_FAUCET_HOURS * 3600000;
    return {
      currency, mode: live ? 'crypto' : 'demo', network: crypto ? crypto.network : null, balance: w.balance,
      faucet: mode === 'demo' ? { amount: config.DEMO_FAUCET_AMOUNT, availableIn: Math.max(0, Math.ceil((nextFaucet - Date.now()) / 1000)) } : null,
      assets: live ? crypto.publicAssets() : [],
      fees: config.WITHDRAW_FEES, autoMax: config.AUTO_WITHDRAW_MAX, spreadBps: spread,
      minDeposit: config.MIN_DEPOSIT, maxDeposit: config.MAX_DEPOSIT, minWithdrawal: config.MIN_WITHDRAWAL,
      links: getLinks(userId),
      deposits: q.userDeposits.all(userId).map(d => ({ ...d, url: explorer(d.chain, d.tx_hash) })),
      withdrawals: q.userWithdrawals.all(userId).map(x => ({ ...x, url: explorer(x.chain, x.txid) })),
      history: ledger.history(userId, currency, 15),
    };
  }

  function faucet(user, country) {
    if (mode !== 'demo') return { ok: false, error: 'not_demo' };
    const err = blocked(user, country);
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

  // ── Deposits ───────────────────────────────────────────────────────────────
  function depositChecks(user, country, assetId) {
    if (!live) return { error: 'deposits_disabled' };
    const err = blocked(user, country);
    if (err) return { error: err };
    const a = asset(assetId);
    if (!a) return { error: 'unknown_asset' };
    const from = getLinks(user.id)[a.family];
    if (!from) return { error: 'wallet_not_linked', family: a.family };
    return { a, from };
  }

  // Builds the transaction the player's wallet will sign (amount given in USD).
  async function prepareDeposit(user, country, assetId, usdUnits) {
    const c = depositChecks(user, country, assetId);
    if (c.error) return { ok: false, ...c };
    if (!Number.isInteger(usdUnits) || usdUnits < config.MIN_DEPOSIT || usdUnits > config.MAX_DEPOSIT) return { ok: false, error: 'invalid_amount' };
    const price = crypto.prices.priceMicros(c.a);
    if (!price) return { ok: false, error: 'price_unavailable' };
    const units = usdToUnits(usdUnits, c.a.decimals, price);
    if (units <= 0n) return { ok: false, error: 'invalid_amount' };
    try {
      const build = await adapter(c.a).buildDeposit({ asset: c.a, from: c.from, units });
      return { ok: true, assetId, units: units.toString(), display: formatUnits(units, c.a.decimals) + ' ' + c.a.symbol, build };
    } catch (e) {
      console.error('prepareDeposit failed', assetId, e.message);
      return { ok: false, error: 'chain_unavailable' };
    }
  }

  // The wallet returned a transaction hash: record it and verify it on-chain.
  function submitDeposit(user, country, assetId, txHash) {
    const c = depositChecks(user, country, assetId);
    if (c.error) return { ok: false, ...c };
    const hash = String(txHash || '').trim();
    if (!adapter(c.a).validTx(hash)) return { ok: false, error: 'invalid_tx' };
    const existing = q.depositByTx.get(c.a.chain, hash);
    if (existing) return existing.user_id === user.id ? { ok: true, id: existing.id } : { ok: false, error: 'tx_already_used' };
    const id = Number(q.insertDeposit.run(user.id, currency, c.a.chain, assetId, hash, c.from).lastInsertRowid);
    checkDeposit(q.getDeposit.get(id)).catch(() => {});
    return { ok: true, id };
  }

  async function checkDeposit(dep) {
    if (!dep || dep.status !== 'pending' || checking.has(dep.id)) return;
    const a = asset(dep.asset);
    if (!a) return;
    checking.add(dep.id);
    try {
      let r;
      try { r = await adapter(a).verifyDeposit({ txHash: dep.tx_hash, asset: a, from: dep.from_address }); }
      catch (e) { r = { status: 'pending' }; } // RPC error: try again later
      if (r.status === 'confirmed') {
        const price = crypto.prices.priceMicros(a);
        if (!price) return; // retry once a price is known
        const creditPrice = a.stable ? price : Math.floor((price * (10000 - spread)) / 10000);
        const usd = unitsToUsd(r.units, a.decimals, creditPrice);
        if (usd <= 0) { q.setDeposit.run('rejected', 'amount_too_small', dep.id); return; }
        const credited = db.transaction(() => {
          if (q.creditDeposit.run(usd, r.units.toString(), creditPrice, dep.id).changes !== 1) return false;
          ledger.apply(dep.user_id, dep.currency, usd, 'deposit', 'dep_' + dep.id);
          return true;
        })();
        if (credited) onWalletChange(dep.user_id, { type: 'deposit_credited', amount: usd });
      } else if (r.status === 'failed') {
        q.setDeposit.run('failed', r.reason || 'failed', dep.id);
        onWalletChange(dep.user_id, { type: 'deposit_failed', reason: r.reason });
      } else if (Date.now() / 1000 - dep.created_at > config.DEPOSIT_TIMEOUT_MINUTES * 60) {
        q.setDeposit.run('expired', 'not_confirmed_in_time', dep.id);
        onWalletChange(dep.user_id);
      }
    } finally { checking.delete(dep.id); }
  }

  let watcher = null;
  function start() {
    if (!live) return;
    crypto.prices.start();
    watcher = setInterval(() => { for (const d of q.pendingDeposits.all()) checkDeposit(d).catch(() => {}); }, 15000);
    if (watcher.unref) watcher.unref();
  }
  function stop() { clearInterval(watcher); if (crypto) crypto.prices.stop(); }

  // ── Withdrawals ────────────────────────────────────────────────────────────
  function quoteWithdrawal(a, usdUnits) {
    const fee = config.WITHDRAW_FEES[a.chain] || 0;
    const net = usdUnits - fee;
    if (net <= 0) return { error: 'amount_below_fee' };
    const price = crypto.prices.priceMicros(a);
    if (!price) return { error: 'price_unavailable' };
    const debitPrice = a.stable ? price : Math.ceil((price * (10000 + spread)) / 10000);
    const units = usdToUnits(net, a.decimals, debitPrice);
    if (units <= 0n) return { error: 'invalid_amount' };
    return { fee, units, price: debitPrice };
  }

  function requestWithdrawal(user, country, assetId, usdUnits) {
    if (!live) return { ok: false, error: mode === 'demo' ? 'demo_no_withdraw' : 'withdrawals_disabled' };
    const err = blocked(user, country);
    if (err) return { ok: false, error: err };
    const a = asset(assetId);
    if (!a) return { ok: false, error: 'unknown_asset' };
    const to = getLinks(user.id)[a.family];
    if (!to) return { ok: false, error: 'wallet_not_linked', family: a.family };
    if (!Number.isInteger(usdUnits) || usdUnits < config.MIN_WITHDRAWAL) return { ok: false, error: 'invalid_amount' };
    const qt = quoteWithdrawal(a, usdUnits);
    if (qt.error) return { ok: false, error: qt.error };
    const auto = crypto.canAutoSend(a.chain) && usdUnits <= config.AUTO_WITHDRAW_MAX
      && q.autoToday.get(user.id).s + usdUnits <= config.AUTO_WITHDRAW_DAILY;
    let id;
    try {
      id = db.transaction(() => {
        const r = q.insertWithdrawal.run(user.id, currency, usdUnits, assetId, to, assetId, a.chain, qt.fee, qt.units.toString(), qt.price, auto ? 1 : 0);
        ledger.apply(user.id, currency, -usdUnits, 'withdrawal_hold', 'wd_' + r.lastInsertRowid);
        // The network fee stays with the house (it pays the gas).
        if (qt.fee > 0) ledger.apply(HOUSE_USER_ID, currency, qt.fee, 'withdrawal_fee', 'wd_' + r.lastInsertRowid);
        return Number(r.lastInsertRowid);
      })();
    } catch (e) {
      if (e instanceof LedgerError) return { ok: false, error: e.code };
      throw e;
    }
    onWalletChange(user.id);
    if (auto) processWithdrawal(id).catch(() => {});
    return { ok: true, id, auto, units: formatUnits(qt.units, a.decimals) + ' ' + a.symbol };
  }

  // Sends a pending withdrawal from the hot wallet. Never refunds automatically after a
  // send attempt: if anything goes wrong it is left in "review" for a human.
  async function processWithdrawal(id) {
    if (q.claimWithdrawal.run(id).changes !== 1) return { ok: false, error: 'not_pending' };
    const w = q.getWithdrawal.get(id);
    const a = asset(w.asset);
    if (!a || !crypto.canAutoSend(a.chain)) { q.setWithdrawal.run('pending', null, 'no_hot_wallet', id); return { ok: false, error: 'no_hot_wallet' }; }
    try {
      const bal = await adapter(a).balance(a);
      if (bal < BigInt(w.token_units)) { q.setWithdrawal.run('pending', null, 'hot_wallet_low', id); return { ok: false, error: 'hot_wallet_low' }; }
    } catch (e) { q.setWithdrawal.run('pending', null, 'balance_check_failed', id); return { ok: false, error: 'chain_unavailable' }; }
    try {
      const txid = await adapter(a).sendWithdrawal({ asset: a, to: w.address, units: BigInt(w.token_units) });
      q.setWithdrawal.run('sent', String(txid), null, id);
      onWalletChange(w.user_id, { type: 'withdrawal_sent', amount: w.amount });
      return { ok: true, txid };
    } catch (e) {
      console.error('Withdrawal', id, 'failed:', e.message);
      q.setWithdrawal.run('review', null, String(e.message).slice(0, 300), id);
      onWalletChange(w.user_id);
      return { ok: false, error: 'send_failed' };
    }
  }

  // ── Admin ──────────────────────────────────────────────────────────────────
  const admin = {
    overview() {
      return {
        mode: live ? 'crypto' : 'demo', network: crypto ? crypto.network : null, currency,
        house: ledger.balance(HOUSE_USER_ID, currency),
        rake: q.sumKind.get(currency, 'arena_rake').s,
        withdrawalFees: q.sumKind.get(currency, 'withdrawal_fee').s + q.sumKind.get(currency, 'withdrawal_fee_refund').s,
        deposits: q.sumKind.get(currency, 'deposit').s,
        withdrawals: -q.sumKind.get(currency, 'withdrawal_hold').s - q.sumKind.get(currency, 'withdrawal_refund').s,
        faucet: q.sumKind.get(currency, 'faucet').s,
        pendingWithdrawals: q.countStatus.get('pending').n,
        reviewWithdrawals: q.countStatus.get('review').n,
        autoMax: config.AUTO_WITHDRAW_MAX,
      };
    },
    async hotWallets() {
      if (!live) return [];
      const out = [];
      for (const a of Object.values(crypto.assets)) {
        let bal = null;
        try { bal = formatUnits(await adapter(a).balance(a), a.decimals) + ' ' + a.symbol; } catch (e) { bal = 'error'; }
        out.push({ asset: a.id, chain: a.chainName, address: adapter(a).house, balance: bal, autoSend: crypto.canAutoSend(a.chain) });
      }
      return out;
    },
    withdrawals: status => q.listWithdrawals.all(status || 'pending', status || 'pending').map(w => {
      const a = crypto && crypto.assets[w.asset];
      return { ...w, tokens: a && w.token_units ? formatUnits(w.token_units, a.decimals) + ' ' + a.symbol : null, url: explorer(w.chain, w.txid) };
    }),
    deposits: () => q.listDeposits.all().map(d => {
      const a = crypto && crypto.assets[d.asset];
      return { ...d, tokens: a && d.token_units ? formatUnits(d.token_units, a.decimals) + ' ' + a.symbol : null, url: explorer(d.chain, d.tx_hash) };
    }),
    approve: id => processWithdrawal(id),
    markSent(id, txid) {
      const w = q.getWithdrawal.get(id);
      if (!w || !['pending', 'review', 'processing'].includes(w.status)) return { ok: false, error: 'not_pending' };
      q.setWithdrawal.run('sent', String(txid || '').slice(0, 200), 'manual', id);
      onWalletChange(w.user_id);
      return { ok: true };
    },
    reject(id, note) {
      const w = q.getWithdrawal.get(id);
      if (!w || !['pending', 'review'].includes(w.status)) return { ok: false, error: 'not_pending' };
      db.transaction(() => {
        ledger.apply(w.user_id, w.currency, w.amount, 'withdrawal_refund', 'wd_' + id);
        if (w.fee > 0) ledger.apply(HOUSE_USER_ID, w.currency, -w.fee, 'withdrawal_fee_refund', 'wd_' + id);
        q.setWithdrawal.run('rejected', null, String(note || '').slice(0, 500), id);
      })();
      onWalletChange(w.user_id);
      return { ok: true };
    },
    recheckDeposit(id) {
      const d = q.getDeposit.get(id);
      if (!d || !['expired', 'failed'].includes(d.status)) return { ok: false, error: 'not_recheckable' };
      q.setDeposit.run('pending', 'recheck', id);
      checkDeposit(q.getDeposit.get(id)).catch(() => {});
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

  return {
    enabled, live, mode, currency, walletInfo, faucet, prepareDeposit, submitDeposit, checkDeposit,
    requestWithdrawal, processWithdrawal, admin, blocked, start, stop, getUser, MONEY_SCALE,
  };
}

module.exports = { createPayments };
