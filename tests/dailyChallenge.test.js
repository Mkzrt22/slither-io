const { getDailyChallenge, DAILY_CHALLENGES } = require('../server/dailyChallenge');

describe('getDailyChallenge', () => {
  test('is deterministic for a given date', () => {
    const d = new Date(Date.UTC(2025, 5, 15));
    const a = getDailyChallenge(d);
    const b = getDailyChallenge(d);
    expect(a.id).toBe(b.id);
    expect(a.date).toBe(b.date);
  });

  test('cycles through every challenge over enough days', () => {
    const seen = new Set();
    for (let i = 0; i < DAILY_CHALLENGES.length; i++) {
      const d = new Date(Date.UTC(2025, 0, 1 + i));
      seen.add(getDailyChallenge(d).id);
    }
    expect(seen.size).toBe(DAILY_CHALLENGES.length);
  });

  test('shape includes goal/unit/desc', () => {
    const ch = getDailyChallenge(new Date());
    expect(ch).toHaveProperty('goal');
    expect(ch).toHaveProperty('unit');
    expect(ch).toHaveProperty('desc');
    expect(typeof ch.date).toBe('string');
  });
});
