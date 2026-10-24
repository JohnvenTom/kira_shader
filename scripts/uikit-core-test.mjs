#!/usr/bin/env node
// M2 回归测试：生产版 uikit 核心布局不变量。
// 断言依据：decompiled 样式表（glossary §3/§4）+ 原站 1600×1200 截图像素实测
// （_bundles/origin-footer-1600x1200.png：cert 232 / copyright 384 / a11y 232 → xl min-width 语义生效）。
// 原站静态注册值 3.3238571052836656 为未知视口遗留产物，不作硬断言；真验收 = M5 同视口帧序列对照。
// 用法: node --experimental-strip-types scripts/uikit-core-test.mjs
import { readFileSync } from 'fs';
import { parseBMFont } from '../src/uikit/font.ts';
import { buildContactContentColumn, CONTACT_LENGTH_STATIC } from '../src/uikit/contactColumn.ts';

const F = {};
for (const [key, file] of [['regular', 'stix_regular'], ['medium', 'stix_medium'], ['bold', 'stix_bold']]) {
  F[key] = parseBMFont(JSON.parse(readFileSync(new URL(`../public/fonts/${file}.json`, import.meta.url), 'utf8')));
}

let failed = false;
const expect = (name, got, want, tol = 0.5) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed = true;
  console.log(`${name}: got=${got.toFixed(1)} want=${want} ${ok ? 'PASS' : 'FAIL'}`);
};
for (const [W, H] of [[1600, 1200], [1440, 900], [1920, 1080]]) {
  const { contentCol, helloBlock } = buildContactContentColumn(F, W, H);
  contentCol.calculateLayout(W);
  const h = contentCol.getComputedHeight();
  const d = h / H;
  console.log(`--- ${W}x${H}: h=${h.toFixed(1)}px d=${d.toFixed(6)} (static registry ${CONTACT_LENGTH_STATIC}, delta ${(((d - CONTACT_LENGTH_STATIC) / CONTACT_LENGTH_STATIC) * 100).toFixed(2)}% 参考)`);
  if (W === 1600) {
    expect('helloBlock', helloBlock.getComputedHeight(), 2580); // pt1200+行高240+spacer1140
    const goodbuy = contentCol.children[1];
    const [gbWrap, footer] = goodbuy.children;
    expect('footer(xl)', footer.getComputedHeight(), 379.2); // 1 + 96*2 + max(186.2, 89.3, 65.6)
    const blackBox = gbWrap.children[1];
    expect('ci', blackBox.children[0].getComputedHeight(), 690.4); // 60+86.4+(40+224)+(80+200)
  }
}
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);

