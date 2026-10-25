#!/usr/bin/env node
// 断点实测：1600/1440/1280 视口下原站顶部形态（水平导航项 vs 汉堡）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
for (const w of [1600, 1440, 1280]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto('https://www.shader.se/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(13000);
  await page.screenshot({ path: `screenshots/nav-bp-${w}.png`, clip: { x: 0, y: 0, width: w, height: 110 } });
  console.log(w, 'done');
}
await page.close();
process.exit(0);
