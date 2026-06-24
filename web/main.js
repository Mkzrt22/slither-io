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
import { BUILDING_TYPES, MAX_SHIELDS, } from '../src/types.js';
import { NumberTween, ParticleSystem, SlotReels } from './effects.js';
import { IsoScene } from './iso.js';
import { Iso3DScene, webglAvailable } from './iso3d.js';
import { Sfx } from './sfx.js';
import { CloudSync } from './sync.js';
/** Light haptic tap where supported (no-op elsewhere). */
function buzz(ms) {
    try {
        navigator.vibrate?.(ms);
    }
    catch { /* unsupported */ }
}
/** Pure boost factor from a profile snapshot (avoids touching the controller). */
function boostFactorOf(state) {
    return Date.now() < state.boostEndsAt ? 2 : 1;
}
function el(id) {
    const node = document.getElementById(id);
    if (node === null) {
        throw new Error(`Missing required element #${id}`);
    }
    return node;
}
const fmt = EconomyEngine.formatCurrency;
const fmtInt = (n) => Math.round(n).toString();
const SYMBOL_EMOJI = {
    COIN: '🍒',
    BAG: '🍔',
    GEM: '💎',
    SHIELD: '🧊',
    SWORD: '🔥',
    SKULL: '💣',
};
/** Big-order dish by service band, so deeper services feel different. */
function bossEmoji(floor) {
    const faces = ['🍱', '🍣', '🍝', '🍛', '🥘', '🍲', '🎂', '🦞'];
    return faces[(floor - 1) % faces.length];
}
// --- Element handles ---------------------------------------------------------
const sceneEl = el('scene');
const fxCanvas = el('fx');
const reelHost = el('reel');
const reelLabelEl = el('reel-label');
const hoardEl = el('hoard');
const logEl = el('log');
const popupEl = el('energy-popup');
const floorEl = el('stat-level');
const floorBannerEl = document.querySelector('.floor-banner');
const rateEl = el('stat-rate');
const shieldsEl = el('stat-shields');
const buildingsStatEl = el('stat-buildings');
const bossPanelEl = el('boss-panel');
const bossTitleEl = el('boss-title');
const bossSpriteEl = el('boss-sprite');
const bossHpFillEl = el('boss-hp-fill');
const bossHpTextEl = el('boss-hp-text');
const spinBtn = el('btn-spin');
const bossBtn = el('btn-boss');
const fleeBtn = el('btn-flee');
const upgradeBtn = el('btn-upgrade');
const buyEnergyBtn = el('btn-buy-energy');
const watchAdBtn = el('btn-watch-ad');
const popupBuyBtn = el('btn-popup-buy');
const popupAdBtn = el('btn-popup-ad');
const popupCloseBtn = el('btn-popup-close');
const offlineModal = el('offline-modal');
const offlineAmountEl = el('offline-amount');
const offlineDetailEl = el('offline-detail');
const offlineX2Btn = el('btn-offline-x2');
const offlineOkBtn = el('btn-offline-ok');
const settingsModal = el('settings-modal');
const settingsBtn = el('btn-settings');
const settingsCloseBtn = el('btn-settings-close');
const soundBtn = el('btn-sound');
const resetBtn = el('btn-reset');
const exportBtn = el('btn-export');
const importBtn = el('btn-import');
const dailyModal = el('daily-modal');
const dailyStreakEl = el('daily-streak');
const dailyRewardEl = el('daily-reward');
const dailyClaimBtn = el('btn-daily-claim');
const buildingsListEl = el('buildings-list');
const villageNameEl = el('village-name');
const villageMultEl = el('village-mult');
const villageEmojiEl = el('village-emoji');
const isoHostEl = el('iso-host');
const advanceCountEl = el('advance-count');
const advanceFillEl = el('advance-fill');
const advanceBtn = el('btn-advance');
const boostBtn = el('btn-boost');
const boostBadge = el('boost-badge');
const buildSheet = el('buildings-sheet');
const openBuildBtn = el('btn-open-build');
const closeBuildBtn = el('btn-build-close');
const sheetBackdrop = el('sheet-backdrop');
const questsListEl = el('quests-list');
const questsBadgeEl = el('quests-badge');
const prestigeNoteEl = el('prestige-note');
const prestigeMultEl = el('prestige-mult');
const prestigeProgressEl = el('prestige-progress');
const ascendBtn = el('btn-ascend');
const statsSummaryEl = el('stats-summary');
const relicBalanceEl = el('relic-balance');
const relicShopListEl = el('relic-shop-list');
// --- Effects -----------------------------------------------------------------
const sfx = new Sfx();
let buyMode = 1;
const particles = new ParticleSystem(fxCanvas);
const cellPx = 76;
const tokenHtml = (s) => `<div class="token t-${s}"><span>${SYMBOL_EMOJI[s]}</span></div>`;
const reels = new SlotReels(reelHost, tokenHtml, cellPx);
const goldTween = new NumberTween(el('stat-gold'), fmt, 0);
const gemsTween = new NumberTween(el('stat-gems'), fmtInt, 0);
const relicTween = new NumberTween(el('stat-relics'), fmtInt, 0);
const energyEl = el('stat-energy');
let firstRender = true;
let lastBossHp = null;
const MAX_LOG_ENTRIES = 9;
function appendLog(message, severity) {
    const item = document.createElement('li');
    item.textContent = message;
    item.className = `log-${severity}`;
    logEl.prepend(item);
    while (logEl.children.length > MAX_LOG_ENTRIES) {
        logEl.removeChild(logEl.lastChild);
    }
}
/** Centre of the slot window in canvas (scene) coordinates. */
function reelCentre() {
    const scene = sceneEl.getBoundingClientRect();
    const win = reelHost.getBoundingClientRect();
    return { x: win.left - scene.left + win.width / 2, y: win.top - scene.top + win.height / 2 };
}
// --- Tab navigation ----------------------------------------------------------
const tabButtons = Array.from(document.querySelectorAll('nav button[data-tab]'));
for (const btn of tabButtons) {
    btn.addEventListener('click', () => {
        for (const other of tabButtons) {
            other.classList.toggle('active', other === btn);
        }
        for (const section of document.querySelectorAll('section.tab')) {
            section.classList.toggle('active', section.id === btn.dataset.tab);
        }
        if (btn.dataset.tab === 'tab-mine') {
            particles.resize();
        }
        if (btn.dataset.tab === 'tab-village') {
            // The map is flex-sized, so resize after layout settles.
            requestAnimationFrame(() => iso.resize());
        }
        else {
            closeBuildSheet();
        }
    });
}
const buildingCards = new Map();
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
    const buyBtn = card.querySelector('[data-buy]');
    buyBtn.addEventListener('click', () => buyBuilding(type));
    buildingsListEl.appendChild(card);
    buildingCards.set(type, {
        levelEl: card.querySelector('[data-level]'),
        rateEl: card.querySelector('[data-rate]'),
        synergyEl: card.querySelector('[data-synergy]'),
        barEl: card.querySelector('[data-bar]'),
        nextEl: card.querySelector('[data-next]'),
        buyLabelEl: card.querySelector('[data-buylabel]'),
        costEl: card.querySelector('[data-cost]'),
        buyBtn,
    });
}
/** Shared building-purchase action (cards + 3D tap), honouring the buy mode. */
function buyBuilding(type) {
    sfx.unlock();
    const bought = controller.buyBuilding(type, buyMode);
    if (bought > 0) {
        iso.coinPop(type);
        sfx.upgrade();
        buzz(12);
    }
    else {
        sfx.error();
    }
}
// Isometric village scene — real 3D when WebGL is available, else a 2D
// canvas fallback. Tapping a building upgrades it.
const onTapBuilding = (type) => buyBuilding(type);
// Upgrade bottom sheet (opened from the full-screen map).
function openBuildSheet() {
    buildSheet.classList.add('open');
    buildSheet.setAttribute('aria-hidden', 'false');
    sfx.click();
    buzz(8);
}
function closeBuildSheet() {
    buildSheet.classList.remove('open');
    buildSheet.setAttribute('aria-hidden', 'true');
}
openBuildBtn.addEventListener('click', openBuildSheet);
closeBuildBtn.addEventListener('click', closeBuildSheet);
sheetBackdrop.addEventListener('click', closeBuildSheet);
// Buy-mode toggle (×1 / ×10 / Max).
const buyModeButtons = Array.from(document.querySelectorAll('#buy-modes button'));
for (const btn of buyModeButtons) {
    btn.addEventListener('click', () => {
        const m = btn.dataset.mode;
        buyMode = m === 'max' ? 'max' : Number(m);
        for (const other of buyModeButtons)
            other.classList.toggle('active', other === btn);
        render(controller.getState());
    });
}
function makeIsoCanvas() {
    const canvas = document.createElement('canvas');
    canvas.className = 'iso-canvas';
    isoHostEl.appendChild(canvas);
    return canvas;
}
const iso = createVillageRenderer();
function createVillageRenderer() {
    if (webglAvailable()) {
        try {
            return new Iso3DScene(makeIsoCanvas(), onTapBuilding);
        }
        catch (err) {
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
const questCards = new Map();
const QUEST_ICONS = {
    first_vein: '💶', spin_100: '🎰', foreman: '👨‍🍳', first_boss: '🔥',
    floor_5: '🛎️', magnate: '💰', ascended: '⭐', builder: '🏗️', pioneer: '🚩',
    industrialist: '📈', overlord: '🏆',
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
    const claimBtn = card.querySelector('[data-claim]');
    claimBtn.addEventListener('click', () => controller.claimQuest(quest.id));
    questsListEl.appendChild(card);
    questCards.set(quest.id, {
        root: card,
        fillEl: card.querySelector('.q-fill'),
        claimBtn,
    });
}
const relicCards = new Map();
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
    const buyBtn = card.querySelector('[data-buy]');
    buyBtn.addEventListener('click', () => {
        if (controller.buyRelicUpgrade(def.id)) {
            sfx.click();
            buzz(8);
        }
    });
    relicShopListEl.appendChild(card);
    relicCards.set(def.id, {
        levelEl: card.querySelector('[data-level]'),
        effectEl: card.querySelector('[data-effect]'),
        buyBtn,
    });
}
// --- Rendering ---------------------------------------------------------------
function render(state) {
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
        bossTitleEl.textContent = `Grosse commande · Service ${state.floor}`;
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
    }
    else {
        lastBossHp = null;
        bossBtn.innerHTML = `🔥<span>Lancer la commande (service ${state.floor})</span>`;
    }
    // Restaurant header
    villageNameEl.textContent = `${VillageEngine.getVillageName(state.village)} · Niv. ${state.village}`;
    villageMultEl.textContent = `×${VillageEngine.getVillageMultiplier(state.village).toFixed(1)} production`;
    const villageEmojis = ['🚚', '🥪', '🍽️', '🍷', '⭐', '👨‍🍳'];
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
        const card = buildingCards.get(type);
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
        const card = questCards.get(quest.id);
        const claimed = state.claimedQuests.includes(quest.id);
        const complete = quest.isComplete(state);
        card.fillEl.style.width = `${Math.round(quest.progress(state) * 100)}%`;
        card.claimBtn.disabled = claimed || !complete;
        card.claimBtn.textContent = claimed ? '✓ Fait' : 'Réclamer';
        card.claimBtn.classList.toggle('ready', !claimed && complete);
        card.root.classList.toggle('done', claimed);
        if (!claimed && complete)
            claimable += 1;
    }
    questsBadgeEl.textContent = String(claimable);
    questsBadgeEl.style.display = claimable > 0 ? 'flex' : 'none';
    // Prestige
    const relics = EconomyEngine.getPrestigeRelics(state.stats.goldEarnedRun);
    const threshold = PRESTIGE_THRESHOLD;
    prestigeMultEl.textContent = `×${EconomyEngine.getRelicMultiplier(state.relics).toFixed(1)}`;
    prestigeProgressEl.style.width = `${Math.min(100, (state.stats.goldEarnedRun / threshold) * 100)}%`;
    ascendBtn.disabled = relics <= 0;
    ascendBtn.textContent = relics > 0 ? `Décrocher · +${relics} ⭐` : 'Décrocher une étoile';
    prestigeNoteEl.textContent = relics > 0
        ? `Prêt ! Une nouvelle étoile rapporterait ${relics} ⭐.`
        : `Encaissez ${fmt(threshold)} € dans ce cycle (actuel : ${fmt(state.stats.goldEarnedRun)}).`;
    statsSummaryEl.innerHTML =
        `💰 ${fmt(state.stats.goldEarnedAll)} € encaissés<br/>` +
            `🎰 ${state.stats.totalSpins} tours · 🔥 ${state.stats.bossesKilled} grosses commandes<br/>` +
            `⭐ ${state.stats.prestiges} étoile(s)`;
    // Relic shop
    relicBalanceEl.textContent = `${fmtInt(state.relics)} 🔮`;
    for (const def of RELIC_UPGRADES) {
        const card = relicCards.get(def.id);
        const level = RelicShopEngine.getLevel(state, def.id);
        const cost = RelicShopEngine.getCost(state, def.id);
        card.levelEl.textContent = String(level);
        card.effectEl.textContent = RelicShopEngine.effectText(def, level);
        if (cost === null) {
            card.buyBtn.textContent = 'MAX';
            card.buyBtn.disabled = true;
        }
        else {
            card.buyBtn.textContent = `${cost} 🔮`;
            card.buyBtn.disabled = state.relics < cost;
        }
    }
    firstRender = false;
}
function showSpinResult(result) {
    void reels.spinTo(result.symbols, () => { });
    // Build the result line.
    const parts = [`+${fmt(result.goldGained)} €`];
    if (result.gemsGained > 0)
        parts.push(`+${result.gemsGained} 💎`);
    if (result.shieldsGained > 0)
        parts.push(`+${result.shieldsGained} 🧊`);
    if (result.goldStolen > 0)
        parts.push(`−${fmt(result.goldStolen)} €`);
    if (result.bossDamage > 0)
        parts.push(`${fmt(result.bossDamage)} servis`);
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
        }
        else if (result.goldStolen > 0) {
            particles.floatText(cx, c.y - 20, `−${fmt(result.goldStolen)}`, '#f0636c');
        }
        else {
            particles.burstCoins(cx, c.y, result.outcome === 'PAIR' ? 16 : 8);
            particles.floatText(cx, c.y - 20, `+${fmt(result.goldGained)}`, '#ffe08a');
        }
        if (result.gemsGained > 0)
            particles.burstGems(cx, c.y, 12);
    }, settleMs);
    appendLog(`${result.label} · ${parts.join(' · ')}`, result.outcome === 'JACKPOT' ? 'success' : 'info');
}
// --- Wire model -> view ------------------------------------------------------
gameEvents.on('state:updated', render);
gameEvents.on('spin:result', showSpinResult);
gameEvents.on('ui:notification', (n) => appendLog(n.message, n.severity));
gameEvents.on('ui:popup_energy', () => popupEl.classList.add('visible'));
let pendingOfflineGold = 0;
let pendingDaily = null;
gameEvents.on('ui:offline_earnings', (s) => {
    pendingOfflineGold = s.goldEarned;
    offlineAmountEl.textContent = `+${fmt(s.goldEarned)} €`;
    const bits = [];
    const hrs = Math.floor(s.seconds / 3600);
    const mins = Math.floor((s.seconds % 3600) / 60);
    bits.push(`absent ${hrs > 0 ? hrs + ' h ' : ''}${mins} min`);
    if (s.energyEarned > 0)
        bits.push(`+${s.energyEarned} ⚡`);
    if (s.raidGold > 0)
        bits.push(`vol −${fmt(s.raidGold)} €`);
    if (s.shieldBlocked)
        bits.push('🧊 vol bloqué');
    offlineDetailEl.textContent = bits.join(' · ');
    offlineX2Btn.hidden = s.goldEarned <= 0;
    offlineModal.classList.add('visible');
});
/** Shows the daily modal once no other modal is in the way. */
function maybeShowDaily() {
    if (!pendingDaily)
        return;
    if (offlineModal.classList.contains('visible'))
        return;
    dailyStreakEl.textContent = `Jour ${pendingDaily.streak} · série de ${pendingDaily.streak}`;
    dailyRewardEl.textContent = `+${pendingDaily.gemReward} 💎 · +${fmt(pendingDaily.goldReward)} €`;
    dailyModal.classList.add('visible');
}
gameEvents.on('ui:daily', (d) => { pendingDaily = d; maybeShowDaily(); });
// --- Boot --------------------------------------------------------------------
const controller = new GameController();
controller.start();
requestAnimationFrame(() => { particles.resize(); iso.resize(); });
// Idle juice: float a "+income" number off a producing building every beat
// while the village map is on screen (weighted by each building's output).
const FLOAT_INTERVAL_MS = 1100;
setInterval(() => {
    if (!iso.floatIncome)
        return;
    if (!document.getElementById('tab-village')?.classList.contains('active'))
        return;
    const state = controller.getState();
    const mult = EconomyEngine.getGlobalMultiplier(state) * boostFactorOf(state);
    const built = BUILDING_TYPES.filter((t) => state.buildings[t] > 0);
    const weights = built.map((t) => VillageEngine.getBuildingProduction(t, state.buildings[t]) * mult);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0)
        return;
    let r = Math.random() * total;
    let pick = built[0];
    for (let i = 0; i < built.length; i++) {
        r -= weights[i];
        if (r <= 0) {
            pick = built[i];
            break;
        }
    }
    const amount = Math.max(1, Math.round(VillageEngine.getBuildingProduction(pick, state.buildings[pick]) * mult * (FLOAT_INTERVAL_MS / 1000)));
    iso.floatIncome(pick, `+${fmt(amount)}`);
}, FLOAT_INTERVAL_MS);
// --- Wire view -> model ------------------------------------------------------
spinBtn.addEventListener('click', () => { sfx.unlock(); sfx.click(); controller.spin(); });
bossBtn.addEventListener('click', () => { sfx.click(); controller.startBossFight(); });
fleeBtn.addEventListener('click', () => controller.fleeBossFight());
upgradeBtn.addEventListener('click', () => { sfx.unlock(); if (controller.upgradeDungeon()) {
    sfx.upgrade();
    buzz(12);
} });
buyEnergyBtn.addEventListener('click', () => { sfx.unlock(); controller.buyEnergyWithGems(); });
ascendBtn.addEventListener('click', () => {
    sfx.unlock();
    if (controller.ascend()) {
        sfx.jackpot();
        buzz(30);
        particles.confetti(120);
    }
});
// Spin payoff sounds.
gameEvents.on('spin:result', (r) => {
    window.setTimeout(() => {
        if (r.outcome === 'JACKPOT') {
            sfx.jackpot();
            buzz(25);
        }
        else if (r.goldStolen > 0)
            sfx.error();
        else
            sfx.coin();
    }, 1450);
});
// Daily-reward modal.
dailyClaimBtn.addEventListener('click', () => {
    sfx.unlock();
    const r = controller.claimDaily();
    if (r) {
        sfx.jackpot();
        buzz(20);
        particles.confetti(90);
    }
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
function refreshSoundBtn() {
    soundBtn.textContent = sfx.isMuted() ? '🔇 Son : coupé' : '🔊 Son : activé';
}
refreshSoundBtn();
settingsBtn.addEventListener('click', () => { sfx.unlock(); settingsModal.classList.add('visible'); });
settingsCloseBtn.addEventListener('click', () => settingsModal.classList.remove('visible'));
soundBtn.addEventListener('click', () => { sfx.setMuted(!sfx.isMuted()); refreshSoundBtn(); if (!sfx.isMuted())
    sfx.coin(); });
resetBtn.addEventListener('click', () => {
    if (window.confirm('Réinitialiser toute la progression ? Cette action est irréversible.')) {
        controller.resetProgress();
        window.location.reload();
    }
});
exportBtn.addEventListener('click', () => {
    const code = controller.exportSave();
    void navigator.clipboard?.writeText(code).catch(() => { });
    window.prompt('Votre code de sauvegarde (copié) — gardez-le précieusement :', code);
});
importBtn.addEventListener('click', () => {
    const code = window.prompt('Collez votre code de sauvegarde :');
    if (code && controller.importSave(code)) {
        window.alert('Sauvegarde importée ! Rechargement…');
        window.location.reload();
    }
});
const runAd = async (button) => {
    button.disabled = true;
    appendLog('Lecture de la pub…', 'info');
    try {
        await controller.watchAdForEnergy();
    }
    finally {
        button.disabled = false;
    }
};
watchAdBtn.addEventListener('click', () => void runAd(watchAdBtn));
popupBuyBtn.addEventListener('click', () => {
    if (controller.buyEnergyWithGems())
        popupEl.classList.remove('visible');
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
    if (ok) {
        sfx.jackpot();
        buzz(20);
    }
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
    }
    else {
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
// --- Cloud save sync ---------------------------------------------------------
// Offline-first: the game already booted from localStorage above. This layer
// only backs that save up and reconciles it with the cloud in the background.
// Every step fails soft, so a missing/unreachable server changes nothing.
const cloud = new CloudSync();
let lastPushedScore = -1;
/** Progress metric shared with the server's conflict rule (lifetime gold). */
function localScore() {
    return Math.floor(controller.getState().stats.goldEarnedAll || 0);
}
/** Adopts a newer cloud save, then reloads so the engine re-reads it. */
function adoptCloudSave(code) {
    if (controller.importSave(code)) {
        appendLog('Progression cloud restaurée ☁️', 'success');
        window.setTimeout(() => location.reload(), 500);
    }
}
async function pushCloud(keepalive = false) {
    if (!cloud.enabled())
        return;
    const score = localScore();
    if (score === lastPushedScore && !keepalive)
        return; // nothing new to send
    const result = await cloud.push(controller.exportSave(), keepalive);
    if (result.status === 'ok') {
        lastPushedScore = score;
    }
    else if (result.status === 'stale' && result.snapshot.code && result.snapshot.score > score) {
        adoptCloudSave(result.snapshot.code);
    }
}
async function initCloudSync() {
    if (!cloud.enabled())
        return;
    if (!(await cloud.ensureAccount()))
        return;
    const snapshot = await cloud.pull();
    if (snapshot && snapshot.code && snapshot.score > localScore()) {
        adoptCloudSave(snapshot.code); // cloud has more progress — take it
        return; // a reload follows; skip starting the push loop here
    }
    await pushCloud(); // our local save is newest — back it up
    window.setInterval(() => { void pushCloud(); }, 30000);
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
        void pushCloud(true);
});
window.addEventListener('pagehide', () => { void pushCloud(true); });
void initCloudSync();
