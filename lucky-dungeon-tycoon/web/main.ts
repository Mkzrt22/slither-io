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
import { RELIC_UPGRADES, RelicShopEngine } from '../src/RelicShopEngine.js';
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
import { Sfx } from './sfx.js';

type BuyMode = 1 | 10 | 'max';

/** Light haptic tap where supported (no-op elsewhere). */
function buzz(ms: number): void {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

/** Common shape both the 3D (WebGL) and 2D (canvas) village renderers expose. */
interface VillageRenderer {
  setState(state: UserProfile): void;
  resize(): void;
  coinPop(type: BuildingType): void;
  start(): void;
  stop(): void;
  /** Optional: react to an active production boost (3D speeds up the bustle). */
  setBoost?(active: boolean): void;
}

/** Pure boost factor from a profile snapshot (avoids touching the controller). */
function boostFactorOf(state: UserProfile): number {
  return Date.now() < state.boostEndsAt ? 2 : 1;
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

const offlineModal = el<HTMLDivElement>('offline-modal');
const offlineAmountEl = el<HTMLDivElement>('offline-amount');
const offlineDetailEl = el<HTMLParagraphElement>('offline-detail');
const offlineX2Btn = el<HTMLButtonElement>('btn-offline-x2');
const offlineOkBtn = el<HTMLButtonElement>('btn-offline-ok');
const settingsModal = el<HTMLDivElement>('settings-modal');
const settingsBtn = el<HTMLButtonElement>('btn-settings');
const settingsCloseBtn = el<HTMLButtonElement>('btn-settings-close');
const soundBtn = el<HTMLButtonElement>('btn-sound');
const resetBtn = el<HTMLButtonElement>('btn-reset');
const exportBtn = el<HTMLButtonElement>('btn-export');
const importBtn = el<HTMLButtonElement>('btn-import');
const dailyModal = el<HTMLDivElement>('daily-modal');
const dailyStreakEl = el<HTMLParagraphElement>('daily-streak');
const dailyRewardEl = el<HTMLDivElement>('daily-reward');
const dailyClaimBtn = el<HTMLButtonElement>('btn-daily-claim');

const buildingsListEl = el<HTMLDivElement>('buildings-list');
const villageNameEl = el<HTMLDivElement>('village-name');
const villageMultEl = el<HTMLDivElement>('village-mult');
const villageEmojiEl = el<HTMLSpanElement>('village-emoji');
const isoHostEl = el<HTMLDivElement>('iso-host');
const advanceCountEl = el<HTMLSpanElement>('advance-count');
const advanceFillEl = el<HTMLDivElement>('advance-fill');
const advanceBtn = el<HTMLButtonElement>('btn-advance');
const boostBtn = el<HTMLButtonElement>('btn-boost');
const boostBadge = el<HTMLDivElement>('boost-badge');
const buildSheet = el<HTMLDivElement>('buildings-sheet');
const openBuildBtn = el<HTMLButtonElement>('btn-open-build');
const closeBuildBtn = el<HTMLButtonElement>('btn-build-close');
const sheetBackdrop = el<HTMLDivElement>('sheet-backdrop');
const questsListEl = el<HTMLDivElement>('quests-list');
const questsBadgeEl = el<HTMLSpanElement>('quests-badge');
const prestigeNoteEl = el<HTMLParagraphElement>('prestige-note');
const prestigeMultEl = el<HTMLDivElement>('prestige-mult');
const prestigeProgressEl = el<HTMLDivElement>('prestige-progress');
const ascendBtn = el<HTMLButtonElement>('btn-ascend');
const statsSummaryEl = el<HTMLDivElement>('stats-summary');
const relicBalanceEl = el<HTMLSpanElement>('relic-balance');
const relicShopListEl = el<HTMLDivElement>('relic-shop-list');

// --- Effects -----------------------------------------------------------------

const sfx = new Sfx();
let buyMode: BuyMode = 1;
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
      // The map is flex-sized, so resize after layout settles.
      requestAnimationFrame(() => iso.resize());
    } else {
      closeBuildSheet();
    }
  });
}

// --- Building cards + village panorama ---------------------------------------

interface BuildingCard {
  levelEl: HTMLElement; rateEl: HTMLElement; synergyEl: HTMLElement;
  barEl: HTMLElement; nextEl: HTMLElement; buyLabelEl: HTMLElement; costEl: HTMLElement;
  buyBtn: HTMLButtonElement;
}
const buildingCards = new Map<BuildingType, BuildingCard>();

for (const type of BUILDING_TYPES) {
  const cfg = BUILDING_CONFIGS[type];
  const card = document.createElement('div');
  card.className = 'card building-card';
  card.innerHTML = `
    <div class="b-avatar">
      <span class="b-emoji">${cfg.icon}</span>
      <span class="b-lvl">Niv.<span data-level>0</span></span>
    </div>
    <div class="b-info">
      <div class="b-name">${cfg.name}</div>
      <div class="b-income">🪙 <span class="up" data-rate>0</span> /s</div>
      <div class="b-bar"><div class="b-bar-fill" data-bar></div></div>
      <div class="b-next" data-next></div>
      <div class="b-synergy" data-synergy></div>
    </div>
    <button data-buy>
      <span class="b-buy-lbl" data-buylabel>Améliorer</span>
      <span class="b-buy-cost"><span class="b-buy-coin">🪙</span><span data-cost>0</span></span>
    </button>`;
  const buyBtn = card.querySelector<HTMLButtonElement>('[data-buy]')!;
  buyBtn.addEventListener('click', () => buyBuilding(type));
  buildingsListEl.appendChild(card);
  buildingCards.set(type, {
    levelEl: card.querySelector<HTMLElement>('[data-level]')!,
    rateEl: card.querySelector<HTMLElement>('[data-rate]')!,
    synergyEl: card.querySelector<HTMLElement>('[data-synergy]')!,
    barEl: card.querySelector<HTMLElement>('[data-bar]')!,
    nextEl: card.querySelector<HTMLElement>('[data-next]')!,
    buyLabelEl: card.querySelector<HTMLElement>('[data-buylabel]')!,
    costEl: card.querySelector<HTMLElement>('[data-cost]')!,
    buyBtn,
  });
}

/** Shared building-purchase action (cards + 3D tap), honouring the buy mode. */
function buyBuilding(type: BuildingType): void {
  sfx.unlock();
  const bought = controller.buyBuilding(type, buyMode);
  if (bought > 0) {
    iso.coinPop(type);
    sfx.upgrade();
    buzz(12);
  } else {
    sfx.error();
  }
}

// Isometric village scene — real 3D when WebGL is available, else a 2D
// canvas fallback. Tapping a building upgrades it.
const onTapBuilding = (type: BuildingType): void => buyBuilding(type);

// Upgrade bottom sheet (opened from the full-screen map).
function openBuildSheet(): void {
  buildSheet.classList.add('open');
  buildSheet.setAttribute('aria-hidden', 'false');
  sfx.click();
  buzz(8);
}
function closeBuildSheet(): void {
  buildSheet.classList.remove('open');
  buildSheet.setAttribute('aria-hidden', 'true');
}
openBuildBtn.addEventListener('click', openBuildSheet);
closeBuildBtn.addEventListener('click', closeBuildSheet);
sheetBackdrop.addEventListener('click', closeBuildSheet);

// Buy-mode toggle (×1 / ×10 / Max).
const buyModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('#buy-modes button'),
);
for (const btn of buyModeButtons) {
  btn.addEventListener('click', () => {
    const m = btn.dataset.mode;
    buyMode = m === 'max' ? 'max' : (Number(m) as 1 | 10);
    for (const other of buyModeButtons) other.classList.toggle('active', other === btn);
    render(controller.getState());
  });
}

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

// Relic shop cards (prestige meta-upgrades).
interface RelicCard { levelEl: HTMLElement; effectEl: HTMLElement; buyBtn: HTMLButtonElement; }
const relicCards = new Map<string, RelicCard>();

for (const def of RELIC_UPGRADES) {
  const card = document.createElement('div');
  card.className = 'card relic-card';
  card.innerHTML = `
    <div class="r-ic">${def.icon}</div>
    <div class="r-info">
      <div class="r-title">${def.name} <b>Niv. <span data-level>0</span>/${def.maxLevel}</b></div>
      <div class="r-effect" data-effect>${def.description}</div>
    </div>
    <button class="r-buy" data-buy>—</button>`;
  const buyBtn = card.querySelector<HTMLButtonElement>('[data-buy]')!;
  buyBtn.addEventListener('click', () => {
    if (controller.buyRelicUpgrade(def.id)) {
      sfx.click();
      buzz(8);
    }
  });
  relicShopListEl.appendChild(card);
  relicCards.set(def.id, {
    levelEl: card.querySelector<HTMLElement>('[data-level]')!,
    effectEl: card.querySelector<HTMLElement>('[data-effect]')!,
    buyBtn,
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
  rateEl.textContent = fmt(Math.round(EconomyEngine.getPassiveRate(state) * boostFactorOf(state)));
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
    const mult = VillageEngine.getBuildingMultiplier(level);
    const prod = VillageEngine.getBuildingProduction(type, level) * globalMult;
    card.levelEl.textContent = String(level);
    card.rateEl.textContent = fmt(Math.round(prod));
    const toNext = VillageEngine.levelsToNextMilestone(level);
    // Milestone progress bar: fills toward the next ×2 boost, then resets.
    const pct = ((level % VillageEngine.MILESTONE_EVERY) / VillageEngine.MILESTONE_EVERY) * 100;
    card.barEl.style.width = `${level === 0 ? 0 : Math.max(5, pct)}%`;
    card.nextEl.textContent = mult > 1
      ? `×${mult} · prochain palier ×${mult * 2} dans ${toNext}`
      : `prochain palier ×2 dans ${toNext}`;
    card.synergyEl.textContent = VillageEngine.getSynergyText(type, level);

    const plan = buyMode === 'max'
      ? VillageEngine.getMaxAffordable(type, level, state.gold)
      : { count: buyMode, cost: VillageEngine.getBulkCost(type, level, buyMode) };
    card.buyLabelEl.textContent = buyMode === 1 ? 'Améliorer' : `Améliorer ×${plan.count || buyMode}`;
    card.costEl.textContent = fmt(plan.cost);
    card.buyBtn.disabled = plan.count < 1 || state.gold < plan.cost;
    card.buyBtn.classList.toggle('affordable', plan.count >= 1 && state.gold >= plan.cost);
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

  // Relic shop
  relicBalanceEl.textContent = `${fmtInt(state.relics)} 🔮`;
  for (const def of RELIC_UPGRADES) {
    const card = relicCards.get(def.id)!;
    const level = RelicShopEngine.getLevel(state, def.id);
    const cost = RelicShopEngine.getCost(state, def.id);
    card.levelEl.textContent = String(level);
    card.effectEl.textContent = RelicShopEngine.effectText(def, level);
    if (cost === null) {
      card.buyBtn.textContent = 'MAX';
      card.buyBtn.disabled = true;
    } else {
      card.buyBtn.textContent = `${cost} 🔮`;
      card.buyBtn.disabled = state.relics < cost;
    }
  }

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

let pendingOfflineGold = 0;
let pendingDaily: { streak: number; gemReward: number; goldReward: number } | null = null;

gameEvents.on('ui:offline_earnings', (s) => {
  pendingOfflineGold = s.goldEarned;
  offlineAmountEl.textContent = `+${fmt(s.goldEarned)} or`;
  const bits: string[] = [];
  const hrs = Math.floor(s.seconds / 3600);
  const mins = Math.floor((s.seconds % 3600) / 60);
  bits.push(`absent ${hrs > 0 ? hrs + ' h ' : ''}${mins} min`);
  if (s.energyEarned > 0) bits.push(`+${s.energyEarned} ⚡`);
  if (s.raidGold > 0) bits.push(`raid −${fmt(s.raidGold)} or`);
  if (s.shieldBlocked) bits.push('🛡️ raid bloqué');
  offlineDetailEl.textContent = bits.join(' · ');
  offlineX2Btn.hidden = s.goldEarned <= 0;
  offlineModal.classList.add('visible');
});

/** Shows the daily modal once no other modal is in the way. */
function maybeShowDaily(): void {
  if (!pendingDaily) return;
  if (offlineModal.classList.contains('visible')) return;
  dailyStreakEl.textContent = `Jour ${pendingDaily.streak} · série de ${pendingDaily.streak}`;
  dailyRewardEl.textContent = `+${pendingDaily.gemReward} 💎 · +${fmt(pendingDaily.goldReward)} or`;
  dailyModal.classList.add('visible');
}
gameEvents.on('ui:daily', (d) => { pendingDaily = d; maybeShowDaily(); });

// --- Boot --------------------------------------------------------------------

const controller = new GameController();
controller.start();
requestAnimationFrame(() => { particles.resize(); iso.resize(); });

// --- Wire view -> model ------------------------------------------------------

spinBtn.addEventListener('click', () => { sfx.unlock(); sfx.click(); controller.spin(); });
bossBtn.addEventListener('click', () => { sfx.click(); controller.startBossFight(); });
fleeBtn.addEventListener('click', () => controller.fleeBossFight());
upgradeBtn.addEventListener('click', () => { sfx.unlock(); if (controller.upgradeDungeon()) { sfx.upgrade(); buzz(12); } });
buyEnergyBtn.addEventListener('click', () => { sfx.unlock(); controller.buyEnergyWithGems(); });
ascendBtn.addEventListener('click', () => {
  sfx.unlock();
  if (controller.ascend()) { sfx.jackpot(); buzz(30); particles.confetti(120); }
});

// Spin payoff sounds.
gameEvents.on('spin:result', (r) => {
  window.setTimeout(() => {
    if (r.outcome === 'JACKPOT') { sfx.jackpot(); buzz(25); }
    else if (r.goldStolen > 0) sfx.error();
    else sfx.coin();
  }, 1450);
});

// Daily-reward modal.
dailyClaimBtn.addEventListener('click', () => {
  sfx.unlock();
  const r = controller.claimDaily();
  if (r) { sfx.jackpot(); buzz(20); particles.confetti(90); }
  pendingDaily = null;
  dailyModal.classList.remove('visible');
});

// Offline-earnings modal actions.
offlineOkBtn.addEventListener('click', () => {
  sfx.coin();
  offlineModal.classList.remove('visible');
  maybeShowDaily();
});
offlineX2Btn.addEventListener('click', async () => {
  offlineX2Btn.disabled = true;
  const ok = await controller.watchAdForEnergy();
  if (ok && pendingOfflineGold > 0) {
    controller.grantBonusGold(pendingOfflineGold);
    sfx.jackpot();
  }
  offlineX2Btn.disabled = false;
  offlineModal.classList.remove('visible');
  maybeShowDaily();
});

// Settings modal.
function refreshSoundBtn(): void {
  soundBtn.textContent = sfx.isMuted() ? '🔇 Son : coupé' : '🔊 Son : activé';
}
refreshSoundBtn();
settingsBtn.addEventListener('click', () => { sfx.unlock(); settingsModal.classList.add('visible'); });
settingsCloseBtn.addEventListener('click', () => settingsModal.classList.remove('visible'));
soundBtn.addEventListener('click', () => { sfx.setMuted(!sfx.isMuted()); refreshSoundBtn(); if (!sfx.isMuted()) sfx.coin(); });
resetBtn.addEventListener('click', () => {
  if (window.confirm('Réinitialiser toute la progression ? Cette action est irréversible.')) {
    controller.resetProgress();
    window.location.reload();
  }
});
exportBtn.addEventListener('click', () => {
  const code = controller.exportSave();
  void navigator.clipboard?.writeText(code).catch(() => { /* clipboard optional */ });
  window.prompt('Votre code de sauvegarde (copié) — gardez-le précieusement :', code);
});
importBtn.addEventListener('click', () => {
  const code = window.prompt('Collez votre code de sauvegarde :');
  if (code && controller.importSave(code)) {
    window.alert('Sauvegarde importée ! Rechargement…');
    window.location.reload();
  }
});

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

// Unlock audio on the very first interaction (mobile autoplay policy).
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

boostBtn.addEventListener('click', async () => {
  sfx.unlock();
  boostBtn.disabled = true;
  appendLog('Lecture de la pub…', 'info');
  const ok = await controller.watchAdForBoost();
  if (ok) { sfx.jackpot(); buzz(20); }
  boostBtn.disabled = false;
});

// Live boost countdown + badge (independent of state-change cadence).
let boostWasActive = false;
window.setInterval(() => {
  const ms = controller.getBoostRemainingMs();
  const active = ms > 0;
  if (active) {
    const s = Math.ceil(ms / 1000);
    boostBadge.textContent = `🚀 ×2 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    boostBadge.hidden = false;
    boostBtn.textContent = `🚀 Boost actif · ${s}s`;
  } else {
    boostBadge.hidden = true;
    boostBtn.textContent = '🚀 Boost de production ×2 (pub · 60s)';
  }
  if (active !== boostWasActive) {
    iso.setBoost?.(active);
    boostWasActive = active;
    render(controller.getState()); // refresh the boosted rate display
  }
}, 1000);

window.addEventListener('pagehide', () => controller.stop());
