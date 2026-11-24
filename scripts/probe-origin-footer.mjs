#!/usr/bin/env node
// 实证原站 xl 断点语义：滚到 contact 底部截图，量 footer 证书图宽度（xl=232 vs lg=160）
// 用法: node scripts/probe-origin-footer.mjs [W] [H]
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const W = Number(process.argv[2] || 1600);
const H = Number(process.argv[3] || 1200);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.setViewportSize({ width: W, height: H });
await page.goto('https://www.shader.se/', { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(8000);
// 虚拟滚动：连发滚轮推进（约 0.78 屏/格 × ~30 格到底）
for (let i = 0; i < 45; i++) {
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(2500);
await page.screenshot({ path: `E:/GIthub_Project/My_Shader/kira_shader/_bundles/origin-footer-${W}x${H}.png` });
console.log('saved _bundles/origin-footer-' + W + 'x' + H + '.png');
await browser.close();
