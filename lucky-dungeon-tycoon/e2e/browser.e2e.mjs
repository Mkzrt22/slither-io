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

  // Persistence: gold AND purchased overfill must survive a reload.
  const goldBefore = await page.locator('#stat-gold').innerText();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction((g) => document.getElementById('stat-gold').textContent === g, goldBefore);
  expect((await page.locator('#stat-energy').innerText()) === '50/30', 'paid energy overfill survived reload');

  // v2: engaging the floor guardian shows the HP bar.
  await page.click('#btn-boss');
  await page.waitForSelector('#boss-panel:not([hidden])', { timeout: 3000 });
  expect(true, 'boss fight engages and shows the HP bar');

  // v2: the miners tab lists all four hireable tiers.
  await page.click('nav button[data-tab="tab-miners"]');
  expect((await page.locator('#miners-list .card').count()) === 4, 'miners tab lists 4 tiers');

  // v2: the quest book renders with progress bars.
  await page.click('nav button[data-tab="tab-quests"]');
  expect((await page.locator('#quests-list .card').count()) >= 5, 'quest book renders');

  expect(consoleErrors.length === 0, `no console errors (got: ${consoleErrors.join(' | ')})`);
  console.log('BROWSER E2E PASSED');
} finally {
  await browser.close();
  server.close();
}
