/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { SELECTED_PROJECTS } from './data';
import { createTitlePrism } from './titlePrism';
import { createSpringMouse } from '../work-about/springMouse';

/**
 * Selected Work 三维场景（线上 `ProjectsScene` + 胶片材质 `mT` + 标题棱柱 `m7`）
 *
 * 与旧 `heroProjects.ts` 的区别（全部按新版 bundle 重写）：
 *  - 11 张真实项目缩略图（4×3 图集，按项目亮度预烘焙），不再是 4 张循环 GIF
 *  - 画格按 `exp(-0.11·max(0, len(local)-15))` 随离相机距离淡出
 *  - 选中态是离散序号 + 弹簧：`reelOffset = index·frameWidth + 1000·count·frameWidth - dragPx/(0.05·w)`
 *  - 四棱柱旋转标题、无星点（新版第二场景没有星空）
 *  - 背景、曲线、畸变、镜面高光、齿孔与前版同源
 *
 * 场景内不处理 DOM 输入：选中序号与拖拽像素由页面/首页主循环传入。
 */
const T = TSL as any;

const CURVE_POINTS: [number, number, number][] = [
  [-150, -40, -150],
  [-90, -20, -35],
  [0, 0, 10],
  [90, 20, -35],
  [-49, 70, -211],
  [100, 180, -300],
  [-60, 200, -200],
].map(([x, y, z]) => [x * 0.2, y * 0.2, z * 0.2 * 0.8]);

const REEL_SEGMENTS = 160;
const REEL_HALF_HEIGHT = 3.75;
/** 画格宽度（线上 `N = 4/3·7.36 + 0.06`） */
export const REEL_FRAME_WIDTH = (4 / 3) * 7.36 + 0.06;
const REEL_FOV = 65;
const PROJECT_COUNT = SELECTED_PROJECTS.length;

/** 缩略图图集：4 列 × 3 行，单格 800×600 */
const ATLAS_COLS = 4;
const ATLAS_ROWS = Math.ceil(PROJECT_COUNT / ATLAS_COLS);
const ATLAS_CELL_W = 800;
const ATLAS_CELL_H = 600;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const remap = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((v - a) * (d - c)) / (b - a);

/** 缎带几何（线上 `mu` 逐行移植，包含法线 z 符号修正与顶点法线重算） */
function buildReelGeometry(curve: THREE.CatmullRomCurve3): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= REEL_SEGMENTS; i++) {
    const a = i / REEL_SEGMENTS;
    const p = curve.getPointAt(a);
    const tan = curve.getTangentAt(a);
    const side = new THREE.Vector3().crossVectors(tan, up).normalize();
    if (side.lengthSq() < 0.001) side.crossVectors(tan, new THREE.Vector3(0, 0, 1)).normalize();
    const nrm = new THREE.Vector3().crossVectors(side, tan).normalize();
    const nz = nrm.z > 0 ? -nrm.z : nrm.z;
    positions.push(p.x, p.y - REEL_HALF_HEIGHT, p.z);
    positions.push(p.x, p.y + REEL_HALF_HEIGHT, p.z);
    normals.push(nrm.x, nrm.y, nz);
    normals.push(nrm.x, nrm.y, nz);
    uvs.push(a, 0);
    uvs.push(a, 1);
    if (i < REEL_SEGMENTS) {
      const t = 2 * i;
      indices.push(t, t + 1, t + 2);
      indices.push(t + 1, t + 3, t + 2);
    }
  }
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export interface SelectedWorkSceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setSize: (width: number, height: number) => void;
  /**
   * 每帧推进
   *  - mouseX/mouseY  鼠标 NDC（-1~1，y 向上为正）
   *  - selectedIndex  当前选中项目（整数；可越界取模）
   *  - dragPx         拖拽位移（CSS px，右正；松手后由页面清零并决定是否换页）
   *  - pageScroll     原站主页面 scroll（屏；1.0=projects 页起点）。缺省按 1.05 摆位，
   *                   供 hero 页沿用现有画面；WorkAbout 传真实 scroll。
   *  - exitProgress   原站画格蒙版进度（projects.end−0.7 → +0.2，0..1）
   *  - frameZoom      转场镜头推近（1 = 原位；≈3 = 激活画格铺满屏幕，原站入场实测形态）
  */
  update: (
    dt: number,
    time: number,
    state: {
      mouseX: number;
      mouseY: number;
      selectedIndex: number;
      dragPx?: number;
      pageScroll?: number;
      exitProgress?: number;
      frameZoom?: number;
    }
  ) => void;
  /** office 场景纹理（raw，projects 页 shader 以屏幕坐标采样进激活画格） */
  setTransitionTexture: (texture: THREE.Texture | null) => void;
  /**
   * 详情子页纹理（胶片格蒙版，按画格自身 uv 采样）
   *
   * 说明：与 office 的 screenUV 采样不同 —— 详情页要「整页塞进胶片格」，
   *      所以用画格内框 uv（f）采样；镜头推近时整格放大直到铺满屏幕。
   */
  setFrameTexture: (texture: THREE.Texture | null) => void;
  /** 画格蒙版进度 0..1（0 = 胶片画面，1 = 详情页完全占据画格） */
  setFrameProgress: (progress: number) => void;
  /** 选中弹簧当前速度（px/s）——宿主用它判断胶片是否静止，静止才做子页预建等重活 */
  getReelVelocity: () => number;
  dispose: () => void;
}

export function createSelectedWorkScene(width: number, height: number): SelectedWorkSceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101225');

  const camera = new THREE.PerspectiveCamera(REEL_FOV, width / Math.max(1, height), 0.1, 320);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0.03, 0);

  // ---------- 曲线与几何 ----------
  const pts = CURVE_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'chordal', 1);
  const curveLength = curve.getLength();
  const initialReelOffset = curveLength - 8.1;
  const geometry = buildReelGeometry(curve);

  // ---------- 缩略图图集（亮度预烘焙） ----------
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = ATLAS_COLS * ATLAS_CELL_W;
  atlasCanvas.height = ATLAS_ROWS * ATLAS_CELL_H;
  const atlasCtx = atlasCanvas.getContext('2d');
  if (atlasCtx) {
    atlasCtx.fillStyle = '#0c0c0e';
    atlasCtx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  }
  let atlasDirty = true;
  const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  atlasTexture.minFilter = THREE.LinearFilter;
  atlasTexture.magFilter = THREE.LinearFilter;
  atlasTexture.generateMipmaps = false;
  atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
  atlasTexture.wrapT = THREE.ClampToEdgeWrapping;

  // 逐帧 brightness（图集同序：标题数组反序）。用 1D 纹理取样，
  // 避免 20 个 uniform 的逐帧分支；原件 contrast 全为 1，故只存亮度。
  const brightnessData = new Uint8Array(PROJECT_COUNT * 4);
  SELECTED_PROJECTS.forEach((project, index) => {
    const g = PROJECT_COUNT - 1 - index;
    brightnessData[g * 4] = Math.round(clamp(project.brightness, 0, 1) * 255);
    brightnessData[g * 4 + 3] = 255;
  });
  const brightnessTexture = new THREE.DataTexture(brightnessData, PROJECT_COUNT, 1, THREE.RGBAFormat);
  brightnessTexture.colorSpace = THREE.NoColorSpace;
  brightnessTexture.minFilter = THREE.NearestFilter;
  brightnessTexture.magFilter = THREE.NearestFilter;
  brightnessTexture.generateMipmaps = false;
  brightnessTexture.needsUpdate = true;

  const images: HTMLImageElement[] = [];
  SELECTED_PROJECTS.forEach((project, index) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!atlasCtx) return;
      // 线上胶片材质使用 prismicProjects.map(...).reverse() —— 与标题数组顺序相反。
      // 标题 index 0 = eHealth；胶片卷中心 g=10 时才对应 eHealth。
      const atlasIndex = PROJECT_COUNT - 1 - index;
      const col = atlasIndex % ATLAS_COLS;
      // 纹理默认 flipY=true（v=0 对应画布底行），因此图集第 g 格画在自底向上第 rowFromBottom 行
      const rowFromBottom = Math.floor(atlasIndex / ATLAS_COLS);
      const x = col * ATLAS_CELL_W;
      const y = atlasCanvas.height - (rowFromBottom + 1) * ATLAS_CELL_H;
      // 原图入图集：brightness/contrast 留到着色器里按帧应用，
      // 这样 exitProgress 才能把亮度归一（原件 I = brightness·(1−e)+e）
      atlasCtx.drawImage(img, x, y, ATLAS_CELL_W, ATLAS_CELL_H);
      atlasDirty = true;
    };
    img.onerror = () => {
      // eslint-disable-next-line no-console
      console.warn('[SelectedWork] 缩略图加载失败：', project.thumbnail);
    };
    img.src = project.thumbnail;
    images.push(img);
  });

  // office 未就绪时的占位纹理（1×1 黑）；WorkAbout 每帧替换为 raw office RT
  const transitionPlaceholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  transitionPlaceholder.colorSpace = THREE.NoColorSpace;
  transitionPlaceholder.needsUpdate = true;
  // 详情子页占位：必须与 transitionPlaceholder 分开实例 —— 两个 TextureNode 共用一个
  // THREE.Texture 时 WebGPU 绑定表会复用同一 binding，后绑定的那个采样恒为黑
  const framePlaceholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  framePlaceholder.colorSpace = THREE.NoColorSpace;
  framePlaceholder.needsUpdate = true;

  // ---------- 胶片材质 ----------
  const u = {
    initialReelOffset: T.uniform(initialReelOffset),
    reelOffset: T.uniform(0),
    textureCount: T.uniform(PROJECT_COUNT),
    curveLength: T.uniform(curveLength),
    viewPosition: T.uniform(new THREE.Vector3(0, 0, 5)),
    borderX: T.uniform(0.03),
    borderY: T.uniform(0.07),
    frameWidth: T.uniform(REEL_FRAME_WIDTH),
    flexAnimation: T.uniform(0),
    /** 原件 exitProgress：画格内混入下一场景 + 亮度/光照/高光归一 */
    exitProgress: T.uniform(0),
    /** 当前激活画格（图集索引 g） */
    activeIndex: T.uniform(-1),
    /** 下一场景纹理（raw office），screenUV 采样 */
    transitionTexture: T.texture(transitionPlaceholder),
    /** 详情子页纹理（胶片格蒙版，画格内框 uv 采样） */
    frameTexture: T.texture(framePlaceholder),
    /** 画格蒙版进度 0..1 */
    frameProgress: T.uniform(0),
  };

  const reelMat = new THREE.MeshBasicNodeMaterial();
  reelMat.toneMapped = false;
  reelMat.transparent = true;
  // 原件保持默认 depthWrite=true：近处画格必须遮挡后方上层卷曲，否则会透出后续画格
  reelMat.side = THREE.DoubleSide;

  const vWorld = T.vec3(0).varying('vWorldPos');
  const vNormal = T.vec3(0).varying('vWorldNormal');
  const vLocal = T.vec3(0).varying('vLocalPos');
  reelMat.positionNode = T.Fn(() => {
    const p = T.positionLocal;
    vWorld.assign(T.modelWorldMatrix.mul(T.vec4(p, 1)).xyz);
    vNormal.assign(T.normalWorld);
    vLocal.assign(p);
    return p;
  })();

  // 颜色链包在 Fn 里：r169 的 `.assign()` 依赖 currentStack，裸写在材质顶层会拿到 null
  reelMat.colorNode = T.Fn(() => {
    const uv = T.uv();
    const flex = u.flexAnimation.mul(T.pow(uv.y.sub(0.5), 2)).mul(1e-4);
    const ux = uv.x.sub(flex);
    const count = u.textureCount.toFloat();

    const A = T.float(1)
      .sub(ux)
      .mul(u.curveLength)
      .sub(u.initialReelOffset)
      .sub(u.reelOffset)
      .add(count.mul(u.frameWidth))
      .add(u.frameWidth.mul(3))
      .toVar();
    const outside = T.float(1).sub(ux).mul(u.curveLength).greaterThan(u.initialReelOffset);
    T.Discard(outside);

    const d = T.floor(A.div(u.frameWidth));
    const h = A.sub(d.mul(u.frameWidth)).div(u.frameWidth);
    // 全程浮点取模：WGSL 的 floor 没有整数重载，一旦转成 int 会让整条材质管线编译失败
    const g = d.sub(T.floor(d.div(count)).mul(count));

    const f = T.vec2(
      T.oneMinus(h.sub(u.borderX).div(T.oneMinus(u.borderX.mul(2)))),
      uv.y.sub(u.borderY).div(T.oneMinus(u.borderY.mul(2)))
    );

    // 图集取样：列 = g mod 4，行（自画布底部计）= floor(g/4)
    // CanvasTexture 默认 flipY，v=0 对应画布底行 —— 与烘焙时「项目 0 在底行」一致
    const col = g.sub(T.floor(g.div(T.float(ATLAS_COLS))).mul(T.float(ATLAS_COLS)));
    const row = T.floor(g.div(ATLAS_COLS));
    const atlasUv = T.vec2(
      col.add(f.x).div(ATLAS_COLS),
      row.add(f.y).div(ATLAS_ROWS)
    );
    const thumb = T.texture(atlasTexture, atlasUv).rgb.mul(1.05);
    // 原件逐帧 brightness（contrast 全为 1）；图集是 raw 颜色
    const frameBrightness = T.texture(
      brightnessTexture,
      T.vec2(g.add(0.5).div(count), 0.5)
    ).r;

    const gray = T.vec3(T.dot(thumb, T.vec3(0.299, 0.587, 0.114)));
    const x = T.select(uv.x.lessThan(0.35), thumb, T.mix(thumb, gray, 0.5));

    // 原件 exitProgress 分支：激活画格内按屏幕坐标混入下一场景（raw office），
    // 随后把整条胶片的亮度/光照/高光归一到“无风格”状态
    const isActiveFrame = T.abs(g.sub(u.activeIndex)).lessThan(0.5);
    // 原件 `texture(transitionTexture, screenCoordinate / resolution)`：直接屏幕坐标。
    // screenUV 本身就是 y 向下的屏幕坐标惯例，页 RT（同一 renderer 渲出）存储即屏幕序
    // （用 ?debugRT= 分屏实测确认：screenUV 直采正立、quad uv 翻采颠倒），
    // 直接采样即可；此前在 screenUV 上再叠一层 oneMinus 形成双重翻转，
    // 导致 projects→office 转场期间激活画格内的 office 画面上下颠倒
    const officeScreen = u.transitionTexture.uv(T.screenUV).rgb;
    const showOffice = uv.x.lessThan(0.35)
      .and(u.exitProgress.greaterThan(0))
      .and(isActiveFrame);
    const withOffice = T.select(showOffice, T.mix(x, officeScreen, u.exitProgress), x);
    // 详情子页：用**胶片格内框当遮罩**，页面本身按屏幕坐标采样（与 projects→office 的
    // transitionTexture 同一机制）——
    //  · 页面在遮罩里保持 1:1 屏幕尺度，画格/镜头推近时只是「窗口变大」，不是把整页拉伸进画格；
    //  · 遮罩铺满屏幕的那一刻，格内画面与合成链的 subPage 全屏纹理完全重合，交接零跳变。
    // 进度由合成层 spring 驱动：0 = 胶片画面，1 = 详情页完全占据画格
    // TextureNode 的采样必须走 `.uv()`（T.texture() 只吃 THREE 纹理对象，传 TextureNode 会抛错）。
    // 约定与 officeScreen 完全一致：RT 纹理由 TSL 依 isRenderTargetTexture 自动翻 V，
    // 这里不再手动 flipY（图集诊断实证 screenUV 直采正立；手动叠加 flipY 会双重翻转）
    const framePage = u.frameTexture.uv(T.screenUV).rgb;
    const showFrame = uv.x.lessThan(0.35)
      .and(u.frameProgress.greaterThan(0))
      .and(isActiveFrame);
    const withFrame = T.select(showFrame, T.mix(withOffice, framePage, u.frameProgress), withOffice);
    // 原件 `mix(_, 1, e·1.1)` / `mix(z, 0, e·1.1)`：不做 clamp，e=1 时会外推到纯白 / 负高光
    // 画格蒙版（详情页）也吃同一套「去风格化」权重：页面占满画格时亮度/光照归一、镜面高光消失
    const flatT = T.max(u.exitProgress, u.frameProgress);
    const exitLight = flatT.mul(1.1);
    const brightMix = T.mix(frameBrightness, T.float(1), flatT);
    const shade = withFrame.mul(brightMix).toVar();

    const border = h.lessThan(u.borderX)
      .or(h.greaterThan(T.oneMinus(u.borderX)))
      .or(uv.y.lessThan(u.borderY))
      .or(uv.y.greaterThan(T.oneMinus(u.borderY)));

    // 齿孔：上下外缘带，fract(y·4) 与 fract(A·2) 打洞
    const r4 = T.fract(uv.y.mul(4));
    const ii = T.fract(A.mul(2));
    const hole = uv.y.lessThan(0.05)
      .or(uv.y.greaterThan(0.95))
      .and(r4.greaterThan(0.07))
      .and(r4.lessThan(0.93))
      .and(ii.greaterThan(0.25))
      .and(ii.lessThan(0.75));
    T.Discard(hole);

    let L = T.select(border, T.vec3(0), shade).toVar();

    const M = 0.005;
    L.assign(
      T.select(
        uv.y.lessThan(M),
        T.mix(T.vec3(1).mul(0.2).add(L.mul(0.8)), L, uv.y.div(M)),
        L
      )
    );
    L.assign(
      T.select(
        uv.y.greaterThanEqual(1 - M),
        T.mix(T.vec3(1).mul(0.1).add(L.mul(0.9)), L, T.float(1).sub(uv.y).div(M)),
        L
      )
    );

    const viewDir = T.normalize(u.viewPosition.sub(vWorld));
    const n = T.normalize(vNormal);
    const facingDot = T.abs(T.dot(n, viewDir));
    const litBase = T.vec3(0.1).add(T.vec3(0.9).mul(T.pow(facingDot, 1)));
    // 原件 `mix(_, 1, exitProgress·1.1)` + `mix(z, 0, exitProgress·1.1)`
    const lit = T.mix(litBase, T.vec3(1), exitLight);
    const toLight = T.normalize(T.vec3(14, 7, 0).sub(vWorld));
    const halfDir = T.reflect(toLight.negate(), n);
    const spec = T.pow(T.max(T.dot(halfDir, viewDir), 0), 35).mul(0.6).mul(T.oneMinus(exitLight));
    const J = L.mul(lit).add(T.vec3(spec));

    const distFromCenter = T.length(vLocal);
    const alpha = T.exp(T.max(T.max(distFromCenter.sub(10), 0).sub(5), 0).mul(-0.11));
    return T.vec4(J, alpha);
  })();

  const reelMesh = new THREE.Mesh(geometry, reelMat);

  // ---------- 渐变背景 ----------
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 16;
  bgCanvas.height = 1024;
  {
    const ctx = bgCanvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, bgCanvas.height);
    grad.addColorStop(0.2, 'rgb(33,25,35)');
    grad.addColorStop(0.6, 'rgb(51,54,115)');
    grad.addColorStop(1.0, 'rgb(69,148,197)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
  }
  const gradientTexture = new THREE.CanvasTexture(bgCanvas);
  gradientTexture.colorSpace = THREE.SRGBColorSpace;
  const bgMat = new THREE.MeshBasicNodeMaterial();
  bgMat.toneMapped = false;
  // 原件 `<np rotation={0.1}>`：纹理矩阵绕中心旋转 0.1rad，这里直接在 UV 上复现
  const bgRot = 0.1;
  const bgCos = Math.cos(bgRot);
  const bgSin = Math.sin(bgRot);
  const bgUv = T.uv().sub(0.5).toVar();
  const bgRotUv = T.vec2(
    bgUv.x.mul(bgCos).add(bgUv.y.mul(bgSin)),
    bgUv.x.mul(-bgSin).add(bgUv.y.mul(bgCos))
  ).add(0.5);
  bgMat.colorNode = T.texture(gradientTexture, bgRotUv).rgb;
  const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat);
  // 原件：平面挂 z=-200，尺寸按初始相机到 z=-190 的距离算，位置 y=60·p 随页面滚动上移
  bgMesh.position.set(0, 0, -200);
  scene.add(bgMesh);

  // ---------- 棱柱标题 + 胶片（同一个 0.4 缩放组） ----------
  const prism = createTitlePrism(0);
  const group = new THREE.Group();
  group.scale.setScalar(0.4);
  group.position.set(0, 0.28, 0);
  group.add(prism.mesh);
  group.add(reelMesh);
  scene.add(group);

  // ---------- 尺寸 ----------
  let aspect = width / Math.max(1, height);
  let bgW = 1;
  let bgH = 1;
  let eg = -1.6;
  const fovConst = 2 * Math.tan((REEL_FOV * Math.PI) / 180 / 2);
  /** 原件背景平面尺寸：`ec=2·tan(fov/2)·|camZ−(−190)|`，`[1.2·ec·aspect, 1.4·ec]` */
  const BG_REF_DIST = 195;

  let reelMeshScale = 1;
  const measure = () => {
    const ec = fovConst * BG_REF_DIST;
    bgW = 1.2 * ec * aspect;
    bgH = 1.4 * ec;
    eg = aspect <= 1 ? -1.6 : -1.6 - 0.3 * aspect + 0.2;
    reelMeshScale = clamp(remap(width, 500, 2560, 0.7, 0.9), 0.7, 0.9) + 0.1 * aspect;
  };

  const setSize = (w: number, h: number) => {
    width = Math.max(1, w);
    height = Math.max(1, h);
    aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    measure();
    bgMesh.scale.set(bgW, bgH, 1);
    bgMesh.position.set(0, 0, -200);
    reelMesh.position.set(0, eg, 0);
    reelMesh.scale.set(reelMeshScale, reelMeshScale, reelMeshScale);
    prism.setSize(width, height);
  };
  setSize(width, height);

  // ---------- 运行时状态 ----------
  let selectedIndex = 0;
  let dragPx = 0;
  let reelPos = selectedIndex * REEL_FRAME_WIDTH;
  let reelVel = 0;
  let flex = 0;
  const initialVel = 0;
  let mouseSmooth = 0.5;
  /** 相机视差阻尼（原站 useSpringMouse spring(60,30)，跟 offset 语义 ±0.5） */
  const camMouse = createSpringMouse();
  let firstFrame = true;
  /** 上一帧相机 zoom（只在变化时重算投影矩阵） */
  let lastZoom = 1;

  const update: SelectedWorkSceneHandle['update'] = (dt, time, state) => {
    const dts = clamp(dt, 0.001, 0.05);

    if (state.selectedIndex !== selectedIndex) {
      selectedIndex = state.selectedIndex;
      prism.select(selectedIndex);
    }
    dragPx = state.dragPx ?? 0;

    // 选中态弹簧（线上 damping 14 / stiffness 90；目标就是 index·N − 拖拽像素折算）
    // 不要叠加 1000·count·N 之类的大数：float32 在大数上做取模会丢精度，画格会偏几帧
    const target = selectedIndex * REEL_FRAME_WIDTH - dragPx / (0.05 * width);
    if (firstFrame) {
      firstFrame = false;
      reelPos = target;
      reelVel = 0;
    }
    reelVel += (90 * (target - reelPos) - 14 * reelVel) * dts;
    reelPos += reelVel * dts;

    // 鼠标横向视差 + 相机视差
    const mouse01 = clamp((state.mouseX + 1) / 2, 0, 1);
    mouseSmooth += (mouse01 - mouseSmooth) * (1 - Math.exp(-10 * dts));
    camMouse.update(dts, -state.mouseX * 0.5, -state.mouseY * 0.5);

    u.reelOffset.value = reelPos + (mouseSmooth - 0.5) * 0.04;

    // 胶片弯折：用（初始偏移速度 − 选中弹簧速度）驱动，clamp ±300
    const flexTarget = clamp(initialVel * 5 - reelVel * 4, -300, 300);
    flex += (flexTarget - flex) * (1 - Math.exp(-10 * dts));
    u.flexAnimation.value = flex;

    // 原件 ProjectsScene 机位（page-rig）：A=scroll−.05，t=remap(A,1,2,0,.95)
    // camera.z=5−5t；胶片组 y=1.6·remap(A,1,2,.05,.5)+.2；lookAt y 随 A 升到 .25；
    // 背景 y=60p 并以 remap(t) 放大。缺省 1.05 保持 hero 页现有画面。
    const pageScroll = state.pageScroll ?? 1.05;
    const A = pageScroll - 0.05;
    const t = remap(A, 1, 2, 0, 0.95);
    /** 原件 `r = remap(A, .95, 2, 0, 1)`，既是背景放大基准也是相机 y 的下沉量 */
    const r = remap(A, 0.95, 2, 0, 1);
    const groupY = 1.6 * remap(A, 1, 2, 0.05, 0.5) + 0.2;
    const lookY = remap(A, 0.95, 2, 0.03, 0.25);
    const bgScale = t < 0 ? remap(t, -1, 0, 1.5, 1) : remap(t, 0, 1, 1, 1.5);
    group.position.y = groupY;
    bgMesh.position.set(0, 60 * groupY, -200);
    // 原件逐帧 `ea.current?.scale.set(n,n,1)`（两轴同步缩放）
    bgMesh.scale.set(bgW * bgScale, bgH * bgScale, 1);
    // 原件 `.2 * mouseOffset.x` / `-r + .2 * mouseOffset.y`（offset=0.5−mouse01 ∈ ±0.5，spring 阻尼）
    camera.position.set(0.2 * camMouse.px, -r + 0.2 * camMouse.py, 5 - 5 * t);
    camera.lookAt(0, lookY, 0);
    // 转场镜头推近：camera.zoom（改投影矩阵、不改机位）——画格放大成遮罩窗口；
    // 格内详情页按 screenUV 1:1 采样不受影响（原站入场 t≈900-1250ms 实测形态）
    const zoom = Math.max(0.1, state.frameZoom ?? 1);
    if (Math.abs(zoom - lastZoom) > 1e-4) {
      lastZoom = zoom;
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }

    u.exitProgress.value = state.exitProgress ?? 0;
    const active = ((PROJECT_COUNT - 1 - selectedIndex) % PROJECT_COUNT + PROJECT_COUNT) % PROJECT_COUNT;
    u.activeIndex.value = active;

    prism.update(dts, time);

    if (atlasDirty) {
      atlasDirty = false;
      atlasTexture.needsUpdate = true;
    }
  };

  const setTransitionTexture = (texture: THREE.Texture | null) => {
    u.transitionTexture.value = texture ?? transitionPlaceholder;
  };

  /** 详情子页纹理（胶片格蒙版）：页面按屏幕坐标采样、由激活画格的内框当遮罩 */
  const setFrameTexture = (texture: THREE.Texture | null) => {
    const next = texture ?? framePlaceholder;
    if (next === u.frameTexture.value) return;
    u.frameTexture.value = next;
    // 占位是 rgba8 DataTexture，换成 rgba16f 的 RenderTarget 纹理后必须重建材质：
    // three 的 WebGPU 绑定布局按纹理格式编译，不重建会一直按旧格式采样（恒为黑）
    reelMat.needsUpdate = true;
  };

  /** 画格蒙版进度（0..1） */
  const setFrameProgress = (progress: number) => {
    u.frameProgress.value = progress;
  };

  const dispose = () => {
    geometry.dispose();
    reelMat.dispose();
    atlasTexture.dispose();
    brightnessTexture.dispose();
    transitionPlaceholder.dispose();
    bgMesh.geometry.dispose();
    bgMat.dispose();
    gradientTexture.dispose();
    prism.dispose();
    for (const img of images) {
      img.onload = null;
      img.onerror = null;
    }
  };

  return { scene, camera, setSize, update, setTransitionTexture, setFrameTexture, setFrameProgress, getReelVelocity: () => reelVel, dispose };
}
