/**
 * uikit 渲染镜像 —— UIElement(yoga) 树 → three 对象。
 * 1:1 对照原站 lT/sp/ld 管线（_bundles/full/04kr7kd5riobb.js:24046 sf、26136 updateMeasurements、
 * 27777 globalMatrix、28028 updateWorldMatrix、27260 ld 渲染循环、28419 clippingRect）。
 *
 * 坐标语义：
 * - relativeCenter = (left + w/2 − pw/2, −(top + h/2 − ph/2))（04kr:26151-26153，y 已翻转为 three y-up）
 * - globalMatrix   = parentChain · T(rc.x·ps, rc.y·ps, 0)
 * - globalPanelMatrix = S(w·ps, h·ps, 1) · globalMatrix（sf，04kr:24046）
 * - mesh.matrix = globalPanelMatrix（挂 rootObject 下，matrixWorld = rootWorld · panel ✓）
 * - 字形批次 mesh 挂 rootObject 下 identity → matrixWorld = rootWorld；全变换在 instanceMatrix
 * - 文本 baseMatrix = globalMatrix（无尺寸缩放，文本可溢出盒子）
 *
 * 裁剪：overflow hidden 容器 → 内容盒（边框内）世界矩形 → 4 平面；父子取交（轴对齐）。
 */
import * as THREE from 'three/webgpu';
import type { UIElement } from './element.ts';
import { GlyphBatchManager, GlyphInstance, type GlyphBatchKey } from './glyphBatch.ts';
import { createPanelMaterial, packColor, packRadiusDigit, makeWhiteTexture, type PanelMaterialUniforms } from './panelMaterial.ts';
import { layoutTextLines, collapseWhitespace, glyphXOffset, glyphYOffset, verticalAlignOffset, textAlignOffset, type TextLine } from './text.ts';
import type { UIKitFont, GlyphInfo } from './font.ts';

export interface UIKitRendererOptions {
  /** px → 世界单位（原站 uU：根宽=viewportWidth 时为 1） */
  pixelSize?: number;
  /** 默认文本颜色（根 color 继承；原站 lightTextColor 实证 ≈ #F0F0F0） */
  color?: string | number;
}

interface WorldRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface TextState {
  batchKey: GlyphBatchKey;
  slots: (GlyphInstance | number)[][];
  lines: TextLine[];
  lastPropsKey: string;
}

interface NodeRecord {
  el: UIElement;
  parent: NodeRecord | null;
  /** 面板网格（容器/图片；纯文本元素为 null） */
  mesh: THREE.Mesh | null;
  uniforms: PanelMaterialUniforms | null;
  mapUrl: string | null;
  /** 文本渲染状态（__text 元素） */
  text: TextState | null;
  relativeCenter: [number, number];
  globalMatrix: THREE.Matrix4;
  panelMatrix: THREE.Matrix4;
  /** 自身 overflow hidden 的内容盒（世界空间） */
  clipRect: WorldRect | null;
}

const _m4 = new THREE.Matrix4();
const _m4b = new THREE.Matrix4();

export class UIKitRenderer {
  readonly rootObject: THREE.Group;
  readonly batches: GlyphBatchManager;
  private records = new Map<UIElement, NodeRecord>();
  private pixelSize: number;
  private rootColor: string | number;
  private fontTextures = new WeakMap<UIKitFont, THREE.Texture>();
  private imageTextures = new Map<string, THREE.Texture>();
  private _pendingImages = new Set<string>();
  private whiteTexture = makeWhiteTexture();
  private mountedRoot: UIElement | null = null;

  constructor(options: UIKitRendererOptions = {}) {
    this.rootObject = new THREE.Group();
    this.batches = new GlyphBatchManager(this.rootObject);
    this.pixelSize = options.pixelSize ?? 1;
    this.rootColor = options.color ?? '#f0f0f0';
  }

  /** 挂载/重挂载镜像（元素树结构变化时调用） */
  mount(root: UIElement): void {
    this.dispose();
    this.mountedRoot = root;
    // 先序号 = DOM 绘制序语义（原站 uM ol 透明排序）：无显式 renderOrder 时按先序画，
    // 保证父面板（背景）先于子内容，文字批次永远晚于其父面板
    this.preorderCounter = 0;
    this.buildRecord(root, null);
  }

  private preorderCounter = 0;

  private buildRecord(el: UIElement, parent: NodeRecord | null): NodeRecord {
    const rec: NodeRecord = {
      el,
      parent,
      mesh: null,
      uniforms: null,
      mapUrl: null,
      text: null,
      relativeCenter: [0, 0],
      globalMatrix: new THREE.Matrix4(),
      panelMatrix: new THREE.Matrix4(),
      clipRect: null,
    };
    this.records.set(el, rec);

    const isText = el.__textResolved != null || el.__text != null;
    const imageUrl = el.__image?.url ?? (typeof el.style.map === 'string' ? el.style.map : null);

    if (!isText) {
      // 面板：每个容器/图片一个（原站 lT 即 Mesh + sW 材质）
      const { material, uniforms } = createPanelMaterial({ withMap: true });
      const geo = new THREE.PlaneGeometry();
      geo.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1]), 4));
      const mesh = new THREE.Mesh(geo, material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.visible = false;
      // DOM 序：显式 renderOrder 优先，否则先序号（父先于子、先兄弟先画）
      mesh.renderOrder = (el.style.renderOrder as number) ?? this.preorderCounter++;
      const depthTest = el.style.depthTest ?? false;
      material.depthTest = depthTest;
      material.depthWrite = false;
      rec.mesh = mesh;
      rec.uniforms = uniforms;
      rec.mapUrl = imageUrl;
      this.rootObject.add(mesh);
    } else {
      // 文本：字形批次（depthTest 默认 false，04kr:26404）
      const depthTest = el.style.depthTest ?? false;
      const font = el.__textResolved!.font;
      const tex = this.getFontTexture(font);
      rec.text = {
        batchKey: {
          texture: tex,
          pageWidth: font.pageWidth,
          pageHeight: font.pageHeight,
          distanceRange: font.distanceRange,
          depthTest,
          depthWrite: false,
          renderOrder: (el.style.renderOrder as number) ?? this.preorderCounter++,
        },
        slots: [],
        lines: [],
        lastPropsKey: '',
      };
    }

    for (const child of el.children) this.buildRecord(child, rec);
    return rec;
  }

  /** 布局后调用：重算矩阵/面板数据/字形定位/裁剪 */
  update(): void {
    const root = this.mountedRoot;
    if (root == null) return;
    const rec = this.records.get(root);
    if (rec == null) return;
    const identity = new THREE.Matrix4();
    this.updateRecursive(rec, identity, null);
    this.batches.update();
  }

  /** px→世界换算系数更新（视口变化时；原站 uU：pixelSize = viewportWidth/width ≈ 0.007）。
   *  update() 每帧读 this.pixelSize 重算，无需额外置脏。 */
  setPixelSize(ps: number): void {
    this.pixelSize = ps;
  }

  private updateRecursive(rec: NodeRecord, parentChain: THREE.Matrix4, inheritedClip: WorldRect | null): void {
    const el = rec.el;
    const size = el.size;
    const w = size.width;
    const h = size.height;
    const ps = this.pixelSize;

    // relativeCenter（04kr:26151）
    const left = el.node.getComputedLeft();
    const top = el.node.getComputedTop();
    const parentSize = rec.parent ? rec.parent.el.size : null;
    const pw = parentSize ? parentSize.width : w;
    const ph = parentSize ? parentSize.height : h;
    const rcX = left + 0.5 * w - 0.5 * pw;
    const rcY = -(top + 0.5 * h - 0.5 * ph);
    rec.relativeCenter = [rcX, rcY];

    // globalMatrix = parentChain · T(rc·ps)
    rec.globalMatrix.copy(parentChain).multiply(_m4.makeTranslation(rcX * ps, rcY * ps, 0));

    // 内容盒（文本布局可用宽；yoga content-box：computed − padding − border）
    const padT = el.node.getComputedPadding(1);
    const padB = el.node.getComputedPadding(3);
    const padL = el.node.getComputedPadding(0);
    const padR = el.node.getComputedPadding(2);
    const bordT = el.node.getComputedBorder(1);
    const bordB = el.node.getComputedBorder(3);
    const bordL = el.node.getComputedBorder(0);
    const bordR = el.node.getComputedBorder(2);
    const contentW = Math.max(0, w - padL - padR - bordL - bordR);
    const contentH = Math.max(0, h - padT - padB - bordT - bordB);

    // ---- 面板 ----
    if (rec.mesh != null && rec.uniforms != null) {
      rec.panelMatrix.copy(_m4b.makeScale(w * ps, h * ps, 1)).premultiply(rec.globalMatrix);
      rec.mesh.matrix.copy(rec.panelMatrix);
      rec.mesh.matrixWorldNeedsUpdate = true;

      const u = rec.uniforms;
      const opacity = typeof el.style.opacity === 'number' ? el.style.opacity : 1;
      // 图片元素默认白底（原站 l6 Image materialConfig defaults {backgroundColor: 0xffffff}，04kr:28866）
      const bg = el.style.backgroundColor ?? (rec.mapUrl != null ? '#ffffff' : 'transparent');
      // data0 = 边框 insets（top,right,bottom,left，世界 px）
      u.data0.set(bordT * ps, bordR * ps, bordB * ps, bordL * ps);
      // data1 = bg rgba（sP：rgb + alpha×opacity）
      _tmpArr.fill(0);
      packColor(_tmpArr, 0, bg as any, opacity);
      u.data1.fromArray(_tmpArr);
      const bgAlpha = _tmpArr[3];
      // data2.x = radius 打包（四角一致；digit=ceil(r/h·100)），yzw = border rgb
      _tmpArr.fill(0);
      u.data2.toArray(_tmpArr);
      const radiusPx = el.style.borderRadius ?? 0;
      for (let d = 0; d < 4; d++) packRadiusDigit(_tmpArr, 0, d, radiusPx * ps, h * ps);
      _tmpBorderColorArr.fill(0);
      packColor(_tmpBorderColorArr, 0, (el.style.borderColor ?? 'transparent') as any, opacity);
      u.data2.set(_tmpArr[0], _tmpBorderColorArr[0], _tmpBorderColorArr[1], _tmpBorderColorArr[2]);
      // data3 = [borderAlpha, bend, w, h]
      u.data3.set(_tmpBorderColorArr[3], 0, w * ps, h * ps);

      // 可见性（computedIsVisible，04kr:24370）：bg 或 border 有 alpha；图片元素随 map 显示
      const bgVisible = bgAlpha > 0;
      const borderVisible = _tmpBorderColorArr[3] > 0 && (bordT > 0 || bordR > 0 || bordB > 0 || bordL > 0);
      const displayed = el.style.display !== 'none';
      rec.mesh.visible = displayed && (bgVisible || borderVisible || rec.mapUrl != null);

      // 贴图（未就绪时保持 whiteTexture + mapEnabled=0：WebGPU 下采样 image=undefined 的纹理会炸掉整个 pass）
      if (rec.mapUrl != null) {
        const tex = this.getImageTexture(rec.mapUrl);
        u.mapTexture.value = tex ?? this.whiteTexture;
        u.mapEnabled.value = tex != null ? 1 : 0;
      } else {
        u.mapEnabled.value = 0;
      }
    }

    // ---- 裁剪 ----
    // 自身 overflow hidden → 内容盒世界矩形（含边框内缩，04kr:28419）
    let ownClip: WorldRect | null = null;
    if (el.style.overflow === 'hidden' && contentW > 0 && contentH > 0) {
      // 内容盒中心（globalMatrix 空间，y-up）：x=(L−R)/2，y=−(T−B)/2
      const cx = (bordL - bordR) * 0.5 * ps;
      const cy = -(bordT - bordB) * 0.5 * ps;
      const pos = new THREE.Vector3(cx, cy, 0).applyMatrix4(rec.globalMatrix);
      const hw = (contentW * ps) / 2;
      const hh = (contentH * ps) / 2;
      ownClip = { minX: pos.x - hw, maxX: pos.x + hw, minY: pos.y - hh, maxY: pos.y + hh };
    }
    const effectiveClip = intersectRect(inheritedClip, ownClip);
    rec.clipRect = effectiveClip;

    // 面板裁剪 uniform
    if (rec.mesh != null && rec.uniforms != null) {
      setClipUniforms(rec.uniforms.clip, effectiveClip);
    }

    // ---- 文本 ----
    if (rec.text != null && el.__textResolved != null) {
      this.updateText(rec, contentW, contentH, effectiveClip);
    }

    // ---- 子节点：childrenMatrix = globalMatrix（contact 无滚动容器） ----
    for (const child of el.children) {
      const childRec = this.records.get(child);
      if (childRec != null) this.updateRecursive(childRec, rec.globalMatrix, effectiveClip);
    }
  }

  /** ld 渲染循环（04kr:27377-27462）1:1 */
  private updateText(rec: NodeRecord, availableWidth: number, availableHeight: number, clip: WorldRect | null): void {
    const el = rec.el;
    const p = el.__textResolved!;
    const st = rec.text!;
    const text = collapseWhitespace(p.text);
    const propsKey = `${text}|${p.fontSize}|${p.letterSpacing}|${p.lineHeight}|${p.textAlign}|${p.verticalAlign}|${availableWidth}|${availableHeight}`;
    if (propsKey !== st.lastPropsKey) {
      st.lastPropsKey = propsKey;
      st.lines = layoutTextLines(
        {
          text,
          font: p.font,
          fontSize: p.fontSize,
          letterSpacing: p.letterSpacing,
          lineHeight: p.lineHeight,
        },
        availableWidth,
      );
    }

    const batch = this.batches.getBatch(st.batchKey);
    const lines = st.lines;
    const lineCount = lines.length;

    // 对齐参数
    let va = p.verticalAlign;
    va = va === 'center' ? 'middle' : va;
    const A = verticalAlignOffset(availableHeight, lineCount, p.lineHeight, va) - availableHeight / 2;

    const opacity = typeof el.style.opacity === 'number' ? el.style.opacity : 1;
    const visible = opacity > 0.01 && el.style.display !== 'none';

    // 行槽位数组扩到行数
    while (st.slots.length < lineCount) st.slots.push([]);
    const clipTuple = rectToTuple(clip);

    let lineA = A;
    for (let li = 0; li < lineCount; li++) {
      const line = lines[li];
      const slotLine = st.slots[li];
      const fullAvail = availableWidth;
      const lineAvail = line.availableWidth ?? fullAvail;
      const align = p.textAlign;
      const justifyExtra = align === 'justify' && line.whitespacesBetween > 0 ? (lineAvail - line.nonWhitespaceWidth) / line.whitespacesBetween : 0;
      let indent: number;
      if (align === 'right') indent = fullAvail / 2 - lineAvail;
      else if (align === 'center') indent = -lineAvail / 2;
      else indent = -fullAvail / 2;
      let x = textAlignOffset(lineAvail, line.nonWhitespaceWidth, align === 'justify' ? 'left' : align) + indent;

      const charCount = line.charLength;
      let prevId: number | undefined;
      for (let i = 0; i < charCount; i++) {
        const charIndex = line.charIndexOffset + i;
        const ch = text[charIndex];
        if (ch === undefined) break;
        const glyph = p.font.glyph(ch);
        const slotIdx = i;
        const isSpace = ch === ' ' || charIndex > line.nonWhitespaceCharLength + line.charIndexOffset;
        if (isSpace) {
          // 占位数字槽（caret/selection 用；渲染无实例）
          const px = x + glyphXOffset(p.font, p.fontSize, glyph, prevId);
          const cur = slotLine[slotIdx];
          if (cur != null && typeof cur !== 'number') cur.hide();
          slotLine[slotIdx] = px;
          x += justifyExtra + glyph.xadvance * p.fontSize + p.letterSpacing;
          prevId = glyph.id;
          continue;
        }
        let g = slotLine[slotIdx];
        if (g == null || typeof g === 'number') {
          g = batch.createInstance();
          slotLine[slotIdx] = g;
        }
        g = g as GlyphInstance;
        const gx = x + glyphXOffset(p.font, p.fontSize, glyph, prevId);
        const gy = -(lineA + glyphYOffset(p.fontSize, p.lineHeight, glyph));
        g.updateGlyphAndTransformation(glyph as GlyphInfo & { renderSolid: boolean }, gx, gy, p.fontSize, this.pixelSize);
        g.updateBaseMatrix(rec.globalMatrix);
        g.updateColor(this.resolveColor(el), opacity);
        g.updateClippingRect(clipTuple);
        if (visible) g.show();
        else g.hide();
        x += glyph.xadvance * p.fontSize + p.letterSpacing;
        prevId = glyph.id;
      }
      // 截断多余槽位（04kr:27456）
      for (let i = charCount; i < slotLine.length; i++) {
        const s = slotLine[i];
        if (s != null && typeof s !== 'number') (s as GlyphInstance).hide();
      }
      slotLine.length = charCount;
      lineA += p.lineHeight;
    }
    // 隐藏多余行
    for (let li = lineCount; li < st.slots.length; li++) {
      for (const s of st.slots[li]) {
        if (s != null && typeof s !== 'number') (s as GlyphInstance).hide();
      }
    }
    st.slots.length = lineCount;
  }

  private resolveColor(el: UIElement): string | number {
    let cur: UIElement | null = el;
    while (cur != null) {
      if (cur.style.color != null) return cur.style.color;
      cur = cur.parent;
    }
    return this.rootColor;
  }

  getFontTexture(font: UIKitFont): THREE.Texture {
    let tex = this.fontTextures.get(font);
    if (tex == null) {
      tex = new THREE.TextureLoader().load(font.pageUrl);
      tex.flipY = false;
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      this.fontTextures.set(font, tex);
    }
    return tex;
  }

  getImageTexture(url: string): THREE.Texture | null {
    let tex = this.imageTextures.get(url);
    if (tex != null) return tex;
    if (this._pendingImages.has(url)) return null;
    if (url.endsWith('.svg')) {
      // SVG 光栅化：Image → canvas → CanvasTexture
      this._pendingImages.add(url);
      const img = new Image();
      img.src = url;
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      const tex2 = new THREE.CanvasTexture(canvas);
      tex2.colorSpace = THREE.SRGBColorSpace;
      img
        .decode()
        .then(() => {
          ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
          tex2.needsUpdate = true;
          this.imageTextures.set(url, tex2);
        })
        .catch(() => {})
        .finally(() => this._pendingImages.delete(url));
    } else {
      this._pendingImages.add(url);
      new THREE.TextureLoader().load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          this.imageTextures.set(url, t);
          this._pendingImages.delete(url);
        },
        undefined,
        () => this._pendingImages.delete(url),
      );
    }
    return null;
  }

  /** 元素面板 uniforms（动态改 backgroundColor 等；非面板/未挂载 → null） */
  getPanelUniforms(el: UIElement): PanelMaterialUniforms | null {
    return this.records.get(el)?.uniforms ?? null;
  }

  /** 元素世界矩形（中心 + 宽高，世界单位；布局未算 → null） */
  getElementWorldRect(el: UIElement): { cx: number; cy: number; w: number; h: number } | null {
    const rec = this.records.get(el);
    if (rec == null || rec.el.size.width === 0) return null;
    const e = rec.globalMatrix.elements;
    // 无旋转（uikit 常态）：平移 = [12,13]，尺寸 = el.size × ps
    return {
      cx: e[12],
      cy: e[13],
      w: rec.el.size.width * this.pixelSize,
      h: rec.el.size.height * this.pixelSize,
    };
  }

  dispose(): void {
    for (const rec of this.records.values()) {
      if (rec.text != null) {
        for (const line of rec.text.slots) {
          for (const s of line) {
            if (s != null && typeof s !== 'number') (s as GlyphInstance).hide();
          }
        }
      }
      if (rec.mesh != null) {
        this.rootObject.remove(rec.mesh);
        rec.mesh.geometry.dispose();
        (rec.mesh.material as THREE.Material).dispose();
      }
    }
    this.batches.dispose();
    this.records.clear();
    this.mountedRoot = null;
  }
}

const _tmpArr = new Float32Array(16);
const _tmpBorderColorArr = new Float32Array(4);

function intersectRect(a: WorldRect | null, b: WorldRect | null): WorldRect | null {
  if (a == null) return b;
  if (b == null) return a;
  return {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minY: Math.max(a.minY, b.minY),
    maxY: Math.min(a.maxY, b.maxY),
  };
}

/** 矩形 → 字形裁剪元组 (topY, rightX, bottomY, leftX)（世界空间，轴对齐） */
function rectToTuple(rect: WorldRect | null): [number, number, number, number] | null {
  if (rect == null) return null;
  return [rect.maxY, rect.maxX, rect.minY, rect.minX];
}

function setClipUniforms(planes: THREE.Vector4[], rect: WorldRect | null): void {
  if (rect == null) {
    for (const p of planes) p.set(-1, 0, 0, 1e7);
    return;
  }
  // 顺序与 rectToPlanes 一致：top/right/bottom/left
  planes[0].set(0, -1, 0, rect.maxY);
  planes[1].set(-1, 0, 0, rect.maxX);
  planes[2].set(0, 1, 0, -rect.minY);
  planes[3].set(1, 0, 0, -rect.minX);
}
