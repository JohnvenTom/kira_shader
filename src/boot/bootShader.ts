/**
 * boot 屏程序化着色器（纯 GLSL 绘制：BIOS 蓝 + 条纹球 logo + 5×7 文字 + 21 段进度条）
 *
 * 结构（逆向自 shader.se 的 boot screen 着色器 pR，配色/度量照抄，载体换为程序化绘制）：
 *  - 参考网格 720×400（contain 适配任意屏幕，超出部分与背景同为 BIOS 蓝）
 *  - 进度条：298×30px、中心偏上 18%、2px 白描边、21 段（10px 段 + 4px 隙），
 *    点亮段数 = floor((progress + 0.1) / 100 × 21)——与原版逐像素一致
 *  - 文字：查 uBootTest（字符索引图）+ uBootFont（5×7 字形图集）逐像素解码
 *  - 扫描线：按网格行暗 5%（CRT 微质感，原版没有、按需可删）
 *
 * 同一段 BOOT_COMMON_GLSL 被两处复用：
 *  1. BootPass（EffectComposer 合成层）：boot 内容盖在场景上，uBootAlpha 控混合
 *  2. 电脑显示器材质（ScreenDisplay）：加载期显示器同步显示 boot 内容
 */
import * as THREE from 'three';
import {
  BOOT_AUDIO_LINE_ON_X,
  BOOT_LINE_META,
  BOOT_TEXT_LINES,
  BOOT_TEXT_LINES_ON,
  buildFontTexture,
  buildTextTexture,
  GLYPH_ORDER,
} from './bootFont';
import { bootStore } from './bootStore';

/** 共享 uniforms 定义（BootPass 与显示器材质共用同一批纹理实例） */
function bootUniforms() {
  const font = buildFontTexture();
  const { texture: text, width } = buildTextTexture(BOOT_TEXT_LINES);
  const on = buildTextTexture(BOOT_TEXT_LINES_ON);
  return {
    uBootFont: { value: font as THREE.Texture },
    uBootTest: { value: text as THREE.Texture },
    /** BGM 行"已解锁"态的文本纹理（点击后切换） */
    uBootTestOn: { value: on.texture as THREE.Texture },
    /** 文本索引图尺寸 (W, H)；字形总数单独给（着色器里算字集高度用） */
    uBootTextSize: { value: new THREE.Vector2(width, BOOT_TEXT_LINES.length) },
    uBootGlyphCount: { value: GLYPH_ORDER.length },
    /** 动态数字/OK 的字形索引（着色器直接查字形图集用） */
    uBootDigitBase: { value: GLYPH_ORDER.indexOf('0') },
    uBootGlyphO: { value: GLYPH_ORDER.indexOf('O') },
    uBootGlyphK: { value: GLYPH_ORDER.indexOf('K') },
    /** 闪烁光标/动态元素的时钟（秒） */
    uBootTime: { value: 0 },
  };
}

let sharedTextures: ReturnType<typeof bootUniforms> | null = null;
/** 模块级单例：字体/文本纹理只建一份，BootPass 与显示器共享 */
export function getBootTextures() {
  if (!sharedTextures) sharedTextures = bootUniforms();
  return sharedTextures;
}

/**
 * 按当前 BGM 解锁态写 uniforms（PostProcessing / ScreenDisplay 每帧调用）：
 * 切换文本纹理（PRESS ANYWHERE… ↔ AUDIO: ON）并校正第 5 行的居中 x
 */
export function applyBootAudioState(uniforms: Record<string, { value: unknown }>) {
  const t = getBootTextures();
  if (bootStore.audioOn) {
    uniforms.uBootTest.value = t.uBootTestOn.value;
    (uniforms.uLineMeta.value as THREE.Vector4[])[4].x = BOOT_AUDIO_LINE_ON_X;
  } else {
    uniforms.uBootTest.value = t.uBootTest.value;
    (uniforms.uLineMeta.value as THREE.Vector4[])[4].x = BOOT_LINE_META[4][0];
  }
}

/** 文本行布局（x, y, scale, lineIndex）→ shader uniform 数组 */
export function bootLineMetaUniform(): THREE.Vector4[] {
  return BOOT_LINE_META.map(([x, y, s, l]) => new THREE.Vector4(x, y, s, l));
}

/**
 * boot 内容公共 GLSL：调用方负责声明 uBootFont/uBootTest/uBootTextSize/uBootGlyphCount/
 * uBootDigitBase/uBootGlyphO/uBootGlyphK/uBootTime/uLineMeta[N]
 *
 * bootContent(uv, resolution, progress) 返回该像素的 boot 颜色（linear 空间）
 */
export const BOOT_COMMON_GLSL = /* glsl */ `
  const vec2 BOOT_GRID = vec2(720.0, 400.0);
  const vec3 BOOT_BLUE = vec3(0.0, 0.0, 1.0);
  const float BOOT_LINE_COUNT = 13.0;

  /** contain 适配：屏幕 uv → 720x400 参考网格坐标（越界=背景区）。
      v 轴翻转：GL 的 vUv 是 y=0 在底部向上增长，而布局表（BOOT_LINE_META）
      与字体表（行 0=字形顶部）都按 y 向下排版——翻转后网格 y=0 在屏幕顶部，
      布局与字形方向与排版约定一致 */
  vec2 bootFitGrid(vec2 uv, vec2 resolution) {
    float s = min(resolution.x / BOOT_GRID.x, resolution.y / BOOT_GRID.y);
    vec2 p = vec2(uv.x, 1.0 - uv.y) * resolution;
    return (p - (resolution - BOOT_GRID * s) * 0.5) / s;
  }

  /** 条纹球 logo（shader.se boot_screen.png 同款意象：水平条纹圆 + 中央横线） */
  float bootLogoPx(vec2 gp) {
    vec2 d = floor(gp) - vec2(72.0, 56.0);
    if (length(d) > 26.0) return 0.0;
    float stripe = step(mod(d.y + 3.5, 7.0), 4.0);   // 4px 亮 / 3px 暗
    float line = step(abs(d.y), 1.5);                // 中央赤道横线
    return max(stripe, line);
  }

  /**
   * 一行 5x7 文本：meta = (x, y, scale, lineIndex)
   * 字符步进 6x8（字形 5x7 + 1px 间隔），scale 为像素放大倍数
   */
  float bootTextPx(vec2 gp, vec4 meta) {
    vec2 d = floor(gp) - meta.xy;
    if (d.x < 0.0 || d.y < 0.0) return 0.0;
    vec2 cellSize = vec2(6.0, 8.0) * meta.z;
    vec2 cell = floor(d / cellSize);
    if (cell.x >= uBootTextSize.x) return 0.0;
    // 垂直边界：每行只画一排字符格子（cell.y=0），禁止以 8*scale 像素为周期向下平铺重复
    if (cell.y >= 1.0) return 0.0;
    vec2 lp = floor(d) - cell * cellSize;            // 单元格内像素
    if (lp.x >= 5.0 * meta.z || lp.y >= 7.0 * meta.z) return 0.0;
    vec2 glyphPx = floor(lp / meta.z);               // 字形内像素 0..4 x 0..6
    float ch = floor(texture2D(uBootTest, vec2(
      (cell.x + 0.5) / uBootTextSize.x,
      (meta.w + 0.5) / uBootTextSize.y
    )).r * 255.0 + 0.5);
    if (ch < 0.5) return 0.0;
    float lit = texture2D(uBootFont, vec2(
      (glyphPx.x + 0.5) / 5.0,
      ((ch - 1.0) * 7.0 + glyphPx.y + 0.5) / (7.0 * uBootGlyphCount)
    )).r;
    return step(0.5, lit);
  }

  /** 按字形索引直接画一个 5x7 字符（动态内容绕过文本纹理） */
  float bootGlyphAtPx(vec2 gp, vec2 origin, float glyphIdx) {
    vec2 lp = floor(gp) - origin;
    if (lp.x < 0.0 || lp.y < 0.0 || lp.x >= 5.0 || lp.y >= 7.0) return 0.0;
    float lit = texture2D(uBootFont, vec2(
      (lp.x + 0.5) / 5.0,
      (glyphIdx * 7.0 + lp.y + 0.5) / (7.0 * uBootGlyphCount)
    )).r;
    return step(0.5, lit);
  }

  /** n 位零填充十进制数字（内存计数等动态数值） */
  float bootDigitsPx(vec2 gp, vec2 origin, float value, float n) {
    vec2 d = floor(gp) - origin;
    if (d.x < 0.0 || d.y < 0.0 || d.y >= 8.0) return 0.0;
    float i = floor(d.x / 6.0);
    if (i >= n || d.x - i * 6.0 >= 5.0) return 0.0;
    float place = pow(10.0, n - 1.0 - i);
    float digit = mod(floor(value / place), 10.0);
    return bootGlyphAtPx(gp, origin + vec2(i * 6.0, 0.0), uBootDigitBase + digit);
  }

  /**
   * 21 段像素进度条（度量逐项照抄逆向结果）：
   * 298x30 @ 网格中心上移 18%，2px 白描边，内缩 4px 后按 14px 周期排段
   */
  float bootBarPx(vec2 gp, float progress) {
    vec2 cell = floor(gp);
    vec2 c = floor(BOOT_GRID * 0.5);
    c.y -= BOOT_GRID.y * 0.18;
    vec2 v = vec2(298.0, 30.0);
    vec2 e = cell - (c - v * 0.5);
    if (e.x < 0.0 || e.y < 0.0 || e.x >= v.x || e.y >= v.y) return 0.0;
    if (e.x < 2.0 || e.x >= v.x - 2.0 || e.y < 2.0 || e.y >= v.y - 2.0) return 1.0;
    vec2 e2 = e - 4.0;
    vec2 inner = v - 8.0;
    if (e2.x < 0.0 || e2.y < 0.0 || e2.x >= inner.x || e2.y >= inner.y) return 0.0;
    float lit = floor((progress + 10.0) / 100.0 * 21.0);
    float idx = floor(e2.x / 14.0);
    float frac = e2.x - idx * 14.0;
    return (idx < lit && frac < 10.0) ? 1.0 : 0.0;
  }

  /** 双细线分隔（POST 面板的上边框，x 72~648，y 230/233） */
  float bootDividerPx(vec2 gp) {
    vec2 p = floor(gp);
    if (p.x < 72.0 || p.x > 648.0) return 0.0;
    float dy = min(abs(p.y - 230.0), abs(p.y - 233.0));
    return dy < 1.0 ? 1.0 : 0.0;
  }

  /** boot 屏完整内容：蓝底 + 白色 logo/文字/进度条 + POST 面板 + 网格行扫描线 */
  vec3 bootContent(vec2 uv, vec2 resolution, float progress) {
    vec2 gp = bootFitGrid(uv, resolution);
    float white = 0.0;
    white = max(white, bootLogoPx(gp));
    for (int i = 0; i < 13; i++) {
      white = max(white, bootTextPx(gp, uLineMeta[i]));
    }
    white = max(white, bootBarPx(gp, progress));

    // === POST 面板动态元素 ===
    // 内存计数：0~262144K 随进度滚动；走满后 K 后面出现 OK
    // （数字起点 x = 72 + 22 列 × 6px，见 BOOT_LINE_META 行 6 的 MEMORY_DIGITS_COL）
    vec2 memOrigin = vec2(72.0 + 22.0 * 6.0, 242.0);
    float mem = floor(progress / 100.0 * 262144.0 + 0.5);
    white = max(white, bootDigitsPx(gp, memOrigin, mem, 6.0));
    if (progress >= 99.9) {
      white = max(white, bootGlyphAtPx(gp, vec2(252.0, 242.0), uBootGlyphO));
      white = max(white, bootGlyphAtPx(gp, vec2(258.0, 242.0), uBootGlyphK));
    }
    // 启动源行尾的闪烁光标（1Hz 方波，6x8 实心块；行 11 共 29 字符，光标 x = 72 + 29×6）
    if (fract(uBootTime) < 0.5) {
      vec2 cp = floor(gp) - vec2(72.0 + 29.0 * 6.0, 328.0);
      if (cp.x >= 0.0 && cp.y >= 0.0 && cp.x < 6.0 && cp.y < 8.0) white = 1.0;
    }
    // 扫描线：每 2 网格行一条暗线，强度 5%
    float scan = 1.0 - 0.05 * (0.5 + 0.5 * sin(floor(gp.y) * 3.14159));
    // 分隔线以 60% 亮度呈现（比文字退半级，作 POST 面板上边框）
    float divider = 0.6 * bootDividerPx(gp);
    return BOOT_BLUE * scan + (max(white, divider)) * scan;
  }
`;

/** BootPass 合成层：boot 内容以 uBootAlpha 混在已渲染场景之上 */
export const BootPassShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** 0=全场景 1=全 boot；显现期 = 1 − spring */
    uBootAlpha: { value: 1.0 },
    /** 进度条显示值 0~100 */
    uProgress: { value: 0.0 },
    /** 绘图缓冲分辨率（contain 适配用） */
    uResolution: { value: new THREE.Vector2(1, 1) },
    ...getBootTexturesSharedRef(),
    uLineMeta: { value: bootLineMetaUniform() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uBootAlpha;
    uniform float uProgress;
    uniform vec2 uResolution;
    uniform sampler2D uBootFont;
    uniform sampler2D uBootTest;
    uniform vec2 uBootTextSize;
    uniform float uBootGlyphCount;
    uniform float uBootDigitBase;
    uniform float uBootGlyphO;
    uniform float uBootGlyphK;
    uniform float uBootTime;
    uniform vec4 uLineMeta[13];
    varying vec2 vUv;
    ${BOOT_COMMON_GLSL}
    void main() {
      vec3 scene = texture2D(tDiffuse, vUv).rgb;
      vec3 boot = bootContent(vUv, uResolution, uProgress);
      gl_FragColor = vec4(mix(scene, boot, uBootAlpha), 1.0);
    }
  `,
};

/** 共享纹理引用（uniform 定义期就要挂上，避免先建后挂） */
function getBootTexturesSharedRef() {
  const t = getBootTextures();
  return {
    uBootFont: { value: t.uBootFont.value },
    uBootTest: { value: t.uBootTest.value },
    uBootTextSize: { value: t.uBootTextSize.value.clone() },
    uBootGlyphCount: { value: t.uBootGlyphCount.value },
    uBootDigitBase: { value: t.uBootDigitBase.value },
    uBootGlyphO: { value: t.uBootGlyphO.value },
    uBootGlyphK: { value: t.uBootGlyphK.value },
    uBootTime: { value: 0 },
  };
}
