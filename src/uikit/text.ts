/**
 * 文本测量 —— 1:1 对照原站 uikit 布局语义（04kr:26844-26970 li/lt、24295-24303 sv/sb/sS）。
 * 默认 wordBreak "break-word"、letterSpacing 0、lineHeight "120%"（04kr:26409-26411）。
 * 测量入口（04kr:29328-29375）：minWidth = 最宽字符；minHeight = lineHeight；
 * measure(width, mode) 在 UNDEFINED 模式下不折行。
 */
import type { UIKitFont } from './font';

export interface TextLayoutProps {
  text: string;
  font: UIKitFont;
  fontSize: number;
  letterSpacing?: number;
  /** px（已解析 "120%" → fontSize*1.2） */
  lineHeight: number;
  wordBreak?: 'keep-all' | 'break-all' | 'break-word';
}

export interface TextLayoutResult {
  width: number;
  height: number;
  lines: number;
  lastLineWidth: number;
}

const WS_RUN = /[\t\n ]+/gm;

/** 原站空白折叠（04kr:29326 default 分支） */
export function collapseWhitespace(text: string): string {
  return String(text ?? '').replace(WS_RUN, ' ').trim();
}

/** 逐字符 advance（04kr:24298 sb）：xadvance*fontSize + letterSpacing */
function advance(p: TextLayoutProps, ch: string): number {
  return p.font.glyph(ch).xadvance * p.fontSize + (p.letterSpacing ?? 0);
}

/** 单行扫描（04kr:26913 break-word） */
function scanLine(p: TextLayoutProps, start: number, available: number | undefined) {
  let l = 0;
  let whitespacesBetween = 0;
  let nonWhitespaceWidth = 0;
  let charLength = 0;
  let a = start;
  const text = p.text;
  for (; a < text.length; a++) {
    const ch = text[a];
    if (ch === '\n') {
      charLength = a - start + 1;
      break;
    }
    l += advance(p, ch);
    if (ch === ' ') {
      whitespacesBetween += 1;
      charLength = a - start + 1;
      continue;
    }
    if (nonWhitespaceWidth > 0 && available != null && l > available) break;
    const next = text[a + 1];
    if (next === ' ' || next === '\n' || next === undefined) {
      charLength = a - start + 1;
      nonWhitespaceWidth = l;
    }
  }
  if (a >= text.length) charLength = a - start;
  return { charLength, nonWhitespaceWidth, whitespacesBetween };
}

/** 行布局主循环（04kr:26948 li） */
export function layoutText(p: TextLayoutProps, available: number | undefined): TextLayoutResult {
  const text = collapseWhitespace(p.text);
  const loopProps: TextLayoutProps = { ...p, text };
  let maxWidth = 0;
  let lastLineWidth = 0;
  let lines = 0;
  let s = 0;
  while (s < text.length) {
    const r = scanLine(loopProps, s, available);
    maxWidth = Math.max(maxWidth, r.nonWhitespaceWidth);
    lastLineWidth = r.nonWhitespaceWidth;
    lines += 1;
    s += r.charLength;
    if (r.charLength <= 0) break;
  }
  if (text.endsWith('\n')) {
    lines += 1;
    lastLineWidth = 0;
  }
  // 04kr:24301 sS：height = max(lines,1) * lineHeight
  return { width: maxWidth, height: Math.max(lines, 1) * p.lineHeight, lines, lastLineWidth };
}

/** 解析 lineHeight："120%" → fontSize*1.2；"48px" → 48；数字按比例（04kr:29343） */
export function resolveLineHeight(lineHeight: number | string | undefined, fontSize: number): number {
  if (lineHeight == null) return fontSize * 1.2;
  if (typeof lineHeight === 'string' && lineHeight.endsWith('px')) return parseFloat(lineHeight);
  return fontSize * Number(lineHeight === '120%' ? 1.2 : parseFloat(String(lineHeight)) || 1.2);
}

const MODE_UNDEFINED = 0;
const MODE_AT_MOST = 1;
const MODE_EXACTLY = 2;
/** 对齐 yoga MeasureMode 数值 */
export const MeasureMode = { UNDEFINED: MODE_UNDEFINED, AT_MOST: MODE_AT_MOST, EXACTLY: MODE_EXACTLY } as const;

export interface TextMeasurer {
  minWidth: number;
  minHeight: number;
  measure(width: number, widthMode: number): { width: number; height: number };
}

/** 原站文本测量封装（04kr:29362-29374 + 26068 ceil100） */
export function createTextMeasurer(props: Omit<TextLayoutProps, 'lineHeight'> & { lineHeight?: number | string }): TextMeasurer {
  const lineHeight = resolveLineHeight(props.lineHeight, props.fontSize);
  const full: TextLayoutProps = { ...props, lineHeight };
  const minWidth = layoutText(full, 0).width;
  const minHeight = lineHeight;
  return {
    minWidth,
    minHeight,
    measure(width, widthMode) {
      const avail = widthMode === MODE_UNDEFINED ? undefined : width;
      const { width: w, height: h } = layoutText(full, avail);
      return { width: Math.ceil(100 * w) / 100, height: Math.ceil(100 * h) / 100 };
    },
  };
}
