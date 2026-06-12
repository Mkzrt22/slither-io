/**
 * main.ts — DOM View Layer (Lucky Dungeon Tycoon)
 *
 * Pure presentation: binds buttons to GameController use cases and renders
 * EventBus broadcasts into the DOM. No game rules live here — if this file
 * were deleted, the model would still be complete and fully testable.
 */

import { EconomyEngine } from '../src/EconomyEngine.js';
import { GameController } from '../src/GameController.js';
import { gameEvents } from '../src/EventBus.js';
import { MAX_SHIELDS, SpinResult, UserProfile } from '../src/types.js';

/** Looks up a required element and fails loudly if the markup drifts. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return node as T;
}

const goldEl = el<HTMLSpanElement>('stat-gold');
const gemsEl = el<HTMLSpanElement>('stat-gems');
const energyEl = el<HTMLSpanElement>('stat-energy');
const levelEl = el<HTMLSpanElement>('stat-level');
const shieldsEl = el<HTMLSpanElement>('stat-shields');
const reelEl = el<HTMLDivElement>('reel');
const logEl = el<HTMLUListElement>('log');
const popupEl = el<HTMLDivElement>('energy-popup');
const spinBtn = el<HTMLButtonElement>('btn-spin');
const upgradeBtn = el<HTMLButtonElement>('btn-upgrade');
const buyEnergyBtn = el<HTMLButtonElement>('btn-buy-energy');
const watchAdBtn = el<HTMLButtonElement>('btn-watch-ad');
const popupBuyBtn = el<HTMLButtonElement>('btn-popup-buy');
const popupAdBtn = el<HTMLButtonElement>('btn-popup-ad');
const popupCloseBtn = el<HTMLButtonElement>('btn-popup-close');

const REEL_LABELS: Record<SpinResult['type'], string> = {
  GOLD_MIN: '🪙 Gold!',
  GOLD_MAJ: '💰 Big Gold!',
  SHIELD: '🛡️ Shield!',
  RAID: '⚔️ Raid Loot!',
};

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

function render(state: UserProfile): void {
  goldEl.textContent = EconomyEngine.formatCurrency(state.gold);
  gemsEl.textContent = String(state.gems);
  energyEl.textContent = `${state.energy}/${state.maxEnergy}`;
  levelEl.textContent = String(state.dungeonLevel);
  shieldsEl.textContent = `${state.shields}/${MAX_SHIELDS}`;

  const cost = EconomyEngine.getUpgradeCost(state.dungeonLevel);
  upgradeBtn.textContent = `⬆ Upgrade (${EconomyEngine.formatCurrency(cost)})`;
  upgradeBtn.disabled = state.gold < cost;
  buyEnergyBtn.disabled = state.gems < 10;
  spinBtn.disabled = state.energy < 1;
}

function showSpinResult(result: SpinResult): void {
  reelEl.textContent = REEL_LABELS[result.type];
  reelEl.classList.remove('reel-pop');
  // Force a reflow so the pop animation restarts on consecutive spins.
  void reelEl.offsetWidth;
  reelEl.classList.add('reel-pop');

  const detail =
    result.type === 'SHIELD' && result.value === 1
      ? '+1 shield'
      : `+${EconomyEngine.formatCurrency(result.value)} gold`;
  appendLog(`${REEL_LABELS[result.type]} ${detail}`, 'success');
}

// --- Wire model -> view ------------------------------------------------------

gameEvents.on('state:updated', render);
gameEvents.on('spin:result', showSpinResult);
gameEvents.on('ui:notification', (n) => appendLog(n.message, n.severity));
gameEvents.on('ui:popup_energy', () => popupEl.classList.add('visible'));

// --- Boot the controller (constructor emits the first state:updated) ---------

const controller = new GameController();
controller.start();

// --- Wire view -> model ------------------------------------------------------

spinBtn.addEventListener('click', () => controller.spin());
upgradeBtn.addEventListener('click', () => controller.upgradeDungeon());
buyEnergyBtn.addEventListener('click', () => controller.buyEnergyWithGems());

const runAd = async (button: HTMLButtonElement): Promise<void> => {
  button.disabled = true;
  appendLog('Playing ad…', 'info');
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
