'use strict';
// In-game HUD: stats, leaderboard, kill feed, chat, toasts and banners.

const PU_META = {
  speed: { icon: '⚡', color: '#ffc312' }, shield: { icon: '🛡', color: '#00ffcc' }, magnet: { icon: '🧲', color: '#9980FA' },
  freeze: { icon: '❄️', color: '#88ddff' }, clone: { icon: '👥', color: '#fda7df' }, ghost_pu: { icon: '👻', color: '#b2bec3' },
};

const Hud = {
  pings: [],
  lastLb: '',
  frame: 0,

  reset() {
    this.pings = [];
    $('kf').innerHTML = '';
    $('chat-msgs').innerHTML = '';
    $('lbRows').innerHTML = '';
    this.lastLb = '';
    $('pub').classList.add('h');
    $('zw').classList.remove('show');
    $('freeze-overlay').classList.remove('show');
    $('phase-banner').classList.remove('show');
    $('round-timer').classList.remove('show');
  },

  onFrame() {
    if (++this.frame % 10 === 0) this.updateLeaderboard();
  },

  // Called for each state packet (~25/s).
  onState(pkt) {
    const me = pkt.me;
    Game.me = me;
    Game.alive = !!me.a;
    Game.waiting = !!me.w;
    Game.phase = pkt.ph;
    const mine = pkt.sn.find(s => s.i === Game.myId);
    if (mine) Game.lastPos = { x: mine.g[0], y: mine.g[1] };

    $('sv').textContent = me.s;
    const lvl = me.l || 1;
    $('lvl-badge').textContent = 'LVL ' + lvl;
    const cur = SH.LEVEL_XP[lvl - 1] || 0, next = SH.LEVEL_XP[lvl] || SH.LEVEL_XP[SH.LEVEL_XP.length - 1];
    $('lvl-fill').style.width = (lvl >= 10 ? 100 : Math.min(100, ((me.x - cur) / (next - cur)) * 100)) + '%';

    if (me.pu) this.showPowerup(me.pu, me.pp); else $('pub').classList.add('h');
    $('freeze-overlay').classList.toggle('show', !!(mine && hasFlag(mine, SH.FLAGS.FROZEN)));

    const z = pkt.z;
    if (z && mine) {
      const d = Math.hypot(mine.g[0] - z[0], mine.g[1] - z[1]);
      $('zw').classList.toggle('show', d > z[2] - 150);
    } else $('zw').classList.remove('show');

    if (pkt.sw) {
      $('sbf').style.width = Math.min(100, (me.s / pkt.sw) * 100) + '%';
      $('sbl').textContent = `${me.s}/${pkt.sw}`;
    }
    if (pkt.ts) { $('tRed').textContent = `🔴 ${pkt.ts.red || 0}`; $('tBlue').textContent = `🔵 ${pkt.ts.blue || 0}`; }

    if (Game.arena) {
      $('arena-value').textContent = fmtMoney(me.v || 0, Game.arenaCurrency);
      const ph = pkt.ph || {};
      $('arena-sub').textContent = t('arena.hudSub', { alive: ph.a || 0, time: ph.t != null ? fmtTime(ph.t) : '—' });
      $('cashout-ring').style.setProperty('--p', Math.round((me.co || 0) * 100) + '%');
      $('cashout-btn').classList.toggle('show', !!me.a && ph.p === 'playing');
    }
    this.updatePhase(pkt.ph);
  },

  updatePhase(ph) {
    const banner = $('phase-banner');
    const timer = $('round-timer');
    if (!ph || !ph.p) return;
    let text = '';
    if (ph.p === 'waiting') text = t('phase.waiting', { n: ph.h || 0, m: ph.m || 1 });
    else if (ph.p === 'countdown') text = t('phase.countdown', { s: ph.s });
    else if (ph.p === 'playing' && Game.waiting) text = t('phase.nextRound');
    banner.textContent = text;
    banner.classList.toggle('show', !!text);
    if (ph.p === 'playing' && ph.t != null && !Game.arena) {
      timer.textContent = `⏱ ${fmtTime(ph.t)} · ${t('phase.alive', { n: ph.a || 0 })}`;
      timer.classList.add('show');
    } else timer.classList.remove('show');
  },

  showPowerup(type, progress) {
    const meta = PU_META[type] || { icon: '?', color: '#fff' };
    $('pui').textContent = meta.icon;
    $('pul').textContent = t('pu.' + type);
    const f = $('puf');
    f.style.background = meta.color;
    f.style.width = (100 - (progress || 0) * 100) + '%';
    $('pub').classList.remove('h');
  },

  updateLeaderboard() {
    const lb = Net.mm.lb || [];
    const html = lb.map((r, i) => {
      const mine = r.i === Game.myId;
      const score = r.v != null ? fmtMoney(r.v, Game.arenaCurrency).replace(' DEMO', '') : r.s;
      return `<div class="lbr ${mine ? 'lbme' : ''} ${r.b ? 'lbbot' : ''}" style="${r.a ? '' : 'opacity:.45'}"><span class="lbrk">${i + 1}</span><span class="lbd" style="background:${escHtml(r.c)}"></span><span class="lbn">${r.b ? '🤖 ' : ''}${escHtml(r.n)}</span><span class="lbs">${score}</span></div>`;
    }).join('');
    if (html !== this.lastLb) { $('lbRows').innerHTML = html; this.lastLb = html; }
  },

  addKill(k) {
    const el = $('kf');
    const row = document.createElement('div');
    row.className = 'kfr';
    row.style.borderLeftColor = k.c || '#fff';
    const me = Net.info.get(Game.myId);
    const myName = me ? me.n : '';
    const name = (n, cls) => (n === myName ? `<span style="color:var(--${cls})">${escHtml(n)}</span>` : escHtml(n));
    const amt = k.a ? ` <span style="color:var(--gold)">${escHtml(fmtMoney(k.a, Game.arenaCurrency))}</span>` : '';
    row.innerHTML = k.k ? `${name(k.k, 'acc')} <span style="color:var(--dim)">↗</span> ${name(k.v, 'a2')}${amt}` : `💥 ${name(k.v, 'a2')}${amt}`;
    el.prepend(row);
    while (el.children.length > 6) el.lastChild.remove();
    setTimeout(() => { row.style.opacity = '0'; }, 4400);
    setTimeout(() => row.remove(), 5000);
    this.pings.push({ x: k.x, y: k.y, t: Date.now(), c: k.c });
    if (this.pings.length > 10) this.pings.shift();
  },

  addChat(m) {
    const el = $('chat-msgs');
    const div = document.createElement('div');
    div.className = 'cmsg';
    div.innerHTML = `<span class="cn" style="color:${escHtml(m.c || 'var(--acc)')}">${escHtml(m.n)}:</span> ${escHtml(m.m)}`;
    el.prepend(div);
    while (el.children.length > 6) el.lastChild.remove();
    setTimeout(() => div.remove(), 9000);
  },

  toast(id, ms) {
    const el = $(id);
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  },

  levelUp(level, ability) {
    const ab = SH.LEVEL_ABILITIES[level];
    $('lutoast').textContent = t('hud.levelUp', { n: level }) + (ab ? ' → ' + ab.icon + ' ' + t('ab.' + ab.id) : '');
    this.toast('lutoast', 2600);
  },

  floatGain(amount, from) {
    const el = document.createElement('div');
    el.className = 'float-gain';
    el.textContent = '+' + fmtMoney(amount, Game.arenaCurrency) + (from ? ' · ' + from : '');
    $('hud').appendChild(el);
    setTimeout(() => el.remove(), 1500);
  },

  eventBanner(type) {
    const meta = { meteor: '#ff7675', blizzard: '#88ddff', eruption: '#ff6600', surge: '#ffc312' };
    const bn = $('event-banner');
    $('event-overlay').classList.add('show');
    bn.style.borderColor = meta[type] || '#fff';
    bn.style.color = meta[type] || '#fff';
    bn.textContent = t('ev.' + type);
    bn.classList.add('show');
    setTimeout(() => bn.classList.remove('show'), 3000);
  },
};

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

socket.on('kill', k => Hud.addKill(k));
socket.on('chat', m => Hud.addChat(m));
socket.on('powerup', type => Hud.showPowerup(type, 0));
socket.on('levelUp', ({ level, ability }) => Hud.levelUp(level, ability));
socket.on('sfx', type => { playSfx(type); if (type === 'kill') vibrate(40); });
socket.on('valueGain', ({ a, from }) => { Hud.floatGain(a, from); SFX.coin(); vibrate(30); });
socket.on('mapEvent', ({ type }) => {
  if (type === 'end') { setTimeout(() => $('event-overlay').classList.remove('show'), 600); return; }
  Hud.eventBanner(type);
  beep({ freq: 660, vol: 0.18, dur: 0.12 });
  beep({ freq: 440, vol: 0.14, dur: 0.1, delay: 0.14 });
});
socket.on('eloResult', ({ change, elo, rank, place }) => {
  $('elo-val').textContent = elo;
  $('elo-rank').textContent = rank ? rank.name : '';
  $('elo-toast').textContent = t('elo.result', { place, sign: change > 0 ? '+' : '', change, elo, rank: rank ? rank.name : '' });
  Hud.toast('elo-toast', 4000);
  Progress.onElo(elo, rank);
});
