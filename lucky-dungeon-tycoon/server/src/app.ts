/**
 * app.ts — HTTP API for Lucky City Tycoon (Fastify).
 *
 * Endpoints (all JSON):
 *   GET  /api/v1/health            → liveness + version
 *   POST /api/v1/accounts          → create an anonymous device account
 *   GET  /api/v1/save   (Bearer)   → fetch the cloud save (code may be null)
 *   PUT  /api/v1/save   (Bearer)   → upload a save code; 409 if a newer one wins
 *
 * Auth is a bearer token issued at account creation; only its SHA-256 hash is
 * stored. The app is storage-agnostic (see Store) so it can be tested with the
 * in-memory store via Fastify's inject().
 */

import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { Store } from './store.js';
import { decodeAndSanitize } from './saveCodec.js';

const NAME = 'lucky-city-tycoon-server';
const VERSION = '1.0.0';
/** Reject save bodies larger than this (a normal save is a few KB). */
const MAX_BODY_BYTES = 256 * 1024;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface BuildOptions {
  logger?: boolean;
  /** Value for Access-Control-Allow-Origin (defaults to "*"). */
  allowOrigin?: string;
}

export function buildApp(store: Store, opts: BuildOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: MAX_BODY_BYTES });
  const allowOrigin = opts.allowOrigin ?? process.env.ALLOW_ORIGIN ?? '*';

  // Permissive CORS so the PWA (any origin) and the packaged mobile apps can
  // call the API. Tighten allowOrigin to your domain in production if desired.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('access-control-allow-origin', allowOrigin);
    reply.header('access-control-allow-headers', 'authorization, content-type');
    reply.header('access-control-allow-methods', 'GET, PUT, POST, OPTIONS');
    reply.header('vary', 'origin');
    if (req.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  async function authenticate(req: FastifyRequest): Promise<string | null> {
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return null;
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      return null;
    }
    return store.findAccountIdByTokenHash(sha256(token));
  }

  app.get('/api/v1/health', async () => ({
    ok: true,
    name: NAME,
    version: VERSION,
    time: new Date().toISOString(),
  }));

  app.post('/api/v1/accounts', async (_req, reply) => {
    const token = randomBytes(32).toString('hex');
    const accountId = await store.createAccount(sha256(token));
    reply.code(201);
    return { accountId, token };
  });

  app.get('/api/v1/save', async (req, reply) => {
    const accountId = await authenticate(req);
    if (!accountId) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    const record = await store.getSave(accountId);
    if (!record) {
      return { code: null, score: 0, rev: 0, updatedAt: null };
    }
    return {
      code: record.code,
      score: record.score,
      rev: record.rev,
      updatedAt: record.updatedAt,
    };
  });

  app.put('/api/v1/save', async (req, reply) => {
    const accountId = await authenticate(req);
    if (!accountId) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    const body = req.body as { code?: unknown } | undefined;
    if (!body || typeof body.code !== 'string') {
      reply.code(400);
      return { error: 'missing save code' };
    }
    const decoded = decodeAndSanitize(body.code);
    if (!decoded) {
      reply.code(422);
      return { error: 'invalid save code' };
    }
    const result = await store.putSave(accountId, decoded.code, decoded.data, decoded.score);
    if (!result.applied) {
      // A save with more progress already exists — hand it back so the client
      // can adopt it instead of overwriting.
      reply.code(409);
      return {
        ok: false,
        stale: true,
        code: result.record.code,
        score: result.record.score,
        rev: result.record.rev,
        updatedAt: result.record.updatedAt,
      };
    }
    return {
      ok: true,
      score: result.record.score,
      rev: result.record.rev,
      updatedAt: result.record.updatedAt,
    };
  });

  return app;
}
