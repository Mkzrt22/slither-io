const { calcEloGain, getRank, RANK_TIERS } = require('../server/elo');

describe('calcEloGain', () => {
  test('equal ratings → ~16 points', () => {
    expect(calcEloGain(1000, 1000)).toBe(16);
  });
  test('upset (loser higher rated) gives more points', () => {
    expect(calcEloGain(1000, 1400)).toBeGreaterThan(calcEloGain(1000, 1000));
  });
  test('expected win (winner much higher) gives few points', () => {
    expect(calcEloGain(1600, 1000)).toBeLessThan(8);
  });
});

describe('getRank', () => {
  test('Bronze for default 1000', () => {
    expect(getRank(0).name).toBe('Bronze');
    expect(getRank(999).name).toBe('Bronze');
  });
  test('exact tier boundaries', () => {
    for (const t of RANK_TIERS) {
      expect(getRank(t.min).name).toBe(t.name);
    }
  });
  test('Diamond for very high', () => {
    expect(getRank(2500).name).toBe('Diamond');
  });
});
