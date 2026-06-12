/**
 * index.ts — Public API surface of the Lucky Dungeon Tycoon core.
 *
 * Downstream consumers (webviews, native shells, tooling) should import from
 * this barrel only; internal module paths are not a stability contract.
 */
export { DEFAULT_GAME_CONFIG, MAX_SHIELDS, cloneProfile, createDefaultProfile, } from './types.js';
export { EconomyEngine } from './EconomyEngine.js';
export { GameStateManager } from './GameStateManager.js';
export { SpinEngine } from './SpinEngine.js';
export { MonetizationBridge } from './MonetizationBridge.js';
export { GameController } from './GameController.js';
export { EventBus, gameEvents } from './EventBus.js';
