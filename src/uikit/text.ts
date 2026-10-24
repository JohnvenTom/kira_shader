/**
 * 文本布局 —— 1:1 对照原站 uikit（04kr:26844-26990 lt 三种 wordBreak 扫描器 / li 聚合 / ln 行明细）。
 * 测量入口（04kr:29328-29375）：minWidth = 最宽字符；minHeight = lineHeight；
 * measure(width, mode) 在 UNDEFINED 模式下不折行。
 * 结果 ceiling 到 0.01（04kr:26068）。
 */
import type { GlyphInfo, UIKitFont } from './font.ts';

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

/** 原站行明细结构（04kr:26990 ln / 26872 lt 写入的字段） */
export interface TextLine {
  charIndexOffset: number;
  charLength: number;
  nonWhitespaceWidth: number;
  whitespacesBetween: number;
  nonWhitespaceCharLength: number;
  availableWidth: number;
}

const WS_RUN = /[\t\n ]+/gm;

/** 原站空白折叠（04kr:29326 default 分支） */
export function collapseWhitespace(text: string): string {
  return String(text ?? '').replace(WS_RUN, ' ').trim();
}

/** 逐字符 advance（04kr:24298 sb）：xadvance*fontSize + letterSpacing */
function advance(p: { font: UIKitFont; fontSize: number; letterSpacing?: number }, ch: string): number {
  return p.font.glyph(ch).xadvance * p.fontSize + (p.letterSpacing ?? 0);
}

interface ScanState {
  charIndexOffset: number;
  charLength: number;
  nonWhitespaceWidth: number;
  whitespacesBetween: number;
  nonWhitespaceCharLength: number;
}

type WordBreak = NonNullable<TextLayoutProps['wordBreak']>;

/** lt 三种扫描器（04kr:26847-26987）——逐字对照，含 charLength 的空格/词尾规则 */
const SCANNERS: Record<WordBreak, (p: TextLayoutProps, available: number | undefined, offset: number, line: ScanState) => void> = {
  'keep-all': (p, _available, offset, s) => {
    const text = p.text;
    s.charIndexOffset = offset;
    s.nonWhitespaceCharLength = 0;
    s.charLength = 0;
    s.nonWhitespaceWidth = 0;
    s.whitespacesBetween = 0;
    let l = 0;
    let u = 0;
    let a = offset;
    for (; a < text.length; a++) {
      const ch = text[a];
      if (ch === '\n') {
        s.charLength = a - offset + 1;
        return;
      }
      l += advance(p, ch);
      if (ch === ' ') {
        u += 1;
        continue;
      }
      s.nonWhitespaceWidth = l;
      s.whitespacesBetween = u;
      s.nonWhitespaceCharLength = a - offset + 1;
    }
    s.charLength = a - offset;
  },
  'break-all': (p, available, offset, s) => {
    const text = p.text;
    s.charIndexOffset = offset;
    s.nonWhitespaceCharLength = 0;
    s.charLength = 0;
    s.nonWhitespaceWidth = 0;
    s.whitespacesBetween = 0;
    let l = 0;
    let u = 0;
    let a = offset;
    for (; a < text.length; a++) {
      const ch = text[a];
      if (ch === '\n') {
        s.charLength = a - offset + 1;
        return;
      }
      l += advance(p, ch);
      if (ch === ' ') {
        u += 1;
        continue;
      }
      if (s.nonWhitespaceWidth > 0 && available != null && l > available) break;
      s.nonWhitespaceCharLength = a - offset + 1;
      s.nonWhitespaceWidth = l;
      s.whitespacesBetween = u;
    }
    s.charLength = a - offset;
  },
  'break-word': (p, available, offset, s) => {
    const text = p.text;
    s.charIndexOffset = offset;
    s.nonWhitespaceCharLength = 0;
    s.charLength = 0;
    s.nonWhitespaceWidth = 0;
    s.whitespacesBetween = 0;
    let l = 0;
    let u = 0;
    let a = offset;
    for (; a < text.length; a++) {
      const ch = text[a];
      if (ch === '\n') {
        s.charLength = a - offset + 1;
        break;
      }
      l += advance(p, ch);
      if (ch === ' ') {
        u += 1;
        s.charLength = a - offset + 1;
        continue;
      }
      if (s.nonWhitespaceWidth > 0 && available != null && l > available) break;
      const c = text[a + 1];
      if (c === ' ' || c === '\n' || c === undefined) {
        s.charLength = a - offset + 1;
        s.nonWhitespaceCharLength = s.charLength;
        s.nonWhitespaceWidth = l;
        s.whitespacesBetween = u;
      }
    }
  },
};

/** li 主循环（04kr:26948）：聚合行宽/行数/末行宽 */
export function layoutText(p: TextLayoutProps, available: number | undefined): TextLayoutResult {
  const text = collapseWhitespace(p.text);
  const loopProps: TextLayoutProps = { ...p, text };
  const scan = SCANNERS[p.wordBreak ?? 'break-word'];
  const line: ScanState = { charIndexOffset: 0, charLength: 0, nonWhitespaceWidth: 0, whitespacesBetween: 0, nonWhitespaceCharLength: 0 };
  let maxWidth = 0;
  let lastLineWidth = 0;
  let lines = 0;
  let s = 0;
  while (s < text.length) {
    scan(loopProps, available, s, line);
    maxWidth = Math.max(maxWidth, line.nonWhitespaceWidth);
    lastLineWidth = line.nonWhitespaceWidth;
    lines += 1;
    s = line.charLength + line.charIndexOffset;
  }
  if (text.endsWith('\n')) {
    lines += 1;
    lastLineWidth = 0;
  }
  // 04kr:24301 sS：height = max(lines,1) * lineHeight
  return { width: maxWidth, height: Math.max(lines, 1) * p.lineHeight, lines, lastLineWidth };
}

/** ln 行明细（04kr:26935-27000）：渲染层逐字形定位用 */
export function layoutTextLines(p: TextLayoutProps, available: number): TextLine[] {
  const text = collapseWhitespace(p.text);
  const loopProps: TextLayoutProps = { ...p, text };
  const scan = SCANNERS[p.wordBreak ?? 'break-word'];
  const lines: TextLine[] = [];
  let s = 0;
  while (s < text.length) {
    const line: TextLine = {
      charIndexOffset: 0,
      charLength: 0,
      nonWhitespaceWidth: 0,
      whitespacesBetween: 0,
      nonWhitespaceCharLength: 0,
      availableWidth: available,
    };
    scan(loopProps, available, s, line as ScanState);
    lines.push(line);
    s = line.charLength + line.charIndexOffset;
  }
  if (lines.length === 0 || text.endsWith('\n')) {
    lines.push({
      charLength: 0,
      nonWhitespaceWidth: 0,
      whitespacesBetween: 0,
      charIndexOffset: text.length,
      nonWhitespaceCharLength: 0,
      availableWidth: available,
    });
  }
  return lines;
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

/** 字形横向定位（04kr:24279 sI）：(kerning(prevId→id) + xoffset) * fontSize */
export function glyphXOffset(font: UIKitFont, fontSize: number, glyph: GlyphInfo, prevId: number | undefined): number {
  return ((prevId == null ? 0 : font.kerningById(prevId, glyph.id)) + glyph.xoffset) * fontSize;
}

/** 字形纵向定位（04kr:24293 sv）：yoffset*fontSize + (lineHeight - fontSize)/2 */
export function glyphYOffset(fontSize: number, lineHeight: number, glyph: GlyphInfo): number {
  return glyph.yoffset * fontSize + (lineHeight - fontSize) / 2;
}

/** 垂直对齐偏移（04kr:27546 lg）：块总高与可用高的差值分布 */
export function verticalAlignOffset(availableHeight: number, lines: number, lineHeight: number, align: string): number {
  const total = Math.max(lines, 1) * lineHeight;
  if (align === 'center' || align === 'middle') return (availableHeight - total) / 2;
  if (align === 'bottom') return availableHeight - total;
  return 0;
}

/** textAlign 行首偏移（04kr:27529 lh）：right → p−c；center → (p−c)/2；left → 0 */
export function textAlignOffset(lineAvailable: number, nonWhitespaceWidth: number, align: string): number {
  if (align === 'right') return lineAvailable - nonWhitespaceWidth;
  if (align === 'center') return (lineAvailable - nonWhitespaceWidth) / 2;
  return 0;
}
