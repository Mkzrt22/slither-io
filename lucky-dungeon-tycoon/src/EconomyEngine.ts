/**
 * EconomyEngine.ts — Mathematical Core (Lucky Dungeon Tycoon)
 *
 * Stateless, purely functional math layer: geometric cost/gain curves and the
 * idle-genre short-scale currency formatter. All functions are total — every
 * numeric input (including NaN, ±Infinity and negatives) produces a defined,
 * non-throwing result, because UI render paths must never crash on bad data.
 */

import { DEFAULT_GAME_CONFIG } from './types';

export class EconomyEngine {
  /**
   * Short-scale suffixes by power-of-1000 tier. Index 0 is the unit tier.
   * K=10^3 … Dc=10^33.
   */
  private static readonly SUFFIXES: readonly string[] = [
    '',
    'K',
    'M',
    'B',
    'T',
    'Qa',
    'Qi',
    'Sx',
    'Sp',
    'Oc',
    'No',
    'Dc',
  ];

  /**
   * Cost of upgrading from `level` to `level + 1`.
   * Formula: 100 * 1.62^level, rounded to the nearest integer so displayed
   * prices are always whole numbers. Negative or non-finite levels are
   * clamped to 0, which yields the base cost.
   */
  public static getUpgradeCost(level: number): number {
    const safeLevel = EconomyEngine.sanitizeLevel(level);
    return Math.round(
      DEFAULT_GAME_CONFIG.baseGoldCost *
        Math.pow(DEFAULT_GAME_CONFIG.goldMultiplier, safeLevel),
    );
  }

  /**
   * Base gold gain of a minor win at `level`.
   * Formula: 10 * 1.45^level, rounded to the nearest integer. Negative or
   * non-finite levels are clamped to 0.
   */
  public static getBaseGain(level: number): number {
    const safeLevel = EconomyEngine.sanitizeLevel(level);
    return Math.round(
      DEFAULT_GAME_CONFIG.baseGoldGain *
        Math.pow(DEFAULT_GAME_CONFIG.gainMultiplier, safeLevel),
    );
  }

  /**
   * Idle Short Scale Formatter.
   *
   *   1,234            -> "1.23K"
   *   1,250,000        -> "1.25M"
   *   5,400,000,000,000-> "5.40T"
   *   999              -> "999"
   *   -1,250,000       -> "-1.25M"
   *
   * Behaviour contract:
   *  - Values with |v| < 1000 render as a whole number (no suffix).
   *  - Suffixed values always carry exactly two decimals, truncated (never
   *    rounded up) so the UI never overstates the player's wealth — and so
   *    999,999 renders as "999.99K", not the impossible "1000.00K".
   *  - Beyond the Dc tier (>= 10^36) the formatter falls back to scientific
   *    notation, which keeps arbitrarily inflated late-game values readable.
   *  - NaN renders as "0"; ±Infinity renders as "∞"/"-∞".
   */
  public static formatCurrency(value: number): string {
    if (Number.isNaN(value)) {
      return '0';
    }
    if (value === Infinity) {
      return '∞';
    }
    if (value === -Infinity) {
      return '-∞';
    }

    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);

    if (abs < 1000) {
      return sign + Math.floor(abs).toString();
    }

    // Power-of-1000 tier. log10 of a float can land epsilon-low on exact
    // boundaries (e.g. log10(1e21) -> 20.999...), so verify the tier against
    // the actual magnitude and correct by one step where needed.
    let tier = Math.floor(Math.log10(abs) / 3);
    if (abs >= Math.pow(10, (tier + 1) * 3)) {
      tier += 1;
    } else if (abs < Math.pow(10, tier * 3)) {
      tier -= 1;
    }

    if (tier >= EconomyEngine.SUFFIXES.length) {
      return sign + abs.toExponential(2);
    }

    const scaled = abs / Math.pow(10, tier * 3);
    // Truncate (not round) to two decimals; clamp guards float artifacts
    // such as 999.9999999 scaling to a 1000.00 display value.
    const truncated = Math.min(Math.floor(scaled * 100) / 100, 999.99);
    return sign + truncated.toFixed(2) + EconomyEngine.SUFFIXES[tier];
  }

  /** Clamps a level to a non-negative integer; non-finite input becomes 0. */
  private static sanitizeLevel(level: number): number {
    if (!Number.isFinite(level) || level < 0) {
      return 0;
    }
    return Math.floor(level);
  }
}
