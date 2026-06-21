/**
 * pgStore.ts — Postgres-backed Store for production.
 *
 * Tables are created on init() (CREATE TABLE IF NOT EXISTS), so a fresh
 * database needs no separate migration step. The save upsert performs the
 * "highest progress wins" conflict check atomically inside a single statement.
 */

import pg from 'pg';
import { PutResult, SaveRecord, Store } from './store.js';

const { Pool } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saves (
  account_id  UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  data        JSONB NOT NULL,
  score       BIGINT NOT NULL DEFAULT 0,
  rev         BIGINT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saves_score_idx ON saves (score DESC);
`;

interface SaveRow {
  code: string;
  data: Record<string, unknown>;
  score: string | number;
  rev: string | number;
  updated_at: Date | string;
}

function toRecord(row: SaveRow): SaveRecord {
  return {
    code: row.code,
    data: row.data,
    score: Number(row.score),
    rev: Number(row.rev),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;

  public constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  public async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async createAccount(tokenHash: string): Promise<string> {
    const r = await this.pool.query<{ id: string }>(
      'INSERT INTO accounts (token_hash) VALUES ($1) RETURNING id',
      [tokenHash],
    );
    return r.rows[0].id;
  }

  public async findAccountIdByTokenHash(tokenHash: string): Promise<string | null> {
    const r = await this.pool.query<{ id: string }>(
      'SELECT id FROM accounts WHERE token_hash = $1',
      [tokenHash],
    );
    return r.rows[0]?.id ?? null;
  }

  public async getSave(accountId: string): Promise<SaveRecord | null> {
    const r = await this.pool.query<SaveRow>(
      'SELECT code, data, score, rev, updated_at FROM saves WHERE account_id = $1',
      [accountId],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  public async putSave(
    accountId: string,
    code: string,
    data: Record<string, unknown>,
    score: number,
  ): Promise<PutResult> {
    // Insert, or update only when the incoming score is at least the stored one.
    const r = await this.pool.query<SaveRow>(
      `INSERT INTO saves (account_id, code, data, score, rev, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, 1, now())
       ON CONFLICT (account_id) DO UPDATE
         SET code = EXCLUDED.code,
             data = EXCLUDED.data,
             score = EXCLUDED.score,
             rev = saves.rev + 1,
             updated_at = now()
         WHERE EXCLUDED.score >= saves.score
       RETURNING code, data, score, rev, updated_at`,
      [accountId, code, JSON.stringify(data), score],
    );
    if (r.rows[0]) {
      return { applied: true, record: toRecord(r.rows[0]) };
    }
    // The WHERE guard rejected the write as stale — return the current record.
    const current = await this.getSave(accountId);
    // current cannot be null here (a conflicting row exists), but stay defensive.
    return { applied: false, record: current ?? toRecord({ code, data, score, rev: 0, updated_at: new Date() }) };
  }
}
