#!/usr/bin/env node
/**
 * 下载 /work/<slug> 详情页视频资产（mux HLS → 本地 mp4）
 *
 * 用法：node scripts/download-work-media.mjs <slug> <playbackId1> [playbackId2 ...]
 * 产出：public/work-media/<slug>/<playbackId>.mp4（HLS 最高带宽档，fMP4 init+分段拼接）
 *
 * 复用 pull-hls.mjs 的下载策略（curl 走系统代理）；同 id 去重，已存在且 >0 字节则跳过。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [slug, ...ids] = process.argv.slice(2);
if (!slug || ids.length === 0) {
  console.error('usage: node scripts/download-work-media.mjs <slug> <playbackId...>');
  process.exit(1);
}
const outDir = path.join('public', 'work-media', slug);
fs.mkdirSync(outDir, { recursive: true });

const curlGet = (u) =>
  execFileSync('curl', ['-sL', '--noproxy', '*', '--max-time', '120', '--retry', '4', '--retry-all-errors', u], { maxBuffer: 1 << 28 });

/** 递归展开嵌套 playlist，返回（最高带宽档的）媒体分段 URL 列表 */
function resolveSegments(u, depth = 0) {
  const text = curlGet(u).toString('utf8');
  if (!text.includes('#EXTM3U')) throw new Error(`not an m3u8: ${text.slice(0, 120)}`);
  const lines = text.split('\n').map((l) => l.trim());
  const children = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1] && !lines[i + 1].startsWith('#')) {
      children.push(new URL(lines[i + 1], u).href);
    }
  }
  if (children.length > 0 && depth < 3) {
    // 最高带宽档 = 带宽最大的子清单（master 内 BANDWIDTH 顺序不一定升序，解析取 max）
    let best = children[children.length - 1];
    let bestBw = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const m = lines[i].match(/BANDWIDTH=(\d+)/);
      const child = lines[i + 1] && !lines[i + 1].startsWith('#') ? new URL(lines[i + 1], u).href : null;
      if (m && child && Number(m[1]) > bestBw) { bestBw = Number(m[1]); best = child; }
    }
    return resolveSegments(best, depth + 1);
  }
  const segments = [];
  for (const line of lines) {
    const mapMatch = line.match(/^#EXT-X-MAP:URI="([^"]+)"/);
    if (mapMatch) { segments.push(mapMatch[1]); continue; }
    if (line.startsWith('#') || !line) continue;
    segments.push(new URL(line, u).href);
  }
  return segments;
}

const unique = [...new Set(ids)];
for (const id of unique) {
  const out = path.join(outDir, `${id}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) {
    console.log(`skip ${id} (exists)`);
    continue;
  }
  process.stdout.write(`${id}: resolving… `);
  const segments = resolveSegments(`https://stream.mux.com/${id}.m3u8`);
  const chunks = [];
  for (let i = 0; i < segments.length; i++) {
    chunks.push(curlGet(segments[i]));
    process.stdout.write(`${i + 1}/${segments.length} `);
  }
  fs.writeFileSync(out, Buffer.concat(chunks));
  console.log(`→ ${out} (${fs.statSync(out).size} bytes)`);
}
console.log('DONE');
