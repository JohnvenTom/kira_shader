#!/usr/bin/env node
// 消融实验 v2：复用既有页面（避免新 context 的 SwiftShader 污染），挂路由后 reload
// 用法：node scripts/ablate-light2.mjs <out.png> [--allow] [--both]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const out = process.argv[2] || 'screenshots/ablate.png';
const allow = process.argv.includes('--allow');
const both = process.argv.includes('--both');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
if (!ctx) { console.error('no context'); process.exit(1); }
await ctx.unroute(/bGeuE|S6lql/).catch(() => {});
if (!allow) {
  if (both) await ctx.route(/bGeuE|S6lql/, (route) => route.abort());
  else await ctx.route(/bGeuE/, (route) => route.abort());
}
const page = ctx.pages()[0] || (await ctx.newPage());
let blocked = 0;
page.on('requestfailed', (r) => { if (/bGeuE|S6lql/.test(r.url())) blocked++; });
await page.goto('about:blank');
await page.goto('https://www.shader.se/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(15000);
await page.screenshot({ path: out });
console.log('saved:', out, 'blocked:', blocked);
process.exit(0);
