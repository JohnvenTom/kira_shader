#!/usr/bin/env node
// 解码截图 footer 区，按列亮度测三块元素的实际宽度
import { readFileSync } from 'fs';
import zlib from 'zlib';

function decodePNG(path) {
  const buf = readFileSync(path);
  let pos = 8;
  let w = 0, h = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') {
      w = buf.readUInt32BE(pos + 8);
      h = buf.readUInt32BE(pos + 12);
      bitDepth = buf[pos + 16];
      colorType = buf[pos + 17];
    } else if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, bpp, data: out };
}

const img = decodePNG('E:/GIthub_Project/My_Shader/kira_shader/_bundles/origin-footer-1600x1200.png');
console.log(`png ${img.w}x${img.h}`);
// footer 条带（截图底部 ~1/4）：找每列最大亮度
const y0 = Math.floor(img.h * 0.72), y1 = img.h;
const colMax = new Float32Array(img.w);
for (let x = 0; x < img.w; x++) {
  let m = 0;
  for (let y = y0; y < y1; y++) {
    const i = (y * img.w + x) * img.bpp;
    const lum = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
    if (lum > m) m = lum;
  }
  colMax[x] = m;
}
// 分段：亮度 > 60 的列视为“有内容”，输出连续区段
const TH = 60;
let segs = [];
let s = -1;
for (let x = 0; x < img.w; x++) {
  const on = colMax[x] > TH;
  if (on && s < 0) s = x;
  if (!on && s >= 0) {
    if (x - s > 8) segs.push([s, x, x - s]);
    s = -1;
  }
}
if (s >= 0) segs.push([s, img.w, img.w - s]);
for (const [a, b, len] of segs) console.log(`segment x=${a}..${b}  width=${len}px`);
