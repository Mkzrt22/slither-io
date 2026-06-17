/**
 * main.ts — DOM View Layer (Lucky Dungeon Tycoon — premium UI).
 *
 * Pure presentation: binds buttons to GameController use cases and renders
 * EventBus broadcasts into a juiced-up dungeon scene (animated reels,
 * particle bursts, eased counters, a reactive boss). No game rules live
 * here — the model is complete and testable without this file.
 */

import { EconomyEngine, PRESTIGE_THRESHOLD } from '../src/EconomyEngine.js';
import { BUILDING_CONFIGS, VillageEngine } from '../src/VillageEngine.js';
import { GameController } from '../src/GameController.js';
import { QUESTS } from '../src/QuestEngine.js';
import { gameEvents } from '../src/EventBus.js';
import {
  BUILDING_TYPES,
  BuildingType,
  MAX_SHIELDS,
  SlotSpinResult,
  SlotSymbol,
  UserProfile,
} from '../src/types.js';
import { NumberTween, ParticleSystem, SlotReels } from './effects.js';
import { IsoScene } from './iso.js';
import { Iso3DScene, webglAvailable } from './iso3d.js';

/** Common shape both the 3D (WebGL) and 2D (canvas) village renderers expose. */
interface VillageRenderer {
  setState(state: UserProfile): void;
  resize(): void;
  coinPop(type: BuildingType): void;
  start(): void;
  stop(): void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Missing required element #${id}`);
  }
  return node as T;
}

const fmt = EconomyEngine.formatCurrency;
const fmtInt = (n: number): string => Math.round(n).toString();

const SYMBOL_EMOJI: Record<SlotSymbol, string> = {
  COIN: '🪙',
  BAG: '💰',
  GEM: '💎',
  SHIELD: '🛡️',
  SWORD: '⚔️',
  SKULL: '💀',
};

/** Boss face by floor band, so deeper floors feel different. */
function bossEmoji(floor: number): string {
  const faces = ['👹', '👺', '🧟', '🐲', '👿', '💀', '🦇', '🐉'];
  return faces[(floor - 1) % faces.length];
}

// --- Element handles ---------------------------------------------------------

const sceneEl = el<HTMLDivElement>('scene');
const fxCanvas = el<HTMLCanvasElement>('fx');
const reelHost = el<HTMLDivElement>('reel');
const reelLabelEl = el<HTMLDivElement>('reel-label');
const hoardEl = el<HTMLDivElement>('hoard');
const logEl = el<HTMLUListElement>('log');
const popupEl = el<HTMLDivElement>('energy-popup');

const floorEl = el<HTMLSpanElement>('stat-level');
const floorBannerEl = document.querySelector<HTMLDivElement>('.floor-banner')!;
const rateEl = el<HTMLSpanElement>('stat-rate');
const shieldsEl = el<HTMLSpanElement>('stat-shields');
const buildingsStatEl = el<HTMLSpanElement>('stat-buildings');

const bossPanelEl = el<HTMLDivElement>('boss-panel');
const bossTitleEl = el<HTMLDivElement>('boss-title');
const bossSpriteEl = el<HTMLDivElement>('boss-sprite');
const bossHpFillEl = el<HTMLDivElement>('boss-hp-fill');
const bossHpTextEl = el<HTMLSpanElement>('boss-hp-text');

const spinBtn = el<HTMLButtonElement>('btn-spin');
const bossBtn = el<HTMLButtonElement>('btn-boss');
const fleeBtn = el<HTMLButtonElement>('btn-flee');
const upgradeBtn = el<HTMLButtonElement>('btn-upgrade');
const buyEnergyBtn = el<HTMLButtonElement>('btn-buy-energy');
const watchAdBtn = el<HTMLButtonElement>('btn-watch-ad');
const popupBuyBtn = el<HTMLButtonElement>('btn-popup-buy');
const popupAdBtn = el<HTMLButtonElement>('btn-popup-ad');
const popupCloseBtn = el<HTMLButtonElement>('btn-popup-close');

const buildingsListEl = el<HTMLDivElement>('buildings-list');
const villageNameEl = el<HTMLDivElement>('village-name');
const villageMultEl = el<HTMLDivElement>('village-mult');
const villageEmojiEl = el<HTMLSpanElement>('village-emoji');
const isoHostEl = el<HTMLDivElement>('iso-host');
const advanceCountEl = el<HTMLSpanElement>('advance-count');
const advanceFillEl = el<HTMLDivElement>('advance-fill');
const advanceBtn = el<HTMLButtonElement>('btn-advance');
const questsListEl = el<HTMLDivElement>('quests-list');
const questsBadgeEl = el<HTMLSpanElement>('quests-badge');
const prestigeNoteEl = el<HTMLParagraphElement>('prestige-note');
const prestigeMultEl = el<HTMLDivElement>('prestige-mult');
const prestigeProgressEl = el<HTMLDivElement>('prestige-progress');
const ascendBtn = el<HTMLButtonElement>('btn-ascend');
const statsSummaryEl = el<HTMLDivElement>('stats-summary');

// --- Effects -----------------------------------------------------------------

const particles = new ParticleSystem(fxCanvas);
const cellPx = 76;
const tokenHtml = (s: SlotSymbol): string =>
  `<div class="token t-${s}"><span>${SYMBOL_EMOJI[s]}</span></div>`;
const reels = new SlotReels(reelHost, tokenHtml, cellPx);

const goldTween = new NumberTween(el<HTMLSpanElement>('stat-gold'), fmt, 0);
const gemsTween = new NumberTween(el<HTMLSpanElement>('stat-gems'), fmtInt, 0);
const relicTween = new NumberTween(el<HTMLSpanElement>('stat-relics'), fmtInt, 0);
const energyEl = el<HTMLSpanElement>('stat-energy');

let firstRender = true;
let lastBossHp: number | null = null;

const MAX_LOG_ENTRIES = 9;
function appendLog(message: string, severity: string): void {
  const item = document.createElement('li');
  item.textContent = message;
  item.className = `log-${severity}`;
  logEl.prepend(item);
  while (logEl.children.length > MAX_LOG_ENTRIES) {
    logEl.removeChild(logEl.lastChild as Node);
  }
}

/** Centre of the slot window in canvas (scene) coordinates. */
function reelCentre(): { x: number; y: number } {
  const scene = sceneEl.getBoundingClientRect();
  const win = reelHost.getBoundingClientRect();
  return { x: win.left - scene.left + win.width / 2, y: win.top - scene.top + win.height / 2 };
}

// --- Tab navigation ----------------------------------------------------------

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
    if (btn.dataset.tab === 'tab-mine') {
      particles.resize();
    }
    if (btn.dataset.tab === 'tab-village') {
      iso.resize();
    }
  });
}

// --- Building cards + village panorama ---------------------------------------

interface BuildingCard { levelEl: HTMLElement; rateEl: HTMLElement; buyBtn: HTMLButtonElement; }
const buildingCards = new Map<BuildingType, BuildingCard>();

for (const type of BUILDING_TYPES) {
  const cfg = BUILDING_CONFIGS[type];
  const card = document.createElement('div');
  card.className = 'card building-card';
  card.innerHTML = `
    <div class="b-avatar">${cfg.icon}</div>
    <div class="b-info">
      <div class="b-name">${cfg.name} <b>Niv. <span data-level>0</span></b></div>
      <div class="b-stat"><span class="up" data-rate>0</span> or/s</div>
    </div>
    <button data-buy>Améliorer</button>`;
  const buyBtn = card.querySelector<HTMLButtonElement>('[data-buy]')!;
  buyBtn.addEventListener('click', () => {
    if (controller.upgradeBuilding(type)) iso.coinPop(type);
  });
  buildingsListEl.appendChild(card);
  buildingCards.set(type, {
    levelEl: card.querySelector<HTMLElement>('[data-level]')!,
    rateEl: card.querySelector<HTMLElement>('[data-rate]')!,
    buyBtn,
  });
}

// Isometric village scene — real 3D when WebGL is available, else a 2D
// canvas fallback. Tapping a building upgrades it.
const onTapBuilding = (type: BuildingType): void => {
  if (controller.upgradeBuilding(type)) iso.coinPop(type);
};

function makeIsoCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'iso-canvas';
  isoHostEl.appendChild(canvas);
  return canvas;
}

const iso: VillageRenderer = createVillageRenderer();

function createVillageRenderer(): VillageRenderer {
  if (webglAvailable()) {
    try {
      return new Iso3DScene(makeIsoCanvas(), onTapBuilding);
    } catch (err) {
      console.warn('[village] WebGL renderer failed, falling back to 2D', err);
      isoHostEl.innerHTML = '';
    }
  }
  return new IsoScene(makeIsoCanvas(), onTapBuilding);
}

advanceBtn.addEventListener('click', () => {
  if (controller.advanceVillage()) {
    particles.confetti(90);
  }
});

// --- Quest cards -------------------------------------------------------------

interface QuestCard { root: HTMLElement; fillEl: HTMLElement; claimBtn: HTMLButtonElement; }
const questCards = new Map<string, QuestCard>();
const QUEST_ICONS: Record<string, string> = {
  first_vein: '🪙', spin_100: '🎰', foreman: '👷', first_boss: '⚔️',
  floor_5: '🧗', magnate: '👑', ascended: '🔮', builder: '🏗️', pioneer: '🚩',
};

for (const quest of QUESTS) {
  const card = document.createElement('div');
  card.className = 'card quest-card';
  card.innerHTML = `
    <div class="q-ic">${QUEST_ICONS[quest.id] ?? '⭐'}</div>
    <div class="q-info">
      <div class="q-title">${quest.title}</div>
      <div class="q-desc">${quest.description} — 💎${quest.reward}</div>
      <div class="q-track"><div class="q-fill"></div></div>
    </div>
    <button class="q-claim" data-claim>Réclamer</button>`;
  const claimBtn = card.querySelector<HTMLButtonElement>('[data-claim]')!;
  claimBtn.addEventListener('click', () => controller.claimQuest(quest.id));
  questsListEl.appendChild(card);
  questCards.set(quest.id, {
    root: card,
    fillEl: card.querySelector<HTMLElement>('.q-fill')!,
    claimBtn,
  });
}

// --- Rendering ---------------------------------------------------------------

function render(state: UserProfile): void {
  const animate = !firstRender;
  goldTween.set(state.gold, animate); // only the gold counter eases — it's the hero number
  gemsTween.set(state.gems, false);
  relicTween.set(state.relics, false);
  energyEl.textContent = `${state.energy}/${state.maxEnergy}`;
  floorEl.textContent = String(state.floor);
  rateEl.textContent = fmt(Math.round(EconomyEngine.getPassiveRate(state)));
  shieldsEl.textContent = `${state.shields}/${MAX_SHIELDS}`;
  const totalLevels = VillageEngine.getTotalLevels(state);
  buildingsStatEl.textContent = String(totalLevels);

  // Hoard grows with logarithmic wealth.
  const wealth = Math.max(0, Math.log10(state.gold + 1) / 9); // ~0..1 across 1e9
  hoardEl.style.setProperty('--hoard-x', (0.35 + wealth * 0.9).toFixed(2));
  hoardEl.style.setProperty('--hoard-o', (0.18 + wealth * 0.7).toFixed(2));

  const upgradeCost = EconomyEngine.getUpgradeCost(state.dungeonLevel);
  upgradeBtn.innerHTML = `⬆️<span>Niv. ${state.dungeonLevel + 1} · ${fmt(upgradeCost)}</span>`;
  upgradeBtn.disabled = state.gold < upgradeCost;
  buyEnergyBtn.disabled = state.gems < 10;
  spinBtn.disabled = state.energy < 1;

  // Boss
  const fighting = state.bossHp !== null;
  bossPanelEl.hidden = !fighting;
  bossBtn.hidden = fighting;
  fleeBtn.hidden = !fighting;
  floorBannerEl.hidden = fighting; // boss card already shows the floor
  if (state.bossHp !== null) {
    const maxHp = EconomyEngine.getBossMaxHp(state.floor);
    bossSpriteEl.textContent = bossEmoji(state.floor);
    bossTitleEl.textContent = `Gardien · Étage ${state.floor}`;
    bossHpFillEl.style.width = `${Math.max(0, (state.bossHp / maxHp) * 100)}%`;
    bossHpTextEl.textContent = `${fmt(state.bossHp)} / ${fmt(maxHp)}`;
    if (lastBossHp !== null && state.bossHp < lastBossHp) {
      bossSpriteEl.classList.remove('boss-hit');
      void bossSpriteEl.offsetWidth;
      bossSpriteEl.classList.add('boss-hit');
      const c = reelCentre();
      particles.sparks(sceneEl.clientWidth / 2, c.y - 70, 14, '#ffd0d0');
    }
    lastBossHp = state.bossHp;
  } else {
    lastBossHp = null;
    bossBtn.innerHTML = `⚔️<span>Défier (étage ${state.floor})</span>`;
  }

  // Village header
  villageNameEl.textContent = `${VillageEngine.getVillageName(state.village)} · Niv. ${state.village}`;
  villageMultEl.textContent = `×${VillageEngine.getVillageMultiplier(state.village).toFixed(1)} production`;
  const villageEmojis = ['🏕️', '🏘️', '🏙️', '🏰', '🏯', '🌆'];
  villageEmojiEl.textContent = villageEmojis[(state.village - 1) % villageEmojis.length];

  // Village advancement
  const required = VillageEngine.getRequiredLevels(state.village);
  const canAdvance = VillageEngine.canAdvance(state);
  advanceCountEl.textContent = `${totalLevels} / ${required}`;
  advanceFillEl.style.width = `${Math.round(VillageEngine.getAdvanceProgress(state) * 100)}%`;
  advanceBtn.disabled = !canAdvance;
  advanceBtn.classList.toggle('ready', canAdvance);

  // Buildings (upgrade cards) + isometric scene
  const globalMult = EconomyEngine.getGlobalMultiplier(state);
  for (const type of BUILDING_TYPES) {
    const level = state.buildings[type];
    const card = buildingCards.get(type)!;
    const cost = VillageEngine.getBuildingCost(type, level);
    const perLevel = BUILDING_CONFIGS[type].baseProd * globalMult;
    card.levelEl.textContent = String(level);
    card.rateEl.textContent = fmt(Math.round(perLevel * level));
    card.buyBtn.innerHTML = `Améliorer<br/>${fmt(cost)}`;
    card.buyBtn.disabled = state.gold < cost;
  }
  iso.setState(state);

  // Quests
  let claimable = 0;
  for (const quest of QUESTS) {
    const card = questCards.get(quest.id)!;
    const claimed = state.claimedQuests.includes(quest.id);
    const complete = quest.isComplete(state);
    card.fillEl.style.width = `${Math.round(quest.progress(state) * 100)}%`;
    card.claimBtn.disabled = claimed || !complete;
    card.claimBtn.textContent = claimed ? '✓ Fait' : 'Réclamer';
    card.claimBtn.classList.toggle('ready', !claimed && complete);
    card.root.classList.toggle('done', claimed);
    if (!claimed && complete) claimable += 1;
  }
  questsBadgeEl.textContent = String(claimable);
  questsBadgeEl.style.display = claimable > 0 ? 'flex' : 'none';

  // Prestige
  const relics = EconomyEngine.getPrestigeRelics(state.stats.goldEarnedRun);
  const threshold = PRESTIGE_THRESHOLD;
  prestigeMultEl.textContent = `×${EconomyEngine.getRelicMultiplier(state.relics).toFixed(1)}`;
  prestigeProgressEl.style.width = `${Math.min(100, (state.stats.goldEarnedRun / threshold) * 100)}%`;
  ascendBtn.disabled = relics <= 0;
  ascendBtn.textContent = relics > 0 ? `Ascendre · +${relics} 🔮` : 'Ascendre';
  prestigeNoteEl.textContent = relics > 0
    ? `Prêt ! L’ascension rapporterait ${relics} relique(s).`
    : `Amassez ${fmt(threshold)} or dans ce cycle (actuel : ${fmt(state.stats.goldEarnedRun)}).`;
  statsSummaryEl.innerHTML =
    `💰 ${fmt(state.stats.goldEarnedAll)} or amassé<br/>` +
    `🎰 ${state.stats.totalSpins} spins · ⚔️ ${state.stats.bossesKilled} boss<br/>` +
    `🔮 ${state.stats.prestiges} ascension(s)`;

  firstRender = false;
}

function showSpinResult(result: SlotSpinResult): void {
  void reels.spinTo(result.symbols, () => { /* per-reel land handled below */ });

  // Build the result line.
  const parts: string[] = [`+${fmt(result.goldGained)} or`];
  if (result.gemsGained > 0) parts.push(`+${result.gemsGained} 💎`);
  if (result.shieldsGained > 0) parts.push(`+${result.shieldsGained} 🛡️`);
  if (result.goldStolen > 0) parts.push(`−${fmt(result.goldStolen)} or`);
  if (result.bossDamage > 0) parts.push(`${fmt(result.bossDamage)} dégâts`);

  // After the reels settle, fire the payoff effects.
  const settleMs = 1450;
  window.setTimeout(() => {
    reelLabelEl.textContent = `${result.label} · ${parts.join(' · ')}`;
    const c = reelCentre();
    const cx = sceneEl.clientWidth / 2;

    if (result.outcome === 'JACKPOT') {
      sceneEl.classList.remove('shake');
      void sceneEl.offsetWidth;
      sceneEl.classList.add('shake');
      particles.confetti(70);
      particles.burstCoins(cx, c.y, 34);
      particles.floatText(cx, c.y - 30, 'JACKPOT !', '#ffe08a', true);
    } else if (result.goldStolen > 0) {
      particles.floatText(cx, c.y - 20, `−${fmt(result.goldStolen)}`, '#f0636c');
    } else {
      particles.burstCoins(cx, c.y, result.outcome === 'PAIR' ? 16 : 8);
      particles.floatText(cx, c.y - 20, `+${fmt(result.goldGained)}`, '#ffe08a');
    }
    if (result.gemsGained > 0) particles.burstGems(cx, c.y, 12);
  }, settleMs);

  appendLog(`${result.label} · ${parts.join(' · ')}`, result.outcome === 'JACKPOT' ? 'success' : 'info');
}

// --- Wire model -> view ------------------------------------------------------

gameEvents.on('state:updated', render);
gameEvents.on('spin:result', showSpinResult);
gameEvents.on('ui:notification', (n) => appendLog(n.message, n.severity));
gameEvents.on('ui:popup_energy', () => popupEl.classList.add('visible'));

// --- Boot --------------------------------------------------------------------

const controller = new GameController();
controller.start();
requestAnimationFrame(() => { particles.resize(); iso.resize(); });

// --- Wire view -> model ------------------------------------------------------

spinBtn.addEventListener('click', () => controller.spin());
bossBtn.addEventListener('click', () => controller.startBossFight());
fleeBtn.addEventListener('click', () => controller.fleeBossFight());
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
  if (controller.buyEnergyWithGems()) popupEl.classList.remove('visible');
});
popupAdBtn.addEventListener('click', () => {
  popupEl.classList.remove('visible');
  void runAd(watchAdBtn);
});
popupCloseBtn.addEventListener('click', () => popupEl.classList.remove('visible'));

window.addEventListener('pagehide', () => controller.stop());
