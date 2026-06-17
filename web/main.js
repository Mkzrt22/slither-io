/**
 * main.ts — DOM View Layer (Lucky Dungeon Tycoon — premium UI).
 *
 * Pure presentation: binds buttons to GameController use cases and renders
 * EventBus broadcasts into a juiced-up dungeon scene (animated reels,
 * particle bursts, eased counters, a reactive boss). No game rules live
 * here — the model is complete and testable without this file.
 */
import { EconomyEngine, MINER_CONFIGS, PRESTIGE_THRESHOLD } from '../src/EconomyEngine.js';
import { GameController } from '../src/GameController.js';
import { QUESTS } from '../src/QuestEngine.js';
import { gameEvents } from '../src/EventBus.js';
import { MAX_SHIELDS, MINER_TIERS, } from '../src/types.js';
import { NumberTween, ParticleSystem, SlotReels } from './effects.js';
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
    COIN: '🪙',
    BAG: '💰',
    GEM: '💎',
    SHIELD: '🛡️',
    SWORD: '⚔️',
    SKULL: '💀',
};
const MINER_EMOJI = {
    goblin: '👺',
    skeleton: '💀',
    golem: '🗿',
    dragon: '🐲',
};
/** Boss face by floor band, so deeper floors feel different. */
function bossEmoji(floor) {
    const faces = ['👹', '👺', '🧟', '🐲', '👿', '💀', '🦇', '🐉'];
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
const minersStatEl = el('stat-miners');
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
const minersListEl = el('miners-list');
const questsListEl = el('quests-list');
const questsBadgeEl = el('quests-badge');
const prestigeNoteEl = el('prestige-note');
const prestigeMultEl = el('prestige-mult');
const prestigeProgressEl = el('prestige-progress');
const ascendBtn = el('btn-ascend');
const statsSummaryEl = el('stats-summary');
// --- Effects -----------------------------------------------------------------
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
    });
}
const minerCards = new Map();
for (const tier of MINER_TIERS) {
    const cfg = MINER_CONFIGS[tier];
    const card = document.createElement('div');
    card.className = 'card miner-card';
    card.innerHTML = `
    <div class="m-avatar">${MINER_EMOJI[tier]}</div>
    <div class="m-info">
      <div class="m-name">${cfg.name} <b>×<span data-count>0</span></b></div>
      <div class="m-stat"><span class="up" data-rate>0</span> or/s chacun</div>
    </div>
    <button data-buy>Recruter</button>`;
    const buyBtn = card.querySelector('[data-buy]');
    buyBtn.addEventListener('click', () => controller.hireMiner(tier));
    minersListEl.appendChild(card);
    minerCards.set(tier, {
        countEl: card.querySelector('[data-count]'),
        rateEl: card.querySelector('[data-rate]'),
        buyBtn,
    });
}
const questCards = new Map();
const QUEST_ICONS = {
    first_vein: '🪙', spin_100: '🎰', foreman: '👷', first_boss: '⚔️',
    floor_5: '🧗', magnate: '👑', ascended: '🔮',
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
// --- Rendering ---------------------------------------------------------------
function render(state) {
    const animate = !firstRender;
    goldTween.set(state.gold, animate); // only the gold counter eases — it's the hero number
    gemsTween.set(state.gems, false);
    relicTween.set(state.relics, false);
    energyEl.textContent = `${state.energy}/${state.maxEnergy}`;
    floorEl.textContent = String(state.floor);
    rateEl.textContent = fmt(Math.round(EconomyEngine.getPassiveRate(state)));
    shieldsEl.textContent = `${state.shields}/${MAX_SHIELDS}`;
    const totalMiners = MINER_TIERS.reduce((sum, t) => sum + state.miners[t], 0);
    minersStatEl.textContent = String(totalMiners);
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
    }
    else {
        lastBossHp = null;
        bossBtn.innerHTML = `⚔️<span>Défier (étage ${state.floor})</span>`;
    }
    // Miners
    for (const tier of MINER_TIERS) {
        const card = minerCards.get(tier);
        const cost = EconomyEngine.getMinerCost(tier, state.miners[tier]);
        card.countEl.textContent = String(state.miners[tier]);
        card.rateEl.textContent = fmt(Math.round(MINER_CONFIGS[tier].baseRate * EconomyEngine.getGlobalMultiplier(state)));
        card.buyBtn.innerHTML = `Recruter<br/>${fmt(cost)}`;
        card.buyBtn.disabled = state.gold < cost;
    }
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
function showSpinResult(result) {
    void reels.spinTo(result.symbols, () => { });
    // Build the result line.
    const parts = [`+${fmt(result.goldGained)} or`];
    if (result.gemsGained > 0)
        parts.push(`+${result.gemsGained} 💎`);
    if (result.shieldsGained > 0)
        parts.push(`+${result.shieldsGained} 🛡️`);
    if (result.goldStolen > 0)
        parts.push(`−${fmt(result.goldStolen)} or`);
    if (result.bossDamage > 0)
        parts.push(`${fmt(result.bossDamage)} dégâts`);
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
// --- Boot --------------------------------------------------------------------
const controller = new GameController();
controller.start();
requestAnimationFrame(() => particles.resize());
// --- Wire view -> model ------------------------------------------------------
spinBtn.addEventListener('click', () => controller.spin());
bossBtn.addEventListener('click', () => controller.startBossFight());
fleeBtn.addEventListener('click', () => controller.fleeBossFight());
upgradeBtn.addEventListener('click', () => controller.upgradeDungeon());
buyEnergyBtn.addEventListener('click', () => controller.buyEnergyWithGems());
ascendBtn.addEventListener('click', () => controller.ascend());
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
window.addEventListener('pagehide', () => controller.stop());
