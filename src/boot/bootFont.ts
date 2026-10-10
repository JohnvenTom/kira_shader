/**
 * 5×7 位图字体表 + 着色器纹理构建（boot 屏纯程序化文字方案）
 *
 * 功能：
 *  - FONT_5X7：公有领域 5×7 像素字体的行编码（每字符 7 行，每行 5 位，
 *    bit4=最左列，bit0=最右列，行 0=顶部）——复古 BIOS/LED 点阵气质
 *  - buildFontTexture()：把字表打包成一张 DataTexture（5 × 7N，单通道，
 *    NearestFilter）供片元着色器查表解码，零图片素材依赖
 *  - buildTextTexture()：把 boot 屏的文本行（字符串）编码成字符索引图
 *    （W × H，单通道，texel = 字形序号+1，0=空白）——改文案只改字符串
 *
 * 注意：DataTexture 默认 flipY=false，纹理 v=0 对应数据第一行；
 *      着色器侧按同一约定采样（行 0 = 顶部）。
 */
import * as THREE from 'three';

/** 5×7 字体行编码表（行内 5 位，MSB=左列） */
export const FONT_5X7: Record<string, number[]> = {
  'A': [14, 17, 17, 31, 17, 17, 17],
  'B': [30, 17, 17, 30, 17, 17, 30],
  'C': [14, 17, 16, 16, 16, 17, 14],
  'D': [30, 17, 17, 17, 17, 17, 30],
  'E': [31, 16, 16, 30, 16, 16, 31],
  'F': [31, 16, 16, 30, 16, 16, 16],
  'G': [14, 17, 16, 23, 17, 17, 15],
  'H': [17, 17, 17, 31, 17, 17, 17],
  'I': [31, 4, 4, 4, 4, 4, 31],
  'J': [7, 2, 2, 2, 2, 18, 12],
  'K': [17, 18, 20, 24, 20, 18, 17],
  'L': [16, 16, 16, 16, 16, 16, 31],
  'M': [17, 27, 21, 21, 17, 17, 17],
  'N': [17, 17, 25, 21, 19, 17, 17],
  'O': [14, 17, 17, 17, 17, 17, 14],
  'P': [30, 17, 17, 30, 16, 16, 16],
  'Q': [14, 17, 17, 17, 21, 18, 13],
  'R': [30, 17, 17, 30, 20, 18, 17],
  'S': [15, 16, 16, 14, 1, 1, 30],
  'T': [31, 4, 4, 4, 4, 4, 4],
  'U': [17, 17, 17, 17, 17, 17, 14],
  'V': [17, 17, 17, 17, 17, 10, 4],
  'W': [17, 17, 17, 21, 21, 21, 10],
  'X': [17, 17, 10, 4, 10, 17, 17],
  'Y': [17, 17, 10, 4, 4, 4, 4],
  'Z': [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  ',': [0, 0, 0, 0, 0, 4, 8],
  ':': [0, 12, 12, 0, 12, 12, 0],
  '/': [1, 2, 2, 4, 8, 8, 16],
  '-': [0, 0, 0, 14, 0, 0, 0],
  '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8],
  '_': [0, 0, 0, 0, 0, 0, 31],
};

/** 字形顺序（着色器字符索引 ↔ 字表键） */
export const GLYPH_ORDER = Object.keys(FONT_5X7);

/**
 * boot 屏文本行（改文案只改这里，布局在 bootShader 的 uLineMeta）
 *
 * 行 0：字标（scale 2） 行 1：副题
 * 行 2：版本行（进度条下方居中） 行 3：版权行（底部居中）
 * 行 4：BGM 解锁行（两态：点击前 "PRESS ANYWHERE TO PLAY BGM" /
 *      点击后 "AUDIO: ON"，纹理按态切换，见 bootShader 的文本纹理双态）
 * 行 6：内存检测行（数字部分由着色器动态绘制，见 bootDigitsPx；
 *      静态部分只烘焙标签与 "K" 后缀，6 个空格是数字的占位）
 * 行 7-10：硬件信息两栏表（GPU/分辨率为真实探测值，构建纹理时写入）
 * 行 11：启动源行（行尾闪烁光标由着色器绘制）
 * 行 12：键提示行（纯 BIOS 装饰）
 */
export const BOOT_AUDIO_LINE_OFF = 'PRESS ANYWHERE TO PLAY BGM';
export const BOOT_AUDIO_LINE_ON = 'AUDIO: ON';

/** GPU 渲染器字符串（真实探测，构建纹理时固化；失败退回通用占位） */
function detectGpuRenderer(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'SOFTWARE RASTERIZER';
    const raw = String(gl.getParameter(gl.RENDERER) || 'UNKNOWN GPU');
    // 只保留字体表收录的字符（其余替换为空格），截断到 56 字符适配栏宽
    return raw.toUpperCase().replace(/[^A-Z0-9 .:/()-]/g, ' ').trim().slice(0, 56) || 'UNKNOWN GPU';
  } catch {
    return 'UNKNOWN GPU';
  }
}

/** 显示分辨率 + DPR（构建纹理时固化） */
function detectDisplay(): string {
  const dpr = Number(window.devicePixelRatio || 1);
  const dprStr = Number.isInteger(dpr) ? String(dpr) : dpr.toFixed(2);
  return `${screen.width}X${screen.height} DPR ${dprStr}`;
}

/** 内存检测行的静态部分（"MEMORY TEST ......... " 22 字符标签 + 6 空格数字占位 + K） */
export const MEMORY_LINE = `MEMORY TEST ......... ${' '.repeat(6)}K`;

/** 终端滚动日志行（真实数据在构建纹理时固化；逐条滚入，见 bootShader 的日志窗） */
function buildLogLines(): string[] {
  const row = (k: string, v: string) => `${k} ${'.'.repeat(Math.max(2, 11 - k.length - 1))} ${v}`;
  const host = (location.host || 'LOCAL').toUpperCase().slice(0, 40);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return [
    row('GPU', detectGpuRenderer()),
    row('DISPLAY', detectDisplay()),
    row('HOST', host),
    row('CLOCK', clock),
    row('AUDIO', 'TAPE DECK SIDE A READY'),
    row('INPUT', 'POINTER / KEYBOARD'),
    row('DRACO', 'DECODER READY'),
    row('ASSETS', '6/6 LOADED'),
    row('WARMUP', '24 FRAMES OK'),
    'NO ERRORS FOUND',
    'STARTING SHADER ...',
  ];
}

export const BOOT_TEXT_LINES = [
  'KIRA SHADER',
  'PERSONAL RENDER LAB',
  'WEBSITE / VERSION 1.0',
  '(C) 2026 KIRA SHADER. ALL RIGHTS RESERVED.',
  BOOT_AUDIO_LINE_OFF,
  '', // 行 5 保留（AUDIO: ON 态由纹理整体切换，不单独占行）
  MEMORY_LINE,
  ...buildLogLines(),
  'BOOTING FROM /DEV/SHADER0 ...',
  'DEL: SETUP   F1: HELP   F12: BOOT MENU',
];

/** BGM 行的"已解锁"态：其余行不变，仅第 5 行换文案 */
export const BOOT_TEXT_LINES_ON = BOOT_TEXT_LINES.map((l, i) =>
  i === 4 ? BOOT_AUDIO_LINE_ON : l
);

/** 日志窗配置：日志首行在文本纹理中的行号 + 可见行数 + 行距 + 首行 y */
export const BOOT_LOG_LINE_BASE = 7;
export const BOOT_LOG_TOTAL = 11;
export const BOOT_LOG_ROWS = 5;
export const BOOT_LOG_SPACING = 14;
export const BOOT_LOG_Y0 = 256;

/**
 * 静态布局元数据：[起始 x, 起始 y, 像素放大倍数, 行号]（720×400 参考网格）
 * 日志行不在此列（由 bootLogPx 按滚动窗动态绘制）
 */
export const BOOT_LINE_META: [number, number, number, number][] = [
  [116, 42, 2, 0],   // KIRA SHADER（字标，紧邻条纹球 logo 右侧）
  [118, 64, 1, 1],   // PERSONAL RENDER LAB
  [297, 176, 1, 2],  // WEBSITE / VERSION 1.0（进度条下方居中）
  [234, 368, 1, 3],  // 版权行（底部居中）
  [282, 208, 1, 4],  // BGM 解锁行（AUDIO: ON 态换 x=333）
  [0, 0, 1, 5],      // 保留行，不绘制内容（空字符串）
  [72, 242, 1, 6],   // 内存检测行（动态数字 + K/OK 后缀）
  [72, 328, 1, 18],  // 启动源行（行尾闪烁光标由着色器绘制）
  [243, 346, 1, 19], // 键提示行（居中装饰）
];

/** BGM 行"已解锁"态的布局（AUDIO: ON 共 9 字符 ×6px=54 宽，居中 x=333） */
export const BOOT_AUDIO_LINE_ON_X = 333;

/** 字符间距（5px 字形 + 1px 间隔 = 6px 步进） */
export const GLYPH_CELL_W = 6;

/**
 * 构建字形图集 DataTexture（5 × 7N，R 通道 0/255，Nearest 采样）
 */
export function buildFontTexture(): THREE.DataTexture {
  const n = GLYPH_ORDER.length;
  const data = new Uint8Array(5 * 7 * n);
  for (let g = 0; g < n; g++) {
    const rows = FONT_5X7[GLYPH_ORDER[g]];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        // bit4 = 最左列 → 列 c 的掩码 = 1 << (4 - c)
        const lit = (rows[r] & (1 << (4 - c))) !== 0 ? 255 : 0;
        data[(g * 7 + r) * 5 + c] = lit;
      }
    }
  }
  const tex = new THREE.DataTexture(data, 5, 7 * n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  // 行宽 5 字节非 4 字节对齐，必须显式置 1，否则纹理解包错位
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 构建文本索引图 DataTexture（W × H，R 通道 = 字形序号+1，0=空白/越界）
 *
 * 未收录的字符按空白处理（不中断渲染）
 */
export function buildTextTexture(lines: string[]): { texture: THREE.DataTexture; width: number } {
  const width = Math.max(...lines.map((l) => l.length));
  const height = lines.length;
  const data = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < lines[r].length; c++) {
      const idx = GLYPH_ORDER.indexOf(lines[r][c].toUpperCase());
      data[r * width + c] = idx >= 0 ? idx + 1 : 0;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  // 行宽 = 文本长度（任意值），同样显式关掉 4 字节对齐
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return { texture: tex, width };
}
