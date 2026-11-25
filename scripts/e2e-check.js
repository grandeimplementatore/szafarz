#!/usr/bin/env node
// Test całej aplikacji w przeglądarce (lokalnie): wszystkie strony i przekierowania telefon/komputer.
// Użycie: DATABASE_URL=memory SEED_DEMO=1 npm run dev, potem:
//         BASE=http://localhost:3000 node scripts/e2e-check.js  (wymaga pakietu playwright)
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '/tmp/sz-shots';
require('fs').mkdirSync(SHOTS, { recursive: true });

const DESKTOP = ['/', '/Kalendarz', '/Planner', '/Chorzy', '/Obrzed', '/Wspolnota'];
const PHONE = ['/Telefon', '/KalendarzTelefon', '/PlannerTelefon', '/ChorzyTelefon', '/ObrzedTelefon', '/ObrzedKroki', '/WspolnotaTelefon'];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  const problems = [];
  async function session(viewport) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(page.url() + ' JS: ' + e.message));
    await page.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    return { ctx, page };
  }
  const { page: d } = await session({ width: 1280, height: 900 });
  for (const p of DESKTOP) {
    await d.goto(BASE + p); await d.waitForSelector('#root > *'); await d.waitForTimeout(200);
    if (new URL(d.url()).pathname !== p) problems.push('desktop ' + p + ' przekierował na ' + d.url());
    await d.screenshot({ path: SHOTS + '/d' + (p.replace('/', '_') || '_Main') + '.png', fullPage: true });
  }
  const { page: m } = await session({ width: 390, height: 844 });
  for (const p of PHONE) {
    await m.goto(BASE + p); await m.waitForSelector('#root > *'); await m.waitForTimeout(200);
    if (new URL(m.url()).pathname !== p) problems.push('telefon ' + p + ' przekierował na ' + m.url());
    await m.screenshot({ path: SHOTS + '/m' + p.replace('/', '_') + '.png', fullPage: false });
  }
  // przekierowanie komputer → telefon
  await m.goto(BASE + '/Chorzy'); await m.waitForSelector('#root > *');
  if (!m.url().endsWith('/ChorzyTelefon')) problems.push('brak przekierowania /Chorzy → /ChorzyTelefon');
  console.log(JSON.stringify({ problems }, null, 1));
  await browser.close();
})();
