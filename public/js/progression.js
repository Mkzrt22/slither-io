'use strict';
// Accounts, stats, achievements, battle pass, daily challenge, supporter pack.

const AUTH_KEY = 'ns_auth_token_v1';
const STATS_KEY = 'slither_stats_v4';
const BP_KEY = 'ns_bp_v2';
const CHALLENGE_KEY = 'slither_daily_challenge_v1';
const SUPPORTER_KEY = 'slither_supporter_token';

const Progress = {
  user: null,            // { userId, username, stats, achievements, supporter, compliance, excludedUntil, elo }
  achievements: [],      // definitions from the server
  season: SH.getSeason(),
  bp: null,              // { season, xp, premium, unlocks, equipped }
  challenge: null,
  supporter: false,

  get loggedIn() { return !!this.user; },

  // ── Local stats (guests; merged with the server for accounts) ─────────────
  localStats() { return Object.assign({ best: 0, kills: 0, games: 0, level: 1, xp: 0 }, loadJSON(STATS_KEY, {})); },
  saveLocalStats(s) { saveJSON(STATS_KEY, s); },
  bestLevel() {
    const s = this.localStats();
    return Math.max(s.level || 1, this.user && this.user.stats ? this.user.stats.best_level || 1 : 1);
  },
  renderStats() {
    const s = this.localStats();
    const srv = this.user && this.user.stats;
    $('stBest').textContent = Math.max(s.best, srv ? srv.best_score : 0);
    $('stKills').textContent = srv ? srv.total_kills : s.kills;
    $('stGames').textContent = srv ? srv.games : s.games;
    $('stLevel').textContent = this.bestLevel();
    $('stEloBox').style.display = srv ? '' : 'none';
    if (srv) $('stElo').textContent = srv.elo || 1000;
    const showArena = srv && srv.arena_games > 0;
    $('stArenaBox').style.display = showArena ? '' : 'none';
    if (showArena) {
      const p = srv.arena_profit || 0;
      $('stArena').textContent = (p > 0 ? '+' : '') + fmtMoney(p).replace(' DEMO', '');
      $('stArena').style.color = p >= 0 ? 'var(--acc)' : 'var(--a2)';
    }
    this.renderLevels();
  },
  recordLocalLife({ score, kills, level, xp }) {
    const s = this.localStats();
    s.best = Math.max(s.best, score); s.kills += kills; s.games++;
    s.level = Math.max(s.level, level || 1); s.xp = Math.max(s.xp || 0, xp || 0);
    this.saveLocalStats(s);
    this.renderStats();
  },
  renderLevels() {
    const my = this.bestLevel();
    $('levelPanel').innerHTML = Object.entries(SH.LEVEL_ABILITIES).map(([lvl, ab]) => {
      lvl = Number(lvl);
      const done = my >= lvl;
      return `<div class="level-row"><span class="lvl-num">${done ? '✓' : lvl}</span>
        <span class="lvl-ability ${done ? 'lvl-done' : 'lvl-locked'}">${ab.icon} ${escHtml(t('ab.' + ab.id))}<br><span style="font-size:.7rem;color:var(--dim)">${escHtml(t('ab.' + ab.id + '.desc'))}</span></span>
        <span class="lvl-xp">${done ? '✓' : SH.LEVEL_XP[lvl - 1] + ' XP'}</span></div>`;
    }).join('');
  },

  // ── Account badge ─────────────────────────────────────────────────────────
  renderBadge() {
    const u = this.user;
    $('acct-av').textContent = u ? u.username[0].toUpperCase() : '?';
    $('acct-name').textContent = u ? u.username : t('acct.guest');
    const link = u && u.links && (u.links.solana || u.links.evm || u.links.tron);
    $('acct-tagline').textContent = u
      ? (link ? '🔗 ' + shortAddr(link) + ' · ' : '') + t('acct.achCount', { n: (u.achievements || []).length, total: this.achievements.length || 20 })
      : t('acct.click');
    $('auth-logout-btn').style.display = u ? '' : 'none';
    const name = $('nameInput');
    if (u) { name.value = u.username; name.disabled = true; } else { name.disabled = false; if (!name.value) name.value = settings.name || ''; }
  },

  // ── Achievements ──────────────────────────────────────────────────────────
  renderAchievements() {
    const grid = $('achGrid');
    if (!this.achievements.length) return;
    const have = new Set(this.user ? this.user.achievements : []);
    $('ach-count').textContent = `${this.achievements.filter(a => have.has(a.id)).length} / ${this.achievements.length}`;
    grid.innerHTML = this.achievements.map(a => {
      const got = have.has(a.id), hidden = a.secret && !got;
      const name = hidden ? t('ach.secret') : achText(a, 'name');
      const desc = hidden ? t('ach.secretDesc') : achText(a, 'desc');
      return `<div class="ach-item${got ? ' got' : ''}${hidden ? ' secret' : ''}"><div class="ach-icon">${hidden ? '?' : escHtml(a.icon)}</div>
        <div class="ach-name">${escHtml(name)}</div><div class="ach-tip"><strong>${escHtml(hidden ? '???' : name)}</strong><span>${escHtml(desc)}</span></div></div>`;
    }).join('') + (this.user ? '' : `<div class="small" style="grid-column:1/-1;margin-top:4px">${escHtml(t('ach.loginHint'))}</div>`);
  },
  showAchievementToast(a) {
    $('acht-icon').textContent = a.icon || '🏅';
    $('acht-name').textContent = achText(a, 'name');
    $('acht-desc').textContent = achText(a, 'desc');
    Hud.toast('ach-toast', 4000);
    SFX.levelup();
  },

  // ── Battle pass ───────────────────────────────────────────────────────────
  localBp() {
    const d = loadJSON(BP_KEY, null);
    const base = { season: this.season.number, xp: 0, premium: false, unlocks: { titles: [], trails: [], borders: [], emotes: [] }, equipped: { title: null, trail: null, border: null } };
    if (!d) return base;
    if (d.season !== this.season.number) return { ...base, premium: d.premium, unlocks: d.unlocks || base.unlocks, equipped: d.equipped || base.equipped };
    return { ...base, ...d };
  },
  saveLocalBp() { if (!this.user) saveJSON(BP_KEY, this.bp); saveJSON(BP_KEY + '_eq', this.bp.equipped); },
  setBpFromServer(s) {
    const eq = loadJSON(BP_KEY + '_eq', { title: null, trail: null, border: null });
    const before = this.bp ? SH.bpTier(this.bp.xp) : SH.bpTier(s.xp);
    this.bp = { season: s.season, xp: s.xp, premium: !!s.premium, unlocks: s.unlocks || { titles: [], trails: [], borders: [], emotes: [] }, equipped: eq };
    this.afterBpChange(before);
  },
  // Guests: apply XP locally.
  addLocalBpXp(amount) {
    const before = SH.bpTier(this.bp.xp);
    this.bp.xp += amount;
    const after = SH.bpTier(this.bp.xp);
    if (after > before) {
      const un = SH.bpUnlocked(after, this.bp.premium);
      for (const k of Object.keys(un)) for (const v of un[k]) if (!this.bp.unlocks[k].includes(v)) this.bp.unlocks[k].push(v);
    }
    this.saveLocalBp();
    this.afterBpChange(before);
  },
  afterBpChange(beforeTier) {
    const after = SH.bpTier(this.bp.xp);
    if (after > beforeTier && Game.inGame) {
      const gained = [];
      for (let tier = beforeTier + 1; tier <= after; tier++) {
        const [fr, pr] = SH.BP_TIERS[tier - 1];
        gained.push({ r: fr, prem: false });
        if (this.bp.premium) gained.push({ r: pr, prem: true });
      }
      $('bpt-tier').textContent = t('bp.tierUnlocked', { n: after });
      $('bpt-rewards').innerHTML = gained.map(g => `<div class="bpt-r ${g.prem ? 'pr' : 'fr'}">${g.prem ? '⭐ ' : '✦ '}${escHtml(g.r.l)}</div>`).join('');
      Hud.toast('bp-toast', 4000);
    }
    this.renderBp();
  },
  bpEmotes() { return this.bp ? this.bp.unlocks.emotes : []; },
  cosmetics() { return this.bp ? this.bp.equipped : null; },
  renderBp() {
    const bp = this.bp; if (!bp) return;
    const tier = SH.bpTier(bp.xp);
    const tierXp = tier >= SH.BP_TOTAL_TIERS ? SH.BP_XP_PER_TIER : bp.xp - tier * SH.BP_XP_PER_TIER;
    const pct = (tierXp / SH.BP_XP_PER_TIER) * 100;
    const season = t('bp.season', { n: this.season.number });
    $('bp-banner-season').textContent = season.toUpperCase();
    $('bp-season-label').textContent = season.toUpperCase();
    $('bp-banner-tier').textContent = t('bp.tier', { n: tier, total: SH.BP_TOTAL_TIERS });
    $('bp-banner-bar').style.width = pct + '%';
    $('bp-banner-days').textContent = '· ' + t('bp.daysLeft', { n: this.season.daysLeft });
    $('bph-tier').textContent = t('bp.tier', { n: tier, total: SH.BP_TOTAL_TIERS });
    $('bph-fill').style.width = pct + '%';
    if (!$('bp-overlay').classList.contains('show')) return;
    $('bp-tier-txt').textContent = t('bp.tier', { n: tier, total: SH.BP_TOTAL_TIERS });
    $('bp-xp-lbl').textContent = `${tierXp} / ${SH.BP_XP_PER_TIER} XP`;
    $('bp-xp-fill').style.width = pct + '%';
    $('bp-days-txt').textContent = t('bp.daysLeft', { n: this.season.daysLeft });
    const pb = $('bp-prem-btn');
    pb.classList.toggle('active', bp.premium);
    pb.textContent = bp.premium ? t('bp.premiumActive') : t('bp.goPremium');
    $('bp-note').textContent = this.user ? t('bp.noteAccount') : t('bp.noteGuest');
    let html = '';
    for (let i = 0; i < SH.BP_TOTAL_TIERS; i++) {
      const n = i + 1, [fr, pr] = SH.BP_TIERS[i];
      const reached = n <= tier;
      html += `<div class="bp-col" data-tier="${n}">
        <div class="bp-card${reached ? ' unlk' : ''}" title="${escHtml(fr.l)}">${rewardHtml(fr)}</div>
        <div class="bp-tnum${reached ? (n === tier ? ' cur' : ' done') : ''}">${n}</div>
        <div class="bp-card${reached && bp.premium ? ' unlk-p' : (!bp.premium ? ' dim-p' : '')}" title="${escHtml(pr.l)}">${rewardHtml(pr)}</div></div>`;
      if (i < SH.BP_TOTAL_TIERS - 1) html += `<div class="bp-conn${n < tier ? ' done' : ''}"></div>`;
    }
    $('bp-track').innerHTML = html;
    $('bp-track').querySelectorAll('.bp-col').forEach(col => col.addEventListener('click', () => {
      const n = Number(col.dataset.tier);
      const [fr, pr] = SH.BP_TIERS[n - 1];
      if (this.owns(fr)) this.equip(fr);
      if (bp.premium && this.owns(pr)) this.equip(pr);
    }));
    this.renderEquip();
  },
  owns(r) {
    const key = { t: 'titles', r: 'trails', b: 'borders', e: 'emotes' }[r.t];
    return this.bp.unlocks[key].includes(r.v);
  },
  equip(r) {
    const eq = this.bp.equipped;
    if (r.t === 't') eq.title = eq.title === r.v ? null : r.v;
    else if (r.t === 'r') eq.trail = eq.trail === r.v ? null : r.v;
    else if (r.t === 'b') eq.border = eq.border === r.v ? null : r.v;
    else return;
    this.saveLocalBp();
    this.renderEquip();
  },
  renderEquip() {
    const eq = this.bp.equipped;
    const slots = [
      { key: 'title', lbl: t('bp.slotTitle'), val: eq.title || t('bp.none'), icon: '' },
      { key: 'trail', lbl: t('bp.slotTrail'), val: eq.trail ? '' : t('bp.default'), icon: eq.trail ? `<span style="display:inline-block;width:22px;height:5px;border-radius:2px;background:${escHtml(eq.trail)};vertical-align:middle"></span>` : '' },
      { key: 'border', lbl: t('bp.slotRing'), val: eq.border ? '' : t('bp.none'), icon: eq.border ? `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid ${escHtml(eq.border)};vertical-align:middle"></span>` : '' },
    ];
    $('bp-eq-row').innerHTML = slots.map(s => `<div class="bp-eq-slot ${eq[s.key] ? 'on' : ''}" data-key="${s.key}"><div class="esl">${escHtml(s.lbl)}</div><div class="esv">${s.icon}${escHtml(s.val)}</div></div>`).join('')
      + `<div class="small" style="align-self:center">${escHtml(this.user ? t('bp.visibleAll') : t('bp.visibleSelf'))}</div>`;
    $('bp-eq-row').querySelectorAll('.bp-eq-slot').forEach(sl => sl.addEventListener('click', () => { eq[sl.dataset.key] = null; this.saveLocalBp(); this.renderEquip(); }));
  },

  // ── Daily challenge ───────────────────────────────────────────────────────
  challengeStore() { return loadJSON(CHALLENGE_KEY, {}); },
  setChallenge(ch) {
    this.challenge = ch;
    const st = this.challengeStore();
    const done = st.date === ch.date && st.done === true;
    const progress = st.date === ch.date ? st.progress || 0 : 0;
    this.renderChallenge(progress, done);
  },
  renderChallenge(progress, done) {
    const ch = this.challenge; if (!ch) return;
    const label = t('ch.' + ch.id), desc = t('ch.' + ch.id + '.desc');
    $('ch-date').textContent = '📅 ' + ch.date + ' · ' + t('ch.today');
    $('ch-icon').textContent = ch.icon;
    $('ch-title').textContent = label;
    $('ch-desc').textContent = desc + ' · +50 BP';
    const pct = done ? 100 : Math.min(100, Math.round((progress / ch.goal) * 100));
    $('ch-fill').style.width = pct + '%';
    $('ch-progress-lbl').textContent = `${done ? ch.goal : progress} / ${ch.goal} ${ch.unit}`;
    $('ch-done-badge').style.display = done ? 'inline-block' : 'none';
    $('ch-done-badge').textContent = '✓ ' + t('ch.done');
    $('ch-hud-obj').textContent = `${ch.icon} ${desc}`;
    $('ch-hud-val').textContent = `${done ? ch.goal : progress} / ${ch.goal} ${ch.unit}`;
    $('ch-hud-fill').style.width = pct + '%';
  },
  challengeDone() {
    const st = this.challengeStore();
    return !!(this.challenge && st.date === this.challenge.date && st.done);
  },
  onChallengeProgress({ id, value, goal, done }) {
    if (!this.challenge || this.challenge.id !== id) return;
    const st = this.challengeStore();
    if (st.date !== this.challenge.date) { st.date = this.challenge.date; st.done = false; }
    st.progress = Math.max(st.progress || 0, value);
    if (done) st.done = true;
    saveJSON(CHALLENGE_KEY, st);
    this.renderChallenge(value, !!st.done);
    if (done) {
      $('ch-hud').classList.remove('show');
      $('ch-toast-sub').textContent = `${this.challenge.icon} ${t('ch.' + id)} · +50 BP`;
      Hud.toast('ch-toast', 4500);
      [523, 659, 784, 880, 1047].forEach((f, i) => beep({ freq: f, vol: 0.15, dur: 0.15, delay: i * 0.12 }));
    }
  },

  onElo(elo) { if (this.user && this.user.stats) { this.user.stats.elo = elo; this.renderStats(); } },
};

function achText(a, field) {
  const key = 'achd.' + a.id + '.' + field;
  const v = t(key);
  return v === key ? a[field] : v;
}
function rewardHtml(r) {
  if (r.t === 'e') return `<div class="bp-ci">${escHtml(r.v)}</div><div class="bp-cl">${escHtml(r.l)}</div>`;
  if (r.t === 'r') return `<div class="bp-ct" style="background:${escHtml(r.v)}"></div><div class="bp-cl">${escHtml(r.l)}</div>`;
  if (r.t === 'b') return `<div class="bp-cb" style="border-color:${escHtml(r.v)}"></div><div class="bp-cl">${escHtml(r.l)}</div>`;
  return `<div class="bp-ci" style="font-size:.62rem;font-family:Orbitron,monospace">${escHtml(r.v)}</div><div class="bp-cl">${escHtml(r.l)}</div>`;
}

Progress.bp = Progress.localBp();
Progress.bp.equipped = loadJSON(BP_KEY + '_eq', Progress.bp.equipped);

// ── Auth modal ───────────────────────────────────────────────────────────────
let authMode = 'login';
function switchAuthTab(mode) {
  authMode = mode;
  $('tab-login').classList.toggle('on', mode === 'login');
  $('tab-register').classList.toggle('on', mode === 'register');
  $('auth-submit').textContent = mode === 'login' ? t('auth.login') : t('auth.register');
  $('auth-err').textContent = ''; $('auth-ok').textContent = '';
  $('auth-pass').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
}
$('tab-login').addEventListener('click', () => switchAuthTab('login'));
$('tab-register').addEventListener('click', () => switchAuthTab('register'));
$('acct-badge').addEventListener('click', () => { switchAuthTab('login'); openModal('auth-modal'); });
$('auth-submit').addEventListener('click', () => {
  const u = $('auth-user').value.trim(), p = $('auth-pass').value;
  $('auth-err').textContent = '';
  if (!u) { $('auth-err').textContent = t('err.username_invalid'); return; }
  if (!p) { $('auth-err').textContent = t('err.password_short'); return; }
  socket.emit(authMode === 'login' ? 'authLogin' : 'authRegister', { username: u, password: p });
  $('auth-submit').disabled = true;
  $('auth-submit').textContent = '…';
});
['auth-user', 'auth-pass'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('auth-submit').click(); }));
$('auth-guest-btn').addEventListener('click', () => { settings.guestChosen = true; saveSettings(); closeModal('auth-modal'); });
$('rename-btn').addEventListener('click', () => socket.emit('account:rename', $('rename-input').value.trim()));
$('rename-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('rename-btn').click(); });
$('auth-logout-btn').addEventListener('click', () => {
  lsDel(AUTH_KEY);
  socket.emit('logout');
  Progress.user = null;
  Progress.bp = Progress.localBp();
  Progress.renderBadge(); Progress.renderStats(); Progress.renderAchievements(); Progress.renderBp();
  Arena.render();
  closeModal('auth-modal');
});

socket.on('authResult', r => {
  $('auth-submit').disabled = false;
  $('auth-submit').textContent = authMode === 'login' ? t('auth.login') : t('auth.register');
  if (!r.ok) {
    if (r.error === 'session_expired') { lsDel(AUTH_KEY); if (!r.silent) notifyCode(r.error); return; }
    $('auth-err').textContent = t('err.' + r.error);
    return;
  }
  lsSet(AUTH_KEY, r.token);
  Progress.user = { userId: r.userId, username: r.username, stats: r.stats, achievements: r.achievements || [], supporter: r.supporter, compliance: r.compliance, excludedUntil: r.excludedUntil, elo: r.elo, links: r.links || {}, autoName: r.autoName };
  if (r.bp) Progress.setBpFromServer(r.bp);
  if (r.supporter) { Progress.supporter = true; refreshSupporterUI(); }
  // Link a browser-stored supporter purchase to the account.
  const supTok = lsGet(SUPPORTER_KEY);
  if (supTok && !r.supporter) socket.emit('supporter:link', supTok);
  if (r.linked) notify(t('wallet.linked', { wallet: t('fam.' + r.linked) }), 'info');
  if (r.renamed) closeModal('rename-modal');
  if ($('auth-modal').classList.contains('show')) {
    $('auth-ok').textContent = t('auth.welcome', { name: r.username });
    setTimeout(() => closeModal('auth-modal'), 700);
  }
  if (r.walletCreated) setTimeout(() => { $('rename-err').textContent = ''; $('rename-input').value = ''; openModal('rename-modal'); }, 800);
  Progress.renderBadge(); Progress.renderStats(); Progress.renderAchievements();
  Arena.onAuth(r);
});
socket.on('profile', ({ stats, achievements }) => {
  if (!Progress.user) return;
  Progress.user.stats = stats;
  if (achievements) Progress.user.achievements = achievements;
  Progress.renderBadge(); Progress.renderStats(); Progress.renderAchievements();
});
socket.on('achievements', defs => {
  if (!Array.isArray(defs)) return;
  if (Progress.user) for (const a of defs) if (!Progress.user.achievements.includes(a.id)) Progress.user.achievements.push(a.id);
  Progress.renderBadge(); Progress.renderAchievements();
  defs.forEach((a, i) => setTimeout(() => Progress.showAchievementToast(a), i * 4500));
});
socket.on('bpState', s => Progress.setBpFromServer(s));
socket.on('bpXp', ({ amount }) => { if (!Progress.user) Progress.addLocalBpXp(amount); });
socket.on('challengeProgress', p => Progress.onChallengeProgress(p));
socket.on('supporter', () => { Progress.supporter = true; refreshSupporterUI(); });

// ── Battle pass overlay ──────────────────────────────────────────────────────
$('bp-btn').addEventListener('click', () => {
  $('bp-overlay').classList.add('show');
  Progress.renderBp();
  setTimeout(() => { const col = document.querySelector(`.bp-col[data-tier="${Math.max(1, SH.bpTier(Progress.bp.xp))}"]`); if (col) col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }, 80);
});
$('bp-close').addEventListener('click', () => $('bp-overlay').classList.remove('show'));
$('bp-overlay').addEventListener('click', e => { if (e.target === $('bp-overlay')) $('bp-overlay').classList.remove('show'); });
$('bp-prem-btn').addEventListener('click', () => {
  const on = !Progress.bp.premium;
  if (Progress.user) socket.emit('bp:premium', { on });
  else {
    Progress.bp.premium = on;
    if (on) {
      const un = SH.bpUnlocked(SH.bpTier(Progress.bp.xp), true);
      for (const k of Object.keys(un)) for (const v of un[k]) if (!Progress.bp.unlocks[k].includes(v)) Progress.bp.unlocks[k].push(v);
    }
    Progress.saveLocalBp();
    Progress.renderBp();
  }
});

// ── Supporter pack ───────────────────────────────────────────────────────────
function drawSupporterPreview(cvs, skin) {
  const c = cvs.getContext('2d');
  c.clearRect(0, 0, cvs.width, cvs.height);
  for (let i = 0; i < 9; i++) {
    const x = i * (cvs.width / 9) + cvs.width / 18, y = cvs.height / 2 + Math.sin((i / 9) * Math.PI) * 4;
    const color = skin === 'gold' ? `hsl(${42 + i * 4},${88 + i * 2}%,${48 + i * 3}%)` : skin === 'neon' ? (i % 2 === 0 ? '#39ff14' : '#ff00ff') : `hsl(${260 + i * 12},80%,${50 + i * 4}%)`;
    c.beginPath(); c.arc(x, y, Math.min(4, cvs.height / 5), 0, Math.PI * 2);
    c.fillStyle = color; c.shadowColor = color; c.shadowBlur = skin === 'neon' ? 0 : 7; c.fill(); c.shadowBlur = 0;
  }
}
['gold', 'neon', 'galaxy'].forEach(s => drawSupporterPreview($('prev-' + s), s));

function refreshSupporterUI() {
  document.querySelectorAll('.so[data-skin]').forEach(el => {
    const tag = el.querySelector('.sup-tag');
    if (!tag) return;
    el.classList.toggle('supporter-locked', !Progress.supporter);
    tag.textContent = Progress.supporter ? '⭐' : '🔒';
  });
  $('supAlready').style.display = Progress.supporter ? 'block' : 'none';
  $('supBuyBtn').style.display = Progress.supporter ? 'none' : 'block';
  $('sup-lobby-btn').style.display = serverConfig.stripe || Progress.supporter ? '' : 'none';
}
async function checkSupporterUnlock() {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session_id');
  if (sessionId) {
    try {
      const token = lsGet(AUTH_KEY);
      const res = await fetch(`/api/verify-purchase?session_id=${encodeURIComponent(sessionId)}`, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      const data = await res.json();
      if (data.token) {
        lsSet(SUPPORTER_KEY, data.token);
        Progress.supporter = true;
        notify(t('sup.unlocked'), 'gold', 6000);
      }
    } catch (e) { /* ignore */ }
    history.replaceState({}, '', '/');
  }
  if (!Progress.supporter) {
    const stored = lsGet(SUPPORTER_KEY);
    if (stored) {
      try { const data = await (await fetch(`/api/verify-token?token=${encodeURIComponent(stored)}`)).json(); Progress.supporter = !!data.valid; } catch (e) { /* ignore */ }
    }
  }
  refreshSupporterUI();
}
$('supBuyBtn').addEventListener('click', async () => {
  const btn = $('supBuyBtn');
  btn.disabled = true; btn.textContent = '…';
  try {
    const data = await (await fetch('/api/create-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' } })).json();
    if (data.url) { location.href = data.url; return; }
    notifyCode(data.error || 'checkout_failed');
  } catch (e) { notifyCode('network'); }
  btn.disabled = false; btn.textContent = t('sup.buy');
});
$('sup-lobby-btn').addEventListener('click', () => { refreshSupporterUI(); $('supporter-modal').classList.add('show'); });
$('supCloseBtn').addEventListener('click', () => $('supporter-modal').classList.remove('show'));
$('supporter-modal').addEventListener('click', e => { if (e.target === $('supporter-modal')) $('supporter-modal').classList.remove('show'); });
