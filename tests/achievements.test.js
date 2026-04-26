const { ACHIEVEMENTS, evaluate } = require('../server/achievements');

const baseStats = {
  total_kills: 0, total_food: 0, max_kills_game: 0,
  powerups_collected: 0, ghost_count: 0, games: 0,
  ranked_games: 0, teams_wins: 0, total_survive_ticks: 0, prestige: 0,
};
const player = { score: 0, _pacifist: false };

test('definitions are non-empty and unique-id', () => {
  const ids = ACHIEVEMENTS.map(a => a.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ACHIEVEMENTS.length).toBeGreaterThan(10);
});

test('first_blood unlocks at first kill', () => {
  const out = evaluate(player, baseStats, { total_kills: 1 }, {});
  expect(out).toContain('first_blood');
});

test('apex requires 50 total_kills', () => {
  expect(evaluate(player, baseStats, { total_kills: 49 }, {})).not.toContain('apex');
  expect(evaluate(player, baseStats, { total_kills: 50 }, {})).toContain('apex');
});

test('explorer requires 4 distinct maps', () => {
  expect(evaluate(player, baseStats, {}, { classic: 1, arctic: 1, volcano: 1 })).not.toContain('explorer');
  expect(evaluate(player, baseStats, {}, { classic: 1, arctic: 1, volcano: 1, space: 1 })).toContain('explorer');
});

test('pacifist requires score >= 80 AND never boosted', () => {
  const p = { score: 80, _pacifist: true };
  expect(evaluate(p, baseStats, {}, {})).toContain('pacifist');
  const p2 = { score: 80, _pacifist: false };
  expect(evaluate(p2, baseStats, {}, {})).not.toContain('pacifist');
});

test('survivor unlocks at 3 minutes (4500 ticks)', () => {
  expect(evaluate(player, baseStats, { total_survive_ticks: 4499 }, {})).not.toContain('survivor');
  expect(evaluate(player, baseStats, { total_survive_ticks: 4500 }, {})).toContain('survivor');
});

test('prestige_one requires prestige >= 1', () => {
  expect(evaluate(player, baseStats, { prestige: 0 }, {})).not.toContain('prestige_one');
  expect(evaluate(player, baseStats, { prestige: 1 }, {})).toContain('prestige_one');
});
