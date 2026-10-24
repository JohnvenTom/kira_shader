#!/usr/bin/env node
// 像素级测量 Hello 文字顶边位置（暗背景上的亮文字）：扫描顶部区域每行最大亮度，
// 第一处亮度超阈值的行为文字顶。用法: node scripts/measure-hello-top.mjs <png> [png2...]
import { readFileSync } from 'fs';
import { inflateSync } from 'zlib';

function decodePNG(file) {
  const buf = readFileSync(file);
  let pos = 8;
  let w = 0,
    h = 0,
    bpp = 3;
  const idat = [];
  let plte = null;
  let trns = null;
  let colorType = 0;
  let bitDepth = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
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
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c),
          pb = Math.abs(a - c),
          pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, bpp, data: out, plte, trns, colorType, bitDepth };
}

function lumAt(img, x, y) {
  const i = (y * img.w + x) * img.bpp;
  if (img.colorType === 3) {
    const r = img.plte[img.data[i] * 3],
      g = img.plte[img.data[i] * 3 + 1],
      b = img.plte[img.data[i] * 3 + 2];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
}

const files = process.argv.slice(2).filter((f) => !f.startsWith('--'));
const profileMode = process.argv.includes('--profile');
for (const f of files) {
  const img = decodePNG(f);
  if (profileMode) {
    const prof = [];
    for (let y = 0; y < 330; y += 6) {
      let cnt = 0;
      for (let x = 0; x < img.w; x++) if (lumAt(img, x, y) > 150) cnt++;
      prof.push(`${y}:${cnt}`);
    }
    console.log(f, prof.join(' '));
    continue;
  }
  // Hello 在顶部 ~35% 区域；找每行最亮值，第一个超过 150 的行 = 文字顶
  let top = -1;
  const rows = [];
  for (let y = 0; y < Math.floor(img.h * 0.35); y++) {
    let cnt = 0;
    for (let x = 0; x < img.w; x++) {
      if (lumAt(img, x, y) > 150) cnt++;
    }
    rows.push(cnt);
    if (cnt > 40 && top === -1) top = y;
  }
  // 找文字块的底部（亮像素计数 > 40 的连续行结束）
  let bottom = top;
  if (top >= 0) {
    for (let y = top; y < rows.length; y++) {
      if (rows[y] > 40) bottom = y;
    }
  }
  console.log(`${f}: ${img.w}x${img.h} helloTop=${top} bottom=${bottom} h=${bottom - top + 1}px topFrac=${top >= 0 ? ((top / img.h) * 100).toFixed(1) + '%' : '-'}`);
}
