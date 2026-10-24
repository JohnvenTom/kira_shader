#!/usr/bin/env node
// 原站运行时反编译（three r180+ DevTools observe 协议）：
// 'observe' 事件的 detail 是活的对象引用 → 捕获 scene/camera/全部节点 → 轮询读滚动曲线
// 用法: node scripts/dump-contact-runtime.mjs [outPrefix] [stepPx] [steps] [dwellMs]
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import { mkdirSync, writeFileSync } from 'fs';

const prefix = process.argv[2] || 'rt';
const step = process.argv[3] ? Number(process.argv[3]) : 746;
const steps = process.argv[4] ? Number(process.argv[4]) : 6;
const dwell = process.argv[5] ? Number(process.argv[5]) : 2200;
const URL_TO_TEST = 'https://www.shader.se/#contact';

const INIT = `
window.__th = { scene: null, cameras: [], objs: new Map(), n: 0, proto: [] };
window.__THREE_DEVTOOLS__ = new EventTarget();
// 新协议：方法调用（register({revision}) / observe(obj)）
for (const m of ['register', 'observe', 'unobserve', 'setViewport', 'reportError']) {
  window.__THREE_DEVTOOLS__[m] = (arg) => {
    try { window.__th.proto.push({ m, ctor: arg && arg.constructor ? arg.constructor.name : '-', keys: arg && arg.isObject3D ? 'Object3D' : arg ? Object.keys(arg).slice(0, 10).join(',') : String(arg).slice(0, 20) }); } catch (_) {}
    if (m === 'observe' && arg && arg.isObject3D) {
      if (!window.__th.objs.has(arg.uuid)) { window.__th.objs.set(arg.uuid, arg); window.__th.n++; }
      if (arg.isScene && !window.__th.scene) window.__th.scene = arg;
      if (arg.isPerspectiveCamera) window.__th.cameras.push(arg);
    }
  };
}
// 旧协议：事件（兼容）
window.__THREE_DEVTOOLS__.addEventListener('observe', (e) => {
  const o = e.detail;
  if (!o || !o.isObject3D || window.__th.objs.has(o.uuid)) return;
  window.__th.objs.set(o.uuid, o);
  window.__th.n++;
  if (o.isScene && !window.__th.scene) window.__th.scene = o;
  if (o.isPerspectiveCamera) window.__th.cameras.push(o);
});
`;

const DUMP = `(() => {
  const th = window.__th;
  if (!th.scene) return { err: 'no scene', n: th.n };
  const V = Object.getPrototypeOf(th.cameras[0].position).constructor;
  const cams = th.cameras.map((c, i) => ({
    i, type: c.type,
    pos: c.position.toArray().map(v => +v.toFixed(3)),
    fov: c.fov,
    visibleChain: (() => { let p = c.parent, v = c.visible; while (p) { v = v && p.visible; p = p.parent; } return v; })(),
  }));
  const walk = (o, depth, out) => {
    if (depth > 6 || out.length > 500) return;
    out.push({
      n: o.name || '', t: o.type,
      p: o.position.toArray().map(v => +v.toFixed(3)),
      s: o.scale.toArray().map(v => +v.toFixed(3)),
      light: o.isLight ? { kind: o.type, color: '#' + o.color.getHexString(), intensity: +o.intensity.toFixed(2), dist: o.distance || 0 } : undefined,
    });
    for (const c of o.children) walk(c, depth + 1, out);
  };
  const nodes = [];
  walk(th.scene, 0, nodes);
  return {
    scrollY: window.scrollY,
    total: th.n,
    cams,
    nodes,
  };
})()`;

mkdirSync('_bundles/runtime', { recursive: true });
const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0] ?? (await browser.newContext());
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
console.log('[goto]', URL_TO_TEST);
await page.goto(URL_TO_TEST, { waitUntil: 'load', timeout: 40000 }).catch((e) => console.log('[goto fail]', String(e).slice(0, 150)));
await page.waitForTimeout(16000);

const frame0 = await page.evaluate(DUMP).catch((e) => String(e).slice(0, 500));
writeFileSync(`_bundles/runtime/${prefix}-s0.json`, JSON.stringify(frame0, null, 1));
console.log('[s0]', JSON.stringify({ cams: frame0.cams, total: frame0.total, nodes: frame0.nodes ? frame0.nodes.length : 0 }));

for (let i = 1; i <= steps; i++) {
  await page.mouse.wheel(0, step);
  await page.waitForTimeout(dwell);
  const d = await page.evaluate(DUMP).catch((e) => String(e).slice(0, 500));
  writeFileSync(`_bundles/runtime/${prefix}-s${i}.json`, JSON.stringify(d, null, 1));
  console.log(`[s${i}]`, JSON.stringify({ cams: d.cams, scroll: d.scrollY }));
}
await page.close().catch(() => {});
console.log('done');
