/**
 * GameStateManager.ts — State, Time & Anti-Cheat (Lucky Dungeon Tycoon)
 *
 * Owns persistence (localStorage in a webview, in-memory fallback elsewhere),
 * offline-time simulation (energy regen + raid determinator), and defensive
 * sanitisation of everything read from storage. Storage is user-writable on
 * mobile, so every loaded value is treated as hostile until clamped.
 */

import {
  DEFAULT_GAME_CONFIG,
  MAX_SHIELDS,
  UserProfile,
  cloneProfile,
  createDefaultProfile,
} from './types.js';

/** Minimal key-value contract satisfied by both DOM Storage and the fallback. */
interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory store used when no DOM localStorage exists (tests, Node, SSR). */
class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  public getItem(key: string): string | null {
    const value = this.map.get(key);
    return value === undefined ? null : value;
  }

  public setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  public removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Offline raids only become possible after this much absence (4 hours). */
const RAID_THRESHOLD_SECONDS = 14_400;
/** Probability that an enemy AI attacks an eligible offline player. */
const RAID_CHANCE = 0.7;
/** Fraction of gold stolen by an unblocked raid. */
const RAID_GOLD_TAX = 0.15;
/**
 * Offline windows are credited up to this cap (7 days) so a device with a
 * corrupted or maliciously rewound clock cannot mint unbounded regen time.
 */
const MAX_OFFLINE_SECONDS = 7 * 24 * 60 * 60;

export class GameStateManager {
  private readonly store: KeyValueStore;
  private readonly rng: () => number;

  /**
   * @param storageKey localStorage key under which the profile is persisted.
   * @param rng        Random source for the raid determinator. Injectable so
   *                   tests can force deterministic raid outcomes.
   * @param store      Storage backend override; defaults to DOM localStorage
   *                   when present, otherwise an in-memory store.
   */
  constructor(
    private readonly storageKey: string = 'ldt_user_state',
    rng: () => number = Math.random,
    store?: KeyValueStore,
  ) {
    this.rng = rng;
    this.store = store ?? GameStateManager.resolveDefaultStore();
  }

  /**
   * Loads the persisted profile, applies offline simulation for the elapsed
   * wall-clock time, persists the caught-up state, and returns it. A missing
   * or unreadable record yields a fresh default profile.
   */
  public loadState(): UserProfile {
    const { state } = this.loadStateWithLogs();
    return state;
  }

  /**
   * Same as loadState, but also surfaces the human-readable offline event log
   * ("Shield blocked raid", "+N energy", ...) for the welcome-back popup.
   */
  public loadStateWithLogs(): { state: UserProfile; logs: string[] } {
    const now = Date.now();
    const raw = this.readRaw();

    if (raw === null) {
      const fresh = createDefaultProfile(now);
      this.saveState(fresh);
      return { state: fresh, logs: [] };
    }

    const loaded = this.sanitizeProfile(raw, now);

    // Timestamp validation: a save stamped in the future means the device
    // clock moved backwards (or the record was tampered with). Grant zero
    // offline time rather than a negative window.
    const elapsedMs = Math.max(0, now - loaded.lastSaveTimestamp);
    const timeDiffSeconds = Math.min(
      Math.floor(elapsedMs / 1000),
      MAX_OFFLINE_SECONDS,
    );

    const { state, logs } = this.applyOfflineRegen(loaded, timeDiffSeconds);
    state.lastSaveTimestamp = now;
    this.saveState(state);
    return { state, logs };
  }

  /**
   * Pure offline simulation over a window of `timeDiffSeconds`:
   *
   *  1. Energy regen: +1 energy per `energyRegenTimeSeconds` (300s), capped
   *     at `maxEnergy`.
   *  2. Offline Raid Determinator: if the window is >= 4 hours, there is a
   *     70% chance of an enemy AI attack. A shield (if any) absorbs it;
   *     otherwise the raid steals 15% of the player's gold.
   *
   * The input state is not mutated; a simulated copy plus an event log is
   * returned.
   */
  public applyOfflineRegen(
    state: UserProfile,
    timeDiffSeconds: number,
  ): { state: UserProfile; logs: string[] } {
    const next = cloneProfile(state);
    const logs: string[] = [];

    const safeSeconds =
      Number.isFinite(timeDiffSeconds) && timeDiffSeconds > 0
        ? Math.min(Math.floor(timeDiffSeconds), MAX_OFFLINE_SECONDS)
        : 0;

    // --- 1. Energy recovery -------------------------------------------------
    const regenerated = Math.floor(
      safeSeconds / DEFAULT_GAME_CONFIG.energyRegenTimeSeconds,
    );
    if (regenerated > 0 && next.energy < next.maxEnergy) {
      const granted = Math.min(regenerated, next.maxEnergy - next.energy);
      next.energy += granted;
      logs.push(`Recovered ${granted} energy while away`);
    }

    // --- 2. Offline Raid Determinator ---------------------------------------
    if (safeSeconds >= RAID_THRESHOLD_SECONDS) {
      const raidOccurred = this.rng() < RAID_CHANCE;
      if (raidOccurred) {
        if (next.shields > 0) {
          next.shields -= 1;
          logs.push('Shield blocked raid');
        } else {
          const stolen = Math.floor(next.gold * RAID_GOLD_TAX);
          next.gold = Math.max(0, next.gold - stolen);
          logs.push(`Raid stole ${stolen} gold`);
        }
      }
    }

    return { state: next, logs };
  }

  /**
   * Persists the profile, stamping `lastSaveTimestamp` so the next launch
   * measures offline time from this moment. Storage failures (quota, private
   * browsing) are swallowed: losing one save beats crashing the game loop.
   */
  public saveState(state: UserProfile): void {
    state.lastSaveTimestamp = Date.now();
    try {
      this.store.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // Intentionally ignored — see doc comment.
    }
  }

  /** Deletes the persisted record (debug / "reset progress" flows). */
  public clearState(): void {
    try {
      this.store.removeItem(this.storageKey);
    } catch {
      // Removal failures are non-fatal for the same reason as save failures.
    }
  }

  /** Reads and JSON-parses the raw record; null on absence or corruption. */
  private readRaw(): Record<string, unknown> | null {
    let serialized: string | null;
    try {
      serialized = this.store.getItem(this.storageKey);
    } catch {
      return null;
    }
    if (serialized === null) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Rebuilds a guaranteed-valid UserProfile from untrusted parsed JSON.
   * Every field is clamped to its documented domain; anything missing or
   * malformed falls back to the default-profile value.
   */
  private sanitizeProfile(
    raw: Record<string, unknown>,
    now: number,
  ): UserProfile {
    const defaults = createDefaultProfile(now);

    const id =
      typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : defaults.id;

    const maxEnergy = Math.max(
      1,
      this.toBoundedInt(raw.maxEnergy, defaults.maxEnergy),
    );

    return {
      id,
      gold: this.toBoundedNumber(raw.gold, defaults.gold),
      gems: this.toBoundedInt(raw.gems, defaults.gems),
      energy: Math.min(this.toBoundedInt(raw.energy, defaults.energy), maxEnergy),
      maxEnergy,
      dungeonLevel: this.toBoundedInt(raw.dungeonLevel, defaults.dungeonLevel),
      shields: Math.min(this.toBoundedInt(raw.shields, defaults.shields), MAX_SHIELDS),
      lastSaveTimestamp: this.toTimestamp(raw.lastSaveTimestamp, now),
    };
  }

  /** Finite, non-negative number; otherwise the fallback. */
  private toBoundedNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
    return fallback;
  }

  /** Finite, non-negative integer; otherwise the fallback. */
  private toBoundedInt(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
    return fallback;
  }

  /**
   * Valid save timestamp: a finite positive epoch-ms value no later than
   * `now`. Future-dated stamps are clamped to `now` (zero offline credit).
   */
  private toTimestamp(value: unknown, now: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.min(Math.floor(value), now);
    }
    return now;
  }

  private static resolveDefaultStore(): KeyValueStore {
    // `globalThis.localStorage` exists in browsers and webviews; accessing it
    // can itself throw in some privacy modes, hence the try/catch probe.
    try {
      const candidate = (globalThis as { localStorage?: KeyValueStore })
        .localStorage;
      if (
        candidate &&
        typeof candidate.getItem === 'function' &&
        typeof candidate.setItem === 'function' &&
        typeof candidate.removeItem === 'function'
      ) {
        return candidate;
      }
    } catch {
      // Fall through to the in-memory store.
    }
    return new MemoryStore();
  }
}
