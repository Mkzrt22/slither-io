'use strict';
// Stake arena lobby panel, wallet and compliance.

const Arena = {
  info: null,       // lobby info from the server (tiers, fee, mode…)
  status: { state: 'idle' },
  wallet: null,
  pendingTier: null,

  get currency() { return (this.info && this.info.currency) || serverConfig.payments.currency; },

  render() {
    const panel = $('arena-panel');
    const info = this.info;
    if (!info || !info.enabled) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    const demo = info.mode === 'demo';
    $('arena-demo-tag').style.display = demo ? '' : 'none';
    $('wallet-bal').textContent = Progress.user ? (this.wallet ? fmtMoney(this.wallet.balance, this.currency) : '…') : t('arena.loginShort');
    const queuedTier = this.status.state === 'queued' ? this.status.tierId : null;
    $('tiers').innerHTML = info.tiers.map(tr => {
      const queued = queuedTier === tr.id;
      const waiting = tr.waiting ? t('arena.waiting', { n: tr.waiting, max: info.max }) : t('arena.nobody');
      const starts = tr.startsIn != null ? ` · ${t('arena.startsIn', { s: tr.startsIn })}` : '';
      const live = tr.live ? ` · ${t('arena.live', { n: tr.live })}` : '';
      const disabled = !!queuedTier && !queued;
      return `<div class="tier${queued ? ' queued' : ''}">
        <div class="tier-fee">${escHtml(fmtMoney(tr.fee, this.currency))}</div>
        <div class="tier-meta">${escHtml(t('arena.startValue'))} <b>${escHtml(fmtMoney(tr.value, this.currency))}</b></div>
        <div class="tier-meta">${escHtml(waiting + starts + live)}</div>
        <button class="btn-gold" data-tier="${tr.id}" ${disabled ? 'disabled' : ''}>${escHtml(queued ? t('arena.inQueue') : t('arena.join'))}</button></div>`;
    }).join('');
    $('tiers').querySelectorAll('button[data-tier]').forEach(b => b.addEventListener('click', () => this.join(b.dataset.tier)));
    $('arena-rules').innerHTML = t('arena.rules', {
      fee: (info.houseFeeBps / 100).toFixed(info.houseFeeBps % 100 ? 1 : 0),
      min: info.min, max: info.max, time: Math.round(info.matchSeconds / 60),
    }) + (demo ? ' ' + t('arena.demoNote') : '');
    const qb = $('queue-bar');
    if (this.status.state === 'queued') {
      const s = this.status;
      $('queue-text').innerHTML = `<span class="spinner"></span>` + escHtml(t('arena.queueText', { fee: fmtMoney(s.fee, this.currency), n: s.players, min: s.min, max: s.max }))
        + (s.startsIn != null ? ' · <b>' + escHtml(t('arena.startsIn', { s: s.startsIn })) + '</b>' : '');
      qb.classList.add('show');
    } else qb.classList.remove('show');
  },

  join(tierId) {
    if (!Progress.user) { notify(t('err.login_required')); openModal('auth-modal'); switchAuthTab('register'); return; }
    const c = Progress.user.compliance || {};
    if (!c.age || !c.terms) { this.pendingTier = tierId; $('comp-age').checked = false; $('comp-terms').checked = false; $('comp-btn').disabled = true; openModal('compliance-modal'); return; }
    socket.emit('arena:queue', { tierId, profile: Lobby.profile() });
  },

  onAuth(r) {
    this.wallet = r.wallet || null;
    this.render();
  },

  renderWallet() {
    const w = this.wallet;
    if (!w) return;
    const demo = w.mode === 'demo';
    $('wallet-big').textContent = fmtMoney(w.balance, w.currency);
    $('w-demo').style.display = demo ? '' : 'none';
    $('w-crypto').style.display = demo ? 'none' : '';
    const fb = $('faucet-btn');
    if (w.faucet) {
      const ready = w.faucet.availableIn <= 0;
      fb.disabled = !ready;
      fb.textContent = ready ? t('wallet.faucet', { amount: fmtMoney(w.faucet.amount, w.currency) }) : t('wallet.faucetWait', { h: Math.ceil(w.faucet.availableIn / 3600) });
    }
    // Linked wallets.
    const links = w.links || {};
    $('w-links').innerHTML = demo ? '' : ['solana', 'evm', 'tron'].map(f => links[f]
      ? `<span class="w-link on">${Wallets.icons[f]} ${escHtml(t('fam.' + f))} · ${escHtml(shortAddr(links[f]))}</span>`
      : `<span class="w-link">${Wallets.icons[f]} ${escHtml(t('fam.' + f))} · <button data-link="${f}">${escHtml(t('wallet.connect'))}</button></span>`).join('');
    $('w-links').querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => walletLogin(b.dataset.link)));
    // Asset pickers.
    const options = (w.assets || []).map(a => `<option value="${escHtml(a.id)}">${escHtml(a.symbol)} · ${escHtml(a.chainName)}</option>`).join('');
    for (const id of ['dep-asset', 'wd-asset']) {
      const sel = $(id), prev = sel.value;
      if (sel.innerHTML !== options) sel.innerHTML = options;
      if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    }
    $('dep-amount').min = w.minDeposit / SH.MONEY_SCALE;
    $('wd-amount').placeholder = t('wallet.amountMin', { min: fmtMoney(w.minWithdrawal, w.currency) });
    $('wd-text').textContent = demo ? t('err.demo_no_withdraw') : t('wallet.withdrawText', { max: fmtMoney(w.autoMax, w.currency) });
    $('wd-btn').disabled = demo;
    this.updateEstimates();
    const statusRow = (label, amount, status, url, cls) => `<div class="hist-row"><span>${label}</span><span>${amount} · ${url ? `<a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(status)} ↗</a>` : escHtml(status)}</span></div>`;
    $('dep-list').innerHTML = (w.deposits || []).map(d => statusRow(escHtml(this.assetLabel(d.asset)), d.amount ? escHtml(fmtMoney(d.amount, w.currency)) : '…', t('dep.' + d.status), d.url)).join('');
    $('wd-list').innerHTML = (w.withdrawals || []).map(x => statusRow(escHtml(this.assetLabel(x.asset)) + ' → ' + escHtml(shortAddr(x.address)), escHtml(fmtMoney(x.amount, w.currency)), t('wd.' + x.status), x.url)).join('');
    $('w-hist').innerHTML = (w.history || []).map(h => `<div class="hist-row"><span>${escHtml(t('led.' + h.kind))}${h.ref ? ' #' + escHtml(h.ref) : ''}</span><span class="${h.delta >= 0 ? 'pos' : 'neg'}">${h.delta >= 0 ? '+' : ''}${escHtml(fmtMoney(h.delta, w.currency))}</span></div>`).join('') || `<div class="small">${escHtml(t('wallet.noHistory'))}</div>`;
    const ex = Progress.user && Progress.user.excludedUntil;
    $('exclude-status').textContent = ex && ex > Date.now() ? t('wallet.excludedUntil', { date: new Date(ex).toLocaleString() }) : '';
    resubmitPendingDeposits();
  },

  asset(id) { return ((this.wallet && this.wallet.assets) || []).find(a => a.id === id) || null; },
  assetLabel(id) { const a = this.asset(id); return a ? `${a.symbol} · ${a.chainName}` : String(id || ''); },

  // Token amount for a USD amount at the current price (display only, the server decides).
  tokens(a, usd, side) {
    if (!a || !a.priceMicros || !(usd > 0)) return '';
    const spread = a.stable ? 0 : (this.wallet.spreadBps || 0) / 10000;
    const price = (a.priceMicros / SH.MONEY_SCALE) * (side === 'out' ? 1 + spread : 1);
    const n = usd / price;
    return (n >= 1 ? n.toFixed(4) : n.toPrecision(4)).replace(/\.?0+$/, '') + ' ' + a.symbol;
  },
  updateEstimates() {
    const w = this.wallet;
    if (!w || w.mode === 'demo') return;
    const da = this.asset($('dep-asset').value);
    const dep = Number($('dep-amount').value);
    const linkedDep = da && (w.links || {})[da.family];
    $('dep-est').textContent = da ? t('wallet.depEst', { tokens: this.tokens(da, dep, 'in') || '…', min: fmtMoney(w.minDeposit, w.currency), max: fmtMoney(w.maxDeposit, w.currency) }) : t('wallet.noAssets');
    $('dep-btn').textContent = da ? (linkedDep ? t('wallet.depositWith', { wallet: Wallets.names[da.family] }) : t('wallet.connectFirst', { wallet: Wallets.names[da.family] })) : '—';
    $('dep-btn').disabled = !da;
    const wa = this.asset($('wd-asset').value);
    const amt = Number($('wd-amount').value);
    const dest = wa && (w.links || {})[wa.family];
    const fee = wa ? (w.fees || {})[wa.chain] || 0 : 0;
    $('wd-dest').innerHTML = wa ? (dest ? t('wallet.dest', { addr: escHtml(dest) }) : escHtml(t('wallet.connectFirst', { wallet: Wallets.names[wa.family] }))) : '';
    $('wd-est').textContent = wa ? t('wallet.wdEst', { fee: fmtMoney(fee, w.currency), tokens: amt > fee / SH.MONEY_SCALE ? this.tokens(wa, amt - fee / SH.MONEY_SCALE, 'out') : '—' }) : '';
  },
};

// Deposits sent from the wallet but not yet confirmed by the server survive a page reload.
const PENDING_DEP_KEY = 'ns_pending_deposits';
function resubmitPendingDeposits() {
  const pending = loadJSON(PENDING_DEP_KEY, []);
  if (!pending.length || !Arena.wallet) return;
  const known = new Set((Arena.wallet.deposits || []).map(d => d.tx_hash));
  const left = pending.filter(p => !known.has(p.txHash) && Date.now() - p.at < 6 * 3600000);
  for (const p of left) socket.emit('wallet:depositSubmit', { assetId: p.assetId, txHash: p.txHash });
  saveJSON(PENDING_DEP_KEY, left);
}

let depositing = false;
async function startDeposit() {
  const w = Arena.wallet;
  const a = Arena.asset($('dep-asset').value);
  if (!w || !a || depositing) return;
  const linked = (w.links || {})[a.family];
  if (!linked) { walletLogin(a.family); return; }
  if (!Wallets.available(a.family)) { Wallets.openApp(a.family); return; }
  depositing = true;
  $('dep-status').textContent = t('wallet.preparing');
  try {
    const prepared = waitFor('depositPrepared', 20000);
    socket.emit('wallet:depositPrepare', { assetId: a.id, amount: Number($('dep-amount').value) });
    const prep = await prepared;
    $('dep-status').textContent = t('wallet.confirmInWallet', { amount: prep.display, wallet: Wallets.names[a.family] });
    const txHash = await Wallets.sendDeposit(a.family, linked, prep.build);
    const pending = loadJSON(PENDING_DEP_KEY, []);
    pending.push({ assetId: a.id, txHash, at: Date.now() });
    saveJSON(PENDING_DEP_KEY, pending);
    socket.emit('wallet:depositSubmit', { assetId: a.id, txHash });
    $('dep-status').textContent = t('wallet.waitingConfirm');
  } catch (e) {
    $('dep-status').textContent = '';
    if (e && e.code === 'wallet_mismatch') notify(t('err.wallet_mismatch', { addr: shortAddr(linked) }));
    else if (e && e.message === 'timeout') { /* the server answered with a notice */ }
    else if (e && (e.code === 4001 || /reject|denied|cancel/i.test(e.message || ''))) notify(t('err.wallet_rejected'));
    else notify(t('err.wallet_error') + (e && e.message ? ' (' + e.message.slice(0, 120) + ')' : ''));
  } finally { depositing = false; }
}

// ── Socket events ────────────────────────────────────────────────────────────
socket.on('wallet', w => { Arena.wallet = w; Arena.render(); if ($('wallet-modal').classList.contains('show')) Arena.renderWallet(); });
socket.on('arena:status', st => {
  const prev = Arena.status.state;
  Arena.status = st;
  if (Arena.info && st.state === 'queued') {
    const tier = Arena.info.tiers.find(x => x.id === st.tierId);
    if (tier) { tier.waiting = st.players; tier.startsIn = st.startsIn; }
  }
  Arena.render();
  if (prev !== 'queued' && st.state === 'queued') beep({ freq: 660, vol: 0.12, dur: 0.1 });
  if (st.state === 'queued' && st.startsIn != null && st.startsIn <= 3) SFX.countdown(st.startsIn);
});
socket.on('compliance', c => { if (Progress.user) Progress.user.compliance = c; if (Arena.pendingTier) { const tier = Arena.pendingTier; Arena.pendingTier = null; Arena.join(tier); } });
socket.on('excluded', ({ until }) => { if (Progress.user) Progress.user.excludedUntil = until; Arena.renderWallet(); notify(t('wallet.excludedUntil', { date: new Date(until).toLocaleString() }), 'info'); });
socket.on('walletEvent', ev => {
  if (ev.type === 'deposit_credited') { notify(t('wallet.credited', { amount: fmtMoney(ev.amount, Arena.currency) }), 'gold', 6000); SFX.coin(); $('dep-status').textContent = ''; }
  else if (ev.type === 'deposit_failed') { notify(t('wallet.depositFailed', { reason: t('depr.' + (ev.reason || 'failed')) })); $('dep-status').textContent = ''; }
  else if (ev.type === 'withdrawal_sent') notify(t('wallet.sent', { amount: fmtMoney(ev.amount, Arena.currency) }), 'gold', 6000);
});

// ── Wallet modal ─────────────────────────────────────────────────────────────
$('wallet-btn').addEventListener('click', () => {
  if (!Progress.user) { openModal('auth-modal'); return; }
  socket.emit('wallet:get');
  Arena.renderWallet();
  openModal('wallet-modal');
});
document.querySelectorAll('#wallet-modal .tab').forEach(tb => tb.addEventListener('click', () => {
  document.querySelectorAll('#wallet-modal .tab').forEach(x => x.classList.toggle('on', x === tb));
  document.querySelectorAll('#wallet-modal .tabpane').forEach(p => p.classList.toggle('on', p.id === tb.dataset.tab));
}));
$('faucet-btn').addEventListener('click', () => socket.emit('wallet:faucet'));
$('dep-btn').addEventListener('click', startDeposit);
['dep-asset', 'dep-amount', 'wd-asset', 'wd-amount'].forEach(id => $(id).addEventListener('input', () => Arena.updateEstimates()));
$('wd-btn').addEventListener('click', () => {
  const w = Arena.wallet, a = Arena.asset($('wd-asset').value);
  const amount = Number($('wd-amount').value);
  if (!w || !a || !(amount > 0)) { notifyCode('invalid_amount'); return; }
  const dest = (w.links || {})[a.family];
  if (!dest) { walletLogin(a.family); return; }
  if (!confirm(t('wallet.confirmWithdraw', { amount: fmtMoney(Math.round(amount * SH.MONEY_SCALE), w.currency), asset: Arena.assetLabel(a.id), address: dest }))) return;
  socket.emit('wallet:withdraw', { assetId: a.id, amount });
});
document.querySelectorAll('#exclude-seg button').forEach(b => b.addEventListener('click', () => {
  if (confirm(t('wallet.confirmExclude', { label: b.textContent }))) socket.emit('account:exclude', { days: Number(b.dataset.days) });
}));
$('queue-leave').addEventListener('click', () => socket.emit('arena:leave'));

// ── Compliance modal ─────────────────────────────────────────────────────────
function updateCompBtn() { $('comp-btn').disabled = !($('comp-age').checked && $('comp-terms').checked); }
$('comp-age').addEventListener('change', updateCompBtn);
$('comp-terms').addEventListener('change', updateCompBtn);
$('comp-btn').addEventListener('click', () => { socket.emit('account:compliance', { age: true, terms: true }); closeModal('compliance-modal'); });

