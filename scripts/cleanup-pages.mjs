#!/usr/bin/env node
// 清理 CDP 浏览器里所有旧 page，只保留一个干净的 about:blank
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const pages = ctx.pages();
console.log('found pages:', pages.length);
for (const p of pages) {
  const url = p.url();
  if (url === 'about:blank') continue;
  console.log('closing:', url.slice(0, 80));
  await p.close().catch((e) => console.log('  close failed:', String(e).slice(0, 100)));
}
console.log('remaining:', ctx.pages().map((p) => p.url().slice(0, 60)));
process.exit(0);
