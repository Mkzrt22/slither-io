const rl = require('../server/rateLimiter');

describe('rateLimiter (per-second token bucket)', () => {
  test('allows N then blocks', () => {
    const cap = 3;
    let allowed = 0;
    for (let i = 0; i < 10; i++) if (rl.allowed('s1', 'act', cap)) allowed++;
    expect(allowed).toBe(cap);
  });
});

describe('rateLimiter (sliding window)', () => {
  test('respects count within window', () => {
    let n = 0;
    for (let i = 0; i < 10; i++) if (rl.allowed('s2', 'register', { count: 2, windowMs: 60_000 })) n++;
    expect(n).toBe(2);
  });
});

describe('rateLimiter.clear', () => {
  test('drops all buckets for a socket', () => {
    rl.allowed('s3', 'a', 1);
    rl.allowed('s3', 'b', 1);
    rl.clear('s3');
    expect(rl.allowed('s3', 'a', 1)).toBe(true);
  });
});
