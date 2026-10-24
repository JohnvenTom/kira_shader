#!/usr/bin/env node
// 量原站运行时页长：scrollHeight/innerHeight + 视口信息
// 用法: node scripts/measure-origin.mjs
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto('https://www.shader.se/', { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(9000); // 等 boot + 字体 + 布局
const info = await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const de = document.documentElement;
  return {
    innerW: innerWidth,
    innerH: innerHeight,
    scrollH: de.scrollHeight,
    bodyScrollH: document.body.scrollHeight,
    ratio: de.scrollHeight / innerHeight,
    hash: location.hash,
  };
});
console.log(JSON.stringify(info, null, 2));
// 滚到 contact 段再量一次（触发可能的重测量）
const staticSum = 1 + 1 + 1.8 + 7.3367496785380295 + 1.7 + 6;
console.log('static sum(all)=22.160606783821695, sum(before contact)=', staticSum);
console.log('derived contact d =', info.ratio - staticSum);
await browser.close();
