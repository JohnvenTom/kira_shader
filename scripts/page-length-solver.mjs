#!/usr/bin/env node
// 反解原站静态页长注册值 3.3238571052836656 对应的视口：
// 若存在 (W,H) 使本地 contactColumn 树的 d 精确命中 → 树 1:1 且确定原站构建视口；
// 若无 → 输出各常见视口的 d 偏差表（定位树的系统性偏差）。
// 用法: node --experimental-strip-types scripts/page-length-solver.mjs
import { readFileSync } from 'fs';
import { parseBMFont } from '../src/uikit/font.ts';
import { buildContactContentColumn, CONTACT_LENGTH_STATIC } from '../src/uikit/contactColumn.ts';

const F = {};
for (const [key, file] of [['regular', 'stix_regular'], ['medium', 'stix_medium'], ['bold', 'stix_bold']]) {
  F[key] = parseBMFont(JSON.parse(readFileSync(new URL(`../public/fonts/${file}.json`, import.meta.url), 'utf8')));
}

const dOf = (W, H) => {
  const { contentCol } = buildContactContentColumn(F, W, H);
  contentCol.calculateLayout(W);
  return contentCol.getComputedHeight() / H;
};

// 常见桌面视口
const COMMON = [
  [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1512, 982], [1536, 864],
  [1600, 900], [1600, 1200], [1680, 1050], [1728, 1117], [1920, 1080], [1920, 1200],
  [2048, 1152], [2560, 1440], [3440, 1440], [3840, 2160],
];

console.log('--- 常见视口的 d ---');
let best = null;
for (const [W, H] of COMMON) {
  const d = dOf(W, H);
  const delta = ((d - CONTACT_LENGTH_STATIC) / CONTACT_LENGTH_STATIC) * 100;
  if (best == null || Math.abs(d - CONTACT_LENGTH_STATIC) < Math.abs(best.d - CONTACT_LENGTH_STATIC)) best = { W, H, d };
  console.log(`${W}x${H}: d=${d.toFixed(6)} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%)`);
}

// 精扫：H 固定若干档，扫 W 500..2560 找 |d-static| < 1e-9
console.log('\n--- 精扫（H 步 10 × W 步 10，容差 1e-6）---');
const hits = [];
for (let H = 480; H <= 1600; H += 10) {
  for (let W = 500; W <= 2560; W += 10) {
    const d = dOf(W, H);
    if (Math.abs(d - CONTACT_LENGTH_STATIC) < 1e-6) hits.push({ W, H, d });
  }
}
if (hits.length === 0) {
  // 放宽容差再扫一遍记录最小偏差
  let min = null;
  for (let H = 480; H <= 1600; H += 20) {
    for (let W = 500; W <= 2560; W += 20) {
      const d = dOf(W, H);
      const e = Math.abs(d - CONTACT_LENGTH_STATIC);
      if (min == null || e < min.e) min = { W, H, d, e };
    }
  }
  console.log('无精确命中。全网格最小偏差:', JSON.stringify(min));
  console.log('对应偏差 %:', ((min.d - CONTACT_LENGTH_STATIC) / CONTACT_LENGTH_STATIC * 100).toFixed(4));
} else {
  console.log('命中:', JSON.stringify(hits.slice(0, 20), null, 1));
}
console.log('\n最接近注册值的常见视口:', JSON.stringify(best), '偏差 %:', ((best.d - CONTACT_LENGTH_STATIC) / CONTACT_LENGTH_STATIC * 100).toFixed(2));
