/**
 * make-placeholder-track.mjs —— 生成占位默认曲（音乐盒的默认曲位）
 *
 * 功能：合成一段 12 秒的柔和琶音（正弦叠加 + 指数包络），写成 44.1kHz / 16bit / 单声道 WAV。
 *      文件按默认曲目路径落盘（扩展名仍是 .mp3，内容是 WAV —— 浏览器按内容识别容器）。
 *      目的是在真曲子放进仓库之前，让音乐盒角标与跨页续播能被真实验证。
 *
 * 用法：
 *   node scripts/make-placeholder-track.mjs [输出路径]
 *   （默认输出 public/asset/audio/ohm-tape-default.mp3）
 *
 * 返回值：无（打印写入路径与大小）
 * 异常：输出目录不可写时抛错
 *
 * 注意事项：
 *  - 这是**占位素材**，不是成品音乐：放进真曲子时直接覆盖同名文件即可，
 *    路径与 tapeAudioStore.ts 的 DEFAULT_SRC、tapeApp.js 的 TRACK_DEFAULT.src 一致
 *  - 之所以用 WAV 而不是 mp3：环境里没有 ffmpeg，而 WAV 不需要任何编码器
 *  - 换成真 .mp3 后无需改任何代码（浏览器读的是容器里的内容，不是扩展名）
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(HERE, '../public/asset/audio/ohm-tape-default.mp3'));

const RATE = 22050;
const SECONDS = 45;
const N = RATE * SECONDS;
const data = new Float32Array(N);

/** 一盏温柔的小琶音：A3 起的三和弦来回，每个音 0.55s，带指数衰减 */
const NOTES = [220.0, 261.63, 329.63, 440.0, 329.63, 261.63];
const NOTE_LEN = 0.55;
for (let n = 0; n * NOTE_LEN < SECONDS; n++) {
  const f = NOTES[n % NOTES.length];
  const start = Math.floor(n * NOTE_LEN * RATE);
  const len = Math.floor(NOTE_LEN * RATE * 2.2);          // 尾巴拖到下一个音里
  for (let i = 0; i < len && start + i < N; i++) {
    const t = i / RATE;
    const env = Math.exp(-t * 3.1) * (1 - Math.exp(-t * 260));   // 快起慢落
    const w = Math.sin(2 * Math.PI * f * t)
      + 0.28 * Math.sin(2 * Math.PI * f * 2 * t)
      + 0.10 * Math.sin(2 * Math.PI * f * 3 * t);
    data[start + i] += w * env * 0.16;
  }
}
/* 整段首尾各 0.4s 淡入淡出，避免起止爆音 */
const fade = Math.floor(0.4 * RATE);
for (let i = 0; i < fade; i++) {
  data[i] *= i / fade;
  data[N - 1 - i] *= i / fade;
}

/* 打包成 WAV（RIFF / PCM16） */
const bytes = N * 2;
const buf = Buffer.alloc(44 + bytes);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + bytes, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);          // PCM
buf.writeUInt16LE(1, 22);          // 单声道
buf.writeUInt32LE(RATE, 24);
buf.writeUInt32LE(RATE * 2, 28);   // byte rate
buf.writeUInt16LE(2, 32);          // block align
buf.writeUInt16LE(16, 34);         // bit depth
buf.write('data', 36);
buf.writeUInt32LE(bytes, 40);
for (let i = 0; i < N; i++) {
  const v = Math.max(-1, Math.min(1, data[i]));
  buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, buf);
console.log(`占位默认曲已写入：${OUT}（${(buf.length / 1048576).toFixed(2)} MB，${SECONDS}s 合成琶音）`);