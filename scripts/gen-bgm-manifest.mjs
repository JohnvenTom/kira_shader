#!/usr/bin/env node
/**
 * gen-bgm-manifest —— 把 public/asset/audio/bgm/ 下的 mp3 生成默认歌单，
 *                     并写进 src/components/tape/tapeAudioStore.ts 的 PLAYLIST 区块
 *
 * 用法：node scripts/gen-bgm-manifest.mjs
 *
 * 文件名解析口径（与用户约定一致）：
 *   - 第一个短横线前 = 作者
 *   - 第一个短横线后 = 歌名；结尾的 ID 数字（[-_]数字 结尾）剥掉、
 *     浏览器重复下载的 " (1)" 后缀剥掉、下划线转空格
 * 排序：JAMBACK - positive 恒为第一首（"打开网页自动播"的那首），其余按文件名排序
 *
 * 注意：脚本只重写 PLAYLIST 常量区块（用注释标记定位），文件其余部分不动。
 */
import fs from 'node:fs';

const DIR = 'public/asset/audio/bgm';
const STORE = 'src/components/tape/tapeAudioStore.ts';

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.mp3')).sort((a, b) => {
  const ap = /^JAMBACK/i.test(a) ? 0 : 1;
  const bp = /^JAMBACK/i.test(b) ? 0 : 1;
  return ap - bp || a.localeCompare(b);
});

const tracks = files.map(f => {
  const name = f.replace(/\.mp3$/i, '');
  const dash = name.indexOf('-');
  const artist = name.slice(0, dash).trim();
  let rest = name.slice(dash + 1).trim();
  rest = rest.replace(/\s*\(\d+\)$/i, '');   // 浏览器重复下载的 " (1)"
  rest = rest.replace(/[-_]\d+$/i, '');      // 结尾的 ID 数字（含前面的连字符/下划线）
  rest = rest.replace(/[-_]$/, '');
  const title = rest.replace(/_/g, ' ').trim();
  return { artist, title, file: f };
});

const lines = tracks.map(t =>
  `  { artist: ${JSON.stringify(t.artist)}, title: ${JSON.stringify(t.title)}, album: "", src: "/asset/audio/bgm/${t.file}" },`
);

const block =
  `/* ============================================================\n` +
  `   默认歌单：public/asset/audio/bgm/ 下的 ${tracks.length} 首。\n` +
  `   元数据由文件名解析（第一个短横线前=作者，其后=歌名，剔出结尾 ID 数字、\n` +
  `   下划线转空格；浏览器重复下载的 " (1)" 后缀也剥掉）——由一次性脚本生成，\n` +
  `   加新曲子时把文件放进 bgm 目录后重跑或手改这个数组。第一首 positive\n` +
  `   是"打开网页自动播"的那首。\n` +
  `   ============================================================ */\n` +
  `const PLAYLIST: PlaylistTrack[] = [\n${lines.join('\n')}\n];\n` +
  `/** 打开网页自动播放的第一首 */\n` +
  `const FIRST_TRACK = PLAYLIST[0];\n` +
  `/** 整页的默认音量（原项目 setVolume(0.10)），保证角标先播时音量一致 */\n` +
  `const DEFAULT_VOLUME = 0.10;\n` +
  `/** 音量记忆键：角标滚轮与磁带页滚轮共用一档，谁调了都记住 */\n` +
  `const VOLUME_KEY = 'ohmtape.volume';\n` +
  `/** 播放状态记忆键（设置记忆用的是 ohmtape.prefs，两者互不干扰） */\n` +
  `const PLAY_KEY = 'ohmtape.play';\n`;

let src = fs.readFileSync(STORE, 'utf8');
const start = src.indexOf('/* ============================================================\n   默认歌单：');
const fallbackStart = start < 0 ? src.indexOf('/** 默认曲目的信息') : start;
const end = src.indexOf('/** 读记忆音量');
if (fallbackStart < 0 || end < 0) throw new Error('PLAYLIST 区块定位失败');
src = src.slice(0, fallbackStart) + block + '\n' + src.slice(end);

fs.writeFileSync(STORE, src);
console.log(`PLAYLIST 更新完成：${tracks.length} 首，第一首 = ${tracks[0].artist} - ${tracks[0].title}`);
