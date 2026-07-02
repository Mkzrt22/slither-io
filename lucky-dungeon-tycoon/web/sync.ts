/**
 * sync.ts — Cloud-save client (offline-first).
 *
 * A thin wrapper over the backend API. It never blocks the game: the player
 * always boots and plays from localStorage, and every network call fails soft
 * (returns null / 'error') so the game is identical to before when the server
 * is unreachable or unconfigured.
 *
 * The wire format is the very same base64 "backup code" the game already uses
 * for manual export/import (GameController.exportSave / importSave), so adopting
 * a cloud save is just `controller.importSave(code)`.
 */

import { API_BASE, SYNC_CONFIGURED } from './config.js';

const TOKEN_KEY = 'lct_cloud_token';
const ACCOUNT_KEY = 'lct_cloud_account';

export interface CloudSnapshot {
  /** Cloud save backup code, or null when the account has no save yet. */
  code: string | null;
  /** Progress metric (lifetime gold) of the cloud save. */
  score: number;
  /** Cloud revision counter. */
  rev: number;
}

export type PushStatus =
  | { status: 'ok' }
  | { status: 'stale'; snapshot: CloudSnapshot }
  | { status: 'error' };

export class CloudSync {
  private readonly base: string;

  public constructor(base: string = API_BASE) {
    this.base = base.replace(/\/+$/, '');
  }

  /**
   * Whether sync can run. It must be configured (LCT_API_BASE set) and, for a
   * same-origin base, served over http(s) — a bundled `file://` app with no
   * absolute base stays offline.
   */
  public enabled(): boolean {
    if (!SYNC_CONFIGURED) {
      return false;
    }
    if (this.base) {
      return true;
    }
    return typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  }

  private token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  /** Creates an anonymous account on first use; true once a token is held. */
  public async ensureAccount(): Promise<boolean> {
    if (this.token()) {
      return true;
    }
    try {
      const res = await fetch(`${this.base}/api/v1/accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        return false;
      }
      const body = (await res.json()) as { token?: unknown; accountId?: unknown };
      if (typeof body.token !== 'string') {
        return false;
      }
      localStorage.setItem(TOKEN_KEY, body.token);
      if (typeof body.accountId === 'string') {
        localStorage.setItem(ACCOUNT_KEY, body.accountId);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Fetches the cloud save snapshot, or null on any failure / no account. */
  public async pull(): Promise<CloudSnapshot | null> {
    const token = this.token();
    if (!token) {
      return null;
    }
    try {
      const res = await fetch(`${this.base}/api/v1/save`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return null;
      }
      const body = (await res.json()) as Partial<CloudSnapshot>;
      return {
        code: typeof body.code === 'string' ? body.code : null,
        score: Number(body.score) || 0,
        rev: Number(body.rev) || 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Uploads a save code. `keepalive` lets the request survive page unload.
   * Returns 'ok', or 'stale' with the newer cloud snapshot to adopt, or 'error'.
   */
  public async push(code: string, keepalive = false): Promise<PushStatus> {
    const token = this.token();
    if (!token) {
      return { status: 'error' };
    }
    try {
      const res = await fetch(`${this.base}/api/v1/save`, {
        method: 'PUT',
        keepalive,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as Partial<CloudSnapshot>;
        return {
          status: 'stale',
          snapshot: {
            code: typeof body.code === 'string' ? body.code : null,
            score: Number(body.score) || 0,
            rev: Number(body.rev) || 0,
          },
        };
      }
      return res.ok ? { status: 'ok' } : { status: 'error' };
    } catch {
      return { status: 'error' };
    }
  }
}
