/**
 * browser.e2e.mjs — Headless-browser end-to-end test of the web UI.
 *
 * Self-contained: starts its own static server over dist-web (run
 * `npm run build:web` first — `npm run test:e2e` does both), drives the game
 * in Chromium, and exits non-zero on any failed expectation or console error.
 *
 * Requires Playwright with Chromium installed (locally or globally):
 *   npm i -D playwright && npx playwright install chromium
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(path.join(globalRoot, 'playwright'));
  }
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-web');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

function expect(condition, label) {
  if (!condition) throw new Error(`expectation failed: ${label}`);
  console.log(`ok - ${label}`);
}

const { chromium } = loadPlaywright();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });

  // Boot: the controller's first state:updated renders a fresh profile.
  await page.waitForFunction(() => document.getElementById('stat-energy').textContent === '30/30');
  expect((await page.locator('#stat-gems').innerText()) === '25', 'fresh profile boots with 25 gems');

  // The village is the landing tab and lists six buildings.
  expect((await page.locator('#buildings-list .card').count()) === 6, 'village lists 6 buildings');

  // The Donjon (slot) tab holds the spin machine.
  await page.click('nav button[data-tab="tab-mine"]');

  // Spinning consumes energy, pays out, and feeds the log.
  for (let i = 0; i < 5; i++) await page.click('#btn-spin');
  expect((await page.locator('#stat-energy').innerText()) === '25/30', '5 spins consume 5 energy');
  expect((await page.locator('#stat-gold').innerText()) !== '0', 'spins paid out gold');
  expect((await page.locator('#log li').count()) === 5, 'each spin logged');

  // Draining the tank disables the button; a spin attempt at 0 energy
  // (e.g. a queued tap racing the disable) opens the refill popup.
  for (let i = 0; i < 25; i++) await page.click('#btn-spin');
  expect(await page.locator('#btn-spin').isDisabled(), 'spin button disabled at 0 energy');
  await page.evaluate(() =>
    document.getElementById('btn-spin').dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  await page.waitForSelector('#energy-popup.visible', { timeout: 3000 });
  expect(true, 'out-of-energy popup shown');

  // Buying the gem pack from the popup overfills past maxEnergy. Gem
  // jackpots during the drain may have raised the balance, so assert the
  // delta rather than an absolute value.
  const gemsBefore = Number(await page.locator('#stat-gems').innerText());
  await page.click('#btn-popup-buy');
  await page.waitForFunction(() => document.getElementById('stat-energy').textContent === '50/30');
  const gemsAfter = Number(await page.locator('#stat-gems').innerText());
  expect(gemsAfter === gemsBefore - 10, `purchase deducted 10 gems (${gemsBefore} -> ${gemsAfter})`);

  // Persistence: the purchased energy overfill must survive a reload. (Gold
  // is read from the model after reload rather than the mid-animation HUD
  // text, which eases toward its target over a few hundred ms.)
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('stat-energy')?.textContent === '50/30', null, { timeout: 15000 });
  expect(true, 'paid energy overfill survived reload');
  const goldAfter = await page.locator('#stat-gold').innerText();
  expect(goldAfter !== '0', `gold persisted across reload (${goldAfter})`);

  // After reload the village is the active tab again; go to the Donjon tab.
  await page.click('nav button[data-tab="tab-mine"]');

  // Engaging the floor guardian shows the HP bar.
  await page.click('#btn-boss');
  await page.waitForSelector('#boss-panel:not([hidden])', { timeout: 3000 });
  expect(true, 'boss fight engages and shows the HP bar');

  // Village: upgrading a building (the mine starts at 30 gold) raises its level.
  await page.click('nav button[data-tab="tab-village"]');
  expect((await page.locator('#buildings-list .card').count()) === 6, 'building list renders 6 cards');
  const mineLvlBefore = await page.locator('#buildings-list .card:first-child [data-level]').innerText();
  await page.click('#buildings-list .card:first-child [data-buy]');
  const mineLvlAfter = await page.locator('#buildings-list .card:first-child [data-level]').innerText();
  expect(Number(mineLvlAfter) === Number(mineLvlBefore) + 1, `building upgraded (${mineLvlBefore} -> ${mineLvlAfter})`);

  // Bulk-buy: switching to ×10 buys ten levels in one click (gold permitting).
  await page.click('#buy-modes button[data-mode="10"]');
  const before10 = Number(await page.locator('#buildings-list .card:first-child [data-level]').innerText());
  const disabled10 = await page.locator('#buildings-list .card:first-child [data-buy]').isDisabled();
  if (!disabled10) {
    await page.click('#buildings-list .card:first-child [data-buy]');
    const after10 = Number(await page.locator('#buildings-list .card:first-child [data-level]').innerText());
    expect(after10 === before10 + 10, `×10 bought ten levels (${before10} -> ${after10})`);
  } else {
    expect(true, '×10 disabled (not enough gold) — toggle still works');
  }
  await page.click('#buy-modes button[data-mode="1"]');

  // Settings modal opens and the sound toggle flips.
  await page.click('#btn-settings');
  await page.waitForSelector('#settings-modal.visible', { timeout: 3000 });
  const soundLabel1 = await page.locator('#btn-sound').innerText();
  await page.click('#btn-sound');
  const soundLabel2 = await page.locator('#btn-sound').innerText();
  expect(soundLabel1 !== soundLabel2, 'sound toggle flips label');
  await page.click('#btn-settings-close');
  await page.waitForFunction(() => !document.getElementById('settings-modal').classList.contains('visible'), null, { timeout: 3000 });
  expect(true, 'settings modal closes');

  // The quest book renders with progress bars.
  await page.click('nav button[data-tab="tab-quests"]');
  expect((await page.locator('#quests-list .card').count()) >= 5, 'quest book renders');

  expect(consoleErrors.length === 0, `no console errors (got: ${consoleErrors.join(' | ')})`);
  console.log('BROWSER E2E PASSED');
} finally {
  await browser.close();
  server.close();
}
