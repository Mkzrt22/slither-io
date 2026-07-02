/**
 * saveCodec.ts — Decode, validate and re-encode a cloud save.
 *
 * The wire format is the exact base64 "backup code" the client produces
 * (FactoryGame.exportSave). The server decodes it, runs it through the shared
 * FactoryGame.sanitize — the single source of truth for anti-tamper clamping —
 * then re-encodes the clamped state. The conflict-resolution score is the
 * sanitised lifetime cash (stats.cashAll), so an out-of-date device can never
 * overwrite newer progress.
 */

import { FactoryGame } from '../../src/factory/FactoryGame.js';

// A no-op store: sanitize/export never touch persistence, but the controller
// needs a store to construct.
const noopStore = {
  getItem: (): string | null => null,
  setItem: (): void => {},
  removeItem: (): void => {},
};
const game = new FactoryGame(noopStore, () => Date.now());

export interface DecodedSave {
  /** Re-encoded backup code of the sanitised state. */
  code: string;
  /** The sanitised state object. */
  data: Record<string, unknown>;
  /** Conflict-resolution metric: floored lifetime cash earned. */
  score: number;
}

/** UTF-8-safe base64, matching the client's FactoryGame encode/decode. */
function decodeBase64(code: string): string {
  return decodeURIComponent(escape(atob(code.trim())));
}
function encodeBase64(json: string): string {
  return btoa(unescape(encodeURIComponent(json)));
}

/**
 * Decodes, sanitises and re-encodes a save code. Returns null when the code is
 * not valid base64-JSON of a factory save (so the caller can answer 422). Any
 * out-of-range field is clamped rather than rejected.
 */
export function decodeAndSanitize(code: string): DecodedSave | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64(code));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.kind !== 'factory') {
    return null;
  }
  const clean = game.sanitize(obj as never);
  const data = clean as unknown as Record<string, unknown>;
  const lifetime = clean.stats?.cashAll ?? 0;
  const score = Number.isFinite(lifetime) ? Math.max(0, Math.floor(lifetime)) : 0;
  return { code: encodeBase64(JSON.stringify(clean)), data, score };
}
