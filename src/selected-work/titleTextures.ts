/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import { SELECTED_PROJECTS, type SelectedProject } from './data';

/**
 * 棱柱标题的 4 张离屏文字贴图
 *
 * 线上实现是 4 个 R3F 离屏场景（ProjectReelText），每张 FBO 画一条「标题 + 副标题 ·
 * View project →」横条，再按面分给棱柱的 4 个侧面。这里用 Canvas2D 画同一套版式：
 *  - 画布宽高比 = 棱柱面宽高比，内容按 540 单位虚拟高度排版（见 LAYOUT_HEIGHT）
 *  - 标题 180px / line-height .9；副标题行 48px（<1024px 时 72）、圆点 16px（左右 32、
 *    上抬 26）、View project 与 42px 箭头（箭头左 8、上抬 24）
 *  - 背景透明，透明区域的 alpha 直接作为棱柱面的可见度（原版 `n.a * opacity`）
 */
export interface TitleTextureSet {
  textures: THREE.CanvasTexture[];
  /** 视口尺寸变化时重建画布与排版（面宽高比来自棱柱公式） */
  setSize: (cssWidth: number, cssHeight: number, faceAspect: number) => void;
  /** 设置某个面槽位显示哪个项目（-1 = 空） */
  setProject: (slot: number, projectIndex: number) => void;
  /** 字体加载完成等时机强制重绘 */
  redraw: () => void;
  dispose: () => void;
}

const FONT_FAMILY = '"STIX Two Text", "Times New Roman", serif';
const ARROW_SRC = '/textures/icons/arrow_right_white.svg';
/**
 * 排版坐标高度（虚拟单位）
 *
 * 棱柱面的纹理坐标是「整面 = 整张贴图」。线上标题 FBO 用 180 号字时，
 * 文字实际高度约占面的 1/3；若直接把 180px 画进按面宽高比生成的小画布，
 * 文字会撑爆画布。这里把贴图排版统一到 540 单位的虚拟高度，
 * 再整体缩放绘制 —— 这样字号、行距、圆点/箭头尺寸可以沿用原件数值。
 */
const LAYOUT_HEIGHT = 540;

const makeArrow = () => {
  const img = new Image();
  img.decoding = 'async';
  img.src = ARROW_SRC;
  return img;
};

/** 圆角矩形路径（标题行里的圆点是正圆，这里只用来画箭头底板，保持工具简单） */
const drawCircle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

export function createTitleTextureSet(): TitleTextureSet {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const canvases = Array.from({ length: 4 }, () => document.createElement('canvas'));
  const textures = canvases.map((canvas) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
  const slotProjects = [-1, -1, -1, -1];
  const arrow = makeArrow();

  let cssW = 1;
  let cssTitleFont = 180;

  const drawSlot = (slot: number) => {
    const canvas = canvases[slot];
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const project: SelectedProject | undefined =
      slotProjects[slot] >= 0 ? SELECTED_PROJECTS[slotProjects[slot]] : undefined;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!project) {
      textures[slot].needsUpdate = true;
      return;
    }

    // 虚拟排版：面高固定 540 单位，整体缩放到贴图像素
    const pxPerUnit = canvas.height / LAYOUT_HEIGHT;
    ctx.setTransform(pxPerUnit, 0, 0, pxPerUnit, 0, 0);
    const W = canvas.width / pxPerUnit;
    const H = LAYOUT_HEIGHT;

    const rowFont = cssW < 1024 ? 58 : 40;
    const marginTop = 14;
    const titleLine = cssTitleFont * 0.9;
    const arrowSize = 34;
    const rowH = Math.max(rowFont, arrowSize);
    const totalH = titleLine + marginTop + rowH;
    const top = H / 2 - totalH / 2;

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题（过长时等比缩小，避免被画布裁掉）
    let fontPx = cssTitleFont;
    const maxTitleW = W - 24;
    ctx.font = `400 ${fontPx}px ${FONT_FAMILY}`;
    const measured = ctx.measureText(project.title).width;
    if (measured > maxTitleW) {
      fontPx = Math.max(48, fontPx * (maxTitleW / measured));
      ctx.font = `400 ${fontPx}px ${FONT_FAMILY}`;
    }
    ctx.fillText(project.title, W / 2, top + titleLine / 2);

    // 副标题行：subtitle · [dot] · View project [→]
    ctx.font = `400 ${rowFont}px ${FONT_FAMILY}`;
    const subtitleW = ctx.measureText(project.subtitle).width;
    const viewW = ctx.measureText('View project').width;
    const dotSize = 13;
    const dotMarginX = 26;
    const arrowMarginLeft = 6.5;
    const rowW = subtitleW + dotMarginX + dotSize + dotMarginX + viewW + arrowMarginLeft + arrowSize;
    const rowLeft = W / 2 - rowW / 2;
    const rowCenter = top + titleLine + marginTop + rowH / 2;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const subtitleX = rowLeft;
    ctx.fillText(project.subtitle, subtitleX, rowCenter);

    const dotCx = subtitleX + subtitleW + dotMarginX + dotSize / 2;
    // marginBottom 26 → 视觉中心上移 13
    drawCircle(ctx, dotCx, rowCenter - 10.5, dotSize / 2);

    const viewX = dotCx + dotSize / 2 + dotMarginX;
    ctx.fillText('View project', viewX, rowCenter);

    const arrowX = viewX + viewW + arrowMarginLeft;
    if (arrow.complete && arrow.naturalWidth > 0) {
      ctx.drawImage(arrow, arrowX, rowCenter - 10 - arrowSize / 2, arrowSize, arrowSize);
    } else {
      // 箭头图未就绪时用文字箭头占位（加载完成后会重绘）
      ctx.font = `400 ${rowFont}px ${FONT_FAMILY}`;
      ctx.fillText('→', arrowX, rowCenter);
    }

    textures[slot].needsUpdate = true;
  };

  arrow.addEventListener('load', () => {
    for (let i = 0; i < 4; i++) drawSlot(i);
  });

  return {
    textures,
    setSize(width: number, _height: number, aspect: number) {
      cssW = Math.max(1, width);
      const faceAspect = Math.max(0.1, aspect);
      // 按参考截图校准：约 0.82 × 原件 180 CSS px
      cssTitleFont = cssW < 1024 ? 98 : 148;
      // 贴图横跨整个棱柱面（屏上约 1130px 宽），按视口宽 × dpr 取分辨率并限制上限，
      // 避免超宽屏把四张画布推到显存不可承受的尺寸。
      const pxW = Math.max(512, Math.min(2048, Math.round(cssW * dpr)));
      const pxH = Math.max(64, Math.round(pxW / faceAspect));
      for (const canvas of canvases) {
        if (canvas.width !== pxW || canvas.height !== pxH) {
          canvas.width = pxW;
          canvas.height = pxH;
        }
      }
      for (let i = 0; i < 4; i++) drawSlot(i);
    },
    setProject(slot: number, projectIndex: number) {
      if (slotProjects[slot] === projectIndex) return;
      slotProjects[slot] = projectIndex;
      drawSlot(slot);
    },
    redraw() {
      for (let i = 0; i < 4; i++) drawSlot(i);
    },
    dispose() {
      for (const tex of textures) tex.dispose();
    },
  };
}
