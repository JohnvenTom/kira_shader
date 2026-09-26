#!/usr/bin/env node
/**
 * CDP 交互驱动工具（复用常驻 headless chrome，端口 9222）
 *
 * 用法：
 *   node scripts/ab.mjs goto <url>          # 导航
 *   node scripts/ab.mjs reload              # 强制刷新（绕过 stale bundle）
 *   node scripts/ab.mjs eval "<js>"         # 页面内执行 JS，打印结果
 *   node scripts/ab.mjs shot <name.png>     # 截图到 screenshots/
 *   node scripts/ab.mjs mouse move|down|up <x> <y>   # 分步鼠标事件
 *   node scripts/ab.mjs click <x> <y>       # 完整点击（down+up）
 *   node scripts/ab.mjs wheel <dx> <dy>     # 滚轮
 *   node scripts/ab.mjs wait <ms>           # 等待
 *   node scripts/ab.mjs waitfor "<js 条件>" # 轮询等待条件成立（最多 10s）
 *   node scripts/ab.mjs burst <n> <intervalMs> <prefix>  # 单连接内连拍 n 帧
 *   node scripts/ab.mjs burst-click <x> <y> <n> <intervalMs> <prefix>  # 点击后立即连拍
 *
 * 注意：finally 用 process.exit() 断开 websocket，保留常驻浏览器进程。
 */
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const [, , cmd, ...args] = process.argv;
const CDP_URL = 'http://localhost:9222';

const browser = await chromium.connectOverCDP(CDP_URL);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = ctx.pages()[0] ?? (await ctx.newPage());

/** 连拍：可选先执行点击动作，然后循环截图（时间戳标注每帧相对时刻） */
async function runBurst(count, interval, prefix, action) {
  const iv = Math.max(interval, 30);
  if (action?.click) await page.mouse.click(action.click[0], action.click[1]);
  const shots = [];
  const t0 = Date.now();
  for (let i = 0; i < count; i++) {
    const p = `screenshots/${prefix}-${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: p });
    shots.push(`${p} @${Date.now() - t0}ms`);
    if (i < count - 1) await page.waitForTimeout(iv);
  }
  console.log('burst done:\n' + shots.join('\n'));
}

// 转发 console 错误，便于发现 shader/运行时异常
page.on('console', m => {
  if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300));
});
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

try {
  switch (cmd) {
    case 'goto':
      await page.goto(args[0], { waitUntil: 'load', timeout: 30000 });
      console.log('goto ok:', page.url());
      break;
    case 'reload':
      await page.reload({ waitUntil: 'load', timeout: 30000 });
      console.log('reload ok:', page.url());
      break;
    case 'eval': {
      const r = await page.evaluate(args[0]);
      console.log(typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r));
      break;
    }
    case 'shot': {
      const p = `screenshots/${args[0]}`;
      await page.screenshot({ path: p });
      console.log('shot saved:', p);
      break;
    }
    case 'mouse': {
      const [act, x, y] = args;
      if (act === 'move') await page.mouse.move(+x, +y);
      else if (act === 'down') await page.mouse.down();
      else if (act === 'up') await page.mouse.up();
      else throw new Error(`unknown mouse action: ${act}`);
      console.log(`mouse ${act} ${x ?? ''} ${y ?? ''} ok`);
      break;
    }
    case 'click':
      await page.mouse.click(+args[0], +args[1]);
      console.log(`click ${args[0]},${args[1]} ok`);
      break;
    case 'wheel':
      await page.mouse.wheel(+args[0], +args[1]);
      console.log(`wheel ${args[0]},${args[1]} ok`);
      break;
    case 'wait':
      await page.waitForTimeout(+args[0]);
      console.log(`waited ${args[0]}ms`);
      break;
    case 'waitfor': {
      await page.waitForFunction(args[0], { timeout: 10000 });
      console.log('condition met');
      break;
    }
    case 'burst': {
      const [n, interval, prefix] = args;
      await runBurst(+n, +interval, prefix, null);
      break;
    }
    case 'burst-click': {
      // 点击后立即连拍（同一连接，捕捉 1s 内的转场中间帧）
      const [x, y, n, interval, prefix] = args;
      await runBurst(+n, +interval, prefix, { click: [+x, +y] });
      break;
    }
    default:
      console.log('unknown command:', cmd);
      process.exit(1);
  }
} finally {
  browser.close().catch(() => {});
  process.exit(0);
}
