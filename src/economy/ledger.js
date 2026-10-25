'use strict';

// Append-only money ledger on top of SQLite. Every balance change writes a
// ledger row with the resulting balance, inside the caller's transaction.
// Amounts are integer micro-units (see MONEY_SCALE).

const HOUSE_USER_ID = 0;

class LedgerError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function createLedger(db) {
  if (!db) return null;
  const q = {
    ensure: db.prepare('INSERT OR IGNORE INTO wallets(user_id,currency,balance) VALUES(?,?,0)'),
    get: db.prepare('SELECT balance, last_faucet_at FROM wallets WHERE user_id=? AND currency=?'),
    set: db.prepare('UPDATE wallets SET balance=? WHERE user_id=? AND currency=?'),
    log: db.prepare('INSERT INTO ledger(user_id,currency,delta,balance_after,kind,ref) VALUES(?,?,?,?,?,?)'),
    history: db.prepare('SELECT delta, balance_after, kind, ref, created_at FROM ledger WHERE user_id=? AND currency=? ORDER BY id DESC LIMIT ?'),
    setFaucet: db.prepare('UPDATE wallets SET last_faucet_at=? WHERE user_id=? AND currency=?'),
  };

  function wallet(userId, currency) {
    q.ensure.run(userId, currency);
    return q.get.get(userId, currency);
  }
  const balance = (userId, currency) => wallet(userId, currency).balance;

  // Applies a signed delta. Throws LedgerError('insufficient_funds') if it would go negative.
  // Not wrapped in a transaction on purpose: callers group it with their own writes.
  function apply(userId, currency, delta, kind, ref) {
    if (!Number.isInteger(delta)) throw new LedgerError('invalid_amount');
    const cur = wallet(userId, currency).balance;
    const next = cur + delta;
    if (next < 0) throw new LedgerError('insufficient_funds');
    q.set.run(next, userId, currency);
    q.log.run(userId, currency, delta, next, kind, ref == null ? null : String(ref));
    return next;
  }

  const transfer = db.transaction((userId, currency, delta, kind, ref) => apply(userId, currency, delta, kind, ref));

  return {
    HOUSE_USER_ID,
    LedgerError,
    db,
    wallet,
    balance,
    apply,
    transfer,
    history: (userId, currency, limit = 20) => q.history.all(userId, currency, limit),
    setFaucetAt: (userId, currency, at) => q.setFaucet.run(at, userId, currency),
  };
}

module.exports = { createLedger, LedgerError, HOUSE_USER_ID };
