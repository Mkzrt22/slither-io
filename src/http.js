'use strict';
const path = require('path');
const express = require('express');
const { makeSupporterToken, verifySupporterToken, verifySessionToken } = require('./auth');
const { safeEqual } = require('./util');

function createApp({ config, accounts, payments, manager, publicConfig }) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  try { app.use(require('compression')()); } catch (e) { console.warn('compression not installed'); }

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()), ...manager.stats() }));
  app.get('/api/config', (req, res) => res.json(publicConfig()));

  // ── Stripe supporter pack ──────────────────────────────────────────────────
  let stripe = null;
  if (config.STRIPE_SECRET_KEY) {
    try { stripe = require('stripe')(config.STRIPE_SECRET_KEY); } catch (e) { console.warn('Stripe not available:', e.message); }
  }
  app.post('/api/stripe-webhook', express.raw({ type: 'application/json', limit: '256kb' }), (req, res) => {
    if (!stripe || !config.STRIPE_WEBHOOK_SECRET) return res.sendStatus(200);
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.STRIPE_WEBHOOK_SECRET); }
    catch (e) { return res.status(400).send('Invalid signature'); }
    if (event.type === 'checkout.session.completed') console.log('✅ Supporter purchase confirmed:', event.data.object.id);
    res.sendStatus(200);
  });

  app.use(express.json({ limit: '32kb' }));

  app.post('/api/create-checkout', async (req, res) => {
    if (!stripe || !config.STRIPE_PRICE_ID) return res.status(503).json({ error: 'stripe_not_configured' });
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: config.STRIPE_PRICE_ID, quantity: 1 }],
        success_url: `${config.PUBLIC_URL}/?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.PUBLIC_URL}/`,
        metadata: { product: 'supporter_pack' },
      });
      res.json({ url: session.url });
    } catch (e) {
      console.error('Stripe checkout failed:', e.message);
      res.status(502).json({ error: 'checkout_failed' });
    }
  });

  app.get('/api/verify-purchase', async (req, res) => {
    const sessionId = String(req.query.session_id || '');
    if (!stripe || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return res.status(400).json({ error: 'invalid_request' });
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== 'paid') return res.status(402).json({ error: 'not_paid' });
      // Link the purchase to the account when the buyer is logged in.
      const auth = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const uid = auth ? verifySessionToken(auth) : null;
      if (uid && accounts.enabled) accounts.setSupporter(uid);
      res.json({ token: makeSupporterToken(session.id), product: 'supporter_pack', linked: !!uid });
    } catch (e) {
      res.status(502).json({ error: 'verify_failed' });
    }
  });

  app.get('/api/verify-token', (req, res) => {
    const valid = verifySupporterToken(String(req.query.token || ''));
    res.json({ valid, product: valid ? 'supporter_pack' : null });
  });

  // ── Crypto payments ────────────────────────────────────────────────────────
  app.post('/api/payments/nowpayments/ipn', (req, res) => {
    const code = payments.handleNowpaymentsIpn(req.body, req.headers['x-nowpayments-sig']);
    res.sendStatus(code);
  });

  // ── Admin ──────────────────────────────────────────────────────────────────
  const admin = express.Router();
  admin.use((req, res, next) => {
    if (!config.ADMIN_TOKEN || !payments.enabled) return res.status(404).json({ error: 'admin_disabled' });
    if (!safeEqual(req.headers['x-admin-token'] || '', config.ADMIN_TOKEN)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  admin.get('/overview', (req, res) => res.json({ ...payments.admin.overview(), ...manager.stats() }));
  admin.get('/withdrawals', (req, res) => res.json(payments.admin.withdrawals(String(req.query.status || 'pending'))));
  admin.post('/withdrawals/:id/sent', (req, res) => res.json(payments.admin.markSent(Number(req.params.id), req.body && req.body.txid)));
  admin.post('/withdrawals/:id/reject', (req, res) => res.json(payments.admin.reject(Number(req.params.id), req.body && req.body.note)));
  admin.get('/deposits', (req, res) => res.json(payments.admin.deposits()));
  admin.post('/adjust', (req, res) => {
    const b = req.body || {};
    res.json(payments.admin.adjust(b.username, Math.round(Number(b.amount) * 1000000), b.note));
  });
  admin.post('/ban', (req, res) => {
    const b = req.body || {};
    if (!accounts.enabled) return res.json({ ok: false, error: 'accounts_disabled' });
    res.json(accounts.setBanned(String(b.username || ''), b.banned !== false));
  });
  app.use('/api/admin', admin);

  // ── Static files ───────────────────────────────────────────────────────────
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared'), { maxAge: '10m' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '10m',
    setHeaders(res, file) { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('HTTP error:', err.message);
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.status === 400 ? 'bad_request' : 'server_error' });
  });
  return app;
}

module.exports = { createApp };
