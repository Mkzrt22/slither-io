'use strict';
// Snapshot buffer and interpolation. The server sends ~25 snapshots/s; we render
// slightly in the past and blend the two snapshots around the render time.

const Net = {
  info: new Map(),   // snake id -> static info (name, color, skin…)
  snaps: [],         // recent snapshots, oldest first
  avgInterval: 40,
  lastArrival: 0,
  world: { W: 4000, H: 4000 },
  portals: [],
  mm: { p: [], pu: [], lb: [] },
};

function resetNet(W, H, portals) {
  Net.info.clear();
  Net.snaps = [];
  Net.lastArrival = 0;
  Net.world = { W, H };
  Net.portals = (portals || []).map(([x, y, r, pairIdx, which]) => ({ x, y, r, pairIdx, which }));
  Net.mm = { p: [], pu: [], lb: [] };
}

socket.on('snakeInfo', list => { for (const i of list) Net.info.set(i.i, i); });
socket.on('mm', m => { Net.mm = m; });

function onStatePacket(pkt) {
  const now = performance.now();
  if (Net.lastArrival) Net.avgInterval = Net.avgInterval * 0.9 + Math.min(200, now - Net.lastArrival) * 0.1;
  Net.lastArrival = now;
  const sn = new Map();
  for (const s of pkt.sn) sn.set(s.i, s);
  Net.snaps.push({ at: now, tick: pkt.t, sn, pkt });
  if (Net.snaps.length > 8) Net.snaps.shift();
}

function lerpWrap(a, b, t, size) {
  let d = b - a;
  if (d > size / 2) d -= size; else if (d < -size / 2) d += size;
  let v = a + d * t;
  if (v < 0) v += size; else if (v >= size) v -= size;
  return v;
}

// Returns { snakes:[{id, info, f, l, s, v, e, d, n, pts:Float32Array}], pkt } for the render time.
function sampleState(now) {
  const snaps = Net.snaps;
  if (!snaps.length) return null;
  const delay = Math.max(60, Math.min(160, Net.avgInterval * 2));
  const rt = now - delay;
  let a = snaps[0], b = null;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].at <= rt) { a = snaps[i]; b = snaps[i + 1] || null; break; }
  }
  if (!b) { // no newer snapshot yet: show the closest one as-is
    a = rt < snaps[0].at ? snaps[0] : snaps[snaps.length - 1];
    return { snakes: buildSnakes(a, null, 0), pkt: a.pkt, base: a };
  }
  const t = Math.max(0, Math.min(1, (rt - a.at) / Math.max(1, b.at - a.at)));
  return { snakes: buildSnakes(a, b, t), pkt: t < 0.5 ? a.pkt : b.pkt, base: t < 0.5 ? a : b, t };
}

function buildSnakes(a, b, t) {
  const { W, H } = Net.world;
  const out = [];
  const src = b || a;
  for (const [id, sb] of src.sn) {
    const sa = b ? a.sn.get(id) : null;
    const gb = sb.g;
    const pts = new Float32Array(gb.length);
    if (sa && sa.d === sb.d && !sb.tp) {
      const ga = sa.g;
      const m = Math.min(ga.length, gb.length);
      for (let i = 0; i < m; i += 2) {
        pts[i] = lerpWrap(ga[i], gb[i], t, W);
        pts[i + 1] = lerpWrap(ga[i + 1], gb[i + 1], t, H);
      }
      for (let i = m; i < gb.length; i++) pts[i] = gb[i];
    } else {
      for (let i = 0; i < gb.length; i++) pts[i] = gb[i];
    }
    out.push({ id, info: Net.info.get(id) || { n: '?', c: '#fff', sk: 'solid' }, f: sb.f, l: sb.l, s: sb.s, v: sb.v, e: sb.e, d: sb.d, n: sb.n, pts });
  }
  return out;
}

const hasFlag = (s, f) => (s.f & f) !== 0;
