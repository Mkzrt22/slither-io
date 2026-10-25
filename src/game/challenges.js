'use strict';
const { TICK_RATE } = require('../../shared/constants');
const { utcDateKey } = require('../util');

// One challenge per UTC day, rotating deterministically.
const DAILY_CHALLENGES = [
  { id: 'score', icon: '🏆', label: 'High Scorer', desc: 'Reach a score of 150 in one life', goal: 150, unit: 'pts' },
  { id: 'kills', icon: '💀', label: 'Predator', desc: 'Get 5 kills in one life', goal: 5, unit: 'kills' },
  { id: 'no_boost', icon: '🐢', label: 'Pacifist Run', desc: 'Score 80 without ever boosting', goal: 80, unit: 'pts' },
  { id: 'powerups', icon: '⚡', label: 'Power Collector', desc: 'Collect 8 power-ups in one life', goal: 8, unit: 'PUs' },
  { id: 'survive', icon: '⏱', label: 'Survivor', desc: 'Stay alive for 90 seconds', goal: 90, unit: 'sec' },
  { id: 'eat_streak', icon: '🍎', label: 'Glutton', desc: 'Eat 40 food items without dying', goal: 40, unit: 'food' },
  { id: 'length', icon: '📏', label: 'Mega Snake', desc: 'Reach a length of 70 segments', goal: 70, unit: 'segs' },
  { id: 'multi_kill', icon: '🔥', label: 'Double Kill', desc: 'Get 2 kills within 8 seconds', goal: 2, unit: 'kills' },
];

function getDailyChallenge(now = new Date()) {
  const dayNum = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000);
  return { ...DAILY_CHALLENGES[dayNum % DAILY_CHALLENGES.length], date: utcDateKey(now) };
}

function freshChallengeState(tick) {
  return { value: 0, violatedNoBoost: false, killTimes: [], powerups: 0, food: 0, spawnTick: tick };
}

// Returns the current progress value for the player's life.
function challengeValue(ch, p, cs, tick) {
  switch (ch.id) {
    case 'score': return p.score;
    case 'kills': return p.killCount;
    case 'no_boost': return cs.violatedNoBoost ? 0 : p.score;
    case 'powerups': return cs.powerups;
    case 'survive': return Math.floor((tick - cs.spawnTick) / TICK_RATE);
    case 'eat_streak': return cs.food;
    case 'length': return p.segs.length;
    case 'multi_kill': {
      const since = tick - 8 * TICK_RATE;
      cs.killTimes = cs.killTimes.filter(t => t > since);
      return cs.killTimes.length;
    }
    default: return 0;
  }
}

module.exports = { DAILY_CHALLENGES, getDailyChallenge, freshChallengeState, challengeValue };
