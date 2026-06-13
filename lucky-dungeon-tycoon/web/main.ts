/**
 * main.ts — DOM View Layer (Lucky Dungeon Tycoon v2)
 *
 * Pure presentation: binds buttons to GameController use cases and renders
 * EventBus broadcasts into the DOM. No game rules live here — if this file
 * were deleted, the model would still be complete and fully testable.
 */

import { EconomyEngine, MINER_CONFIGS } from '../src/EconomyEngine.js';
import { GameController } from '../src/GameController.js';
import { QUESTS } from '../src/QuestEngine.js';
import { SlotEngine } from '../src/SlotEngine.js';
import { gameEvents } from '../src/EventBus.js';
import {
  MAX_SHIELDS,
  MINER_TIERS,
  SlotSpinResult,
  UserProfile,
} from '../src/types.js';

/** Looks up a required element and fails loudly if the markup drifts. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return node as T;
}

const fmt = EconomyEngine.formatCurrency;

const goldEl = el<HTMLSpanElement>('stat-gold');
const gemsEl = el<HTMLSpanElement>('stat-gems');
const energyEl = el<HTMLSpanElement>('stat-energy');
const floorEl = el<HTMLSpanElement>('stat-level');
const rateEl = el<HTMLSpanElement>('stat-rate');
const relicsEl = el<HTMLSpanElement>('stat-relics');
const shieldsEl = el<HTMLSpanElement>('stat-shields');
const minersStatEl = el<HTMLSpanElement>('stat-miners');
const reelEl = el<HTMLDivElement>('reel');
const reelLabelEl = el<HTMLDivElement>('reel-label');
const logEl = el<HTMLUListElement>('log');
const popupEl = el<HTMLDivElement>('energy-popup');
const bossPanelEl = el<HTMLDivElement>('boss-panel');
const bossTitleEl = el<HTMLDivElement>('boss-title');
const bossHpFillEl = el<HTMLDivElement>('boss-hp-fill');
const spinBtn = el<HTMLButtonElement>('btn-spin');
const bossBtn = el<HTMLButtonElement>('btn-boss');
const upgradeBtn = el<HTMLButtonElement>('btn-upgrade');
const buyEnergyBtn = el<HTMLButtonElement>('btn-buy-energy');
const watchAdBtn = el<HTMLButtonElement>('btn-watch-ad');
const popupBuyBtn = el<HTMLButtonElement>('btn-popup-buy');
const popupAdBtn = el<HTMLButtonElement>('btn-popup-ad');
const popupCloseBtn = el<HTMLButtonElement>('btn-popup-close');
const minersListEl = el<HTMLDivElement>('miners-list');
const questsListEl = el<HTMLDivElement>('quests-list');
const questsBadgeEl = el<HTMLSpanElement>('quests-badge');
const prestigeNoteEl = el<HTMLParagraphElement>('prestige-note');
const prestigeProgressEl = el<HTMLDivElement>('prestige-progress');
const ascendBtn = el<HTMLButtonElement>('btn-ascend');
const statsSummaryEl = el<HTMLDivElement>('stats-summary');

const MAX_LOG_ENTRIES = 8;

function appendLog(message: string, severity: string): void {
  const item = document.createElement('li');
  item.textContent = message;
  item.className = `log-${severity}`;
  logEl.prepend(item);
  while (logEl.children.length > MAX_LOG_ENTRIES) {
    logEl.removeChild(logEl.lastChild as Node);
  }
}

// --- Tab navigation -----------------------------------------------------------

const tabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('nav button[data-tab]'),
);
for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
    for (const other of tabButtons) {
      other.classList.toggle('active', other === btn);
    }
    for (const section of document.querySelectorAll<HTMLElement>('section.tab')) {
      section.classList.toggle('active', section.id === btn.dataset.tab);
    }
  });
}

// --- Miners panel (static cards, dynamic numbers) -------------------------------

interface MinerCard {
  countEl: HTMLSpanElement;
  rateEl: HTMLSpanElement;
  hireBtn: HTMLButtonElement;
}
const minerCards = new Map<string, MinerCard>();

for (const tier of MINER_TIERS) {
  const cfg = MINER_CONFIGS[tier];
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="info">
      <div class="name">${cfg.name} ×<span data-count>0</span></div>
      <div class="desc"><span data-rate>${cfg.baseRate}</span> or/s par unité</div>
    </div>
    <button data-hire>Recruter</button>`;
  const hireBtn = card.querySelector<HTMLButtonElement>('[data-hire]')!;
  hireBtn.addEventListener('click', () => controller.hireMiner(tier));
  minersListEl.appendChild(card);
  minerCards.set(tier, {
    countEl: card.querySelector<HTMLSpanElement>('[data-count]')!,
    rateEl: card.querySelector<HTMLSpanElement>('[data-rate]')!,
    hireBtn,
  });
}

// --- Quests panel ----------------------------------------------------------------

interface QuestCard {
  root: HTMLDivElement;
  fillEl: HTMLDivElement;
  claimBtn: HTMLButtonElement;
}
const questCards = new Map<string, QuestCard>();

for (const quest of QUESTS) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="info">
      <div class="name">${quest.title}</div>
      <div class="desc">${quest.description} — 💎${quest.reward}</div>
      <div class="progress-track"><div class="progress-fill"></div></div>
    </div>
    <button data-claim>Réclamer</button>`;
  const claimBtn = card.querySelector<HTMLButtonElement>('[data-claim]')!;
  claimBtn.addEventListener('click', () => controller.claimQuest(quest.id));
  questsListEl.appendChild(card);
  questCards.set(quest.id, {
    root: card,
    fillEl: card.querySelector<HTMLDivElement>('.progress-fill')!,
    claimBtn,
  });
}

// --- Rendering ---------------------------------------------------------------------

function render(state: UserProfile): void {
  goldEl.textContent = fmt(state.gold);
  gemsEl.textContent = String(state.gems);
  energyEl.textContent = `${state.energy}/${state.maxEnergy}`;
  floorEl.textContent = String(state.floor);
  rateEl.textContent = fmt(Math.round(EconomyEngine.getPassiveRate(state)));
  relicsEl.textContent = String(state.relics);
  shieldsEl.textContent = `${state.shields}/${MAX_SHIELDS}`;
  const totalMiners = MINER_TIERS.reduce((sum, t) => sum + state.miners[t], 0);
  minersStatEl.textContent = String(totalMiners);

  const upgradeCost = EconomyEngine.getUpgradeCost(state.dungeonLevel);
  upgradeBtn.textContent = `⬆ Mine niv. ${state.dungeonLevel + 1} (${fmt(upgradeCost)})`;
  upgradeBtn.disabled = state.gold < upgradeCost;
  buyEnergyBtn.disabled = state.gems < 10;
  spinBtn.disabled = state.energy < 1;

  // Boss panel
  const fighting = state.bossHp !== null;
  bossPanelEl.hidden = !fighting;
  bossBtn.hidden = fighting;
  if (state.bossHp !== null) {
    const maxHp = EconomyEngine.getBossMaxHp(state.floor);
    bossTitleEl.textContent = `Gardien de l’étage ${state.floor} — ${fmt(state.bossHp)} / ${fmt(maxHp)} PV`;
    bossHpFillEl.style.width = `${Math.max(0, (state.bossHp / maxHp) * 100)}%`;
  } else {
    bossBtn.textContent = `⚔️ Défier le gardien de l’étage ${state.floor}`;
  }

  // Miners
  for (const tier of MINER_TIERS) {
    const card = minerCards.get(tier)!;
    const cost = EconomyEngine.getMinerCost(tier, state.miners[tier]);
    card.countEl.textContent = String(state.miners[tier]);
    card.rateEl.textContent = fmt(
      Math.round(MINER_CONFIGS[tier].baseRate * EconomyEngine.getGlobalMultiplier(state)),
    );
    card.hireBtn.textContent = `Recruter (${fmt(cost)})`;
    card.hireBtn.disabled = state.gold < cost;
  }

  // Quests
  let claimable = 0;
  for (const quest of QUESTS) {
    const card = questCards.get(quest.id)!;
    const claimed = state.claimedQuests.includes(quest.id);
    const complete = quest.isComplete(state);
    card.fillEl.style.width = `${Math.round(quest.progress(state) * 100)}%`;
    card.claimBtn.disabled = claimed || !complete;
    card.claimBtn.textContent = claimed ? '✓ Réclamé' : 'Réclamer';
    card.root.style.opacity = claimed ? '0.55' : '1';
    if (!claimed && complete) {
      claimable += 1;
    }
  }
  questsBadgeEl.textContent = String(claimable);
  questsBadgeEl.style.display = claimable > 0 ? 'block' : 'none';

  // Prestige
  const relics = EconomyEngine.getPrestigeRelics(state.stats.goldEarnedRun);
  const threshold = 1_000_000;
  prestigeProgressEl.style.width = `${Math.min(100, (state.stats.goldEarnedRun / threshold) * 100)}%`;
  ascendBtn.disabled = relics <= 0;
  ascendBtn.textContent = relics > 0 ? `Ascendre (+${relics} ✨)` : 'Ascendre';
  prestigeNoteEl.textContent = relics > 0
    ? `Prêt ! L’ascension rapporterait ${relics} relique(s).`
    : `Amassez ${fmt(threshold)} or dans ce cycle (actuel : ${fmt(state.stats.goldEarnedRun)}).`;
  statsSummaryEl.textContent =
    `${fmt(state.stats.goldEarnedAll)} or amassé · ${state.stats.totalSpins} spins · ` +
    `${state.stats.bossesKilled} boss vaincus · ${state.stats.prestiges} ascensions`;
}

function showSpinResult(result: SlotSpinResult): void {
  reelEl.innerHTML = result.symbols
    .map((s) => `<span>${SlotEngine.iconFor(s)}</span>`)
    .join('');
  reelEl.classList.remove('reel-pop');
  // Force a reflow so the pop animation restarts on consecutive spins.
  void reelEl.offsetWidth;
  reelEl.classList.add('reel-pop');

  const parts: string[] = [`+${fmt(result.goldGained)} or`];
  if (result.gemsGained > 0) parts.push(`+${result.gemsGained} 💎`);
  if (result.shieldsGained > 0) parts.push(`+${result.shieldsGained} 🛡️`);
  if (result.goldStolen > 0) parts.push(`−${fmt(result.goldStolen)} or volé`);
  if (result.bossDamage > 0) parts.push(`${fmt(result.bossDamage)} dégâts`);
  reelLabelEl.textContent = `${result.label} · ${parts.join(' · ')}`;
  appendLog(`${result.label} ${parts.join(' · ')}`, result.outcome === 'JACKPOT' ? 'success' : 'info');
}

// --- Wire model -> view -------------------------------------------------------------

gameEvents.on('state:updated', render);
gameEvents.on('spin:result', showSpinResult);
gameEvents.on('ui:notification', (n) => appendLog(n.message, n.severity));
gameEvents.on('ui:popup_energy', () => popupEl.classList.add('visible'));

// --- Boot the controller (constructor emits the first state:updated) ----------------

const controller = new GameController();
controller.start();

// --- Wire view -> model ---------------------------------------------------------------

spinBtn.addEventListener('click', () => controller.spin());
bossBtn.addEventListener('click', () => controller.startBossFight());
upgradeBtn.addEventListener('click', () => controller.upgradeDungeon());
buyEnergyBtn.addEventListener('click', () => controller.buyEnergyWithGems());
ascendBtn.addEventListener('click', () => controller.ascend());

const runAd = async (button: HTMLButtonElement): Promise<void> => {
  button.disabled = true;
  appendLog('Lecture de la pub…', 'info');
  try {
    await controller.watchAdForEnergy();
  } finally {
    button.disabled = false;
  }
};
watchAdBtn.addEventListener('click', () => void runAd(watchAdBtn));

popupBuyBtn.addEventListener('click', () => {
  if (controller.buyEnergyWithGems()) {
    popupEl.classList.remove('visible');
  }
});
popupAdBtn.addEventListener('click', () => {
  popupEl.classList.remove('visible');
  void runAd(watchAdBtn);
});
popupCloseBtn.addEventListener('click', () => popupEl.classList.remove('visible'));

// Flush a final save when the tab is backgrounded or closed.
window.addEventListener('pagehide', () => controller.stop());
