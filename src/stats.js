'use strict';
const { getSeason, bpTier, TICK_RATE, BP_TIERS } = require('../shared/constants');
const { isoWeekKey } = require('./util');

const ACHIEVEMENTS = [
  { id: 'first_blood', icon: '🩸', name: 'First Blood', desc: 'Get your first kill' },
  { id: 'hatchling', icon: '🐣', name: 'Hatchling', desc: 'Reach a score of 50' },
  { id: 'serpent', icon: '🐍', name: 'Serpent', desc: 'Reach a score of 150' },
  { id: 'titan', icon: '🦕', name: 'Titan', desc: 'Reach a score of 300' },
  { id: 'speed_demon', icon: '⚡', name: 'Speed Demon', desc: 'Collect 5 speed power-ups' },
  { id: 'survivor', icon: '⏱', name: 'Survivor', desc: 'Stay alive for 3 minutes in one life' },
  { id: 'glutton', icon: '🍎', name: 'Glutton', desc: 'Eat 100 food items total' },
  { id: 'predator', icon: '💀', name: 'Predator', desc: 'Get 10 kills total' },
  { id: 'apex', icon: '👑', name: 'Apex', desc: 'Get 50 kills total' },
  { id: 'pacifist', icon: '🐢', name: 'Pacifist Run', desc: 'Score 80 without boosting' },
  { id: 'power_hungry', icon: '🔋', name: 'Power Hungry', desc: 'Collect 50 power-ups total' },
  { id: 'explorer', icon: '🗺️', name: 'Explorer', desc: 'Play on all 4 maps' },
  { id: 'veteran', icon: '🎖', name: 'Veteran', desc: 'Play 25 games' },
  { id: 'centurion', icon: '💯', name: 'Centurion', desc: 'Play 100 games' },
  { id: 'ranked_player', icon: '🏅', name: 'Ranked Player', desc: 'Play a ranked game' },
  { id: 'team_player', icon: '🤝', name: 'Team Player', desc: 'Win a teams game' },
  { id: 'ghost_rider', icon: '👻', name: 'Ghost Rider', desc: 'Collect the ghost power-up 5 times' },
  { id: 'chain_killer', icon: '🔥', name: 'Chain Killer', desc: 'Get 3 kills in a single life' },
  { id: 'comeback', icon: '💪', name: 'Comeback', desc: 'Drop below length 30 after reaching 60, then score 100', secret: true },
  { id: 'season1', icon: '🎫', name: 'Season Veteran', desc: 'Reach tier 10 in a Battle Pass season' },
];
const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

const STAT_COLUMNS = new Set([
  'games', 'best_score', 'total_kills', 'total_food', 'best_level', 'total_xp', 'maps_played',
  'powerups_collected', 'ghost_count', 'ranked_games', 'teams_wins', 'max_kills_game', 'total_survive_ticks',
  'speed_count', 'max_survive_ticks', 'elo', 'elo_games', 'elo_wins', 'bp_season', 'bp_xp', 'bp_premium',
  'daily_done', 'arena_games', 'arena_profit',
]);
const ELO_K = 32;
const RANK_TIERS = [
  { name: 'Bronze', min: 0, color: '#cd7f32' },
  { name: 'Silver', min: 1000, color: '#c0c0c0' },
  { name: 'Gold', min: 1200, color: '#ffd700' },
  { name: 'Platinum', min: 1400, color: '#00e5ff' },
  { name: 'Diamond', min: 1600, color: '#b39ddb' },
];
function getRank(elo) {
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) if (elo >= RANK_TIERS[i].min) return RANK_TIERS[i];
  return RANK_TIERS[0];
}

// Pairwise Elo for a free-for-all round. `results` is ordered best place first.
function computeElo(results) {
  const n = results.length;
  if (n < 2) return results.map(r => ({ ...r, change: 0 }));
  const k = ELO_K / (n - 1);
  const changes = results.map(() => 0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ea = 1 / (1 + Math.pow(10, (results[j].elo - results[i].elo) / 400));
      changes[i] += k * (1 - ea);
      changes[j] -= k * (1 - ea);
    }
  }
  return results.map((r, i) => ({ ...r, change: Math.round(changes[i]) }));
}

function createStats(db) {
  const enabled = !!db;

  // ── Leaderboards (SQLite, with an in-memory fallback) ─────────────────────
  const mem = { scores: [] };
  let lbCache = null, lbDirty = true, lbAt = 0;

  function computeLeaderboards() {
    const week = isoWeekKey();
    if (!enabled) {
      const best = new Map();
      for (const s of mem.scores) if (!best.has(s.name) || best.get(s.name).score < s.score) best.set(s.name, s);
      const all = [...best.values()].sort((a, b) => b.score - a.score);
      const weekly = all.filter(s => s.week_key === week).slice(0, 10);
      return { global: all.slice(0, 10), weekly, hallOfFame: [], week };
    }
    const global = db.prepare(`SELECT name, MAX(score) AS score FROM scores GROUP BY COALESCE(user_id, 'g:' || name) ORDER BY score DESC LIMIT 10`).all();
    const weekly = db.prepare(`SELECT name, MAX(score) AS score FROM scores WHERE week_key=? GROUP BY COALESCE(user_id, 'g:' || name) ORDER BY score DESC LIMIT 10`).all(week);
    const weeks = db.prepare(`SELECT DISTINCT week_key FROM scores WHERE week_key < ? ORDER BY week_key DESC LIMIT 5`).all(week).map(r => r.week_key);
    const hallOfFame = weeks.map(w => ({
      week: w,
      entries: db.prepare(`SELECT name, MAX(score) AS score FROM scores WHERE week_key=? GROUP BY COALESCE(user_id, 'g:' || name) ORDER BY score DESC LIMIT 3`).all(w),
    }));
    return { global, weekly, hallOfFame, week };
  }

  function getLeaderboards() {
    const now = Date.now();
    if (!lbCache || (lbDirty && now - lbAt > 2000) || now - lbAt > 60000) {
      lbCache = computeLeaderboards();
      lbAt = now; lbDirty = false;
    }
    return lbCache;
  }

  function addScore({ name, userId, score, mode, mapId }) {
    if (score < 30) return;
    const week = isoWeekKey();
    if (enabled) db.prepare('INSERT INTO scores(user_id,name,score,mode,map_id,week_key) VALUES(?,?,?,?,?,?)').run(userId || null, name, score, mode, mapId, week);
    else { mem.scores.push({ name, score, week_key: week }); if (mem.scores.length > 500) mem.scores.splice(0, 100); }
    lbDirty = true;
  }

  if (!enabled) {
    return {
      enabled, ACHIEVEMENTS, getRank, computeElo,
      getLeaderboards, addScore,
      getStats: () => null, getAchievements: () => [], recordLife: () => null,
      onPowerup: () => [], onTeamWin: () => [], getBp: () => null, addBpXp: () => null, setBpPremium: () => null, getUnlocks: () => null,
      isDailyDone: () => false, markDailyDone: () => {}, applyElo: () => [], getElo: () => 1000, addArenaResult: () => {},
    };
  }

  const q = {
    getStats: db.prepare('SELECT * FROM stats WHERE user_id=?'),
    initStats: db.prepare('INSERT OR IGNORE INTO stats(user_id) VALUES(?)'),
    getAch: db.prepare('SELECT achievement_id FROM achievements WHERE user_id=?'),
    unlock: db.prepare('INSERT OR IGNORE INTO achievements(user_id,achievement_id) VALUES(?,?)'),
  };

  function getStats(userId) {
    let s = q.getStats.get(userId);
    if (!s) { q.initStats.run(userId); s = q.getStats.get(userId); }
    return s;
  }
  function saveStats(userId, patch) {
    const keys = Object.keys(patch).filter(k => STAT_COLUMNS.has(k));
    if (!keys.length) return;
    db.prepare(`UPDATE stats SET ${keys.map(k => `${k}=?`).join(',')} WHERE user_id=?`).run(...keys.map(k => patch[k]), userId);
  }
  const getAchievements = userId => q.getAch.all(userId).map(r => r.achievement_id);

  // Unlocks every achievement whose condition holds; returns the new definitions.
  function checkAchievements(userId, s, life) {
    const have = new Set(getAchievements(userId));
    const earned = [];
    const tryUnlock = id => { if (!have.has(id) && q.unlock.run(userId, id).changes > 0) earned.push(ACH_BY_ID[id]); };
    if (s.total_kills >= 1) tryUnlock('first_blood');
    if (s.total_kills >= 10) tryUnlock('predator');
    if (s.total_kills >= 50) tryUnlock('apex');
    if (s.max_kills_game >= 3) tryUnlock('chain_killer');
    if (s.best_score >= 50) tryUnlock('hatchling');
    if (s.best_score >= 150) tryUnlock('serpent');
    if (s.best_score >= 300) tryUnlock('titan');
    if (s.total_food >= 100) tryUnlock('glutton');
    if (s.powerups_collected >= 50) tryUnlock('power_hungry');
    if (s.ghost_count >= 5) tryUnlock('ghost_rider');
    if (s.speed_count >= 5) tryUnlock('speed_demon');
    if (s.games >= 25) tryUnlock('veteran');
    if (s.games >= 100) tryUnlock('centurion');
    if (s.ranked_games >= 1) tryUnlock('ranked_player');
    if (s.teams_wins >= 1) tryUnlock('team_player');
    if (s.max_survive_ticks >= TICK_RATE * 180) tryUnlock('survivor');
    if (s.bp_season === getSeason().number && bpTier(s.bp_xp) >= 10) tryUnlock('season1');
    try { if (Object.keys(JSON.parse(s.maps_played || '{}')).length >= 4) tryUnlock('explorer'); } catch (e) { /* ignore */ }
    if (life) {
      if (life.pacifist && life.score >= 80) tryUnlock('pacifist');
      if (life.comeback) tryUnlock('comeback');
    }
    return earned;
  }

  function recordLife(userId, life) {
    const st = getStats(userId);
    let maps = {};
    try { maps = JSON.parse(st.maps_played || '{}'); } catch (e) { /* ignore */ }
    if (life.mapId) maps[life.mapId] = (maps[life.mapId] || 0) + 1;
    const patch = {
      games: st.games + 1,
      best_score: Math.max(st.best_score, life.score),
      total_kills: st.total_kills + life.kills,
      total_food: st.total_food + life.food,
      best_level: Math.max(st.best_level, life.level || 1),
      total_xp: st.total_xp + (life.xp || 0),
      maps_played: JSON.stringify(maps),
      max_kills_game: Math.max(st.max_kills_game, life.kills),
      total_survive_ticks: st.total_survive_ticks + life.surviveTicks,
      max_survive_ticks: Math.max(st.max_survive_ticks || 0, life.surviveTicks),
      ranked_games: st.ranked_games + (life.mode === 'ranked' ? 1 : 0),
    };
    saveStats(userId, patch);
    const merged = { ...st, ...patch };
    const earned = checkAchievements(userId, merged, life);
    return { stats: merged, achievements: getAchievements(userId), earned };
  }

  function onPowerup(userId, type) {
    const st = getStats(userId);
    const patch = { powerups_collected: st.powerups_collected + 1 };
    if (type === 'ghost_pu') patch.ghost_count = st.ghost_count + 1;
    if (type === 'speed') patch.speed_count = (st.speed_count || 0) + 1;
    saveStats(userId, patch);
    return checkAchievements(userId, { ...st, ...patch }, null);
  }
  function onTeamWin(userId) {
    const st = getStats(userId);
    const patch = { teams_wins: st.teams_wins + 1 };
    saveStats(userId, patch);
    return checkAchievements(userId, { ...st, ...patch }, null);
  }

  // ── Battle pass ────────────────────────────────────────────────────────────
  function getBp(userId) {
    const st = getStats(userId);
    const season = getSeason().number;
    if (st.bp_season !== season) {
      saveStats(userId, { bp_season: season, bp_xp: 0 });
      return { season, xp: 0, premium: !!st.bp_premium };
    }
    return { season, xp: st.bp_xp, premium: !!st.bp_premium };
  }
  // Cosmetics stay unlocked forever, even after the season rolls over.
  const KIND = { t: 'titles', r: 'trails', b: 'borders', e: 'emotes' };
  const insertUnlock = db.prepare('INSERT OR IGNORE INTO unlocks(user_id,kind,value) VALUES(?,?,?)');
  function unlockTiers(userId, fromTier, toTier, premium) {
    for (let t = fromTier + 1; t <= Math.min(toTier, BP_TIERS.length); t++) {
      const [free, prem] = BP_TIERS[t - 1];
      insertUnlock.run(userId, KIND[free.t], free.v);
      if (premium && prem) insertUnlock.run(userId, KIND[prem.t], prem.v);
    }
  }
  function getUnlocks(userId) {
    const out = { titles: [], trails: [], borders: [], emotes: [] };
    for (const r of db.prepare('SELECT kind, value FROM unlocks WHERE user_id=?').all(userId)) if (out[r.kind]) out[r.kind].push(r.value);
    return out;
  }
  function addBpXp(userId, amount) {
    const bp = getBp(userId);
    const before = bpTier(bp.xp);
    const xp = bp.xp + Math.max(0, Math.floor(amount));
    saveStats(userId, { bp_xp: xp });
    const after = bpTier(xp);
    if (after > before) unlockTiers(userId, before, after, bp.premium);
    const earned = after >= 10 && before < 10 ? checkAchievements(userId, { ...getStats(userId) }, null) : [];
    return { season: bp.season, xp, premium: bp.premium, before, after, earned };
  }
  function setBpPremium(userId, on) {
    saveStats(userId, { bp_premium: on ? 1 : 0 });
    const bp = getBp(userId);
    if (on) unlockTiers(userId, 0, bpTier(bp.xp), true);
    return bp;
  }

  const isDailyDone = (userId, dateKey) => getStats(userId).daily_done === dateKey;
  const markDailyDone = (userId, dateKey) => saveStats(userId, { daily_done: dateKey });

  // ── Ranked ─────────────────────────────────────────────────────────────────
  const getElo = userId => getStats(userId).elo || 1000;
  // `placements` ordered best first: [{userId, ...}]
  function applyElo(placements) {
    const withElo = placements.map(p => ({ ...p, elo: getElo(p.userId) }));
    const out = computeElo(withElo);
    db.transaction(() => {
      out.forEach((r, i) => {
        const st = getStats(r.userId);
        saveStats(r.userId, {
          elo: Math.max(0, r.elo + r.change),
          elo_games: (st.elo_games || 0) + 1,
          elo_wins: (st.elo_wins || 0) + (i === 0 ? 1 : 0),
        });
      });
    })();
    return out.map(r => ({ userId: r.userId, change: r.change, elo: Math.max(0, r.elo + r.change), rank: getRank(Math.max(0, r.elo + r.change)) }));
  }

  function addArenaResult(userId, profit) {
    const st = getStats(userId);
    saveStats(userId, { arena_games: (st.arena_games || 0) + 1, arena_profit: (st.arena_profit || 0) + profit });
  }

  return {
    enabled, ACHIEVEMENTS, getRank, computeElo, getLeaderboards, addScore,
    getStats, getAchievements, recordLife, onPowerup, onTeamWin,
    getBp, addBpXp, setBpPremium, getUnlocks, isDailyDone, markDailyDone, getElo, applyElo, addArenaResult,
  };
}

module.exports = { createStats, ACHIEVEMENTS, getRank, computeElo };
