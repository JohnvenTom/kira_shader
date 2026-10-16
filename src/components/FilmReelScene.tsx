import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SECTIONS } from './FilmScene';

/**
 * FilmReelScene — shader.se #selected-work 胶片卷的完整复刻
 *
 * 来源：shader.se 线上 bundle 反编译（ProjectsScene / mT 缎带 / mh 拖拽层 /
 * 外层 renderHandle / projects store），全部数值逐行核对过：
 *
 * 结构（层级与变换全部按原版）：
 *   group(scale 0.4, y=p)                    ← p = 1.6·remap(t,.05,.5)+.2 随推进抬升
 *     └ mesh(y=eg, scale=响应式m)            ← eg = -1.4-0.3·aspect（胶片在下方）
 *         m = clamp(remap(w,500,2560,.7,.9))+.1·aspect ≈ 0.95~1.08
 *
 * 相机（原版 renderHandle 逐行）：
 *   pos(0.2mx, 0.2my, 5-5t)，lookAt(0, 0.03, 0)
 *
 * 背景：尺寸 1.2×/1.4× 视锥高(@距离195)，位置(0, 60p, -200)，
 *   scale(n,n,1) n=1+0.5t；渐变上深下浅（实拍核对）
 *
 * 淡出（原版公式，勿改——摆放正确时中段自然实心）：
 *   alpha = exp(-0.11 · max(0, localLength - 15))
 *
 * 滚动（橡皮筋轮播，原版 mh 拖拽层逐行）：
 *   reelOffset = pointer·frameWidth + 鼠标视差
 *   拖动 = 窥视 ±0.4 帧（drag 像素 clamp ±0.2w，/(0.05w) 折算）
 *   释放 |drag|>0.1·w → 指针 ±1（弹簧 damping14/stiffness90 滑过去）
 *   横向滚轮：累计 0.1·w 翻一帧（700ms 锁）
 *   dragOffsetRef 语义 = 连续 section 指针（idle 为整数索引；无限循环下不设上下限）
 */

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
const FRAME_TEXTURES = [
  '/asset/textures/projects/project-1.gif',
  '/asset/textures/projects/project-2.gif',
  '/asset/textures/projects/project-3.gif',
  '/asset/textures/projects/project-4.gif',
];
/** 拖动窥视折算（原版：reelOffset 偏移 = dragPx / (0.05·width)） */
const DRAG_UNIT = 0.05;
/** 拖动像素钳制（原版 ±0.2·width → ±4 曲线单位 → ±0.4 帧窥视） */
const DRAG_CLAMP_RATIO = 0.2;
/** 释放翻帧阈值（原版 |drag| > 0.1·width） */
const DRAG_SNAP_RATIO = 0.1;
/** 横向滚轮翻帧累计阈值（原版 0.1·width，700ms 锁） */
const WHEEL_STEP_RATIO = 0.1;

/** 原版 nk/nL/nM 数学助手 */
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const remap = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((v - a) * (d - c)) / (b - a);
const lerp = (a: number, b: number, t: number) => (1 - t) * a + t * b;
/** 正模取模（双向）：把任意整数（含负数、超范围）折回 [0, n)。
 *  胶片无限循环用 —— section 索引可以无限增长（胶片位移因此永远连续、无回跳），
 *  只在"消费"它的地方（section 通知 / UI 节号）折回有效节号 */
const wrapIndex = (v: number, n: number) => ((v % n) + n) % n;

/**
 * 构建缎带几何（原版 mu 函数逐行移植）
 */
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

/**
 * 胶片卷 shader（原版 mT colorNode 逐行移植，去掉视频槽/exitProgress 分支）
 */
const ReelShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying vec3 vLocalPos;
    void main() {
      vUv = uv;
      // localPosition：未变换的几何坐标（原版淡出用它 —— 缩放前空间里
      // 远端长度 40~60 → 强淡出消散；世界坐标会被 0.4 缩放压平失效）
      vLocalPos = position;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uInitialReelOffset;
    uniform float uReelOffset;
    uniform float uTextureCount;
    uniform float uCurveLength;
    uniform vec3 uViewPosition;
    uniform float uBorderX;
    uniform float uBorderY;
    uniform float uFrameWidth;
    uniform vec4 uFrameAspect0;
    uniform sampler2D uThumbnails[4];
    uniform float uFlexAnimation;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying vec3 vLocalPos;

    void main() {
      vec2 e = vUv;
      // 原版 flex：uv.x 按抛物线 (y-0.5)² 偏移（滚动速度驱动，见 JS 端）
      vec2 u = vec2(
        e.x - uFlexAnimation * pow(e.y - 0.5, 2.0) * 1e-4,
        e.y
      );

      // 沿片世界距离（原版 A）
      float A = (1.0 - u.x) * uCurveLength
        - uInitialReelOffset - uReelOffset
        + uTextureCount * uFrameWidth
        + uFrameWidth * 3.0;
      // 片头之外 discard（原版 Discard(c)）
      if ((1.0 - u.x) * uCurveLength > uInitialReelOffset) discard;

      float d = floor(A / uFrameWidth);
      float h = (A - d * uFrameWidth) / uFrameWidth;
      int g = int(d - floor(d / uTextureCount) * uTextureCount);

      // === 边框/齿孔判定在前（原版顺序）===
      // 边框像素不需要采样缩略图；先判边框再做 contain 适配，
      // 否则黑边区的提前 return 会短路齿孔逻辑（旧 bug：
      // 恰好只有某帧 GIF 的宽高比让 return 不触发，其余帧齿孔全被吃掉）
      bool border = h < uBorderX || h > 1.0 - uBorderX
        || e.y < uBorderY || e.y > 1.0 - uBorderY;

      vec3 L;
      if (border) {
        // 齿孔（原版：上下外缘带，fract(y·4)/fract(A·2) 打 discard）
        float r = fract(e.y * 4.0);
        float ii = fract(A * 2.0);
        bool hole = (e.y < 0.05 || e.y > 0.95)
          && r > 0.07 && r < 0.93 && ii > 0.25 && ii < 0.75;
        if (hole) discard;
        L = vec3(0.0);
      } else {
        // === 画面区：帧内 UV + contain 适配 + 缩略图 ===
        vec2 f = vec2(
          1.0 - (h - uBorderX) / (1.0 - uBorderX * 2.0),
          (u.y - uBorderY) / (1.0 - uBorderY * 2.0)
        );
        vec2 fit = f;
        float frameAspect = 4.0 / 3.0;
        float texAspect = g == 0 ? uFrameAspect0.x : g == 1 ? uFrameAspect0.y
          : g == 2 ? uFrameAspect0.z : uFrameAspect0.w;
        if (texAspect > frameAspect) {
          float s = frameAspect / texAspect;
          fit.y = (f.y - 0.5) / s + 0.5;
        } else {
          float s = texAspect / frameAspect;
          fit.x = (f.x - 0.5) / s + 0.5;
        }
        // 黑边(letterbox)在画面区内部：直接黑色，不 return
        bool letterbox = fit.y < 0.0 || fit.y > 1.0 || fit.x < 0.0 || fit.x > 1.0;
        vec3 thumb = vec3(0.0);
        if (!letterbox) {
          if (g == 0) thumb = texture2D(uThumbnails[0], fit).rgb;
          else if (g == 1) thumb = texture2D(uThumbnails[1], fit).rgb;
          else if (g == 2) thumb = texture2D(uThumbnails[2], fit).rgb;
          else thumb = texture2D(uThumbnails[3], fit).rgb;
        }
        vec3 x = thumb * 1.055;
        // 远帧去饱和（原版：e.x<.35 全彩，其余 50% 混灰）
        vec3 w = vec3(dot(x, vec3(0.299, 0.587, 0.114)));
        L = e.x < 0.35 ? x : mix(x, w, 0.5);
      }

      // 上下边缘高光条（原版 M=0.005）
      float M = 0.005;
      if (e.y < M) {
        L = mix(vec3(1.0) * 0.2 + L * 0.8, L, e.y / M);
      } else if (e.y >= 1.0 - M) {
        L = mix(vec3(1.0) * 0.1 + L * 0.9, L, (1.0 - e.y) / M);
      }

      // 着色：正对提亮 + 镜面高光（原版 _/z）
      vec3 k = normalize(uViewPosition - vWorldPos);
      vec3 n = normalize(vWorldNormal);
      if (!gl_FrontFacing) n = -n;
      float F = abs(dot(n, k));
      vec3 facing = vec3(0.1) + vec3(0.9) * pow(F, 1.0);
      vec3 P = vec3(14.0, 7.0, 0.0);
      vec3 G = normalize(P - vWorldPos);
      vec3 H = reflect(-G, n);
      float j = pow(max(dot(H, k), 0.0), 35.0);
      vec3 spec = 0.6 * j * vec3(1.0);
      vec3 J = L * facing + spec;

      // 距离淡出已取消：全段不透明（画面优先完整清晰）。
      // 原版公式留档，想恢复时改回：
      //   float Y = max(0.0, length(vLocalPos) - 10.0);
      //   q = exp(max(0.0, Y - 5.0) * -0.11);
      float q = 1.0;
      gl_FragColor = vec4(J, q);
    }
  `,
};

const StarShader = {
  vertex: `
    attribute float aSeed;
    uniform float uTime;
    uniform float uSize;
    varying float vTw;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * (320.0 / max(1.0, -mv.z));
      float ph = aSeed * 6.2831;
      float sp = 0.6 + fract(aSeed * 7.31) * 2.4;
      float tw = pow(0.5 + 0.5 * sin(uTime * sp + ph), 3.0);
      float burst = step(0.972, fract(sin(floor(uTime * 2.0 + aSeed * 13.0)) * 43758.5453));
      vTw = tw * 0.85 + burst * 0.9;
    }
  `,
  fragment: `
    varying float vTw;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float a = smoothstep(0.5, 0.05, length(d));
      gl_FragColor = vec4(vec3(1.0, 0.98, 0.94) * vTw, a * vTw);
    }
  `,
};

interface FilmReelSceneProps {
  /** 滚轮推进进度 ref（-1~1，驱动相机推近/详情页进入）：用 ref 传值，
   *  避免外层滚动帧循环每帧 setState 触发整棵组件树重渲染 */
  scrollProgressRef: React.MutableRefObject<number>;
  /** 鼠标 NDC（-1~1，屏幕向下为正） */
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  /** 连续 section 指针：idle 为整数索引；拖动时 = 索引 + 窥视（原版语义）。
   *  胶片无限循环下不设上下限（可负、可超过 SECTIONS.length），消费处用 wrapIndex 折回 */
  dragOffsetRef: React.MutableRefObject<number>;
  /** section 切换回调 */
  onSectionChange?: (index: number) => void;
  /** 初始 section */
  initialSection?: number;
  /** 是否允许拖动/滚轮切帧（详情页打开时应禁用，防止详情内拖动误切 section） */
  dragEnabled?: boolean;
}

/**
 * FilmReelScene — 胶片卷场景组件（替换旧直线走廊 FilmScene）
 */
export function FilmReelScene({
  scrollProgressRef,
  mouseRef,
  dragOffsetRef,
  onSectionChange,
  initialSection = 0,
  dragEnabled = true,
}: FilmReelSceneProps) {
  const { camera, size } = useThree();
  const dragEnabledRef = useRef(dragEnabled);
  dragEnabledRef.current = dragEnabled;
  const aspect = size.width / Math.max(1, size.height);

  // 曲线 + 几何 + 原版常量
  const { geometry, curveLength, initialReelOffset } = useMemo(() => {
    const pts = REEL_CURVE_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'chordal', 1);
    const len = curve.getLength();
    const geo = buildReelGeometry(curve);
    // 原版稳态 initialReelOffset = 曲线长度 - 8.1
    const init = len - 8.1;
    return { geometry: geo, curveLength: len, initialReelOffset: init };
  }, []);

  // 原版 eg：mesh 在群组本地的 y 偏移（胶片整体在下方）
  const eg = useMemo(() => {
    return aspect <= 1 ? -1.6 : -1.6 - 0.3 * aspect + 0.2;
  }, [aspect]);
  // 原版响应式 mesh 缩放：clamp(remap(w,500,2560,.7,.9))+.1·aspect
  const meshScale = useMemo(() => {
    return clamp(remap(size.width, 500, 2560, 0.7, 0.9), 0.7, 0.9) + 0.1 * aspect;
  }, [size.width, aspect]);

  // GIF 帧贴图
  const aspectRef = useRef(new THREE.Vector4(4 / 3, 4 / 3, 4 / 3, 4 / 3));
  const thumbnails = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return FRAME_TEXTURES.map((url, i) => {
      const tex = loader.load(url, (t) => {
        if (t.image?.width && t.image?.height) {
          aspectRef.current.setComponent(i, t.image.width / t.image.height);
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
  }, []);
  const gifUpdateCursor = useRef(0);
  useEffect(() => {
    return () => thumbnails.forEach((t) => t.dispose());
  }, [thumbnails]);

  // section 状态
  const [sectionIndex, setSectionIndex] = useState(initialSection);
  const lastNotifiedRef = useRef(initialSection);
  useEffect(() => {
    if (onSectionChange && sectionIndex !== lastNotifiedRef.current) {
      lastNotifiedRef.current = sectionIndex;
      onSectionChange(sectionIndex);
    }
  }, [sectionIndex, onSectionChange]);

  const uniforms = useMemo(
    () => ({
      uInitialReelOffset: { value: initialReelOffset },
      uReelOffset: { value: initialSection * REEL_FRAME_WIDTH },
      uTextureCount: { value: FRAME_TEXTURES.length },
      uCurveLength: { value: curveLength },
      uViewPosition: { value: new THREE.Vector3(0, 0, 5) },
      uBorderX: { value: 0.03 },
      uBorderY: { value: 0.07 },
      uFrameWidth: { value: REEL_FRAME_WIDTH },
      uFrameAspect0: { value: aspectRef.current },
      uThumbnails: { value: thumbnails },
      uFlexAnimation: { value: 0 },
    }),
    [initialReelOffset, curveLength, initialSection, thumbnails]
  );

  // 背景：原版尺寸 + 上深下浅渐变（实拍核对）
  const bgSize = useMemo(() => {
    const ec = 2 * Math.tan((65 * Math.PI) / 180 / 2) * 195;
    return { width: 1.2 * ec * aspect, height: 1.4 * ec };
  }, [aspect]);
  const gradientTexture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    // 上深下浅：顶部 rgb(33,25,35) → 0.6 rgb(51,54,115) → 底部 rgb(69,148,197)
    const grad = ctx.createLinearGradient(0, 0, c.width * 0.1, c.height);
    grad.addColorStop(0.2, '#211923');
    grad.addColorStop(0.6, '#333673');
    grad.addColorStop(1.0, '#4594c5');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  const starGeometry = useMemo(() => {
    const COUNT = 1200;
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * bgSize.width * 0.52;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * bgSize.height * 0.52;
      pos[i * 3 + 2] = 0.5 + Math.random() * 6;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, [bgSize.width, bgSize.height]);
  const starUniforms = useMemo(() => ({ uTime: { value: 0 }, uSize: { value: 1.7 } }), []);

  const reelMeshRef = useRef<THREE.Mesh>(null);
  const bgMeshRef = useRef<THREE.Mesh>(null);
  // reelOffset 弹簧状态（原版 en: damping 14 / stiffness 90 → 临界阻尼近似）
  const reelSpringRef = useRef(initialSection * REEL_FRAME_WIDTH);
  const reelVelRef = useRef(0);
  // flex 积分器（原版 ea：lerp 平滑速度，clamp ±300）
  const flexRef = useRef(0);
  // 鼠标视差平滑（原版 eA: stiffness 150 / damping 20）
  const mouseXSmoothRef = useRef(0.5);
  const mouseSmoothedRef = useRef({ x: 0, y: 0 });

  // 拖动/滚轮（原版 mh 拖拽层逐行）
  useEffect(() => {
    let dragging = false;
    let pending = false;
    let startX = 0;
    let startY = 0;
    let pointerStart = 0;
    let lastD = 0; // 本次拖动的钳制像素位移（释放判定用）
    let wheelAcc = 0;
    let wheelLockUntil = 0;
    let wheelResetTimer: number | null = null;

    const down = (e: PointerEvent) => {
      if (!dragEnabledRef.current) return;
      if (e.button !== 0) return;
      const yRatio = e.clientY / window.innerHeight;
      if (yRatio < 0.15 || yRatio > 0.85) return;
      pending = true;
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      pointerStart = dragOffsetRef.current;
      lastD = 0;
    };
    const move = (e: PointerEvent) => {
      if (!pending) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) + Math.abs(dy) <= 10) return;
        if (Math.abs(dx) <= Math.abs(dy)) {
          pending = false; // 垂直意图，放弃
          return;
        }
        dragging = true;
        document.body.style.cursor = 'grabbing';
      }
      // 橡皮筋：像素 → 曲线单位（clamp ±0.2w），再除帧宽折算成 section 指针
      // 窥视。注意必须除 REEL_FRAME_WIDTH：原版 drag 项是曲线单位
      // （±4 曲线单位 ≈ ±0.4 帧），漏除会把窥视放大 9.87 倍扫过 4 个
      // section，拖一下连闪多帧
      const lim = DRAG_CLAMP_RATIO * window.innerWidth;
      const d = clamp(dx, -lim, lim);
      lastD = d;
      dragOffsetRef.current =
        pointerStart - d / (DRAG_UNIT * window.innerWidth * REEL_FRAME_WIDTH);
    };
    const up = () => {
      if (!pending) return;
      pending = false;
      document.body.style.cursor = '';
      if (!dragging) return;
      dragging = false;
      // 释放：|dragPx| > 0.1w → 指针翻一帧（原版 index += −sign(dragPx)）
      let target = Math.round(pointerStart);
      if (Math.abs(lastD) > DRAG_SNAP_RATIO * window.innerWidth) {
        // 无限循环：不夹在 [0, N-1] —— 索引可负、可超过 N，
        // 于是拖过最后一节继续拖 = 胶片继续往前卷、绕回第一节（画面无回跳）
        target = Math.round(pointerStart) - Math.sign(lastD);
      }
      dragOffsetRef.current = target;
    };
    const wheel = (e: WheelEvent) => {
      if (!dragEnabledRef.current) return;
      if (dragging || pending) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // 只吃横向滚轮
      const now = performance.now();
      if (now < wheelLockUntil) return;
      if (wheelResetTimer !== null) window.clearTimeout(wheelResetTimer);
      wheelResetTimer = window.setTimeout(() => {
        wheelAcc = 0;
      }, 150);
      wheelAcc -= e.deltaX;
      const step = WHEEL_STEP_RATIO * window.innerWidth;
      if (Math.abs(wheelAcc) > step) {
        // 原版 index += −sign(acc)：右滚(deltaX>0→acc<0)→下一帧
        // 无限循环：与拖拽同理，只做整数步进、不夹取
        const cur = Math.round(dragOffsetRef.current);
        dragOffsetRef.current = cur - Math.sign(wheelAcc);
        wheelAcc = 0;
        wheelLockUntil = now + 700;
      }
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('wheel', wheel, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('wheel', wheel);
      document.body.style.cursor = '';
      if (wheelResetTimer !== null) window.clearTimeout(wheelResetTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, Math.max(delta, 0.001));

    // GIF 轮换重传（每帧一张）
    const tex = thumbnails[gifUpdateCursor.current % thumbnails.length];
    gifUpdateCursor.current++;
    if (tex.image) tex.needsUpdate = true;

    // === reelOffset 弹簧（原版 useSpring damping14/stiffness90 半隐式欧拉）===
    const targetReel = dragOffsetRef.current * REEL_FRAME_WIDTH;
    const K = 90;
    const C = 14;
    reelVelRef.current += (K * (targetReel - reelSpringRef.current) - C * reelVelRef.current) * dt;
    reelSpringRef.current += reelVelRef.current * dt;
    if (Math.abs(reelSpringRef.current - targetReel) < 0.01 && Math.abs(reelVelRef.current) < 0.5) {
      reelSpringRef.current = targetReel;
      reelVelRef.current = 0;
    }

    // 鼠标视差平滑（原版 eA，加进 reelOffset ±0.02）
    const m01 = (mouseRef.current.x + 1) / 2;
    mouseXSmoothRef.current += (m01 - mouseXSmoothRef.current) * (1 - Math.exp(-12 * dt));
    const sway = (mouseXSmoothRef.current - 0.5) * 0.04;
    uniforms.uReelOffset.value = reelSpringRef.current + sway;

    // flex：速度驱动积分（原版 u = vel·4，lerp 平滑，clamp ±300）
    const flexTarget = -reelVelRef.current * 4;
    flexRef.current = clamp(lerp(flexRef.current, flexTarget, 1 - Math.exp(-10 * dt)), -300, 300);
    uniforms.uFlexAnimation.value = flexRef.current;

    // section 吸附通知：索引无限增长，这里折回 [0, N) 再给 UI / 回调用
    const newSection = wrapIndex(Math.round(dragOffsetRef.current), SECTIONS.length);
    if (newSection !== sectionIndex) setSectionIndex(newSection);

    // === 相机（原版：pos(0.2mx, 0.2my, 5-5t)，lookAt(0, 0.03, 0)）===
    const t = clamp(scrollProgressRef.current, 0, 1);
    const ms = mouseRef.current;
    const sm = mouseSmoothedRef.current;
    sm.x += (ms.x - sm.x) * 0.08;
    sm.y += (ms.y - sm.y) * 0.08;
    camera.position.set(0.2 * sm.x, 0.2 * -sm.y, 5 - 5 * t);
    camera.lookAt(0, 0.03, 0);
    uniforms.uViewPosition.value.copy(camera.position);
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== 65) {
      cam.fov = 65;
      cam.updateProjectionMatrix();
    }

    // === 摆放：p 抬升 + eg 下沉 + 响应式缩放（原版层级等效）===
    const p = 1.6 * (0.05 + 0.45 * t) + 0.2;
    if (reelMeshRef.current) {
      reelMeshRef.current.position.y = p + 0.4 * eg;
      const s = 0.4 * meshScale;
      reelMeshRef.current.scale.set(s, s, s);
    }
    // 背景：位置(0, 60p, -200)，scale(n,n,1)，n = 1+0.5t
    if (bgMeshRef.current) {
      bgMeshRef.current.position.y = 60 * p;
      bgMeshRef.current.position.z = -200;
      const n = 1 + 0.5 * t;
      bgMeshRef.current.scale.set(n, n, 1);
    }
    starUniforms.uTime.value = performance.now() * 0.001;
  });

  return (
    <>
      {/* 渐变背景板（原版：1.2×/1.4× 视锥高 @195，上深下浅；
          toneMapped 必须关——R3F 默认 ACES 会压暗压灰渐变，
          半透明帧/齿孔失去亮底衬就全看不清了） */}
      <mesh ref={bgMeshRef} position={[0, 17, -200]}>
        <planeGeometry args={[bgSize.width, bgSize.height]} />
        <meshBasicMaterial map={gradientTexture} fog={false} toneMapped={false} />
        <points geometry={starGeometry}>
          <shaderMaterial
            uniforms={starUniforms}
            vertexShader={StarShader.vertex}
            fragmentShader={StarShader.fragment}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </points>
      </mesh>

      {/* 胶片卷缎带（原版层级等效：group 0.4 + mesh y=eg + 响应式缩放） */}
      <mesh ref={reelMeshRef} position={[0, 0, 0]} geometry={geometry}>
        <shaderMaterial
          vertexShader={ReelShader.vertexShader}
          fragmentShader={ReelShader.fragmentShader}
          uniforms={uniforms}
          transparent
          side={THREE.DoubleSide}
          // 原版材质未关深度写入（three 默认 true）：缎带自身遮挡靠深度缓冲
          depthWrite
        />
      </mesh>
    </>
  );
}
