'use strict';
// Shared client helpers: settings, storage, audio, notices, socket.
const SH = window.SHARED;
const $ = id => document.getElementById(id);
const isTouch = window.matchMedia('(hover:none) and (pointer:coarse)').matches;
const isMobile = () => isTouch;

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
}
function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* ignore */ } }
function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

// ── Settings ─────────────────────────────────────────────────────────────────
const SETTINGS_KEY = 'ns_settings_v1';
const settings = Object.assign({
  lang: (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en',
  volume: 70,
  quality: isTouch ? 'low' : 'high',
  zoom: 'on',
  name: '',
  skin: 'solid',
  map: 'classic',
  guestChosen: false,
}, loadJSON(SETTINGS_KEY, {}));
function saveSettings() { saveJSON(SETTINGS_KEY, settings); }
const hiQ = () => settings.quality === 'high';

// Server-provided public config ("hello").
let serverConfig = { payments: { mode: 'demo', currency: 'DEMO' }, arena: false, accounts: true, adsense: {}, stripe: false };
const fmtMoney = (units, currency) => SH.formatMoney(units, currency || serverConfig.payments.currency);

// ── Audio ────────────────────────────────────────────────────────────────────
let audioCtx = null;
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function beep({ freq = 440, type = 'square', vol = 0.13, dur = 0.08, slide = 0, delay = 0 }) {
  const master = settings.volume / 100;
  if (master <= 0) return;
  try {
    const c = getCtx(), o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = type;
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
    g.gain.setValueAtTime(vol * master, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.01);
  } catch (e) { /* audio unavailable */ }
}
const SFX = {
  eat: () => beep({ freq: 380, vol: 0.05, dur: 0.05, slide: 110 }),
  powerup: () => [440, 550, 660, 880].forEach((f, i) => beep({ freq: f, vol: 0.12, dur: 0.09, delay: i * 0.09 })),
  kill: () => { beep({ freq: 600, type: 'sawtooth', vol: 0.15, dur: 0.05 }); beep({ freq: 250, type: 'sawtooth', vol: 0.1, dur: 0.12, delay: 0.1 }); },
  die: () => { for (let i = 0; i < 5; i++) beep({ freq: 300 - i * 40, type: 'sawtooth', vol: 0.18 - i * 0.03, dur: 0.1, delay: i * 0.07 }); },
  boost: () => beep({ freq: 200, type: 'sawtooth', vol: 0.05, dur: 0.06, slide: 80 }),
  win: () => [523, 659, 784, 1047].forEach((f, i) => beep({ freq: f, vol: 0.16, dur: 0.18, delay: i * 0.2 })),
  levelup: () => [400, 600, 800].forEach((f, i) => beep({ freq: f, vol: 0.13, dur: 0.12, delay: i * 0.1 })),
  portal: () => beep({ freq: 800, type: 'sine', vol: 0.14, dur: 0.15, slide: -300 }),
  freeze: () => beep({ freq: 1200, type: 'sine', vol: 0.12, dur: 0.25, slide: -800 }),
  coin: () => { beep({ freq: 988, type: 'square', vol: 0.12, dur: 0.07 }); beep({ freq: 1319, type: 'square', vol: 0.12, dur: 0.16, delay: 0.07 }); },
  countdown: n => beep({ freq: n === 0 ? 880 : 440, vol: 0.2, dur: n === 0 ? 0.25 : 0.1 }),
};
let eatSfxAt = 0;
function playSfx(type) {
  if (type === 'eat') { const now = performance.now(); if (now - eatSfxAt < 60) return; eatSfxAt = now; }
  if (SFX[type]) SFX[type]();
}
function vibrate(ms) { if (isTouch && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }

// ── Notices ──────────────────────────────────────────────────────────────────
function notify(msg, kind = 'warn', ms = 4200) {
  const box = $('notices');
  const el = document.createElement('div');
  el.className = 'notice ' + kind;
  el.textContent = msg;
  el.addEventListener('click', () => el.remove());
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), ms);
}
function notifyCode(code) {
  const key = 'err.' + code;
  const msg = t(key);
  notify(msg === key ? t('err.generic') + ' (' + code + ')' : msg, code === 'withdrawal_requested' ? 'gold' : 'warn');
}

// ── Modals ───────────────────────────────────────────────────────────────────
function openModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); }
document.addEventListener('click', e => {
  const c = e.target.closest('[data-close]');
  if (c) closeModal(c.dataset.close);
  if (e.target.classList && e.target.classList.contains('modal')) e.target.classList.remove('show');
});

// ── Game session state (shared by render / hud / input / main) ──────────────
const Game = {
  inGame: false,      // a room is joined and the canvas is shown
  myId: null,
  roomId: null, roomName: '', mode: 'classic', mapId: 'classic', team: null,
  arena: false, arenaCurrency: 'DEMO',
  alive: false, waiting: false,
  spectating: false, spectateId: null,
  paused: false,
  replayCam: null,
  lastPos: null,
  emotes: SH.BASE_EMOTES.slice(),
  inviteUrl: null,
  me: null,            // latest "me" block from the server
  phase: null,
};

// ── Socket ───────────────────────────────────────────────────────────────────
const socket = io({ transports: ['websocket', 'polling'] });
