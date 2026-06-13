/**
 * SlotEngine.ts — 3-Reel Slot Machine (Lucky Dungeon Tycoon v2)
 *
 * Each spin draws three independent symbols from a weighted reel and
 * resolves them through a priority ruleset: triple (jackpot) > pair >
 * scatter. Sword symbols double as boss damage while a fight is active.
 * Rolls are injectable per reel, so every combination is unit-testable.
 *
 * The v1 single-band SpinEngine remains in the tree for API compatibility;
 * the live game loop uses this engine.
 */

import { EconomyEngine } from './EconomyEngine.js';
import {
  MAX_SHIELDS,
  SlotOutcome,
  SlotSpinResult,
  SlotSymbol,
  UserProfile,
  cloneProfile,
  creditGold,
} from './types.js';

/** Energy price of one spin. */
const SPIN_ENERGY_COST = 1;

/** Weighted reel strip; weights sum to 1 and apply to each reel equally. */
const REEL: ReadonlyArray<{ symbol: SlotSymbol; weight: number }> = [
  { symbol: 'COIN', weight: 0.38 },
  { symbol: 'BAG', weight: 0.18 },
  { symbol: 'SWORD', weight: 0.16 },
  { symbol: 'SHIELD', weight: 0.12 },
  { symbol: 'GEM', weight: 0.09 },
  { symbol: 'SKULL', weight: 0.07 },
];

/** Gold multipliers (× base gain) for triples and pairs, per symbol. */
const TRIPLE_GOLD: Record<SlotSymbol, number> = {
  COIN: 12,
  BAG: 30,
  GEM: 5,
  SHIELD: 2,
  SWORD: 3,
  SKULL: 20,
};
const PAIR_GOLD: Record<SlotSymbol, number> = {
  COIN: 3,
  BAG: 6,
  GEM: 2.5,
  SHIELD: 0,
  SWORD: 1,
  SKULL: 0,
};

/** Scatter contribution (× base gain) of each lone symbol. */
const SCATTER_GOLD: Record<SlotSymbol, number> = {
  COIN: 0.4,
  BAG: 1,
  GEM: 0.6,
  SHIELD: 0.5,
  SWORD: 0.3,
  SKULL: 0,
};

/** Boss damage units (× damage unit) per sword count. */
const SWORD_DAMAGE: Record<number, number> = { 0: 0, 1: 1, 2: 4, 3: 10 };

/** Fraction of current gold a skull pair steals. */
const SKULL_PAIR_TAX = 0.05;

const SYMBOL_ICONS: Record<SlotSymbol, string> = {
  COIN: '🪙',
  BAG: '💰',
  GEM: '💎',
  SHIELD: '🛡️',
  SWORD: '⚔️',
  SKULL: '💀',
};

export class SlotEngine {
  /** Display glyph for a symbol (shared with the view layer). */
  public static iconFor(symbol: SlotSymbol): string {
    return SYMBOL_ICONS[symbol];
  }

  /**
   * Executes one 3-reel spin against `state`, mutating it in place and
   * returning an immutable result with a post-spin deep snapshot.
   *
   * @param rolls Optional pre-drawn rolls in [0, 1), one per reel, for
   *              deterministic testing; defaults to Math.random per reel.
   * @throws Error when the player lacks the energy to spin.
   */
  public static executeSpin(
    state: UserProfile,
    rolls?: [number, number, number],
  ): SlotSpinResult {
    if (!Number.isFinite(state.energy) || state.energy < SPIN_ENERGY_COST) {
      throw new Error('INSUFFICIENT_ENERGY: at least 1 energy is required to spin.');
    }

    state.energy -= SPIN_ENERGY_COST;
    state.stats.totalSpins += 1;

    const symbols: [SlotSymbol, SlotSymbol, SlotSymbol] = [
      SlotEngine.drawSymbol(rolls?.[0]),
      SlotEngine.drawSymbol(rolls?.[1]),
      SlotEngine.drawSymbol(rolls?.[2]),
    ];

    const counts = new Map<SlotSymbol, number>();
    for (const s of symbols) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }

    const baseGain = EconomyEngine.getBaseGain(state.dungeonLevel);
    const goldMult = EconomyEngine.getGlobalMultiplier(state);
    /** Boss damage scales with the same curves so fights keep pace. */
    const damageUnit = baseGain * 2 * goldMult;

    let outcome: SlotOutcome;
    let goldGained = 0;
    let gemsGained = 0;
    let shieldsGained = 0;
    let goldStolen = 0;
    let label: string;

    const triple = symbols[0] === symbols[1] && symbols[1] === symbols[2]
      ? symbols[0]
      : null;
    const pair = triple === null
      ? [...counts.entries()].find(([, n]) => n === 2)?.[0] ?? null
      : null;

    if (triple !== null) {
      outcome = 'JACKPOT';
      goldGained = baseGain * TRIPLE_GOLD[triple];
      switch (triple) {
        case 'GEM':
          gemsGained = 3;
          label = 'JACKPOT 💎×3 — +3 gemmes !';
          break;
        case 'SHIELD': {
          const granted = Math.min(2, MAX_SHIELDS - state.shields);
          shieldsGained = granted;
          if (granted < 2) {
            goldGained += baseGain * 3 * (2 - granted);
          }
          label = granted > 0 ? `JACKPOT 🛡️×3 — +${granted} bouclier(s) !` : 'JACKPOT 🛡️×3 — boucliers pleins, or compensé !';
          break;
        }
        case 'SKULL':
          // Cursed hoard: a huge payout, but the curse consumes a shield.
          if (state.shields > 0) {
            state.shields -= 1;
            shieldsGained = -1;
          }
          label = 'JACKPOT 💀×3 — trésor maudit !';
          break;
        case 'SWORD':
          label = 'JACKPOT ⚔️×3 — assaut dévastateur !';
          break;
        default:
          label = `JACKPOT ${SYMBOL_ICONS[triple]}×3 !`;
      }
    } else if (pair !== null) {
      outcome = 'PAIR';
      goldGained = baseGain * PAIR_GOLD[pair];
      if (pair === 'SHIELD') {
        if (state.shields < MAX_SHIELDS) {
          shieldsGained = 1;
          label = 'Paire 🛡️ — +1 bouclier';
        } else {
          goldGained = baseGain * 1.5;
          label = 'Paire 🛡️ — boucliers pleins, or compensé';
        }
      } else if (pair === 'SKULL') {
        goldStolen = Math.floor(state.gold * SKULL_PAIR_TAX);
        label = 'Paire 💀 — malédiction !';
      } else {
        label = `Paire ${SYMBOL_ICONS[pair]}`;
      }
      // The odd third symbol still scatters a little gold.
      const third = symbols.find((s) => s !== pair);
      if (third) {
        goldGained += baseGain * SCATTER_GOLD[third];
      }
    } else {
      outcome = 'SCATTER';
      for (const s of symbols) {
        goldGained += baseGain * SCATTER_GOLD[s];
      }
      label = 'Butin éparpillé';
    }

    // Consolation floor: every spin pays at least a fifth of the base gain,
    // so progress never fully stalls (and payouts are never zero).
    goldGained = Math.max(goldGained, baseGain * 0.2);
    goldGained = Math.round(goldGained * goldMult);

    // Boss damage from swords, only while a fight is active.
    const swordCount = counts.get('SWORD') ?? 0;
    const bossDamage = state.bossHp !== null
      ? Math.round(damageUnit * (SWORD_DAMAGE[swordCount] ?? 0))
      : 0;

    // --- Apply ---------------------------------------------------------------
    creditGold(state, goldGained);
    if (goldStolen > 0) {
      state.gold = Math.max(0, state.gold - goldStolen);
    }
    state.gems += gemsGained;
    if (shieldsGained > 0) {
      state.shields = Math.min(MAX_SHIELDS, state.shields + shieldsGained);
    }
    if (state.bossHp !== null && bossDamage > 0) {
      state.bossHp = Math.max(0, state.bossHp - bossDamage);
    }

    const now = Date.now();
    state.lastSaveTimestamp = now;

    return {
      symbols,
      outcome,
      goldGained,
      goldStolen,
      gemsGained,
      shieldsGained,
      bossDamage,
      label,
      energyConsumed: SPIN_ENERGY_COST,
      timestamp: now,
      stateSnapshot: cloneProfile(state),
    };
  }

  /** Maps a roll in [0, 1) onto the weighted reel strip. */
  private static drawSymbol(roll?: number): SlotSymbol {
    const drawn = roll !== undefined ? roll : Math.random();
    const r = Math.min(Math.max(drawn, 0), 1 - Number.EPSILON);
    let cumulative = 0;
    for (const entry of REEL) {
      cumulative += entry.weight;
      if (r < cumulative) {
        return entry.symbol;
      }
    }
    return REEL[REEL.length - 1].symbol;
  }
}
