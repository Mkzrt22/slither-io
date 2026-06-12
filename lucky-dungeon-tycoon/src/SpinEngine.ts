/**
 * SpinEngine.ts — Secure Weighted Random & Core Game Loop (Lucky Dungeon Tycoon)
 *
 * Resolves a single slot-machine spin against a player profile. The reward
 * table is expressed as explicit, ordered cumulative bands over [0, 1) so the
 * distribution is auditable at a glance and provably sums to 100%.
 */

import { EconomyEngine } from './EconomyEngine';
import { MAX_SHIELDS, SpinResult, SpinResultType, UserProfile, cloneProfile } from './types';

/** Energy price of one spin. */
const SPIN_ENERGY_COST = 1;

/** One band of the weighted-random reward table. */
interface RewardBand {
  type: SpinResultType;
  /** Inclusive lower bound of the band in [0, 1). */
  min: number;
  /** Exclusive upper bound of the band in (0, 1]. */
  max: number;
}

/**
 * The canonical distribution:
 *   [0.00, 0.50) GOLD_MIN — 50%
 *   [0.50, 0.75) GOLD_MAJ — 25%
 *   [0.75, 0.90) SHIELD   — 15%
 *   [0.90, 1.00) RAID     — 10%
 */
const REWARD_TABLE: readonly RewardBand[] = [
  { type: 'GOLD_MIN', min: 0.0, max: 0.5 },
  { type: 'GOLD_MAJ', min: 0.5, max: 0.75 },
  { type: 'SHIELD', min: 0.75, max: 0.9 },
  { type: 'RAID', min: 0.9, max: 1.0 },
];

/** Payout multipliers applied to EconomyEngine.getBaseGain(level). */
const GOLD_MAJ_MULTIPLIER = 3;
const SHIELD_COMPENSATION_MULTIPLIER = 1.5;
const RAID_STEAL_MULTIPLIER = 8;

export class SpinEngine {
  /**
   * Executes one spin against `state`, mutating it in place (energy, payout,
   * save timestamp) and returning an immutable SpinResult describing what
   * happened, including a post-spin deep snapshot of the profile.
   *
   * @param roll Optional pre-drawn roll in [0, 1) for deterministic testing
   *             and server-side replay verification; defaults to Math.random.
   * @throws Error when the player lacks the energy to spin.
   */
  public static executeSpin(state: UserProfile, roll?: number): SpinResult {
    // --- Validation ---------------------------------------------------------
    if (!Number.isFinite(state.energy) || state.energy < SPIN_ENERGY_COST) {
      throw new Error('INSUFFICIENT_ENERGY: at least 1 energy is required to spin.');
    }

    const drawn = roll !== undefined ? roll : Math.random();
    // An out-of-range injected roll would silently fall outside every band;
    // clamp into [0, 1) so resolution is total.
    const r = Math.min(Math.max(drawn, 0), 1 - Number.EPSILON);

    // --- Deduction ----------------------------------------------------------
    state.energy -= SPIN_ENERGY_COST;

    // --- Resolution ---------------------------------------------------------
    const band = SpinEngine.resolveBand(r);
    const baseGain = EconomyEngine.getBaseGain(state.dungeonLevel);
    let value: number;

    switch (band.type) {
      case 'GOLD_MIN': {
        value = baseGain;
        state.gold += value;
        break;
      }
      case 'GOLD_MAJ': {
        value = baseGain * GOLD_MAJ_MULTIPLIER;
        state.gold += value;
        break;
      }
      case 'SHIELD': {
        if (state.shields < MAX_SHIELDS) {
          state.shields += 1;
          value = 1;
        } else {
          // Shields are capped; pay out compensatory gold instead.
          value = Math.round(baseGain * SHIELD_COMPENSATION_MULTIPLIER);
          state.gold += value;
        }
        break;
      }
      case 'RAID': {
        // The player raids an enemy dungeon: a high-value steal in their favour.
        value = baseGain * RAID_STEAL_MULTIPLIER;
        state.gold += value;
        break;
      }
    }

    // --- Bookkeeping ----------------------------------------------------------
    const now = Date.now();
    state.lastSaveTimestamp = now;

    return {
      type: band.type,
      value,
      energyConsumed: SPIN_ENERGY_COST,
      timestamp: now,
      stateSnapshot: cloneProfile(state),
    };
  }

  /**
   * Maps a roll in [0, 1) onto its reward band. The table is contiguous and
   * covers the full interval, so a band always exists; the trailing return
   * exists only to satisfy exhaustiveness if the table were ever edited into
   * an inconsistent shape.
   */
  private static resolveBand(roll: number): RewardBand {
    for (const band of REWARD_TABLE) {
      if (roll >= band.min && roll < band.max) {
        return band;
      }
    }
    return REWARD_TABLE[REWARD_TABLE.length - 1];
  }
}
