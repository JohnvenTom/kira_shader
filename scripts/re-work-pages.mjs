#!/usr/bin/env node
/**
 * RE pass：批量取证 shader.se /work/<slug> 详情页（11 页）
 *
 * 产出：
 *   screenshots/re-work/<slug>-{0,1,2}.png   顶/中/底三屏截图
 *   screenshots/re-work/report.json          每页 DOM/RSC 事实
 *   screenshots/re-work/rsc-projects.json    RSC payload 的 projects 全量数据
 *
 * 运行（必须清掉代理环境变量，否则 CDP 连 localhost:9222 被劫持 502）：
 *   env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY node scripts/re-work-pages.mjs
 *
 * 注意：Chrome headless 连续开 11 个重 WebGL 页可能衰败（SwiftShader 资源耗尽），
 * 每页 try/catch 继续跑完；若截图大面积空白需重启 chrome 后对失败 slug 重跑。
 */
import { chromium } from 'file:///C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const CDP = 'http://localhost:9222';
const ORIGIN = 'https://www.shader.se';
const SLUGS = process.argv[2]
  ? process.argv[2].split(',')
  : [
      'ehealth-arena', 'select-concept', 'gamily', 'alamance-foods', 'son',
      'glasbolaget', 'spp-dream-generator', 'ica-nissen', 'norrkopings-hamn',
      'heip', 'design-is-funny',
    ];
const OUT = 'screenshots/re-work';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

/** 从当前页 HTML 里抠出 RSC payload 的 projects 数组（每页都带全量 11 项目） */
async function extractRscProjects() {
  const html = await page.content();
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs)].map((m) => m[1]);
  const payload = chunks.map((c) => c.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"').replace(/\\\\/g, '\\')).join('');
  const i = payload.indexOf('{"projects":[');
  if (i < 0) return null;
  // 从 {"projects":[ 开始做括号配平
  let depth = 0, end = -1;
  for (let j = i; j < payload.length; j++) {
    if (payload[j] === '{') depth++;
    else if (payload[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(payload.slice(i, end)); } catch { return null; }
}

const report = fs.existsSync(`${OUT}/report.json`)
  ? JSON.parse(fs.readFileSync(`${OUT}/report.json`, 'utf-8'))
  : {};
let rscSaved = fs.existsSync(`${OUT}/rsc-projects.json`);

for (const slug of SLUGS) {
  const r = { slug };
  try {
    await page.goto(`${ORIGIN}/work/${slug}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(13000); // boot 在 SwiftShader 下 ~10s，13s 稳过
    await page.screenshot({ path: `${OUT}/${slug}-0.png` });

    const facts = await page.evaluate(() => {
      const sc = document.querySelector('div.fixed.inset-0');
      const canvases = [...document.querySelectorAll('canvas')].map((c) => ({
        w: c.width, h: c.height,
        rect: (() => { const b = c.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(),
        cls: String(c.className).slice(0, 60),
      }));
      return {
        title: document.title,
        scrollH: sc ? sc.scrollHeight : null,
        text: sc ? sc.innerText.slice(0, 1200) : document.body.innerText.slice(0, 600),
        links: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter(Boolean).slice(0, 12),
        canvases,
        videos: document.querySelectorAll('video').length,
      };
    });
    Object.assign(r, facts);

    // 滚到中/底各截一屏，并统计懒加载后的 video 数
    for (const [i, frac] of [0.5, 1.0].entries()) {
      await page.evaluate((f) => {
        const sc = document.querySelector('div.fixed.inset-0');
        if (sc) sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * f;
      }, frac);
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${OUT}/${slug}-${i + 1}.png` });
    }
    r.videosAfterScroll = await page.evaluate(() => document.querySelectorAll('video').length);

    // 第一页顺手把 RSC projects 全量数据存下来
    if (!rscSaved) {
      const rsc = await extractRscProjects();
      if (rsc) {
        fs.writeFileSync(`${OUT}/rsc-projects.json`, JSON.stringify(rsc, null, 2));
        rscSaved = true;
        r.rscProjectsSaved = true;
      }
    }
  } catch (e) {
    r.error = String(e).slice(0, 300);
  }
  report[slug] = r;
  console.log(`[${slug}] ` + JSON.stringify({ scrollH: r.scrollH, canvases: r.canvases?.length, videos: r.videos, videosAfterScroll: r.videosAfterScroll, error: r.error ?? null }));
}

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('DONE rscSaved=' + rscSaved);
process.exit(0);
