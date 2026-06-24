/**
 * QuestEngine.ts — Achievement/Quest System (Lucky Dungeon Tycoon v2)
 *
 * A static quest book evaluated against the profile's lifetime counters.
 * Quests are pure predicates: the engine answers "is it complete?" and
 * "was it claimed?"; the controller owns the claim transaction.
 */
import { BUILDING_TYPES, MINER_TIERS } from './types.js';
import { VillageEngine } from './VillageEngine.js';
function maxBuildingLevel(state) {
    let max = 0;
    for (const type of BUILDING_TYPES) {
        max = Math.max(max, state.buildings[type]);
    }
    return max;
}
function ratio(value, target) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.min(1, value / target);
}
function totalMiners(state) {
    return MINER_TIERS.reduce((sum, tier) => sum + state.miners[tier], 0);
}
/** The complete quest book, in display order. */
export const QUESTS = [
    {
        id: 'first_vein',
        title: 'Première recette',
        description: 'Encaisser 1 000 € au total',
        reward: 5,
        isComplete: (s) => s.stats.goldEarnedAll >= 1000,
        progress: (s) => ratio(s.stats.goldEarnedAll, 1000),
    },
    {
        id: 'spin_100',
        title: 'Roue gourmande',
        description: 'Lancer 100 tours de roue',
        reward: 10,
        isComplete: (s) => s.stats.totalSpins >= 100,
        progress: (s) => ratio(s.stats.totalSpins, 100),
    },
    {
        id: 'foreman',
        title: 'Chef de brigade',
        description: 'Employer 10 commis',
        reward: 10,
        isComplete: (s) => totalMiners(s) >= 10,
        progress: (s) => ratio(totalMiners(s), 10),
    },
    {
        id: 'builder',
        title: 'Restaurateur',
        description: 'Atteindre 20 niveaux d’établissements cumulés',
        reward: 12,
        isComplete: (s) => VillageEngine.getTotalLevels(s) >= 20,
        progress: (s) => ratio(VillageEngine.getTotalLevels(s), 20),
    },
    {
        id: 'pioneer',
        title: 'Expansion',
        description: 'Ouvrir un 3ᵉ établissement',
        reward: 30,
        isComplete: (s) => s.village >= 3,
        progress: (s) => ratio(s.village, 3),
    },
    {
        id: 'industrialist',
        title: 'Étoile montante',
        description: 'Porter un établissement au niveau 25 (1er palier)',
        reward: 25,
        isComplete: (s) => maxBuildingLevel(s) >= 25,
        progress: (s) => ratio(maxBuildingLevel(s), 25),
    },
    {
        id: 'overlord',
        title: 'Empire gourmand',
        description: 'Atteindre le 5ᵉ palier de restaurant',
        reward: 60,
        isComplete: (s) => s.village >= 5,
        progress: (s) => ratio(s.village, 5),
    },
    {
        id: 'first_boss',
        title: 'Coup de feu',
        description: 'Honorer une grosse commande',
        reward: 15,
        isComplete: (s) => s.stats.bossesKilled >= 1,
        progress: (s) => ratio(s.stats.bossesKilled, 1),
    },
    {
        id: 'floor_5',
        title: 'Service complet',
        description: 'Atteindre le service 5',
        reward: 20,
        isComplete: (s) => s.floor >= 5,
        progress: (s) => ratio(s.floor, 5),
    },
    {
        id: 'magnate',
        title: 'Magnat de la gastronomie',
        description: 'Encaisser 1 000 000 € au total',
        reward: 25,
        isComplete: (s) => s.stats.goldEarnedAll >= 1000000,
        progress: (s) => ratio(s.stats.goldEarnedAll, 1000000),
    },
    {
        id: 'ascended',
        title: 'Étoile Michelin',
        description: 'Décrocher une étoile (Ascension)',
        reward: 50,
        isComplete: (s) => s.stats.prestiges >= 1,
        progress: (s) => ratio(s.stats.prestiges, 1),
    },
];
export class QuestEngine {
    /** Quest definition by id, or undefined for unknown ids. */
    static getQuest(id) {
        return QUESTS.find((q) => q.id === id);
    }
    /** True when the quest is complete but its reward is still unclaimed. */
    static isClaimable(state, id) {
        const quest = QuestEngine.getQuest(id);
        return (quest !== undefined &&
            !state.claimedQuests.includes(id) &&
            quest.isComplete(state));
    }
    /** Ids of every quest currently claimable. */
    static claimableQuests(state) {
        return QUESTS.filter((q) => QuestEngine.isClaimable(state, q.id)).map((q) => q.id);
    }
}
