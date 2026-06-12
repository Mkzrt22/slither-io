/**
 * GameController.ts — Application Layer (Lucky Dungeon Tycoon)
 *
 * Orchestrates the domain engines into the player-facing use cases (spin,
 * upgrade, refill energy, watch ad) and publishes every state transition on
 * the EventBus. The controller knows nothing about the DOM; the View layer
 * knows nothing about the engines — they meet only at the bus.
 */
import { EconomyEngine } from './EconomyEngine.js';
import { gameEvents } from './EventBus.js';
import { GameStateManager } from './GameStateManager.js';
import { MonetizationBridge } from './MonetizationBridge.js';
import { SpinEngine } from './SpinEngine.js';
import { DEFAULT_GAME_CONFIG, cloneProfile, } from './types.js';
/** Energy granted for a completed rewarded ad. */
const AD_ENERGY_REWARD = 10;
/** How often the live regen loop checks for accrued energy. */
const REGEN_POLL_INTERVAL_MS = 1000;
export class GameController {
    /**
     * Loads (or initialises) the profile and announces it. Offline events that
     * happened while the game was closed are replayed to the UI as
     * notifications so the player sees their welcome-back summary.
     */
    constructor(stateManager = new GameStateManager(), bus = gameEvents, now = Date.now) {
        this.stateManager = stateManager;
        this.bus = bus;
        this.now = now;
        this.regenTimer = null;
        /** Guards against double-granting overlapping rewarded-ad requests. */
        this.adInFlight = false;
        const { state, logs } = this.stateManager.loadStateWithLogs();
        this.state = state;
        this.regenAnchorMs = this.now();
        this.bus.emit('state:updated', cloneProfile(this.state));
        for (const message of logs) {
            this.bus.emit('ui:notification', {
                message,
                severity: message.startsWith('Raid stole') ? 'warning' : 'info',
            });
        }
    }
    /** Read-only snapshot of the live profile for imperative callers. */
    getState() {
        return cloneProfile(this.state);
    }
    /**
     * Use case: pull the lever. On success the result is broadcast for the
     * slot animation; with no energy the refill popup is requested instead and
     * null is returned.
     */
    spin(roll) {
        let result;
        try {
            result = SpinEngine.executeSpin(this.state, roll);
        }
        catch {
            this.bus.emit('ui:popup_energy', {
                energy: this.state.energy,
                maxEnergy: this.state.maxEnergy,
            });
            return null;
        }
        this.persistAndAnnounce();
        this.bus.emit('spin:result', result);
        return result;
    }
    /** Cost of the next dungeon upgrade, for rendering the upgrade button. */
    getNextUpgradeCost() {
        return EconomyEngine.getUpgradeCost(this.state.dungeonLevel);
    }
    /**
     * Use case: buy the next dungeon level with gold. Returns true when the
     * upgrade was applied; an unaffordable upgrade emits a warning and changes
     * nothing.
     */
    upgradeDungeon() {
        const cost = this.getNextUpgradeCost();
        if (this.state.gold < cost) {
            this.bus.emit('ui:notification', {
                message: `Upgrade requires ${EconomyEngine.formatCurrency(cost)} gold`,
                severity: 'warning',
            });
            return false;
        }
        this.state.gold -= cost;
        this.state.dungeonLevel += 1;
        this.persistAndAnnounce();
        this.bus.emit('ui:notification', {
            message: `Dungeon upgraded to level ${this.state.dungeonLevel}!`,
            severity: 'success',
        });
        return true;
    }
    /**
     * Use case: spend gems on the 50-energy pack. Returns true on success; a
     * declined purchase (insufficient gems) emits an error notification.
     */
    buyEnergyWithGems() {
        let purchased;
        try {
            purchased = MonetizationBridge.buyEnergyWithGems(this.state);
        }
        catch (error) {
            this.bus.emit('ui:notification', {
                message: error instanceof Error ? error.message : 'Purchase failed',
                severity: 'error',
            });
            return false;
        }
        this.state = purchased;
        this.persistAndAnnounce();
        this.bus.emit('ui:notification', {
            message: '+50 energy purchased',
            severity: 'success',
        });
        return true;
    }
    /**
     * Use case: watch a rewarded ad for energy. Resolves true when the reward
     * was granted. Concurrent calls while an ad is already playing resolve
     * false immediately rather than queueing a second ad.
     */
    async watchAdForEnergy() {
        if (this.adInFlight) {
            return false;
        }
        this.adInFlight = true;
        try {
            const completed = await MonetizationBridge.showRewardedAd();
            if (!completed) {
                this.bus.emit('ui:notification', {
                    message: 'Ad unavailable — try again soon',
                    severity: 'error',
                });
                return false;
            }
            this.state.energy += AD_ENERGY_REWARD;
            this.persistAndAnnounce();
            this.bus.emit('ui:notification', {
                message: `+${AD_ENERGY_REWARD} energy from ad`,
                severity: 'success',
            });
            return true;
        }
        finally {
            this.adInFlight = false;
        }
    }
    /**
     * Live (online) energy regeneration: grants 1 energy per regen interval of
     * real time while below the cap. Exposed publicly with an injectable clock
     * so tests can drive it deterministically; start()/stop() wrap it in a
     * polling timer for the running game.
     */
    tickRegen(nowMs = this.now()) {
        const regenMs = DEFAULT_GAME_CONFIG.energyRegenTimeSeconds * 1000;
        if (this.state.energy >= this.state.maxEnergy) {
            // Full tank: time does not bank toward future points.
            this.regenAnchorMs = nowMs;
            return;
        }
        const accrued = Math.floor((nowMs - this.regenAnchorMs) / regenMs);
        if (accrued <= 0) {
            return;
        }
        const granted = Math.min(accrued, this.state.maxEnergy - this.state.energy);
        this.state.energy += granted;
        // Advance the anchor by exactly the consumed intervals so partial
        // progress toward the next point is preserved.
        this.regenAnchorMs += granted * regenMs;
        if (this.state.energy >= this.state.maxEnergy) {
            this.regenAnchorMs = nowMs;
        }
        this.persistAndAnnounce();
    }
    /** Starts the background regen loop. Idempotent. */
    start() {
        if (this.regenTimer !== null) {
            return;
        }
        this.regenTimer = setInterval(() => this.tickRegen(), REGEN_POLL_INTERVAL_MS);
    }
    /** Stops the background regen loop and persists a final save. */
    stop() {
        if (this.regenTimer !== null) {
            clearInterval(this.regenTimer);
            this.regenTimer = null;
        }
        this.stateManager.saveState(this.state);
    }
    /** Saves the profile and broadcasts the new authoritative state. */
    persistAndAnnounce() {
        this.stateManager.saveState(this.state);
        this.bus.emit('state:updated', cloneProfile(this.state));
    }
}
