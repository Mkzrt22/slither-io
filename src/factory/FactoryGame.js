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
import { cloneFactory, createDefaultFactory, RECIPE_IDS, STATION_IDS, } from './types.js';
import { MANAGER_DEFS, RUSH_SECONDS } from './config.js';
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
    // --- Managers (chefs) -------------------------------------------------------
    hireManager(managerId) {
        const ok = FactoryEngine.hireManager(this.state, managerId);
        if (ok) {
            this.persistAnnounce();
            this.emit('notify', { message: 'Chef recruté !', severity: 'success' });
        }
        else
            this.emit('notify', { message: 'Pas assez de gemmes', severity: 'warning' });
        return ok;
    }
    assignManager(managerId, id) {
        const ok = FactoryEngine.assignManager(this.state, managerId, id);
        if (ok)
            this.persistAnnounce();
        return ok;
    }
    unassignManager(id) {
        const ok = FactoryEngine.unassignManager(this.state, id);
        if (ok)
            this.persistAnnounce();
        return ok;
    }
    triggerSkill(id) {
        const ok = FactoryEngine.triggerSkill(this.state, id, this.now());
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
    unlockRecipe(id) {
        const ok = FactoryEngine.unlockRecipe(this.state, id);
        if (ok) {
            this.persistAnnounce();
            this.emit('notify', { message: 'Nouvelle recette débloquée !', severity: 'success' });
        }
        else
            this.emit('notify', { message: 'Pas assez d’argent pour cette recette', severity: 'warning' });
        return ok;
    }
    switchRecipe(id) {
        const ok = FactoryEngine.switchRecipe(this.state, id);
        if (ok)
            this.persistAnnounce();
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
        // Recipes: keep only known ids, always include the starter, clamp active.
        const known = new Set(RECIPE_IDS);
        const unlocked = Array.isArray(raw.unlockedRecipes) ? raw.unlockedRecipes.filter((r) => known.has(r)) : [];
        out.unlockedRecipes = Array.from(new Set(['fast_food_burger', ...unlocked]));
        out.activeRecipeId = typeof raw.activeRecipeId === 'string' && out.unlockedRecipes.includes(raw.activeRecipeId)
            ? raw.activeRecipeId : 'fast_food_burger';
        out.workersIdle = Math.floor(num(raw.workersIdle, 0));
        out.workersHired = Math.floor(num(raw.workersHired, 0));
        out.rushEndsAt = num(raw.rushEndsAt, 0);
        out.lastDailyClaim = num(raw.lastDailyClaim, 0);
        out.dailyStreak = Math.floor(num(raw.dailyStreak, 0));
        out.lastSaveAt = num(raw.lastSaveAt, this.now());
        const knownManagers = new Set(MANAGER_DEFS.map((m) => m.id));
        if (raw.managers && typeof raw.managers === 'object') {
            for (const [k, v] of Object.entries(raw.managers)) {
                if (knownManagers.has(k) && Math.floor(num(v, 0)) > 0)
                    out.managers[k] = Math.floor(num(v, 0));
            }
        }
        const rawStations = raw.stations ?? {};
        for (const id of STATION_IDS) {
            const s = rawStations[id] ?? {};
            const mgr = typeof s.managerId === 'string' && knownManagers.has(s.managerId) && out.managers[s.managerId]
                ? s.managerId : null;
            out.stations[id] = {
                level: Math.max(1, Math.floor(num(s.level, 1))),
                workers: Math.floor(num(s.workers, 0)),
                output: num(s.output, 0),
                managerId: mgr,
                skillEndsAt: num(s.skillEndsAt, 0),
                skillReadyAt: num(s.skillReadyAt, 0),
            };
        }
        // A manager can only be posted at one station — keep the first sighting.
        const seen = new Set();
        for (const id of STATION_IDS) {
            const m = out.stations[id].managerId;
            if (m && seen.has(m))
                out.stations[id].managerId = null;
            else if (m)
                seen.add(m);
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
