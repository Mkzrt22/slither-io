'use strict';
// Canvas rendering. The world is drawn in world coordinates through a camera
// transform (translate + zoom); HUD-like effects are drawn in screen space.

const gc = $('gc');
const ctx = gc.getContext('2d');
const mmc = $('mmc');
const mCtx = mmc.getContext('2d');
let DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, hiQ() ? 2 : 1.25);
  gc.width = Math.round(window.innerWidth * DPR);
  gc.height = Math.round(window.innerHeight * DPR);
  gc.style.width = window.innerWidth + 'px';
  gc.style.height = window.innerHeight + 'px';
}
resize();
window.addEventListener('resize', resize);

const PU_TYPES = SH.POWERUP_TYPES;
const PU_COLORS = { speed: '#ffc312', shield: '#00ffcc', magnet: '#9980FA', freeze: '#88ddff', clone: '#fda7df', ghost_pu: '#b2bec3' };
const PU_ICONS = { speed: '⚡', shield: '🛡', magnet: '🧲', freeze: '❄️', clone: '👥', ghost_pu: '👻' };
const F = SH.FLAGS;

const MAP_META = {
  classic: { emoji: '⚡', color: '#00f5d4', bg: '#02040e', bgGlow: 'rgba(0,20,40,.7)', grid: 'rgba(0,245,212,.07)', grid2: 'rgba(0,200,180,.025)', borderColor: '#00f5d4', borderGlow: 'rgba(0,245,212,.7)', ambient: 'cyber', fog: null },
  arctic: { emoji: '❄️', color: '#7dd8ff', bg: '#010a14', bgGlow: 'rgba(5,25,55,.8)', grid: 'rgba(100,220,255,.065)', grid2: 'rgba(60,160,220,.025)', borderColor: '#7dd8ff', borderGlow: 'rgba(125,216,255,.65)', ambient: 'snow', fog: 'rgba(180,230,255,.014)' },
  volcano: { emoji: '🌋', color: '#ff5500', bg: '#0a0100', bgGlow: 'rgba(40,5,0,.8)', grid: 'rgba(255,70,0,.06)', grid2: 'rgba(200,30,0,.025)', borderColor: '#ff4400', borderGlow: 'rgba(255,90,0,.8)', ambient: 'embers', fog: 'rgba(60,3,0,.035)' },
  space: { emoji: '🚀', color: '#b39dff', bg: '#01000c', bgGlow: 'rgba(15,5,35,.8)', grid: 'rgba(150,120,255,.055)', grid2: 'rgba(80,55,180,.02)', borderColor: '#9980fa', borderGlow: 'rgba(160,130,255,.6)', ambient: 'stars', fog: null },
};
const mapMeta = () => MAP_META[Game.mapId] || MAP_META.classic;

const camera = { x: 2000, y: 2000, zoom: 1, targetZoom: 1 };
let shake = 0;
let view = { x0: 0, y0: 0, x1: 0, y1: 0 };
let lastSample = null;

// ── Colors / skins ───────────────────────────────────────────────────────────
function lighten(hex, amt) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return hex || '#fff';
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  r = Math.min(255, r + r * amt); g = Math.min(255, g + g * amt); b = Math.min(255, b + b * amt);
  return `rgb(${~~r},${~~g},${~~b})`;
}
const SUPPORTER_SKINS = ['gold', 'neon', 'galaxy'];
function supporterColor(skin, i, total, now) {
  if (skin === 'gold') return `hsl(${42 + (i / total) * 18},${85 + (i % 6)}%,${48 + Math.sin(i / 8 + now / 600) * 8}%)`;
  if (skin === 'neon') return i % 2 === 0 ? '#39ff14' : '#ff00ff';
  return `hsl(${(260 + i * 3 + now / 40) % 360},78%,55%)`;
}
function segColor(info, i, total, now) {
  const cs = info.cs;
  if (cs) { const c = cs[i % SH.SKIN_ROWS] && cs[i % SH.SKIN_ROWS][i % SH.SKIN_COLS]; if (c) return c; }
  if (SUPPORTER_SKINS.includes(info.sk)) return supporterColor(info.sk, i, total, now);
  switch (info.sk) {
    case 'striped': return i % 3 === 0 ? lighten(info.c, 0.45) : info.c;
    case 'rainbow': return `hsl(${(i / total * 360 + now / 25) % 360},92%,55%)`;
    case 'glow': return `hsl(${(i * 4 + now / 40) % 360},90%,60%)`;
    default: return info.c;
  }
}
const perSegSkin = info => info.sk !== 'solid' || !!info.cs;
const withAlpha = (c, aa) => (c && c[0] === '#' && c.length === 7 ? c + aa : c);

// ── Ambient particles (screen space) ─────────────────────────────────────────
let ambient = [], shootingStars = [], ambientMap = '';
function initAmbient() {
  if (ambientMap === Game.mapId) return;
  ambientMap = Game.mapId; ambient = []; shootingStars = [];
  const m = mapMeta(), w = window.innerWidth, h = window.innerHeight;
  const R = Math.random;
  if (m.ambient === 'cyber') for (let i = 0; i < 45; i++) ambient.push({ x: R() * w, y: R() * h, vx: (R() - 0.5) * 0.22, vy: (R() - 0.5) * 0.22, r: R() * 2 + 0.5, life: R(), alpha: R() * 0.5 + 0.15, color: `hsl(${160 + R() * 40},100%,${55 + R() * 20}%)` });
  else if (m.ambient === 'snow') for (let i = 0; i < 70; i++) ambient.push({ x: R() * w, y: R() * h, vx: (R() - 0.5) * 0.3, vy: 0.25 + R() * 0.55, r: R() * 2.5 + 0.8, spin: R() * 6, spinV: (R() - 0.5) * 0.04, alpha: 0.15 + R() * 0.45, drift: R() * 6, driftV: 0.01 + R() * 0.015 });
  else if (m.ambient === 'embers') for (let i = 0; i < 55; i++) ambient.push({ x: R() * w, y: R() * h, vx: (R() - 0.5) * 0.5, vy: -(1.2 + R() * 1.4), r: R() * 2 + 0.5, color: `hsl(${15 + R() * 30},100%,${55 + R() * 20}%)`, flicker: R() * 6 });
  else for (let i = 0; i < 120; i++) ambient.push({ x: R() * w, y: R() * h, layer: i < 80 ? 0 : 1, r: i < 80 ? 0.6 : 1.4, alpha: i < 80 ? 0.2 + R() * 0.25 : 0.5 + R() * 0.4, tw: R() * 6, twV: 0.015 + R() * 0.025 });
}
function drawAmbient() {
  if (!hiQ()) return;
  const m = mapMeta(), vw = window.innerWidth, vh = window.innerHeight;
  ctx.save();
  if (m.ambient === 'cyber') {
    for (let i = 0; i < ambient.length; i++) for (let j = i + 1; j < ambient.length; j++) {
      const a = ambient[i], b = ambient[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 90) { ctx.strokeStyle = `rgba(0,255,204,${0.12 * (1 - d / 90)})`; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    for (const p of ambient) {
      p.x += p.vx; p.y += p.vy; p.life += 0.008;
      if (p.x < 0) p.x = vw; if (p.x > vw) p.x = 0; if (p.y < 0) p.y = vh; if (p.y > vh) p.y = 0;
      const pulse = 0.5 + 0.5 * Math.sin(p.life * 3);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + pulse * 0.4), 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.globalAlpha = p.alpha * (0.7 + pulse * 0.3); ctx.fill();
    }
  } else if (m.ambient === 'snow') {
    for (const p of ambient) {
      p.drift += p.driftV; p.y += p.vy; p.x += p.vx + Math.sin(p.drift) * 0.35; p.spin += p.spinV;
      if (p.y > vh + 10) p.y = -10; if (p.x < -10) p.x = vw + 10; if (p.x > vw + 10) p.x = -10;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.spin);
      ctx.strokeStyle = `rgba(180,230,255,${p.alpha})`; ctx.lineWidth = 0.8;
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, p.r * 3.5); ctx.stroke(); ctx.rotate(Math.PI / 3); }
      ctx.restore();
    }
  } else if (m.ambient === 'embers') {
    for (const p of ambient) {
      p.flicker += 0.07 + Math.random() * 0.06; p.y += p.vy; p.x += p.vx + Math.sin(p.flicker) * 0.4;
      if (p.y < -10) { p.y = vh + 10; p.x = Math.random() * vw; }
      const fl = 0.6 + 0.4 * Math.sin(p.flicker);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * fl, 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.globalAlpha = 0.55 * fl; ctx.fill();
    }
  } else {
    for (const p of ambient) {
      p.tw += p.twV;
      const k = p.layer === 0 ? 0.05 : 0.15;
      const px = ((p.x - camera.x * k) % vw + vw) % vw, py = ((p.y - camera.y * k) % vh + vh) % vh;
      ctx.beginPath(); ctx.arc(px, py, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.layer === 0 ? `rgba(200,190,255,${p.alpha * (0.75 + 0.25 * Math.sin(p.tw))})` : `rgba(255,255,255,${p.alpha * (0.75 + 0.25 * Math.sin(p.tw))})`;
      ctx.fill();
    }
    if (Math.random() < 0.003) shootingStars.push({ x: Math.random() * vw, y: Math.random() * vh * 0.4, vx: 6 + Math.random() * 4, vy: 3 + Math.random() * 2, life: 1 });
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const s = shootingStars[i]; s.x += s.vx; s.y += s.vy; s.life -= 0.035;
      if (s.life <= 0) { shootingStars.splice(i, 1); continue; }
      const g = ctx.createLinearGradient(s.x - s.vx * 8, s.y - s.vy * 8, s.x, s.y);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,255,255,${s.life * 0.8})`);
      ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(s.x - s.vx * 8, s.y - s.vy * 8); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
  }
  ctx.restore();
}

// ── Death explosion (world space) ────────────────────────────────────────────
let deathParticles = [];
function spawnDeathExplosion(x, y, color) {
  for (let i = 0; i < 42; i++) { const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 8; deathParticles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1.5 + Math.random() * 4.5, life: 1, color, g: 0.07 }); }
  for (let i = 0; i < 12; i++) { const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 5; deathParticles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 0.8 + Math.random() * 2, life: 1, color: '#ffffff', g: 0.12 }); }
  for (let ri = 0; ri < 3; ri++) deathParticles.push({ x, y, ring: true, rr: 4 + ri * 3, rs: 5 + ri * 2, life: 1 - 0.15 * ri, color });
}
function drawDeathParticles() {
  for (let i = deathParticles.length - 1; i >= 0; i--) {
    const p = deathParticles[i];
    if (p.ring) {
      p.rr += p.rs; p.life -= 0.038;
      if (p.life <= 0) { deathParticles.splice(i, 1); continue; }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.rr, 0, Math.PI * 2);
      ctx.strokeStyle = p.color; ctx.lineWidth = 3 * p.life; ctx.globalAlpha = p.life * 0.6; ctx.stroke();
    } else {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= 0.028; p.r *= 0.97;
      if (p.life <= 0) { deathParticles.splice(i, 1); continue; }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.globalAlpha = p.life * 0.9; ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ── Boost trails (world space, per snake) ────────────────────────────────────
const trails = new Map();
function updateTrails(snakes) {
  const seen = new Set();
  for (const s of snakes) {
    if (!hasFlag(s, F.BOOST) || s.info.cl) continue;
    seen.add(s.id);
    let tr = trails.get(s.id);
    if (!tr) { tr = []; trails.set(s.id, tr); }
    tr.push({ x: s.pts[0], y: s.pts[1], life: 1, color: s.info.tr || s.info.c });
    if (tr.length > 40) tr.shift();
  }
  for (const [id, tr] of trails) if (!seen.has(id) && !tr.length) trails.delete(id);
}
function drawTrails() {
  for (const tr of trails.values()) {
    for (let i = tr.length - 1; i >= 0; i--) {
      const p = tr[i]; p.life -= 0.04;
      if (p.life <= 0) { tr.splice(i, 1); continue; }
      ctx.beginPath(); ctx.arc(p.x, p.y, 10 * p.life, 0, Math.PI * 2); ctx.fillStyle = withAlpha(p.color, '20'); ctx.globalAlpha = 1; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, 5.5 * p.life, 0, Math.PI * 2); ctx.strokeStyle = p.color; ctx.lineWidth = 1.5; ctx.globalAlpha = p.life * 0.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.2 * p.life, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.globalAlpha = p.life * 0.6; ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ── World layers ─────────────────────────────────────────────────────────────
function inView(x, y, m) { return x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m; }

function drawGrid() {
  const m = mapMeta(), { W, H } = Net.world;
  const gs = 80;
  ctx.fillStyle = m.grid;
  const x0 = Math.max(0, Math.floor(view.x0 / gs) * gs), x1 = Math.min(W, view.x1);
  const y0 = Math.max(0, Math.floor(view.y0 / gs) * gs), y1 = Math.min(H, view.y1);
  const dot = 1.2 / camera.zoom;
  for (let x = x0; x <= x1; x += gs) for (let y = y0; y <= y1; y += gs) ctx.fillRect(x - dot, y - dot, dot * 2, dot * 2);
  ctx.strokeStyle = m.grid2; ctx.lineWidth = 0.6 / camera.zoom;
  ctx.beginPath();
  for (let x = Math.max(0, Math.floor(view.x0 / 400) * 400); x <= x1; x += 400) { ctx.moveTo(x, Math.max(0, view.y0)); ctx.lineTo(x, y1); }
  for (let y = Math.max(0, Math.floor(view.y0 / 400) * 400); y <= y1; y += 400) { ctx.moveTo(Math.max(0, view.x0), y); ctx.lineTo(x1, y); }
  ctx.stroke();
  if (hiQ()) { ctx.shadowColor = m.borderGlow; ctx.shadowBlur = 28; }
  ctx.strokeStyle = withAlpha(m.borderColor, '55'); ctx.lineWidth = 12; ctx.strokeRect(0, 0, W, H);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = m.borderColor; ctx.lineWidth = 2; ctx.strokeRect(0, 0, W, H);
}

function drawZone(z) {
  if (!z) return;
  const [x, y, r] = z;
  const t = performance.now();
  ctx.save();
  ctx.beginPath();
  ctx.rect(view.x0 - 500, view.y0 - 500, view.x1 - view.x0 + 1000, view.y1 - view.y0 + 1000);
  ctx.arc(x, y, r, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(255,10,10,.13)'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (hiQ()) { ctx.shadowColor = 'rgba(255,40,40,.8)'; ctx.shadowBlur = 30 + 8 * Math.sin(t / 220); }
  ctx.strokeStyle = 'rgba(255,50,50,.18)'; ctx.lineWidth = 22; ctx.stroke(); ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,65,65,${0.7 + 0.2 * Math.sin(t / 220)})`; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
}

function drawFood(fd) {
  const t = performance.now(), hq = hiQ();
  for (const f of fd) {
    const [id, x, y, sz, col] = f;
    if (!inView(x, y, 30)) continue;
    const r = sz * (1 + 0.18 * Math.sin(t / 280 + id * 0.9));
    ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, Math.PI * 2); ctx.fillStyle = withAlpha(col, '24'); ctx.fill();
    if (sz > 6) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4 + t / 2000 + id * 0.3);
      if (hq) { ctx.shadowColor = col; ctx.shadowBlur = r * 2.5; }
      ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(r * 0.7, 0); ctx.lineTo(0, r * 0.9); ctx.lineTo(-r * 0.7, 0); ctx.closePath();
      ctx.fillStyle = col; ctx.fill(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.5); ctx.lineTo(r * 0.35, 0); ctx.lineTo(0, r * 0.5); ctx.lineTo(-r * 0.35, 0); ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
      ctx.restore();
    } else {
      if (hq) { ctx.shadowColor = col; ctx.shadowBlur = r * 2; }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
}

function drawOrbs(orbs) {
  if (!orbs) return;
  const t = performance.now();
  for (const [id, x, y, v] of orbs) {
    if (!inView(x, y, 40)) continue;
    const pulse = 1 + 0.15 * Math.sin(t / 200 + x);
    const r = 10 * pulse;
    ctx.save(); ctx.translate(x, y);
    if (hiQ()) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 22; }
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, r);
    g.addColorStop(0, '#fff7c2'); g.addColorStop(0.5, '#ffd700'); g.addColorStop(1, '#c78a00');
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = `bold ${Math.round(9 / Math.max(0.6, camera.zoom))}px Orbitron,monospace`; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd700';
    ctx.fillText(fmtMoney(v, Game.arenaCurrency).replace(' DEMO', ''), 0, -r - 5);
    ctx.restore();
  }
}

function drawPowerups(pus) {
  const t = performance.now();
  for (const [id, x, y, ti] of pus) {
    if (!inView(x, y, 50)) continue;
    const type = PU_TYPES[ti], col = PU_COLORS[type] || '#fff';
    const r = 14 * (0.85 + Math.sin(t / 280 + id) * 0.15);
    ctx.save(); ctx.translate(x, y);
    ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2); ctx.fillStyle = withAlpha(col, '14'); ctx.fill();
    ctx.rotate(t / 1800);
    if (hiQ()) { ctx.shadowColor = col; ctx.shadowBlur = 16; }
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 - Math.PI / 6; i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = withAlpha(col, '22'); ctx.fill();
    ctx.shadowBlur = 0; ctx.rotate(-t / 1800);
    ctx.save(); ctx.rotate(-t / 600); ctx.setLineDash([5, 7]); ctx.strokeStyle = withAlpha(col, '55'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(PU_ICONS[type] || '?', 0, 0); ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}

function drawObstacles(obs) {
  const mapId = Game.mapId, t = performance.now(), hq = hiQ();
  for (const [id, x, y, r] of obs) {
    if (!inView(x, y, r + 60)) continue;
    ctx.save();
    ctx.beginPath();
    const sides = 7 + (id % 3);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2, r2 = r * (0.72 + 0.28 * Math.sin(i * 2.1 + id));
      i === 0 ? ctx.moveTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2) : ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
    }
    ctx.closePath();
    if (mapId === 'arctic') {
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, 'rgba(180,240,255,.85)'); g.addColorStop(1, 'rgba(60,140,210,.7)');
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(220,250,255,.8)'; ctx.lineWidth = 2; ctx.stroke();
    } else if (mapId === 'volcano') {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(100,15,0,.95)'); g.addColorStop(1, 'rgba(30,3,0,.98)');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = `rgba(255,${80 + 40 * Math.sin(t / 300 + id)},0,.85)`; ctx.lineWidth = 2.5;
      if (hq) { ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 12; }
      ctx.stroke(); ctx.shadowBlur = 0;
    } else if (mapId === 'space') {
      const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, 0, x, y, r);
      g.addColorStop(0, 'rgba(90,80,110,.92)'); g.addColorStop(1, 'rgba(35,28,55,.96)');
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(140,120,180,.65)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = 0.35;
      for (const [ox, oy, cr] of [[-0.3, -0.25, 0.22], [0.25, 0.2, 0.15], [-0.1, 0.3, 0.12]]) { ctx.beginPath(); ctx.arc(x + r * ox, y + r * oy, r * cr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fill(); }
    } else {
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,35,28,.92)'); g.addColorStop(1, 'rgba(0,12,10,.96)');
      ctx.fillStyle = g; ctx.fill();
      if (hq) { ctx.shadowColor = 'rgba(0,245,212,.9)'; ctx.shadowBlur = 14; }
      ctx.strokeStyle = 'rgba(0,245,212,.6)'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1; ctx.restore();
  }
}

function drawPortals() {
  const t = performance.now();
  const PCOLS = ['#a78bfa', '#00f5d4', '#ff2d6b', '#f0c040'];
  for (const p of Net.portals) {
    if (!inView(p.x, p.y, 60)) continue;
    const col = PCOLS[p.pairIdx % PCOLS.length];
    const spin = (t / 500) * (p.which === 'a' ? 1 : -1);
    const pulse = 0.88 + 0.12 * Math.sin(t / 280 + p.pairIdx * 1.3);
    ctx.save(); ctx.translate(p.x, p.y);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.r * 1.8);
    g.addColorStop(0, col + '40'); g.addColorStop(1, col + '00');
    ctx.beginPath(); ctx.arc(0, 0, p.r * 1.8, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.rotate(spin);
    if (hiQ()) { ctx.shadowColor = col; ctx.shadowBlur = 22; }
    ctx.setLineDash([8, 5]); ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, p.r * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.rotate(-spin * 2); ctx.setLineDash([4, 8]); ctx.strokeStyle = col + '88'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, p.r * 0.72, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.shadowBlur = 0;
    ctx.restore();
    ctx.font = 'bold 9px Orbitron,monospace'; ctx.textAlign = 'center'; ctx.fillStyle = col;
    ctx.fillText(p.which === 'a' ? 'IN' : 'OUT', p.x, p.y + p.r + 13);
  }
}

function drawEventWorld(ev) {
  if (!ev || ev.type !== 'meteor' || ev.x == null) return;
  const t = performance.now(), pulse = 0.88 + 0.12 * Math.sin(t / 120);
  ctx.save();
  ctx.beginPath(); ctx.arc(ev.x, ev.y, ev.r * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,120,70,${0.7 + 0.2 * Math.sin(t / 100)})`; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(ev.x, ev.y, ev.r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,80,30,.12)'; ctx.fill();
  ctx.font = 'bold 11px Orbitron,monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,150,80,.85)';
  ctx.fillText('☄ DANGER', ev.x, ev.y - ev.r - 8);
  ctx.restore();
}
function drawEventScreen(ev) {
  if (!ev) return;
  const t = performance.now(), w = window.innerWidth, h = window.innerHeight;
  ctx.save();
  if (ev.type === 'blizzard') {
    ctx.fillStyle = `rgba(140,210,255,${0.06 + 0.03 * Math.sin(t / 400)})`; ctx.fillRect(0, 0, w, h);
    const seed = (t / 60) % 1000;
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 137 + seed * 2.3) % w + w) % w, sy = ((i * 97 + seed * 1.7) % h + h) % h;
      ctx.beginPath(); ctx.arc(sx, sy, 1.2 + Math.sin(i) * 0.7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(200,230,255,.4)'; ctx.fill();
    }
  } else if (ev.type === 'eruption') {
    ctx.fillStyle = `rgba(200,50,0,${0.04 + 0.03 * Math.sin(t / 180)})`; ctx.fillRect(0, 0, w, h);
  } else if (ev.type === 'surge') {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.9);
    g.addColorStop(0, 'rgba(0,255,204,0)'); g.addColorStop(1, `rgba(0,255,204,${0.06 + 0.05 * Math.sin(t / 100)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

// ── Snakes ───────────────────────────────────────────────────────────────────
function tracePath(pts, maxPts) {
  const { W, H } = Net.world;
  const n = Math.min(pts.length / 2, maxPts || Infinity);
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    if (Math.abs(x - pts[i * 2 - 2]) > W / 2 || Math.abs(y - pts[i * 2 - 1]) > H / 2) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function drawSnake(s, isMe, now) {
  const pts = s.pts, n = pts.length / 2;
  if (n < 2) return;
  const info = s.info;
  const { W, H } = Net.world;
  const hq = hiQ();
  const shielded = hasFlag(s, F.SHIELD), ghost = hasFlag(s, F.GHOST), frozen = hasFlag(s, F.FROZEN);
  const protect = hasFlag(s, F.PROTECT), cashout = hasFlag(s, F.CASHOUT), speed = hasFlag(s, F.SPEED);
  const isClone = !!info.cl;
  const d = s.d || 2;
  const baseW = isMe ? 18 : 16;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let alpha = 1;
  if (ghost) alpha = 0.38;
  if (isClone) { alpha = 0.45; ctx.setLineDash([8, 5]); }
  if (protect) alpha = Math.min(alpha, 0.45 + 0.25 * Math.sin(now / 90));
  ctx.globalAlpha = alpha;

  let glow = shielded ? '#00f5d4' : speed ? '#f0c040' : frozen ? '#88ddff' : cashout ? '#ffd700' : info.c;
  if (ghost) glow = '#8899aa';
  if (hq) {
    ctx.shadowColor = glow; ctx.shadowBlur = shielded ? 32 : 20;
    ctx.strokeStyle = withAlpha(glow, '28'); ctx.lineWidth = baseW + 20;
    tracePath(pts); ctx.stroke(); ctx.shadowBlur = 0;
  }
  ctx.strokeStyle = withAlpha(glow, '50'); ctx.lineWidth = baseW + 5;
  tracePath(pts); ctx.stroke();

  // Body with taper.
  const perSeg = perSegSkin(info);
  for (let i = n - 1; i >= 1; i--) {
    const x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[i * 2 - 2], y1 = pts[i * 2 - 1];
    if (Math.abs(x0 - x1) > W / 2 || Math.abs(y0 - y1) > H / 2) continue;
    const taper = Math.max(0.55, 1 - (i / n) * 0.38);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.strokeStyle = perSeg ? segColor(info, i * d, s.n, now) : info.c;
    ctx.lineWidth = baseW * taper; ctx.stroke();
  }
  if (info.sk === 'dotted') {
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    for (let i = 0; i < n; i += Math.max(1, Math.round(4 / d))) { ctx.beginPath(); ctx.arc(pts[i * 2], pts[i * 2 + 1], 2.8, 0, Math.PI * 2); ctx.fill(); }
  }
  // Scale texture and spine highlight.
  if (hq && n > 4) {
    ctx.globalAlpha = 0.18 * alpha; ctx.fillStyle = 'rgba(255,255,255,.9)';
    const step = Math.max(1, Math.round(3 / d));
    for (let i = step; i < n - 1; i += step) {
      const ang = Math.atan2(pts[i * 2 + 1] - pts[i * 2 - 1], pts[i * 2] - pts[i * 2 - 2]);
      ctx.save(); ctx.translate(pts[i * 2], pts[i * 2 + 1]); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(0, -4); ctx.lineTo(3, 0); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    ctx.globalAlpha = alpha;
  }
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = isMe ? 7 : 5.5; tracePath(pts, Math.ceil(50 / d)); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = isMe ? 2.5 : 2; tracePath(pts, Math.ceil(30 / d)); ctx.stroke();

  // Head.
  const hx = pts[0], hy = pts[1];
  const ang = Math.atan2(pts[1] - pts[3], pts[0] - pts[2]);
  const headR = isMe ? 13 : 11;
  if (hq) { ctx.shadowColor = glow; ctx.shadowBlur = 22; }
  ctx.beginPath(); ctx.arc(hx, hy, headR + 4, 0, Math.PI * 2); ctx.fillStyle = withAlpha(glow, '22'); ctx.fill(); ctx.shadowBlur = 0;
  if (hq) { ctx.shadowColor = glow; ctx.shadowBlur = 14; }
  ctx.beginPath(); ctx.arc(hx, hy, headR, 0, Math.PI * 2);
  ctx.fillStyle = info.sk === 'rainbow' ? `hsl(${now / 15 % 360},95%,55%)` : segColor(info, 0, s.n, now); ctx.fill(); ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(hx - headR * 0.28, hy - headR * 0.28, headR * 0.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fill();
  ctx.beginPath(); ctx.arc(hx - headR * 0.1, hy - headR * 0.38, headR * 0.18, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fill();
  for (const [a, dd] of [[ang + 0.52, headR * 0.58], [ang - 0.52, headR * 0.58]]) {
    const ex = hx + Math.cos(a) * dd, ey = hy + Math.sin(a) * dd;
    ctx.beginPath(); ctx.arc(ex, ey, 4.2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + Math.cos(ang) * 1.6, ey + Math.sin(ang) * 1.6, 2.2, 0, Math.PI * 2); ctx.fillStyle = '#0a0a0a'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + Math.cos(ang + 0.5), ey + Math.sin(ang + 0.5), 0.9, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
  }
  if (now % 1200 < 300) {
    const tl = headR + 6, tx = hx + Math.cos(ang) * tl, ty = hy + Math.sin(ang) * tl;
    ctx.setLineDash([]); ctx.strokeStyle = '#ff3d71'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(hx + Math.cos(ang) * headR, hy + Math.sin(ang) * headR); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(ang + 0.5) * 3, ty + Math.sin(ang + 0.5) * 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(ang - 0.5) * 3, ty + Math.sin(ang - 0.5) * 3); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (shielded) {
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(now / 400);
    ctx.strokeStyle = 'rgba(0,255,204,.8)'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.arc(0, 0, headR + 8, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (cashout) {
    ctx.save(); ctx.strokeStyle = `rgba(255,215,0,${0.6 + 0.3 * Math.sin(now / 80)})`; ctx.lineWidth = 3; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(hx, hy, headR + 14, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (info.bo) {
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(now / 600);
    ctx.strokeStyle = info.bo; ctx.lineWidth = 2; ctx.globalAlpha = 0.8; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.arc(0, 0, headR + 10, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (info.tm) { ctx.beginPath(); ctx.arc(hx, hy - headR - 6, 4, 0, Math.PI * 2); ctx.fillStyle = info.tm === 'red' ? '#FF4757' : '#1E90FF'; ctx.fill(); }
  ctx.setLineDash([]);

  // Labels (kept readable when zoomed out).
  const k = 1 / camera.zoom;
  let ly = hy - headR - 12 * Math.min(k, 1.6);
  ctx.textAlign = 'center';
  if ((s.l || 1) > 1) {
    ctx.font = `bold ${9 * k}px Orbitron,monospace`;
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(hx - 11 * k, ly - 9 * k, 22 * k, 12 * k);
    ctx.fillStyle = '#ffc312'; ctx.fillText('L' + s.l, hx, ly);
    ly -= 14 * k;
  }
  if (!isMe || info.ti || s.v != null) {
    if (!isMe) {
      ctx.font = `600 ${11 * k}px Rajdhani,sans-serif`;
      const lbl = (isClone ? '👥 ' : info.b ? '🤖 ' : '') + info.n;
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(hx - tw / 2 - 5 * k, ly - 11 * k, tw + 10 * k, 14 * k);
      ctx.fillStyle = isClone ? 'rgba(253,167,223,.7)' : info.b ? '#8a9bb5' : info.c; ctx.fillText(lbl, hx, ly);
      ly -= 15 * k;
    }
    if (info.ti) {
      ctx.font = `600 ${9 * k}px Orbitron,monospace`;
      ctx.fillStyle = '#c084fc'; ctx.fillText(String(info.ti).slice(0, 16), hx, ly);
      ly -= 12 * k;
    }
    if (s.v != null) {
      ctx.font = `bold ${11 * k}px Orbitron,monospace`;
      ctx.fillStyle = '#ffd700'; ctx.fillText(fmtMoney(s.v, Game.arenaCurrency).replace(' DEMO', ''), hx, ly);
      ly -= 14 * k;
    }
  }
  if (s.e) { ctx.font = `${18 * k}px sans-serif`; ctx.fillText(s.e, hx, ly - 4 * k); }
  if (frozen) {
    ctx.globalAlpha = 0.28 + 0.12 * Math.sin(now / 150);
    ctx.strokeStyle = 'rgba(136,221,255,.9)'; ctx.lineWidth = baseW + 6; tracePath(pts); ctx.stroke();
  }
  ctx.restore();
}

// ── Minimap ──────────────────────────────────────────────────────────────────
function drawMinimap(meId, pings) {
  const mw = mmc.width, mh = mmc.height;
  const { W, H } = Net.world;
  const m = mapMeta();
  mCtx.clearRect(0, 0, mw, mh);
  mCtx.fillStyle = 'rgba(2,4,14,.82)'; mCtx.fillRect(0, 0, mw, mh);
  mCtx.strokeStyle = m.grid; mCtx.lineWidth = 1; mCtx.strokeRect(0.5, 0.5, mw - 1, mh - 1);
  const sx = mw / W, sy = mh / H;
  const z = lastSample && lastSample.pkt.z;
  if (z) { mCtx.beginPath(); mCtx.arc(z[0] * sx, z[1] * sy, z[2] * sx, 0, Math.PI * 2); mCtx.strokeStyle = 'rgba(255,55,55,.6)'; mCtx.stroke(); }
  for (const [x, y, ti] of Net.mm.pu || []) { mCtx.beginPath(); mCtx.arc(x * 10 * sx, y * 10 * sy, 2.5, 0, Math.PI * 2); mCtx.fillStyle = PU_COLORS[PU_TYPES[ti]] || '#fff'; mCtx.fill(); }
  for (const p of Net.portals) { mCtx.beginPath(); mCtx.arc(p.x * sx, p.y * sy, 2, 0, Math.PI * 2); mCtx.fillStyle = '#9980fa'; mCtx.fill(); }
  const now = Date.now();
  for (const ping of pings) {
    const age = (now - ping.t) / 3000; if (age > 1) continue;
    mCtx.beginPath(); mCtx.arc(ping.x * sx, ping.y * sy, (1 - age) * 7, 0, Math.PI * 2);
    mCtx.strokeStyle = ping.c || '#fff'; mCtx.lineWidth = 1.2; mCtx.globalAlpha = 1 - age; mCtx.stroke(); mCtx.globalAlpha = 1;
  }
  for (const [id, x, y] of Net.mm.p || []) {
    const me = id === meId;
    const info = Net.info.get(id);
    mCtx.beginPath(); mCtx.arc(x * 10 * sx, y * 10 * sy, me ? 4.5 : 2.6, 0, Math.PI * 2);
    mCtx.fillStyle = me ? '#fff' : (info ? info.c : '#888'); mCtx.fill();
  }
  if (Game.mapId) {
    const vx0 = Math.max(0, view.x0) * sx, vy0 = Math.max(0, view.y0) * sy;
    mCtx.strokeStyle = 'rgba(255,255,255,.18)'; mCtx.strokeRect(vx0, vy0, Math.min(W, view.x1) * sx - vx0, Math.min(H, view.y1) * sy - vy0);
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────
let frame = 0;
let lastFrameAt = performance.now();
function render(now) {
  requestAnimationFrame(render);
  if (!Game.inGame) return;
  const dt = Math.min(0.1, (now - lastFrameAt) / 1000); lastFrameAt = now;
  const st = sampleState(now);
  if (!st) return;
  lastSample = st;
  const vw = window.innerWidth, vh = window.innerHeight;
  const snakes = st.snakes;
  const me = snakes.find(s => s.id === Game.myId);

  // Camera target.
  let target = null, len = SH.INIT_SEGS;
  if (Game.replayCam) target = Game.replayCam;
  else if (me && Game.alive) { target = { x: me.pts[0], y: me.pts[1] }; len = me.n; }
  else if (Game.spectateId) {
    const t = snakes.find(s => s.id === Game.spectateId);
    if (t) { target = { x: t.pts[0], y: t.pts[1] }; len = t.n; }
  }
  if (!target && me) { target = { x: me.pts[0], y: me.pts[1] }; len = me.n; }
  if (!target) target = Game.lastPos || { x: Net.world.W / 2, y: Net.world.H / 2 };
  const { W, H } = Net.world;
  if (Math.abs(target.x - camera.x) > W / 2 || Math.abs(target.y - camera.y) > H / 2) { camera.x = target.x; camera.y = target.y; }
  else { const k = Math.min(1, dt * 18); camera.x += (target.x - camera.x) * k; camera.y += (target.y - camera.y) * k; }
  camera.targetZoom = settings.zoom === 'on' ? SH.zoomForLength(len) : 1;
  if (vw < 700) camera.targetZoom *= 0.8;
  camera.zoom += (camera.targetZoom - camera.zoom) * Math.min(1, dt * 2.5);
  let cx = camera.x, cy = camera.y;
  if (shake > 0) { cx += (Math.random() - 0.5) * shake; cy += (Math.random() - 0.5) * shake; shake *= 0.85; if (shake < 0.3) shake = 0; }
  const z = camera.zoom;
  view = { x0: cx - vw / 2 / z, y0: cy - vh / 2 / z, x1: cx + vw / 2 / z, y1: cy + vh / 2 / z };

  // Background (screen space).
  const m = mapMeta();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = m.bg; ctx.fillRect(0, 0, vw, vh);
  const bgr = ctx.createRadialGradient(vw * 0.45, vh * 0.38, 0, vw * 0.45, vh * 0.38, Math.max(vw, vh) * 0.75);
  bgr.addColorStop(0, m.bgGlow); bgr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bgr; ctx.fillRect(0, 0, vw, vh);
  if (m.fog) { ctx.fillStyle = m.fog; ctx.fillRect(0, 0, vw, vh); }
  initAmbient();
  drawAmbient();

  // World.
  ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (vw / 2 - cx * z), DPR * (vh / 2 - cy * z));
  const pkt = st.pkt;
  drawGrid();
  drawZone(pkt.z);
  drawFood(pkt.fd);
  drawOrbs(pkt.or);
  drawPowerups(pkt.pu);
  drawObstacles(pkt.ob);
  drawPortals();
  updateTrails(snakes);
  drawTrails();
  drawEventWorld(pkt.ev);
  drawDeathParticles();
  for (const s of snakes) if (s.id !== Game.myId) drawSnake(s, false, now);
  if (me) drawSnake(me, true, now);

  // Screen-space overlays.
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawEventScreen(pkt.ev);
  if (hiQ()) {
    const vig = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.35, vw / 2, vh / 2, vh * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.32)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, vw, vh);
  }
  if (Game.alive && !isTouch && Input.mode === 'mouse') {
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Input.mx - 10, Input.my); ctx.lineTo(Input.mx + 10, Input.my); ctx.moveTo(Input.mx, Input.my - 10); ctx.lineTo(Input.mx, Input.my + 10); ctx.stroke();
    ctx.beginPath(); ctx.arc(Input.mx, Input.my, 4.5, 0, Math.PI * 2); ctx.strokeStyle = Input.boost ? '#ff3d71' : 'rgba(0,255,204,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (Game.paused) { ctx.fillStyle = 'rgba(3,8,15,.45)'; ctx.fillRect(0, 0, vw, vh); }

  frame++;
  if (frame % 3 === 0) drawMinimap(Game.myId, Hud.pings);
  Hud.onFrame(st, me);
}
requestAnimationFrame(render);
