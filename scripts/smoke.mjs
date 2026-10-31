import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const external = process.env.SMOKE_URL;
const server = external ? null : await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } });
if (server) await server.listen();
const baseURL = external || 'http://127.0.0.1:5174';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; console.log(`PASS ${message}`); };

try {
  await mkdir('test-results', { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(baseURL);
  await page.waitForFunction(() => window.__FAIRY__ && document.querySelector('#stage canvas'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  check(await page.locator('#first-hint').isVisible(), 'ready screen renders with playable course and control hint');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop has no horizontal overflow');
  check((await page.locator('#timer').textContent()) === '00:00.00', 'timer waits for player input');

  await page.locator('#stage').focus();
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(450); await page.keyboard.up('ArrowRight');
  let state = await page.evaluate(() => window.__FAIRY__.snapshot());
  check(state.x > 2.5 && state.elapsed > 0.2, 'keyboard input physically runs the fairy and starts the timer');
  await page.keyboard.down('Space'); await page.waitForTimeout(450); await page.keyboard.up('Space');
  state = await page.evaluate(() => window.__FAIRY__.snapshot());
  check(state.fuel < 0.9 && state.y > 1.5, 'held Space burns fuel and lifts the fairy');
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(200); await page.keyboard.up('ArrowRight');
  state = await page.evaluate(() => window.__FAIRY__.snapshot());
  check(Math.abs(state.angle) > 0.05, 'air input rotates the actual physics rig');

  await page.keyboard.press('p'); await page.waitForTimeout(80);
  const pausedTime = await page.locator('#timer').textContent();
  await page.waitForTimeout(200);
  check((await page.locator('#timer').textContent()) === pausedTime && await page.locator('#overlay').isVisible(), 'pause freezes simulation and displays resume action');
  await page.locator('#overlay-retry').click();
  await page.keyboard.press('r'); await page.waitForTimeout(100);
  state = await page.evaluate(() => window.__FAIRY__.snapshot());
  check(state.state === 'ready' && state.fuel === 1 && state.elapsed === 0, 'R immediately resets the entire attempt');

  await page.locator('#tuning-tab').click();
  await page.locator('#preset').selectOption('training');
  check((await page.locator('#value-balance').textContent()).includes('1.5'), 'training preset updates the live tuning panel');
  await page.locator('#setting-thrust').fill('34');
  check((await page.evaluate(() => window.__FAIRY__.sim.settings.thrust)) === 34, 'slider changes the actual simulation parameter');
  await page.locator('#debug-check').check();
  check(await page.locator('#debug').getAttribute('aria-pressed') === 'true', 'physics overlay toggle stays synchronized');
  await page.waitForTimeout(100); await page.screenshot({ path: 'test-results/tuning.png', fullPage: true });
  const downloaded = page.waitForEvent('download'); await page.locator('#export').click();
  const download = await downloaded; await download.saveAs('test-results/fairy-tuning.json');
  check(download.suggestedFilename() === 'fairy-tuning.json', 'tuning presets export to a shareable JSON file');
  await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"settings":{"thrust":-10}}') });
  await page.waitForTimeout(80);
  check((await page.locator('#toast').textContent()).includes('must be between'), 'preset import rejects out-of-range physics');
  await page.reload(); await page.waitForFunction(() => window.__FAIRY__);
  check(await page.evaluate(() => window.__FAIRY__.sim.settings.thrust === 34), 'custom tuning survives a reload');
  await page.locator('#help').click();
  check(await page.locator('#briefing').isVisible(), 'flight briefing opens as an accessible dialog');
  await page.locator('#briefing-close').click();
  await page.locator('#stage').focus(); await page.keyboard.press('g');
  check(await page.locator('#debug').getAttribute('aria-pressed') === 'true', 'G toggles the physics overlay');
  await page.keyboard.press('r');

  // Exercise the terminal UI using a physical fall, rather than a mocked DOM state.
  await page.evaluate(() => {
    const { sim } = window.__FAIRY__;
    for (const { body } of sim.parts) { const p = body.getPosition(); body.setTransform({ x: p.x, y: p.y - 12 }, body.getAngle()); }
  });
  await page.waitForFunction(() => window.__FAIRY__.snapshot().state === 'fallen');
  await page.waitForFunction(() => document.querySelector('#overlay-title').textContent === 'Gravity: 1. Fairy: 0.');
  check(await page.locator('#overlay-title').textContent() === 'Gravity: 1. Fairy: 0.', 'physical falls expose immediate retry');
  await page.locator('#overlay-retry').click();
  await page.locator('#overlay').waitFor({ state: 'hidden' });
  check(await page.locator('#overlay').isHidden(), 'retry clears the failure overlay');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', err => errors.push(err.message));
  await mobile.goto(baseURL); await mobile.waitForFunction(() => window.__FAIRY__);
  await mobile.waitForTimeout(250);
  check(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout fits the viewport');
  check(await mobile.locator('[data-input="action"]').isVisible(), 'touch thrust and direction controls are available');
  await mobile.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  const touch = await mobileContext.newCDPSession(mobile);
  const box = await mobile.locator('[data-input="action"]').boundingBox();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await mobile.waitForTimeout(250);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check(await mobile.evaluate(() => window.__FAIRY__.snapshot().fuel < 1), 'touch action reaches the same physics input');
  const production = await preview({ preview: { host: '127.0.0.1', port: 4174, strictPort: true } });
  try {
    const prod = await context.newPage();
    prod.on('pageerror', err => errors.push(err.message));
    prod.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await prod.goto('http://127.0.0.1:4174');
    await prod.locator('#stage canvas').waitFor({ state: 'visible' });
    await prod.locator('#loading').waitFor({ state: 'detached' });
    check(await prod.evaluate(() => !('__FAIRY__' in window)), 'production build excludes development instrumentation');
    await prod.locator('#stage').focus();
    await prod.keyboard.down('Space'); await prod.waitForTimeout(350); await prod.keyboard.up('Space');
    check(parseInt(await prod.locator('#fuel-value').textContent()) < 100 && (await prod.locator('#timer').textContent()) !== '00:00.00', 'built production bundle runs physics through real keyboard input');
    await prod.screenshot({ path: 'test-results/production.png', fullPage: true });
  } finally { await new Promise(resolve => production.httpServer.close(resolve)); }
  check(errors.length === 0, `no browser runtime errors (${errors.join('; ')})`);
  console.log(`\n${checks} browser checks passed. Screenshots: test-results/`);
} finally {
  await browser.close(); await server?.close();
}
