const { makeSessionToken, verifySessionToken } = require('../server/auth');
const { SESSION_TOKEN_TTL_MS } = require('../shared/constants');

const SECRET = 'test-secret';

describe('session tokens', () => {
  test('round-trips a valid userId', () => {
    const t = makeSessionToken(42, SECRET);
    expect(verifySessionToken(t, SECRET)).toBe(42);
  });

  test('rejects garbage', () => {
    expect(verifySessionToken('', SECRET)).toBeNull();
    expect(verifySessionToken(null, SECRET)).toBeNull();
    expect(verifySessionToken('not-a-token', SECRET)).toBeNull();
    expect(verifySessionToken('a:b:c', SECRET)).toBeNull();
  });

  test('rejects tampered signature', () => {
    const t = makeSessionToken(42, SECRET);
    const bad = t.slice(0, -1) + (t.slice(-1) === '0' ? '1' : '0');
    expect(verifySessionToken(bad, SECRET)).toBeNull();
  });

  test('rejects different secret', () => {
    const t = makeSessionToken(42, SECRET);
    expect(verifySessionToken(t, 'other-secret')).toBeNull();
  });

  test('rejects token issued past TTL', () => {
    const realNow = Date.now;
    const issued = 1_000_000_000_000;
    Date.now = () => issued;
    const t = makeSessionToken(42, SECRET);
    Date.now = () => issued + SESSION_TOKEN_TTL_MS + 1;
    expect(verifySessionToken(t, SECRET)).toBeNull();
    Date.now = realNow;
  });
});
