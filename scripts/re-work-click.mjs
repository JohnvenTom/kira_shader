#!/usr/bin/env node
/**
 * RE pass 3：demo 区交互性判定 —— select-concept 配置器里点 "Products →"
 * 若点击后画面变化/光标变 pointer = 活嵌入；无变化 = 录屏视频。
 */
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = ctx.pages()[0] ?? (await ctx.newPage());

await page.goto('https://www.shader.se/work/select-concept', { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(13000);

const OUT = 'screenshots/re-work';
// Table 5 的 "Products →" 按钮（booted 截图 (573,239)×2.153 缩放）
const BTN = [1234, 515];
await page.mouse.move(BTN[0], BTN[1]);
await page.waitForTimeout(500);
const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('canvas')).cursor);
console.log('hover cursor:', cursor);
await page.screenshot({ path: `${OUT}/re3-click-pre.png` });
await page.mouse.click(BTN[0], BTN[1]);
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/re3-click-post1.png` });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/re3-click-post2.png` });
console.log('DONE');
process.exit(0);
