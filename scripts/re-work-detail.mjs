#!/usr/bin/env node
/**
 * RE pass 2：聚焦探针 —— /work/select-concept 详情页深挖
 *
 * 取证目标：
 *   1. boot 完成后页面真容 + DOM 普查（img/video/canvas 数量、媒体面板结构）
 *   2. demo canvas 在滚动各深度的 rect（是否固定/是否全幅接管）
 *   3. Close 点击的转场 burst + 落点 URL
 *
 * 运行：env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY node scripts/re-work-detail.mjs
 */
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const CDP = 'http://localhost:9222';
const OUT = 'screenshots/re-work';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

const P = 're2-select';
console.log('== goto select-concept ==');
await page.goto('https://www.shader.se/work/select-concept', { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(13000); // 等 boot 走完（SwiftShader 下 ~10s）
await page.screenshot({ path: `${OUT}/${P}-booted.png` });

console.log('== DOM 普查 ==');
const census = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')].slice(0, 14).map((im) => ({
    src: (im.currentSrc || im.src || '').slice(0, 110),
    rect: (() => { const b = im.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(),
    cls: String(im.className).slice(0, 50),
  }));
  const canvases = [...document.querySelectorAll('canvas')].map((c) => ({
    w: c.width, h: c.height,
    rect: (() => { const b = c.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(),
    cls: String(c.className).slice(0, 60),
    parentCls: String(c.parentElement?.className).slice(0, 60),
  }));
  const sc = document.querySelector('div.fixed.inset-0');
  // 媒体面板候选：滚动容器里的直接结构性子树
  const sections = [...(sc?.querySelectorAll('section, [class*=media], [class*=panel], [class*=slide]') || [])].slice(0, 12).map((el) => ({
    tag: el.tagName, cls: String(el.className).slice(0, 70),
    rect: (() => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(),
  }));
  return {
    imgs: { count: document.querySelectorAll('img').length, first: imgs },
    videos: document.querySelectorAll('video').length,
    canvases,
    sections,
    scrollH: sc?.scrollHeight,
    bootText: document.body.innerText.includes('Version 1.02'),
  };
});
console.log(JSON.stringify(census, null, 1).slice(0, 3500));

console.log('== 滚动深度 × canvas rect ==');
for (const frac of [0.15, 0.35, 0.55, 0.75]) {
  await page.evaluate((f) => {
    const sc = document.querySelector('div.fixed.inset-0');
    if (sc) sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * f;
  }, frac);
  await page.waitForTimeout(1400);
  const probe = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const b = c?.getBoundingClientRect();
    const sc = document.querySelector('div.fixed.inset-0');
    return { canvas: b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null, scrollTop: Math.round(sc?.scrollTop ?? -1) };
  });
  await page.screenshot({ path: `${OUT}/${P}-s${Math.round(frac * 100)}.png` });
  console.log(`frac=${frac} scrollTop=${probe.scrollTop} canvas=${JSON.stringify(probe.canvas)}`);
}

console.log('== 回顶 + Close burst ==');
await page.evaluate(() => {
  const sc = document.querySelector('div.fixed.inset-0');
  if (sc) sc.scrollTop = 0;
});
await page.waitForTimeout(1500);
const bursts = [];
for (let i = 0; i < 6; i++) {
  const p = `${OUT}/${P}-close-${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: p });
  bursts.push(p);
  if (i === 1) await page.mouse.click(1529, 77); // 第 2 帧后点 Close（坐标取自 ehealth 实测）
  await page.waitForTimeout(400);
}
await page.waitForTimeout(2200);
console.log('close 后 URL:', page.url());
await page.screenshot({ path: `${OUT}/${P}-after-close.png` });
console.log('DONE');
process.exit(0);
