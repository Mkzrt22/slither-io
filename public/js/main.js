'use strict';
// Game lifecycle: connection, joining, death, rounds, arena results, settings.

let firstHello = true;
let wasConnected = false;

function show(id, on) { $(id).classList.toggle('hidden', !on); }

// ── Connection ───────────────────────────────────────────────────────────────
socket.on('connect', () => {
  $('reconnect').classList.remove('show');
  const token = lsGet(AUTH_KEY);
  if (token) socket.emit('authLogin', { token });
  if (wasConnected && Game.inGame && !Game.arena) { exitToLobby(); notify(t('net.lostRoom'), 'info'); }
  wasConnected = true;
  Lobby.refresh();
});
socket.on('disconnect', () => { $('reconnect').classList.add('show'); });

socket.on('hello', h => {
  serverConfig = h;
  if (h.achievements) { Progress.achievements = h.achievements; Progress.renderAchievements(); Progress.renderBadge(); }
  if (h.challenge) Progress.setChallenge(h.challenge);
  if (h.season) { Progress.season = h.season; if (!Progress.user) { Progress.bp = Progress.localBp(); Progress.bp.equipped = loadJSON(BP_KEY + '_eq', Progress.bp.equipped); } Progress.renderBp(); }
  refreshSupporterUI();
  setupAds();
  if (h.plausible && !document.querySelector('script[data-domain]')) {
    const s = document.createElement('script');
    s.defer = true; s.dataset.domain = h.plausible; s.src = 'https://plausible.io/js/script.js';
    document.head.appendChild(s);
  }
  if (!firstHello) return;
  firstHello = false;
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) {
    history.replaceState({}, '', '/');
    setTimeout(() => Lobby.join(roomParam), lsGet(AUTH_KEY) ? 700 : 100);
  } else if (h.accounts && !lsGet(AUTH_KEY) && !settings.guestChosen) {
    openModal('auth-modal');
  }
});

socket.on('notice', ({ code }) => {
  notifyCode(code);
  if (code === 'insufficient_funds' && Progress.user) { socket.emit('wallet:get'); Arena.renderWallet(); openModal('wallet-modal'); }
  if (code === 'login_required' && !Progress.user) { switchAuthTab('register'); openModal('auth-modal'); }
});

// ── Entering / leaving a room ────────────────────────────────────────────────
socket.on('joined', info => {
  closeModal('auth-modal');
  Game.inGame = true;
  Game.myId = info.pid;
  Game.roomId = info.roomId;
  Game.roomName = info.roomName;
  Game.mode = info.mode;
  Game.mapId = info.mapId;
  Game.team = info.team;
  Game.arena = info.mode === 'arena';
  Game.arenaCurrency = info.arena ? info.arena.currency : serverConfig.payments.currency;
  Game.emotes = info.emotes || SH.BASE_EMOTES;
  Game.inviteUrl = info.inviteUrl;
  Game.spectating = false; Game.spectateId = null; Game.paused = false; Game.replayCam = null;
  Game.alive = false; Game.lastPos = null;
  resetNet(info.W, info.H, info.portals);
  Hud.reset();
  camera.x = info.W / 2; camera.y = info.H / 2;
  ambientMap = '';
  deathParticles = [];
  trails.clear();

  show('ls', false); show('ds', false); show('go', false);
  gc.style.display = 'block';
  $('hud').classList.add('visible');
  $('mc').classList.toggle('visible', isTouch);
  setPause(false);
  $('rnt').textContent = `${info.roomName} · ${t('mode.' + info.mode)} · ${t('map.' + info.mapId)}`;
  $('sd').style.display = info.mode === 'teams' ? 'none' : '';
  $('thud').classList.toggle('visible', info.mode === 'teams');
  $('sb').classList.toggle('v', info.mode === 'score');
  $('elo-hud').classList.toggle('show', info.mode === 'ranked');
  if (info.elo) { $('elo-val').textContent = info.elo.elo; $('elo-rank').textContent = info.elo.rank.name; }
  $('invite-btn').classList.toggle('show', !!info.inviteUrl);
  $('arena-hud').classList.toggle('show', Game.arena);
  $('cashout-btn').classList.remove('show');
  $('cashout-key').textContent = isTouch ? t('arena.hold') : t('arena.holdC');
  $('lvlbar').style.display = Game.arena ? 'none' : '';
  $('ch-hud').classList.toggle('show', !Game.arena && !!Progress.challenge && !Progress.challengeDone());
  $('bp-hud').classList.toggle('show', !Game.arena);
  $('spb').classList.remove('show');
  buildEmoteBar();
  sendView();
  if (info.reconnected) notify(t('net.reconnectedArena'), 'info');
  showHint(info.mode);
});

// Short controls reminder for the first games.
function showHint(mode) {
  const seen = settings.hints || 0;
  const key = mode === 'arena' ? 'hint.arena' : seen < 3 ? (isTouch ? 'hint.touch' : 'hint.mouse') : null;
  if (!key) return;
  settings.hints = seen + 1; saveSettings();
  const el = $('hint');
  el.innerHTML = t(key);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 7000);
}

function buildEmoteBar() {
  const el = $('emotes');
  el.innerHTML = Game.emotes.slice(0, 9).map((e, i) => `<button class="emote-btn" data-e="${escHtml(e)}">${escHtml(e)}${isTouch ? '' : `<span class="ek">${i + 1}</span>`}</button>`).join('');
  el.querySelectorAll('.emote-btn').forEach(b => b.addEventListener('click', () => socket.emit('emote', b.dataset.e)));
}

function exitToLobby() {
  Game.inGame = false;
  Game.arena = false;
  Game.replayCam = null;
  setPause(false);
  show('ds', false); show('go', false); show('ls', true);
  gc.style.display = 'none';
  $('hud').classList.remove('visible');
  $('mc').classList.remove('visible');
  Progress.renderStats();
  buildMapGrid();
  Lobby.refresh();
}
function leaveGame() {
  if (Game.arena && Game.alive) { notifyCode('arena_cashout_first'); return; }
  socket.emit('leaveRoom');
  exitToLobby();
}
$('leaveBtn').addEventListener('click', leaveGame);
$('deathLobbyBtn').addEventListener('click', leaveGame);
$('newGameBtn').addEventListener('click', leaveGame);

$('invite-btn').addEventListener('click', () => {
  const url = Game.inviteUrl || location.href;
  const done = () => { const b = $('invite-btn'); b.textContent = '✓ ' + t('hud.copied'); setTimeout(() => { b.innerHTML = '🔗 ' + escHtml(t('hud.invite')); }, 2000); };
  if (navigator.share && isTouch) navigator.share({ title: 'NeonSlither', url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done).catch(() => prompt(t('hud.copyLink'), url));
  else prompt(t('hud.copyLink'), url);
});
$('sndbtn').addEventListener('click', () => {
  settings.volume = settings.volume > 0 ? 0 : 70; saveSettings();
  $('sndbtn').textContent = settings.volume > 0 ? '🔊' : '🔇';
  $('sndbtn').classList.toggle('on', settings.volume > 0);
});

// ── State packets ────────────────────────────────────────────────────────────
socket.on('s', pkt => {
  if (!Game.inGame) return;
  onStatePacket(pkt);
  Hud.onState(pkt);
  const ph = pkt.ph;
  const cd = $('cdnum');
  if (ph && ph.p === 'countdown' && ph.s > 0) {
    if (cd.textContent !== String(ph.s)) { cd.textContent = ph.s; SFX.countdown(ph.s); }
    cd.style.opacity = 1; cd.style.color = '#fff';
  } else if (cd.style.opacity === '1') {
    cd.textContent = 'GO!'; cd.style.color = '#00ffcc'; SFX.countdown(0);
    setTimeout(() => { cd.style.opacity = 0; }, 500);
    cd.style.opacity = 0.99;
  }
});

// ── Death ────────────────────────────────────────────────────────────────────
socket.on('died', d => {
  Game.alive = false;
  setPause(false);
  SFX.die(); vibrate(180); shake = 14;
  const info = Net.info.get(Game.myId);
  if (Game.lastPos) spawnDeathExplosion(Game.lastPos.x, Game.lastPos.y, info ? info.c : '#ff3d71');
  Progress.recordLocalLife(d);
  let html = `${escHtml(t('death.score'))}: <strong>${d.score}</strong> &nbsp;·&nbsp; ${escHtml(t('death.kills'))}: <strong>${d.kills}</strong>`;
  if (!Game.arena) html += `<br>${escHtml(t('death.level'))}: <strong>${d.level || 1}</strong>`;
  if (d.killer) html += `<br>${escHtml(t('death.by', { name: d.killer }))}`;
  else if (d.reason) html += `<br>${escHtml(t('death.reason.' + d.reason))}`;
  if (Game.arena && d.lost) html += `<br><span style="color:var(--a2)">${escHtml(t('arena.lost', { amount: fmtMoney(d.lost, Game.arenaCurrency) }))}</span>`;
  if (!d.respawn && !Game.arena) html += `<br><span style="color:var(--acc)">${escHtml(t('death.nextRound'))}</span>`;
  $('dstats').innerHTML = html;
  $('respawnBtn').style.display = d.respawn ? '' : 'none';
  const showDeath = () => { Game.replayCam = null; $('replay-overlay').classList.remove('show'); if (!Game.alive) show('ds', true); };
  const replay = d.replay || [];
  if (replay.length > 1) {
    $('replay-overlay').classList.add('show');
    const start = performance.now();
    const step = now => {
      const k = Math.min((now - start) / 2500, 1);
      const pos = replay[Math.max(0, Math.floor((1 - k) * (replay.length - 1)))];
      Game.replayCam = { x: pos.x, y: pos.y };
      if (k < 1 && Game.inGame && !Game.alive) requestAnimationFrame(step); else showDeath();
    };
    requestAnimationFrame(step);
  } else showDeath();
});
$('respawnBtn').addEventListener('click', () => {
  show('ds', false);
  Game.spectating = false; setSpectate(null);
  $('spb').classList.remove('show');
  socket.emit('respawn', { profile: Lobby.profile() });
});
function startSpectating() {
  show('ds', false); show('go', false);
  Game.spectating = true;
  const others = lastSample ? lastSample.snakes.filter(s => s.id !== Game.myId && !s.info.cl) : [];
  setSpectate(others.length ? others[0].id : null);
  $('spb').classList.add('show');
}
$('spectateBtn').addEventListener('click', startSpectating);
$('goSpectateBtn').addEventListener('click', startSpectating);

// ── Rounds ───────────────────────────────────────────────────────────────────
socket.on('roundStart', () => {
  show('ds', false); show('go', false);
  Game.spectating = false; Game.replayCam = null;
  $('spb').classList.remove('show');
});
socket.on('roundEnd', r => {
  if (!Game.inGame) return;
  const w = r.winner;
  $('goT').textContent = t('round.over');
  if (r.teamScores && w && w.team) {
    $('goW').textContent = t('round.teamWins', { team: t('team.' + w.team) });
    $('goW').style.color = w.team === 'red' ? '#FF4757' : '#1E90FF';
  } else {
    $('goW').textContent = w ? t('round.wins', { name: w.name }) : t('round.noWinner');
    $('goW').style.color = w && w.id === Game.myId ? 'var(--gold)' : 'var(--acc)';
  }
  $('goS').textContent = w && w.score ? t('round.score', { n: w.score }) : '';
  $('goTable').innerHTML = '';
  $('goNext').textContent = t('round.nextIn', { s: r.nextIn });
  $('goSpectateBtn').style.display = 'none';
  show('ds', false); show('go', true);
  if (w && w.id === Game.myId) vibrate([60, 40, 60]);
});

// ── Arena results ────────────────────────────────────────────────────────────
socket.on('arena:result', r => {
  const cur = r.currency || Game.arenaCurrency;
  const profit = r.profit;
  $('goT').textContent = r.reason === 'cashout' ? t('arena.cashedOut') : t('arena.matchOver');
  $('goW').textContent = (profit >= 0 ? '+' : '') + fmtMoney(profit, cur);
  $('goW').style.color = profit >= 0 ? 'var(--gold)' : 'var(--a2)';
  $('goS').textContent = t('arena.payout', { payout: fmtMoney(r.payout, cur), fee: fmtMoney(r.fee, cur) });
  $('goTable').innerHTML = (r.ranking || []).map((p, i) => `<tr><td>${i + 1}. ${escHtml(p.name)} <span class="small">${escHtml(t('arena.st.' + p.status))} · ${p.kills} ☠</span></td><td>${escHtml(fmtMoney(p.payout, cur))}</td></tr>`).join('');
  $('goNext').textContent = r.final ? '' : t('arena.cashoutNote');
  $('goSpectateBtn').style.display = r.final ? 'none' : '';
  show('ds', false); show('go', true);
  if (profit > 0) { SFX.win(); vibrate([80, 40, 80]); }
  Game.alive = false;
  if (r.final) Game.arena = false;
});

// ── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
  document.querySelectorAll('#set-lang button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.lang));
  document.querySelectorAll('#set-quality button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.quality));
  document.querySelectorAll('#set-zoom button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.zoom));
  $('set-volume').value = settings.volume;
  $('lang-btn').textContent = settings.lang.toUpperCase();
  $('sndbtn').textContent = settings.volume > 0 ? '🔊' : '🔇';
}
function setLang(lang) {
  settings.lang = lang; saveSettings();
  applyI18n();
  renderSettings();
  buildSkinGrid(); buildMapGrid(); selectMode(Lobby.selectedMode);
  Progress.renderBadge(); Progress.renderStats(); Progress.renderAchievements(); Progress.renderBp();
  if (Progress.challenge) Progress.setChallenge(Progress.challenge);
  Arena.render();
  Lobby.refresh();
}
$('settings-btn').addEventListener('click', () => { renderSettings(); openModal('settings-modal'); });
$('settingsInGameBtn').addEventListener('click', () => { renderSettings(); openModal('settings-modal'); });
$('lang-btn').addEventListener('click', () => setLang(settings.lang === 'fr' ? 'en' : 'fr'));
document.querySelectorAll('#set-lang button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.v)));
document.querySelectorAll('#set-quality button').forEach(b => b.addEventListener('click', () => { settings.quality = b.dataset.v; saveSettings(); resize(); renderSettings(); }));
document.querySelectorAll('#set-zoom button').forEach(b => b.addEventListener('click', () => { settings.zoom = b.dataset.v; saveSettings(); renderSettings(); }));
$('set-volume').addEventListener('input', e => { settings.volume = Number(e.target.value); saveSettings(); renderSettings(); });

// ── Init ─────────────────────────────────────────────────────────────────────
applyI18n();
renderSettings();
$('nameInput').value = settings.name || '';
buildSkinGrid();
buildEditorColors();
renderSkinEditor();
buildMapGrid();
selectMode('classic');
Progress.renderBadge();
Progress.renderStats();
Progress.renderAchievements();
Progress.renderBp();
checkSupporterUnlock();
