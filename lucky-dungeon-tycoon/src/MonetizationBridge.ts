/**
 * MonetizationBridge.ts — Ad SDK & IAP Mock Gateways (Lucky Dungeon Tycoon)
 *
 * The single seam between the domain layer and native monetization SDKs
 * (AdMob / Unity Ads / StoreKit / Play Billing) injected through the mobile
 * webview. Today both gateways are deterministic mocks with production-shaped
 * signatures, so swapping in real SDK bridges later touches only this file.
 */

import { UserProfile, cloneProfile } from './types.js';

/** Simulated SDK round-trip latency in milliseconds. */
const AD_SIMULATED_LATENCY_MS = 1_000;
/** Fraction of ad requests that complete and qualify for a reward. */
const AD_FILL_SUCCESS_RATE = 0.95;

/** Gem price of one energy refill pack. */
const ENERGY_PACK_GEM_COST = 10;
/** Energy granted per refill pack. */
const ENERGY_PACK_AMOUNT = 50;

export class MonetizationBridge {
  /**
   * Simulates a rewarded-ad loop: request fill -> play -> reward callback.
   * Resolves `true` when the ad played to completion and the reward should be
   * granted, `false` on no-fill / user-abandon (the 5% failure path). Never
   * rejects — ad failure is an expected business outcome, not an exception.
   */
  public static async showRewardedAd(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(Math.random() < AD_FILL_SUCCESS_RATE);
      }, AD_SIMULATED_LATENCY_MS);
    });
  }

  /**
   * Hard-currency energy purchase: deducts 10 gems and grants 50 energy.
   *
   * Returns a new UserProfile rather than mutating the input, so a failed
   * purchase can never leave the live state half-applied. Energy from this
   * purchase intentionally overfills past `maxEnergy` (standard idle-game
   * behaviour: paid energy is never silently clipped).
   *
   * @throws Error 'INSUFFICIENT_GEMS' when the player cannot afford the pack.
   */
  public static buyEnergyWithGems(state: UserProfile): UserProfile {
    if (!Number.isFinite(state.gems) || state.gems < ENERGY_PACK_GEM_COST) {
      throw new Error(
        `INSUFFICIENT_GEMS: ${ENERGY_PACK_GEM_COST} gems required, ` +
          `but only ${Math.max(0, Math.floor(state.gems))} available.`,
      );
    }

    const next = cloneProfile(state);
    next.gems -= ENERGY_PACK_GEM_COST;
    next.energy += ENERGY_PACK_AMOUNT;
    next.lastSaveTimestamp = Date.now();
    return next;
  }
}
