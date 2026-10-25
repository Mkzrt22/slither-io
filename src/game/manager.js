'use strict';
const { Room } = require('./room');
const { TICK_RATE } = require('../../shared/constants');

const PUBLIC_ROOMS = [
  { id: 'pub-classic', mode: 'classic', mapId: 'classic' },
  { id: 'pub-arctic', mode: 'classic', mapId: 'arctic' },
  { id: 'pub-volcano', mode: 'classic', mapId: 'volcano' },
  { id: 'pub-space', mode: 'classic', mapId: 'space' },
  { id: 'pub-royale', mode: 'royale', mapId: 'classic' },
  { id: 'pub-ranked', mode: 'ranked', mapId: 'arctic' },
];
const PUBLIC_IDS = new Set(PUBLIC_ROOMS.map(r => r.id));
const PUBLIC_NAMES = {
  'pub-classic': 'Public · Cyber Grid', 'pub-arctic': 'Public · Crystal Tundra', 'pub-volcano': 'Public · Magma Core',
  'pub-space': 'Public · Void Nebula', 'pub-royale': 'Public · Royale', 'pub-ranked': 'Public · Ranked',
};

function createManager({ config }) {
  const rooms = new Map();
  let counter = 0;
  let net = null, services = {};

  function createRoom(opts) {
    const id = opts.id || 'r' + (++counter).toString(36) + Math.random().toString(36).slice(2, 5);
    const room = new Room({ ...opts, id, net, services });
    rooms.set(id, room);
    return room;
  }
  // Network and room services come from the socket layer; public rooms open once they exist.
  function init(deps) {
    net = deps.net;
    services = deps.services;
    for (const pr of PUBLIC_ROOMS) createRoom({ ...pr, name: PUBLIC_NAMES[pr.id], isPublic: true });
  }

  function userRoomCount() { let n = 0; for (const r of rooms.values()) if (!r.isPublic && r.mode !== 'arena') n++; return n; }

  // Finds a public room for quick play, opening an overflow room when all are full.
  function quickPlayRoom(mapId) {
    const candidates = [...rooms.values()].filter(r => r.isPublic && r.mode === 'classic' && r.mapId === mapId && !r.closed);
    const open = candidates.filter(r => r.humanCount() < config.MAX_PLAYERS_PER_ROOM).sort((a, b) => b.humanCount() - a.humanCount());
    if (open.length) return open[0];
    return createRoom({ mode: 'classic', mapId, name: (PUBLIC_NAMES['pub-' + mapId] || 'Public') + ' #' + (candidates.length + 1), isPublic: true });
  }

  function lobbyRooms() {
    return [...rooms.values()].filter(r => r.mode !== 'arena' && !r.closed).map(r => r.summary())
      .sort((a, b) => (b.public - a.public) || b.players - a.players);
  }

  // Fixed-rate loop shared by all rooms.
  const tickMs = 1000 / TICK_RATE;
  let nextAt = Date.now();
  let timer = null;
  function loop() {
    const start = Date.now();
    for (const room of rooms.values()) {
      try { room.tick(); } catch (e) { console.error('Room tick error', room.id, e); }
    }
    nextAt += tickMs;
    const now = Date.now();
    if (now - nextAt > 500) nextAt = now; // fell far behind: resync instead of bursting
    timer = setTimeout(loop, Math.max(0, nextAt - now));
    const cost = now - start;
    if (cost > tickMs) console.warn(`Slow tick: ${cost}ms for ${rooms.size} rooms`);
  }
  function start() { nextAt = Date.now() + tickMs; timer = setTimeout(loop, tickMs); }
  function stop() { clearTimeout(timer); }

  // Removes closed rooms and private rooms empty for more than a minute.
  function sweep(onClose) {
    const now = Date.now();
    for (const [id, r] of rooms) {
      const emptyTooLong = !PUBLIC_IDS.has(id) && r.mode !== 'arena' && r.humanCount() === 0 && r.emptySince && now - r.emptySince > 60000;
      if (r.closed || emptyTooLong) { rooms.delete(id); if (onClose) onClose(r); }
    }
  }

  function stats() {
    let players = 0;
    for (const r of rooms.values()) players += r.humanCount();
    return { rooms: rooms.size, players };
  }

  return { rooms, init, createRoom, quickPlayRoom, lobbyRooms, userRoomCount, start, stop, sweep, stats, get: id => rooms.get(id) };
}

module.exports = { createManager, PUBLIC_ROOMS };
