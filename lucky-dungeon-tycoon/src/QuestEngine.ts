/**
 * QuestEngine.ts — Achievement/Quest System (Lucky Dungeon Tycoon v2)
 *
 * A static quest book evaluated against the profile's lifetime counters.
 * Quests are pure predicates: the engine answers "is it complete?" and
 * "was it claimed?"; the controller owns the claim transaction.
 */

import { BUILDING_TYPES, MINER_TIERS, UserProfile } from './types.js';
import { VillageEngine } from './VillageEngine.js';

function maxBuildingLevel(state: UserProfile): number {
  let max = 0;
  for (const type of BUILDING_TYPES) {
    max = Math.max(max, state.buildings[type]);
  }
  return max;
}

export interface QuestDef {
  id: string;
  title: string;
  description: string;
  /** Gems granted when the reward is claimed. */
  reward: number;
  /** Pure completion predicate over the profile. */
  isComplete(state: UserProfile): boolean;
  /** Progress in [0, 1] for the quest list UI. */
  progress(state: UserProfile): number;
}

function ratio(value: number, target: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(1, value / target);
}

function totalMiners(state: UserProfile): number {
  return MINER_TIERS.reduce((sum, tier) => sum + state.miners[tier], 0);
}

/** The complete quest book, in display order. */
export const QUESTS: readonly QuestDef[] = [
  {
    id: 'first_vein',
    title: 'Premier filon',
    description: 'Amasser 1 000 or au total',
    reward: 5,
    isComplete: (s) => s.stats.goldEarnedAll >= 1_000,
    progress: (s) => ratio(s.stats.goldEarnedAll, 1_000),
  },
  {
    id: 'spin_100',
    title: 'Bras mécanique',
    description: 'Lancer 100 spins',
    reward: 10,
    isComplete: (s) => s.stats.totalSpins >= 100,
    progress: (s) => ratio(s.stats.totalSpins, 100),
  },
  {
    id: 'foreman',
    title: 'Chef de chantier',
    description: 'Employer 10 mineurs',
    reward: 10,
    isComplete: (s) => totalMiners(s) >= 10,
    progress: (s) => ratio(totalMiners(s), 10),
  },
  {
    id: 'builder',
    title: 'Bâtisseur',
    description: 'Atteindre 20 niveaux de bâtiments cumulés',
    reward: 12,
    isComplete: (s) => VillageEngine.getTotalLevels(s) >= 20,
    progress: (s) => ratio(VillageEngine.getTotalLevels(s), 20),
  },
  {
    id: 'pioneer',
    title: 'Pionnier',
    description: 'Fonder un 3ᵉ village',
    reward: 30,
    isComplete: (s) => s.village >= 3,
    progress: (s) => ratio(s.village, 3),
  },
  {
    id: 'industrialist',
    title: 'Industriel',
    description: 'Porter un bâtiment au niveau 25 (1er palier)',
    reward: 25,
    isComplete: (s) => maxBuildingLevel(s) >= 25,
    progress: (s) => ratio(maxBuildingLevel(s), 25),
  },
  {
    id: 'overlord',
    title: 'Suzerain',
    description: 'Atteindre le 5ᵉ village',
    reward: 60,
    isComplete: (s) => s.village >= 5,
    progress: (s) => ratio(s.village, 5),
  },
  {
    id: 'first_boss',
    title: 'Tueur de gardien',
    description: 'Vaincre un boss d’étage',
    reward: 15,
    isComplete: (s) => s.stats.bossesKilled >= 1,
    progress: (s) => ratio(s.stats.bossesKilled, 1),
  },
  {
    id: 'floor_5',
    title: 'Spéléologue',
    description: 'Atteindre l’étage 5',
    reward: 20,
    isComplete: (s) => s.floor >= 5,
    progress: (s) => ratio(s.floor, 5),
  },
  {
    id: 'magnate',
    title: 'Magnat du donjon',
    description: 'Amasser 1 000 000 or au total',
    reward: 25,
    isComplete: (s) => s.stats.goldEarnedAll >= 1_000_000,
    progress: (s) => ratio(s.stats.goldEarnedAll, 1_000_000),
  },
  {
    id: 'ascended',
    title: 'Transcendance',
    description: 'Réaliser une Ascension',
    reward: 50,
    isComplete: (s) => s.stats.prestiges >= 1,
    progress: (s) => ratio(s.stats.prestiges, 1),
  },
];

export class QuestEngine {
  /** Quest definition by id, or undefined for unknown ids. */
  public static getQuest(id: string): QuestDef | undefined {
    return QUESTS.find((q) => q.id === id);
  }

  /** True when the quest is complete but its reward is still unclaimed. */
  public static isClaimable(state: UserProfile, id: string): boolean {
    const quest = QuestEngine.getQuest(id);
    return (
      quest !== undefined &&
      !state.claimedQuests.includes(id) &&
      quest.isComplete(state)
    );
  }

  /** Ids of every quest currently claimable. */
  public static claimableQuests(state: UserProfile): string[] {
    return QUESTS.filter((q) => QuestEngine.isClaimable(state, q.id)).map(
      (q) => q.id,
    );
  }
}
