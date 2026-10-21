/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { SELECTED_PROJECTS } from './data';
import { createTitlePrism } from './titlePrism';

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
   *  - scrollPhase    纵向滚离停驻点的相位（0=胶片停驻，1=完全推入场景；缺省 0）
   */
  update: (
    dt: number,
    time: number,
    state: { mouseX: number; mouseY: number; selectedIndex: number; dragPx?: number; scrollPhase?: number }
  ) => void;
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
      atlasCtx.save();
      atlasCtx.filter = `brightness(${project.brightness}) contrast(${project.contrast})`;
      atlasCtx.drawImage(img, x, y, ATLAS_CELL_W, ATLAS_CELL_H);
      atlasCtx.restore();
      atlasDirty = true;
    };
    img.onerror = () => {
      // eslint-disable-next-line no-console
      console.warn('[SelectedWork] 缩略图加载失败：', project.thumbnail);
    };
    img.src = project.thumbnail;
    images.push(img);
  });

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

    const gray = T.vec3(T.dot(thumb, T.vec3(0.299, 0.587, 0.114)));
    const x = T.select(uv.x.lessThan(0.35), thumb, T.mix(thumb, gray, 0.5));

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

    let L = T.select(border, T.vec3(0), x).toVar();

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
    const lit = T.vec3(0.1).add(T.vec3(0.9).mul(T.pow(facingDot, 1)));
    const toLight = T.normalize(T.vec3(14, 7, 0).sub(vWorld));
    const halfDir = T.reflect(toLight.negate(), n);
    const spec = T.pow(T.max(T.dot(halfDir, viewDir), 0), 35).mul(0.6);
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
  // 原件平面挂在 z=-300（`position=[0,0,-300]`）；尺寸/纵向偏移按参考截图标定（见 measure 注释）
  bgMesh.position.set(0, 0, -300);
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
  let bgY = 0;
  let eg = -1.6;
  const fovConst = 2 * Math.tan((REEL_FOV * Math.PI) / 180 / 2);

  let reelMeshScale = 1;
  const measure = () => {
    // 背景平面（z=-300）尺寸/位置按参考截图三点标定（等值线线性拟合，R²>0.999）：
    // 高 ≈ 1.362 倍视锥高、中心上移 0.106 倍视锥高 —— 上下边都落在 RT 外：
    // 底端边界由合成门禁的 warp 曲线收出（屏幕 y≈761/747），顶端露出 t≈0.21 的暗蓝。
    // 若平面小于视锥，屏幕底部永远采不到渐变末端的纯蓝，整条背景会偏暗。
    const bgFrustumH = fovConst * 305;
    bgW = 0.986 * bgFrustumH * aspect;
    bgH = 1.362 * bgFrustumH;
    bgY = 0.106 * bgFrustumH;
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
    bgMesh.position.set(0, bgY, -300);
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
  const camMouse = { x: 0, y: 0 };
  let firstFrame = true;

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
    camMouse.x += (state.mouseX - camMouse.x) * (1 - Math.exp(-8 * dts));
    camMouse.y += (state.mouseY - camMouse.y) * (1 - Math.exp(-8 * dts));

    u.reelOffset.value = reelPos + (mouseSmooth - 0.5) * 0.04;

    // 胶片弯折：用（初始偏移速度 − 选中弹簧速度）驱动，clamp ±300
    const flexTarget = clamp(initialVel * 5 - reelVel * 4, -300, 300);
    flex += (flexTarget - flex) * (1 - Math.exp(-10 * dts));
    u.flexAnimation.value = flex;

    // 纵向滚离停驻点：相机向胶片场景推入（原站 1vh→2vh 的镜头运动），标题随透视自然上移出框
    const phase = clamp(state.scrollPhase ?? 0, 0, 1);
    camera.position.set(
      0.2 * camMouse.x,
      0.2 * camMouse.y - phase * 0.32,
      5 - phase * 2.35
    );
    camera.lookAt(0, 0.03 + phase * 0.42, 0);

    prism.update(dts, time);

    if (atlasDirty) {
      atlasDirty = false;
      atlasTexture.needsUpdate = true;
    }
  };

  const dispose = () => {
    geometry.dispose();
    reelMat.dispose();
    atlasTexture.dispose();
    bgMesh.geometry.dispose();
    bgMat.dispose();
    gradientTexture.dispose();
    prism.dispose();
    for (const img of images) {
      img.onload = null;
      img.onerror = null;
    }
  };

  return { scene, camera, setSize, update, dispose };
}
