#!/usr/bin/env node
// 原站导航实测 v2：校准汉堡坐标 + 分步点击 + hash 直跳分支
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

// 1) 网格扫描点右上角（找汉堡按钮的实际热区）：先试 (868,57)
await page.mouse.move(868, 57);
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: out('v2-1-after-click') });
console.log('after click1 hash:', await page.evaluate('location.hash || "(empty)"'));

// 2) 若菜单已开（截图判断），点 Contact（面板 top60 right8 width200 第4项）
await page.mouse.click(900 - 108, 263);
await page.waitForTimeout(400);
await page.screenshot({ path: out('v2-2-transition-early') });
await page.waitForTimeout(600);
await page.screenshot({ path: out('v2-3-transition-mid') });
await page.waitForTimeout(1300);
await page.screenshot({ path: out('v2-4-transition-done') });
console.log('after contact hash:', await page.evaluate('location.hash || "(empty)"'));
await page.waitForTimeout(1000);
await page.screenshot({ path: out('v2-5-contact-page') });

// 3) hash 直跳分支：直接改 URL 到 #about-us（history.replaceState + hashchange 不触发 Next 路由，
//    所以用 link 导航语义 —— goto 相同页只改 hash 会触发 hashchange；Next router 监听）
await page.evaluate(`window.location.hash = 'about-us'`);
await page.waitForTimeout(2500);
await page.screenshot({ path: out('v2-6-hash-aboutus') });
console.log('after hash-set:', await page.evaluate('location.hash'), 'scrollY:', await page.evaluate('Math.round(window.scrollY)'));

// 4) 点 logo（左上 ~ (80, 30)）回 hero
await page.mouse.click(80, 30);
await page.waitForTimeout(1900);
await page.screenshot({ path: out('v2-7-after-logo') });
console.log('after logo hash:', await page.evaluate('location.hash || "(empty)"'));
await page.close();
process.exit(0);
