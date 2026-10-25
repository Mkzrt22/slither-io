'use strict';
const http = require('http');
const { Server } = require('socket.io');
const config = require('./src/config');
const { init: initDb } = require('./src/db');
const { createAccounts } = require('./src/auth');
const { createStats } = require('./src/stats');
const { createLedger } = require('./src/economy/ledger');
const { createArena } = require('./src/economy/arena');
const { createPayments } = require('./src/payments');
const { createManager } = require('./src/game/manager');
const { attachSockets } = require('./src/sockets');
const { createApp } = require('./src/http');
const pkg = require('./package.json');

for (const w of config.warnings) console.warn('⚠️ ', w);

const db = initDb();
const accounts = createAccounts(db);
const stats = createStats(db);
const ledger = createLedger(db);
const manager = createManager({ config });
const arena = createArena({ db, ledger, config, stats });
let sockets = null;
const payments = createPayments({ db, ledger, config, getUser: accounts.getUser, onWalletChange: uid => sockets && sockets.walletChanged(uid) });

// Settings the browser needs (never secrets).
function publicConfig() {
  return {
    version: pkg.version,
    accounts: accounts.enabled,
    payments: { mode: config.PAYMENTS_MODE, currency: config.CURRENCY },
    arena: arena.enabled,
    stripe: !!(config.STRIPE_SECRET_KEY && config.STRIPE_PRICE_ID),
    adsense: { client: config.ADSENSE_CLIENT, slotLobby: config.ADSENSE_SLOT_LOBBY, slotDeath: config.ADSENSE_SLOT_DEATH },
    plausible: config.PLAUSIBLE_DOMAIN || null,
  };
}

const app = createApp({ config, accounts, payments, manager, publicConfig });
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 64 * 1024, pingInterval: 20000, pingTimeout: 20000 });

sockets = attachSockets({ io, config, manager, accounts, stats, arena, payments, publicConfig });

const recovered = arena.recover();
if (recovered.refunded || recovered.settled) console.log(`💰 Arena recovery: ${recovered.refunded} queued entries refunded, ${recovered.settled} matches settled`);

manager.start();
const sweepTimer = setInterval(() => manager.sweep(), 10000);
const arenaTimer = setInterval(() => { try { arena.tick(); } catch (e) { console.error('Arena tick failed', e); } }, 1000);

server.listen(config.PORT, () => {
  console.log(`🐍 NeonSlither v${pkg.version} → http://localhost:${config.PORT} (payments: ${config.PAYMENTS_MODE})`);
});

// Graceful shutdown: refund queued arena players and settle running matches before exiting.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down…`);
  try { arena.shutdown(); } catch (e) { console.error('Arena shutdown failed', e); }
  manager.stop();
  clearInterval(sweepTimer);
  clearInterval(arenaTimer);
  io.close();
  server.close(() => {
    if (db) db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
