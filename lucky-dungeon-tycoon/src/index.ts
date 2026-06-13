/**
 * index.ts — Public API surface of the Lucky Dungeon Tycoon core.
 *
 * Downstream consumers (webviews, native shells, tooling) should import from
 * this barrel only; internal module paths are not a stability contract.
 */

export {
  DEFAULT_GAME_CONFIG,
  MAX_SHIELDS,
  MINER_TIERS,
  cloneProfile,
  createDefaultProfile,
  createEmptyMiners,
  createEmptyStats,
  creditGold,
} from './types.js';
export type {
  GameConfig,
  MinerTier,
  PlayerStats,
  SlotOutcome,
  SlotSpinResult,
  SlotSymbol,
  SpinResult,
  SpinResultType,
  UserProfile,
} from './types.js';

export { EconomyEngine, MINER_CONFIGS, PRESTIGE_THRESHOLD } from './EconomyEngine.js';
export type { MinerConfig } from './EconomyEngine.js';
export { GameStateManager } from './GameStateManager.js';
export { SpinEngine } from './SpinEngine.js';
export { SlotEngine } from './SlotEngine.js';
export { QuestEngine, QUESTS } from './QuestEngine.js';
export type { QuestDef } from './QuestEngine.js';
export { MonetizationBridge } from './MonetizationBridge.js';
export { GameController } from './GameController.js';

export { EventBus, gameEvents } from './EventBus.js';
export type {
  EventCallback,
  GameEventMap,
  GameEventName,
  NotificationSeverity,
} from './EventBus.js';
