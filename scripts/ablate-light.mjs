#!/usr/bin/env node
// 消融实验：屏蔽灯光视频（bGeuE*）后加载 shader.se，验证键盘/地板光的因果来源
// 用法：node scripts/ablate-light.mjs <out.png> [--allow]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const out = process.argv[2] || 'screenshots/ablate.png';
const allow = process.argv.includes('--allow');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
if (!allow) {
  await ctx.route(/bGeuE/, (route) => route.abort());
}
const page = await ctx.newPage();
const failed = [];
page.on('requestfailed', (r) => { if (/bGeuE/.test(r.url())) failed.push(r.url().slice(0, 80)); });
await page.goto('https://www.shader.se/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(14000);
await page.screenshot({ path: out });
console.log('saved:', out, 'blocked-requests:', failed.length);
await ctx.close();
process.exit(0);
