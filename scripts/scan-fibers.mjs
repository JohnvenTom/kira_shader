#!/usr/bin/env node
// v3：全 fiber 树广扫 THREE 实例（isScene/isPerspectiveCamera/isObject3D）
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import { writeFileSync } from 'fs';

const URL_TO_TEST = 'https://www.shader.se/#contact';

const SCAN = `(() => {
  const out = { fibers: 0, scenes: [], cams: [], objs: 0, hitPaths: [] };
  const seen = new Set();
  const isObj = (o) => o && (o.isScene || o.isPerspectiveCamera || o.isOrthographicCamera || o.isObject3D);
  // 深挖一个 JS 值：返回其中的 THREE 对象集合（限深防炸）
  const dig = (val, path, depth, sink) => {
    if (depth > 5 || sink.length > 200) return;
    if (isObj(val)) { sink.push({ path, uuid: val.uuid, name: val.name, type: val.type }); return; }
    if (!val || typeof val !== 'object' && typeof val !== 'function') return;
    if (val.$$typeof || val._reactInternals) { /* react 对象继续 */ }
    try {
      for (const k of Object.keys(val)) {
        if (k === 'return' || k === 'child' || k === 'sibling' || k === 'alternate' || k === 'stateNode' && !isObj(val[k])) { /* fiber 链由调用方控制 */ }
        try { dig(val[k], path + '.' + k, depth + 1, sink); } catch (_) {}
      }
    } catch (_) {}
  };
  const checkFiber = (f) => {
    if (!f || seen.has(f)) return;
    seen.add(f); out.fibers++;
    if (out.fibers > 60000) return;
    // memoizedState 链
    let h = f.memoizedState, n = 0;
    while (h && n < 60) {
      const sink = [];
      try { dig(h.memoizedState, f.type && (f.type.name || 'anon') + '#h' + n, 0, sink); } catch (_) {}
      for (const s of sink) {
        if (s.type === 'Scene') out.scenes.push(s);
        else if (s.type === 'PerspectiveCamera') out.cams.push(s);
      }
      h = h.next; n++;
    }
    // memoizedProps
    try {
      const sink2 = [];
      dig(f.memoizedProps, (f.type && (f.type.name || 'anon')) + '#props', 1, sink2);
      for (const s of sink2) {
        if (s.type === 'Scene') out.scenes.push(s);
        else if (s.type === 'PerspectiveCamera') out.cams.push(s);
      }
    } catch (_) {}
  };
  // 所有 canvas + 所有 DOM 元素的 fiber
  const roots = [];
  for (const el of document.querySelectorAll('*')) {
    for (const k of Object.keys(el)) {
      if (k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')) {
        roots.push(el[k]);
        break;
      }
    }
  }
  // BFS 全 fiber 树
  const queue = roots.slice();
  while (queue.length && out.fibers < 60000) {
    const f = queue.shift();
    checkFiber(f);
    if (f) { if (f.child) queue.push(f.child); if (f.sibling) queue.push(f.sibling); if (f.alternate) queue.push(f.alternate); }
  }
  return { fibers: out.fibers, scenes: out.scenes.slice(0, 10), cams: out.cams.slice(0, 10), objs: out.objs };
})()`;

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 40000 }).catch((e) => console.log('[goto fail]', String(e).slice(0, 150)));
await page.waitForTimeout(16000);
const res = await page.evaluate(SCAN).catch((e) => String(e).slice(0, 500));
writeFileSync(`_bundles/runtime/fiberscan.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res).slice(0, 900));
await page.close().catch(() => {});
console.log('done');
