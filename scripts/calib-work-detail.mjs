#!/usr/bin/env node
/**
 * 打样校准：本地 /work/ehealth-arena ↔ 原站 同视口滚动关键帧对照
 * 产出 screenshots/calib/{local,origin}-{top,s25,s50,s75,next}.png
 * 附带：本地 Close 点击 → 落点 URL；Continue → 下一 slug。
 */
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const CDP = 'http://localhost:9222';
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });

const OUT = 'screenshots/calib';
const fr = (f) => Math.round(f * 100);

async function shootSet(url, prefix, bootMs, origin = false) {
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(Math.round(bootMs * 0.25));
  await page.screenshot({ path: `${OUT}/${prefix}-boot.png` });
  await page.waitForTimeout(bootMs - Math.round(bootMs * 0.25));
  await page.screenshot({ path: `${OUT}/${prefix}-top.png` });
  // 原站滚动发生在内层 #scroll-container（div.fixed.inset-0），body 不滚
  const scrollTo = (y) => page.evaluate((yy) => {
    if (window.__wdOrigin) {
      const sc = document.querySelector('div.fixed.inset-0');
      if (sc) sc.scrollTop = yy;
    } else {
      window.scrollTo(0, yy);
    }
  }, y);
  if (origin) await page.evaluate(() => { window.__wdOrigin = true; });
  const scrollH = await page.evaluate(() => {
    if (window.__wdOrigin) {
      const sc = document.querySelector('div.fixed.inset-0');
      return sc ? sc.scrollHeight - sc.clientHeight : 0;
    }
    return document.documentElement.scrollHeight - window.innerHeight;
  });
  console.log(`[${prefix}] scrollable=`, scrollH);
  for (const f of [0.25, 0.5, 0.75]) {
    await scrollTo(scrollH * f);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${prefix}-s${fr(f)}.png` });
  }
  await scrollTo(scrollH + 10);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${prefix}-next.png` });
}

// 1) 本地（boot 快，4s 足够）
await shootSet('http://localhost:5173/work/ehealth-arena', 'local', 4000);

// 2) 本地交互：Close → 落点；Continue → 下一 slug
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(600);
await page.mouse.click(1529, 77);
await page.waitForTimeout(2500);
console.log('[local] after Close:', page.url());
await page.screenshot({ path: `${OUT}/local-after-close.png` });

await page.goto('http://localhost:5173/work/ehealth-arena', { waitUntil: 'load' });
await page.waitForTimeout(4000);
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(1000);
const cont = await page.$('.wd-continue');
if (cont) {
  await cont.click();
  await page.waitForTimeout(3000);
  console.log('[local] after Continue:', page.url());
  await page.screenshot({ path: `${OUT}/local-after-continue.png` });
} else {
  console.log('[local] Continue link not found');
}

// 3) 原站（boot ~10s；滚动在内层容器）
await shootSet('https://www.shader.se/work/ehealth-arena', 'origin', 13000, true);

console.log('CALIB DONE');
process.exit(0);
