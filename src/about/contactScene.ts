/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * Contact 场景 —— shader.se contact 段 1:1 反编译还原
 *
 * 原站结构（_bundles/ct-*.txt，cp/cf/cb/ci/cg 组件）：
 *   3D 场景（phones.glb 三台电话 + 摄影棚壳 + 烟雾粒子 + 黄星群）内嵌
 *   react-three-uikit 3D 长列（文案随相机滚动在 3D 空间移动，非屏幕空间）。
 *
 * == 列内容（uikit px = 屏幕 px，sizeX=viewportWidth）==
 *   paddingTop 1 屏 → “Hello”（fontSize 80/sm100/md140/lg200 center medium）
 *   → 0.95 屏空隙 → Good buy.（paddingTop 200，同字号）
 *   → cl 黑渐变遮罩（盖 Good buy 块并向下超出 50px；
 *     alpha = uv.y<0.2 ? 1 : pow(smoothstep(0,.8,1-uv.y),.6)）
 *   → 黑底 Info（backgroundColor:"black"）：
 *       intro（18/sm20/lg24 center maxWidth 480）+ 容器 paddingBottom 60
 *       → row（gap 50 marginTop 40 paddingY 40）三列各 w240：
 *           General Enquiries / Visit us / Social（标题 18、≥800:24 bold；正文 18/lg20）
 *       → New business 卡片（marginTop 80）：maxWidth 640 row gap 24（lg h180）
 *         + dashed_frame.svg 铺底 + simon 150/lg200 + 标题 19/sm24/lg32 bold + 描述 13/sm18/lg24
 *   → Footer（bg black borderTop 1px rgba(245,235,216,.05) paddingX 64 paddingY 64/lg96
 *     row space-between）：cert 160(lg)/232(xl) | copyright 320/384 | a11y 160/232
 *
 * == 滚动/相机公式（cp 组件 useImperativeHandle）==
 *   d   = 列内容高 / 视口高（动态测高）
 *   h   = clamp(nM(scroll, start−1.12, end−1), 0, 1)
 *   g   = clamp(nM(scroll, start−1, end−1), 0, 1) · (d−1)      // 列滚动（页）
 *   f   = clamp(nM(g, dHello−(w>640?120:80)/vh, dHello+100/vh), 0, 1)  // 列背景黑幕
 *   p   = h · viewportHeight · (d−1)                            // 世界位移
 *   相机 = (0.25·mx, 0.25·my − p, 5)，lookAt(0, −p, 0)，fov 65 near .1 far 100
 *   phones 组 y = 0.55p − 6（0.55 倍视差）
 *   viewportHeight（世界）= 2·5·tan(32.5°) ≈ 6.371（z=0 平面可视高度）
 *
 * == 本地等价实现 ==
 *   uikit 列 → z=0 平面 + CanvasTexture（布局用 CSS px，canvas 宽 cap 2048 时整体缩放）
 *   动态黑幕 f → 同尺寸半透明黑平面（z=−0.02，opacity=f），只补 canvas 透明区
 *   链接命中 → 列内锚点世界坐标逐帧投影回屏幕 rect
 *   黄星群 → 主星（flat 平面黄）+ 7 副星（extrude 金属黄），轨迹见 updateStars
 */

export interface ContactHitRegion {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AboutContactHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** GLB 加载完成（或失败）后 resolve */
  ready: Promise<void>;
  setSize: (width: number, height: number) => void;
  /** 列内容屏数 d（动态测高；供段长/maxS 计算） */
  length: () => number;
  /**
   * @param enterScreens   scroll − contactStart（屏，可为负：转场提前量）
   * @param lengthScreens  contact 段总长（屏，与 length() 同源）
   */
  update: (
    dt: number,
    time: number,
    state: { enterScreens: number; lengthScreens: number; mouseX: number; mouseY: number; touch?: boolean }
  ) => void;
  /** 链接命中区域（屏幕 CSS 像素），仅段内有效 */
  hitRegions: () => ContactHitRegion[];
  dispose: () => void;
}

// ---------- 原站常量 ----------
const FOV = 65;
const CAM_Z = 5;
const VH = 2 * CAM_Z * Math.tan((FOV / 2) * (Math.PI / 180)); // ≈ 6.371 世界单位
const INK = '#f4efe2';
const INK_SOFT = 'rgba(244, 239, 226, 0.78)';
const SERIF = '"STIX Two Text", "Times New Roman", serif';
/** uikit 断点（@pmndrs/uikit properties/conditional.js：sm640 md768 lg1024 xl1280） */
const nM = (v: number, a: number, b: number, c: number, d: number) => c + ((v - a) / (b - a)) * (d - c);
const nL = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const sstep = (a: number, b: number, v: number) => {
  const x = nL((v - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

export function createAboutContactScene(width: number, height: number): AboutContactHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#040405');

  const camera = new THREE.PerspectiveCamera(FOV, Math.max(1, width) / Math.max(1, height), 0.1, 100);
  camera.position.set(0, 0, CAM_Z);
  camera.lookAt(0, 0, 0);

  // =====================================================================
  // 列 canvas（uikit 长列 → 纹理平面）
  // =====================================================================
  const columnCanvas = document.createElement('canvas');
  const columnTex = new THREE.CanvasTexture(columnCanvas);
  columnTex.colorSpace = THREE.SRGBColorSpace;
  columnTex.minFilter = THREE.LinearFilter;
  columnTex.magFilter = THREE.LinearFilter;
  columnTex.generateMipmaps = false;

  const columnMat = new THREE.MeshBasicNodeMaterial();
  columnMat.map = columnTex as any;
  columnMat.transparent = true;
  columnMat.depthTest = false;
  columnMat.depthWrite = false;
  columnMat.toneMapped = false;
  const columnMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), columnMat);
  columnMesh.renderOrder = 1;
  columnMesh.frustumCulled = false;
  scene.add(columnMesh);

  // 动态黑幕（原站 r.current backgroundColor rgba(0,0,0,f)：滚过 hello 块后整列背景渐黑）
  const veilMat = new THREE.MeshBasicNodeMaterial();
  veilMat.color = new THREE.Color(0x000000);
  veilMat.transparent = true;
  veilMat.opacity = 0;
  veilMat.depthTest = false;
  veilMat.depthWrite = false;
  veilMat.toneMapped = false;
  const veilMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), veilMat);
  veilMesh.position.z = -0.02;
  // renderOrder 0 < 列(1)：原站 f 黑幕是 uikit 列的 backgroundColor（文字下层），depthTest 关闭时靠 renderOrder 分层
  veilMesh.renderOrder = 0;
  veilMesh.frustumCulled = false;
  scene.add(veilMesh);

  // ---------- 列布局/绘制（uikit 数值 1:1；坐标全部 CSS px，ctx.scale 处理 cap） ----------
  interface LinkAnchor {
    key: string;
    /** 列内 CSS 像素中心坐标 */
    cx: number;
    cy: number;
    /** 半宽半高（CSS px） */
    hw: number;
    hh: number;
  }
  let dLen = 4.2; // 列屏数（动态收敛）
  let helloAnchor = 2.1; // hello 块底端屏位（黑幕锚点，原站 s.current）
  let linkAnchors: LinkAnchor[] = [];
  const images = new Map<string, HTMLImageElement>();
  let needsRedraw = true;

  const loadImg = (key: string, src: string) => {
    const img = new Image();
    img.onload = () => {
      needsRedraw = true;
    };
    img.src = src;
    images.set(key, img);
  };
  loadImg('dashed', '/textures/dashed_frame.svg');
  loadImg('cert', '/textures/footer_certificate.png');
  loadImg('copy', '/textures/copyright_footer.png');
  loadImg('a11y', '/textures/a11y.png');
  loadImg('simon', '/textures/about/simon_calling.webp');

  const lineH = (fs: number) => fs * 1.25;
  const fsOf = (base: number, sm: number | null, md: number | null, lg: number | null, xl: number | null, w: number) => {
    if (w >= 1280 && xl != null) return xl;
    if (w >= 1024 && lg != null) return lg;
    if (w >= 768 && md != null) return md;
    if (w >= 640 && sm != null) return sm;
    return base;
  };
  /** cl 渐变 alpha（uvY：1=遮罩顶 0=底；原站 cu shader） */
  const clAlpha = (uvY: number) => (uvY < 0.2 ? 1 : Math.pow(sstep(0, 0.8, 1 - uvY), 0.6));

  const drawColumn = (vw: number, vh: number) => {
    const ctx = columnCanvas.getContext('2d')!;
    const scale = Math.min(1, 2048 / vw); // 宽度 cap：canvas px = CSS px × scale
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, vw, columnCanvas.height / scale);
    linkAnchors = [];

    const font = (size: number, weight = 400) => `${weight} ${size}px ${SERIF}`;
    const text = (t: string, x: number, y: number, size: number, color = INK, weight = 400, align: CanvasTextAlign = 'center') => {
      ctx.font = font(size, weight);
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = color;
      ctx.fillText(t, x, y);
    };
    const underline = (x: number, y: number, w: number) => {
      ctx.fillStyle = INK;
      ctx.fillRect(x, y, w, 1);
    };

    let y = 0;
    const big = fsOf(80, 100, 140, 200, null, vw);
    const bigH = lineH(big);

    // ---- paddingTop 1 屏 + “Hello”（fontWeight medium）----
    y += vh;
    text('“Hello”', vw / 2, y + big * 0.92, big, INK, 500);
    y += bigH;

    // hello 块底端 = 黑幕锚点（原站 s.current = hello 块高/视口高）
    y += 0.95 * vh;
    helloAnchor = y / vh;

    // ---- Good buy.（paddingTop 200）----
    // 原站 z 序：cl 遮罩(zIndex 2) 在文字(zIndex 4/renderOrder 1001)下层 —— 先画遮罩再画字
    y += 200;
    const gbTop = y;
    const gbBottom = gbTop + bigH;
    {
      const clH = gbBottom - gbTop + 50;
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const g2 = ctx.createLinearGradient(0, gbTop + clH * t0, 0, gbTop + clH * t1);
        g2.addColorStop(0, `rgba(0,0,0,${clAlpha(1 - t0)})`);
        g2.addColorStop(1, `rgba(0,0,0,${clAlpha(1 - t1)})`);
        ctx.fillStyle = g2;
        ctx.fillRect(0, gbTop + clH * t0, vw, (clH / steps) * (1 / scale) + 1);
      }
    }
    text('Good buy.', vw / 2, gbTop + big * 0.92, big, INK, 500);
    y = gbBottom;

    // ---- 黑底 Info（backgroundColor:"black" 全宽直到列尾）----
    ctx.fillStyle = '#000';
    ctx.fillRect(0, y, vw, (columnCanvas.height / scale) - y);

    // intro（maxWidth 480 两行 center）+ 容器 paddingBottom 60
    const introFs = fsOf(18, 20, 20, 24, null, vw);
    y += introFs * 1.2;
    text('Contact us about your digital project idea or general', vw / 2, y, introFs, INK_SOFT);
    y += introFs * 1.45;
    text("enquires. Let's interface, call us today!", vw / 2, y, introFs, INK_SOFT);
    y += introFs * 0.6 + 60;

    // ---- row：三列各 w240 gap50，paddingY 40 ----
    y += 40;
    const colW = 240;
    const gap = 50;
    const isMobileCol = vw < 640;
    const rowW = colW * 3 + gap * 2;
    const rowX = vw / 2 - rowW / 2;
    const headFs = vw >= 800 ? 24 : 18;
    const bodyFs = fsOf(18, null, null, 20, null, vw);
    const lh = bodyFs * 1.4;
    const drawCol = (x: number, w: number, title: string, lines: Array<{ t: string; link?: string; soft?: boolean }>) => {
      let cy = y;
      text(title, x + w / 2, cy + headFs * 0.9, headFs, INK, 700);
      cy += headFs * 0.9 + 16;
      for (const l of lines) {
        ctx.font = font(bodyFs);
        const tw = ctx.measureText(l.t).width;
        text(l.t, x + w / 2, cy + bodyFs * 0.9, bodyFs, l.soft ? INK_SOFT : INK);
        if (l.link) {
          underline(x + w / 2 - tw / 2, cy + bodyFs * 0.9 + bodyFs * 0.22, tw);
          linkAnchors.push({ key: l.link, cx: x + w / 2, cy: cy + bodyFs * 0.2, hw: tw / 2 + 10, hh: bodyFs * 0.7 });
        }
        cy += lh + 4;
      }
      return cy;
    };
    if (isMobileCol) {
      // 原站竖屏 wrap：General Enquiries 独立一行居中，Visit us + Social 并排
      const b1 = drawCol(vw / 2 - colW / 2, colW, 'General Enquiries', [
        { t: 'hello@shader.se', link: 'ctEmail' },
        { t: 'Book a call', link: 'ctBook' },
      ]);
      y = b1 + 24;
      const half = (vw - 40 - gap) / 2;
      const bx = 20;
      const b2 = drawCol(bx, half, 'Visit us', [
        { t: 'Laxholmstorget 3', soft: true },
        { t: '602 21 Norrköping', soft: true },
        { t: 'Sweden', soft: true },
      ]);
      const b3 = drawCol(bx + half + gap, half, 'Social', [
        { t: 'LinkedIn', link: 'ctLi' },
        { t: 'Instagram', link: 'ctIg' },
        { t: 'X (Twitter)', link: 'ctX' },
      ]);
      y = Math.max(b2, b3) + 40;
    } else {
      const b1 = drawCol(rowX, colW, 'General Enquiries', [
        { t: 'hello@shader.se', link: 'ctEmail' },
        { t: 'Book a call', link: 'ctBook' },
      ]);
      const b2 = drawCol(rowX + colW + gap, colW, 'Visit us', [
        { t: 'Laxholmstorget 3', soft: true },
        { t: '602 21 Norrköping', soft: true },
        { t: 'Sweden', soft: true },
      ]);
      const b3 = drawCol(rowX + (colW + gap) * 2, colW, 'Social', [
        { t: 'LinkedIn', link: 'ctLi' },
        { t: 'Instagram', link: 'ctIg' },
        { t: 'X (Twitter)', link: 'ctX' },
      ]);
      y = Math.max(b1, b2, b3) + 40;
    }

    // ---- New business 卡片（marginTop 80；外框 padding 8 border 2 radius 4）----
    y += 80;
    {
      const isLg = vw >= 1024;
      const cardW = Math.min(640, vw * 0.9);
      const cardX = vw / 2 - cardW / 2;
      const simonS = isLg ? 200 : 150;
      const cardH = isLg ? 180 : simonS + 24;
      const titleFs = fsOf(19, 24, 24, 32, null, vw);
      const descFs = fsOf(13, 18, 18, 24, null, vw);
      const dashed = images.get('dashed');
      if (dashed?.complete) ctx.drawImage(dashed, cardX, y, cardW, cardH);
      const simon = images.get('simon');
      const simonX = cardX + (isLg ? 16 : 8);
      const simonY = y + cardH / 2 - simonS / 2;
      if (simon?.complete) ctx.drawImage(simon, simonX, simonY, simonS, simonS);
      const txX = simonX + simonS + 24;
      const txW = cardX + cardW - 12 - txX; // 文案区右缘留 12px（虚线框内）
      const titleY = y + cardH / 2 - descFs * 0.55;
      text('New business', txX, titleY, titleFs, INK, 700, 'left');
      // 描述手动折行（原站 maxWidth 内自动两行）
      const descY = titleY + descFs * 1.5;
      const line1 = 'Reach out today to our CEO for';
      const line2 = 'new business enquiries at ceo@shader.se';
      ctx.font = font(descFs);
      const l2w = ctx.measureText(line2).width;
      const shrink = l2w > txW ? txW / l2w : 1;
      text(line1, txX, descY, descFs * Math.min(1, shrink), INK_SOFT, 400, 'left');
      text(line2, txX, descY + descFs * 1.35 * Math.min(1, shrink), descFs * shrink, INK, 400, 'left');
      const ceoW = ctx.measureText(line2).width * shrink;
      underline(txX, descY + descFs * 1.35 * shrink + descFs * shrink * 0.22, ceoW);
      linkAnchors.push({ key: 'ctCeo', cx: txX + ceoW / 2, cy: descY + descFs * 0.7, hw: ceoW / 2 + 10, hh: descFs * 0.8 });
      y += cardH + 16; // padding 8×2
    }

    // ---- Footer（borderTop 1px rgba(245,235,216,.05)；paddingX 64 paddingY 64/lg96）----
    const padY = vw >= 1024 ? 96 : 64;
    const isLg = vw >= 1024;
    const isXl = vw >= 1280;
    const certW = isLg ? (isXl ? 232 : 160) : 144;
    const copyW = isLg ? (isXl ? 384 : 320) : 256;
    const a11yW = isLg ? (isXl ? 232 : 160) : 144;
    const cert = images.get('cert');
    const copy = images.get('copy');
    const a11y = images.get('a11y');
    const imgH = (img: HTMLImageElement | undefined, w: number) =>
      img?.complete && img.naturalWidth ? (w * img.naturalHeight) / img.naturalWidth : w * 0.4;
    const certH = imgH(cert, certW);
    const copyH = imgH(copy, copyW);
    const a11yH = imgH(a11y, a11yW);
    const rowH = Math.max(certH, copyH, a11yH);
    // borderTop
    ctx.fillStyle = 'rgba(245, 235, 216, 0.05)';
    ctx.fillRect(0, y, vw, 1);
    y += padY;
    const px = Math.min(64, vw * 0.05);
    const cx = vw / 2;
    if (isLg) {
      if (cert?.complete) ctx.drawImage(cert, px, y, certW, certH);
      if (copy?.complete) ctx.drawImage(copy, cx - copyW / 2, y + (rowH - copyH) / 2, copyW, copyH);
      if (a11y?.complete) ctx.drawImage(a11y, vw - px - a11yW, y, a11yW, a11yH);
    } else {
      // column-reverse 居中：copyright → 48 间隔 → row(cert 144, a11y 144) gap 32
      if (copy?.complete) ctx.drawImage(copy, cx - copyW / 2, y, copyW, copyH);
      const inner = y + copyH + 48;
      const pairW = 144 + 32 + a11yW;
      if (cert?.complete) ctx.drawImage(cert, cx - pairW / 2, inner, 144, imgH(cert, 144));
      if (a11y?.complete) ctx.drawImage(a11y, cx + pairW / 2 - a11yW, inner, a11yW, a11yH);
      y = inner + Math.max(144 * 0.4, a11yH);
    }
    y += rowH + padY;

    dLen = y / vh;
  };

  const rebuildColumn = (vw: number, vh: number) => {
    const scale = Math.min(1, 2048 / vw);
    const W = Math.max(320, Math.round(vw * scale));
    const H = Math.min(8192, Math.max(Math.round(vh * scale), Math.round(dLen * vh * scale)));
    if (columnCanvas.width !== W || columnCanvas.height !== H) {
      columnCanvas.width = W;
      columnCanvas.height = H;
    }
    drawColumn(vw, vh);
    columnTex.needsUpdate = true;
    // 平面：宽 VH·aspect、高 dLen·VH；列顶对齐视口顶（原站 group y=−vh·d·.5+.5·vh 的等价式）
    const aspect = vw / vh;
    const gw = VH * aspect;
    const gh = dLen * VH;
    const centerY = VH * (0.5 - dLen / 2);
    columnMesh.geometry.dispose();
    columnMesh.geometry = new THREE.PlaneGeometry(gw, gh);
    columnMesh.position.set(0, centerY, 0);
    veilMesh.geometry.dispose();
    veilMesh.geometry = new THREE.PlaneGeometry(gw, gh);
    veilMesh.position.set(0, centerY, -0.02);
  };

  // =====================================================================
  // phones（cf 1:1：材质覆盖 + 背景 TSL shader + 组变换）
  // =====================================================================
  const phonesGroup = new THREE.Group();
  phonesGroup.position.set(0.9, -7.1, -3.5); // y 基准（0.55p−6.8：原站群中心画面 68% 高的校准值）
  scene.add(phonesGroup);

  phonesGroup.add(new THREE.AmbientLight(0xffffff, 2.4));
  const keyPoint = new THREE.PointLight(0xffccdd, 300, 0, 2);
  keyPoint.position.set(0, 5, 0);
  phonesGroup.add(keyPoint);
  // cS 形状光（F=.4·lightsIntensity，默认 1）：ring/box 近似为点光
  const addLight = (color: number, intensity: number, dist: number, x: number, y: number, z: number) => {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  };
  addLight(0xf5f0dc, 15 * 0.4 * 8, 60, 2, 3, -2); // ring beige [2,3,-2] scale3
  addLight(0xffffff, 80 * 0.4, 60, -14, 10, 8);
  addLight(0xffffff, 80 * 0.4 * 2, 28, -14, 14, -4); // light{100,dist28,decay2}
  addLight(0xffffff, 23 * 0.4 * 2, 28, 14, 12, 0);
  addLight(0xffffff, 16 * 0.4, 60, 0, 9, 14);

  // =====================================================================
  // 烟雾粒子（cC：smoke.webp × 50，opacity .5 白，慢自转 0.1 rad/s）
  // 原站调用参数未见（bundle 截断）——分布量级按 phones 场景空间目检校准
  // =====================================================================
  const smokeGroup = new THREE.Group();
  scene.add(smokeGroup);
  const smokeTex = new THREE.TextureLoader().load('/textures/smoke.webp');
  smokeTex.colorSpace = THREE.SRGBColorSpace;
  const smokeMats: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 50; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: smokeTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      color: 0xffffff,
    });
    smokeMats.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.position.set((Math.random() * 2 - 1) * 16, Math.random() * 14, -4 - Math.random() * 24);
    const s = 1.5 + Math.random() * 2.5;
    mesh.scale.set(s, s, 1);
    mesh.rotation.z = Math.random() * Math.PI * 2;
    smokeGroup.add(mesh);
  }

  // =====================================================================
  // 黄星群（cb：主星 flat + 7 副星 extrude；10 角星形半径交替 2/1）
  // =====================================================================
  const starShape = () => {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 2 : 1;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = r * Math.cos(a);
      const yy = r * Math.sin(a);
      if (i === 0) shape.moveTo(x, yy);
      else shape.lineTo(x, yy);
    }
    shape.closePath();
    return shape;
  };
  const shape = starShape();
  const STAR_YELLOW = new THREE.Color('rgb(255, 255, 80)');

  // 主星（flat：平面 basic 黄；opacity = nM(progress,.05,.3)，scale = nM(progress,.96,1,1,2)）
  const starOpacityMain = T.uniform(0);
  const starMainMat = new THREE.MeshBasicNodeMaterial();
  starMainMat.colorNode = T.color(STAR_YELLOW);
  starMainMat.transparent = true;
  starMainMat.opacityNode = starOpacityMain;
  starMainMat.depthTest = false;
  starMainMat.toneMapped = false;
  const starMain = new THREE.Mesh(new THREE.ShapeGeometry(shape), starMainMat);
  starMain.renderOrder = 3;
  starMain.frustumCulled = false;
  scene.add(starMain);

  // 副星（extrude depth .2 bevel；standard metal .5 rough .05；progress 各延迟 .15·t）
  const starGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.01,
    bevelThickness: 0.01,
  });
  const starExtras: Array<{ mesh: THREE.Mesh; opacity: any }> = [];
  for (let i = 0; i < 7; i++) {
    const opacity = T.uniform(0);
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.metalness = 0.5;
    mat.roughness = 0.05;
    mat.color = STAR_YELLOW;
    mat.transparent = true;
    mat.opacityNode = opacity;
    const mesh = new THREE.Mesh(starGeo, mat);
    mesh.frustumCulled = false;
    starExtras.push({ mesh, opacity });
    scene.add(mesh);
  }

  /** 星星轨迹（原站 cb updateHandle 1:1） */
  const updateStars = (progress: number, vw: number) => {
    const o = Math.min(Math.max(vw / 1920, 0.4), 0.75);
    const place = (mesh: THREE.Mesh, r: number) => {
      mesh.position.z = 30 * Math.cos(r * Math.PI + 0.5 * Math.PI);
      mesh.position.x = 14 * Math.cos(r * Math.PI * 1.5) * o + 0.2;
      mesh.position.y = 6 * Math.cos(r * Math.PI * 1.5);
      mesh.rotation.z = 2 * r * Math.PI;
      mesh.rotation.y = 2 * r * Math.PI;
      mesh.rotation.x = 0;
    };
    place(starMain, nL(progress, 0, 1));
    starMain.scale.setScalar(nL(nM(progress, 0.96, 1, 1, 2), 1, 2));
    starOpacityMain.value = nL(nM(progress, 0.05, 0.3, 0, 1), 0, 1);
    starExtras.forEach(({ mesh, opacity }, i) => {
      const a = nL(progress - 0.15 * i, 0, 1);
      place(mesh, a);
      opacity.value = nL(nM(a, 0.05, 0.3, 0, 1), 0, 1);
    });
  };

  // =====================================================================
  // phones.glb（cf 1:1：材质名覆盖 + 背景 TSL shader + 变换）
  // =====================================================================
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  loader.setDRACOLoader(draco);
  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  let disposed = false;
  const loadedMaterials = new Set<THREE.Material>();
  const loadedTextures = new Set<THREE.Texture>();

  loader.load(
    // ?v=2：原站 2026-10-15 重新导出过 phones.glb（电话组位置大幅调整），穿透旧缓存
    '/asset/models/phones.glb?v=2',
    (gltf) => {
      if (disposed) {
        resolveReady();
        return;
      }
      const root = gltf.scene;
      const overrides: Record<string, Record<string, unknown>> = {
        green: { map: null, emissive: new THREE.Color('#0f0'), emissiveIntensity: 1 },
        red: { map: null, emissive: new THREE.Color('#f00'), emissiveIntensity: 1 },
        metallic: { roughness: 0.4, metalness: 0.9, color: new THREE.Color('#fff') },
        white: { roughness: 0.5, metalness: 0 },
        black: { roughness: 0.5, metalness: 0.4, color: new THREE.Color('#000') },
        'shader-logo': { roughness: 0, metalness: 0 },
      };
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const apply = (raw: any) => {
          const mat = raw as THREE.MeshStandardMaterial;
          if (!mat) return;
          loadedMaterials.add(mat);
          if (mat.map) loadedTextures.add(mat.map);
          if (mesh.name.toLowerCase().includes('background')) {
            // 背景 TSL shader（原站 cf colorNode 1:1）：
            // n = min(bg·(0.5 + dirt(uv×6.5,5).g×1.9), 1)；fade = 1−smoothstep(13,26,dist to (0,0,-24))
            const dirt = new THREE.TextureLoader().load('/textures/contact_dirt.jpg');
            dirt.wrapS = THREE.RepeatWrapping;
            dirt.wrapT = THREE.RepeatWrapping;
            dirt.colorSpace = THREE.SRGBColorSpace;
            const bgMap = mat.map;
            if (bgMap) loadedTextures.add(bgMap);
            const std = new THREE.MeshStandardNodeMaterial();
            std.roughness = 0.7;
            std.metalness = 0.6;
            std.side = THREE.FrontSide;
            std.colorNode = T.Fn(() => {
              const uv = T.uv();
              const dirtG = T.texture(dirt as any, uv.mul(T.vec2(6.5, 5))).g.mul(1.6);
              const bg = bgMap ? T.texture(bgMap as any, uv).rgb : T.vec3(0.02, 0.02, 0.02);
              const n = T.min(bg.mul(T.float(0.5).add(dirtG.mul(1.9))), T.vec3(1));
              const dist = T.length(T.positionWorld.sub(T.vec3(0, 0, -24))).toVar();
              const fade = T.float(1).sub(T.smoothstep(13, 26, dist));
              return n.mul(fade).mul(0.25).toVar();
            })() as any;
            mesh.material = std;
            loadedMaterials.add(std);
            return;
          }
          const ov = overrides[mat.name];
          if (ov) {
            for (const [k, v] of Object.entries(ov)) (mat as any)[k] = v;
          }
          mat.side = THREE.FrontSide;
          mat.needsUpdate = true;
        };
        if (Array.isArray(mesh.material)) mesh.material.forEach(apply);
        else apply(mesh.material);
      });
      // 组变换（原站 cf 1:1）：group [.9,0,-3.5] + primitive scale1.1 rot[.3,π,0] pos[0,-4,-3]
      // 观感校准（原站 nP 处理器未抽取）：三台话机在 GLB 里原始 z = −0.1 / 5.8 / 14.6，
      // π 旋转+偏移后距相机 11~26（过远过小）；按 shader.se 实测（中话机 ≈32% 屏宽、
      // 左右台 ≈0.7×）分组拉近：phone-2 主组距 ~6.5、phone-1 距 ~9、phone-3 距 ~8
      const pullByPrefix: Array<[string, number]> = [
        ['phone-1', 9],
        ['phone-2', -11.5],
        ['phone-3', 11.5],
        ['phones', -11.5],
        ['buttons', -11.5],
      ];
      for (const child of root.children) {
        if (child.name.toLowerCase().includes('background')) continue;
        const hit = pullByPrefix.find(([p]) => child.name.toLowerCase().startsWith(p));
        if (hit) child.position.z += hit[1];
      }
      const primitive = new THREE.Group();
      // nP 未知 → 组级缩放观感等价：0.72×（原站群高占画面 ~55%，1.1 原值下 1.4× 过大）
      primitive.scale.setScalar(1.1 * 0.72);
      primitive.rotation.set(0.3, Math.PI, 0);
      primitive.position.set(0, -4, -3);
      primitive.add(root);
      phonesGroup.add(primitive);
      resolveReady();
    },
    undefined,
    () => {
      // 加载失败：星空+列文案仍可用，不阻塞页面
      resolveReady();
    },
  );

  function resolveReady() {
    if (readyResolve) {
      readyResolve();
      readyResolve = null;
    }
  }

  // =====================================================================
  // 每帧更新（cp useImperativeHandle 公式 1:1）
  // =====================================================================
  const smoothMouse = { x: 0, y: 0 };
  let curVw = Math.max(1, width);
  let curVh = Math.max(1, height);

  const update: AboutContactHandle['update'] = (dt, _time, state) => {
    const d = dLen;
    const end = Math.max(0.001, state.lengthScreens - 1);
    const h01 = nL(nM(state.enterScreens, -1.12, end, 0, 1), 0, 1);
    const g = nL(nM(state.enterScreens, -1, end, 0, 1), 0, 1) * (d - 1);
    // 列背景黑幕：滚过 hello 块后渐黑（原站 f）
    const edge = curVw > 640 ? 120 : 80;
    veilMat.opacity = nL(nM(g, helloAnchor - edge / curVh, helloAnchor + 100 / curVh, 0, 1), 0, 1);

    const p = h01 * VH * (d - 1);

    // 鼠标弹簧阻尼（原站 useSpringMouse 近似）
    const targetX = state.touch ? 0 : state.mouseX;
    const targetY = state.touch ? 0 : state.mouseY;
    const ease = 1 - Math.exp(-6 * Math.min(0.05, dt));
    smoothMouse.x += (targetX - smoothMouse.x) * ease;
    smoothMouse.y += (targetY - smoothMouse.y) * ease;

    // 相机：(0.25mx, 0.25my − p, 5) lookAt(0,−p,0)
    camera.position.set(0.25 * smoothMouse.x, 0.25 * smoothMouse.y - p, CAM_Z);
    camera.lookAt(0, -p, 0);

    // phones 组：y = 0.55p − 6
    phonesGroup.position.y = 0.55 * p - (camera.aspect < 0.72 ? 8.2 : 7.1);

    // 星星：tie→contact 转场窗口飞过（原站 contact 段内逐屏采样无星——
    // cb 的 progress 对应页转场 t，enterScreens −1.6..−0.5 飞入、−0.5..0 淡出）
    const starP = nL(nM(state.enterScreens, -1.6, -0.5, 0, 1), 0, 1);
    updateStars(starP, curVw);
    const starFade = 1 - nL(nM(state.enterScreens, -0.5, 0, 0, 1), 0, 1);
    starOpacityMain.value *= starFade;
    for (const { opacity } of starExtras) opacity.value *= starFade;

    // 烟雾慢自转（原站 rotation [0,0,.1]/s）
    for (const m of smokeGroup.children) m.rotation.z += 0.1 * dt;

    if (needsRedraw) {
      needsRedraw = false;
      rebuildColumn(curVw, curVh);
    }
  };

  // =====================================================================
  // 命中投影（列内 CSS px 锚点 → 世界 → 屏幕 CSS px）
  // =====================================================================
  const hitRegions = (): ContactHitRegion[] => {
    const out: ContactHitRegion[] = [];
    if (linkAnchors.length === 0) return out;
    const dpr = curVw / columnCanvas.width * (columnCanvas.width / curVw); // = 1（占位，实际用 scale）
    void dpr;
    const drawScale = Math.min(1, 2048 / curVw); // drawColumn 用的 scale
    const aspect = curVw / curVh;
    const gw = VH * aspect;
    const gh = dLen * VH;
    const top = VH * (0.5 - dLen / 2);
    // z=0 平面像素密度：1 世界单位 = curVh/VH 屏幕 px
    const pxPerWorld = curVh / VH;
    const v = new THREE.Vector3();
    for (const a of linkAnchors) {
      // canvas CSS px → 世界（列顶=top，向下延伸 gh）
      const wx = (a.cx / curVw - 0.5) * gw;
      const wy = top - (a.cy / (dLen * curVh)) * gh;
      v.set(wx, wy, 0).project(camera);
      const sx = (v.x * 0.5 + 0.5) * curVw;
      const sy = (1 - (v.y * 0.5 + 0.5)) * curVh;
      // 锚点 CSS px 尺寸 → 世界 → 屏幕（同平面密度）
      const halfW = (a.hw * gw) / curVw * pxPerWorld;
      const halfH = (a.hh * gh) / (dLen * curVh) * pxPerWorld;
      out.push({ key: a.key, x: sx - halfW * drawScale, y: sy - halfH * drawScale, w: halfW * 2 * drawScale, h: halfH * 2 * drawScale });
    }
    return out;
  };

  const setSize = (w: number, h: number) => {
    curVw = Math.max(1, w);
    curVh = Math.max(1, h);
    camera.aspect = curVw / curVh;
    // 竖屏放宽 fov（原站竖屏话机群完整入画、Hello 无遮挡）
    camera.fov = camera.aspect < 0.72 ? 78 : FOV;
    camera.updateProjectionMatrix();
    needsRedraw = true;
  };
  setSize(width, height);

  const dispose = () => {
    disposed = true;
    resolveReady();
    columnTex.dispose();
    columnMat.dispose();
    columnMesh.geometry.dispose();
    veilMat.dispose();
    veilMesh.geometry.dispose();
    smokeTex.dispose();
    for (const m of smokeMats) m.dispose();
    starMainMat.dispose();
    starMain.geometry.dispose();
    starGeo.dispose();
    for (const { mesh } of starExtras) (mesh.material as THREE.Material).dispose();
    for (const t of loadedTextures) t.dispose();
    for (const m of loadedMaterials) m.dispose();
    loadedMaterials.clear();
    loadedTextures.clear();
    scene.clear();
  };

  return { scene, camera, ready, setSize, length: () => dLen, update, hitRegions, dispose };
}
