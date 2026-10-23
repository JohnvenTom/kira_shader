/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';

/**
 * 全站 UI 的 canvas 烘焙层（原件 uikit 的复刻路径）
 *
 * 原件把全部 chrome UI（header / 导航 / 箭头 / 提示 / 菜单 / Contact 文案）画进
 * canvas 纹理，在合成 pass 的场景着色器里按**桶形畸变后的 uv** 采样
 * （`.decomp/ui-kit.txt`：`a = Aj(uv, lens, border)`、light/dark 由 uiModeTransition
 * 混合、`s *= clamp(uiTransition,0,1)`、logo 区(x<240,y<96)与 pageAction 区
 * (x>w−220,y<96) 的 hover 各提亮 1+0.25·hover）。本模块产出：
 *  - light/dark 两张全屏 CanvasTexture（变体由主题决定，不是明暗两套元素）
 *  - 区域表（CSS px）：绘制位置与命中测试同源，着色器 hover 区域与它一致
 *  - hitTest：CSS 像素 → 区域 key（畸变反解的精确命中在交互层做二次校正）
 *
 * 与 DOM 版的数值对应关系见 selected-work.css / about.css（同源照抄）。
 */

export type UiRegionKey =
  | 'logo' | 'navHome' | 'navWork' | 'navAbout' | 'navContact'
  | 'book' | 'burger' | 'prevArrow' | 'nextArrow' | 'hint'
  | 'menuHome' | 'menuWork' | 'menuAbout' | 'menuContact' | 'menuBook';

export interface UiRect { x: number; y: number; w: number; h: number }

export interface UiDrawState {
  /** 当前页 UI 集：work（箭头+提示）/ about（纸页 chrome）/ tie（tie 文案）/ contact（仅 header，正文在 3D 长列） */
  page: 'work' | 'about' | 'tie' | 'contact';
  activeNav: string;
  mobile: boolean;
  /** work 页箭头/提示淡出 0..1（原站 uiPageOffset 尾段的 --sw-ui-fade） */
  fade: number;
  menuOpen: boolean;
  time: number;
  /** 显示主题阻尼值（0 light → 1 dark），决定命中表取哪一层 */
  mode: number;
  /** tie 文案透明度 */
  tieCopy: number;
}

export interface UiCanvasHandle {
  lightTexture: THREE.CanvasTexture;
  darkTexture: THREE.CanvasTexture;
  regions: Partial<Record<UiRegionKey, UiRect>>;
  /** 当前帧可见的区域表（随 page/menuOpen 变化） */
  visibleRegions: () => Partial<Record<UiRegionKey, UiRect>>;
  draw: (state: UiDrawState) => void;
  /** CSS 像素命中测试；无命中返回 null */
  hitTest: (cssX: number, cssY: number) => UiRegionKey | null;
  setSize: (cssW: number, cssH: number) => void;
  dispose: () => void;
}

const NAV = [
  { key: 'home', label: 'Home', region: 'navHome' as UiRegionKey, menu: 'menuHome' as UiRegionKey },
  { key: 'work', label: 'Selected Work', region: 'navWork' as UiRegionKey, menu: 'menuWork' as UiRegionKey },
  { key: 'about', label: 'About Us', region: 'navAbout' as UiRegionKey, menu: 'menuAbout' as UiRegionKey },
  { key: 'contact', label: 'Contact', region: 'navContact' as UiRegionKey, menu: 'menuContact' as UiRegionKey },
];

const ASSETS = {
  logoLight: '/logo-shader.svg',
  logoDark: '/textures/logo_dark.svg',
  phoneLight: '/textures/icons/old_phone.svg',
  phoneDark: '/textures/icons/old_phone_dark.svg',
  arrow: '/textures/icons/arrow_right_white.svg',
  hand: '/textures/icons/pointing_hand_light.svg',
  filip: '/textures/about/filip_footer_5.webp',
};

const SERIF = "'STIX Two Text', 'Times New Roman', serif";
/** UI 主题墨色：light 变体 = 亮字（深场景上），dark 变体 = 纸页深字 */
const INK = { light: '#fdfdf5', dark: '#171310' };

export function createUiCanvas(cssW: number, cssH: number): UiCanvasHandle {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let W = Math.max(1, cssW);
  let H = Math.max(1, cssH);
  let pxW = Math.floor(W * dpr);
  let pxH = Math.floor(H * dpr);

  const makeLayer = () => {
    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    return { canvas, ctx, tex };
  };
  const light = makeLayer();
  const dark = makeLayer();

  // ---------- 资产 ----------
  const imgs: Record<string, HTMLImageElement> = {};
  let assetsReady = false;
  let dirty = true;
  for (const [key, url] of Object.entries(ASSETS)) {
    const img = new Image();
    img.onload = () => { dirty = true; };
    img.onerror = () => { /* 缺图只影响该元素，不阻塞其余绘制 */ };
    img.src = url;
    imgs[key] = img;
  }
  Promise.all(Object.values(imgs).map((img) =>
    img.complete ? Promise.resolve() : new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res(); })
  )).then(() => { assetsReady = true; dirty = true; });

  /** 区域表（CSS px；绘制与命中同源）。light/dark 各一份——两层各自重建，互不覆盖 */
  const regionsByTheme: Record<'light' | 'dark', Partial<Record<UiRegionKey, UiRect>>> = { light: {}, dark: {} };
  /** 当前绘制层写入的区域（drawLayer 切换指向） */
  let regions: Partial<Record<UiRegionKey, UiRect>> = regionsByTheme.light;
  let visible: Partial<Record<UiRegionKey, UiRect>> = {};
  let lastKey = '';
  let lastDrawAt = 0;
  /** 当前显示主题（0 light → 1 dark，宿主阻尼值） */
  let modeNow = 0;

  /** dpr 缩放便捷 */
  const S = (v: number) => v * dpr;

  // ---------- 绘制原语 ----------
  /** SVG 光栅化缓存：Chrome 的 copyExternalImageToTexture 对"画过 SVG 的
   *  2D canvas"作 GPU 纹理源会报 Failed to copy content（SVG 非合法拷贝源
   *  状态），先把 SVG 一次性光栅化到普通 canvas 再绘制即可绕开 */
  const rasterCache = new Map<string, HTMLCanvasElement>();
  const drawImg = (ctx: any, img: HTMLImageElement | undefined, x: number, y: number, w: number, h?: number) => {
    if (!img || !img.complete || !img.naturalWidth) return;
    let src: CanvasImageSource = img;
    if (/\.svg(\?|$)/.test(img.src)) {
      let rc = rasterCache.get(img.src);
      if (!rc) {
        rc = document.createElement('canvas');
        rc.width = img.naturalWidth;
        rc.height = img.naturalHeight;
        rc.getContext('2d')!.drawImage(img, 0, 0);
        rasterCache.set(img.src, rc);
      }
      src = rc;
    }
    const hh = h ?? (w * img.naturalHeight) / img.naturalWidth;
    ctx.drawImage(src, S(x), S(y), S(w), S(hh));
    return { x, y, w, h: hh };
  };

  const text = (
    ctx: any, str: string, x: number, y: number, opts: {
      size: number; ink: string; align?: CanvasTextAlign; underline?: boolean; weight?: number; baseline?: CanvasTextBaseline;
    }
  ) => {
    ctx.font = `${opts.weight ?? 400} ${S(opts.size)}px ${SERIF}`;
    ctx.fillStyle = opts.ink;
    ctx.textAlign = opts.align ?? 'left';
    ctx.textBaseline = opts.baseline ?? 'alphabetic';
    ctx.fillText(str, S(x), S(y));
    if (opts.underline) {
      const w = ctx.measureText(str).width;
      ctx.fillRect(S(x) - (opts.align === 'center' ? w / 2 : opts.align === 'right' ? w : 0), S(y) + S(4), w, S(2));
    }
  };

  // ---------- 分层绘制 ----------
  /** header：logo / 导航 / book / burger。返回可点区域写入 regions */
  const drawHeader = (ctx: any, theme: 'light' | 'dark', st: UiDrawState) => {
    const ink = INK[theme];
    const imgKey = (lightKey: string, darkKey: string) => (theme === 'light' ? lightKey : darkKey);
    const navH = st.mobile ? 64 : 100;
    const padL = st.mobile ? 8 : Math.min(40, Math.max(20, W * 0.021));
    const padR = st.mobile ? 8 : Math.min(58, Math.max(20, W * 0.0305));
    // 底部分隔线
    ctx.fillStyle = theme === 'light' ? 'rgba(255,255,255,0.05)' : 'rgba(23,19,16,0.08)';
    ctx.fillRect(0, S(navH + 4), pxW, S(2));

    // logo（宽度 clamp(150, 10.66vw, 190)，垂直居中 +6px）
    const logoW = st.mobile ? Math.min(160, W * 0.3) : Math.min(190, Math.max(150, W * 0.1066));
    const logoY = (navH - 30) / 2 + 10;
    const box = drawImg(ctx, imgs[imgKey('logoLight', 'logoDark')], padL, logoY, logoW);
    regions.logo = box ?? { x: padL, y: logoY, w: logoW, h: 40 };

    // 中央导航（桌面）
    if (!st.mobile) {
      ctx.font = `400 ${S(20)}px ${SERIF}`;
      const gap = 33;
      const pad = 8;
      const widths = NAV.map((n) => ctx.measureText(n.label).width / dpr + pad * 2);
      const total = widths.reduce((a, b) => a + b, 0) + gap * (NAV.length - 1);
      let x = W / 2 - total / 2;
      const cy = navH / 2 + 8;
      NAV.forEach((n, i) => {
        const active = n.key === st.activeNav;
        text(ctx, n.label, x + pad, cy, {
          size: 20, ink, baseline: 'middle',
          underline: !active,
        });
        regions[n.region] = { x, y: cy - 16, w: widths[i], h: 32 };
        x += widths[i] + gap;
      });
    }

    // 右侧：work 页 = Book a call；其余 = burger（与 DOM 版一致）
    if (st.page === 'work') {
      const iconS = 28;
      ctx.font = `400 ${S(24)}px ${SERIF}`;
      const label = 'Book a call';
      const tw = ctx.measureText(label).width / dpr;
      const bx = W - padR - (iconS + 16 + tw);
      const by = navH / 2 + 8;
      drawImg(ctx, imgs[imgKey('phoneLight', 'phoneDark')], bx, by - iconS / 2, iconS);
      text(ctx, label, bx + iconS + 16, by + S(2) / dpr, { size: 24, ink, baseline: 'middle', underline: true });
      regions.book = { x: bx - 6, y: by - 22, w: iconS + 16 + tw + 12, h: 44 };
      delete regions.burger;
    } else {
      const bw = 40;
      const bx = W - padR - bw;
      const by = navH / 2 - bw / 2 + 6;
      ctx.fillStyle = ink;
      for (let i = 0; i < 3; i++) ctx.fillRect(S(bx + 6), S(by + 12 + i * 9), S(bw - 12), S(2));
      regions.burger = { x: bx, y: by, w: bw, h: bw };
      delete regions.book;
    }
  };

  /** 菜单浮层（深底、大字链接） */
  const drawMenu = (ctx: any, st: UiDrawState) => {
    ctx.fillStyle = 'rgba(9, 8, 6, 0.97)';
    ctx.fillRect(0, 0, pxW, pxH);
    const items = [...NAV.map((n) => ({ label: n.label, region: n.menu, key: n.key })), { label: 'Book a call', region: 'menuBook' as UiRegionKey, key: 'book' }];
    const size = Math.max(26, Math.min(38, W * 0.06));
    const gap = 28;
    const lineH = size * 1.25 + gap;
    const totalH = items.length * lineH;
    let y = H / 2 - totalH / 2 + size;
    ctx.font = `400 ${S(size)}px ${SERIF}`;
    for (const item of items) {
      const w = ctx.measureText(item.label).width / dpr;
      const x = W / 2 - w / 2;
      text(ctx, item.label, x, y, { size, ink: '#f4eeda' });
      regions[item.region] = { x: x - 14, y: y - size, w: w + 28, h: size * 1.4 };
      y += lineH;
    }
    void st;
  };

  /** work 页：左右箭头 + 底部提示 */
  const drawWorkExtras = (ctx: any, st: UiDrawState) => {
    const fade = st.fade;
    if (fade <= 0.01) {
      delete regions.prevArrow;
      delete regions.nextArrow;
      delete regions.hint;
      return;
    }
    ctx.save();
    ctx.globalAlpha = fade;
    const aw = st.mobile ? 44 : 54;
    const ah = st.mobile ? 44 : 50;
    const axL = st.mobile ? 20 : Math.min(W * 0.075, 27 + W * 0.044);
    const axR = W - axL - aw;
    const ay = H - (st.mobile ? 24 + H * 0.03 : 34 + H * 0.044) - ah;
    for (const [x, rot] of [[axL, Math.PI], [axR, 0]] as Array<[number, number]>) {
      ctx.fillStyle = '#0b0b0b';
      ctx.beginPath();
      ctx.roundRect(S(x), S(ay), S(aw), S(ah), S(6));
      ctx.fill();
      const img = imgs.arrow;
      if (img?.complete && img.naturalWidth) {
        ctx.save();
        ctx.translate(S(x + aw / 2), S(ay + ah / 2));
        ctx.rotate(rot);
        // 红蓝错位描边（DOM 版 drop-shadow 同款）
        ctx.globalAlpha = fade * 0.55;
        ctx.drawImage(img, S(-15 + 1), S(-15), S(30), S(30));
        ctx.globalAlpha = fade;
        ctx.drawImage(img, S(-15), S(-15), S(30), S(30));
        ctx.restore();
      }
    }
    regions.prevArrow = { x: axL, y: ay, w: aw, h: ah };
    regions.nextArrow = { x: axR, y: ay, w: aw, h: ah };

    // 底部提示：手 + 文案 + 手（浮动 ±5px，0.5s 往复）
    const bob = Math.sin(st.time * Math.PI * 2) * 5;
    const label = 'Scroll to About Us';
    ctx.font = `400 ${S(19)}px ${SERIF}`;
    const tw = ctx.measureText(label).width / dpr;
    const handS = 36;
    const total = handS + 12 + tw + 12 + handS;
    let x = W / 2 - total / 2;
    const cy = H - 72 + bob;
    const hand = imgs.hand;
    const drawHand = (hx: number) => {
      if (hand?.complete && hand.naturalWidth) {
        ctx.save();
        ctx.translate(S(hx + handS / 2), S(cy + handS / 2));
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(hand, S(-handS / 2), S(-handS / 2), S(handS), S(handS));
        ctx.restore();
      }
    };
    drawHand(x);
    text(ctx, label, x + handS + 12, cy + handS / 2 + S(6) / dpr, { size: 19, ink: '#fff', baseline: 'middle' });
    drawHand(W / 2 + total / 2 - handS);
    regions.hint = { x: W / 2 - total / 2 - 10, y: H - 72 - 10, w: total + 20, h: handS + 20 };
    ctx.restore();
  };

  /** tie 页文案已迁至 goldenTieScene 的场景内 3D 平面（原站 uikit 机制：
   *  标题随相机 dolly 透视缩放上移，屏幕空间模拟无法还原该运动），此处不再绘制 */

  /** contact 正文已迁至 contactScene 的 3D 长列（CanvasTexture 平面，随相机滚动）——此处只保留 header */

  const drawLayer = (layer: { ctx: any }, theme: 'light' | 'dark', st: UiDrawState) => {
    const ctx = layer.ctx;
    regions = regionsByTheme[theme];
    for (const k of Object.keys(regions)) delete regions[k as UiRegionKey];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    drawHeader(ctx, theme, st);
    if (st.menuOpen && theme === 'dark') {
      // 菜单盖住 header（同原件 z 序）；只画一份到 dark 层
      drawMenu(ctx, st);
      return;
    }
    if (theme === 'light') {
      if (st.page === 'work') drawWorkExtras(ctx, st);
      // tie/contact 页：正文在 3D 场景内（goldenTieScene 平面 / contactScene 长列），屏幕层只留 header
    }
    // dark（about 纸页）层没有屏幕空间正文（正文在 3D 纸纹理里），只保留 header 区域
  };

  const stateKey = (st: UiDrawState) =>
    [
      st.page, st.activeNav, st.mobile ? 1 : 0, st.menuOpen,
      Math.round(st.fade * 50), Math.round(st.tieCopy * 40),
      assetsReady ? 1 : 0, W, H,
    ].join('|');

  const draw = (st: UiDrawState) => {
    modeNow = st.mode;
    // work 页提示浮动需要按节流重绘；其余只在状态变化时重绘
    const key = stateKey(st);
    const bobbing = st.page === 'work' && st.fade > 0.05;
    const now = performance.now();
    const throttleOk = !bobbing || now - lastDrawAt > 50;
    if (key === lastKey && !throttleOk && !dirty) return;
    lastKey = key;
    lastDrawAt = now;
    dirty = false;
    drawLayer(light, 'light', st);
    drawLayer(dark, 'dark', st);
    // 命中表取当前显示主题的那一份（阻尼中段取靠近的一侧）
    visible = { ...(modeNow > 0.5 ? regionsByTheme.dark : regionsByTheme.light) };
    light.tex.needsUpdate = true;
    dark.tex.needsUpdate = true;
  };

  const hitTest = (cssX: number, cssY: number): UiRegionKey | null => {
    for (const [key, rect] of Object.entries(visible)) {
      if (!rect) continue;
      if (cssX >= rect.x && cssX <= rect.x + rect.w && cssY >= rect.y && cssY <= rect.y + rect.h) {
        return key as UiRegionKey;
      }
    }
    return null;
  };

  const setSize = (w: number, h: number) => {
    W = Math.max(1, w);
    H = Math.max(1, h);
    pxW = Math.floor(W * dpr);
    pxH = Math.floor(H * dpr);
    light.canvas.width = pxW;
    light.canvas.height = pxH;
    dark.canvas.width = pxW;
    dark.canvas.height = pxH;
    dirty = true;
  };

  return {
    lightTexture: light.tex,
    darkTexture: dark.tex,
    regions,
    visibleRegions: () => visible,
    draw,
    hitTest,
    setSize,
    dispose: () => {
      light.tex.dispose();
      dark.tex.dispose();
    },
  };
}
