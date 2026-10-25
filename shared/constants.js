// Constants shared by the server (require) and the browser (window.SHARED).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHARED = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TICK_RATE = 25;
  const INIT_SEGS = 24;

  const LEVEL_XP = [0, 50, 120, 220, 360, 550, 800, 1100, 1500, 2000];
  const LEVEL_ABILITIES = {
    2: { id: 'wide_eat', icon: '👅' },
    4: { id: 'fast_boost', icon: '💨' },
    6: { id: 'long_shield', icon: '🛡' },
    8: { id: 'second_wind', icon: '💚' },
  };
  function getLevel(xp) {
    for (let i = LEVEL_XP.length - 1; i >= 0; i--) if (xp >= LEVEL_XP[i]) return Math.min(i + 1, 10);
    return 1;
  }

  const MAPS = {
    classic: { id: 'classic', W: 4000, H: 4000, unlockLevel: 1 },
    arctic: { id: 'arctic', W: 3600, H: 3600, unlockLevel: 3 },
    volcano: { id: 'volcano', W: 3200, H: 3200, unlockLevel: 5 },
    space: { id: 'space', W: 5000, H: 5000, unlockLevel: 8 },
  };

  const MODES = ['classic', 'score', 'teams', 'royale', 'ranked'];

  const SKINS = [
    { id: 'solid' }, { id: 'striped' }, { id: 'dotted' }, { id: 'rainbow' }, { id: 'glow' },
    { id: 'gold', supporter: true }, { id: 'neon', supporter: true }, { id: 'galaxy', supporter: true },
  ];
  const SKIN_IDS = SKINS.map(s => s.id);

  const BASE_EMOTES = ['😂', '😎', '👋', '💀'];

  const POWERUP_TYPES = ['speed', 'shield', 'magnet', 'freeze', 'clone', 'ghost_pu'];

  // Snake state flags sent in each state packet.
  const FLAGS = { BOOST: 1, FROZEN: 2, GHOST: 4, SHIELD: 8, PROTECT: 16, CASHOUT: 32, SPEED: 64 };

  // Custom skin editor grid.
  const SKIN_ROWS = 3, SKIN_COLS = 15;

  // ── Battle pass: rolling 30-day seasons starting from Season 1 ─────────────
  const BP_EPOCH = Date.UTC(2026, 2, 1); // 2026-03-01, start of Season 1
  const BP_SEASON_DAYS = 30;
  const BP_XP_PER_TIER = 100;
  const BP_TOTAL_TIERS = 30;
  // [free, premium] per tier. t: 't' title, 'r' trail, 'b' ring, 'e' emote.
  const BP_TIERS = [
    [{ t: 't', v: 'Rookie', l: 'Rookie' }, { t: 'r', v: '#00e5ff', l: 'Cyan Trail' }],
    [{ t: 'r', v: '#00e5ff', l: 'Cyan Trail' }, { t: 't', v: 'Viper', l: 'Viper' }],
    [{ t: 'e', v: '🎯', l: 'Dart Emote' }, { t: 'b', v: '#a855f7', l: 'Purple Ring' }],
    [{ t: 'b', v: '#ff9f43', l: 'Ember Ring' }, { t: 'e', v: '💫', l: 'Sparkle Emote' }],
    [{ t: 't', v: 'Hunter', l: 'Hunter' }, { t: 'r', v: '#ffd700', l: 'Gold Trail' }],
    [{ t: 'r', v: '#ff4757', l: 'Crimson Trail' }, { t: 't', v: 'Shadow', l: 'Shadow' }],
    [{ t: 'e', v: '⚡', l: 'Bolt Emote' }, { t: 'b', v: '#00b894', l: 'Teal Ring' }],
    [{ t: 'b', v: '#ffd700', l: 'Gold Ring' }, { t: 'e', v: '🔥', l: 'Fire Emote' }],
    [{ t: 't', v: 'Veteran', l: 'Veteran' }, { t: 'r', v: '#9b59b6', l: 'Amethyst Trail' }],
    [{ t: 'r', v: '#2ecc71', l: 'Emerald Trail' }, { t: 't', v: 'Elite', l: 'Elite' }],
    [{ t: 'e', v: '🌙', l: 'Moon Emote' }, { t: 'b', v: '#74b9ff', l: 'Sky Ring' }],
    [{ t: 'b', v: '#0984e3', l: 'Ice Ring' }, { t: 'e', v: '😈', l: 'Devil Emote' }],
    [{ t: 't', v: 'Phantom', l: 'Phantom' }, { t: 'r', v: '#e17055', l: 'Lava Trail' }],
    [{ t: 'r', v: '#fdcb6e', l: 'Solar Trail' }, { t: 't', v: 'Apex', l: 'Apex' }],
    [{ t: 'e', v: '💥', l: 'Boom Emote' }, { t: 'b', v: '#a29bfe', l: 'Void Ring' }],
    [{ t: 'b', v: '#6c5ce7', l: 'Indigo Ring' }, { t: 'r', v: '#e84393', l: 'Neon Trail' }],
    [{ t: 't', v: 'Legend', l: 'Legend' }, { t: 'e', v: '👑', l: 'Crown Emote' }],
    [{ t: 'r', v: '#fd79a8', l: 'Pink Trail' }, { t: 't', v: 'Warlord', l: 'Warlord' }],
    [{ t: 'e', v: '🌟', l: 'Star Emote' }, { t: 'b', v: '#55efc4', l: 'Mint Ring' }],
    [{ t: 'b', v: '#e17055', l: 'Volcano Ring' }, { t: 'r', v: '#d63031', l: 'Blood Trail' }],
    [{ t: 't', v: 'Specter', l: 'Specter' }, { t: 'e', v: '🎮', l: 'Game Emote' }],
    [{ t: 'r', v: '#00b894', l: 'Mint Trail' }, { t: 't', v: 'Immortal', l: 'Immortal' }],
    [{ t: 'e', v: '⚔️', l: 'Swords Emote' }, { t: 'b', v: '#341f97', l: 'Cosmic Ring' }],
    [{ t: 'b', v: '#b2bec3', l: 'Chrome Ring' }, { t: 'r', v: '#f9ca24', l: 'Sunburst Trail' }],
    [{ t: 't', v: 'Apex Predator', l: 'Apex Predator' }, { t: 'e', v: '🏆', l: 'Trophy Emote' }],
    [{ t: 'r', v: '#9980fa', l: 'Cosmic Trail' }, { t: 't', v: 'Sovereign', l: 'Sovereign' }],
    [{ t: 'e', v: '💎', l: 'Diamond Emote' }, { t: 'b', v: '#f6e58d', l: 'Champion Ring' }],
    [{ t: 'b', v: '#dfe6e9', l: 'Chrome Ring II' }, { t: 'r', v: '#ff7979', l: 'Cherry Trail' }],
    [{ t: 't', v: 'NeonSlither Pro', l: 'NSP' }, { t: 'e', v: '🌌', l: 'Galaxy Emote' }],
    [{ t: 't', v: 'Season Champion', l: 'Champion' }, { t: 'b', v: '#ffd700', l: 'Crown Ring' }],
  ];

  function getSeason(now) {
    const t = now == null ? Date.now() : now;
    const len = BP_SEASON_DAYS * 86400000;
    const n = Math.max(0, Math.floor((t - BP_EPOCH) / len));
    const start = BP_EPOCH + n * len;
    const end = start + len;
    return { number: n + 1, start, end, daysLeft: Math.max(0, Math.ceil((end - t) / 86400000)) };
  }
  function bpTier(xp) { return Math.min(BP_TOTAL_TIERS, Math.floor((xp || 0) / BP_XP_PER_TIER)); }
  // Every reward value unlocked at a given tier (free track, plus premium if owned).
  function bpUnlocked(tier, premium) {
    const out = { titles: [], trails: [], borders: [], emotes: [] };
    const key = { t: 'titles', r: 'trails', b: 'borders', e: 'emotes' };
    for (let i = 0; i < Math.min(tier, BP_TOTAL_TIERS); i++) {
      const rewards = premium ? BP_TIERS[i] : [BP_TIERS[i][0]];
      for (const r of rewards) if (!out[key[r.t]].includes(r.v)) out[key[r.t]].push(r.v);
    }
    return out;
  }

  // Camera zoom shrinks as the snake grows (1 = default, 0.5 = most zoomed out).
  function zoomForLength(len) {
    const z = 1.15 - Math.log10((len || INIT_SEGS) / INIT_SEGS + 1) * 0.45;
    return Math.max(0.5, Math.min(1, z));
  }

  // Money is stored as integer micro-units (1 unit = 1 000 000).
  const MONEY_SCALE = 1000000;
  function formatMoney(units, currency) {
    const s = ((units || 0) / MONEY_SCALE).toFixed(2);
    return currency === 'DEMO' ? s + ' DEMO' : '$' + s;
  }

  return {
    TICK_RATE, INIT_SEGS, LEVEL_XP, LEVEL_ABILITIES, getLevel, MAPS, MODES, SKINS, SKIN_IDS,
    BASE_EMOTES, POWERUP_TYPES, FLAGS, SKIN_ROWS, SKIN_COLS,
    BP_EPOCH, BP_SEASON_DAYS, BP_XP_PER_TIER, BP_TOTAL_TIERS, BP_TIERS, getSeason, bpTier, bpUnlocked,
    zoomForLength, MONEY_SCALE, formatMoney,
  };
});
