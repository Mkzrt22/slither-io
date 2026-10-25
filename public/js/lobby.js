'use strict';
// Lobby: profile (name, skin, custom skin), maps, modes, rooms, leaderboards.

const Lobby = {
  selectedSkin: SH.SKIN_IDS.includes(settings.skin) ? settings.skin : 'solid',
  selectedMap: SH.MAPS[settings.map] ? settings.map : 'classic',
  selectedMode: 'classic',
  pendingRoom: null,

  name() {
    const v = $('nameInput').value.trim();
    return Progress.user ? Progress.user.username : v || t('acct.guest');
  },
  profile() {
    return {
      name: this.name(),
      skin: this.selectedSkin,
      customSkin: getCustomSkin(),
      cosmetics: Progress.cosmetics(),
      supporterToken: lsGet(SUPPORTER_KEY),
    };
  },
  view() { return { w: window.innerWidth, h: window.innerHeight }; },
  rememberName() { if (!Progress.user) { settings.name = $('nameInput').value.trim(); saveSettings(); } },

  quickPlay() {
    this.rememberName();
    socket.emit('quickPlay', { mapId: this.selectedMap, profile: this.profile(), view: this.view() });
  },
  create() {
    this.rememberName();
    socket.emit('createRoom', {
      roomName: $('roomNameInput').value.trim(), password: $('roomPassInput').value.trim() || undefined,
      mode: this.selectedMode, mapId: this.selectedMap, profile: this.profile(), view: this.view(),
    });
  },
  join(roomId, password) {
    this.rememberName();
    socket.emit('joinRoom', { roomId, password, profile: this.profile(), view: this.view() });
  },
  refresh() { socket.emit('getLobby'); },
};

// ── Skins ────────────────────────────────────────────────────────────────────
function drawSkinPreview(cvs, skin, color) {
  const c = cvs.getContext('2d');
  c.clearRect(0, 0, cvs.width, cvs.height);
  for (let i = 0; i < 8; i++) {
    const x = i * (cvs.width / 8) + cvs.width / 16, y = cvs.height / 2 + Math.sin((i / 8) * Math.PI) * 4;
    let fc = color;
    if (skin === 'striped') fc = i % 2 === 0 ? color : '#ffffff55';
    else if (skin === 'rainbow') fc = `hsl(${(i / 8) * 360},88%,55%)`;
    else if (skin === 'glow') fc = `hsl(${i * 30 + 150},90%,60%)`;
    c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fillStyle = fc;
    if (skin === 'glow') { c.shadowColor = fc; c.shadowBlur = 5; }
    c.fill(); c.shadowBlur = 0;
    if (skin === 'dotted' && i % 2 === 0) { c.beginPath(); c.arc(x, y, 1.2, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,.7)'; c.fill(); }
  }
}
function buildSkinGrid() {
  const g = $('skinGrid');
  g.innerHTML = '';
  for (const s of SH.SKINS) {
    const div = document.createElement('div');
    div.className = 'so' + (s.id === Lobby.selectedSkin ? ' active' : '');
    div.dataset.skin = s.id;
    const cvs = document.createElement('canvas'); cvs.width = 44; cvs.height = 22;
    if (s.supporter) drawSupporterPreview(cvs, s.id); else drawSkinPreview(cvs, s.id, '#00ffcc');
    const lbl = document.createElement('span'); lbl.textContent = t('skin.' + s.id);
    div.append(cvs, lbl);
    if (s.supporter) { const tag = document.createElement('span'); tag.className = 'sup-tag'; div.appendChild(tag); }
    div.addEventListener('click', () => {
      if (s.supporter && !Progress.supporter) { refreshSupporterUI(); $('supporter-modal').classList.add('show'); return; }
      Lobby.selectedSkin = s.id; settings.skin = s.id; saveSettings();
      g.querySelectorAll('.so').forEach(e => e.classList.toggle('active', e === div));
    });
    g.appendChild(div);
  }
  refreshSupporterUI();
}

// ── Custom skin editor ───────────────────────────────────────────────────────
const CELL = 14, COLS = SH.SKIN_COLS, ROWS = SH.SKIN_ROWS;
const skinCvs = $('skinCanvas');
skinCvs.width = COLS * CELL; skinCvs.height = ROWS * CELL;
const skinCtx = skinCvs.getContext('2d');
let skinData = loadJSON('ns_custom_skin', null);
if (!Array.isArray(skinData) || skinData.length !== ROWS) skinData = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
let drawColor = '#00ffcc', eraseMode = false, painting = false;
const EDITOR_COLORS = ['#00ffcc', '#ff3d71', '#ffc312', '#9980fa', '#1e90ff', '#a3cb38', '#ffffff', '#ff9f43', '#12cbc4', '#ed4c67'];
function buildEditorColors() {
  const el = $('editorColors');
  el.innerHTML = '';
  for (const c of EDITOR_COLORS) {
    const d = document.createElement('div');
    d.className = 'ecol' + (c === drawColor && !eraseMode ? ' active' : '');
    d.style.background = c;
    d.addEventListener('click', () => { drawColor = c; eraseMode = false; buildEditorColors(); $('eraseSkinBtn').style.borderColor = ''; });
    el.appendChild(d);
  }
}
function renderSkinEditor() {
  skinCtx.fillStyle = '#0a0d22'; skinCtx.fillRect(0, 0, skinCvs.width, skinCvs.height);
  skinCtx.strokeStyle = 'rgba(255,255,255,.07)'; skinCtx.lineWidth = 0.5;
  for (let c = 0; c <= COLS; c++) { skinCtx.beginPath(); skinCtx.moveTo(c * CELL, 0); skinCtx.lineTo(c * CELL, ROWS * CELL); skinCtx.stroke(); }
  for (let r = 0; r <= ROWS; r++) { skinCtx.beginPath(); skinCtx.moveTo(0, r * CELL); skinCtx.lineTo(COLS * CELL, r * CELL); skinCtx.stroke(); }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (skinData[r][c]) { skinCtx.fillStyle = skinData[r][c]; skinCtx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2); }
}
function editorPaint(e) {
  const rect = skinCvs.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  const c = Math.floor(((p.clientX - rect.left) / rect.width) * COLS), r = Math.floor(((p.clientY - rect.top) / rect.height) * ROWS);
  if (c >= 0 && c < COLS && r >= 0 && r < ROWS) { skinData[r][c] = eraseMode ? null : drawColor; renderSkinEditor(); saveJSON('ns_custom_skin', skinData); }
}
skinCvs.addEventListener('mousedown', e => { painting = true; editorPaint(e); });
skinCvs.addEventListener('mousemove', e => { if (painting) editorPaint(e); });
window.addEventListener('mouseup', () => { painting = false; });
skinCvs.addEventListener('touchstart', e => { e.preventDefault(); painting = true; editorPaint(e); }, { passive: false });
skinCvs.addEventListener('touchmove', e => { e.preventDefault(); if (painting) editorPaint(e); }, { passive: false });
skinCvs.addEventListener('touchend', () => { painting = false; });
$('clearSkinBtn').addEventListener('click', () => { skinData = Array.from({ length: ROWS }, () => Array(COLS).fill(null)); renderSkinEditor(); saveJSON('ns_custom_skin', skinData); });
$('eraseSkinBtn').addEventListener('click', () => { eraseMode = !eraseMode; $('eraseSkinBtn').style.borderColor = eraseMode ? 'var(--acc)' : ''; buildEditorColors(); });
function getCustomSkin() { return skinData.some(r => r.some(Boolean)) ? skinData : null; }

// ── Maps & modes ─────────────────────────────────────────────────────────────
function buildMapGrid() {
  const el = $('mapGrid');
  el.innerHTML = '';
  const best = Progress.bestLevel();
  for (const m of Object.values(SH.MAPS)) {
    const meta = MAP_META[m.id];
    const locked = best < m.unlockLevel;
    if (locked && Lobby.selectedMap === m.id) Lobby.selectedMap = 'classic';
    const div = document.createElement('div');
    div.className = `map-opt map-${m.id}${Lobby.selectedMap === m.id ? ' active' : ''}${locked ? ' locked' : ''}`;
    div.innerHTML = `<div class="mname">${meta.emoji} ${escHtml(t('map.' + m.id))}</div><div class="mdesc">${escHtml(t('map.' + m.id + '.desc'))} · ${m.W}×${m.H}</div>`
      + (locked ? `<span class="mlock">🔒</span><span style="position:absolute;bottom:6px;right:7px;font-size:.6rem;color:${meta.color};font-family:Orbitron,monospace">LVL ${m.unlockLevel}</span>` : '');
    if (!locked) div.addEventListener('click', () => { Lobby.selectedMap = m.id; settings.map = m.id; saveSettings(); buildMapGrid(); });
    el.appendChild(div);
  }
}
function selectMode(mode) {
  Lobby.selectedMode = mode;
  document.querySelectorAll('.mopt').forEach(e => e.classList.toggle('active', e.dataset.mode === mode));
  $('mode-desc').textContent = t('mode.' + mode + '.desc');
}
document.querySelectorAll('.mopt').forEach(el => el.addEventListener('click', () => selectMode(el.dataset.mode)));

// ── Rooms & leaderboards ─────────────────────────────────────────────────────
function renderRooms(rooms) {
  const el = $('roomList');
  if (!rooms.length) { el.innerHTML = `<div class="noroom">${escHtml(t('lobby.noRooms'))}</div>`; return; }
  el.innerHTML = rooms.map(r => `<div class="rrow" data-id="${escHtml(r.id)}" data-locked="${r.locked ? 1 : ''}">
    <span class="rn">${r.locked ? '🔒 ' : ''}${escHtml(r.name)}</span>
    <span class="rm"><span>${r.players}👤</span><span class="mbadge mc2">${escHtml(t('mode.' + r.mode))}</span><span class="mbadge" style="background:rgba(255,255,255,.06);color:var(--dim)">${escHtml(t('map.' + r.mapId))}</span></span></div>`).join('');
  el.querySelectorAll('.rrow').forEach(row => row.addEventListener('click', () => {
    if (row.dataset.locked) askPassword(row.dataset.id, row.querySelector('.rn').textContent);
    else Lobby.join(row.dataset.id);
  }));
}
function scoreRows(list, medals) {
  return list.map((s, i) => `<div class="gsrow"><span class="gsrank">${i + 1}</span><span class="gsname ${medals ? medals[i] || '' : ''}">${escHtml(s.name)}</span><span class="gsscore">${s.score}</span></div>`).join('');
}
function renderLeaderboards(lb) {
  const medals = ['hof-gold', 'hof-silver', 'hof-bronze'];
  $('globalScores').innerHTML = lb.global.length ? scoreRows(lb.global) : `<div class="noroom">${escHtml(t('lobby.noScores'))}</div>`;
  $('weeklyScores').innerHTML = lb.weekly.length ? scoreRows(lb.weekly, medals) : `<div class="noroom">${escHtml(t('lobby.noScoresWeek'))}</div>`;
  $('hallOfFame').innerHTML = lb.hallOfFame && lb.hallOfFame.length
    ? lb.hallOfFame.map(w => `<div class="hof-week">${escHtml(w.week)}</div>` + w.entries.map((s, i) => `<div class="hof-entry"><span class="${medals[i] || ''}">${['🥇', '🥈', '🥉'][i] || ''} ${escHtml(s.name)}</span><span style="color:var(--acc);font-family:Orbitron,monospace;font-size:.68rem">${s.score}</span></div>`).join('')).join('')
    : `<div class="noroom">${escHtml(t('lobby.noRecords'))}</div>`;
}

socket.on('lobby', l => {
  renderRooms(l.rooms);
  renderLeaderboards(l.leaderboards);
  if (l.challenge) Progress.setChallenge(l.challenge);
  if (l.season) { Progress.season = l.season; Progress.renderBp(); }
  Arena.info = l.arena;
  if (l.arenaStatus && Progress.user) Arena.status = l.arenaStatus;
  Arena.render();
  $('online-count').innerHTML = t('lobby.online', { n: `<b>${l.online}</b>` });
});

// ── Password ─────────────────────────────────────────────────────────────────
function askPassword(roomId, roomName, wrong) {
  Lobby.pendingRoom = roomId;
  $('pass-room-name').textContent = roomName || '';
  $('pass-err').textContent = wrong ? t('err.wrong_password') : '';
  $('pass-input').value = '';
  $('pass-modal').classList.add('show');
  setTimeout(() => $('pass-input').focus(), 80);
}
function submitPassword() {
  const pw = $('pass-input').value.trim();
  if (!pw || !Lobby.pendingRoom) return;
  $('pass-modal').classList.remove('show');
  Lobby.join(Lobby.pendingRoom, pw);
}
$('pass-confirm-btn').addEventListener('click', submitPassword);
$('pass-cancel-btn').addEventListener('click', () => { $('pass-modal').classList.remove('show'); Lobby.pendingRoom = null; });
$('pass-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitPassword(); });
socket.on('passwordRequired', ({ roomId, roomName, wrong }) => askPassword(roomId, roomName, wrong));

// ── Buttons ──────────────────────────────────────────────────────────────────
$('playBtn').addEventListener('click', () => Lobby.quickPlay());
$('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') Lobby.quickPlay(); });
$('createBtn').addEventListener('click', () => Lobby.create());
$('refreshBtn').addEventListener('click', () => Lobby.refresh());
setInterval(() => { if (!Game.inGame && document.visibilityState === 'visible') Lobby.refresh(); }, 4000);

// ── Ads (only when slots are configured) ─────────────────────────────────────
let adsLoaded = false;
function setupAds() {
  const a = serverConfig.adsense || {};
  if (adsLoaded || !a.client || (!a.slotLobby && !a.slotDeath)) return;
  adsLoaded = true;
  const s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous';
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(a.client);
  document.head.appendChild(s);
  const slot = (id, slotId, style) => {
    if (!slotId) return;
    $(id).innerHTML = `<ins class="adsbygoogle" style="${style}" data-ad-client="${escHtml(a.client)}" data-ad-slot="${escHtml(slotId)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ignore */ }
  };
  slot('ad-lobby', a.slotLobby, 'display:block;width:100%;min-height:60px');
  slot('ad-death', a.slotDeath, 'display:block;width:320px;height:100px');
}
