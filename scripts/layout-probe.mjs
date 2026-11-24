#!/usr/bin/env node
// M2 离线布局探针：按原站 uikit+yoga 语义计算 contact 内容列高度
// 验收：d = 列高/viewportHeight 与原站运行时页长对比（静态注册值 3.3238571052836656 为参考锚点）
// 用法: node scripts/layout-probe.mjs [width] [height] [--content-box]
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import YGPackage from 'yoga-layout';

const YG = YGPackage.default ?? YGPackage;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const WIDTH = Number(process.argv[2] || 1440);
const HEIGHT = Number(process.argv[3] || 900);
const CONTENT_BOX = process.argv.includes('--content-box');

const TARGET_STATIC = 3.3238571052836656;

// ---------- 字体 ----------
const FONTS = {};
for (const [name, file] of [
  ['regular', 'stix_regular.json'],
  ['medium', 'stix_medium.json'],
  ['bold', 'stix_bold.json'],
]) {
  const json = JSON.parse(readFileSync(path.join(ROOT, '_bundles/fonts', file), 'utf8'));
  const map = new Map();
  for (const c of json.chars) {
    map.set(c.char, {
      ...c,
      xadvance: c.xadvance / json.info.size,
      xoffset: c.xoffset / json.info.size,
      yoffset: (c.yoffset - (json.common.lineHeight - json.info.size)) / json.info.size,
      width: c.width / json.info.size,
      height: c.height / json.info.size,
    });
  }
  const kern = new Map();
  for (const k of json.kernings ?? []) kern.set(`${k.first}/${k.second}`, k.amount / json.info.size);
  FONTS[name] = { map, kern, lineHeightFont: json.common.lineHeight / json.info.size };
}
const FALLBACK = { xadvance: 0.6, yoffset: 0.3, width: 0.5, height: 0.5 };
const glyph = (font, ch) => FONTS[font].map.get(ch) ?? FALLBACK;

// ---------- 文本测量（照原站 li/lt break-word 语义） ----------
const WS = /[\t\n ]+/gm;
function collapse(text) {
  return String(text ?? '').replaceAll(WS, ' ').trim();
}
function layoutText({ text, font, fontSize, letterSpacing = 0, lineHeight, wordBreak = 'break-word' }, available) {
  text = collapse(text);
  const lines = [];
  let start = 0;
  while (start < text.length) {
    // 一行：贪心 + break-word（词整体换行，超长词不拆）
    let l = 0, u = 0;
    let nonWW = 0, nonWWChars = 0, charLen = 0;
    let a = start;
    for (; a < text.length; a++) {
      const ch = text[a];
      if (ch === '\n') { charLen = a - start + 1; break; }
      l += glyph(font, ch).xadvance * fontSize + letterSpacing;
      if (ch === ' ') { u += 1; charLen = a - start + 1; continue; }
      if (nonWW > 0 && available != null && l > available) break;
      const next = text[a + 1];
      if (next === ' ' || next === '\n' || next === undefined) {
        charLen = a - start + 1;
        nonWWChars = charLen;
        nonWW = l;
      }
    }
    if (a >= text.length) charLen = a - start; // 到达末尾
    lines.push({ nonWW, whitespaces: u });
    start += charLen;
    if (charLen <= 0) break; // 防死循环
  }
  if (text.endsWith('\n')) lines.push({ nonWW: 0, whitespaces: 0 });
  const width = Math.max(0, ...lines.map((x) => x.nonWW));
  const height = Math.max(lines.length, 1) * lineHeight;
  return { width, height, lines: lines.length };
}
function textMeasure(props) {
  const lineHeight = props.fontSize * 1.2; // 默认 "120%"
  const minWidth = layoutText(props, 0).width;
  const minHeight = lineHeight;
  const measure = (width, widthMode) => {
    const avail = widthMode === YG.MEASURE_MODE_UNDEFINED ? undefined : width;
    const { width: w, height: h } = layoutText(props, avail);
    return {
      width: Math.ceil(100 * w) / 100,
      height: Math.ceil(100 * h) / 100,
    };
  };
  return { minWidth, minHeight, measure };
}

// ---------- yoga 树 ----------
const tree = { boxSizing: CONTENT_BOX ? 'content-box' : 'border-box' };
function node(style = {}, measureProps = null) {
  const n = YG.Node.create();
  if (YG.Node.prototype.setBoxSizing) {
    n.setBoxSizing(CONTENT_BOX ? YG.BOX_SIZING_CONTENT_BOX : YG.BOX_SIZING_BORDER_BOX);
  }
  const S = YG;
  if (style.width != null) n.setWidth(style.width);
  if (style.height != null) n.setHeight(style.height);
  if (style.maxWidth != null) n.setMaxWidth(style.maxWidth);
  if (style.minWidth != null) n.setMinWidth(style.minWidth);
  if (style.minHeight != null) n.setMinHeight(style.minHeight);
  if (style.flexDirection) n.setFlexDirection(style.flexDirection === 'row' ? S.FLEX_DIRECTION_ROW : style.flexDirection === 'column-reverse' ? S.FLEX_DIRECTION_COLUMN_REVERSE : style.flexDirection === 'row-reverse' ? S.FLEX_DIRECTION_ROW_REVERSE : S.FLEX_DIRECTION_COLUMN);
  if (style.justifyContent) n.setJustifyContent({ 'flex-start': S.JUSTIFY_FLEX_START, center: S.JUSTIFY_CENTER, 'flex-end': S.JUSTIFY_FLEX_END, 'space-between': S.JUSTIFY_SPACE_BETWEEN }[style.justifyContent]);
  if (style.alignItems) n.setAlignItems({ 'flex-start': S.ALIGN_FLEX_START, center: S.ALIGN_CENTER, 'flex-end': S.ALIGN_FLEX_END, stretch: S.ALIGN_STRETCH }[style.alignItems]);
  if (style.flexGrow != null) n.setFlexGrow(style.flexGrow);
  if (style.flexShrink != null) n.setFlexShrink(style.flexShrink);
  if (style.gap != null) n.setGap(S.GUTTER_ALL, style.gap);
  if (style.positionType === 'absolute') n.setPositionType(S.POSITION_TYPE_ABSOLUTE);
  const pad = (edge, v) => v != null && n.setPadding(edge, v);
  pad(S.EDGE_ALL, style.padding); // 先 ALL，再被具体边覆盖
  pad(S.EDGE_TOP, style.paddingTop ?? style.paddingY); pad(S.EDGE_BOTTOM, style.paddingBottom ?? style.paddingY);
  pad(S.EDGE_LEFT, style.paddingLeft ?? style.paddingX); pad(S.EDGE_RIGHT, style.paddingRight ?? style.paddingX);
  const bord = (edge, v) => v != null && n.setBorder(edge, v);
  bord(S.EDGE_ALL, style.borderWidth); // 先 ALL，再被具体边覆盖
  bord(S.EDGE_TOP, style.borderTopWidth); bord(S.EDGE_BOTTOM, style.borderBottomWidth);
  bord(S.EDGE_LEFT, style.borderLeftWidth); bord(S.EDGE_RIGHT, style.borderRightWidth);
  const marg = (edge, v) => v != null && n.setMargin(edge, v);
  marg(S.EDGE_TOP, style.marginTop); marg(S.EDGE_BOTTOM, style.marginBottom);
  if (measureProps) {
    const m = textMeasure(measureProps);
    n.setMinWidth(m.minWidth);
    n.setMinHeight(m.minHeight);
    n.setMeasureFunc((w, wm) => m.measure(w, wm));
  }
  n.__style = style;
  return n;
}
function add(parent, ...children) {
  children.forEach((c, i) => parent.insertChild(c, i));
  return parent;
}
const T = (text, { font = 'regular', fontSize, ...rest } = {}) =>
  node({ ...rest }, { text, font, fontSize });

// 图片：width 定，height = width × 纵横比
const IMAGES = {
  'footer_certificate.png': [429, 285],
  'copyright_footer.png': [1032, 288],
  'a11y.png': [406, 156],
};
// declaredWidth = 样式里的 width；under = 该列内图片实际内容宽（border-box 时扣除 padding+border）
const IMG = (name, declaredWidth, under) => {
  const [w, h] = IMAGES[name];
  const imgW = CONTENT_BOX ? declaredWidth : under;
  const height = (imgW * h) / w;
  return node({ height });
};

// ---------- contact 内容列（glossary §3/§4, 1440×900 → lg 断点） ----------
const lg = WIDTH >= 1024;
const xl = WIDTH >= 1280;
const pageHeight = HEIGHT; // uU: pageHeight = viewportHeight/pixelSize = 1 viewport 的 CSS px

const content = node({ flexDirection: 'column', width: WIDTH }); // height auto → 页长来源

// —— Hello 块 ——
const hello = add(
  node({ flexDirection: 'column' }),
  add(
    node({ flexDirection: 'column', width: WIDTH, paddingTop: pageHeight }),
    T('“Hello”', { font: 'medium', fontSize: lg ? 200 : 80, textAlign: 'center' }),
    node({ height: 0.95 * HEIGHT, width: WIDTH }),
  ),
);

// —— Good buy 组 ——
// ci 卡片
const title = (text) => T(text, { font: 'bold', fontSize: lg ? 24 : 18, marginBottom: lg ? 4 : 2 });
const link = (text) =>
  add(
    node({ paddingX: 2, borderWidth: 2 }),
    add(
      node({ borderBottomWidth: 1, marginBottom: 6, paddingTop: 4 }),
      T(text, { font: 'regular', fontSize: lg ? 20 : 18, marginBottom: -6 }),
    ),
  );
const addressLine = (text) => T(text, { font: 'regular', fontSize: lg ? 20 : 18 });

const generalCol = add(
  node({ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, ...(lg ? { width: 240 } : {}) }),
  title('General Enquiries'),
  link('hello@shader.se'),
  link('Book a call'),
);
const visitCol = add(
  node({ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, ...(lg ? { width: 240 } : {}) }),
  title('Visit us'),
  addressLine('Laxholmstorget 3'),
  addressLine('602 21 Norrköping'),
  addressLine('Sweden'),
);
const socialCol = add(
  node({ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, ...(lg ? { width: 240 } : {}) }),
  title('Social'),
  link('LinkedIn'),
  link('Instagram'),
  link('X (Twitter)'),
);
const visitSocialRow = add(
  node({ gap: 50, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', ...(lg ? { gap: 50 } : {}) }),
  visitCol,
  socialCol,
);
const introWidth = 480;
const intro = T("Contact us about your digital project idea or general enquires. Let's interface, call us today!", {
  font: 'regular', fontSize: lg ? 24 : 18, maxWidth: introWidth,
});
// intro 的换行需要 max 宽度约束 → 包一层 maxWidth 容器由 measure 拿到约束
const introWrap = node({ maxWidth: 480 });
introWrap.setMeasureFunc === introWrap.setMeasureFunc; // noop
// 直接把 maxWidth 交给文本节点测量：yoga 会以 min(maxWidth, available) 调 measure
add(introWrap, intro);

const cards = add(
  node({
    maxWidth: 1400, paddingY: 40, marginTop: lg ? 40 : 16, gap: 50,
    flexDirection: lg ? 'row' : 'column', alignItems: lg ? 'flex-start' : 'center',
  }),
  generalCol,
  visitSocialRow,
);
const ceoCard = add(
  node({ padding: 8, borderWidth: 2, ...(lg ? { marginTop: 80 } : {}) }),
  node(lg ? { gap: 24, width: 640, height: 180 } : { gap: 18 }), // 内容固定高，只影响自身
);
const ci = add(
  node({
    flexDirection: 'column', alignItems: 'center',
    paddingBottom: lg ? 60 : 32, paddingLeft: lg ? 0 : 30, paddingRight: lg ? 0 : 30,
  }),
  introWrap,
  cards,
  ceoCard,
);

// —— cg footer ——
const certOuterW = lg ? 160 : 144;
const certInnerW = CONTENT_BOX ? certOuterW : certOuterW - 32;
const certCol = add(node({ width: certOuterW, padding: 16 }), IMG('footer_certificate.png', certInnerW, certInnerW));
const copyW = xl ? 384 : lg ? 320 : 256;
const copyrightCol = add(node({ width: copyW }), IMG('copyright_footer.png', copyW, copyW));
const a11yW = xl ? 232 : lg ? 160 : 144;
const a11yInner = CONTENT_BOX ? a11yW : a11yW - 4;
const a11yCard = add(
  node({ justifyContent: 'flex-end', width: a11yW, borderWidth: 2 }),
  IMG('a11y.png', a11yInner, a11yInner),
);
const footer = add(
  node({
    flexDirection: lg ? 'row' : 'column-reverse',
    justifyContent: 'center', alignItems: 'center',
    paddingLeft: 64, paddingRight: 64, paddingTop: lg ? 96 : 64, paddingBottom: lg ? 96 : 64,
    borderTopWidth: 1,
  }),
  certCol,
  copyrightCol,
  add(node({ marginBottom: lg ? 0 : 48, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 32 }), a11yCard),
);

// —— Good buy 段 ——
const goodbuy = add(
  node({ flexDirection: 'column' }),
  add(
    node({ flexDirection: 'column' }),
    add(node({ flexDirection: 'column', paddingTop: 200 }), T('Good buy.', { font: 'medium', fontSize: lg ? 200 : 80 })),
    add(node({ flexDirection: 'column' }), ci), // 黑幕容器 zIndex2（布局透明）
  ),
  footer,
);

add(content, hello, goodbuy);
content.calculateLayout(WIDTH, undefined, YG.DIRECTION_LTR);

const h = content.getComputedHeight();
console.log(`viewport ${WIDTH}x${HEIGHT}  boxSizing=${tree.boxSizing}`);
console.log(`content column height = ${h.toFixed(2)} px`);
console.log(`d = ${(h / HEIGHT).toFixed(6)}   (static registry: ${TARGET_STATIC})`);
console.log(`delta vs static = ${(((h / HEIGHT) - TARGET_STATIC) / TARGET_STATIC * 100).toFixed(2)}%`);
// 分段高度诊断
for (const [label, n] of [['hello', hello], ['goodbuy', goodbuy], ['ci', ci], ['footer', footer], ['cards', cards], ['ceo', ceoCard]]) {
  console.log(`  ${label}: ${n.getComputedHeight().toFixed(1)}`);
}
