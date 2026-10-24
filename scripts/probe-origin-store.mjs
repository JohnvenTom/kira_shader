#!/usr/bin/env node
// 原站运行时页长取证：走 React fiber 钩子链找 usePagesStore 的 pages MotionValue，
// 读 contact 页运行时 length（uN 测量链在 mount 时会覆盖静态注册值）。
// 用法: node scripts/probe-origin-store.mjs [W H]  （需 9222 headless chrome）
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const W = Number(process.argv[2] ?? 1440);
const H = Number(process.argv[3] ?? 900);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0] ?? (await browser.newContext());
let page = ctx.pages()[0] ?? (await ctx.newPage());
await page.setViewportSize({ width: W, height: H });

await page.goto(`https://shader.se/#contact`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

const result = await page.evaluate(
  () => {
    const out = { store: null, activePage: null, datasets: {}, globals: [], errors: [] };
    // 1) 找 fiber 入口
    let startFiber = null;
    for (const el of document.querySelectorAll('*')) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      if (k) {
        startFiber = el[k];
        break;
      }
    }
    if (!startFiber) return { ...out, errors: ['no react fiber'] };

    const seen = new Set();
    const pagesFound = [];
    const scrollLike = [];
    const snapPointsFound = [];
    const progressLike = [];
    function checkValue(v, depth) {
      if (v == null || typeof v !== 'object' || depth > 3) return;
      try {
        if (typeof v.get === 'function' && v.get.length === 0) {
          const val = v.get();
          if (
            Array.isArray(val) &&
            val.length > 0 &&
            val.every((p) => p && typeof p.id === 'string' && typeof p.length === 'number')
          ) {
            pagesFound.push(
              val.map((p) => ({
                id: p.id,
                length: p.length,
                range: p.range ? { start: p.range.start, end: p.range.end } : null,
                pageOffset: p.pageOffset ?? null,
              })),
            );
          } else if (typeof val === 'string' && /^(hero|work|about|contact|film)$/.test(val)) {
            if (out.activePage == null) out.activePage = val;
          } else if (typeof val === 'number' && val > 1.5 && val < 40) {
            scrollLike.push(+val.toFixed(4));
          } else if (typeof val === 'number' && val > 0 && val < 1.0001) {
            progressLike.push(+val.toFixed(5));
          }
        }
        // snapPoints 形状：{ position:number, range:{forward:{multiplier,range},backward:{...}} }
        if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0].position === 'number' && v[0].range) {
          snapPointsFound.push(
            v.map((s) => ({
              position: s.position,
              forward: s.range.forward ? { mult: s.range.forward.multiplier, range: s.range.forward.range } : null,
              backward: s.range.backward ? { mult: s.range.backward.multiplier, range: s.range.backward.range } : null,
            })),
          );
        }
      } catch (e) {
        /* ignore */
      }
    }
    function walk(fiber, depth) {
      if (!fiber || depth > 80 || seen.has(fiber)) return;
      seen.add(fiber);
      // hooks 链
      let hook = fiber.memoizedState;
      let hi = 0;
      while (hook && hi < 120) {
        checkValue(hook.memoizedState, 0);
        // useRef/useMemo 包一层
        const mv = hook.memoizedState;
        if (mv && typeof mv === 'object' && 'current' in mv) checkValue(mv.current, 1);
        hook = hook.next;
        hi++;
      }
      // props 里的 pages / MotionValue
      const props = fiber.memoizedProps;
      if (props && typeof props === 'object') {
        for (const key of Object.keys(props).slice(0, 40)) {
          const pv = props[key];
          if (pv && typeof pv === 'object') {
            if (Array.isArray(pv) && pv.length && pv[0] && typeof pv[0]?.id === 'string' && typeof pv[0]?.length === 'number') {
              pagesFound.push(pv.map((p) => ({ id: p.id, length: p.length })));
            } else if (typeof pv.get === 'function') {
              checkValue(pv, 0);
            }
          }
        }
      }
      walk(fiber.child, depth + 1);
      walk(fiber.sibling, depth + 1);
    }
    walk(startFiber, 0);
    out.store = pagesFound[0] ?? null;
    out.storeCount = pagesFound.length;
    out.scrollLike = scrollLike.slice(0, 12);
    out.snapPoints = snapPointsFound[0] ?? null;
    out.snapPointsCount = snapPointsFound.length;
    out.progressLike = progressLike.slice(0, 20);
    // 2) dataset / css 变量
    out.datasets = { body: { ...document.body.dataset }, html: { ...document.documentElement.dataset } };
    const bs = getComputedStyle(document.body);
    const hs = getComputedStyle(document.documentElement);
    out.cssVars = {};
    for (const [name, style] of [
      ['body', bs],
      ['html', hs],
    ]) {
      for (const prop of style) {
        if (prop.startsWith('--')) out.cssVars[`${name}:${prop}`] = style.getPropertyValue(prop).trim().slice(0, 40);
      }
    }
    out.scrollY = window.scrollY;
    out.viewport = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio };
    return out;
  },
  undefined,
  { timeout: 30000 },
);

console.log(JSON.stringify(result, null, 1));
await browser.close();
process.exit(0);
