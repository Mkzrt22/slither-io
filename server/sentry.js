// Optional Sentry init. No-op when DSN missing or package not installed.
let Sentry = null;
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (e) {
    console.warn('Sentry DSN set but @sentry/node not installed; ignoring.');
  }
}

function captureException(err, ctx) {
  if (Sentry) Sentry.captureException(err, { extra: ctx || {} });
}

module.exports = { Sentry, captureException };
