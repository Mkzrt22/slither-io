/**
 * FactoryGame.ts — Controller/facade over the factory simulation.
 *
 * Framework-agnostic: storage and the clock are injected, so it runs in tests
 * with a fake clock and in the browser with localStorage + Date.now. It owns
 * persistence (localStorage + a base64 backup code), offline accrual on load,
 * the real-time tick the view drives each frame, and a tiny typed event
 * emitter the view subscribes to. No rendering, no DOM.
 */
import { FactoryEngine } from './FactoryEngine.js';
import { cloneFactory, createDefaultFactory, STATION_IDS, } from './types.js';
import { RUSH_SECONDS } from './config.js';
const SAVE_KEY = 'chef_factory_save_v1';
const DAY_MS = 86400000;
export class FactoryGame {
    constructor(store, now = () => Date.now()) {
        this.store = store;
        this.now = now;
        this.listeners = {
            change: new Set(), offline: new Set(), daily: new Set(), notify: new Set(),
        };
        this.dirtyAccum = 0;
        this.pendingDaily = null;
        this.state = this.load();
    }
    // --- Events -----------------------------------------------------------------
    on(event, handler) {
        this.listeners[event].add(handler);
    }
    emit(event, payload) {
        for (const h of this.listeners[event])
            h(payload);
    }
    announce() {
        this.emit('change', cloneFactory(this.state));
    }
    getState() {
        return cloneFactory(this.state);
    }
    // --- Boot: load, accrue offline, offer daily --------------------------------
    /** Loads the save, runs offline accrual, then announces. Call once on boot. */
    start() {
        const now = this.now();
        const away = Math.max(0, (now - this.state.lastSaveAt) / 1000);
        if (away >= 60) {
            const report = FactoryEngine.accrueOffline(this.state, away, now);
            if (report.cash > 0)
                this.emit('offline', report);
        }
        this.state.lastSaveAt = now;
        this.persist();
        this.announce();
        this.offerDaily();
    }
    offerDaily() {
        const now = this.now();
        const last = this.state.lastDailyClaim;
        const dayOf = (ms) => Math.floor(ms / DAY_MS);
        if (last !== 0 && dayOf(now) === dayOf(last))
            return; // already claimed today
        const consecutive = last !== 0 && dayOf(now) - dayOf(last) === 1;
        const streak = consecutive ? this.state.dailyStreak + 1 : 1;
        const gemReward = 3 + Math.min(12, streak);
        // Daily cash scales with the line so it stays relevant late-game.
        const cashReward = Math.max(100, Math.round(FactoryEngine.revenuePerSecond(this.state, now) * 120 * streak));
        this.pendingDaily = { streak, cashReward, gemReward };
        this.emit('daily', this.pendingDaily);
    }
    /** Claims the offered daily reward. Returns it, or null if none pending. */
    claimDaily() {
        if (!this.pendingDaily)
            return null;
        const reward = this.pendingDaily;
        this.state.gems += reward.gemReward;
        this.state.cash += reward.cashReward;
        this.state.stats.cashRun += reward.cashReward;
        this.state.stats.cashAll += reward.cashReward;
        this.state.dailyStreak = reward.streak;
        this.state.lastDailyClaim = this.now();
        this.pendingDaily = null;
        this.persist();
        this.announce();
        return reward;
    }
    // --- Real-time tick (driven by the view each frame) -------------------------
    /**
     * Advances the simulation by `dt` seconds. Announces every frame (cheap —
     * the view eases its own numbers) and persists about once a second.
     */
    tick(dt) {
        if (!(dt > 0))
            return;
        FactoryEngine.tick(this.state, dt, this.now());
        this.dirtyAccum += dt;
        if (this.dirtyAccum >= 1) {
            this.dirtyAccum = 0;
            this.state.lastSaveAt = this.now();
            this.persist();
        }
        this.announce();
    }
    // --- Actions ----------------------------------------------------------------
    upgradeStation(id, mode) {
        const n = FactoryEngine.buyUpgrade(this.state, id, mode);
        if (n > 0)
            this.persistAnnounce();
        else
            this.emit('notify', { message: 'Pas assez d’argent', severity: 'warning' });
        return n;
    }
    hireWorker() {
        const ok = FactoryEngine.hireWorker(this.state);
        if (ok)
            this.persistAnnounce();
        else
            this.emit('notify', { message: 'Pas assez d’argent pour embaucher', severity: 'warning' });
        return ok;
    }
    assignWorker(id) {
        const ok = FactoryEngine.assignWorker(this.state, id);
        if (ok)
            this.persistAnnounce();
        return ok;
    }
    unassignWorker(id) {
        const ok = FactoryEngine.unassignWorker(this.state, id);
        if (ok)
            this.persistAnnounce();
        return ok;
    }
    buyMenu() {
        const ok = FactoryEngine.buyMenu(this.state);
        if (ok)
            this.persistAnnounce();
        else
            this.emit('notify', { message: 'Pas assez d’argent pour le menu', severity: 'warning' });
        return ok;
    }
    buyResearch(id) {
        const ok = FactoryEngine.buyResearch(this.state, id);
        if (ok)
            this.persistAnnounce();
        return ok;
    }
    prestige() {
        const stars = FactoryEngine.prestige(this.state);
        if (stars > 0) {
            this.persistAnnounce();
            this.emit('notify', { message: `⭐ +${stars} étoile(s) ! Production boostée à vie.`, severity: 'success' });
        }
        return stars;
    }
    /** Starts a production rush (e.g. after a rewarded ad). */
    startRush() {
        this.state.rushEndsAt = this.now() + RUSH_SECONDS * 1000;
        this.persistAnnounce();
    }
    rushRemainingMs() {
        return Math.max(0, this.state.rushEndsAt - this.now());
    }
    /** Grants a flat cash bonus (e.g. the offline ×2 rewarded ad). */
    grantBonusCash(amount) {
        const a = Math.max(0, Math.floor(amount));
        if (a <= 0)
            return;
        this.state.cash += a;
        this.state.stats.cashRun += a;
        this.state.stats.cashAll += a;
        this.persistAnnounce();
    }
    /** Spends gems to grant a chunk of instant cash (soft monetisation hook). */
    buyCashWithGems() {
        if (this.state.gems < 10) {
            this.emit('notify', { message: 'Pas assez de gemmes', severity: 'warning' });
            return false;
        }
        this.state.gems -= 10;
        const bonus = Math.max(500, Math.round(FactoryEngine.revenuePerSecond(this.state, this.now()) * 300));
        this.state.cash += bonus;
        this.state.stats.cashRun += bonus;
        this.state.stats.cashAll += bonus;
        this.persistAnnounce();
        return true;
    }
    // --- Persistence & backup codes ---------------------------------------------
    persist() {
        try {
            this.store.setItem(SAVE_KEY, JSON.stringify(this.state));
        }
        catch { /* storage full / unavailable — stay in memory */ }
    }
    persistAnnounce() {
        this.state.lastSaveAt = this.now();
        this.persist();
        this.announce();
    }
    load() {
        try {
            const raw = this.store.getItem(SAVE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.kind === 'factory' && parsed.stations) {
                    return this.sanitize(parsed);
                }
            }
        }
        catch { /* corrupt save — start fresh */ }
        return createDefaultFactory(this.now());
    }
    /** Clamps a loaded/imported save to a valid, finite shape (anti-cheat). */
    sanitize(raw) {
        const base = createDefaultFactory(this.now());
        const num = (v, d) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d;
        const out = createDefaultFactory(this.now());
        out.id = typeof raw.id === 'string' ? raw.id : base.id;
        out.cash = num(raw.cash, 0);
        out.gems = Math.floor(num(raw.gems, base.gems));
        out.stars = Math.floor(num(raw.stars, 0));
        out.menuLevel = Math.floor(num(raw.menuLevel, 0));
        out.workersIdle = Math.floor(num(raw.workersIdle, 0));
        out.workersHired = Math.floor(num(raw.workersHired, 0));
        out.rushEndsAt = num(raw.rushEndsAt, 0);
        out.lastDailyClaim = num(raw.lastDailyClaim, 0);
        out.dailyStreak = Math.floor(num(raw.dailyStreak, 0));
        out.lastSaveAt = num(raw.lastSaveAt, this.now());
        const rawStations = raw.stations ?? {};
        for (const id of STATION_IDS) {
            const s = rawStations[id] ?? {};
            out.stations[id] = {
                level: Math.max(1, Math.floor(num(s.level, 1))),
                workers: Math.floor(num(s.workers, 0)),
                output: num(s.output, 0),
            };
        }
        if (raw.research && typeof raw.research === 'object') {
            for (const [k, v] of Object.entries(raw.research)) {
                const n = Math.floor(num(v, 0));
                if (n > 0)
                    out.research[k] = n;
            }
        }
        if (raw.stats && typeof raw.stats === 'object') {
            out.stats.cashRun = num(raw.stats.cashRun, 0);
            out.stats.cashAll = num(raw.stats.cashAll, 0);
            out.stats.dishesSold = Math.floor(num(raw.stats.dishesSold, 0));
            out.stats.prestiges = Math.floor(num(raw.stats.prestiges, 0));
        }
        return out;
    }
    /** Exports the save as a base64 backup code (the cloud-sync wire format). */
    exportSave() {
        const json = JSON.stringify(this.state);
        return typeof btoa === 'function'
            ? btoa(unescape(encodeURIComponent(json)))
            : Buffer.from(json, 'utf-8').toString('base64');
    }
    /** Imports a base64 backup code, replacing the current save. */
    importSave(code) {
        try {
            const json = typeof atob === 'function'
                ? decodeURIComponent(escape(atob(code.trim())))
                : Buffer.from(code.trim(), 'base64').toString('utf-8');
            const parsed = JSON.parse(json);
            if (!parsed || parsed.kind !== 'factory' || !parsed.stations)
                return false;
            this.state = this.sanitize(parsed);
            this.persist();
            this.announce();
            return true;
        }
        catch {
            return false;
        }
    }
    /** Wipes progress back to a fresh factory. */
    reset() {
        this.state = createDefaultFactory(this.now());
        this.persist();
        this.announce();
    }
}
