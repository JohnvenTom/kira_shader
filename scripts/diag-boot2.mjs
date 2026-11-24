/**
 * boot 黑屏诊断（临时）：新开页面收集 console/pageerror/requestfailed + boot 事件。
 * 用法：node scripts/diag-boot2.mjs [url]
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js');

const url = process.argv[2] ?? 'http://localhost:5173/#hero';
const vw = +(process.argv[3] ?? 900);
const vh = +(process.argv[4] ?? 700);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = await context.newPage();

page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') console.log(`[console.${t}]`, m.text().slice(0, 300));
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e?.stack || e).slice(0, 900)));
page.on('requestfailed', (r) => console.log('[requestfailed]', r.url().slice(-90), r.failure()?.errorText));

await page.setViewportSize({ width: vw, height: vh });
const rvw = +(process.argv[5] ?? 0);
const rvh = +(process.argv[6] ?? 0);
try {
  await page.goto(url, { timeout: 30000 });
} catch (e) {
  console.log('[goto failed]', String(e).slice(0, 200));
}
await page.waitForTimeout(12000);
if (rvw > 0) {
  await page.setViewportSize({ width: rvw, height: rvh });
  await page.waitForTimeout(2500);
  console.log('[resized to]', rvw, rvh);
}
// ?clickNav=1：点击 About Us 导航项（1600 视口 lg 布局 x=883,y=56），连拍转场
if (process.argv[5] === 'clickNav') {
  await page.waitForTimeout(1500);
  console.log('[click navAbout]');
  await page.mouse.click(883, 56);
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `screenshots/p2s-nav-${i}.png` });
    console.log('[burst]', i);
  }
}

const state = await page.evaluate(async () => {
  const out = { bootlog: window.__bootlog ?? null };
  try {
    const m = await import('/src/boot/bootStore.ts');
    out.phase = m.bootStore.phase;
    out.ap = +m.bootStore.assetProgress.toFixed(3);
    out.springDone = m.bootStore.springDone;
  } catch (e) {
    out.storeErr = String(e).slice(0, 120);
  }
  out.hero = !!window.__hero;
  out.nav = !!window.__nav;
  out.ready = null;
  return out;
});
console.log('[state]', JSON.stringify(state));
await page.screenshot({ path: 'screenshots/diag-final.png' });
console.log('[shot] screenshots/diag-final.png');
await page.close();
await browser.close();
