'use strict';
const S = require('../shared/constants');
const U = require('./util');
const { makeSessionToken, verifySessionToken, verifySupporterToken } = require('./auth');
const { getDailyChallenge } = require('./game/challenges');

// Socket.io event handlers. Every payload from the client is untrusted.
function attachSockets({ io, config, manager, accounts, stats, arena, payments, publicConfig }) {
  const limiter = new U.RateLimiter();
  setInterval(() => limiter.sweep(), 60000).unref();
  const sessions = new Map(); // socketId -> session
  const userSockets = new Map(); // userId -> Set(socketId)

  const sendTo = (socketId, ev, data) => { const s = io.sockets.sockets.get(socketId); if (s) s.emit(ev, data); };

  function walletChanged(userId) {
    const info = payments.walletInfo(userId);
    for (const sid of userSockets.get(userId) || []) sendTo(sid, 'wallet', info);
  }

  // ── Room services (called by Room) ────────────────────────────────────────
  function awardBp(p, amount, source) {
    if (amount <= 0) return;
    if (p.userId && stats.enabled) {
      const r = stats.addBpXp(p.userId, amount);
      if (!r) return;
      sendTo(p.socketId, 'bpState', { season: r.season, xp: r.xp, premium: r.premium, gained: amount, source, unlocks: stats.getUnlocks(p.userId) });
      if (r.earned.length) sendTo(p.socketId, 'achievements', r.earned);
    } else if (p.socketId) {
      sendTo(p.socketId, 'bpXp', { amount, source });
    }
  }
  const services = {
    onLifeEnd(room, p, life) {
      stats.addScore({ name: p.name, userId: p.userId, score: life.score, mode: room.mode, mapId: room.mapId });
      if (p.userId && stats.enabled) {
        const res = stats.recordLife(p.userId, life);
        if (res) {
          if (res.earned.length) sendTo(p.socketId, 'achievements', res.earned);
          sendTo(p.socketId, 'profile', { stats: res.stats, achievements: res.achievements });
        }
      }
      if (life.reason !== 'cashout') awardBp(p, Math.floor(life.score / 5) + life.kills * 10, 'game');
    },
    onPowerup(room, p, type) {
      if (!p.userId || !stats.enabled) return;
      const earned = stats.onPowerup(p.userId, type);
      if (earned.length) sendTo(p.socketId, 'achievements', earned);
    },
    onTeamWin(room, winners) {
      for (const p of winners) {
        if (!p.userId || !stats.enabled) continue;
        const earned = stats.onTeamWin(p.userId);
        if (earned.length) sendTo(p.socketId, 'achievements', earned);
      }
    },
    onRankedEnd(room, placements) {
      if (!stats.enabled) return;
      const results = stats.applyElo(placements.map(p => ({ userId: p.userId })));
      results.forEach((r, i) => sendTo(placements[i].socketId, 'eloResult', { change: r.change, elo: r.elo, rank: r.rank, place: i + 1 }));
    },
    onChallengeDone(room, p, ch) {
      if (p.userId && stats.enabled) {
        if (stats.isDailyDone(p.userId, ch.date)) return;
        stats.markDailyDone(p.userId, ch.date);
      }
      awardBp(p, 50, 'challenge');
    },
  };

  const net = {
    toSocket: sendTo,
    toRoom: (roomId, ev, data) => io.to(roomId).emit(ev, data),
  };
  manager.init({ net, services });

  // ── Profiles ───────────────────────────────────────────────────────────────
  function buildProfile(session, raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const user = session.userId ? accounts.getUser(session.userId) : null;
    let skin = U.cleanSkin(raw.skin);
    const sk = S.SKINS.find(s => s.id === skin);
    if (sk && sk.supporter && !(user && user.supporter) && !verifySupporterToken(raw.supporterToken)) skin = 'solid';
    let cosmetics = null;
    let emotes = S.BASE_EMOTES;
    if (user && stats.enabled) {
      const un = stats.getUnlocks(user.id);
      const c = raw.cosmetics && typeof raw.cosmetics === 'object' ? raw.cosmetics : {};
      cosmetics = {
        title: un.titles.includes(c.title) ? c.title : null,
        trail: un.trails.includes(c.trail) ? c.trail : null,
        border: un.borders.includes(c.border) ? c.border : null,
      };
      emotes = [...S.BASE_EMOTES, ...un.emotes.filter(e => !S.BASE_EMOTES.includes(e))].slice(0, 12);
    }
    return {
      name: user ? user.username : U.cleanName(raw.name),
      skin,
      customSkin: U.cleanCustomSkin(raw.customSkin),
      cosmetics,
      emotes,
    };
  }
  function cleanView(v) {
    if (!v || typeof v !== 'object') return { w: 1280, h: 800 };
    return { w: U.clamp(Number(v.w) || 1280, 320, 2560), h: U.clamp(Number(v.h) || 800, 320, 1600) };
  }

  // ── Room membership ────────────────────────────────────────────────────────
  function currentPlayer(session) {
    const room = session.roomId && manager.get(session.roomId);
    const p = room && room.players.get(session.pid);
    return room && p ? { room, p } : null;
  }

  function leaveCurrent(socket, session) {
    const cur = currentPlayer(session);
    if (cur) {
      if (cur.room.mode === 'arena') cur.p.socketId = null;
      else cur.room.removeHuman(cur.p);
      socket.leave(cur.room.id);
    }
    session.roomId = null;
    session.pid = null;
  }

  function enterRoom(socket, session, room, profile, view) {
    leaveCurrent(socket, session);
    const p = room.addHuman({ socketId: socket.id, userId: session.userId, profile, view: view || session.view });
    if (session.userId && stats.enabled && stats.isDailyDone(session.userId, getDailyChallenge().date)) p.challengeDone = getDailyChallenge().date;
    socket.join(room.id);
    session.roomId = room.id;
    session.pid = p.id;
    const info = room.joinInfo(p);
    info.inviteUrl = room.mode === 'arena' ? null : `${config.PUBLIC_URL}/?room=${room.id}`;
    if (room.mode === 'ranked' && session.userId) {
      const elo = stats.getElo(session.userId);
      info.elo = { elo, rank: stats.getRank(elo) };
    }
    if (room.mode === 'arena') info.arena = { currency: arena.currency, cashoutSeconds: config.ARENA_CASHOUT_SECONDS };
    socket.emit('joined', info);
    return p;
  }

  function canEnter(session, room, password) {
    if (!room || room.closed || room.mode === 'arena') return 'room_not_found';
    if (room.password && room.password !== String(password || '').trim()) return 'password_required';
    if (room.humanCount() >= config.MAX_PLAYERS_PER_ROOM) return 'room_full';
    if (room.mode === 'ranked' && !session.userId) return 'login_required';
    if (session.userId && arena.activeMatchRoom(session.userId)) return 'in_arena_match';
    return null;
  }

  // Arena bridge (arena controller → sockets).
  arena.setBridge({
    createArenaRoom: ({ matchId, tier, hooks }) => manager.createRoom({
      mode: 'arena', mapId: 'classic', name: `Arena ${S.formatMoney(tier.fee, arena.currency)} #${matchId}`, arena: hooks,
    }),
    addToRoom(room, entry) {
      const socket = io.sockets.sockets.get(entry.socketId);
      const session = socket && sessions.get(socket.id);
      if (socket && session) return enterRoom(socket, session, room, entry.profile);
      return room.addHuman({ socketId: null, userId: entry.userId, profile: entry.profile });
    },
    toSocket: sendTo,
    walletChanged,
  });

  function lobbyPayload(session) {
    return {
      rooms: manager.lobbyRooms(),
      leaderboards: stats.getLeaderboards(),
      challenge: getDailyChallenge(),
      arena: arena.lobbyInfo(),
      arenaStatus: session.userId ? arena.statusFor(session.userId) : { state: 'idle' },
      online: manager.stats().players,
      season: S.getSeason(),
    };
  }

  function authPayload(user, token) {
    const st = stats.enabled ? stats.getStats(user.id) : null;
    return {
      ok: true, token, username: user.username, userId: user.id,
      stats: st, achievements: stats.enabled ? stats.getAchievements(user.id) : [],
      supporter: !!user.supporter,
      bp: stats.enabled ? { ...stats.getBp(user.id), unlocks: stats.getUnlocks(user.id) } : null,
      compliance: { age: !!user.age_confirmed_at, terms: !!user.terms_accepted_at },
      excludedUntil: user.excluded_until ? user.excluded_until * 1000 : 0,
      elo: st ? { elo: st.elo || 1000, rank: stats.getRank(st.elo || 1000) } : null,
      wallet: payments.walletInfo(user.id),
    };
  }

  function bindUser(socket, session, user) {
    if (session.userId && session.userId !== user.id) unbindUser(socket, session);
    session.userId = user.id;
    if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
    userSockets.get(user.id).add(socket.id);
    arena.updateQueuedSocket(user.id, socket.id);
    // Reconnect to a running arena match.
    const room = arena.activeMatchRoom(user.id);
    if (room) {
      const p = [...room.players.values()].find(x => x.userId === user.id);
      if (p) {
        leaveCurrent(socket, session);
        p.socketId = socket.id;
        p.sentInfo = new Map();
        socket.join(room.id);
        session.roomId = room.id;
        session.pid = p.id;
        socket.emit('joined', { ...room.joinInfo(p), inviteUrl: null, arena: { currency: arena.currency, cashoutSeconds: config.ARENA_CASHOUT_SECONDS }, reconnected: true });
      }
    }
  }
  function unbindUser(socket, session) {
    if (!session.userId) return;
    const set = userSockets.get(session.userId);
    if (set) { set.delete(socket.id); if (!set.size) userSockets.delete(session.userId); }
    session.userId = null;
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  io.on('connection', socket => {
    const ip = U.clientIp(socket);
    const session = { userId: null, roomId: null, pid: null, view: { w: 1280, h: 800 }, ip };
    sessions.set(socket.id, session);

    // Wraps a handler with a rate limit and an exception guard.
    const on = (event, cap, perSec, fn) => {
      socket.on(event, (...args) => {
        if (!limiter.allow(socket.id + ':' + event, cap, perSec)) return;
        try {
          const r = fn(...args);
          if (r && typeof r.catch === 'function') r.catch(e => console.error(`Handler ${event} failed:`, e));
        } catch (e) { console.error(`Handler ${event} failed:`, e); }
      });
    };
    const notice = (code, extra) => socket.emit('notice', { code, ...extra });

    socket.emit('hello', { ...publicConfig(), achievements: stats.ACHIEVEMENTS, challenge: getDailyChallenge(), season: S.getSeason() });

    // ── Auth ──
    on('authRegister', 3, 0.2, async payload => {
      if (!limiter.allow('auth:' + ip, 8, 0.1)) return socket.emit('authResult', { ok: false, error: 'too_many_attempts' });
      const { username, password } = payload || {};
      const r = await accounts.register(username, password);
      if (!r.ok) return socket.emit('authResult', r);
      if (stats.enabled) stats.getStats(r.user.id);
      bindUser(socket, session, r.user);
      socket.emit('authResult', authPayload(r.user, makeSessionToken(r.user.id)));
    });
    on('authLogin', 5, 0.5, async payload => {
      const { username, password, token } = payload || {};
      if (token) {
        const uid = verifySessionToken(token);
        const user = uid && accounts.getUser(uid);
        if (!user || user.banned) return socket.emit('authResult', { ok: false, error: 'session_expired', silent: true });
        bindUser(socket, session, user);
        return socket.emit('authResult', authPayload(user, token));
      }
      if (!limiter.allow('auth:' + ip, 8, 0.1)) return socket.emit('authResult', { ok: false, error: 'too_many_attempts' });
      const r = await accounts.login(username, password);
      if (!r.ok) return socket.emit('authResult', r);
      bindUser(socket, session, r.user);
      socket.emit('authResult', authPayload(r.user, makeSessionToken(r.user.id)));
    });
    on('logout', 3, 0.5, () => { leaveCurrent(socket, session); unbindUser(socket, session); });

    // ── Lobby ──
    on('getLobby', 4, 1, () => socket.emit('lobby', lobbyPayload(session)));

    on('quickPlay', 3, 0.5, payload => {
      payload = payload || {};
      const mapId = S.MAPS[payload.mapId] ? payload.mapId : 'classic';
      if (session.userId && arena.activeMatchRoom(session.userId)) return notice('in_arena_match');
      const room = manager.quickPlayRoom(mapId);
      enterRoom(socket, session, room, buildProfile(session, payload.profile), cleanView(payload.view));
    });
    on('createRoom', 2, 0.2, payload => {
      payload = payload || {};
      if (manager.userRoomCount() >= config.MAX_ROOMS) return notice('too_many_rooms');
      const mode = S.MODES.includes(payload.mode) ? payload.mode : 'classic';
      if (mode === 'ranked' && !session.userId) return notice('login_required');
      const mapId = S.MAPS[payload.mapId] ? payload.mapId : 'classic';
      const profile = buildProfile(session, payload.profile);
      const roomName = U.filterText(U.cleanText(payload.roomName, 24)) || profile.name + "'s Room";
      const pw = U.cleanText(payload.password, 32) || null;
      const room = manager.createRoom({ mode, mapId, name: roomName, password: pw });
      enterRoom(socket, session, room, profile, cleanView(payload.view));
    });
    on('joinRoom', 4, 0.5, payload => {
      payload = payload || {};
      const room = manager.get(String(payload.roomId || ''));
      const err = canEnter(session, room, payload.password);
      if (err === 'password_required') return socket.emit('passwordRequired', { roomId: room.id, roomName: room.name, wrong: !!payload.password });
      if (err) return notice(err);
      enterRoom(socket, session, room, buildProfile(session, payload.profile), cleanView(payload.view));
    });
    on('leaveRoom', 4, 1, () => {
      const cur = currentPlayer(session);
      if (cur && cur.room.mode === 'arena' && cur.p.alive) return notice('arena_cashout_first');
      leaveCurrent(socket, session);
    });
    on('respawn', 4, 1, payload => {
      const cur = currentPlayer(session);
      if (!cur) return;
      cur.room.respawn(cur.p, buildProfile(session, payload && payload.profile));
    });

    // ── In game ──
    on('input', 80, 60, payload => {
      const cur = currentPlayer(session);
      if (!cur || !cur.p.alive || !payload) return;
      if (U.isFiniteNumber(payload.a)) cur.p.targetAngle = payload.a;
      cur.p.boosting = payload.b === true || payload.b === 1;
    });
    on('view', 4, 1, v => {
      session.view = cleanView(v);
      const cur = currentPlayer(session);
      if (cur) cur.p.view = session.view;
    });
    on('spectate', 6, 2, id => {
      const cur = currentPlayer(session);
      if (cur && typeof id === 'string') cur.p.spectateId = id.slice(0, 20);
    });
    on('emote', 3, 1, emoji => {
      const cur = currentPlayer(session);
      if (!cur || !cur.p.alive || !cur.p.emotes.includes(emoji)) return;
      cur.p.emote = emoji;
      cur.p.emoteTick = 0;
    });
    on('chat', 3, 0.7, msg => {
      const cur = currentPlayer(session);
      if (!cur) return;
      const clean = U.filterText(U.cleanText(msg, 80));
      if (!clean) return;
      io.to(cur.room.id).emit('chat', { n: cur.p.name, m: clean, c: cur.p.color });
    });
    on('cashout', 6, 2, payload => {
      const cur = currentPlayer(session);
      if (!cur || cur.room.mode !== 'arena') return;
      cur.p.cashoutHold = !!(payload && payload.on);
    });

    // ── Battle pass ──
    on('bp:premium', 3, 0.5, payload => {
      if (!session.userId || !stats.enabled) return;
      const bp = stats.setBpPremium(session.userId, !!(payload && payload.on));
      socket.emit('bpState', { ...bp, unlocks: stats.getUnlocks(session.userId) });
    });
    on('supporter:link', 3, 0.2, token => {
      if (!session.userId || !accounts.enabled || !verifySupporterToken(token)) return;
      accounts.setSupporter(session.userId);
      socket.emit('supporter', { linked: true });
    });

    // ── Arena & wallet ──
    on('arena:queue', 3, 0.5, payload => {
      payload = payload || {};
      const user = session.userId ? accounts.getUser(session.userId) : null;
      if (user && session.roomId) leaveCurrent(socket, session);
      const r = arena.queue({ user, tierId: String(payload.tierId || ''), socketId: socket.id, profile: buildProfile(session, payload.profile) });
      if (!r.ok) return notice(r.error);
      walletChanged(user.id);
    });
    on('arena:leave', 3, 0.5, () => {
      if (!session.userId) return;
      const r = arena.leaveQueue(session.userId);
      socket.emit('arena:status', arena.statusFor(session.userId));
      if (r.ok) walletChanged(session.userId);
    });
    on('wallet:get', 4, 1, () => { if (session.userId) socket.emit('wallet', payments.walletInfo(session.userId)); });
    on('wallet:faucet', 2, 0.2, () => {
      const r = payments.faucet(session.userId ? accounts.getUser(session.userId) : null);
      if (!r.ok) notice(r.error);
    });
    on('wallet:deposit', 2, 0.2, async payload => {
      const amount = Math.round(Number(payload && payload.amount) * S.MONEY_SCALE);
      const r = await payments.createDeposit(session.userId ? accounts.getUser(session.userId) : null, amount);
      if (!r.ok) return notice(r.error);
      socket.emit('depositUrl', { url: r.url });
    });
    on('wallet:withdraw', 2, 0.1, payload => {
      payload = payload || {};
      const amount = Math.round(Number(payload.amount) * S.MONEY_SCALE);
      const r = payments.requestWithdrawal(session.userId ? accounts.getUser(session.userId) : null, amount, String(payload.network || ''), payload.address);
      if (!r.ok) return notice(r.error);
      notice('withdrawal_requested');
    });
    on('account:compliance', 3, 0.5, payload => {
      if (!session.userId || !payload || payload.age !== true || payload.terms !== true) return;
      accounts.setCompliance(session.userId);
      socket.emit('compliance', { age: true, terms: true });
    });
    on('account:exclude', 2, 0.1, payload => {
      const days = Number(payload && payload.days);
      if (!session.userId || ![1, 7, 30, 180].includes(days)) return;
      const until = Math.floor(Date.now() / 1000) + days * 86400;
      accounts.setExcludedUntil(session.userId, until);
      if (arena.statusFor(session.userId).state === 'queued') arena.leaveQueue(session.userId);
      socket.emit('excluded', { until: until * 1000 });
      walletChanged(session.userId);
    });

    socket.on('disconnect', () => {
      leaveCurrent(socket, session);
      if (session.userId) {
        const uid = session.userId;
        unbindUser(socket, session);
        if (!userSockets.has(uid)) arena.onDisconnect(uid);
      }
      sessions.delete(socket.id);
    });
  });

  return { sessions, userSockets, walletChanged };
}

module.exports = { attachSockets };
