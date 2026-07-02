/**
 * DailyEngine.ts — Daily login reward with a consecutive-day streak.
 *
 * Pure and stateless: it answers "is a reward claimable now?", "what streak
 * would this claim be?", and "what does it pay?" given a profile snapshot, the
 * current time, and the player's passive rate. The controller owns the claim
 * transaction.
 */

import { UserProfile } from './types.js';

/** Minimum gap before the next reward unlocks (20h ≈ once per day). */
const READY_MS = 20 * 60 * 60 * 1000;
/** Beyond this gap the streak resets (a missed day breaks the chain). */
const RESET_MS = 48 * 60 * 60 * 1000;
/** Streak length at which gem rewards stop growing. */
const STREAK_CAP = 7;

export interface DailyStatus {
  /** True when a reward can be claimed right now. */
  claimable: boolean;
  /** The streak this claim would register (or the current one if not ready). */
  streak: number;
  /** Gems the claim would grant. */
  gemReward: number;
  /** Gold the claim would grant (scaled to the player's economy). */
  goldReward: number;
}

export class DailyEngine {
  /** Computes the streak a claim *now* would register. */
  public static nextStreak(state: UserProfile, now: number): number {
    if (state.lastDailyClaim <= 0) {
      return 1;
    }
    const since = now - state.lastDailyClaim;
    if (since > RESET_MS) {
      return 1; // chain broken
    }
    if (since >= READY_MS) {
      return Math.max(1, state.dailyStreak) + 1; // a fresh day continues the chain
    }
    return Math.max(1, state.dailyStreak); // not yet claimable
  }

  /** Gems granted for a given streak (capped). */
  public static gemReward(streak: number): number {
    return 2 + Math.min(Math.max(1, streak), STREAK_CAP);
  }

  /** Gold granted, ~30 minutes of the player's current passive production. */
  public static goldReward(passiveRate: number): number {
    const r = Number.isFinite(passiveRate) && passiveRate > 0 ? passiveRate : 0;
    return Math.max(200, Math.round(r * 1800));
  }

  /** Full claimability + reward snapshot. */
  public static status(state: UserProfile, now: number, passiveRate: number): DailyStatus {
    const since = now - state.lastDailyClaim;
    const claimable = state.lastDailyClaim <= 0 || since >= READY_MS;
    const streak = DailyEngine.nextStreak(state, now);
    return {
      claimable,
      streak,
      gemReward: DailyEngine.gemReward(streak),
      goldReward: DailyEngine.goldReward(passiveRate),
    };
  }
}
