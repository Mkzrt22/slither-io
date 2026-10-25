'use strict';
const S = require('../../shared/constants');
const U = require('../util');
const { MAPS, arenaMap } = require('./maps');
const { updateBot } = require('./bots');
const { getDailyChallenge, freshChallengeState, challengeValue } = require('./challenges');

const { TICK_RATE: SEC, INIT_SEGS, FLAGS, LEVEL_ABILITIES, POWERUP_TYPES, zoomForLength, getLevel } = S;

const SEG_R = 9;
const MOVE_SPEED = 2.8;
const BOOST_SPEED = 5.2;
const TURN_SPEED = 0.13;
const BOOST_SHRINK_INTERVAL = 8;
const POWERUP_TARGET = 10;
const PORTAL_PAIRS = 3;
const ZONE_DAMAGE_TICK = 4;
const SCORE_WIN = 200;
const TEAM_WIN = 600;
const POWERUP_DURATIONS = { speed: 5 * SEC, shield: 4 * SEC, magnet: 8 * SEC, freeze: 4 * SEC, clone: 6 * SEC, ghost_pu: 5 * SEC };
const TEAM_COLORS = { red: '#FF4757', blue: '#1E90FF' };
const BOT_NAMES = ['Slinky', 'Viper', 'Cobra', 'Mamba', 'Rattler', 'Anaconda', 'Fangs', 'Bolt', 'Slick', 'Coil', 'Hydra', 'Fang', 'Nyx', 'Zed'];
const EVENT_INTERVAL = 120 * SEC;
const EVENT_DURATION = { meteor: 200, blizzard: 350, eruption: 220, surge: 120 };
const BOT_FILL_TARGET = 8;
const ROYALE_PARTICIPANTS = 6;
const REPLAY_TICKS = 3 * SEC;

const BASE = { respawn: true, bots: 'fill', zone: false, rounds: null, powerups: true, portals: true, obstacles: true, events: true, abilities: true, protect: 40 };
const RULES = {
  classic: { ...BASE },
  score: { ...BASE, rounds: 'score' },
  teams: { ...BASE, rounds: 'teams' },
  royale: { ...BASE, respawn: false, bots: 'royale', zone: true, rounds: 'lms', minHumans: 1, protect: 50, roundSeconds: 240 },
  ranked: { ...BASE, respawn: false, bots: 'none', zone: true, rounds: 'lms', minHumans: 2, events: false, protect: 50, roundSeconds: 240, elo: true },
  arena: { ...BASE, respawn: false, bots: 'none', zone: true, rounds: 'arena', powerups: false, portals: false, obstacles: false, events: false, abilities: false, protect: 3 * SEC },
};

let nextEntityId = 1;
const newId = prefix => prefix + (nextEntityId++).toString(36);

function wrapPos(v, size) { return ((v % size) + size) % size; }

class Room {
  constructor({ id, name, mode = 'classic', mapId = 'classic', isPublic = false, password = null, net, services = {}, arena = null }) {
    this.id = id;
    this.mode = RULES[mode] ? mode : 'classic';
    this.rules = RULES[this.mode];
    this.name = name || 'Room ' + id;
    this.isPublic = isPublic;
    this.password = password;
    this.net = net;
    this.svc = services;
    this.arena = arena;
    this.map = this.mode === 'arena' ? arenaMap(mapId, arena ? arena.capacity : 10) : (MAPS[mapId] || MAPS.classic);
    this.mapId = this.map.id;
    this.W = this.map.W;
    this.H = this.map.H;

    this.players = new Map(); // humans, keyed by player id
    this.bots = new Map();
    this.clones = new Map();
    this.food = [];
    this.powerups = [];
    this.obstacles = [];
    this.portals = [];
    this.orbs = [];
    this.zone = null;
    this.activeEvent = null;
    this.eventCooldown = 0;
    this.tickCount = 0;
    this.teamScores = { red: 0, blue: 0 };
    this.phase = 'playing';
    this.phaseTicks = 0;
    this.roundTick = 0;
    this.round = 0;
    this.deathOrder = [];
    this.lastResult = null;
    this.closed = false;
    this.emptySince = Date.now();

    this.seedWorld();
    if (this.rules.rounds === 'lms') this.setPhase('waiting');
    if (this.rules.rounds === 'arena') this.setPhase('waiting');
    this.manageBots();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  humans() { return [...this.players.values()]; }
  humanCount() { return this.players.size; }
  connectedHumans() { return this.humans().filter(p => p.socketId); }
  allSnakes() { return [...this.players.values(), ...this.bots.values()]; }
  aliveSnakes() { return this.allSnakes().filter(p => p.alive); }
  getSnake(id) { return this.players.get(id) || this.bots.get(id) || this.clones.get(id) || null; }
  isRoundMode() { return this.rules.rounds === 'lms' || this.rules.rounds === 'arena'; }
  wd2(a, b) { return U.wrapDist2(a, b, this.W, this.H); }

  emitTo(p, ev, data) { if (p && p.socketId && this.net) this.net.toSocket(p.socketId, ev, data); }
  emitAll(ev, data) { if (this.net) this.net.toRoom(this.id, ev, data); }

  setPhase(phase, ticks = 0) {
    this.phase = phase;
    this.phaseTicks = ticks;
  }

  // ── World ──────────────────────────────────────────────────────────────────
  mkFood(x, y, sz, color) {
    return { id: nextEntityId++, x: x ?? U.rnd(this.W), y: y ?? U.rnd(this.H), sz: sz ?? 4 + Math.random() * 6, color: color ?? U.pick(this.map.palette) };
  }
  mkPowerup() {
    return { id: nextEntityId++, x: 300 + U.rnd(this.W - 600), y: 300 + U.rnd(this.H - 600), type: U.pick(POWERUP_TYPES), r: 14 };
  }
  mkObstacle() {
    const r = 28 + U.rnd(46);
    return { id: nextEntityId++, x: 400 + U.rnd(this.W - 800), y: 400 + U.rnd(this.H - 800), r, vx: (Math.random() - 0.5) * 0.65, vy: (Math.random() - 0.5) * 0.65 };
  }
  seedWorld() {
    this.food = Array.from({ length: this.map.FOOD_TARGET }, () => this.mkFood());
    this.powerups = this.rules.powerups ? Array.from({ length: POWERUP_TARGET }, () => this.mkPowerup()) : [];
    this.obstacles = this.rules.obstacles ? Array.from({ length: this.map.OBSTACLE_COUNT }, () => this.mkObstacle()) : [];
    this.portals = [];
    if (this.rules.portals) {
      for (let i = 0; i < PORTAL_PAIRS; i++) {
        for (const which of ['a', 'b']) this.portals.push({ id: nextEntityId++, x: 300 + U.rnd(this.W - 600), y: 300 + U.rnd(this.H - 600), r: 22, pairIdx: i, which });
      }
    }
    this.orbs = [];
    this.resetZone();
  }
  resetZone() {
    if (!this.rules.zone) { this.zone = null; return; }
    const r = Math.hypot(this.W, this.H) / 2 + 100;
    this.zone = { x: this.W / 2, y: this.H / 2, r, startR: r, minR: this.mode === 'arena' ? 260 : 350 };
  }

  // Free spawn point far from other snake heads (and inside the zone if any).
  freeSpawnPoint() {
    const heads = this.aliveSnakes().map(s => s.segs[0]);
    let best = null, bestScore = -1;
    for (let i = 0; i < 12; i++) {
      let x, y;
      if (this.zone) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Math.max(100, this.zone.r - 250);
        x = U.clamp(this.zone.x + Math.cos(a) * r, 200, this.W - 200);
        y = U.clamp(this.zone.y + Math.sin(a) * r, 200, this.H - 200);
      } else {
        x = 400 + U.rnd(this.W - 800);
        y = 400 + U.rnd(this.H - 800);
      }
      let minD = Infinity;
      for (const h of heads) minD = Math.min(minD, this.wd2({ x, y }, h));
      for (const ob of this.obstacles) minD = Math.min(minD, this.wd2({ x, y }, ob) * 4);
      if (minD > bestScore) { bestScore = minD; best = { x, y, angle: Math.random() * Math.PI * 2 }; }
      if (minD > 600 * 600) break;
    }
    return best;
  }

  // Equal start: evenly spaced on a circle, all heading clockwise.
  circleSpawnPoints(n) {
    const out = [];
    const R = Math.min(this.W, this.H) * 0.33;
    const off = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      out.push({ x: this.W / 2 + Math.cos(a) * R, y: this.H / 2 + Math.sin(a) * R, angle: a + Math.PI / 2 });
    }
    return out;
  }

  // ── Snakes ─────────────────────────────────────────────────────────────────
  baseSnake(kind, profile) {
    return {
      id: newId(kind === 'bot' ? 'b' : 'p'),
      kind,
      socketId: null,
      userId: null,
      name: profile.name,
      color: profile.color || U.pick(this.map.palette),
      skin: profile.skin || 'solid',
      customSkin: profile.customSkin || null,
      cosmetics: profile.cosmetics || null,
      emotes: profile.emotes || S.BASE_EMOTES,
      team: null,
      alive: false,
      waiting: false,
      segs: [],
      infoVersion: 0,
      view: { w: 1280, h: 800 },
      sentInfo: new Map(),
      spectateId: null,
      lastPos: null,
      value: 0,
      cashoutHold: false,
      cashout: 0,
      ch: null,
      challengeDone: false,
      botWanderTick: 0, botState: 'forage', botDodgeTick: 0, respawnTick: 0,
    };
  }

  spawn(p, pos) {
    pos = pos || this.freeSpawnPoint();
    const segs = [];
    for (let i = 0; i < INIT_SEGS; i++) segs.push({ x: wrapPos(pos.x - Math.cos(pos.angle) * i * MOVE_SPEED, this.W), y: wrapPos(pos.y - Math.sin(pos.angle) * i * MOVE_SPEED, this.H) });
    if (this.mode === 'teams') {
      if (!p.team) p.team = this.pickTeam();
      p.color = TEAM_COLORS[p.team];
    }
    Object.assign(p, {
      alive: true, waiting: false, segs, angle: pos.angle, targetAngle: pos.angle,
      boosting: false, boostTick: 0, score: INIT_SEGS, killCount: 0,
      xp: 0, level: 1, abilities: [], secondWind: false,
      powerup: null, powerupTick: 0, powerupDuration: 0,
      zoneDamageTick: 0, zoneDeath: false, frozen: 0, portalCooldown: 0, cloneId: null,
      emote: null, emoteTick: 0, protect: this.rules.protect,
      spawnTick: this.tickCount, replayBuf: [], pacifist: true, foodEaten: 0,
      peakLen: INIT_SEGS, comebackArmed: false, comeback: false,
      cashout: 0, cashoutHold: false, diedTick: 0,
    });
    p.infoVersion++;
    if (p.kind === 'human') p.ch = freshChallengeState(this.tickCount);
    return p;
  }

  pickTeam() {
    let red = 0, blue = 0;
    for (const s of this.allSnakes()) { if (s.team === 'red') red++; else if (s.team === 'blue') blue++; }
    return red <= blue ? 'red' : 'blue';
  }

  addHuman({ socketId, userId, profile, view }) {
    const p = this.baseSnake('human', profile);
    p.socketId = socketId;
    p.userId = userId || null;
    if (view) p.view = view;
    this.players.set(p.id, p);
    this.emptySince = null;
    if (this.rules.rounds === 'lms') {
      if (this.phase === 'countdown') this.spawn(p);
      else p.waiting = true;
    } else if (this.rules.rounds === 'arena') {
      p.waiting = true; // spawned by startArena()
    } else {
      this.spawn(p);
    }
    this.manageBots();
    return p;
  }

  // Removes a human. Their body turns into food like any death, without a "died" event.
  removeHuman(p, reason = 'left') {
    if (!this.players.has(p.id)) return;
    if (p.alive) this.killSnake(p, { killer: null, reason, silent: true });
    this.players.delete(p.id);
    if (!this.players.size) this.emptySince = Date.now();
    this.manageBots();
  }

  respawn(p, profile) {
    if (!this.rules.respawn || p.alive || this.phase !== 'playing') return false;
    if (profile) Object.assign(p, { name: profile.name, skin: profile.skin, customSkin: profile.customSkin, cosmetics: profile.cosmetics, emotes: profile.emotes });
    this.spawn(p);
    return true;
  }

  addBot() {
    const used = new Set([...this.bots.values()].map(b => b.name));
    const name = (BOT_NAMES.find(n => !used.has(n + '_AI')) || U.pick(BOT_NAMES)) + '_AI';
    const b = this.baseSnake('bot', { name });
    this.bots.set(b.id, b);
    this.spawn(b);
    return b;
  }

  botTarget() {
    if (this.rules.bots === 'fill') return Math.max(0, BOT_FILL_TARGET - this.humanCount());
    return 0;
  }
  manageBots() {
    if (this.rules.bots !== 'fill') return;
    const target = this.botTarget();
    while (this.bots.size < target) this.addBot();
  }

  // ── Main tick ──────────────────────────────────────────────────────────────
  tick() {
    if (this.closed) return;
    // Idle rooms without humans do not simulate.
    if (!this.players.size && this.mode !== 'arena') return;
    this.tickCount++;
    this.updatePhase();
    if (this.phase === 'playing') {
      this.roundTick++;
      this.updateZone();
      if (this.rules.obstacles) this.tickObstacles();
      this.tickClones();
      if (this.rules.events) this.tickMapEvent();
      for (const b of this.bots.values()) {
        if (!b.alive) this.tickDeadBot(b);
        else updateBot(b, this);
      }
      this.moveAll();
      this.collide();
      this.tickChallenges();
      this.checkRoundEnd();
    }
    this.maintainWorld();
    this.broadcast();
  }

  tickDeadBot(b) {
    b.respawnTick++;
    if (b.respawnTick < 150) return;
    if (this.rules.respawn && this.bots.size <= this.botTarget()) { b.respawnTick = 0; this.spawn(b); }
    else this.bots.delete(b.id);
  }

  updateZone() {
    const z = this.zone;
    if (!z) return;
    const total = this.mode === 'arena' ? this.arena.matchTicks * 0.8 : 150 * SEC;
    const t = Math.min(1, this.roundTick / total);
    z.r = z.startR - (z.startR - z.minR) * t;
  }

  tickObstacles() {
    for (const ob of this.obstacles) {
      ob.x = wrapPos(ob.x + ob.vx, this.W);
      ob.y = wrapPos(ob.y + ob.vy, this.H);
      if (ob.x < 200 || ob.x > this.W - 200) ob.vx *= -1;
      if (ob.y < 200 || ob.y > this.H - 200) ob.vy *= -1;
    }
  }

  // ── Clones (decoy power-up) ───────────────────────────────────────────────
  spawnClone(p) {
    if (p.cloneId) return;
    const c = {
      id: newId('c'), kind: 'clone', name: p.name, color: p.color, skin: p.skin, customSkin: p.customSkin, cosmetics: null,
      team: p.team, segs: p.segs.map(s => ({ ...s })), angle: p.angle + 0.3, ownerId: p.id, cloneTick: 0,
      alive: true, level: p.level, score: 0, infoVersion: 1, boosting: false, powerup: null, emote: null,
    };
    this.clones.set(c.id, c);
    p.cloneId = c.id;
  }
  tickClones() {
    for (const c of this.clones.values()) {
      c.cloneTick++;
      if (Math.random() < 0.04) c.angle += (Math.random() - 0.5) * 0.4;
      const h = c.segs[0];
      c.segs.unshift({ x: wrapPos(h.x + Math.cos(c.angle) * MOVE_SPEED * 0.85, this.W), y: wrapPos(h.y + Math.sin(c.angle) * MOVE_SPEED * 0.85, this.H) });
      c.segs.pop();
      if (c.cloneTick > POWERUP_DURATIONS.clone) this.removeClone(c.id);
    }
  }
  removeClone(id) {
    const c = this.clones.get(id);
    if (!c) return;
    const owner = this.getSnake(c.ownerId);
    if (owner) owner.cloneId = null;
    this.clones.delete(id);
  }

  // ── Map events ─────────────────────────────────────────────────────────────
  startMapEvent() {
    const type = U.pick(this.map.events || ['surge']);
    const data = {};
    if (type === 'meteor') Object.assign(data, { x: U.rnd(this.W), y: U.rnd(this.H), vx: (Math.random() - 0.5) * 3.5, vy: (Math.random() - 0.5) * 3.5, r: 160 });
    else if (type === 'blizzard') data.speedMult = 0.58;
    else if (type === 'eruption') {
      data.lavaRocks = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, r = 380 + U.rnd(280);
        data.lavaRocks.push({ id: nextEntityId++, x: this.W / 2 + Math.cos(a) * r, y: this.H / 2 + Math.sin(a) * r, r: 48, vx: Math.cos(a) * 0.9, vy: Math.sin(a) * 0.9 });
      }
      this.obstacles.push(...data.lavaRocks);
    } else if (type === 'surge') {
      for (const p of this.aliveSnakes()) if (!p.powerup) Object.assign(p, { powerup: 'speed', powerupTick: 0, powerupDuration: 90 });
    }
    this.activeEvent = { type, tick: 0, duration: EVENT_DURATION[type] || 200, data };
    this.emitAll('mapEvent', { type, duration: this.activeEvent.duration });
  }
  tickMapEvent() {
    const ev = this.activeEvent;
    if (!ev) {
      if (++this.eventCooldown >= EVENT_INTERVAL) { this.eventCooldown = 0; this.startMapEvent(); }
      return;
    }
    ev.tick++;
    if (ev.type === 'meteor') {
      ev.data.x = wrapPos(ev.data.x + ev.data.vx, this.W);
      ev.data.y = wrapPos(ev.data.y + ev.data.vy, this.H);
      if (ev.tick % 8 === 0) {
        for (const p of this.aliveSnakes()) {
          if (p.powerup === 'shield' || p.powerup === 'ghost_pu' || p.protect > 0) continue;
          if (this.wd2(p.segs[0], ev.data) < ev.data.r * ev.data.r && p.segs.length > 8) this.shrink(p, 1, 5);
        }
      }
    }
    if (ev.tick >= ev.duration) {
      if (ev.data.lavaRocks) {
        const ids = new Set(ev.data.lavaRocks.map(r => r.id));
        this.obstacles = this.obstacles.filter(ob => !ids.has(ob.id));
      }
      this.activeEvent = null;
      this.eventCooldown = 0;
      this.emitAll('mapEvent', { type: 'end' });
    }
  }

  // Removes n tail segments, dropping them as food.
  shrink(p, n, foodSize) {
    for (let i = 0; i < n && p.segs.length > 1; i++) {
      const d = p.segs.pop();
      this.food.push(this.mkFood(d.x, d.y, foodSize, p.color));
    }
    p.score = Math.max(1, p.score - n);
  }

  gainXp(p, amount) {
    p.xp += amount;
    if (!this.rules.abilities) return;
    const nl = getLevel(p.xp);
    if (nl <= p.level) return;
    for (let l = p.level + 1; l <= nl; l++) {
      const ab = LEVEL_ABILITIES[l];
      if (!ab) continue;
      if (ab.id === 'second_wind') p.secondWind = true;
      else if (!p.abilities.includes(ab.id)) p.abilities.push(ab.id);
    }
    p.level = nl;
    if (p.kind === 'human') {
      this.emitTo(p, 'levelUp', { level: nl, ability: LEVEL_ABILITIES[nl] ? LEVEL_ABILITIES[nl].id : null });
      this.emitTo(p, 'sfx', 'levelup');
    }
  }

  // ── Movement, eating, pickups ──────────────────────────────────────────────
  moveAll() {
    const { W, H } = this;
    const blizzard = this.activeEvent && this.activeEvent.type === 'blizzard';
    const cashoutTicks = this.arena ? this.arena.cashoutTicks : 0;
    for (const p of this.aliveSnakes()) {
      if (p.protect > 0) p.protect--;
      if (p.frozen > 0) { p.frozen--; continue; }
      p.angle += U.clamp(U.angleDiff(p.angle, p.targetAngle), -TURN_SPEED, TURN_SPEED);
      const boosting = p.boosting && p.segs.length > INIT_SEGS + 2 && !(p.cashout > 0);
      let spd = boosting ? BOOST_SPEED : MOVE_SPEED;
      if (p.powerup === 'speed') spd *= 1.9;
      if (boosting && p.abilities.includes('fast_boost')) spd *= 1.2;
      if (blizzard && p.powerup !== 'ghost_pu') spd *= 0.58;
      if (p.powerup === 'ghost_pu') spd *= 1.12;

      const head = p.segs[0];
      const nx = wrapPos(head.x + Math.cos(p.angle) * spd, W);
      const ny = wrapPos(head.y + Math.sin(p.angle) * spd, H);
      p.segs.unshift({ x: nx, y: ny });
      p.segs.pop();
      p.visBoost = boosting;
      if (boosting) {
        if (p.kind === 'human') p.pacifist = false;
        if (++p.boostTick >= BOOST_SHRINK_INTERVAL) {
          p.boostTick = 0;
          // Boosting costs length: one tail segment becomes food.
          const d = p.segs.pop();
          this.food.push(this.mkFood(d.x, d.y, 6, p.color));
          p.score = Math.max(INIT_SEGS, p.score - 1);
        }
      }
      const nh = p.segs[0];

      if (p.powerup === 'magnet') {
        for (const f of this.food) if (U.dist2(nh, f) < 220 * 220) { f.x += (nx - f.x) * 0.07; f.y += (ny - f.y) * 0.07; }
      }
      if (p.kind === 'human') { p.replayBuf.push({ x: Math.round(nx), y: Math.round(ny) }); if (p.replayBuf.length > REPLAY_TICKS) p.replayBuf.shift(); }

      this.eatFood(p, nh);
      if (this.orbs.length) this.eatOrbs(p, nh);
      if (this.powerups.length) this.pickPowerups(p, nh);

      if (p.powerup && ++p.powerupTick >= p.powerupDuration) {
        p.powerup = null;
        if (p.cloneId) this.removeClone(p.cloneId);
      }
      if (this.portals.length) this.tryPortal(p);

      if (this.zone && U.dist(nh, this.zone) > this.zone.r && p.powerup !== 'ghost_pu' && p.powerup !== 'shield' && p.protect <= 0) {
        if (++p.zoneDamageTick >= ZONE_DAMAGE_TICK) {
          p.zoneDamageTick = 0;
          if (p.segs.length > 8) this.shrink(p, 1, 5);
          else p.zoneDeath = true;
        }
      } else p.zoneDamageTick = 0;

      if (p.emote && ++p.emoteTick > 3 * SEC) { p.emote = null; p.emoteTick = 0; }

      // Comeback tracking (secret achievement).
      p.peakLen = Math.max(p.peakLen, p.segs.length);
      if (p.peakLen >= 60 && p.segs.length < 30) p.comebackArmed = true;
      if (p.comebackArmed && p.score >= 100) p.comeback = true;

      // Arena cash-out: hold for N seconds without boosting.
      if (cashoutTicks && p.kind === 'human') {
        if (p.cashoutHold && !p.boosting) {
          if (++p.cashout >= cashoutTicks) this.arena.onCashout(this, p);
        } else p.cashout = 0;
      }
    }
  }

  eatFood(p, h) {
    const r = (SEG_R + 9) * (p.abilities.includes('wide_eat') ? 1.7 : 1);
    const r2 = r * r;
    let ate = false;
    for (let i = this.food.length - 1; i >= 0; i--) {
      const f = this.food[i];
      const dx = Math.abs(h.x - f.x), dy = Math.abs(h.y - f.y);
      if ((dx > r && this.W - dx > r) || (dy > r && this.H - dy > r)) continue;
      if (this.wd2(h, f) >= r2) continue;
      this.food[i] = this.food[this.food.length - 1];
      this.food.pop();
      const grow = Math.ceil(f.sz / 3);
      const tail = p.segs[p.segs.length - 1];
      for (let g = 0; g < grow; g++) p.segs.push({ x: tail.x, y: tail.y });
      p.score += grow;
      p.foodEaten++;
      this.gainXp(p, grow);
      if (p.kind === 'human' && p.ch) p.ch.food++;
      ate = true;
    }
    if (ate && p.kind === 'human') this.emitTo(p, 'sfx', 'eat');
  }

  eatOrbs(p, h) {
    if (p.kind !== 'human') return;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      if (this.wd2(h, o) < (SEG_R + 16) ** 2) {
        this.orbs.splice(i, 1);
        if (this.arena) this.arena.onOrb(this, p, o);
      }
    }
  }

  pickPowerups(p, h) {
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      if (this.wd2(h, pu) >= (SEG_R + pu.r) ** 2) continue;
      this.powerups.splice(i, 1);
      let dur = POWERUP_DURATIONS[pu.type] || 150;
      if (pu.type === 'shield' && p.abilities.includes('long_shield')) dur *= 2;
      Object.assign(p, { powerup: pu.type, powerupTick: 0, powerupDuration: dur });
      if (pu.type === 'freeze') {
        for (const o of this.aliveSnakes()) {
          if (o !== p && o.protect <= 0 && this.wd2(h, o.segs[0]) < 300 * 300) {
            o.frozen = Math.floor(dur * 0.7);
            if (o.kind === 'human') this.emitTo(o, 'sfx', 'freeze');
          }
        }
      }
      if (pu.type === 'clone') this.spawnClone(p);
      if (p.kind === 'human') {
        this.emitTo(p, 'sfx', 'powerup');
        this.emitTo(p, 'powerup', pu.type);
        if (p.ch) p.ch.powerups++;
        if (this.svc.onPowerup) this.svc.onPowerup(this, p, pu.type);
      }
    }
  }

  tryPortal(p) {
    if (p.portalCooldown > 0) { p.portalCooldown--; return; }
    const h = p.segs[0];
    for (const portal of this.portals) {
      if (this.wd2(h, portal) >= (SEG_R + portal.r) ** 2) continue;
      const partner = this.portals.find(q => q.pairIdx === portal.pairIdx && q.which !== portal.which);
      if (!partner) continue;
      const dx = partner.x - portal.x, dy = partner.y - portal.y;
      for (const s of p.segs) { s.x = wrapPos(s.x + dx, this.W); s.y = wrapPos(s.y + dy, this.H); }
      p.portalCooldown = 60;
      p.teleported = true;
      if (p.kind === 'human') this.emitTo(p, 'sfx', 'portal');
      return;
    }
  }

  // ── Collisions & deaths ────────────────────────────────────────────────────
  collide() {
    const alive = this.aliveSnakes();
    const dead = new Map();
    for (const p of alive) {
      if (p.zoneDeath) { dead.set(p.id, { reason: 'zone' }); continue; }
      if (p.protect > 0 || p.powerup === 'shield' || p.powerup === 'ghost_pu') continue;
      const h = p.segs[0];
      let hit = null;
      for (const ob of this.obstacles) {
        if (this.wd2(h, ob) < (SEG_R + ob.r * 0.8) ** 2) { hit = { reason: 'obstacle' }; break; }
      }
      if (!hit) {
        for (const o of alive) {
          const self = o === p;
          if (!self && o.protect > 0) continue;
          if (!self && this.mode === 'teams' && p.team && p.team === o.team) continue;
          const skip = self ? Math.min(40, 20 + Math.floor(p.segs.length / 30)) : 0;
          const r2 = self ? (SEG_R * 1.3) ** 2 : (SEG_R * 1.9) ** 2;
          const segs = o.segs;
          for (let i = skip; i < segs.length; i++) {
            const s = segs[i];
            const dx = Math.abs(h.x - s.x);
            if (dx > 20 && this.W - dx > 20) continue;
            if (this.wd2(h, s) < r2) { hit = self ? { reason: 'self' } : { reason: 'snake', killer: o }; break; }
          }
          if (hit) break;
        }
      }
      if (!hit) continue;
      if (p.secondWind) {
        // Level 8 "Second Wind": survive one fatal hit per life.
        p.secondWind = false;
        Object.assign(p, { powerup: 'ghost_pu', powerupTick: 0, powerupDuration: 2 * SEC });
        if (p.kind === 'human') this.emitTo(p, 'sfx', 'powerup');
        continue;
      }
      dead.set(p.id, hit);
    }
    for (const [id, info] of dead) {
      const p = this.getSnake(id);
      if (!p || !p.alive) continue;
      const killer = info.killer && info.killer.alive && !dead.has(info.killer.id) ? info.killer : null;
      this.killSnake(p, { killer, reason: info.reason });
    }
  }

  killSnake(p, { killer = null, reason = 'snake', silent = false } = {}) {
    const head = p.segs[0];
    p.alive = false;
    p.diedTick = this.tickCount;
    p.lastPos = head ? { x: head.x, y: head.y } : p.lastPos;
    p.cashout = 0;
    if (p.cloneId) this.removeClone(p.cloneId);
    for (let i = 0; i < p.segs.length; i += 2) this.food.push(this.mkFood(p.segs[i].x, p.segs[i].y, 7 + Math.random() * 5, p.color));

    let amount = 0;
    if (killer) {
      killer.killCount++;
      this.gainXp(killer, 30);
      if (killer.kind === 'human') {
        this.emitTo(killer, 'sfx', 'kill');
        if (killer.ch) killer.ch.killTimes.push(this.tickCount);
      }
    }
    if (this.arena && p.kind === 'human') amount = this.arena.onDeath(this, p, killer, reason);
    if (killer || amount) {
      this.emitAll('kill', {
        k: killer ? killer.name : null, v: p.name, c: killer ? killer.color : p.color,
        x: Math.round(head.x), y: Math.round(head.y), a: amount || 0,
      });
    }
    if (this.isRoundMode() && p.kind === 'human') this.deathOrder.push(p.id);
    if (p.kind === 'bot') { p.respawnTick = 0; return; }

    const life = {
      score: p.score, kills: p.killCount, level: p.level, xp: p.xp, mapId: this.mapId, mode: this.mode,
      surviveTicks: this.tickCount - p.spawnTick, food: p.foodEaten, pacifist: p.pacifist, comeback: p.comeback, reason,
    };
    if (this.svc.onLifeEnd) this.svc.onLifeEnd(this, p, life);
    if (!silent) {
      this.emitTo(p, 'died', {
        score: p.score, kills: p.killCount, level: p.level, xp: p.xp, reason,
        killer: killer ? killer.name : null, replay: p.replayBuf.slice(),
        respawn: this.rules.respawn && this.phase === 'playing', lost: this.arena ? amount : 0,
      });
    }
  }

  // ── Daily challenge ───────────────────────────────────────────────────────
  tickChallenges() {
    if (this.tickCount % 5 !== 0) return;
    const ch = getDailyChallenge();
    for (const p of this.players.values()) {
      if (!p.alive || !p.ch || p.challengeDone === ch.date) continue;
      if (ch.id === 'no_boost' && !p.pacifist) p.ch.violatedNoBoost = true;
      const value = Math.min(challengeValue(ch, p, p.ch, this.tickCount), ch.goal);
      if (value === p.ch.value) continue;
      p.ch.value = value;
      const done = value >= ch.goal;
      if (done) {
        p.challengeDone = ch.date;
        if (this.svc.onChallengeDone) this.svc.onChallengeDone(this, p, ch);
      }
      this.emitTo(p, 'challengeProgress', { id: ch.id, value, goal: ch.goal, done });
    }
  }

  // ── Rounds ─────────────────────────────────────────────────────────────────
  updatePhase() {
    const r = this.rules.rounds;
    if (!r) return;
    if (this.phaseTicks > 0) this.phaseTicks--;
    if (r === 'lms') {
      const enough = this.connectedHumans().length >= this.rules.minHumans;
      if (this.phase === 'waiting' && enough) this.startCountdown(5);
      else if (this.phase === 'countdown') {
        if (!enough) { this.clearSnakes(); this.setPhase('waiting'); this.emitAll('phase', { phase: 'waiting' }); }
        else if (this.phaseTicks === 0) this.startPlaying();
      } else if (this.phase === 'ended' && this.phaseTicks === 0) {
        this.resetRound();
        if (enough) this.startCountdown(5); else { this.setPhase('waiting'); this.emitAll('phase', { phase: 'waiting' }); }
      }
    } else if (r === 'score' || r === 'teams') {
      if (this.phase === 'ended' && this.phaseTicks === 0) {
        this.resetRound();
        for (const p of this.allSnakes()) { if (p.kind === 'human') p.team = null; this.spawn(p); }
        this.setPhase('playing');
        this.emitAll('roundStart', { round: this.round, mode: this.mode });
      }
    } else if (r === 'arena') {
      if (this.phase === 'countdown' && this.phaseTicks === 0) this.startPlaying();
      else if (this.phase === 'ended' && this.phaseTicks === 0) this.close();
    }
  }

  clearSnakes() {
    for (const p of this.players.values()) { p.alive = false; p.waiting = true; p.segs = []; }
    for (const b of [...this.bots.keys()]) this.bots.delete(b);
    this.clones.clear();
  }

  startCountdown(seconds) {
    this.round++;
    this.deathOrder = [];
    this.resetZone();
    const humans = this.connectedHumans();
    const n = this.rules.bots === 'royale' ? Math.max(humans.length, ROYALE_PARTICIPANTS) : humans.length;
    const spots = this.circleSpawnPoints(n);
    humans.forEach((p, i) => this.spawn(p, spots[i]));
    for (let i = humans.length; i < n; i++) this.spawn(this.addBotRaw(), spots[i]);
    this.setPhase('countdown', seconds * SEC);
    this.emitAll('roundStart', { round: this.round, mode: this.mode, countdown: seconds });
  }
  addBotRaw() {
    const b = this.addBot();
    return b;
  }

  // Arena start: called by the arena controller once every paid player has joined.
  startArena(seconds = 3) {
    this.round = 1;
    const humans = this.humans();
    const spots = this.circleSpawnPoints(humans.length);
    humans.forEach((p, i) => this.spawn(p, spots[i]));
    this.setPhase('countdown', seconds * SEC);
    this.emitAll('roundStart', { round: 1, mode: 'arena', countdown: seconds });
  }

  startPlaying() {
    this.roundTick = 0;
    for (const p of this.aliveSnakes()) p.spawnTick = this.tickCount;
    this.setPhase('playing');
    this.emitAll('phase', { phase: 'playing' });
  }

  resetRound() {
    this.food = Array.from({ length: this.map.FOOD_TARGET }, () => this.mkFood());
    if (this.rules.powerups) this.powerups = Array.from({ length: POWERUP_TARGET }, () => this.mkPowerup());
    this.orbs = [];
    this.clones.clear();
    this.activeEvent = null;
    this.teamScores = { red: 0, blue: 0 };
    this.resetZone();
    if (this.rules.rounds === 'lms') this.clearSnakes();
  }

  // Records the lives of everyone still alive when a round ends.
  endLivesAtRoundEnd() {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const life = {
        score: p.score, kills: p.killCount, level: p.level, xp: p.xp, mapId: this.mapId, mode: this.mode,
        surviveTicks: this.tickCount - p.spawnTick, food: p.foodEaten, pacifist: p.pacifist, comeback: p.comeback, reason: 'round',
      };
      if (this.svc.onLifeEnd) this.svc.onLifeEnd(this, p, life);
    }
  }

  checkRoundEnd() {
    const r = this.rules.rounds;
    if (!r) return;
    if (r === 'score') {
      const winner = this.aliveSnakes().filter(p => p.score >= SCORE_WIN).sort((a, b) => b.score - a.score)[0];
      if (winner) this.endRound({ name: winner.name, score: winner.score, id: winner.id });
    } else if (r === 'teams') {
      const ts = { red: 0, blue: 0 };
      for (const p of this.aliveSnakes()) if (p.team) ts[p.team] += p.score;
      this.teamScores = ts;
      if (ts.red >= TEAM_WIN || ts.blue >= TEAM_WIN) {
        const team = ts.red >= ts.blue ? 'red' : 'blue';
        const winners = this.humans().filter(p => p.team === team);
        if (this.svc.onTeamWin) this.svc.onTeamWin(this, winners);
        this.endRound({ team, score: ts[team] });
      }
    } else if (r === 'lms') {
      const alive = this.aliveSnakes();
      const aliveHumans = alive.filter(p => p.kind === 'human');
      const timeout = this.roundTick >= this.rules.roundSeconds * SEC;
      if (alive.length <= 1 || aliveHumans.length === 0 || timeout) {
        const winner = alive.sort((a, b) => b.score - a.score)[0] || null;
        if (this.rules.elo && this.svc.onRankedEnd) {
          const order = [...aliveHumans.sort((a, b) => b.score - a.score).map(p => p.id), ...this.deathOrder.slice().reverse()];
          const placements = order.map(id => this.players.get(id)).filter(p => p && p.userId);
          if (placements.length >= 2) this.svc.onRankedEnd(this, placements);
        }
        this.endRound(winner ? { name: winner.name, score: winner.score, id: winner.id, bot: winner.kind === 'bot' } : null);
      }
    } else if (r === 'arena') {
      const alive = this.aliveSnakes();
      if (alive.length <= 1 || this.roundTick >= this.arena.matchTicks) {
        const result = this.arena.onEnd(this, this.roundTick >= this.arena.matchTicks ? 'time' : 'last_standing');
        this.endLivesAtRoundEnd();
        for (const p of this.players.values()) p.alive = false;
        this.setPhase('ended', 8 * SEC);
        this.lastResult = result;
      }
    }
  }

  endRound(winner) {
    this.endLivesAtRoundEnd();
    this.lastResult = winner;
    this.setPhase('ended', (this.rules.rounds === 'lms' ? 6 : 8) * SEC);
    this.emitAll('roundEnd', { winner, mode: this.mode, nextIn: Math.ceil(this.phaseTicks / SEC), teamScores: this.mode === 'teams' ? this.teamScores : null });
    this.emitAll('sfx', 'win');
  }

  close() {
    this.closed = true;
  }

  // ── World upkeep ───────────────────────────────────────────────────────────
  maintainWorld() {
    const target = this.map.FOOD_TARGET;
    while (this.food.length < target) this.food.push(this.mkFood());
    // Too much food (boost trails, many deaths): drop the oldest ambient pieces,
    // never the fresh death bursts at the end of the array.
    if (this.food.length > target * 3) this.food.splice(0, this.food.length - target * 3);
    if (this.rules.powerups) while (this.powerups.length < POWERUP_TARGET) this.powerups.push(this.mkPowerup());
  }

  // ── Network ────────────────────────────────────────────────────────────────
  snakeInfo(s) {
    const cos = s.cosmetics || {};
    return {
      i: s.id, n: s.name, c: s.color, sk: s.skin, cs: s.customSkin || 0, tm: s.team || 0,
      b: s.kind === 'bot' ? 1 : 0, cl: s.kind === 'clone' ? 1 : 0,
      ti: cos.title || 0, tr: cos.trail || 0, bo: cos.border || 0, ver: s.infoVersion,
    };
  }

  snakeFlags(s) {
    let f = 0;
    if (s.visBoost) f |= FLAGS.BOOST;
    if (s.frozen > 0) f |= FLAGS.FROZEN;
    if (s.powerup === 'ghost_pu') f |= FLAGS.GHOST;
    if (s.powerup === 'shield') f |= FLAGS.SHIELD;
    if (s.powerup === 'speed') f |= FLAGS.SPEED;
    if (s.protect > 0) f |= FLAGS.PROTECT;
    if (s.cashout > 0) f |= FLAGS.CASHOUT;
    return f;
  }

  packSnake(s) {
    const segs = s.segs;
    const step = segs.length > 150 ? 3 : 2;
    const g = [];
    for (let i = 0; i < segs.length; i += step) g.push(Math.round(segs[i].x), Math.round(segs[i].y));
    const last = segs[segs.length - 1];
    if ((segs.length - 1) % step !== 0) g.push(Math.round(last.x), Math.round(last.y));
    const out = { i: s.id, f: this.snakeFlags(s), l: s.level || 1, s: s.score || 0, d: step, n: segs.length, g };
    if (s.emote) out.e = s.emote;
    if (this.arena && s.kind === 'human') out.v = s.value;
    if (s.teleported) { out.tp = 1; s.teleported = false; }
    return out;
  }

  viewCenter(v) {
    if (v.alive && v.segs.length) return { c: v.segs[0], len: v.segs.length };
    const t = v.spectateId && this.getSnake(v.spectateId);
    if (t && t.alive && t.segs.length) return { c: t.segs[0], len: t.segs.length };
    if (v.lastPos) return { c: v.lastPos, len: INIT_SEGS };
    return { c: { x: this.W / 2, y: this.H / 2 }, len: INIT_SEGS * 4 };
  }

  leaderboard() {
    const list = this.allSnakes().filter(p => p.alive || p.kind === 'human').sort((a, b) => (this.arena ? b.value - a.value : 0) || (b.alive - a.alive) || (b.score || 0) - (a.score || 0)).slice(0, 10);
    return list.map(p => ({ i: p.id, n: p.name, s: p.alive ? p.score : 0, c: p.color, b: p.kind === 'bot' ? 1 : 0, t: p.team || 0, a: p.alive ? 1 : 0, l: p.level || 1, v: this.arena ? p.value : undefined }));
  }

  phaseInfo() {
    const info = { p: this.phase, s: Math.ceil(this.phaseTicks / SEC) };
    if (this.isRoundMode()) {
      info.a = this.aliveSnakes().length;
      info.h = this.humanCount();
      info.m = this.rules.minHumans || 0;
      const limit = this.mode === 'arena' ? this.arena.matchTicks : (this.rules.roundSeconds || 0) * SEC;
      if (this.phase === 'playing' && limit) info.t = Math.max(0, Math.ceil((limit - this.roundTick) / SEC));
    }
    return info;
  }

  broadcast() {
    if (!this.net) return;
    const slow = this.tickCount % 5 === 0;
    const snakes = [...this.aliveSnakes(), ...this.clones.values()];
    const everyone = [...this.allSnakes(), ...this.clones.values()];
    const lb = slow ? this.leaderboard() : null;
    const mm = slow ? snakes.filter(s => s.kind !== 'clone').map(s => [s.id, Math.round(s.segs[0].x / 10), Math.round(s.segs[0].y / 10)]) : null;
    const mmPu = slow ? this.powerups.map(pu => [Math.round(pu.x / 10), Math.round(pu.y / 10), POWERUP_TYPES.indexOf(pu.type)]) : null;
    const zone = this.zone ? [Math.round(this.zone.x), Math.round(this.zone.y), Math.round(this.zone.r)] : 0;
    const ev = this.activeEvent ? { type: this.activeEvent.type, x: this.activeEvent.data.x, y: this.activeEvent.data.y, r: this.activeEvent.data.r } : 0;
    const ph = this.phaseInfo();
    const packed = new Map();
    const pack = s => { let p = packed.get(s.id); if (!p) { p = this.packSnake(s); packed.set(s.id, p); } return p; };

    for (const v of this.players.values()) {
      if (!v.socketId) continue;
      const infos = [];
      for (const s of everyone) {
        if (v.sentInfo.get(s.id) !== s.infoVersion) { infos.push(this.snakeInfo(s)); v.sentInfo.set(s.id, s.infoVersion); }
      }
      if (infos.length) this.net.toSocket(v.socketId, 'snakeInfo', infos);

      const { c, len } = this.viewCenter(v);
      const z = zoomForLength(len);
      const hw = U.clamp(v.view.w, 320, 2560) / 2 / z + 200;
      const hh = U.clamp(v.view.h, 320, 1600) / 2 / z + 200;
      const inView = (x, y, m) => Math.abs(x - c.x) < hw + m && Math.abs(y - c.y) < hh + m;

      const sn = [];
      for (const s of snakes) {
        let vis = false;
        for (let i = 0; i < s.segs.length; i += 4) if (inView(s.segs[i].x, s.segs[i].y, 40)) { vis = true; break; }
        if (vis) sn.push(pack(s));
      }
      const fd = [];
      for (const f of this.food) if (inView(f.x, f.y, 20)) fd.push([f.id, Math.round(f.x), Math.round(f.y), Math.round(f.sz), f.color]);
      const pu = [];
      for (const p of this.powerups) if (inView(p.x, p.y, 40)) pu.push([p.id, Math.round(p.x), Math.round(p.y), POWERUP_TYPES.indexOf(p.type)]);
      const ob = [];
      for (const o of this.obstacles) if (inView(o.x, o.y, o.r + 40)) ob.push([o.id, Math.round(o.x), Math.round(o.y), Math.round(o.r)]);
      const pkt = {
        t: this.tickCount,
        me: {
          a: v.alive ? 1 : 0, w: v.waiting ? 1 : 0, s: v.score || 0, x: v.xp || 0, l: v.level || 1, k: v.killCount || 0,
          pu: v.powerup || 0, pp: v.powerup ? v.powerupTick / (v.powerupDuration || 1) : 0,
        },
        sn, fd, pu, ob, z: zone, ev, ph,
      };
      if (this.arena) {
        pkt.me.v = v.value;
        pkt.me.co = v.cashout ? v.cashout / this.arena.cashoutTicks : 0;
        pkt.or = this.orbs.filter(o => inView(o.x, o.y, 20)).map(o => [o.id, Math.round(o.x), Math.round(o.y), o.v]);
      }
      if (this.mode === 'teams') pkt.ts = this.teamScores;
      if (this.mode === 'score') pkt.sw = SCORE_WIN;
      if (this.mode === 'teams') pkt.tw = TEAM_WIN;
      this.net.toSocket(v.socketId, 's', pkt);
      if (slow) this.net.toSocket(v.socketId, 'mm', { p: mm, pu: mmPu, lb });
    }
  }

  // Static info sent once on join.
  joinInfo(p) {
    return {
      pid: p.id, roomId: this.id, roomName: this.name, mode: this.mode, mapId: this.mapId, W: this.W, H: this.H,
      team: p.team, portals: this.portals.map(q => [Math.round(q.x), Math.round(q.y), q.r, q.pairIdx, q.which]),
      phase: this.phaseInfo(), emotes: p.emotes,
    };
  }

  summary() {
    return { id: this.id, name: this.name, players: this.humanCount(), mode: this.mode, mapId: this.mapId, locked: !!this.password, public: this.isPublic, phase: this.phase };
  }
}

module.exports = { Room, RULES, SCORE_WIN, TEAM_WIN, SEG_R, INIT_SEGS };
