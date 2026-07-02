/**
 * api.test.ts — End-to-end API behaviour over the in-memory store, exercised
 * through Fastify's inject() (no network). Covers account creation, the cloud
 * save round-trip, the "highest progress wins" conflict rule, auth rejection,
 * and malformed-save rejection.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/store.js';
import { createDefaultFactory } from '../../src/factory/types.js';

/** Encodes a factory save the same way the client's exportSave does. */
function encode(obj: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}
function makeSaveCode(cashAll: number): string {
  const state = createDefaultFactory(Date.now());
  state.stats.cashAll = cashAll;
  return encode(state);
}

async function freshAccount(app: ReturnType<typeof buildApp>): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/accounts' });
  assert.equal(res.statusCode, 201);
  const token = res.json().token as string;
  assert.ok(token && token.length >= 32);
  return token;
}

test('health endpoint reports ok', async () => {
  const app = buildApp(new MemoryStore());
  const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
});

test('account creation returns a unique account + token', async () => {
  const app = buildApp(new MemoryStore());
  const a = await app.inject({ method: 'POST', url: '/api/v1/accounts' });
  const b = await app.inject({ method: 'POST', url: '/api/v1/accounts' });
  assert.notEqual(a.json().accountId, b.json().accountId);
  assert.notEqual(a.json().token, b.json().token);
});

test('a new account has no cloud save yet', async () => {
  const app = buildApp(new MemoryStore());
  const token = await freshAccount(app);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/save',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().code, null);
});

test('save round-trips and exposes the trusted score', async () => {
  const app = buildApp(new MemoryStore());
  const token = await freshAccount(app);
  const put = await app.inject({
    method: 'PUT',
    url: '/api/v1/save',
    headers: { authorization: `Bearer ${token}` },
    payload: { code: makeSaveCode(5000) },
  });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().ok, true);
  assert.equal(put.json().score, 5000);

  const get = await app.inject({
    method: 'GET',
    url: '/api/v1/save',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(get.json().score, 5000);
  assert.equal(typeof get.json().code, 'string');
});

test('a lower-progress save is rejected and the cloud save is returned', async () => {
  const app = buildApp(new MemoryStore());
  const token = await freshAccount(app);
  await app.inject({
    method: 'PUT',
    url: '/api/v1/save',
    headers: { authorization: `Bearer ${token}` },
    payload: { code: makeSaveCode(5000) },
  });
  const stale = await app.inject({
    method: 'PUT',
    url: '/api/v1/save',
    headers: { authorization: `Bearer ${token}` },
    payload: { code: makeSaveCode(1000) },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().score, 5000);
});

test('a higher-progress save overwrites and bumps the revision', async () => {
  const app = buildApp(new MemoryStore());
  const token = await freshAccount(app);
  const first = await app.inject({
    method: 'PUT',
    url: '/api/v1/save',
    headers: { authorization: `Bearer ${token}` },
    payload: { code: makeSaveCode(5000) },
  });
  const second = await app.inject({
    method: 'PUT',
    url: '/api/v1/save',
    headers: { authorization: `Bearer ${token}` },
    payload: { code: makeSaveCode(9000) },
  });
  assert.equal(second.json().ok, true);
  assert.equal(second.json().score, 9000);
  assert.ok(second.json().rev > first.json().rev);
});

test('save requires a valid bearer token', async () => {
  const app = buildApp(new MemoryStore());
  const res = await app.inject({ method: 'GET', url: '/api/v1/save' });
  assert.equal(res.statusCode, 401);
  const bad = await app.inject({
    method: 'GET',
    url: '/api/v1/save',
    headers: { authorization: 'Bearer not-a-real-token' },
  });
  assert.equal(bad.statusCode, 401);
});

test('a malformed save code is rejected with 422', async () => {
  const app = buildApp(new MemoryStore());
  const token = await freshAccount(app);
  const res = await app.inject({
    method: 'PUT',
    url: '/api/v1/save',
    headers: { authorization: `Bearer ${token}` },
    payload: { code: 'this-is-not-base64-json!!!' },
  });
  assert.equal(res.statusCode, 422);
});

test('a tampered save is clamped server-side (anti-cheat)', async () => {
  const app = buildApp(new MemoryStore());
  const token = await freshAccount(app);
  // Hand-edit a save with a negative cash balance and a broken station level.
  const state = createDefaultFactory(Date.now()) as unknown as Record<string, unknown>;
  state.cash = -1000;
  (state.stations as Record<string, unknown>).cooking = { level: -5, workers: NaN, output: Infinity };
  const code = encode(state);
  await app.inject({
    method: 'PUT',
    url: '/api/v1/save',
    headers: { authorization: `Bearer ${token}` },
    payload: { code },
  });
  const get = await app.inject({
    method: 'GET',
    url: '/api/v1/save',
    headers: { authorization: `Bearer ${token}` },
  });
  const stored = JSON.parse(decodeURIComponent(escape(atob(get.json().code as string))));
  assert.ok(stored.cash >= 0, 'negative cash reset to a valid value');
  assert.equal(stored.stations.cooking.level, 1, 'broken station level clamped to 1');
  assert.ok(Number.isFinite(stored.stations.cooking.output), 'infinite output sanitised');
});
