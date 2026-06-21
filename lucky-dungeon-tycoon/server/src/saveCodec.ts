/**
 * saveCodec.ts — Decode, validate and re-encode a cloud save.
 *
 * The wire format is the exact same base64 "backup code" the client already
 * produces (GameStateManager.exportSave). The server decodes it, runs it
 * through the shared GameStateManager.sanitize — the single source of truth for
 * anti-tamper clamping — then re-encodes the *clamped* profile. Storing the
 * sanitised version means every device that pulls a save gets a clean state,
 * and the score (lifetime gold) is computed from trusted, clamped data.
 */

import { GameStateManager } from '../../src/GameStateManager.js';

// One shared instance; sanitize is pure and never touches its storage backend.
const stateManager = new GameStateManager();

export interface DecodedSave {
  /** Re-encoded backup code of the sanitised profile. */
  code: string;
  /** The sanitised profile object. */
  data: Record<string, unknown>;
  /** Conflict-resolution metric: floored lifetime gold earned. */
  score: number;
}

/** UTF-8-safe base64, mirroring the client's exportSave/importSave encoding. */
function decodeBase64(code: string): string {
  return decodeURIComponent(atob(code));
}
function encodeBase64(json: string): string {
  return btoa(encodeURIComponent(json));
}

/**
 * Decodes, sanitises and re-encodes a save code. Returns null when the code is
 * not valid base64-JSON of an object (so the caller can answer 422). Any
 * out-of-range field is clamped rather than rejected.
 */
export function decodeAndSanitize(code: string): DecodedSave | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64(code.trim()));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const clean = stateManager.sanitize(parsed as Record<string, unknown>);
  const data = clean as unknown as Record<string, unknown>;
  const lifetime = clean.stats?.goldEarnedAll ?? 0;
  const score = Number.isFinite(lifetime) ? Math.max(0, Math.floor(lifetime)) : 0;
  return { code: encodeBase64(JSON.stringify(clean)), data, score };
}
