#!/usr/bin/env node
// 用法：node scripts/pull-hls.mjs <m3u8-url> <out-prefix> [maxSegments]
// 下载 HLS manifest 与全部分段（curl 后端，走系统代理），按序拼接为 out-prefix.mp4
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [url, prefix, maxSegArg] = process.argv.slice(2);
if (!url || !prefix) {
  console.error('usage: node scripts/pull-hls.mjs <m3u8-url> <out-prefix> [maxSegments]');
  process.exit(1);
}
const maxSegments = Number(maxSegArg || 0);

const curlGet = (u) => execFileSync('curl', ['-sL', '--max-time', '60', u], { maxBuffer: 1 << 28 });

// 递归展开嵌套 playlist（master → media playlist），返回最终媒体分段 URL 列表
const resolveSegments = (u, depth = 0) => {
  const text = curlGet(u).toString('utf8');
  if (!text.includes('#EXTM3U')) {
    console.error('not an m3u8:', text.slice(0, 200));
    process.exit(1);
  }
  const lines = text.split('\n').map((l) => l.trim());
  // master playlist：EXT-X-STREAM-INF 的下一行是子 playlist URL
  const children = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1] && !lines[i + 1].startsWith('#')) {
      children.push(new URL(lines[i + 1], u).href);
    }
  }
  if (children.length > 0 && depth < 3) {
    // 取最高带宽（通常最后一个）或第一个子清单
    return resolveSegments(children[children.length - 1], depth + 1);
  }
  const segments = [];
  for (const line of lines) {
    const mapMatch = line.match(/^#EXT-X-MAP:URI="([^"]+)"/);
    if (mapMatch) {
      segments.push(mapMatch[1]);
      continue;
    }
    if (line.startsWith('#') || !line) continue;
    segments.push(new URL(line, u).href);
  }
  return segments;
};

const segments = resolveSegments(url);
const list = maxSegments > 0 ? segments.slice(0, maxSegments) : segments;
console.log(`segments: ${list.length}${maxSegments ? ` (capped from ${segments.length})` : ''}`);

const chunks = [];
for (let i = 0; i < list.length; i++) {
  const buf = curlGet(list[i]);
  chunks.push(buf);
  console.log(`  [${i + 1}/${list.length}] ${buf.length} bytes`);
}
const out = `${prefix}.mp4`;
fs.writeFileSync(out, Buffer.concat(chunks));
console.log('written:', out, fs.statSync(out).size, 'bytes');
