#!/usr/bin/env node
// 一次性诊断：全新 page 打开站点，收集 console/pageerror/requestfailed
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const URL_TO_TEST = process.argv[2] || 'http://localhost:5199/';
const WAIT_MS = +(process.argv[3] || 10000);

const step = (m) => console.error('[diag]', m);
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e); });
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e); });

step('connecting CDP...');
const browser = await chromium.connectOverCDP('http://localhost:9222');
step('connected. contexts=' + browser.contexts().length);

const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage(); // 全新 page，不复用旧 target
step('new page created');

page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning' || t === 'log') console.log(`[console.${t}]`, m.text().slice(0, 300));
});
page.on('response', (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}]`, r.url().slice(0, 150)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 800)));
page.on('requestfailed', (r) => console.log('[requestfailed]', r.url().slice(0, 120), r.failure()?.errorText));
page.on('crash', () => console.log('[PAGE CRASHED]'));

step('goto ' + URL_TO_TEST);
try {
  await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 30000 });
  step('goto ok');
} catch (e) {
  console.log('[goto failed]', String(e).slice(0, 300));
}

step('listening ' + WAIT_MS + 'ms...');
await page.waitForTimeout(WAIT_MS);

const info = await page.evaluate(() => ({
  title: document.title,
  canvas: !!document.querySelector('canvas'),
  root: document.getElementById('root')?.children.length ?? -1,
  bodyLen: document.body.innerHTML.length,
})).catch((e) => 'eval failed: ' + String(e).slice(0, 200));
console.log('[page state]', JSON.stringify(info));

await page.screenshot({ path: 'screenshots/diag-boot.png' }).catch((e) => console.log('[shot failed]', String(e).slice(0, 200)));
step('done, closing only this page');
await page.close().catch(() => {});
process.exit(0);
