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
    $('dep-amount').min = w.minDeposit / SH.MONEY_SCALE;
    $('dep-limits').textContent = t('wallet.depLimits', { min: fmtMoney(w.minDeposit, w.currency), max: fmtMoney(w.maxDeposit, w.currency) });
    $('wd-network').innerHTML = w.networks.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
    $('wd-btn').disabled = demo;
    $('wd-amount').placeholder = t('wallet.amountMin', { min: fmtMoney(w.minWithdrawal, w.currency) });
    $('wd-list').innerHTML = (w.withdrawals || []).map(x => `<div class="hist-row"><span>${escHtml(fmtMoney(x.amount, w.currency))} · ${escHtml(x.network)}</span><span>${escHtml(t('wd.' + x.status))}</span></div>`).join('');
    $('w-hist').innerHTML = (w.history || []).map(h => `<div class="hist-row"><span>${escHtml(t('led.' + h.kind))}${h.ref ? ' #' + escHtml(h.ref) : ''}</span><span class="${h.delta >= 0 ? 'pos' : 'neg'}">${h.delta >= 0 ? '+' : ''}${escHtml(fmtMoney(h.delta, w.currency))}</span></div>`).join('') || `<div class="small">${escHtml(t('wallet.noHistory'))}</div>`;
    const ex = Progress.user && Progress.user.excludedUntil;
    $('exclude-status').textContent = ex && ex > Date.now() ? t('wallet.excludedUntil', { date: new Date(ex).toLocaleString() }) : '';
  },
};

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
socket.on('depositUrl', ({ url }) => { if (/^https:\/\//.test(url)) location.href = url; });

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
$('dep-btn').addEventListener('click', () => socket.emit('wallet:deposit', { amount: Number($('dep-amount').value) }));
$('wd-btn').addEventListener('click', () => {
  const amount = Number($('wd-amount').value);
  const address = $('wd-address').value.trim();
  if (!amount || !address) { notifyCode('invalid_amount'); return; }
  if (!confirm(t('wallet.confirmWithdraw', { amount: fmtMoney(Math.round(amount * SH.MONEY_SCALE), Arena.currency), network: $('wd-network').value, address }))) return;
  socket.emit('wallet:withdraw', { amount, network: $('wd-network').value, address });
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

const params0 = new URLSearchParams(location.search);
if (params0.get('deposit') === 'ok') { notify(t('wallet.depositPending'), 'gold', 7000); history.replaceState({}, '', '/'); }
else if (params0.get('deposit') === 'cancel') { history.replaceState({}, '', '/'); }
