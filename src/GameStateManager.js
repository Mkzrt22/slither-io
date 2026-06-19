/**
 * GameStateManager.ts — State, Time & Anti-Cheat (Lucky Dungeon Tycoon)
 *
 * Owns persistence (localStorage in a webview, in-memory fallback elsewhere),
 * offline-time simulation (energy regen + raid determinator), and defensive
 * sanitisation of everything read from storage. Storage is user-writable on
 * mobile, so every loaded value is treated as hostile until clamped.
 */
import { EconomyEngine } from './EconomyEngine.js';
import { RELIC_UPGRADES, RelicShopEngine } from './RelicShopEngine.js';
import { VillageEngine } from './VillageEngine.js';
import { BUILDING_TYPES, DEFAULT_GAME_CONFIG, MAX_SHIELDS, MINER_TIERS, cloneProfile, createDefaultProfile, createEmptyBuildings, createEmptyMiners, createEmptyStats, creditGold, } from './types.js';
/** UTF-8-safe base64 (btoa/atob exist in browsers and Node 18+). */
function base64Encode(s) {
    return btoa(encodeURIComponent(s));
}
function base64Decode(s) {
    return decodeURIComponent(atob(s));
}
/** In-memory store used when no DOM localStorage exists (tests, Node, SSR). */
class MemoryStore {
    constructor() {
        this.map = new Map();
    }
    getItem(key) {
        const value = this.map.get(key);
        return value === undefined ? null : value;
    }
    setItem(key, value) {
        this.map.set(key, value);
    }
    removeItem(key) {
        this.map.delete(key);
    }
}
/** Offline raids only become possible after this much absence (4 hours). */
const RAID_THRESHOLD_SECONDS = 14400;
/** Probability that an enemy AI attacks an eligible offline player. */
const RAID_CHANCE = 0.7;
/** Fraction of gold stolen by an unblocked raid. */
const RAID_GOLD_TAX = 0.15;
/**
 * Offline windows are credited up to this cap (7 days) so a device with a
 * corrupted or maliciously rewound clock cannot mint unbounded regen time.
 */
const MAX_OFFLINE_SECONDS = 7 * 24 * 60 * 60;
/**
 * Absolute ceiling for loaded energy. Purchased energy intentionally
 * overfills past maxEnergy and must survive a restart, so the anti-tamper
 * clamp cannot use maxEnergy itself; this bound merely keeps a hand-edited
 * save from minting unbounded spins.
 */
const ENERGY_ABSOLUTE_CAP = 999;
export class GameStateManager {
    /**
     * @param storageKey localStorage key under which the profile is persisted.
     * @param rng        Random source for the raid determinator. Injectable so
     *                   tests can force deterministic raid outcomes.
     * @param store      Storage backend override; defaults to DOM localStorage
     *                   when present, otherwise an in-memory store.
     */
    constructor(storageKey = 'ldt_user_state', rng = Math.random, store) {
        this.storageKey = storageKey;
        this.rng = rng;
        this.store = store ?? GameStateManager.resolveDefaultStore();
    }
    /**
     * Loads the persisted profile, applies offline simulation for the elapsed
     * wall-clock time, persists the caught-up state, and returns it. A missing
     * or unreadable record yields a fresh default profile.
     */
    loadState() {
        const { state } = this.loadStateWithLogs();
        return state;
    }
    /**
     * Same as loadState, but also surfaces the human-readable offline event log
     * ("Shield blocked raid", "+N energy", ...) for the welcome-back popup.
     */
    loadStateWithLogs() {
        const now = Date.now();
        const raw = this.readRaw();
        if (raw === null) {
            const fresh = createDefaultProfile(now);
            this.saveState(fresh);
            return {
                state: fresh, logs: [],
                summary: { seconds: 0, energyEarned: 0, goldEarned: 0, raidGold: 0, shieldBlocked: false },
            };
        }
        const loaded = this.sanitizeProfile(raw, now);
        // Timestamp validation: a save stamped in the future means the device
        // clock moved backwards (or the record was tampered with). Grant zero
        // offline time rather than a negative window.
        const elapsedMs = Math.max(0, now - loaded.lastSaveTimestamp);
        const timeDiffSeconds = Math.min(Math.floor(elapsedMs / 1000), MAX_OFFLINE_SECONDS);
        const { state, logs, summary } = this.applyOfflineRegen(loaded, timeDiffSeconds);
        state.lastSaveTimestamp = now;
        this.saveState(state);
        return { state, logs, summary };
    }
    /**
     * Pure offline simulation over a window of `timeDiffSeconds`:
     *
     *  1. Energy regen: +1 energy per `energyRegenTimeSeconds` (300s), capped
     *     at `maxEnergy`.
     *  2. Passive income: miners keep digging at half efficiency while the
     *     game is closed, credited for at most 8 hours per absence.
     *  3. Offline Raid Determinator: if the window is >= 4 hours, there is a
     *     70% chance of an enemy AI attack. A shield (if any) absorbs it;
     *     otherwise the raid steals 15% of the player's gold.
     *
     * The input state is not mutated; a simulated copy plus an event log is
     * returned.
     */
    applyOfflineRegen(state, timeDiffSeconds) {
        const next = cloneProfile(state);
        const logs = [];
        const summary = {
            seconds: 0, energyEarned: 0, goldEarned: 0, raidGold: 0, shieldBlocked: false,
        };
        const safeSeconds = Number.isFinite(timeDiffSeconds) && timeDiffSeconds > 0
            ? Math.min(Math.floor(timeDiffSeconds), MAX_OFFLINE_SECONDS)
            : 0;
        summary.seconds = safeSeconds;
        // --- 1. Energy recovery -------------------------------------------------
        const regenerated = Math.floor(safeSeconds / DEFAULT_GAME_CONFIG.energyRegenTimeSeconds);
        if (regenerated > 0 && next.energy < next.maxEnergy) {
            const granted = Math.min(regenerated, next.maxEnergy - next.energy);
            next.energy += granted;
            summary.energyEarned = granted;
            logs.push(`Recovered ${granted} energy while away`);
        }
        // --- 2. Offline passive income (Farm synergy raises efficiency & cap) ----
        const passiveSeconds = Math.min(safeSeconds, VillageEngine.getOfflineCapSeconds(next));
        const rate = EconomyEngine.getPassiveRate(next);
        if (rate > 0 && passiveSeconds > 0) {
            const earned = Math.floor(rate * passiveSeconds *
                VillageEngine.getOfflineEfficiency(next) *
                RelicShopEngine.getOfflineMultiplier(next));
            if (earned > 0) {
                creditGold(next, earned);
                summary.goldEarned = earned;
                logs.push(`Production hors-ligne : +${EconomyEngine.formatCurrency(earned)} or`);
            }
        }
        // --- 3. Offline Raid Determinator ---------------------------------------
        if (safeSeconds >= RAID_THRESHOLD_SECONDS) {
            const raidOccurred = this.rng() < RAID_CHANCE;
            if (raidOccurred) {
                if (next.shields > 0) {
                    next.shields -= 1;
                    summary.shieldBlocked = true;
                    logs.push('Shield blocked raid');
                }
                else {
                    const stolen = Math.floor(next.gold * RAID_GOLD_TAX);
                    next.gold = Math.max(0, next.gold - stolen);
                    summary.raidGold = stolen;
                    logs.push(`Raid stole ${stolen} gold`);
                }
            }
        }
        return { state: next, logs, summary };
    }
    /**
     * Persists the profile, stamping `lastSaveTimestamp` so the next launch
     * measures offline time from this moment. Storage failures (quota, private
     * browsing) are swallowed: losing one save beats crashing the game loop.
     */
    saveState(state) {
        state.lastSaveTimestamp = Date.now();
        try {
            this.store.setItem(this.storageKey, JSON.stringify(state));
        }
        catch {
            // Intentionally ignored — see doc comment.
        }
    }
    /**
     * Serialises a profile into a portable, copy-pasteable backup code
     * (base64). Used by the settings "export save" action.
     */
    exportSave(state) {
        const json = JSON.stringify(state);
        try {
            return base64Encode(json);
        }
        catch {
            return '';
        }
    }
    /**
     * Validates and persists a backup code so the next `loadState` adopts it.
     * Returns false (without touching storage) when the code is malformed.
     * The loaded record is still run through full sanitisation on load.
     */
    importSave(code) {
        let parsed;
        try {
            parsed = JSON.parse(base64Decode(code.trim()));
        }
        catch {
            return false;
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return false;
        }
        try {
            this.store.setItem(this.storageKey, JSON.stringify(parsed));
            return true;
        }
        catch {
            return false;
        }
    }
    /** Deletes the persisted record (debug / "reset progress" flows). */
    clearState() {
        try {
            this.store.removeItem(this.storageKey);
        }
        catch {
            // Removal failures are non-fatal for the same reason as save failures.
        }
    }
    /** Reads and JSON-parses the raw record; null on absence or corruption. */
    readRaw() {
        let serialized;
        try {
            serialized = this.store.getItem(this.storageKey);
        }
        catch {
            return null;
        }
        if (serialized === null) {
            return null;
        }
        try {
            const parsed = JSON.parse(serialized);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                return parsed;
            }
            return null;
        }
        catch {
            return null;
        }
    }
    /**
     * Rebuilds a guaranteed-valid UserProfile from untrusted parsed JSON.
     * Every field is clamped to its documented domain; anything missing or
     * malformed falls back to the default-profile value.
     */
    sanitizeProfile(raw, now) {
        const defaults = createDefaultProfile(now);
        const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : defaults.id;
        const maxEnergy = Math.max(1, this.toBoundedInt(raw.maxEnergy, defaults.maxEnergy));
        return {
            id,
            gold: this.toBoundedNumber(raw.gold, defaults.gold),
            gems: this.toBoundedInt(raw.gems, defaults.gems),
            energy: Math.min(this.toBoundedInt(raw.energy, defaults.energy), ENERGY_ABSOLUTE_CAP),
            maxEnergy,
            dungeonLevel: this.toBoundedInt(raw.dungeonLevel, defaults.dungeonLevel),
            shields: Math.min(this.toBoundedInt(raw.shields, defaults.shields), MAX_SHIELDS),
            floor: Math.max(1, this.toBoundedInt(raw.floor, defaults.floor)),
            bossHp: this.toBossHp(raw.bossHp),
            village: Math.max(1, this.toBoundedInt(raw.village, defaults.village)),
            buildings: this.toBuildings(raw.buildings),
            miners: this.toMiners(raw.miners),
            relics: this.toBoundedInt(raw.relics, defaults.relics),
            boostEndsAt: this.toBoostEnd(raw.boostEndsAt, now),
            lastDailyClaim: this.toClaimTime(raw.lastDailyClaim, now),
            dailyStreak: this.toBoundedInt(raw.dailyStreak, 0),
            stats: this.toStats(raw.stats),
            claimedQuests: this.toStringArray(raw.claimedQuests),
            relicUpgrades: this.toRelicUpgrades(raw.relicUpgrades),
            lastSaveTimestamp: this.toTimestamp(raw.lastSaveTimestamp, now),
        };
    }
    /**
     * Relic-shop levels: only known upgrade ids survive, each clamped to a
     * non-negative integer no greater than its catalogue maximum, so a
     * hand-edited save cannot mint unbounded prestige bonuses.
     */
    toRelicUpgrades(value) {
        const upgrades = {};
        if (typeof value === 'object' && value !== null) {
            const raw = value;
            for (const def of RELIC_UPGRADES) {
                const level = Math.min(this.toBoundedInt(raw[def.id], 0), def.maxLevel);
                if (level > 0) {
                    upgrades[def.id] = level;
                }
            }
        }
        return upgrades;
    }
    /**
     * Boost end timestamp: a finite epoch-ms value, capped at `now + 24h` so a
     * hand-edited save cannot grant a permanent production boost.
     */
    toBoostEnd(value, now) {
        if (typeof value === 'number' && Number.isFinite(value) && value > now) {
            return Math.min(Math.floor(value), now + 24 * 60 * 60 * 1000);
        }
        return 0;
    }
    /**
     * Daily-claim timestamp: 0 (never) is preserved; a real value is clamped to
     * `now` so a future-dated claim can't block the reward forever.
     */
    toClaimTime(value, now) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            return Math.min(Math.floor(value), now);
        }
        return 0;
    }
    /** Active boss HP: a finite positive number, or null (no fight). */
    toBossHp(value) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            return Math.floor(value);
        }
        return null;
    }
    /** Miner roster: each tier clamped to a non-negative integer. */
    toMiners(value) {
        const miners = createEmptyMiners();
        if (typeof value === 'object' && value !== null) {
            const raw = value;
            for (const tier of MINER_TIERS) {
                miners[tier] = this.toBoundedInt(raw[tier], 0);
            }
        }
        return miners;
    }
    /** Building roster: each type clamped to a non-negative integer level. */
    toBuildings(value) {
        const buildings = createEmptyBuildings();
        if (typeof value === 'object' && value !== null) {
            const raw = value;
            for (const type of BUILDING_TYPES) {
                buildings[type] = this.toBoundedInt(raw[type], 0);
            }
        }
        return buildings;
    }
    /** Lifetime counters: each clamped to a non-negative finite number. */
    toStats(value) {
        const stats = createEmptyStats();
        if (typeof value === 'object' && value !== null) {
            const raw = value;
            stats.goldEarnedRun = this.toBoundedNumber(raw.goldEarnedRun, 0);
            stats.goldEarnedAll = this.toBoundedNumber(raw.goldEarnedAll, 0);
            stats.totalSpins = this.toBoundedInt(raw.totalSpins, 0);
            stats.bossesKilled = this.toBoundedInt(raw.bossesKilled, 0);
            stats.prestiges = this.toBoundedInt(raw.prestiges, 0);
        }
        return stats;
    }
    /** Claimed-quest ids: strings only, deduplicated. */
    toStringArray(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        return [...new Set(value.filter((v) => typeof v === 'string'))];
    }
    /** Finite, non-negative number; otherwise the fallback. */
    toBoundedNumber(value, fallback) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
            return value;
        }
        return fallback;
    }
    /** Finite, non-negative integer; otherwise the fallback. */
    toBoundedInt(value, fallback) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
            return Math.floor(value);
        }
        return fallback;
    }
    /**
     * Valid save timestamp: a finite positive epoch-ms value no later than
     * `now`. Future-dated stamps are clamped to `now` (zero offline credit).
     */
    toTimestamp(value, now) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            return Math.min(Math.floor(value), now);
        }
        return now;
    }
    static resolveDefaultStore() {
        // `globalThis.localStorage` exists in browsers and webviews; accessing it
        // can itself throw in some privacy modes, hence the try/catch probe.
        try {
            const candidate = globalThis
                .localStorage;
            if (candidate &&
                typeof candidate.getItem === 'function' &&
                typeof candidate.setItem === 'function' &&
                typeof candidate.removeItem === 'function') {
                return candidate;
            }
        }
        catch {
            // Fall through to the in-memory store.
        }
        return new MemoryStore();
    }
}
