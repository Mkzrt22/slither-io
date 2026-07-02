/**
 * browser.e2e.mjs — Headless end-to-end test of Chef Factory Tycoon.
 *
 * Serves dist-web (run `npm run build:web` first — `npm run test:e2e` does
 * both), drives the game in Chromium, and fails on any broken expectation or
 * console error. Validates that the simulation runs (cash accrues), the 3D
 * factory canvas mounts, stations are upgradeable, and every tab renders.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); }
  catch { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});

function expect(cond, label) { if (!cond) throw new Error(`expectation failed: ${label}`); console.log(`ok - ${label}`); }

const { chromium } = loadPlaywright();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });

try {
  const page = await browser.newPage({ viewport: { width: 430, height: 860 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });

  // Boot: fresh profile with 25 gems.
  await page.waitForFunction(() => document.getElementById('stat-gems')?.textContent === '25', null, { timeout: 10000 });
  expect(true, 'fresh profile boots with 25 gems');

  // Daily reward greets the player; claim to dismiss.
  await page.waitForSelector('#daily-modal.visible', { timeout: 5000 });
  await page.click('#btn-daily-claim');
  await page.waitForFunction(() => !document.getElementById('daily-modal').classList.contains('visible'), null, { timeout: 3000 });
  expect(true, 'daily reward modal claimed');

  // The factory tab is active and shows live line stats.
  expect(await page.locator('#tab-factory').evaluate((e) => e.classList.contains('active')), 'factory tab is the landing tab');
  const rev = await page.locator('#ls-revenue').innerText();
  expect(/[1-9]/.test(rev), `line reports revenue (${rev})`);

  // The 3D factory canvas mounted with a WebGL context.
  const hasGL = await page.evaluate(() => {
    const c = document.querySelector('#factory-host canvas');
    return !!c && !!(c.getContext('webgl2') || c.getContext('webgl'));
  });
  expect(hasGL, '3D factory canvas has a WebGL context');

  // The simulation runs: cash climbs above zero on its own.
  await page.waitForFunction(() => document.getElementById('stat-cash')?.textContent !== '0', null, { timeout: 15000 });
  expect(true, 'simulation accrues cash over time');

  // Gestion: five station cards render and one is flagged as the bottleneck.
  await page.click('nav button[data-tab="tab-manage"]');
  expect((await page.locator('#station-list .station-card').count()) === 5, 'five production stations listed');
  await page.waitForFunction(() => document.querySelectorAll('#station-list .station-card.is-bottleneck').length >= 1, null, { timeout: 4000 });
  expect(true, 'a bottleneck station is highlighted');

  // Wait until the cheapest upgrade is affordable, then buy it.
  const firstBuy = '#station-list .station-card:first-child [data-buy]';
  await page.waitForFunction((sel) => { const b = document.querySelector(sel); return b && !b.disabled; }, firstBuy, { timeout: 20000 });
  const lvlBefore = await page.locator('#station-list .station-card:first-child [data-level]').innerText();
  await page.click(firstBuy);
  await page.waitForFunction(
    (before) => Number(document.querySelector('#station-list .station-card:first-child [data-level]').textContent) > Number(before),
    lvlBefore, { timeout: 4000 },
  );
  const lvlAfter = await page.locator('#station-list .station-card:first-child [data-level]').innerText();
  expect(Number(lvlAfter) > Number(lvlBefore), `station upgraded (${lvlBefore} -> ${lvlAfter})`);

  // Opening a station avatar reveals the detail sheet with metrics.
  await page.click('#station-list .station-card:first-child .sc-avatar');
  await page.waitForFunction(() => document.getElementById('station-sheet').classList.contains('open'), null, { timeout: 3000 });
  expect((await page.locator('#st-name').innerText()).length > 0, 'station detail sheet opens with metrics');
  await page.evaluate(() => document.getElementById('btn-station-close').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForFunction(() => !document.getElementById('station-sheet').classList.contains('open'), null, { timeout: 3000 });
  expect(true, 'station sheet closes');

  // Research tab lists its upgrades.
  await page.click('nav button[data-tab="tab-research"]');
  expect((await page.locator('#research-list .research-card').count()) >= 5, 'research tree renders');

  // Prestige tab renders; with no run-cash the star button is locked.
  await page.click('nav button[data-tab="tab-prestige"]');
  await page.waitForFunction(() => document.getElementById('btn-prestige').disabled === true, null, { timeout: 3000 });
  expect(true, 'prestige locked below the threshold');

  // Persistence: progress survives a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('stat-gems') !== null, null, { timeout: 10000 });
  await page.click('nav button[data-tab="tab-manage"]');
  const lvlReloaded = await page.locator('#station-list .station-card:first-child [data-level]').innerText();
  expect(Number(lvlReloaded) >= Number(lvlAfter), `upgrade persisted across reload (${lvlReloaded})`);

  expect(consoleErrors.length === 0, `no console errors (got: ${consoleErrors.join(' | ')})`);
  console.log('BROWSER E2E PASSED');
} finally {
  await browser.close();
  server.close();
}
