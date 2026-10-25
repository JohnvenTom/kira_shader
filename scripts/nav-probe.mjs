#!/usr/bin/env node
// 原站导航实测：navbar 截图 → 汉堡菜单展开连拍 → 点 Contact 抓跨段转场 → 验证 hash/滚动位
// 用法：node scripts/nav-probe.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const out = (n) => `screenshots/nav-${n}.png`;
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.setViewportSize({ width: 900, height: 700 });
await page.goto('https://www.shader.se/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(16000);

// 1) hero 段 navbar（视口 900 → <1024 汉堡模式）
await page.screenshot({ path: out('1-hero-desktop') });
console.log('hash-after-load:', await page.evaluate('location.hash || "(empty)"'));

// 2) 滚到中部看 navbar 是否还在（读 scrollY + 截图）
await page.evaluate('window.scrollTo(0, window.innerHeight * 2.5)');
await page.waitForTimeout(1500);
console.log('scrollY-after-2.5vh:', await page.evaluate('Math.round(window.scrollY)'));

// 3) 回顶，点汉堡菜单（右上 64×64 容器中心 ≈ (900-32, 38)）
await page.evaluate('window.scrollTo(0, 0)');
await page.waitForTimeout(1200);
await page.mouse.click(900 - 32, 38);
await page.waitForTimeout(500);
await page.screenshot({ path: out('2-menu-open') });

// 4) 点菜单里的 Contact（面板 top60 right8 width200，第4项中心 y≈60+3.5*58≈263，x≈900-108）
const hashBefore = await page.evaluate('location.hash || "(empty)"');
await page.mouse.click(900 - 108, 263);
// 转场连拍：0.35s / 0.8s / 1.6s
await page.waitForTimeout(350);
await page.screenshot({ path: out('3-transition-early') });
await page.waitForTimeout(450);
await page.screenshot({ path: out('4-transition-mid') });
await page.waitForTimeout(1200);
await page.screenshot({ path: out('5-transition-done') });
console.log('hash-before-click:', hashBefore);
console.log('hash-after-contact:', await page.evaluate('location.hash || "(empty)"'));
console.log('scrollY-after-contact:', await page.evaluate('Math.round(window.scrollY)'));

// 5) 菜单再开一次，点 Home 验证回跳
await page.mouse.click(900 - 32, 38);
await page.waitForTimeout(500);
await page.screenshot({ path: out('6-menu-open-2') });
await page.mouse.click(900 - 108, 60 + 0.5 * 58);
await page.waitForTimeout(1900);
console.log('hash-after-home:', await page.evaluate('location.hash || "(empty)"'));
console.log('scrollY-after-home:', await page.evaluate('Math.round(window.scrollY)'));
await page.screenshot({ path: out('7-back-home') });
await page.close();
process.exit(0);
