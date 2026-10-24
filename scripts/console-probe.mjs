#!/usr/bin/env node
// 抓 #hero 页 console/pageerror —— 诊断 boot 卡住
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 400)}`));
await page.goto('http://localhost:5173/?v=4#hero', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
console.log(logs.slice(0, 30).join('\n') || '(no errors/warnings)');
await page.close();
process.exit(0);
