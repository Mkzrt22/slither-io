/**
 * app.ts — DOM view layer for Chef Factory Tycoon.
 *
 * Pure presentation: drives the simulation each frame, mirrors state into the
 * HUD, the 3D factory scene, the station sheet, the management list, research,
 * and prestige. No game rules here — the engine owns them and is testable
 * without the DOM.
 */
import { EconomyEngine } from '../../src/EconomyEngine.js';
import { FactoryGame } from '../../src/factory/FactoryGame.js';
import { FactoryEngine } from '../../src/factory/FactoryEngine.js';
import { STATION_IDS } from '../../src/factory/types.js';
import { MANAGER_BY_ID, MANAGER_DEFS, RECIPE_DEFS, RESEARCH_DEFS, STATION_DEF_BY_ID, STATION_DEFS, WORKERS_PER_STATION_CAP, } from '../../src/factory/config.js';
import { FactoryScene, webglAvailable } from './scene.js';
import { NumberTween } from '../effects.js';
import { CloudSync } from '../sync.js';
const fmt = EconomyEngine.formatCurrency;
const fmtInt = (n) => Math.round(n).toString();
const fmtRate = (perSec) => `${fmt(perSec * 60)}/min`;
function el(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`Missing #${id}`);
    return node;
}
function buzz(ms) { try {
    navigator.vibrate?.(ms);
}
catch { /* unsupported */ } }
/** localStorage adapter that degrades to memory if storage is unavailable. */
function makeStore() {
    try {
        const k = '__probe__';
        window.localStorage.setItem(k, '1');
        window.localStorage.removeItem(k);
        return window.localStorage;
    }
    catch {
        const m = new Map();
        return {
            getItem: (key) => (m.has(key) ? m.get(key) : null),
            setItem: (key, v) => { m.set(key, v); },
            removeItem: (key) => { m.delete(key); },
        };
    }
}
// --- Boot --------------------------------------------------------------------
const game = new FactoryGame(makeStore());
// HUD tweens.
const cashTween = new NumberTween(el('stat-cash'), (n) => fmt(n), 0);
const gemsTween = new NumberTween(el('stat-gems'), fmtInt, 0);
const starsTween = new NumberTween(el('stat-stars'), fmtInt, 0);
// Scene.
const host = el('factory-host');
let scene = null;
if (webglAvailable()) {
    try {
        const canvas = document.createElement('canvas');
        canvas.className = 'factory-canvas';
        host.appendChild(canvas);
        scene = new FactoryScene(canvas, openStationSheet);
        scene.start();
    }
    catch (err) {
        console.warn('[factory] WebGL scene failed', err);
        host.innerHTML = '<div class="scene-fallback">🏭 La vue 3D nécessite WebGL.</div>';
    }
}
else {
    host.innerHTML = '<div class="scene-fallback">🏭 La vue 3D nécessite WebGL.</div>';
}
// --- Buy modes ---------------------------------------------------------------
let sheetMode = 1;
let manageMode = 1;
bindBuyModes('buy-modes', (m) => { sheetMode = m; });
bindBuyModes('manage-modes', (m) => { manageMode = m; });
function bindBuyModes(id, set) {
    const btns = Array.from(document.querySelectorAll(`#${id} button`));
    for (const b of btns) {
        b.addEventListener('click', () => {
            set(b.dataset.mode === 'max' ? 'max' : Number(b.dataset.mode));
            for (const o of btns)
                o.classList.toggle('active', o === b);
        });
    }
}
const stationRows = new Map();
const stationListEl = el('station-list');
for (const def of STATION_DEFS) {
    const card = document.createElement('div');
    card.className = 'card station-card';
    card.innerHTML = `
    <div class="sc-avatar"><span class="sc-emoji">${def.icon}</span><span class="sc-lvl">Niv.<span data-level>1</span></span></div>
    <div class="sc-info">
      <div class="sc-name">${def.name}</div>
      <div class="sc-stats">⚙️ <span data-rate>0</span> · 📦 <span data-buffer>0%</span> · 👷 <span data-workers>0</span></div>
      <div class="sc-bar"><div class="sc-bar-fill" data-bufferbar></div></div>
    </div>
    <button data-buy class="sc-buy"><span data-buylabel>Améliorer</span><span class="cost"><span>💶</span><span data-cost>0</span></span></button>`;
    card.querySelector('[data-buy]').addEventListener('click', () => {
        if (game.upgradeStation(def.id, manageMode) > 0) {
            buzz(10);
        }
    });
    card.querySelector('.sc-avatar').addEventListener('click', () => openStationSheet(def.id));
    stationListEl.appendChild(card);
    stationRows.set(def.id, {
        root: card,
        level: card.querySelector('[data-level]'),
        rate: card.querySelector('[data-rate]'),
        buffer: card.querySelector('[data-buffer]'),
        workers: card.querySelector('[data-workers]'),
        buyLbl: card.querySelector('[data-buylabel]'),
        cost: card.querySelector('[data-cost]'),
        buyBtn: card.querySelector('[data-buy]'),
    });
    // Stash the buffer bar ref on the element for cheap per-frame updates.
    stationRows.get(def.id).bar =
        card.querySelector('[data-bufferbar]');
}
// Menu (dish price) controls.
const menuBtn = el('btn-menu');
menuBtn.addEventListener('click', () => { if (game.buyMenu())
    buzz(10); });
const recipeCards = new Map();
const recipeStripEl = el('recipe-strip');
for (const def of RECIPE_DEFS) {
    const card = document.createElement('div');
    card.className = 'card recipe-pick';
    card.innerHTML = `
    <div class="rp-ic">${def.icon}</div>
    <div class="rp-info">
      <div class="rp-name">${def.name}</div>
      <div class="rp-val">💶 ${fmt(def.marketValue)} / plat</div>
    </div>
    <button data-pick class="rp-btn">—</button>`;
    const btn = card.querySelector('[data-pick]');
    btn.addEventListener('click', () => {
        const s = game.getState();
        if (!s.unlockedRecipes.includes(def.id)) {
            if (game.unlockRecipe(def.id))
                buzz(15);
        }
        else if (s.activeRecipeId !== def.id) {
            if (game.switchRecipe(def.id))
                buzz(10);
        }
    });
    recipeStripEl.appendChild(card);
    recipeCards.set(def.id, { root: card, btn });
}
function renderRecipes(s) {
    for (const def of RECIPE_DEFS) {
        const c = recipeCards.get(def.id);
        const unlocked = s.unlockedRecipes.includes(def.id);
        const active = s.activeRecipeId === def.id;
        c.root.classList.toggle('active', active);
        c.root.classList.toggle('locked', !unlocked);
        if (active) {
            c.btn.textContent = '✓ En production';
            c.btn.disabled = true;
            c.btn.className = 'rp-btn active';
        }
        else if (unlocked) {
            c.btn.textContent = 'Produire';
            c.btn.disabled = false;
            c.btn.className = 'rp-btn';
        }
        else {
            c.btn.innerHTML = `🔒 ${fmt(def.unlockCost)}`;
            c.btn.disabled = s.cash < def.unlockCost;
            c.btn.className = s.cash >= def.unlockCost ? 'rp-btn affordable' : 'rp-btn';
        }
    }
}
const researchRows = new Map();
const researchListEl = el('research-list');
for (const def of RESEARCH_DEFS) {
    const cur = def.currency === 'stars' ? '⭐' : '💶';
    const card = document.createElement('div');
    card.className = 'card research-card';
    card.innerHTML = `
    <div class="rc-ic">${def.icon}</div>
    <div class="rc-info">
      <div class="rc-name">${def.name} <b>Niv. <span data-level>0</span>/${def.maxLevel}</b></div>
      <div class="rc-effect" data-effect>${def.description}</div>
    </div>
    <button data-buy class="rc-buy">${cur} <span data-cost>—</span></button>`;
    card.querySelector('[data-buy]').addEventListener('click', () => {
        if (game.buyResearch(def.id))
            buzz(8);
    });
    researchListEl.appendChild(card);
    researchRows.set(def.id, {
        level: card.querySelector('[data-level]'),
        effect: card.querySelector('[data-effect]'),
        buyBtn: card.querySelector('[data-buy]'),
    });
}
// --- Station detail sheet ----------------------------------------------------
let openStation = null;
const stationSheet = el('station-sheet');
function openStationSheet(id) {
    openStation = id;
    stationSheet.classList.add('open');
    stationSheet.setAttribute('aria-hidden', 'false');
    renderStationSheet(game.getState());
    buzz(8);
}
function closeStationSheet() {
    openStation = null;
    stationSheet.classList.remove('open');
    stationSheet.setAttribute('aria-hidden', 'true');
}
el('btn-station-close').addEventListener('click', closeStationSheet);
el('station-backdrop').addEventListener('click', closeStationSheet);
el('btn-upgrade-station').addEventListener('click', () => {
    if (openStation && game.upgradeStation(openStation, sheetMode) > 0)
        buzz(12);
});
el('btn-worker-plus').addEventListener('click', () => { if (openStation)
    game.assignWorker(openStation); });
el('btn-worker-minus').addEventListener('click', () => { if (openStation)
    game.unassignWorker(openStation); });
el('btn-hire-from-station').addEventListener('click', () => { if (game.hireWorker())
    buzz(10); });
el('btn-chef-skill').addEventListener('click', () => { if (openStation && game.triggerSkill(openStation))
    buzz(15); });
const chefCards = new Map();
const chefsListEl = el('chefs-list');
const RARITY_LABEL = { COMMON: 'Commun', RARE: 'Rare', EPIC: 'Épique', LEGENDARY: 'Légendaire' };
function modText(m) {
    const where = m.targetId === 'global' ? 'toute la ligne' : STATION_DEF_BY_ID[m.targetId]?.name ?? m.targetId;
    const pct = Math.round(Math.abs(1 - m.value) * 100);
    switch (m.type) {
        case 'MULTIPLY_SPEED': return `+${Math.round((m.value - 1) * 100)}% cadence · ${where}`;
        case 'MULTIPLY_VALUE': return `+${Math.round((m.value - 1) * 100)}% valeur · ${where}`;
        case 'EXPAND_BUFFER': return `+${Math.round((m.value - 1) * 100)}% tampon · ${where}`;
        case 'REDUCE_UPGRADE_COST': return `−${pct}% coût d’amélioration · ${where}`;
        default: return '';
    }
}
for (const def of MANAGER_DEFS) {
    const card = document.createElement('div');
    card.className = `card chef-card rarity-${def.rarity.toLowerCase()}`;
    card.innerHTML = `
    <div class="chef-ic">${def.icon}</div>
    <div class="chef-info">
      <div class="chef-name">${def.name} <span class="chef-rar">${RARITY_LABEL[def.rarity]}</span></div>
      <div class="chef-eff">${modText(def.passive)}</div>
      ${def.active ? `<div class="chef-skill-d">⚡ ${modText(def.active)} (${def.activeDurationMs / 1000}s)</div>` : ''}
    </div>
    <div class="chef-acts"><button data-alt class="chef-alt" hidden>—</button><button data-act class="chef-act">—</button></div>`;
    const btn = card.querySelector('[data-act]');
    const alt = card.querySelector('[data-alt]');
    btn.addEventListener('click', () => {
        const s = game.getState();
        if (!s.managers[def.id]) {
            if (game.hireManager(def.id))
                buzz(15);
        }
        else if (openStation && s.stations[openStation].managerId === def.id) {
            game.unassignManager(openStation);
        }
        else if (openStation) {
            game.assignManager(def.id, openStation);
            buzz(8);
        }
        renderChefs();
    });
    alt.addEventListener('click', () => { if (openStation) {
        game.assignManager(def.id, openStation);
        buzz(8);
        renderChefs();
    } });
    chefsListEl.appendChild(card);
    chefCards.set(def.id, { root: card, btn, alt });
}
function openChefs() { if (!openStation)
    return; renderChefs(); el('chefs-modal').classList.add('visible'); }
el('btn-chef-manage').addEventListener('click', openChefs);
el('btn-chefs-close').addEventListener('click', () => el('chefs-modal').classList.remove('visible'));
function renderChefs() {
    if (!openStation)
        return;
    const s = game.getState();
    el('chefs-title').textContent = `Chef · ${STATION_DEF_BY_ID[openStation].name}`;
    for (const def of MANAGER_DEFS) {
        const c = chefCards.get(def.id);
        const owned = !!s.managers[def.id];
        const hereStation = STATION_IDS.find((id) => s.stations[id].managerId === def.id) ?? null;
        c.alt.hidden = true;
        if (!owned) {
            c.btn.innerHTML = `💎 ${def.hireCost}`;
            c.btn.disabled = s.gems < def.hireCost;
            c.btn.className = s.gems >= def.hireCost ? 'chef-act affordable' : 'chef-act';
        }
        else if (hereStation === openStation) {
            c.btn.textContent = 'Retirer';
            c.btn.disabled = false;
            c.btn.className = 'chef-act remove';
        }
        else if (hereStation) {
            c.btn.textContent = `Déplacer ici`;
            c.btn.disabled = false;
            c.btn.className = 'chef-act';
        }
        else {
            c.btn.textContent = 'Poster ici';
            c.btn.disabled = false;
            c.btn.className = 'chef-act affordable';
        }
    }
}
// --- Tab navigation ----------------------------------------------------------
const tabButtons = Array.from(document.querySelectorAll('nav button[data-tab]'));
for (const btn of tabButtons) {
    btn.addEventListener('click', () => {
        for (const o of tabButtons)
            o.classList.toggle('active', o === btn);
        for (const s of document.querySelectorAll('section.tab')) {
            s.classList.toggle('active', s.id === btn.dataset.tab);
        }
        if (btn.dataset.tab === 'tab-factory')
            requestAnimationFrame(() => scene?.resize());
    });
}
// --- Factory-tab actions -----------------------------------------------------
el('btn-fix-bottleneck').addEventListener('click', () => {
    const s = game.getState();
    const id = FactoryEngine.bottleneck(s, Date.now());
    if (game.upgradeStation(id, manageMode) > 0)
        buzz(12);
});
const rushBtn = el('btn-rush');
rushBtn.addEventListener('click', async () => {
    rushBtn.disabled = true;
    // No ad SDK here — simulate a short rewarded-ad delay, then grant the rush.
    await new Promise((r) => setTimeout(r, 400));
    game.startRush();
    buzz(20);
    rushBtn.disabled = false;
});
// --- Prestige ----------------------------------------------------------------
el('btn-prestige').addEventListener('click', () => { if (game.prestige() > 0)
    buzz(30); });
// --- Modals ------------------------------------------------------------------
let pendingOfflineCash = 0;
let pendingDaily = null;
game.on('offline', (r) => {
    pendingOfflineCash = r.cash;
    el('offline-amount').textContent = `+${fmt(r.cash)} €`;
    const mins = Math.round(r.seconds / 60);
    el('offline-detail').textContent = `Absent ${mins >= 60 ? Math.floor(mins / 60) + ' h ' : ''}${mins % 60} min · l’usine a continué`;
    el('btn-offline-x2').hidden = r.cash <= 0;
    el('offline-modal').classList.add('visible');
});
game.on('daily', (d) => {
    pendingDaily = d;
    if (el('offline-modal').classList.contains('visible'))
        return;
    showDaily();
});
function showDaily() {
    if (!pendingDaily)
        return;
    el('daily-streak').textContent = `Jour ${pendingDaily.streak} · série de ${pendingDaily.streak}`;
    el('daily-reward').textContent = `+${pendingDaily.gemReward} 💎 · +${fmt(pendingDaily.cashReward)} €`;
    el('daily-modal').classList.add('visible');
}
el('btn-daily-claim').addEventListener('click', () => {
    game.claimDaily();
    pendingDaily = null;
    el('daily-modal').classList.remove('visible');
    buzz(15);
});
el('btn-offline-ok').addEventListener('click', () => {
    el('offline-modal').classList.remove('visible');
    showDaily();
});
el('btn-offline-x2').addEventListener('click', async () => {
    const btn = el('btn-offline-x2');
    btn.disabled = true;
    await new Promise((r) => setTimeout(r, 400));
    if (pendingOfflineCash > 0)
        game.grantBonusCash(pendingOfflineCash);
    btn.disabled = false;
    el('offline-modal').classList.remove('visible');
    showDaily();
});
el('btn-settings').addEventListener('click', () => el('settings-modal').classList.add('visible'));
el('btn-settings-close').addEventListener('click', () => el('settings-modal').classList.remove('visible'));
// Graphics quality toggle (Ultra post-processing ↔ Performance).
const qualityBtn = el('btn-quality');
function refreshQualityBtn() {
    const q = scene?.getQuality() ?? 'basic';
    qualityBtn.textContent = q === 'ultra' ? '✨ Graphismes : Ultra' : '⚡ Graphismes : Perf';
}
qualityBtn.addEventListener('click', () => {
    if (!scene)
        return;
    scene.setQuality(scene.getQuality() === 'ultra' ? 'basic' : 'ultra');
    refreshQualityBtn();
});
refreshQualityBtn();
el('btn-buy-cash').addEventListener('click', () => { game.buyCashWithGems(); });
el('btn-export').addEventListener('click', () => {
    const code = game.exportSave();
    void navigator.clipboard?.writeText(code).catch(() => { });
    window.prompt('Code de sauvegarde (copié) :', code);
});
el('btn-import').addEventListener('click', () => {
    const code = window.prompt('Collez votre code de sauvegarde :');
    if (code && game.importSave(code)) {
        window.alert('Importé ! Rechargement…');
        location.reload();
    }
});
el('btn-reset').addEventListener('click', () => {
    if (window.confirm('Réinitialiser toute la progression ?')) {
        game.reset();
        location.reload();
    }
});
// --- Rendering ---------------------------------------------------------------
let firstRender = true;
function render(s) {
    const now = Date.now();
    cashTween.set(s.cash, !firstRender);
    gemsTween.set(s.gems, false);
    starsTween.set(s.stars, false);
    // Line stats.
    const rev = FactoryEngine.revenuePerSecond(s, now);
    const tp = FactoryEngine.lineThroughput(s, now);
    const neck = FactoryEngine.bottleneck(s, now);
    el('ls-revenue').textContent = `${fmt(rev)} €/s`;
    el('ls-throughput').textContent = `${fmt(tp * 60)}/min`;
    el('ls-bottleneck').textContent = STATION_DEF_BY_ID[neck].name;
    scene?.setState(s);
    // Active-tab heavy panels only.
    if (isActive('tab-manage')) {
        renderRecipes(s);
        renderManage(s, now);
    }
    if (isActive('tab-research'))
        renderResearch(s);
    if (isActive('tab-prestige'))
        renderPrestige(s);
    if (openStation)
        renderStationSheet(s);
    // Rush button label.
    const remain = game.rushRemainingMs();
    rushBtn.textContent = remain > 0 ? `🔥 Coup de feu actif · ${Math.ceil(remain / 1000)}s` : '🚀 Coup de feu ×3 (pub · 60s)';
    firstRender = false;
}
function isActive(id) {
    return document.getElementById(id)?.classList.contains('active') ?? false;
}
function renderManage(s, now) {
    for (const id of STATION_IDS) {
        const row = stationRows.get(id);
        const st = s.stations[id];
        const rate = FactoryEngine.stationRate(s, id, now);
        const cap = FactoryEngine.stationCapacity(s, id);
        const fill = id === 'delivery' ? 0 : Math.min(1, st.output / Math.max(1, cap));
        row.level.textContent = String(st.level);
        row.rate.textContent = fmtRate(rate);
        row.buffer.textContent = id === 'delivery' ? '—' : `${Math.round(fill * 100)}%`;
        row.workers.textContent = String(st.workers);
        row.bar.style.width = `${Math.round(fill * 100)}%`;
        const plan = upgradePlan(s, id, manageMode);
        row.buyLbl.textContent = manageMode === 1 ? 'Améliorer' : `×${plan.count || manageMode}`;
        row.cost.textContent = fmt(plan.cost);
        row.buyBtn.disabled = plan.count < 1 || s.cash < plan.cost;
        row.buyBtn.classList.toggle('affordable', plan.count >= 1 && s.cash >= plan.cost);
        row.root.classList.toggle('is-bottleneck', id === FactoryEngine.bottleneck(s, now));
    }
    el('menu-level').textContent = String(s.menuLevel);
    el('menu-price').textContent = `${fmt(FactoryEngine.dishPrice(s))} €`;
    const menuCost = FactoryEngine.menuCost(s);
    el('menu-cost').textContent = fmt(menuCost);
    menuBtn.classList.toggle('affordable', s.cash >= menuCost);
    menuBtn.disabled = s.cash < menuCost;
}
function renderResearch(s) {
    for (const def of RESEARCH_DEFS) {
        const row = researchRows.get(def.id);
        const level = FactoryEngine.researchLevel(s, def.id);
        const cost = FactoryEngine.researchCost(s, def.id);
        const pct = Math.round(def.perLevel * level * 100);
        row.level.textContent = String(level);
        row.effect.textContent = `${def.description} +${pct}%`;
        if (cost === null) {
            row.buyBtn.textContent = 'MAX';
            row.buyBtn.disabled = true;
        }
        else {
            const bal = def.currency === 'stars' ? s.stars : s.cash;
            row.buyBtn.innerHTML = `${def.currency === 'stars' ? '⭐' : '💶'} ${fmt(cost)}`;
            row.buyBtn.disabled = bal < cost;
            row.buyBtn.classList.toggle('affordable', bal >= cost);
        }
    }
}
function renderPrestige(s) {
    const pending = FactoryEngine.pendingStars(s);
    const threshold = FactoryEngine.prestigeThreshold(s);
    el('prestige-mult').textContent = `×${FactoryEngine.starMultiplier(s).toFixed(2)}`;
    el('prestige-fill').style.width = `${Math.min(100, (s.stats.cashRun / 1000000) * 100)}%`;
    const btn = el('btn-prestige');
    btn.disabled = pending <= 0;
    btn.textContent = pending > 0 ? `Décrocher · +${pending} ⭐` : 'Décrocher une étoile';
    el('prestige-note').textContent = pending > 0
        ? `Prêt ! Vous gagneriez ${pending} étoile(s).`
        : `Encaissez ${fmt(1000000)} € dans ce cycle (actuel : ${fmt(s.stats.cashRun)}).`;
    el('stats-summary').innerHTML =
        `💶 ${fmt(s.stats.cashAll)} € encaissés au total<br/>` +
            `🍽️ ${fmtInt(s.stats.dishesSold)} plats vendus<br/>` +
            `⭐ ${s.stats.prestiges} étoile(s) décrochée(s)`;
    void threshold;
}
function renderStationSheet(s) {
    if (!openStation)
        return;
    const id = openStation;
    const def = STATION_DEF_BY_ID[id];
    const st = s.stations[id];
    const now = Date.now();
    const rate = FactoryEngine.stationRate(s, id, now);
    const cap = FactoryEngine.stationCapacity(s, id);
    const fill = id === 'delivery' ? 1 : Math.min(1, st.output / Math.max(1, cap));
    el('st-emoji').textContent = def.icon;
    el('st-name').textContent = def.name;
    el('st-blurb').textContent = def.blurb;
    el('st-level').textContent = String(st.level);
    el('st-rate').textContent = fmtRate(rate);
    el('st-buffer').textContent = id === 'delivery' ? '—' : `${Math.round(fill * 100)}%`;
    el('st-workers').textContent = `${st.workers}/${WORKERS_PER_STATION_CAP}`;
    el('st-buffer-fill').style.width = `${Math.round(fill * 100)}%`;
    el('st-warn').hidden = FactoryEngine.bottleneck(s, now) !== id;
    const plan = upgradePlan(s, id, sheetMode);
    el('st-upg-label').textContent = sheetMode === 1 ? 'Améliorer' : `Améliorer ×${plan.count || sheetMode}`;
    el('st-upg-cost').textContent = fmt(plan.cost);
    const upgBtn = el('btn-upgrade-station');
    upgBtn.disabled = plan.count < 1 || s.cash < plan.cost;
    upgBtn.classList.toggle('affordable', plan.count >= 1 && s.cash >= plan.cost);
    el('st-worker-count').textContent = String(st.workers);
    el('btn-worker-plus').disabled = s.workersIdle < 1 || st.workers >= WORKERS_PER_STATION_CAP;
    el('btn-worker-minus').disabled = st.workers < 1;
    const hireCost = FactoryEngine.workerCost(s);
    el('st-hire-cost').textContent = fmt(hireCost);
    el('st-idle').textContent = String(s.workersIdle);
    el('btn-hire-from-station').disabled = s.cash < hireCost;
    // Chef de partie row + active-skill button.
    const mgrId = st.managerId;
    const mgr = mgrId ? MANAGER_BY_ID[mgrId] : null;
    el('st-chef-ic').textContent = mgr ? mgr.icon : '👨‍🍳';
    el('st-chef-name').textContent = mgr ? mgr.name : 'Aucun chef';
    el('st-chef-eff').textContent = mgr ? modText(mgr.passive) : 'Affectez un chef de partie';
    const skillBtn = el('btn-chef-skill');
    if (mgr && mgr.active) {
        skillBtn.hidden = false;
        const cd = FactoryEngine.skillCooldownRemainingMs(s, id, Date.now());
        const live = FactoryEngine.isSkillActive(s, id, Date.now());
        skillBtn.textContent = live ? '🔥 Actif' : cd > 0 ? `⚡ ${Math.ceil(cd / 1000)}s` : '⚡ Skill';
        skillBtn.disabled = live || cd > 0;
        skillBtn.classList.toggle('ready', !live && cd <= 0);
    }
    else {
        skillBtn.hidden = true;
    }
}
function upgradePlan(s, id, mode) {
    return mode === 'max'
        ? FactoryEngine.maxAffordableUpgrades(s, id)
        : { count: mode, cost: FactoryEngine.upgradeBulkCost(s, id, mode) };
}
// --- Notifications (lightweight toast via the document title flash) ----------
// Transient toasts for non-blocking feedback (recruit, errors, prestige…).
const toastHost = el('toast-host');
function showToast(message, severity) {
    const t = document.createElement('div');
    t.className = `toast toast-${severity}`;
    t.textContent = message;
    toastHost.appendChild(t);
    // Cap the stack so a flood can't pile up.
    while (toastHost.children.length > 4)
        toastHost.removeChild(toastHost.firstChild);
    requestAnimationFrame(() => t.classList.add('show'));
    window.setTimeout(() => {
        t.classList.remove('show');
        window.setTimeout(() => t.remove(), 280);
    }, 2600);
}
game.on('notify', (n) => showToast(n.message, n.severity));
// --- Boot the simulation -----------------------------------------------------
game.start();
let lastFrame = performance.now();
function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.25);
    lastFrame = now;
    game.tick(dt);
    render(game.getState());
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
requestAnimationFrame(() => scene?.resize());
// --- Cloud save sync (opt-in; offline-first) ---------------------------------
const cloud = new CloudSync();
let lastPushedScore = -1;
function localScore() { return Math.floor(game.getState().stats.cashAll || 0); }
async function pushCloud(keepalive = false) {
    if (!cloud.enabled())
        return;
    const score = localScore();
    if (score === lastPushedScore && !keepalive)
        return;
    const res = await cloud.push(game.exportSave(), keepalive);
    if (res.status === 'ok')
        lastPushedScore = score;
    else if (res.status === 'stale' && res.snapshot.code && res.snapshot.score > score) {
        if (game.importSave(res.snapshot.code))
            location.reload();
    }
}
async function initCloud() {
    if (!cloud.enabled())
        return;
    if (!(await cloud.ensureAccount()))
        return;
    const snap = await cloud.pull();
    if (snap && snap.code && snap.score > localScore()) {
        if (game.importSave(snap.code)) {
            location.reload();
            return;
        }
    }
    await pushCloud();
    window.setInterval(() => { void pushCloud(); }, 30000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden')
    void pushCloud(true); });
window.addEventListener('pagehide', () => { void pushCloud(true); });
void initCloud();
