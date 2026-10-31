#!/usr/bin/env node
/**
 * 下载 /work/<slug> 详情页媒体卡缩略图（原站 mux-image API）
 *
 * 功能：解析 src/work-detail/data.ts 里全部 mux playback id（主视频 + project_media，
 *       自动去重），从 shader.se 的 /api/mux-image/<id>/w800-h600-fpreserve 拉缩略图，
 *       存到 public/work-media/<uid>/<id>-thumb.webp（内容为 jpeg，TextureLoader 按字节嗅探，扩展名不影响）。
 *       已存在且 >0 字节的跳过。
 *
 * 参数：无（自动扫描 data.ts）；可选传 `--force` 强制重新下载。
 * 返回值：无（控制台输出进度，失败项列出后以非零码退出）。
 * 异常：单个文件下载失败不中断整体，最后汇总；网络不可用时全部失败退出码 1。
 * 注意事项：依赖系统 curl（走 --noproxy '*' 直连）；API 无鉴权，与原站前端同源。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const force = process.argv.includes('--force');
const dataSrc = fs.readFileSync('src/work-detail/data.ts', 'utf8');

/** 解析 data.ts：uid 与 mux_playback_id 的归属关系（顺序扫描，uid 变更前出现的 id 归上一 uid 之前先缓存） */
function parseProjects(src) {
  const projects = [];
  let cur = null;
  let pending = [];
  const flushPending = () => {
    if (cur) cur.ids.push(...pending);
    pending = [];
  };
  for (const m of src.matchAll(/uid:\s*'([^']+)'|mux_playback_id:\s*'([^']+)'/g)) {
    if (m[1]) {
      flushPending();
      cur = { uid: m[1], ids: [] };
      projects.push(cur);
    } else if (m[2]) {
      pending.push(m[2]);
    }
  }
  flushPending();
  return projects;
}

const projects = parseProjects(dataSrc);
const jobs = [];
for (const p of projects) {
  const seen = new Set();
  for (const id of p.ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    jobs.push({ uid: p.uid, id });
  }
}
console.log(`${jobs.length} unique thumbs across ${projects.length} projects`);

let fail = 0;
for (const { uid, id } of jobs) {
  const outDir = path.join('public', 'work-media', uid);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${id}-thumb.webp`);
  if (!force && fs.existsSync(out) && fs.statSync(out).size > 0) {
    console.log(`skip ${uid}/${id}`);
    continue;
  }
  const url = `https://www.shader.se/api/mux-image/${id}/w800-h600-fpreserve`;
  try {
    const buf = execFileSync(
      'curl.exe',
      ['-sL', '--noproxy', '*', '--max-time', '60', '--retry', '3', '--retry-all-errors', url],
      { maxBuffer: 1 << 26 },
    );
    if (buf.length < 1000) throw new Error(`too small: ${buf.length}`);
    fs.writeFileSync(out, buf);
    console.log(`ok   ${uid}/${id} (${buf.length}b)`);
  } catch (e) {
    fail++;
    console.error(`FAIL ${uid}/${id}: ${e.message}`);
  }
}
if (fail > 0) {
  console.error(`${fail} failed`);
  process.exit(1);
}
console.log('DONE');
