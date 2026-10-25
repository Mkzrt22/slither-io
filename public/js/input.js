'use strict';
// Mouse, keyboard and touch controls. Sends the steering angle to the server.

const Input = {
  mx: window.innerWidth / 2, my: window.innerHeight / 2,
  mode: isTouch ? 'touch' : 'mouse',
  mouseBoost: false, keyBoost: false, touchBoost: false,
  get boost() { return this.mouseBoost || this.keyBoost || this.touchBoost; },
  left: false, right: false,
  angle: 0,
  last: { a: null, b: null, at: 0 },
  cashoutHeld: false,
};

const chatInput = $('chat-input');
const typing = () => document.activeElement === chatInput;

// ── Mouse ────────────────────────────────────────────────────────────────────
window.addEventListener('mousemove', e => { Input.mx = e.clientX; Input.my = e.clientY; if (!isTouch) Input.mode = 'mouse'; });
gc.addEventListener('mousedown', e => { if (e.button === 0) Input.mouseBoost = true; });
window.addEventListener('mouseup', () => { Input.mouseBoost = false; });
window.addEventListener('blur', () => { Input.mouseBoost = Input.keyBoost = Input.touchBoost = false; Input.left = Input.right = false; setCashout(false); });

// ── Keyboard ─────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (!Game.inGame) return;
  if (typing()) {
    if (e.key === 'Escape') chatInput.blur();
    return;
  }
  const k = e.key;
  if (k === 'Escape' || k === 'p' || k === 'P') { setPause(!Game.paused); return; }
  if (k === 'Enter') { e.preventDefault(); chatInput.focus(); return; }
  if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'q' || k === 'Q') { Input.left = true; Input.mode = 'keys'; }
  if (k === 'ArrowRight' || k === 'd' || k === 'D') { Input.right = true; Input.mode = 'keys'; }
  if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'z' || k === 'Z') { Input.keyBoost = true; e.preventDefault(); }
  if ((k === 'c' || k === 'C') && Game.arena) setCashout(true);
  const n = parseInt(k, 10);
  if (n >= 1 && n <= 9 && Game.emotes[n - 1]) socket.emit('emote', Game.emotes[n - 1]);
});
window.addEventListener('keyup', e => {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'q' || k === 'Q') Input.left = false;
  if (k === 'ArrowRight' || k === 'd' || k === 'D') Input.right = false;
  if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'z' || k === 'Z') Input.keyBoost = false;
  if (k === 'c' || k === 'C') setCashout(false);
});

// ── Chat ─────────────────────────────────────────────────────────────────────
function sendChat() {
  const msg = chatInput.value.trim();
  if (msg) socket.emit('chat', msg);
  chatInput.value = '';
  chatInput.blur();
}
$('chat-send').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });

// ── Touch ────────────────────────────────────────────────────────────────────
const jz = $('jz'), jk = $('jk'), bbtn = $('bbtn');
const JOY_MAX = 62, JOY_DEAD = 8;
let joyId = null;
function updateJoy(cx, cy) {
  const r = jz.getBoundingClientRect();
  const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
  const dist = Math.hypot(dx, dy);
  if (dist < JOY_DEAD) { resetJoy(); return; }
  const a = Math.atan2(dy, dx), c = Math.min(dist, JOY_MAX);
  jk.style.transform = `translate(calc(-50% + ${Math.cos(a) * c}px), calc(-50% + ${Math.sin(a) * c}px))`;
  jk.classList.add('active');
  Input.angle = a;
  Input.mode = 'touch';
}
function resetJoy() { jk.style.transform = 'translate(-50%,-50%)'; jk.classList.remove('active'); }
jz.addEventListener('touchstart', e => { e.preventDefault(); const t0 = e.changedTouches[0]; joyId = t0.identifier; updateJoy(t0.clientX, t0.clientY); }, { passive: false });
window.addEventListener('touchmove', e => { for (const t0 of e.changedTouches) if (t0.identifier === joyId) updateJoy(t0.clientX, t0.clientY); }, { passive: true });
window.addEventListener('touchend', e => { for (const t0 of e.changedTouches) if (t0.identifier === joyId) { resetJoy(); joyId = null; } }, { passive: true });
bbtn.addEventListener('touchstart', e => { e.preventDefault(); Input.touchBoost = true; bbtn.classList.add('pressing'); }, { passive: false });
bbtn.addEventListener('touchend', () => { Input.touchBoost = false; bbtn.classList.remove('pressing'); });
bbtn.addEventListener('touchcancel', () => { Input.touchBoost = false; bbtn.classList.remove('pressing'); });
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', e => { if (Game.inGame) e.preventDefault(); });

// ── Cash-out (arena) ─────────────────────────────────────────────────────────
function setCashout(on) {
  if (Input.cashoutHeld === on) return;
  Input.cashoutHeld = on;
  if (Game.arena) socket.emit('cashout', { on });
}
const cob = $('cashout-btn');
cob.addEventListener('mousedown', e => { e.stopPropagation(); setCashout(true); });
cob.addEventListener('mouseup', () => setCashout(false));
cob.addEventListener('mouseleave', () => setCashout(false));
cob.addEventListener('touchstart', e => { e.preventDefault(); setCashout(true); }, { passive: false });
cob.addEventListener('touchend', () => setCashout(false));

// ── Spectating ───────────────────────────────────────────────────────────────
gc.addEventListener('click', () => {
  if (!Game.spectating || !lastSample) return;
  const others = lastSample.snakes.filter(s => s.id !== Game.myId && !s.info.cl);
  if (!others.length) return;
  const idx = others.findIndex(s => s.id === Game.spectateId);
  setSpectate(others[(idx + 1) % others.length].id);
});
function setSpectate(id) {
  Game.spectateId = id;
  socket.emit('spectate', id || '');
  const info = id && Net.info.get(id);
  $('spb').textContent = info ? t('hud.spectatingName', { name: info.n }) : t('hud.spectating');
}

// ── Pause menu ───────────────────────────────────────────────────────────────
function setPause(on) {
  Game.paused = on;
  $('pause-overlay').classList.toggle('show', on);
  $('pause-btn').textContent = on ? '▶' : '⏸';
  if (on) { Input.mouseBoost = Input.keyBoost = false; setCashout(false); }
}
$('pause-btn').addEventListener('click', () => setPause(!Game.paused));
$('resumeBtn').addEventListener('click', () => setPause(false));

// ── Send loop ────────────────────────────────────────────────────────────────
let lastLoop = performance.now();
let prevBoost = false;
setInterval(() => {
  const now = performance.now();
  const dt = (now - lastLoop) / 1000; lastLoop = now;
  if (!Game.inGame || !Game.alive || Game.paused || Game.replayCam) return;
  if (Input.mode === 'mouse') Input.angle = Math.atan2(Input.my - window.innerHeight / 2, Input.mx - window.innerWidth / 2);
  else if (Input.mode === 'keys') Input.angle += ((Input.right ? 1 : 0) - (Input.left ? 1 : 0)) * 3.4 * dt;
  const b = Input.boost;
  if (b && !prevBoost) SFX.boost();
  prevBoost = b;
  const L = Input.last;
  if (L.a === null || Math.abs(Input.angle - L.a) > 0.015 || b !== L.b || now - L.at > 250) {
    socket.emit('input', { a: Math.round(Input.angle * 1000) / 1000, b });
    Input.last = { a: Input.angle, b, at: now };
  }
}, 33);

// Tell the server the viewport size so it sends the right area.
let viewTimer = null;
function sendView() { socket.emit('view', { w: window.innerWidth, h: window.innerHeight }); }
window.addEventListener('resize', () => { clearTimeout(viewTimer); viewTimer = setTimeout(sendView, 300); });
