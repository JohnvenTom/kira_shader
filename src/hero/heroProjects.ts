/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * 第二个场景（Selected Work 胶片卷）的 WebGPU 版
 *
 * 为什么单独写一份：项目里 `src/components/FilmReelScene.tsx` 是 shader.se projects 页的
 * 逐行复刻，但它用的是 WebGL 的 `ShaderMaterial` + GLSL —— 而本页整条管线跑在
 * `three/webgpu` 上（WebGPURenderer + TSL 合成链），两者不能混用。
 * 这里保持**同一份几何、同一套 uniform、同一条片元逻辑**，只把 GLSL 换成 TSL，
 * 于是它可以：
 *   1. 直接渲染进 WebGPURenderTarget（供首页显示器当「传送门」贴图）
 *   2. 在穿越完成后作为整屏场景，继续走同一条合成/调色链
 *
 * 数值来源：FilmReelScene（其本身来自 shader.se 线上 bundle 反编译）——
 * 曲线控制点、画格宽度、齿孔/边框判定、着色公式、相机与摆放全部照搬，未做重设计。
 */

const T = TSL as any;

/** 原版曲线控制点（bundle: ms = new CatmullRomCurve3([...]) ×0.2 ×(1,1,0.8)） */
const REEL_CURVE_POINTS: [number, number, number][] = [
  [-150, -40, -150],
  [-90, -20, -35],
  [0, 0, 10],
  [90, 20, -35],
  [-49, 70, -211],
  [100, 180, -300],
  [-60, 200, -200],
].map(([x, y, z]) => [x * 0.2, y * 0.2, z * 0.2 * 0.8] as [number, number, number]);

const REEL_SEGMENTS = 160;
const REEL_HALF_HEIGHT = 3.75;
/** 画格宽度（原版 N = 4/3·7.36 + 0.06） */
export const REEL_FRAME_WIDTH = (4 / 3) * 7.36 + 0.06;
/** 胶片画格材质（原版 4 张 GIF 轮流上屏） */
const FRAME_TEXTURES = [
  '/asset/textures/projects/project-1.gif',
  '/asset/textures/projects/project-2.gif',
  '/asset/textures/projects/project-3.gif',
  '/asset/textures/projects/project-4.gif',
];
/** 胶片相机固定 fov（原版 FilmReelScene 每帧校正到 65） */
const REEL_FOV = 65;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const remap = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((v - a) * (d - c)) / (b - a);

/** 构建缎带几何（原版 mu 函数逐行移植） */
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
  return geo;
}

export interface HeroProjectsHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 视口尺寸变化：相机宽高比、背景板与响应式缩放 */
  setSize: (width: number, height: number) => void;
  /**
   * 每帧推进
   *  - t          项目页本地推进 0~1（驱动相机 z=5-5t 与胶片抬升）
   *  - mouseX/Y   鼠标 NDC（-1~1，y 向下为正）
   *  - reelOffset 连续 section 指针（整数 = 停帧；拖动时可带小数窥视）
   */
  update: (dt: number, time: number, state: { t: number; mouseX: number; mouseY: number; reelOffset: number }) => void;
  dispose: () => void;
}

/**
 * 创建胶片卷场景
 *
 * 参数：
 *  - width / height {number} 初始视口 CSS 尺寸
 *
 * 返回值：HeroProjectsHandle
 *
 * 注意事项：
 *  - 材质走 TSL node 而不是 ShaderMaterial：WebGPURenderer 不消费 GLSL ShaderMaterial
 *  - 胶片透明区（片外/齿孔/上下边框）用 opacityNode + alphaTest 丢弃，
 *    保持不透明管线（原版 transparent+q=1 等价于全不透明，只是多了排序开销）
 */
export function createHeroProjects(width: number, height: number): HeroProjectsHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0a0a');

  const camera = new THREE.PerspectiveCamera(REEL_FOV, width / Math.max(1, height), 0.1, 1000);

  // ---------- 胶片几何与曲线 ----------
  const pts = REEL_CURVE_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'chordal', 1);
  const curveLength = curve.getLength();
  const initialReelOffset = curveLength - 8.1;
  const geometry = buildReelGeometry(curve);

  // ---------- 画格贴图 ----------
  const loader = new THREE.TextureLoader();
  const frameAspect = new THREE.Vector4(4 / 3, 4 / 3, 4 / 3, 4 / 3);
  const thumbnails = FRAME_TEXTURES.map((url, i) => {
    const tex = loader.load(url, (t) => {
      if (t.image?.width && t.image?.height) {
        frameAspect.setComponent(i, t.image.width / t.image.height);
      }
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
  let gifCursor = 0;

  // ---------- uniforms（与原版同名同义） ----------
  const u = {
    uInitialReelOffset: T.uniform(initialReelOffset),
    uReelOffset: T.uniform(0),
    uTextureCount: T.uniform(FRAME_TEXTURES.length),
    uCurveLength: T.uniform(curveLength),
    uViewPosition: T.uniform(new THREE.Vector3(0, 0, 5)),
    uBorderX: T.uniform(0.03),
    uBorderY: T.uniform(0.07),
    uFrameWidth: T.uniform(REEL_FRAME_WIDTH),
    uFrameAspect0: T.uniform(frameAspect),
    uFlexAnimation: T.uniform(0),
    uStarTime: T.uniform(0),
    /** 星点四边形世界尺寸（由原版 gl_PointSize 公式换算，见 setSize） */
    uStarPointSize: T.uniform(0.6),
    /** 星点铺满的背景面积（bgW×bgH×n，逐帧跟随背景板缩放） */
    uStarArea: T.uniform(new THREE.Vector2(1, 1)),
  };

  // ---------- 缎带材质（原版 mT colorNode 的 TSL 版） ----------
  const reelMat = new THREE.MeshBasicNodeMaterial();
  reelMat.side = THREE.DoubleSide;
  reelMat.toneMapped = false;
  reelMat.alphaTest = 0.5;
  {
    const uv = T.uv();
    const flex = u.uFlexAnimation.mul(T.pow(uv.y.sub(0.5), 2)).mul(1e-4);
    const ux = uv.x.sub(flex);

    const A = T.float(1).sub(ux).mul(u.uCurveLength)
      .sub(u.uInitialReelOffset)
      .sub(u.uReelOffset)
      .add(u.uTextureCount.mul(u.uFrameWidth))
      .add(u.uFrameWidth.mul(3));
    // 片头之外：原版 `if ((1.0 - u.x) * uCurveLength > uInitialReelOffset) discard;`
    const outside = T.float(1).sub(ux).mul(u.uCurveLength).greaterThan(u.uInitialReelOffset);

    const d = T.floor(A.div(u.uFrameWidth));
    const h = A.sub(d.mul(u.uFrameWidth)).div(u.uFrameWidth);
    const g = d.sub(T.floor(d.div(u.uTextureCount)).mul(u.uTextureCount));

    const border = h.lessThan(u.uBorderX)
      .or(h.greaterThan(T.float(1).sub(u.uBorderX)))
      .or(uv.y.lessThan(u.uBorderY))
      .or(uv.y.greaterThan(T.float(1).sub(u.uBorderY)));

    // 齿孔（原版：上下外缘带，fract(y·4)/fract(A·2) 打洞）
    const r4 = T.fract(uv.y.mul(4));
    const ii = T.fract(A.mul(2));
    const holeBand = uv.y.lessThan(0.05).or(uv.y.greaterThan(0.95));
    const hole = holeBand
      .and(r4.greaterThan(0.07)).and(r4.lessThan(0.93))
      .and(ii.greaterThan(0.25)).and(ii.lessThan(0.75));
    const cut = border.and(hole);

    // 帧内 UV + contain 适配
    const f = T.vec2(
      T.float(1).sub(h.sub(u.uBorderX).div(T.float(1).sub(u.uBorderX.mul(2)))),
      uv.y.sub(u.uBorderY).div(T.float(1).sub(u.uBorderY.mul(2)))
    );
    const texAspect = T.select(
      g.lessThan(0.5), u.uFrameAspect0.x,
      T.select(
        g.lessThan(1.5), u.uFrameAspect0.y,
        T.select(g.lessThan(2.5), u.uFrameAspect0.z, u.uFrameAspect0.w)
      )
    );
    const frameAspectF = T.float(4 / 3);
    const wideTex = texAspect.greaterThan(frameAspectF);
    const fitX = T.select(
      wideTex,
      f.x,
      f.x.sub(0.5).div(texAspect.div(frameAspectF)).add(0.5)
    );
    const fitY = T.select(
      wideTex,
      f.y.sub(0.5).div(frameAspectF.div(texAspect)).add(0.5),
      f.y
    );
    const fit = T.vec2(fitX, fitY);
    const letterbox = fitX.lessThan(0).or(fitX.greaterThan(1))
      .or(fitY.lessThan(0)).or(fitY.greaterThan(1));

    // 原版分支取贴图；TSL 里四张都采、再按 g 选择（结果等价，无动态索引限制）
    const sample = (tex: THREE.Texture) => T.texture(tex, fit).rgb;
    const thumb = T.select(
      g.lessThan(0.5), sample(thumbnails[0]),
      T.select(
        g.lessThan(1.5), sample(thumbnails[1]),
        T.select(g.lessThan(2.5), sample(thumbnails[2]), sample(thumbnails[3]))
      )
    );
    const x = thumb.mul(1.055);
    const gray = T.vec3(T.dot(x, T.vec3(0.299, 0.587, 0.114)));
    // 远帧去饱和（原版：e.x<.35 全彩，其余 50% 混灰）
    const frameColor = T.select(uv.x.lessThan(0.35), x, T.mix(x, gray, 0.5));
    const L0 = T.select(border, T.vec3(0, 0, 0), T.select(letterbox, T.vec3(0, 0, 0), frameColor));

    // 上下边缘高光条（原版 M=0.005）
    const M = 0.005;
    const L1 = T.select(
      uv.y.lessThan(M),
      T.mix(T.vec3(1).mul(0.2).add(L0.mul(0.8)), L0, uv.y.div(M)),
      L0
    );
    const L = T.select(
      uv.y.greaterThanEqual(1 - M),
      T.mix(T.vec3(1).mul(0.1).add(L1.mul(0.9)), L1, T.float(1).sub(uv.y).div(M)),
      L1
    );

    // 着色：正对提亮 + 镜面高光（原版 _/z）
    const viewDir = T.normalize(u.uViewPosition.sub(T.positionWorld));
    const n0 = T.normalize(T.normalWorld);
    // faceDirection = float(frontFacing) * 2 - 1（TSL 内置；不能直接对 bool 做算术）
    const n = n0.mul(T.faceDirection);
    const facingDot = T.abs(T.dot(n, viewDir));
    const facing = T.vec3(0.1).add(T.vec3(0.9).mul(T.pow(facingDot, 1)));
    const lightPos = T.vec3(14, 7, 0);
    const toLight = T.normalize(lightPos.sub(T.positionWorld));
    const halfDir = T.reflect(toLight.negate(), n);
    const spec = T.pow(T.max(T.dot(halfDir, viewDir), 0), 35).mul(0.6);
    const J = L.mul(facing).add(T.vec3(spec));

    reelMat.colorNode = T.vec4(J, 1);
    reelMat.opacityNode = T.select(outside.or(cut), 0, 1);
  }

  const reelMesh = new THREE.Mesh(geometry, reelMat);
  scene.add(reelMesh);

  // ---------- 渐变背景 + 星点（原版尺寸/渐变逐值照搬） ----------
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 4;
  bgCanvas.height = 256;
  {
    const ctx = bgCanvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, bgCanvas.width * 0.1, bgCanvas.height);
    grad.addColorStop(0.2, '#211923');
    grad.addColorStop(0.6, '#333673');
    grad.addColorStop(1.0, '#4594c5');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
  }
  const gradientTexture = new THREE.CanvasTexture(bgCanvas);
  gradientTexture.colorSpace = THREE.SRGBColorSpace;

  const bgMat = new THREE.MeshBasicNodeMaterial();
  bgMat.toneMapped = false;
  bgMat.colorNode = T.texture(gradientTexture, T.uv()).rgb;

  const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat);
  bgMesh.position.set(0, 17, -200);
  scene.add(bgMesh);

  // 星点：原版是 gl_PointSize 的点精灵，WebGPU 的点图元固定 1px 且没有 gl_PointCoord，
  // 这里改成每颗星一个四边形（4 顶点），片元用 uv 到中心的距离做圆形衰减。
  // 位置存归一化坐标（±0.52），由 uStarArea 逐帧铺到背景尺寸；四边形不挂在 bgMesh 下，
  // 否则会被 (bgW,bgH) 的非均匀缩放拉成长条。
  let starGeometry: THREE.BufferGeometry | null = null;
  let starMat: THREE.MeshBasicNodeMaterial | null = null;
  let starMesh: THREE.Mesh | null = null;
  {
    const COUNT = 1200;
    const pos = new Float32Array(COUNT * 4 * 3);
    const uv = new Float32Array(COUNT * 4 * 2);
    const seed = new Float32Array(COUNT * 4);
    const index: number[] = [];
    const CORNERS = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (let i = 0; i < COUNT; i++) {
      const nx = (Math.random() * 2 - 1) * 0.52;
      const ny = (Math.random() * 2 - 1) * 0.52;
      const nz = 0.5 + Math.random() * 6;
      const s = Math.random();
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        pos[v * 3] = nx;
        pos[v * 3 + 1] = ny;
        pos[v * 3 + 2] = nz;
        uv[v * 2] = CORNERS[c][0];
        uv[v * 2 + 1] = CORNERS[c][1];
        seed[v] = s;
      }
      const t = i * 4;
      index.push(t, t + 1, t + 2, t, t + 2, t + 3);
    }
    starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    starGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    starGeometry.setIndex(index);

    starMat = new THREE.MeshBasicNodeMaterial();
    starMat.transparent = true;
    starMat.depthWrite = false;
    starMat.blending = THREE.AdditiveBlending;
    starMat.toneMapped = false;

    const aSeed = T.attribute('aSeed', 'float');
    const phase = aSeed.mul(6.2831);
    const speed = T.float(0.6).add(T.fract(aSeed.mul(7.31)).mul(2.4));
    const twinkle = T.pow(
      T.float(0.5).add(T.float(0.5).mul(T.sin(u.uStarTime.mul(speed).add(phase)))),
      3
    );
    const burst = T.step(
      0.972,
      T.fract(T.sin(T.floor(u.uStarTime.mul(2).add(aSeed.mul(13)))).mul(43758.5453))
    );
    // 属性只能在顶点阶段取，闪烁系数做成 varying 传到片元
    const tw = twinkle.mul(0.85).add(burst.mul(0.9)).varying('vTw');

    const uvAttr = T.uv();
    // 顶点：归一化中心 × 背景面积 + 四边形角偏移
    const center = T.vec3(
      T.positionGeometry.x.mul(u.uStarArea.x),
      T.positionGeometry.y.mul(u.uStarArea.y),
      T.positionGeometry.z
    );
    const corner = uvAttr.sub(0.5);
    starMat.positionNode = center.add(T.vec3(
      corner.x.mul(u.uStarPointSize),
      corner.y.mul(u.uStarPointSize),
      0
    ));
    starMat.colorNode = T.vec3(1, 0.98, 0.94).mul(tw);
    starMat.opacityNode = T.smoothstep(0.5, 0.05, T.length(corner)).mul(tw);

    starMesh = new THREE.Mesh(starGeometry, starMat);
    starMesh.frustumCulled = false;
    // 与原版一致：星点贴在背景板前方（bgMesh 在 z=-200，原版星点是它的子节点）
    starMesh.position.set(0, 17, -200);
    scene.add(starMesh);
  }

  // ---------- 状态 ----------
  let aspect = width / Math.max(1, height);
  let bgW = 1;
  let bgH = 1;
  let eg = -1.6;
  let meshScale = 1;
  const fovConst = 2 * Math.tan((REEL_FOV * Math.PI) / 180 / 2);

  const measure = () => {
    const ec = fovConst * 195;
    bgW = 1.2 * ec * aspect;
    bgH = 1.4 * ec;
    eg = aspect <= 1 ? -1.6 : -1.6 - 0.3 * aspect + 0.2;
    meshScale = clamp(remap(width, 500, 2560, 0.7, 0.9), 0.7, 0.9) + 0.1 * aspect;
  };
  measure();

  let spring = 0;
  let springVel = 0;
  let flex = 0;
  /** 胶片横向视差平滑（原件在 0~1 空间，stiffness 12） */
  let parallax = 0.5;
  /** 相机鼠标平滑（原件逐帧 0.08） */
  const camMouse = { x: 0, y: 0 };
  let initialized = false;

  const setSize = (w: number, h: number) => {
    width = Math.max(1, w);
    height = Math.max(1, h);
    aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    measure();
    bgMesh.scale.set(bgW, bgH, 1);
    // 原版 gl_PointSize = 1.7 * 320 / max(1, -mv.z)（设备像素）→ 世界尺寸：
    // pointPx * 2tan(fov/2) * dist / framebufferH，dist 与 /dist 相消
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    u.uStarPointSize.value = (1.7 * 320 * fovConst) / Math.max(1, height * dpr);
    u.uStarArea.value.set(bgW, bgH);
  };
  setSize(width, height);

  const update: HeroProjectsHandle['update'] = (dt, time, state) => {
    const dts = Math.min(0.05, Math.max(dt, 0.001));

    // GIF 轮换重传（原版每帧一张）
    const tex = thumbnails[gifCursor % thumbnails.length];
    gifCursor++;
    if (tex.image) tex.needsUpdate = true;

    // reelOffset 弹簧（原版 damping14 / stiffness90 半隐式欧拉）
    const target = state.reelOffset * REEL_FRAME_WIDTH;
    if (!initialized) {
      initialized = true;
      spring = target;
      springVel = 0;
    }
    springVel += (90 * (target - spring) - 14 * springVel) * dts;
    spring += springVel * dts;
    if (Math.abs(spring - target) < 0.01 && Math.abs(springVel) < 0.5) {
      spring = target;
      springVel = 0;
    }

    // 鼠标视差平滑（原件 eA：在 0~1 空间做 stiffness 12，再映射回 ±.02）
    const m01 = (state.mouseX + 1) / 2;
    parallax += (m01 - parallax) * (1 - Math.exp(-12 * dts));
    const sway = (parallax - 0.5) * 0.04;
    u.uReelOffset.value = spring + sway;

    // flex：速度驱动积分（原版 u = vel·4，clamp ±300）
    flex = clamp(flex + (-springVel * 4 - flex) * (1 - Math.exp(-10 * dts)), -300, 300);
    u.uFlexAnimation.value = flex;

    // 相机（原版：pos(0.2mx, 0.2my, 5-5t)，lookAt(0, 0.03, 0)；鼠标逐帧 0.08）
    const t = clamp(state.t, 0, 1);
    camMouse.x += (state.mouseX - camMouse.x) * 0.08;
    camMouse.y += (state.mouseY - camMouse.y) * 0.08;
    camera.position.set(0.2 * camMouse.x, 0.2 * -camMouse.y, 5 - 5 * t);
    camera.lookAt(0, 0.03, 0);
    u.uViewPosition.value.copy(camera.position);

    // 摆放：p 抬升 + eg 下沉 + 响应式缩放
    const p = 1.6 * (0.05 + 0.45 * t) + 0.2;
    reelMesh.position.y = p + 0.4 * eg;
    const s = 0.4 * meshScale;
    reelMesh.scale.set(s, s, s);

    // 背景：位置(0, 60p, -200)，scale(n,n,1)，n = 1+0.5t
    bgMesh.position.y = 60 * p;
    const n = 1 + 0.5 * t;
    bgMesh.scale.set(bgW * n, bgH * n, 1);

    // 星点跟背景同位置、同铺满面积（四边形本身不缩放，避免被拉长）
    if (starMesh) starMesh.position.set(0, 60 * p, -200);
    u.uStarArea.value.set(bgW * n, bgH * n);

    u.uStarTime.value = time;
  };

  const dispose = () => {
    geometry.dispose();
    reelMat.dispose();
    thumbnails.forEach((t) => t.dispose());
    bgMesh.geometry.dispose();
    bgMat.dispose();
    gradientTexture.dispose();
    starGeometry?.dispose();
    starMat?.dispose();
  };

  return { scene, camera, setSize, update, dispose };
}
