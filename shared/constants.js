// Shared constants used by both server and (browser-loaded) client.
// CommonJS module; the client receives them via /shared/constants.js as text and
// either parses with new Function() in the browser or loads via require() in Node.

const TICK_HZ                  = 25;
const TICK_MS                  = 1000 / TICK_HZ;
const SEG_R                    = 9;
const MOVE_SPEED               = 2.8;
const BOOST_SPEED              = 5.2;
const TURN_SPEED               = 0.13;
const INIT_SEGS                = 24;
const BOOST_SHRINK_INTERVAL    = 5;       // ticks per shrink (was 8 — punitif comme l'original)
const BOT_COUNT_BASE           = 3;
const BOT_COUNT_MAX            = 8;
const POWERUP_TARGET           = 10;
const PORTAL_PAIRS             = 3;
const PORTAL_MIN_DISTANCE      = 800;     // min distance between paired portals
const ZONE_SHRINK_INTERVAL     = 30000;
const ZONE_MIN_RADIUS          = 500;
const ZONE_DAMAGE_TICK         = 4;
const SCORE_WIN                = 200;
const SPAWN_INVUL_TICKS        = 50;       // 2s of post-spawn invulnerability
const SPATIAL_CELL             = 64;       // grid cell size for collision broadphase
const MAX_LEVEL                = 10;
const PRESTIGE_XP              = 5000;     // xp needed to prestige past level 10

// Level XP curve — used both server-side (scoring) and client-side (lobby UI)
const LEVEL_XP                 = [0, 50, 120, 220, 360, 550, 800, 1100, 1500, 2000];
const LEVEL_ABILITY            = { 2: 'wide_eat', 4: 'fast_boost', 6: 'long_shield', 8: 'ghost' };

const POWERUP_TYPES            = ['speed', 'shield', 'magnet', 'freeze', 'clone', 'ghost_pu'];
const POWERUP_DURATIONS        = {
  speed:    5 * TICK_HZ,
  shield:   4 * TICK_HZ,
  magnet:   8 * TICK_HZ,
  freeze:   4 * TICK_HZ,
  clone:    6 * TICK_HZ,
  ghost_pu: 5 * TICK_HZ,
};

// Rate-limit thresholds (per socket, per second unless noted)
const RATE_LIMITS = {
  input:        60,             // very high — input is normally 60Hz from rAF
  chat:         3,
  emote:        4,
  createRoom:   { count: 3, windowMs: 60_000 },
  joinRoom:     10,
  authLogin:    { count: 5,  windowMs: 60_000 },
  authRegister: { count: 3,  windowMs: 60_000 },
  generic:      30,
};

const SESSION_TOKEN_TTL_MS     = 30 * 24 * 60 * 60 * 1000; // 30 days

const PASSWORD_MIN             = 8;
const USERNAME_MIN             = 3;
const USERNAME_MAX             = 20;

const constants = {
  TICK_HZ, TICK_MS, SEG_R, MOVE_SPEED, BOOST_SPEED, TURN_SPEED, INIT_SEGS,
  BOOST_SHRINK_INTERVAL, BOT_COUNT_BASE, BOT_COUNT_MAX, POWERUP_TARGET,
  PORTAL_PAIRS, PORTAL_MIN_DISTANCE, ZONE_SHRINK_INTERVAL, ZONE_MIN_RADIUS,
  ZONE_DAMAGE_TICK, SCORE_WIN, SPAWN_INVUL_TICKS, SPATIAL_CELL, MAX_LEVEL,
  PRESTIGE_XP, LEVEL_XP, LEVEL_ABILITY, POWERUP_TYPES, POWERUP_DURATIONS,
  RATE_LIMITS, SESSION_TOKEN_TTL_MS, PASSWORD_MIN, USERNAME_MIN, USERNAME_MAX,
};

if (typeof module !== 'undefined' && module.exports) module.exports = constants;
if (typeof window !== 'undefined') window.SLITHER_CONSTANTS = constants;
