/**
 * End-to-end smoke test: drives the real client in headless Chromium at an iPhone viewport against a
 * running server (default http://localhost:8787, override with NESTHOLD_URL).
 *
 *   npm run build && npm start   # in one terminal (serves the built client)
 *   npm run e2e                  # in another
 *
 * Screenshots land in e2e/screenshots/.
 */
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const URL = process.env.NESTHOLD_URL ?? 'http://localhost:8787/';
const OUT = process.env.NESTHOLD_SHOTS ?? new globalThis.URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

let step = 0;
const shot = async (name) => page.screenshot({ path: `${OUT}/${String(++step).padStart(2, '0')}-${name}.png` });
const check = (cond, msg) => {
  if (!cond) throw new Error(`Smoke test failed: ${msg}`);
  console.log(`✓ ${msg}`);
};
const nest = () => page.evaluate(() => window.__nesthold.store.nest);
const clickText = (selector, text) => page.locator(selector, { hasText: text }).first().click();

try {
  await page.goto(URL);
  await page.waitForSelector('.hud-bottom .big-btn', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot('nest');
  check((await nest()).buildings.some((b) => b.kind === 'nestCore'), 'nest loads with a Nest Core');

  // Build a Grain Field through the shop and placement mode.
  const fieldsBefore = (await nest()).buildings.filter((b) => b.kind === 'grainField').length;
  await clickText('.big-btn', 'Build');
  await page.waitForSelector('.sheet .card');
  await shot('shop');
  await clickText('.card', 'Grain Field');
  await page.waitForTimeout(400);
  await shot('placing');
  await clickText('.big-btn', 'Place');
  await page.waitForTimeout(800);
  check((await nest()).buildings.filter((b) => b.kind === 'grainField').length === fieldsBefore + 1, 'placed a new Grain Field');

  // Hatchery panel.
  await clickText('.big-btn', 'Hatch');
  await page.waitForSelector('.sheet .card');
  await shot('hatchery');
  await page.click('.sheet .close');

  // Join the bot flock and write a pigeon.
  await clickText('.big-btn', 'Flock');
  await page.waitForSelector('.sheet .item');
  await clickText('.item', 'Puddle Patrol').catch(() => {});
  await page.locator('.item', { hasText: 'Puddle Patrol' }).locator('button').click();
  await page.waitForSelector('.tabs');
  await page.waitForTimeout(400);
  await shot('flock');
  await page.locator('.item', { hasText: 'Captain Quackers' }).locator('button', { hasText: '🕊' }).click();
  await page.waitForSelector('textarea');
  await page.fill('textarea', 'Rally at the pond at dawn. Bring Mergansers!');
  await page.waitForTimeout(600);
  await shot('pigeon-composer');
  await clickText('.sheet .btn', 'Send');
  await page.waitForTimeout(500);
  const inbox = await page.evaluate(async () => {
    const token = localStorage.getItem('CapacitorStorage.nesthold.token');
    const r = await fetch('/api/pigeon/inbox', { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  });
  check(inbox.sent.length === 1, 'a carrier pigeon is in flight');

  // World map.
  await clickText('.big-btn', 'Raid');
  await page.waitForTimeout(1800);
  await shot('world');

  // Attack a bot nest.
  const target = await page.evaluate(async () => {
    const token = localStorage.getItem('CapacitorStorage.nesthold.token');
    const r = await fetch('/api/world', { headers: { Authorization: `Bearer ${token}` } });
    const list = await r.json();
    const t = list.find((p) => p.name === 'Mudpuddle');
    window.__nesthold.bus.emit('world:select', t);
    return t;
  });
  check(!!target, 'found a bot nest to raid');
  await page.waitForSelector('.sheet .btn.red');
  await shot('target');
  await clickText('.sheet .btn', 'Attack');
  await page.waitForSelector('.deploy-slot');
  await page.waitForTimeout(1500);
  await shot('battle-start');

  // Deploy every duck type on free tiles near the west side of the nest.
  const spots = await page.evaluate(() => {
    const scene = window.__nesthold.game.scene.getScene('battle');
    const out = [];
    for (let y = 10; y < 30 && out.length < 4; y += 3)
      for (let x = 4; x < 16; x++) {
        if (!scene.sim.canDeployAt(x, y)) continue;
        const p = window.__nesthold.gridToClient(x, y);
        if (p.x > 20 && p.x < 370 && p.y > 140 && p.y < 700) {
          out.push(p);
          break;
        }
      }
    return out;
  });
  check(spots.length > 0, 'found on-screen deploy tiles');
  const slots = await page.locator('.deploy-slot').count();
  for (let s = 0; s < slots; s++) {
    await page.locator('.deploy-slot').nth(s).click();
    for (let i = 0; i < 12; i++) {
      const p = spots[(s + i) % spots.length];
      await page.mouse.click(p.x, p.y);
    }
  }
  await page.waitForTimeout(6000);
  await shot('battle-mid');
  const units = await page.evaluate(() => window.__nesthold.game.scene.getScene('battle').sim.units.length);
  check(units > 0, `deployed ${units} ducks`);
  await page.waitForTimeout(8000);
  await shot('battle-late');
  if (!(await page.locator('.sheet').count())) await clickText('.battle-top .btn', 'End');
  await page.waitForSelector('.sheet .stars', { timeout: 20000 });
  await page.waitForTimeout(500);
  await shot('battle-result');
  check(true, 'battle finished and the server returned a result');
  await clickText('.sheet .btn', 'Return home');
  await page.waitForSelector('.hud-bottom .big-btn');

  // Battle log + replay.
  await clickText('.big-btn', 'Log');
  await page.waitForSelector('.sheet .item');
  await shot('log');
  await page.locator('.sheet .item .btn.blue').first().click();
  await page.waitForTimeout(4000);
  await shot('replay');
  check(await page.evaluate(() => window.__nesthold.game.scene.isActive('battle')), 'replay is playing');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  console.log(`Screenshots in ${OUT}`);
} catch (err) {
  await shot('failure').catch(() => {});
  console.error(err.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
