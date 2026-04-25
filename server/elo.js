// ELO helpers. Pure functions; persistence handled by caller via db.js.
const ELO_K = 32;
const RANK_TIERS = [
  { name: 'Bronze',   min: 0,    color: '#cd7f32' },
  { name: 'Silver',   min: 1000, color: '#c0c0c0' },
  { name: 'Gold',     min: 1200, color: '#ffd700' },
  { name: 'Platinum', min: 1400, color: '#00e5ff' },
  { name: 'Diamond',  min: 1600, color: '#b39ddb' },
];

function calcEloGain(winner, loser) {
  return Math.round(ELO_K * (1 - 1 / (1 + Math.pow(10, (loser - winner) / 400))));
}

function getRank(elo) {
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (elo >= RANK_TIERS[i].min) return RANK_TIERS[i];
  }
  return RANK_TIERS[0];
}

module.exports = { ELO_K, RANK_TIERS, calcEloGain, getRank };
