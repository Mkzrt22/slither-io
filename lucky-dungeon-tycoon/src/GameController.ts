/**
 * GameController.ts — Application Layer (Lucky Dungeon Tycoon v2)
 *
 * Orchestrates the domain engines into the player-facing use cases (spin,
 * upgrade, miners, boss fights, prestige, quests, refills) and publishes
 * every state transition on the EventBus. The controller knows nothing about
 * the DOM; the View layer knows nothing about the engines — they meet only
 * at the bus.
 */

import { EconomyEngine, PRESTIGE_THRESHOLD } from './EconomyEngine.js';
import { EventBus, gameEvents } from './EventBus.js';
import { GameStateManager } from './GameStateManager.js';
import { MonetizationBridge } from './MonetizationBridge.js';
import { QuestEngine } from './QuestEngine.js';
import { SlotEngine } from './SlotEngine.js';
import { VillageEngine } from './VillageEngine.js';
import {
  BuildingType,
  DEFAULT_GAME_CONFIG,
  MinerTier,
  SlotSpinResult,
  UserProfile,
  cloneProfile,
  createEmptyBuildings,
  createEmptyMiners,
  creditGold,
} from './types.js';

/** Energy granted for a completed rewarded ad. */
const AD_ENERGY_REWARD = 10;
/** How often the live loop ticks (regen + passive income). */
const TICK_INTERVAL_MS = 1_000;

export class GameController {
  private state: UserProfile;
  private regenAnchorMs: number;
  private passiveAnchorMs: number;
  /** Sub-1-gold passive income carried between ticks. */
  private passiveCarry = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  /** Guards against double-granting overlapping rewarded-ad requests. */
  private adInFlight = false;

  /**
   * Loads (or initialises) the profile and announces it. Offline events that
   * happened while the game was closed are replayed to the UI as
   * notifications so the player sees their welcome-back summary.
   */
  constructor(
    private readonly stateManager: GameStateManager = new GameStateManager(),
    private readonly bus: EventBus = gameEvents,
    private readonly now: () => number = Date.now,
  ) {
    const { state, logs } = this.stateManager.loadStateWithLogs();
    this.state = state;
    this.regenAnchorMs = this.now();
    this.passiveAnchorMs = this.now();

    this.bus.emit('state:updated', cloneProfile(this.state));
    for (const message of logs) {
      this.bus.emit('ui:notification', {
        message,
        severity: message.startsWith('Raid stole') ? 'warning' : 'info',
      });
    }
  }

  /** Read-only snapshot of the live profile for imperative callers. */
  public getState(): UserProfile {
    return cloneProfile(this.state);
  }

  // ---------------------------------------------------------------------------
  // Use case: spin
  // ---------------------------------------------------------------------------

  /**
   * Pull the lever. On success the result is broadcast for the slot
   * animation; with no energy the refill popup is requested instead and null
   * is returned. Boss kills triggered by sword damage resolve inline.
   */
  public spin(rolls?: [number, number, number]): SlotSpinResult | null {
    let result: SlotSpinResult;
    try {
      result = SlotEngine.executeSpin(this.state, rolls);
    } catch {
      this.bus.emit('ui:popup_energy', {
        energy: this.state.energy,
        maxEnergy: this.state.maxEnergy,
      });
      return null;
    }

    if (this.state.bossHp !== null && this.state.bossHp <= 0) {
      this.resolveBossKill();
    }

    this.persistAndAnnounce();
    this.bus.emit('spin:result', result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Use case: dungeon upgrade
  // ---------------------------------------------------------------------------

  /** Cost of the next dungeon upgrade, for rendering the upgrade button. */
  public getNextUpgradeCost(): number {
    return EconomyEngine.getUpgradeCost(this.state.dungeonLevel);
  }

  /** Buys the next payout level with gold. False when unaffordable. */
  public upgradeDungeon(): boolean {
    const cost = this.getNextUpgradeCost();
    if (this.state.gold < cost) {
      this.bus.emit('ui:notification', {
        message: `Amélioration : il faut ${EconomyEngine.formatCurrency(cost)} or`,
        severity: 'warning',
      });
      return false;
    }

    this.state.gold -= cost;
    this.state.dungeonLevel += 1;
    this.persistAndAnnounce();
    this.bus.emit('ui:notification', {
      message: `Mine améliorée au niveau ${this.state.dungeonLevel} !`,
      severity: 'success',
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Use case: village buildings (primary passive income & progression)
  // ---------------------------------------------------------------------------

  /** Cost of the next level of `type` for the upgrade button. */
  public getBuildingCost(type: BuildingType): number {
    return VillageEngine.getBuildingCost(type, this.state.buildings[type]);
  }

  /** Upgrades one building level with gold. False when unaffordable. */
  public upgradeBuilding(type: BuildingType): boolean {
    const cost = this.getBuildingCost(type);
    if (this.state.gold < cost) {
      this.bus.emit('ui:notification', {
        message: `Amélioration : il faut ${EconomyEngine.formatCurrency(cost)} or`,
        severity: 'warning',
      });
      return false;
    }
    this.state.gold -= cost;
    this.state.buildings[type] += 1;
    this.persistAndAnnounce();
    return true;
  }

  /** True when the village can advance (enough total building levels). */
  public canAdvanceVillage(): boolean {
    return VillageEngine.canAdvance(this.state);
  }

  /**
   * Advances to the next village: a permanent global production boost and a
   * new theme. Buildings and gold are kept (pure forward progression); only
   * the requirement to advance again rises. False when not yet eligible.
   */
  public advanceVillage(): boolean {
    if (!this.canAdvanceVillage()) {
      const needed = VillageEngine.getRequiredLevels(this.state.village);
      this.bus.emit('ui:notification', {
        message: `Village suivant : améliorez vos bâtiments (${VillageEngine.getTotalLevels(this.state)}/${needed} niveaux)`,
        severity: 'warning',
      });
      return false;
    }
    this.state.village += 1;
    this.persistAndAnnounce();
    this.bus.emit('ui:notification', {
      message: `🎉 Bienvenue à ${VillageEngine.getVillageName(this.state.village)} ! Production ×${VillageEngine.getVillageMultiplier(this.state.village).toFixed(1)}`,
      severity: 'success',
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Use case: miners (legacy passive income)
  // ---------------------------------------------------------------------------

  /** Cost of the next unit of `tier` for the hire button. */
  public getMinerCost(tier: MinerTier): number {
    return EconomyEngine.getMinerCost(tier, this.state.miners[tier]);
  }

  /** Hires one unit of `tier` with gold. False when unaffordable. */
  public hireMiner(tier: MinerTier): boolean {
    const cost = this.getMinerCost(tier);
    if (this.state.gold < cost) {
      this.bus.emit('ui:notification', {
        message: `Recrutement : il faut ${EconomyEngine.formatCurrency(cost)} or`,
        severity: 'warning',
      });
      return false;
    }

    this.state.gold -= cost;
    this.state.miners[tier] += 1;
    this.persistAndAnnounce();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Use case: boss fights & floors
  // ---------------------------------------------------------------------------

  /**
   * Engages the boss of the current floor. While the fight is active, sword
   * symbols deal damage; defeating the boss advances the floor and drops a
   * gem chest. Idempotent when a fight is already running.
   */
  public startBossFight(): boolean {
    if (this.state.bossHp !== null) {
      return false;
    }
    this.state.bossHp = EconomyEngine.getBossMaxHp(this.state.floor);
    this.persistAndAnnounce();
    this.bus.emit('ui:notification', {
      message: `Le gardien de l’étage ${this.state.floor} surgit ! Frappez avec ⚔️`,
      severity: 'info',
    });
    return true;
  }

  /** Retreats from the active fight (the boss heals fully). */
  public fleeBossFight(): void {
    if (this.state.bossHp === null) {
      return;
    }
    this.state.bossHp = null;
    this.persistAndAnnounce();
  }

  private resolveBossKill(): void {
    const reward = EconomyEngine.getBossReward(this.state.floor);
    this.state.bossHp = null;
    this.state.stats.bossesKilled += 1;
    this.state.floor += 1;
    this.state.gems += reward;
    this.bus.emit('ui:notification', {
      message: `Boss vaincu ! Étage ${this.state.floor} débloqué, coffre : +${reward} gemmes`,
      severity: 'success',
    });
  }

  // ---------------------------------------------------------------------------
  // Use case: prestige (Ascension)
  // ---------------------------------------------------------------------------

  /** Relics an ascension would grant right now (0 = locked). */
  public getPrestigeRelics(): number {
    return EconomyEngine.getPrestigeRelics(this.state.stats.goldEarnedRun);
  }

  /** Gold-earned-this-run requirement for the prestige UI. */
  public getPrestigeThreshold(): number {
    return PRESTIGE_THRESHOLD;
  }

  /**
   * Resets the run (gold, miners, floor, upgrades, boss) in exchange for
   * permanent relics. Gems, shields, relics, stats and quests survive.
   * Energy refills as a send-off. False while below the threshold.
   */
  public ascend(): boolean {
    const relics = this.getPrestigeRelics();
    if (relics <= 0) {
      this.bus.emit('ui:notification', {
        message: `Ascension : amassez ${EconomyEngine.formatCurrency(this.getPrestigeThreshold())} or dans ce cycle`,
        severity: 'warning',
      });
      return false;
    }

    this.state.relics += relics;
    this.state.stats.prestiges += 1;
    this.state.stats.goldEarnedRun = 0;
    this.state.gold = 0;
    this.state.miners = createEmptyMiners();
    this.state.buildings = createEmptyBuildings();
    this.state.village = 1;
    this.state.floor = 1;
    this.state.dungeonLevel = 0;
    this.state.bossHp = null;
    this.state.energy = Math.max(this.state.energy, this.state.maxEnergy);
    this.passiveCarry = 0;

    this.persistAndAnnounce();
    this.bus.emit('ui:notification', {
      message: `✨ Ascension ! +${relics} relique(s) — production ×${EconomyEngine.getRelicMultiplier(this.state.relics).toFixed(1)} permanente`,
      severity: 'success',
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Use case: quests
  // ---------------------------------------------------------------------------

  /** Ids of quests whose reward can be collected right now. */
  public getClaimableQuests(): string[] {
    return QuestEngine.claimableQuests(this.state);
  }

  /** Collects a completed quest's gem reward. False when not claimable. */
  public claimQuest(id: string): boolean {
    if (!QuestEngine.isClaimable(this.state, id)) {
      return false;
    }
    const quest = QuestEngine.getQuest(id);
    if (!quest) {
      return false;
    }
    this.state.claimedQuests.push(id);
    this.state.gems += quest.reward;
    this.persistAndAnnounce();
    this.bus.emit('ui:notification', {
      message: `Quête « ${quest.title} » : +${quest.reward} gemmes`,
      severity: 'success',
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Use case: energy refills
  // ---------------------------------------------------------------------------

  /** Spends gems on the 50-energy pack. False (with an error toast) if poor. */
  public buyEnergyWithGems(): boolean {
    let purchased: UserProfile;
    try {
      purchased = MonetizationBridge.buyEnergyWithGems(this.state);
    } catch (error) {
      this.bus.emit('ui:notification', {
        message: error instanceof Error ? error.message : 'Purchase failed',
        severity: 'error',
      });
      return false;
    }

    this.state = purchased;
    this.persistAndAnnounce();
    this.bus.emit('ui:notification', {
      message: '+50 énergie achetée',
      severity: 'success',
    });
    return true;
  }

  /**
   * Watches a rewarded ad for energy. Resolves true when the reward was
   * granted. Concurrent calls while an ad is already playing resolve false
   * immediately rather than queueing a second ad.
   */
  public async watchAdForEnergy(): Promise<boolean> {
    if (this.adInFlight) {
      return false;
    }
    this.adInFlight = true;
    try {
      const completed = await MonetizationBridge.showRewardedAd();
      if (!completed) {
        this.bus.emit('ui:notification', {
          message: 'Pub indisponible — réessayez bientôt',
          severity: 'error',
        });
        return false;
      }

      this.state.energy += AD_ENERGY_REWARD;
      this.persistAndAnnounce();
      this.bus.emit('ui:notification', {
        message: `+${AD_ENERGY_REWARD} énergie (pub)`,
        severity: 'success',
      });
      return true;
    } finally {
      this.adInFlight = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Live loop: energy regen + passive income
  // ---------------------------------------------------------------------------

  /**
   * Live (online) energy regeneration: grants 1 energy per regen interval of
   * real time while below the cap. Exposed publicly with an injectable clock
   * so tests can drive it deterministically.
   */
  public tickRegen(nowMs: number = this.now()): void {
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

  /**
   * Live passive income: credits miner output for the elapsed wall-clock
   * time, carrying sub-1-gold fractions between ticks so slow economies
   * lose nothing to rounding.
   */
  public tickPassive(nowMs: number = this.now()): void {
    const elapsedMs = nowMs - this.passiveAnchorMs;
    if (elapsedMs <= 0) {
      return;
    }
    this.passiveAnchorMs = nowMs;

    const rate = EconomyEngine.getPassiveRate(this.state);
    if (rate <= 0) {
      this.passiveCarry = 0;
      return;
    }

    const earned = rate * (elapsedMs / 1000) + this.passiveCarry;
    const whole = Math.floor(earned);
    this.passiveCarry = earned - whole;
    if (whole > 0) {
      creditGold(this.state, whole);
      this.persistAndAnnounce();
    }
  }

  /** Starts the background loop (regen + passive income). Idempotent. */
  public start(): void {
    if (this.tickTimer !== null) {
      return;
    }
    this.tickTimer = setInterval(() => {
      this.tickRegen();
      this.tickPassive();
    }, TICK_INTERVAL_MS);
  }

  /** Stops the background loop and persists a final save. */
  public stop(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.stateManager.saveState(this.state);
  }

  /** Saves the profile and broadcasts the new authoritative state. */
  private persistAndAnnounce(): void {
    this.stateManager.saveState(this.state);
    this.bus.emit('state:updated', cloneProfile(this.state));
  }
}
