'use strict';

// USD prices for volatile assets (stablecoins count as exactly $1).
// CoinGecko first, Coinbase as fallback; a price older than 10 minutes is refused.

const MAX_AGE_MS = 10 * 60 * 1000;

function createPrices({ assets, fetchFn = globalThis.fetch, refreshMs = 60000 }) {
  const cache = new Map(); // priceId -> { micros, at }
  const volatile = Object.values(assets).filter(a => !a.stable && a.priceId);

  async function fromCoinGecko(ids) {
    const res = await fetchFn(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('coingecko ' + res.status);
    const data = await res.json();
    const out = {};
    for (const id of ids) if (data[id] && data[id].usd > 0) out[id] = data[id].usd;
    return out;
  }
  async function fromCoinbase(asset) {
    const res = await fetchFn(`https://api.coinbase.com/v2/prices/${asset.coinbase}/spot`);
    if (!res.ok) throw new Error('coinbase ' + res.status);
    const data = await res.json();
    const v = Number(data && data.data && data.data.amount);
    if (!(v > 0)) throw new Error('coinbase bad price');
    return v;
  }

  async function refresh() {
    const ids = [...new Set(volatile.map(a => a.priceId))];
    if (!ids.length) return;
    let got = {};
    try { got = await fromCoinGecko(ids); } catch (e) { /* fall through */ }
    for (const a of volatile) {
      let usd = got[a.priceId];
      if (!usd && a.coinbase) { try { usd = await fromCoinbase(a); } catch (e) { /* keep old value */ } }
      if (usd) cache.set(a.priceId, { micros: Math.round(usd * 1e6), at: Date.now() });
    }
  }

  // Price of one whole token in USD micro-units, or null if unknown / stale.
  function priceMicros(asset) {
    if (asset.stable) return 1000000;
    const c = cache.get(asset.priceId);
    if (!c || Date.now() - c.at > MAX_AGE_MS) return null;
    return c.micros;
  }

  let timer = null;
  function start() {
    if (!volatile.length) return;
    refresh().catch(() => {});
    timer = setInterval(() => refresh().catch(() => {}), refreshMs);
    if (timer.unref) timer.unref();
  }
  function stop() { clearInterval(timer); }
  function set(priceId, usd) { cache.set(priceId, { micros: Math.round(usd * 1e6), at: Date.now() }); }

  return { refresh, priceMicros, start, stop, set };
}

// token base units (BigInt) → USD micro-units (Number), rounded down.
function unitsToUsd(units, decimals, priceMicros) {
  return Number((BigInt(units) * BigInt(priceMicros)) / 10n ** BigInt(decimals));
}
// USD micro-units → token base units (BigInt), rounded down.
function usdToUnits(usdMicros, decimals, priceMicros) {
  return (BigInt(usdMicros) * 10n ** BigInt(decimals)) / BigInt(priceMicros);
}
function formatUnits(units, decimals, maxFraction = 6) {
  const u = BigInt(units);
  const base = 10n ** BigInt(decimals);
  const whole = u / base;
  let frac = (u % base).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

module.exports = { createPrices, unitsToUsd, usdToUnits, formatUnits };
