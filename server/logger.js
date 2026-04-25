// Structured logger. Tries pino, falls back to console with prefixes.
let logger;
try {
  const pino = require('pino');
  logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });
} catch {
  const fmt = (lvl) => (...args) => console.log(`[${new Date().toISOString()}] [${lvl}]`, ...args);
  logger = {
    info: fmt('INFO'), warn: fmt('WARN'), error: fmt('ERROR'),
    debug: fmt('DEBUG'), fatal: fmt('FATAL'),
    child: () => logger,
  };
}
module.exports = logger;
