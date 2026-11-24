/**
 * uikit 元素树（yoga 封装）—— 语义对照原站 lT/lW/l1/l6 + o_（_bundles/full/04kr7kd5riobb.js）。
 * 关键实证：yoga 节点用 CONTENT-BOX（离线探针 1600×1200 vs 原站静态页长 −0.12%）；
 * 断点 {sm:640, md:768, lg:1024, xl:1280, "2xl":1536}（04kr:21681），min-width 语义。
 */
import YGPackage from 'yoga-layout';
import type * as THREE from 'three/webgpu';
import { createTextMeasurer, MeasureMode, resolveLineHeight, type TextMeasurer } from './text.ts';
import type { UIKitFont } from './font.ts';

const YG = (YGPackage as any).default ?? YGPackage;

export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 } as const;
export type BreakpointKey = keyof typeof BREAKPOINTS;

export type Responsive<T> = T | { base?: T; sm?: T; md?: T; lg?: T; xl?: T; '2xl'?: T };

export function resolveResponsive<T>(value: Responsive<T> | undefined, width: number): T | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return value as T;
  const layers = value as { base?: T; sm?: T; md?: T; lg?: T; xl?: T; '2xl'?: T };
  // 标量层（fontSize/lineHeight/gap 等响应式标量）：按断点取层值本身；
  // 样式对象层（navBar 既有用法）：按断点合并 partial style。以 base 层类型区分。
  const scalarLayers = typeof (layers as any).base !== 'object';
  let out: T | undefined = layers.base;
  for (const key of ['sm', 'md', 'lg', 'xl', '2xl'] as const) {
    if (width >= BREAKPOINTS[key] && layers[key] != null) {
      out = scalarLayers ? layers[key] : ({ ...(out as any), ...(layers[key] as any) } as T);
    }
  }
  return out;
}

export interface StyleProps {
  flexDirection?: 'column' | 'row' | 'column-reverse' | 'row-reverse';
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around';
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  flexGrow?: number;
  flexShrink?: number;
  gap?: number;
  width?: number | 'auto' | '100%';
  height?: number | 'auto' | '100%';
  maxWidth?: number;
  minWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingX?: number;
  paddingY?: number;
  margin?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  /** 上下 margin（'auto' → yoga setMarginAuto，原站 marginY:"auto" 垂直居中语义） */
  marginY?: number | 'auto';
  borderWidth?: number;
  borderTopWidth?: number;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  borderRightWidth?: number;
  positionType?: 'relative' | 'absolute';
  /** absolute 定位边（原站 Ew 菜单面板 top60/right8；yoga setPosition） */
  positionTop?: number;
  positionRight?: number;
  positionBottom?: number;
  positionLeft?: number;
  display?: 'flex' | 'none';
  // ---- 视觉属性（renderer.ts 消费；对照原站 oG 默认值 04kr:26399） ----
  backgroundColor?: string | number;
  borderColor?: string | number;
  /** 统一圆角 px（四角一致；原站打包序 BL,BR,TR,TL 一致时无歧义） */
  borderRadius?: number;
  /** 文本颜色（子元素继承） */
  color?: string | number;
  /** 元素不透明度（面板=整体；文本=字形） */
  opacity?: number;
  /** 纵横比（yoga setAspectRatio；width/height 一侧定值时另一侧按比值，原站媒体卡 p1 实证） */
  aspectRatio?: number;
  renderOrder?: number;
  zIndex?: number;
  /** 原站默认 false（04kr:26404） */
  depthTest?: boolean;
  overflow?: 'visible' | 'hidden';
  /** 面板背景贴图（dashed_frame.svg / 页脚 PNG 等，拉伸铺满） */
  map?: string;
}

export interface MeasureResult {
  width: number;
  height: number;
}

type SizeListener = (size: { width: number; height: number }) => void;

export class UIElement {
  readonly node: any;
  style: StyleProps;
  children: UIElement[] = [];
  parent: UIElement | null = null;
  measurer: TextMeasurer | null = null;
  private sizeListeners = new Set<SizeListener>();
  private lastSize: { width: number; height: number } = { width: 0, height: 0 };

  constructor(style: StyleProps = {}, measurer: TextMeasurer | null = null) {
    this.style = style;
    this.measurer = measurer;
    this.node = YG.Node.create();
    this.node.setBoxSizing(YG.BOX_SIZING_CONTENT_BOX);
  }

  static container(style: StyleProps = {}): UIElement {
    return new UIElement(style);
  }

  static text(
    text: string,
    opts: {
      font: UIKitFont;
      fontSize: Responsive<number>;
      letterSpacing?: Responsive<number>;
      lineHeight?: Responsive<number | string>;
      textAlign?: 'left' | 'center' | 'right' | 'justify';
      verticalAlign?: 'top' | 'middle' | 'center' | 'bottom';
    },
    style: StyleProps = {},
  ): UIElement {
    const el = new UIElement(style, null);
    el.__text = { text, ...opts };
    return el;
  }

  /** 图片：内容宽 w、纵横比 aspect → 高度 = w*aspect（定宽定高，contact 全部为固定尺寸图片） */
  static image(contentWidth: number, aspect: number, style: StyleProps = {}, url?: string): UIElement {
    const el = new UIElement({ width: contentWidth, ...style, height: (style.height as number) ?? contentWidth * aspect }, null);
    if (url) el.__image = { url };
    return el;
  }

  __image?: { url: string };

  /**
   * mesh 槽位（原站 uF/nf 模式，04kr:62390：uk 容器 → uF absolute inset0 → nf mesh）。
   * 宿主 mesh 由 renderer 摆到该元素的布局矩形（globalPanelMatrix），材质任意（TSL）。
   */
  __meshSlot?: { mesh: THREE.Mesh };

  /** 静态工厂：mesh 槽位元素（布局占位 + 宿主 mesh） */
  static meshSlot(mesh: THREE.Mesh, style: StyleProps = {}): UIElement {
    const el = new UIElement(style, null);
    el.__meshSlot = { mesh };
    return el;
  }

  /** applyViewport 解析后的文本渲染参数（renderer.ts 消费） */
  __textResolved?: {
    text: string;
    font: UIKitFont;
    fontSize: number;
    letterSpacing: number;
    lineHeight: number;
    textAlign: 'left' | 'center' | 'right' | 'justify';
    verticalAlign: 'top' | 'middle' | 'center' | 'bottom';
  };

  __text?: {
    text: string;
    font: UIKitFont;
    fontSize: Responsive<number>;
    letterSpacing?: Responsive<number>;
    lineHeight?: Responsive<number | string>;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    verticalAlign?: 'top' | 'middle' | 'center' | 'bottom';
  };

  add(...children: UIElement[]): this {
    for (const c of children) {
      c.parent = this;
      this.children.push(c);
      this.node.insertChild(c.node, this.children.length - 1);
    }
    return this;
  }

  onSize(cb: SizeListener): () => void {
    this.sizeListeners.add(cb);
    return () => this.sizeListeners.delete(cb);
  }

  /** 以视口宽 W 构建/重建样式与 measure（断点解析）；返回是否需要重排 */
  applyViewport(width: number): void {
    applyStyle(this, width);
    if (this.__text) {
      const fontSize = resolveResponsive(this.__text.fontSize, width)!;
      const letterSpacing = resolveResponsive(this.__text.letterSpacing, width) ?? 0;
      const lineHeightRaw = resolveResponsive(this.__text.lineHeight, width);
      const lineHeight = resolveLineHeight(lineHeightRaw, fontSize);
      this.__textResolved = {
        text: this.__text.text,
        font: this.__text.font,
        fontSize,
        letterSpacing,
        lineHeight,
        textAlign: this.__text.textAlign ?? 'left',
        verticalAlign: this.__text.verticalAlign ?? 'middle',
      };
      // createTextMeasurer 内部自行解析 lineHeight（此处传原始值，避免二次乘 fontSize）
      const m = createTextMeasurer({ text: this.__text.text, font: this.__text.font, fontSize, letterSpacing, lineHeight: lineHeightRaw });
      this.measurer = m;
      this.node.setMeasureFunc((w: number, wm: number) => {
        const mode = wm === 0 ? MeasureMode.UNDEFINED : wm === 1 ? MeasureMode.EXACTLY : MeasureMode.AT_MOST;
        return m.measure(w, mode);
      });
    } else {
      this.node.setMeasureFunc(null);
      this.__textResolved = undefined;
    }
    for (const c of this.children) c.applyViewport(width);
  }

  calculateLayout(width: number | undefined, height?: number | undefined): void {
    this.node.calculateLayout(width ?? undefined, height ?? undefined, YG.DIRECTION_LTR);
    this.propagateSize();
  }

  private propagateSize(): void {
    const w = this.node.getComputedWidth();
    const h = this.node.getComputedHeight();
    if (w !== this.lastSize.width || h !== this.lastSize.height) {
      this.lastSize = { width: w, height: h };
      for (const cb of this.sizeListeners) cb(this.lastSize);
    }
    for (const c of this.children) (c as any).propagateSize?.();
  }

  get size(): { width: number; height: number } {
    return { width: this.node.getComputedWidth(), height: this.node.getComputedHeight() };
  }

  /** 布局后的字形几何占位（M3 渲染层消费）；此处仅尺寸语义 */
  getComputedHeight(): number {
    return this.node.getComputedHeight();
  }
  getComputedWidth(): number {
    return this.node.getComputedWidth();
  }
}

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function applyStyle(el: UIElement, viewportWidth: number): void {
  const s = el.style;
  const n = el.node;
  const S = YG;
  const r = <T,>(v: Responsive<T> | undefined): T | undefined => resolveResponsive(v, viewportWidth);

  n.setFlexDirection(
    s.flexDirection === 'row' ? S.FLEX_DIRECTION_ROW
    : s.flexDirection === 'column-reverse' ? S.FLEX_DIRECTION_COLUMN_REVERSE
    : s.flexDirection === 'row-reverse' ? S.FLEX_DIRECTION_ROW_REVERSE
    : S.FLEX_DIRECTION_COLUMN,
  );
  if (s.justifyContent) n.setJustifyContent({ 'flex-start': S.JUSTIFY_FLEX_START, center: S.JUSTIFY_CENTER, 'flex-end': S.JUSTIFY_FLEX_END, 'space-between': S.JUSTIFY_SPACE_BETWEEN, 'space-around': S.JUSTIFY_SPACE_AROUND }[s.justifyContent]);
  if (s.alignItems) n.setAlignItems({ 'flex-start': S.ALIGN_FLEX_START, center: S.ALIGN_CENTER, 'flex-end': S.ALIGN_FLEX_END, stretch: S.ALIGN_STRETCH }[s.alignItems]);
  if (num(s.flexGrow)) n.setFlexGrow(s.flexGrow!);
  if (num(s.flexShrink)) n.setFlexShrink(s.flexShrink!);
  const gap = r(s.gap as any) ?? s.gap;
  if (num(gap)) n.setGap(S.GUTTER_ALL, gap);
  if (s.positionType === 'absolute') n.setPositionType(S.POSITION_TYPE_ABSOLUTE);
  else n.setPositionType(S.POSITION_TYPE_RELATIVE);
  if (s.positionType === 'absolute') {
    if (num(s.positionTop)) n.setPosition(S.EDGE_TOP, s.positionTop);
    if (num(s.positionRight)) n.setPosition(S.EDGE_RIGHT, s.positionRight);
    if (num(s.positionBottom)) n.setPosition(S.EDGE_BOTTOM, s.positionBottom);
    if (num(s.positionLeft)) n.setPosition(S.EDGE_LEFT, s.positionLeft);
  }
  if (s.display === 'none') n.setDisplay(S.DISPLAY_NONE);
  else n.setDisplay(S.DISPLAY_FLEX);

  // 尺寸（数字直接定；'100%' 透传 yoga 百分比；图片 '100%' 由 measure 动态给）
  const width = r(s.width as any) ?? s.width;
  if (num(width)) n.setWidth(width);
  else if (width === '100%') n.setWidth('100%');
  else n.setWidthAuto();
  const height = r(s.height as any) ?? s.height;
  if (num(height)) n.setHeight(height);
  else if (height === '100%') n.setHeight('100%');
  else n.setHeightAuto();
  const maxWidth = r(s.maxWidth as any) ?? s.maxWidth;
  if (num(maxWidth)) n.setMaxWidth(maxWidth);
  const minWidth = r(s.minWidth as any) ?? s.minWidth;
  if (num(minWidth)) n.setMinWidth(minWidth);
  const minHeight = r(s.minHeight as any) ?? s.minHeight;
  if (num(minHeight)) n.setMinHeight(minHeight);
  const maxHeight = r(s.maxHeight as any) ?? s.maxHeight;
  if (num(maxHeight)) n.setMaxHeight(maxHeight);
  // 纵横比（媒体卡：height 100% + aspectRatio → 宽度由 yoga 按比值算）
  if (num(s.aspectRatio)) n.setAspectRatio(s.aspectRatio);

  // padding：先 ALL 再具体边覆盖（与原站属性覆盖序一致）
  const pad = (edge: number, v: unknown) => num(v) && n.setPadding(edge, v);
  const p = s.padding;
  pad(S.EDGE_ALL, p);
  pad(S.EDGE_TOP, s.paddingTop ?? s.paddingY);
  pad(S.EDGE_BOTTOM, s.paddingBottom ?? s.paddingY);
  pad(S.EDGE_LEFT, s.paddingLeft ?? s.paddingX);
  pad(S.EDGE_RIGHT, s.paddingRight ?? s.paddingX);
  // margin（允许负值）
  const marg = (edge: number, v: unknown) => num(v) && n.setMargin(edge, v);
  marg(S.EDGE_ALL, s.margin);
  marg(S.EDGE_TOP, s.marginTop);
  marg(S.EDGE_BOTTOM, s.marginBottom);
  marg(S.EDGE_LEFT, s.marginLeft);
  marg(S.EDGE_RIGHT, s.marginRight);
  if (s.marginY === 'auto') {
    n.setMarginAuto(S.EDGE_TOP);
    n.setMarginAuto(S.EDGE_BOTTOM);
  } else {
    marg(S.EDGE_TOP, s.marginY);
    marg(S.EDGE_BOTTOM, s.marginY);
  }
  // border
  const bord = (edge: number, v: unknown) => num(v) && n.setBorder(edge, v);
  bord(S.EDGE_ALL, s.borderWidth);
  bord(S.EDGE_TOP, s.borderTopWidth);
  bord(S.EDGE_BOTTOM, s.borderBottomWidth);
  bord(S.EDGE_LEFT, s.borderLeftWidth);
  bord(S.EDGE_RIGHT, s.borderRightWidth);
}

/** uN 等价物：订阅元素尺寸（04kr:31845） */
export function onElementSize(el: UIElement, cb: (size: { width: number; height: number }) => void): () => void {
  return el.onSize(cb);
}
