/**
 * store.ts — Persistence contract for the Lucky City Tycoon backend.
 *
 * Two implementations satisfy this interface: an in-memory store (tests/dev)
 * and a Postgres store (production). Conflict resolution is "highest progress
 * wins": a save is only accepted when its score (lifetime gold) is at least the
 * stored score, so an out-of-date device can never clobber newer progress.
 */

import { randomUUID } from 'node:crypto';

export interface SaveRecord {
  /** Sanitised, portable save code (base64 of the clamped profile JSON). */
  code: string;
  /** The sanitised profile, kept structured for future queries (leaderboards). */
  data: Record<string, unknown>;
  /** Progress metric used for conflict resolution (lifetime gold earned). */
  score: number;
  /** Monotonic revision, bumped on every accepted write. */
  rev: number;
  /** ISO-8601 timestamp of the last accepted write. */
  updatedAt: string;
}

export interface PutResult {
  /** True when the incoming save was stored; false when rejected as stale. */
  applied: boolean;
  /** The resulting record (the new one if applied, else the current cloud one). */
  record: SaveRecord;
}

export interface Store {
  /** Prepares the backend (creates tables, opens pools). Idempotent. */
  init(): Promise<void>;
  /** Releases resources. */
  close(): Promise<void>;
  /** Creates an anonymous account keyed by a token hash; returns its id. */
  createAccount(tokenHash: string): Promise<string>;
  /** Resolves a token hash to an account id, or null when unknown. */
  findAccountIdByTokenHash(tokenHash: string): Promise<string | null>;
  /** Returns the stored save for an account, or null when none exists yet. */
  getSave(accountId: string): Promise<SaveRecord | null>;
  /** Stores the save iff score >= current; returns applied flag + record. */
  putSave(
    accountId: string,
    code: string,
    data: Record<string, unknown>,
    score: number,
  ): Promise<PutResult>;
}

/** In-memory store for tests and zero-config local dev. Not persistent. */
export class MemoryStore implements Store {
  private readonly accounts = new Map<string, string>(); // tokenHash -> accountId
  private readonly saves = new Map<string, SaveRecord>(); // accountId -> record

  public async init(): Promise<void> {
    /* nothing to do */
  }

  public async close(): Promise<void> {
    /* nothing to do */
  }

  public async createAccount(tokenHash: string): Promise<string> {
    const id = randomUUID();
    this.accounts.set(tokenHash, id);
    return id;
  }

  public async findAccountIdByTokenHash(tokenHash: string): Promise<string | null> {
    return this.accounts.get(tokenHash) ?? null;
  }

  public async getSave(accountId: string): Promise<SaveRecord | null> {
    return this.saves.get(accountId) ?? null;
  }

  public async putSave(
    accountId: string,
    code: string,
    data: Record<string, unknown>,
    score: number,
  ): Promise<PutResult> {
    const current = this.saves.get(accountId);
    if (current && score < current.score) {
      return { applied: false, record: current };
    }
    const record: SaveRecord = {
      code,
      data,
      score,
      rev: (current?.rev ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.saves.set(accountId, record);
    return { applied: true, record };
  }
}
