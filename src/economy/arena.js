'use strict';
const { TICK_RATE } = require('../../shared/constants');
const U = require('../util');
const { LedgerError, HOUSE_USER_ID } = require('./ledger');

// Paid "arena" matches.
//  - Players queue in a tier and pay the entry fee up front (refunded if they leave before start).
//  - When enough players are queued a countdown starts; everyone spawns at the same time,
//    with the same length, evenly spaced: nobody has an advantage at the start.
//  - The house keeps HOUSE_FEE_BPS of each entry; the rest is the player's "value".
//  - Killing a snake transfers its whole value to the killer. Deaths without a killer
//    (zone, self, wall) drop the value as gold orbs anyone can eat.
//  - A player can cash out at any time by holding the cash-out key for a few seconds.
//  - The match ends when one snake is left or the timer runs out; survivors get paid.
// Every value change is written to SQLite immediately so a crash can be settled on restart.

function splitEvenly(total, recipients) {
  // Integer split; the remainder goes one unit at a time to the first recipients.
  const n = recipients.length;
  if (!n || total <= 0) return recipients.map(() => 0);
  const base = Math.floor(total / n);
  let rest = total - base * n;
  return recipients.map(() => base + (rest-- > 0 ? 1 : 0));
}

function createArena({ db, ledger, config, stats }) {
  let bridge = null;
  const enabled = !!(db && ledger && config.ARENA_TIERS.length);
  const currency = config.CURRENCY;
  const tiers = config.ARENA_TIERS.map(t => {
    const rake = Math.floor((t.fee * config.HOUSE_FEE_BPS) / 10000);
    return { ...t, rake, value: t.fee - rake };
  });
  const tierById = Object.fromEntries(tiers.map(t => [t.id, t]));
  const forming = new Map(); // tierId -> { matchId, tier, entries: Map(userId -> entry), countdownAt }
  const running = new Map(); // matchId -> { matchId, tier, room, seq }
  const userState = new Map(); // userId -> { state: 'queued'|'playing', tierId, matchId }

  const q = enabled ? {
    insertMatch: db.prepare('INSERT INTO matches(tier_id,currency,entry_fee,rake,status) VALUES(?,?,?,?,?)'),
    setMatchStatus: db.prepare('UPDATE matches SET status=? WHERE id=?'),
    startMatch: db.prepare("UPDATE matches SET status='running', started_at=strftime('%s','now') WHERE id=?"),
    endMatch: db.prepare("UPDATE matches SET status='settled', orb_pool=0, end_reason=?, ended_at=strftime('%s','now') WHERE id=?"),
    addPool: db.prepare('UPDATE matches SET orb_pool=orb_pool+? WHERE id=?'),
    getMatch: db.prepare('SELECT * FROM matches WHERE id=?'),
    openMatches: db.prepare("SELECT * FROM matches WHERE status IN ('forming','running')"),
    insertPlayer: db.prepare("INSERT INTO match_players(match_id,user_id,name,status,value) VALUES(?,?,?,'queued',0)"),
    deletePlayer: db.prepare('DELETE FROM match_players WHERE match_id=? AND user_id=?'),
    setPlayer: db.prepare('UPDATE match_players SET status=?, value=?, kills=?, died_seq=? WHERE match_id=? AND user_id=?'),
    setValue: db.prepare('UPDATE match_players SET value=? WHERE match_id=? AND user_id=?'),
    setPayout: db.prepare('UPDATE match_players SET payout=payout+?, value=0, status=? WHERE match_id=? AND user_id=?'),
    players: db.prepare('SELECT * FROM match_players WHERE match_id=?'),
    activeForUser: db.prepare("SELECT mp.match_id, m.status FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE mp.user_id=? AND m.status IN ('forming','running') AND mp.status IN ('queued','alive')"),
  } : null;

  const now = () => Date.now();
  const matchTicks = config.ARENA_MATCH_SECONDS * TICK_RATE;
  const cashoutTicks = Math.max(1, Math.round(config.ARENA_CASHOUT_SECONDS * TICK_RATE));

  // ── Lobby info ─────────────────────────────────────────────────────────────
  function lobbyInfo() {
    return {
      enabled, currency, mode: config.PAYMENTS_MODE, houseFeeBps: config.HOUSE_FEE_BPS,
      min: config.ARENA_MIN_PLAYERS, max: config.ARENA_MAX_PLAYERS, matchSeconds: config.ARENA_MATCH_SECONDS,
      tiers: tiers.map(t => {
        const f = forming.get(t.id);
        let live = 0;
        for (const m of running.values()) if (m.tier.id === t.id) live++;
        return {
          id: t.id, fee: t.fee, value: t.value, rake: t.rake,
          waiting: f ? f.entries.size : 0,
          startsIn: f && f.countdownAt ? Math.max(0, Math.ceil((f.countdownAt - now()) / 1000)) : null,
          live,
        };
      }),
    };
  }

  function statusFor(userId) {
    const st = userState.get(userId);
    if (!st) return { state: 'idle' };
    if (st.state === 'queued') {
      const f = forming.get(st.tierId);
      return {
        state: 'queued', tierId: st.tierId, fee: tierById[st.tierId].fee,
        players: f ? f.entries.size : 0, min: config.ARENA_MIN_PLAYERS, max: config.ARENA_MAX_PLAYERS,
        startsIn: f && f.countdownAt ? Math.max(0, Math.ceil((f.countdownAt - now()) / 1000)) : null,
      };
    }
    return { state: 'playing', matchId: st.matchId };
  }

  function notifyQueue(tierId) {
    const f = forming.get(tierId);
    if (!f) return;
    for (const e of f.entries.values()) if (e.socketId) bridge.toSocket(e.socketId, 'arena:status', statusFor(e.userId));
  }

  // ── Queue ──────────────────────────────────────────────────────────────────
  function checkEligibility(user) {
    if (!enabled) return 'arena_disabled';
    if (!user) return 'login_required';
    if (user.banned) return 'banned';
    if (!user.age_confirmed_at || !user.terms_accepted_at) return 'compliance_required';
    if (user.excluded_until && user.excluded_until * 1000 > now()) return 'self_excluded';
    return null;
  }

  function queue({ user, tierId, socketId, profile }) {
    const err = checkEligibility(user);
    if (err) return { ok: false, error: err };
    const tier = tierById[tierId];
    if (!tier) return { ok: false, error: 'unknown_tier' };
    if (userState.has(user.id)) return { ok: false, error: 'already_in_arena' };
    let f = forming.get(tierId);
    if (f && f.entries.size >= config.ARENA_MAX_PLAYERS) return { ok: false, error: 'tier_full' };
    try {
      db.transaction(() => {
        if (!f) {
          const r = q.insertMatch.run(tierId, currency, tier.fee, tier.rake, 'forming');
          f = { matchId: Number(r.lastInsertRowid), tier, entries: new Map(), countdownAt: null };
        }
        ledger.apply(user.id, currency, -tier.fee, 'arena_entry', f.matchId);
        q.insertPlayer.run(f.matchId, user.id, profile.name);
      })();
    } catch (e) {
      if (e instanceof LedgerError) return { ok: false, error: e.code };
      throw e;
    }
    forming.set(tierId, f);
    f.entries.set(user.id, { userId: user.id, socketId, profile, joinedAt: now() });
    userState.set(user.id, { state: 'queued', tierId, matchId: f.matchId });
    if (f.entries.size >= config.ARENA_MIN_PLAYERS && !f.countdownAt) f.countdownAt = now() + config.ARENA_COUNTDOWN_SECONDS * 1000;
    if (f.entries.size >= config.ARENA_MAX_PLAYERS) f.countdownAt = Math.min(f.countdownAt || Infinity, now() + 3000);
    notifyQueue(tierId);
    return { ok: true, balance: ledger.balance(user.id, currency) };
  }

  function leaveQueue(userId) {
    const st = userState.get(userId);
    if (!st || st.state !== 'queued') return { ok: false, error: 'not_queued' };
    const f = forming.get(st.tierId);
    db.transaction(() => {
      ledger.apply(userId, currency, f.tier.fee, 'arena_refund', f.matchId);
      q.deletePlayer.run(f.matchId, userId);
    })();
    f.entries.delete(userId);
    userState.delete(userId);
    if (f.entries.size < config.ARENA_MIN_PLAYERS) f.countdownAt = null;
    if (!f.entries.size) { q.setMatchStatus.run('cancelled', f.matchId); forming.delete(st.tierId); }
    notifyQueue(st.tierId);
    return { ok: true, balance: ledger.balance(userId, currency) };
  }

  // Called every second.
  function tick() {
    for (const [tierId, f] of forming) {
      if (f.countdownAt && now() >= f.countdownAt && f.entries.size >= config.ARENA_MIN_PLAYERS) startMatch(tierId);
      else if (f.countdownAt) notifyQueue(tierId);
    }
  }

  function startMatch(tierId) {
    const f = forming.get(tierId);
    forming.delete(tierId);
    const entries = [...f.entries.values()];
    db.transaction(() => {
      q.startMatch.run(f.matchId);
      ledger.apply(HOUSE_USER_ID, currency, f.tier.rake * entries.length, 'arena_rake', f.matchId);
      for (const e of entries) q.setPlayer.run('alive', f.tier.value, 0, 0, f.matchId, e.userId);
    })();
    const m = { matchId: f.matchId, tier: f.tier, currency, room: null, seq: 0, settled: false };
    running.set(f.matchId, m);
    const hooks = makeRoomHooks(m, entries.length);
    m.room = bridge.createArenaRoom({ matchId: f.matchId, tier: f.tier, hooks });
    for (const e of entries) {
      userState.set(e.userId, { state: 'playing', matchId: f.matchId });
      const p = bridge.addToRoom(m.room, e);
      p.value = f.tier.value;
      p.matchUserId = e.userId;
    }
    m.room.startArena(3);
    for (const e of entries) if (e.socketId) bridge.toSocket(e.socketId, 'arena:status', statusFor(e.userId));
  }

  // ── In-match hooks used by the Room ───────────────────────────────────────
  function makeRoomHooks(m, capacity) {
    const hooks = {
      capacity,
      matchTicks,
      cashoutTicks,
      onDeath(room, victim, killer) {
        if (victim.cashedOut || m.settled) return 0;
        const amount = victim.value;
        victim.value = 0;
        m.seq = room.tickCount;
        if (killer && killer.kind === 'human' && killer.alive) {
          killer.value += amount;
          db.transaction(() => {
            q.setPlayer.run('dead', 0, victim.killCount, m.seq, m.matchId, victim.userId);
            q.setPlayer.run('alive', killer.value, killer.killCount, 0, m.matchId, killer.userId);
          })();
          room.emitTo(killer, 'valueGain', { a: amount, from: victim.name });
        } else if (amount > 0) {
          const n = U.clamp(Math.round(victim.segs.length / 8), 3, 12);
          const parts = splitEvenly(amount, Array.from({ length: n }));
          const step = Math.max(1, Math.floor(victim.segs.length / n));
          parts.forEach((v, i) => {
            if (v <= 0) return;
            const s = victim.segs[Math.min(victim.segs.length - 1, i * step)] || victim.lastPos;
            room.orbs.push({ id: 'o' + m.matchId + '_' + room.tickCount + '_' + i, x: s.x + (Math.random() - 0.5) * 30, y: s.y + (Math.random() - 0.5) * 30, v });
          });
          db.transaction(() => {
            q.setPlayer.run('dead', 0, victim.killCount, m.seq, m.matchId, victim.userId);
            q.addPool.run(amount, m.matchId);
          })();
        } else {
          q.setPlayer.run('dead', 0, victim.killCount, m.seq, m.matchId, victim.userId);
        }
        return amount;
      },
      onOrb(room, p, orb) {
        if (m.settled) return;
        p.value += orb.v;
        db.transaction(() => {
          q.addPool.run(-orb.v, m.matchId);
          q.setValue.run(p.value, m.matchId, p.userId);
        })();
        room.emitTo(p, 'valueGain', { a: orb.v, from: null });
      },
      onCashout(room, p) {
        if (m.settled || room.phase !== 'playing' || !p.alive) return;
        const payout = p.value;
        m.seq = room.tickCount;
        db.transaction(() => {
          if (payout > 0) ledger.apply(p.userId, m.currency, payout, 'arena_payout', m.matchId);
          q.setPayout.run(payout, 'cashed_out', m.matchId, p.userId);
          q.setPlayer.run('cashed_out', 0, p.killCount, m.seq, m.matchId, p.userId);
        })();
        p.cashedOut = true;
        p.value = 0;
        room.killSnake(p, { reason: 'cashout', silent: true });
        stats.addArenaResult(p.userId, payout - m.tier.fee);
        userState.delete(p.userId);
        room.emitTo(p, 'arena:result', { matchId: m.matchId, payout, fee: m.tier.fee, profit: payout - m.tier.fee, reason: 'cashout', currency: m.currency });
        bridge.walletChanged(p.userId);
      },
      onEnd(room, reason) { return settle(m, reason); },
    };
    return hooks;
  }

  // Pays survivors their value and distributes uncollected orbs. Idempotent.
  function settle(m, reason) {
    if (m.settled) return null;
    m.settled = true;
    const room = m.room;
    const rows = q.players.all(m.matchId);
    const match = q.getMatch.get(m.matchId);
    const alive = rows.filter(r => r.status === 'alive').sort((a, b) => a.user_id - b.user_id);
    // Leftover orbs go to whoever is still alive, else to the players who left the match last.
    let recipients = alive;
    if (!recipients.length) {
      const lastSeq = Math.max(0, ...rows.map(r => r.died_seq));
      recipients = rows.filter(r => r.died_seq === lastSeq && (r.status === 'dead' || r.status === 'cashed_out')).sort((a, b) => a.user_id - b.user_id);
    }
    const shares = splitEvenly(match.orb_pool, recipients);
    const payouts = new Map(alive.map(r => [r.user_id, r.value]));
    recipients.forEach((r, i) => payouts.set(r.user_id, (payouts.get(r.user_id) || 0) + shares[i]));
    db.transaction(() => {
      for (const [userId, amount] of payouts) {
        if (amount > 0) ledger.apply(userId, match.currency, amount, 'arena_payout', m.matchId);
        const row = rows.find(r => r.user_id === userId);
        q.setPayout.run(amount, row.status === 'alive' ? 'paid' : row.status, m.matchId, userId);
      }
      q.endMatch.run(reason, m.matchId);
    })();

    const final = q.players.all(m.matchId);
    const ranking = final.map(r => ({ name: r.name, payout: r.payout, kills: r.kills, status: r.status }))
      .sort((a, b) => b.payout - a.payout || b.kills - a.kills);
    for (const r of final) {
      const wasCashout = r.status === 'cashed_out';
      if (!wasCashout) stats.addArenaResult(r.user_id, r.payout - m.tier.fee);
      userState.delete(r.user_id);
      const p = room && [...room.players.values()].find(x => x.userId === r.user_id);
      if (room && p && p.socketId) {
        room.emitTo(p, 'arena:result', {
          matchId: m.matchId, payout: r.payout, fee: m.tier.fee, profit: r.payout - m.tier.fee,
          reason, ranking, currency: match.currency, final: true,
        });
      }
      bridge.walletChanged(r.user_id);
    }
    running.delete(m.matchId);
    return { reason, ranking };
  }

  // ── Crash recovery & shutdown ──────────────────────────────────────────────
  function recover() {
    if (!enabled) return { refunded: 0, settled: 0 };
    let refunded = 0, settled = 0;
    for (const match of q.openMatches.all()) {
      if (match.status === 'forming') {
        db.transaction(() => {
          for (const r of q.players.all(match.id)) {
            ledger.apply(r.user_id, match.currency, match.entry_fee, 'arena_refund', match.id);
            q.deletePlayer.run(match.id, r.user_id);
            refunded++;
          }
          q.setMatchStatus.run('cancelled', match.id);
        })();
      } else {
        settle({ matchId: match.id, tier: { id: match.tier_id, fee: match.entry_fee }, room: null, seq: 0, settled: false }, 'recovered');
        settled++;
      }
    }
    return { refunded, settled };
  }

  function shutdown() {
    if (!enabled) return;
    for (const f of [...forming.values()]) for (const userId of [...f.entries.keys()]) leaveQueue(userId);
    for (const m of [...running.values()]) settle(m, 'shutdown');
  }

  function onDisconnect(userId) {
    const st = userState.get(userId);
    if (st && st.state === 'queued') leaveQueue(userId);
  }
  // Re-attaches a reconnecting player to their running match, if any.
  function activeMatchRoom(userId) {
    const st = userState.get(userId);
    if (!st || st.state !== 'playing') return null;
    const m = running.get(st.matchId);
    return m && m.room && !m.room.closed ? m.room : null;
  }
  function updateQueuedSocket(userId, socketId) {
    const st = userState.get(userId);
    if (!st || st.state !== 'queued') return;
    const e = forming.get(st.tierId)?.entries.get(userId);
    if (e) e.socketId = socketId;
  }

  return {
    setBridge: b => { bridge = b; },
    enabled, currency, tiers, lobbyInfo, statusFor, queue, leaveQueue, tick, recover, shutdown,
    onDisconnect, activeMatchRoom, updateQueuedSocket, splitEvenly,
    _running: running, _forming: forming,
  };
}

module.exports = { createArena, splitEvenly };
