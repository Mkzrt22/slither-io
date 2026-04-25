// Token-bucket / sliding-window hybrid rate limiter, keyed by (socketId, action).
// Two configurations:
//   - number N      => N requests per second
//   - { count, windowMs } => count requests per window

const buckets = new Map(); // key -> { tokens, lastRefill, windowStart, windowCount }

function makeKey(socketId, action) { return socketId + '|' + action; }

function allowed(socketId, action, config) {
  const key = makeKey(socketId, action);
  const now = Date.now();
  let b = buckets.get(key);

  if (typeof config === 'number') {
    // per-second token bucket, capacity = config
    if (!b) { b = { tokens: config, lastRefill: now }; buckets.set(key, b); }
    const elapsed = (now - b.lastRefill) / 1000;
    b.tokens = Math.min(config, b.tokens + elapsed * config);
    b.lastRefill = now;
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    return false;
  }

  // sliding window
  const { count, windowMs } = config;
  if (!b) { b = { windowStart: now, windowCount: 0 }; buckets.set(key, b); }
  if (now - b.windowStart > windowMs) { b.windowStart = now; b.windowCount = 0; }
  if (b.windowCount >= count) return false;
  b.windowCount += 1;
  return true;
}

function clear(socketId) {
  for (const key of buckets.keys()) {
    if (key.startsWith(socketId + '|')) buckets.delete(key);
  }
}

module.exports = { allowed, clear };
