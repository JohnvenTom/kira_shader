import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SECTIONS } from './FilmScene';

/**
 * FilmReelScene — shader.se #selected-work 胶片卷的 1:1 复刻
 *
 * 来源：shader.se 线上 bundle 反编译（ProjectsScene / mT 组件 / ms 曲线）
 *
 * 构成（全部按原版数值移植）：
 *  1. 几何：一条 chordal CatmullRomCurve3（7 控制点，×0.2、z 再 ×0.8）
 *     挤出的缎带 —— 160 段、高 7.5（±3.75），uv.x = 沿片 0~1
 *  2. 片身完全程序化（fragment shader）：
 *     - 沿片距离 A = (1-uv.x)·curveLength − initialReelOffset − reelOffset + …
 *     - 画格索引 d = floor(A/frameWidth)，帧内坐标 h，贴图循环 g = d mod count
 *     - borderX 0.03 / borderY 0.07 内缩出黑框
 *     - 齿孔：上下 5% 边带内 fract(uv.y·4)/fract(A·2) 打的 discard 真透明孔
 *     - 远离相机的画格 50% 去饱和（原版 e.x<.35 分支）
 *     - 着色：正对相机亮度 0.1+0.9·|N·V|、(14,7,0) 方向 35° 镜面高光、
 *       上下边缘 0.5% 高光条、距离 alpha 衰减 exp(-0.11·(dist-15))
 *  3. 交互：相机固定 (0,0,5)+鼠标视差 ±0.2（原版同款），
 *     拖动改为滚胶片（reelOffset），section 吸附逻辑与旧走廊一致
 *  4. 背景：原版渐变背板（rgb(33,25,35)→(51,54,115)→(69,148,197)）
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

/** 缎带分段数（原版 160） */
const REEL_SEGMENTS = 160;
/** 缎带半高（原版 ±3.75，总高 7.5） */
const REEL_HALF_HEIGHT = 3.75;
/** 画格宽度（原版 N = 4/3·7.36 + 0.06 ≈ 9.873，4:3 画幅 + 0.06 间隙） */
export const REEL_FRAME_WIDTH = (4 / 3) * 7.36 + 0.06;
/** 帧贴图（项目 GIF 循环，与 SECTIONS 解耦 —— 原版即 mod textureCount 循环） */
const FRAME_TEXTURES = [
  '/asset/textures/projects/project-1.gif',
  '/asset/textures/projects/project-2.gif',
  '/asset/textures/projects/project-3.gif',
  '/asset/textures/projects/project-4.gif',
];

/**
 * 构建缎带几何（原版 mu 函数逐行移植）
 *
 * 功能：沿曲线取 160+1 个截面，每截面挤出上下两个顶点（±3.75），
 *      side = cross(tangent, up)，normal = cross(side, tangent)；
 *      法线 z 分量统一取负（原版 A.z>0 ? -A.z : A.z 的压平 hack，
 *      让缎带两面都朝 +z 相机方向受光）
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
    uniform float uFlexAnimation;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying vec3 vLocalPos;
    void main() {
      vUv = uv;
      // 原版 flex：uv.x 按抛物线 (y-0.5)² 偏移 —— 胶片"甩动"形变
      vec3 pos = position;
      // localPosition：未变换的几何坐标（原版淡出用它 —— 缩放前空间里
      // 远端长度 40~60，淡出强劲；若用世界坐标会被 0.42 缩放压平失效）
      vLocalPos = pos;
      vec4 wp = modelMatrix * vec4(pos, 1.0);
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
    uniform vec4 uFrameAspect0;  // 每帧贴图宽高比（x/y/z/w = 4 张贴图，逐张实测）
    uniform sampler2D uThumbnails[4];
    uniform float uExitProgress;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying vec3 vLocalPos;

    void main() {
      vec2 e = vUv;
      float flex = 0.0; // flexAnimation 固定 0（原版入场甩动，暂不启用）
      vec2 u = vec2(e.x - flex * pow(e.y - 0.5, 2.0) * 1e-4, e.y);

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

      // 帧内 UV（原版 f：x 镜像 + border 内缩）
      vec2 f = vec2(
        1.0 - (h - uBorderX) / (1.0 - uBorderX * 2.0),
        (u.y - uBorderY) / (1.0 - uBorderY * 2.0)
      );
      // 贴图 contain 适配（原版 mux 图 fitMode=preserve 的黑边语义）
      vec2 fit = f;
      float frameAspect = 4.0 / 3.0;
      float texAspect = g == 0 ? uFrameAspect0.x : g == 1 ? uFrameAspect0.y
        : g == 2 ? uFrameAspect0.z : uFrameAspect0.w;
      if (texAspect > frameAspect) {
        float s = frameAspect / texAspect;
        fit.y = (f.y - 0.5) / s + 0.5;
        if (fit.y < 0.0 || fit.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      } else {
        float s = texAspect / frameAspect;
        fit.x = (f.x - 0.5) / s + 0.5;
        if (fit.x < 0.0 || fit.x > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      }
      vec3 thumb = vec3(0.0);
      if (g == 0) thumb = texture2D(uThumbnails[0], fit).rgb;
      else if (g == 1) thumb = texture2D(uThumbnails[1], fit).rgb;
      else if (g == 2) thumb = texture2D(uThumbnails[2], fit).rgb;
      else thumb = texture2D(uThumbnails[3], fit).rgb;
      vec3 x = thumb * 1.055;

      // 远帧去饱和（原版：e.x<.35 全彩，其余 50% 混灰）
      vec3 w = vec3(dot(x, vec3(0.299, 0.587, 0.114)));
      vec3 Q = e.x < 0.35 ? x : mix(x, w, 0.5);

      // 画格黑框 + 齿孔
      bool border = h < uBorderX || h > 1.0 - uBorderX
        || e.y < uBorderY || e.y > 1.0 - uBorderY;
      vec3 L = Q;
      if (border) {
        float r = fract(e.y * 4.0);
        float ii = fract(A * 2.0);
        bool hole = (e.y < 0.05 || e.y > 0.95)
          && r > 0.07 && r < 0.93 && ii > 0.25 && ii < 0.75;
        if (hole) discard;
        L = vec3(0.0);
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
      vec3 J = L * mix(facing, vec3(1.0), uExitProgress * 1.1)
        + mix(spec, vec3(0.0), uExitProgress * 1.1);

      // 距离 alpha 衰减：主视野内（localLength ≤28）保持完全实心，
      // 只有扫向高处的远端（35+）快速化开消散。
      // （原版公式 exp(-0.11·(len-15)) 的陡峭段是为相机推近(z≈1.9)视野
      //   设计的——推近后幽灵段不在画面；我们稳态相机 z=5，全露出来
      //   会显得中段"镂空/断掉"，故右移起点校准观感）
      float q = exp(-0.14 * max(0.0, length(vLocalPos) - 28.0));
      gl_FragColor = vec4(J, q);
    }
  `,
};

interface FilmReelSceneProps {
  /** 滚轮推进进度 0~1（驱动相机推近/详情页进入，沿用旧语义） */
  scrollProgress: number;
  /** 鼠标 NDC（-1~1，屏幕向下为正） */
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  /** 拖动偏移（0 ~ -(SECTIONS.length-1)·4，沿用旧走廊语义） */
  dragOffsetRef: React.MutableRefObject<number>;
  /** section 切换回调 */
  onSectionChange?: (index: number) => void;
  /** 初始 section */
  initialSection?: number;
}

/**
 * FilmReelScene — 胶片卷场景组件（替换旧直线走廊 FilmScene）
 */
export function FilmReelScene({
  scrollProgress,
  mouseRef,
  dragOffsetRef,
  onSectionChange,
  initialSection = 0,
}: FilmReelSceneProps) {
  const { camera, size } = useThree();
  const progressRef = useRef(scrollProgress);
  progressRef.current = scrollProgress;

  // 曲线 + 几何（一次性）
  const { geometry, curveLength, initialReelOffset } = useMemo(() => {
    const pts = REEL_CURVE_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'chordal', 1);
    const len = curve.getLength();
    const geo = buildReelGeometry(curve);
    // 原版稳态 initialReelOffset = 曲线长度 - 8.1（bundle 实测值）：
    // 只裁掉曲线起端 8.1 单位，且该处 alpha 已被淡出压到 ~0.07，断边隐形。
    // （旧值 L-3·帧宽 裁掉 16%，断边怼在画面里）
    const init = len - 8.1;
    return { geometry: geo, curveLength: len, initialReelOffset: init };
  }, []);

  // GIF 帧贴图（<img> 动图 + 每帧轮换 needsUpdate 重传当前帧）
  const aspectRef = useRef(new THREE.Vector4(4 / 3, 4 / 3, 4 / 3, 4 / 3));
  const thumbnails = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return FRAME_TEXTURES.map((url, i) => {
      const tex = loader.load(url, (t) => {
        // 实测宽高比（4 张 GIF 比例各不相同，contain 适配用）
        if (t.image?.width && t.image?.height) {
          aspectRef.current.setComponent(
            i,
            t.image.width / t.image.height
          );
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
  // 轮换重传：每帧传 1 张 → 4 张各 ~15fps，控制上传带宽
  const gifUpdateCursor = useRef(0);
  useEffect(() => {
    return () => thumbnails.forEach((t) => t.dispose());
  }, [thumbnails]);

  // section 状态（通知 DOM 覆盖层）
  const [sectionIndex, setSectionIndex] = useState(initialSection);
  const lastNotifiedRef = useRef(initialSection);
  useEffect(() => {
    if (onSectionChange && sectionIndex !== lastNotifiedRef.current) {
      lastNotifiedRef.current = sectionIndex;
      onSectionChange(sectionIndex);
    }
  }, [sectionIndex, onSectionChange]);

  // 材质 uniforms
  const uniforms = useMemo(
    () => ({
      uInitialReelOffset: { value: initialReelOffset },
      uReelOffset: { value: -initialSection * REEL_FRAME_WIDTH },
      uTextureCount: { value: FRAME_TEXTURES.length },
      uCurveLength: { value: curveLength },
      uViewPosition: { value: new THREE.Vector3(0, 0, 5) },
      uBorderX: { value: 0.03 },
      uBorderY: { value: 0.07 },
      uFrameWidth: { value: REEL_FRAME_WIDTH },
      uFrameAspect0: { value: aspectRef.current },
      uThumbnails: { value: thumbnails },
      uExitProgress: { value: 0 },
    }),
    [initialReelOffset, curveLength, initialSection, thumbnails]
  );

  // 拖动平滑 + 相机（原版 projects 相机公式）
  // 原版 reelOffset = +index × frameWidth（正号，bundle: en = Q·N）：
  // 拖左 → index↑ → 帧向相机左侧滑动（跟手的"抓住胶片拖"语义）
  const reelSmoothedRef = useRef(initialSection * REEL_FRAME_WIDTH);
  const mouseSmoothedRef = useRef({ x: 0, y: 0 });
  const reelMeshRef = useRef<THREE.Mesh>(null);
  const bgMeshRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, Math.max(delta, 0.001));

    // GIF 轮换重传（每帧一张）
    const tex = thumbnails[gifUpdateCursor.current % thumbnails.length];
    gifUpdateCursor.current++;
    if (tex.image) tex.needsUpdate = true;

    // 拖动 → 胶片滚动：原版 reelOffset = +index × frameWidth（正号）。
    // 拖左（dragOffset 变负）→ progress↑ → offset↑ → 帧向左滑（跟手）
    const sectionProgress = -dragOffsetRef.current / 4; // 0 ~ SECTIONS.length-1 连续
    const targetReel = sectionProgress * REEL_FRAME_WIDTH;
    reelSmoothedRef.current += (targetReel - reelSmoothedRef.current) * (1 - Math.exp(-12 * dt));
    uniforms.uReelOffset.value = reelSmoothedRef.current;

    // section 吸附通知（round 正向 offset）
    const newSection = Math.max(
      0,
      Math.min(SECTIONS.length - 1, Math.round(reelSmoothedRef.current / REEL_FRAME_WIDTH))
    );
    if (newSection !== sectionIndex) setSectionIndex(newSection);

    // 相机：原版 Y.position.set(.2mx, -r+.2my, m)，m = 5-5t，lookAt(0, i, 0)
    const t = Math.min(1, Math.max(0, progressRef.current));
    const ms = mouseRef.current;
    const sm = mouseSmoothedRef.current;
    sm.x += (ms.x - sm.x) * 0.08;
    sm.y += (ms.y - sm.y) * 0.08;
    camera.position.set(0.2 * sm.x, 0.2 * -sm.y, 5 - 5 * t);
    // 视线上抬：把胶片压到画面中下带（原版构图：上方留渐变背景 + 标题空间）
    camera.lookAt(0, 0.5, 0);
    uniforms.uViewPosition.value.copy(camera.position);
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== 65) {
      cam.fov = 65;
      cam.updateProjectionMatrix();
    }

    // 胶片抬升 p（原版 p = 1.6·remap(scroll, .05→.5)+.2 ≈ 0.28~1.0，随推进抬升）
    const p = 1.6 * (0.05 + 0.45 * t) + 0.2;
    if (reelMeshRef.current) reelMeshRef.current.position.y = p;
    if (bgMeshRef.current) bgMeshRef.current.position.y = 60 * p;
  });

  // 背景渐变板（原版 rgb(33,25,35)→(51,54,115)→(69,148,197)，z=-200）
  const gradientTexture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, c.width * 0.2, c.height);
    grad.addColorStop(0.2, '#4594c5');
    grad.addColorStop(0.6, '#333673');
    grad.addColorStop(1.0, '#211923');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  // 背板尺寸：盖住 fov65 在 z=-205 处的视锥（原版 1.2×/1.4× 视锥高）
  const bgSize = useMemo(() => {
    const h = 2 * Math.tan((65 * Math.PI) / 180 / 2) * 205;
    return { width: h * (size.width / Math.max(1, size.height)) * 1.4, height: h * 1.6 };
  }, [size]);

  return (
    <>
      {/* 渐变背景板（原版：普通不透明 meshBasicMaterial，无 renderOrder/深度覆盖） */}
      <mesh ref={bgMeshRef} position={[0, 17, -200]}>
        <planeGeometry args={[bgSize.width, bgSize.height]} />
        <meshBasicMaterial map={gradientTexture} fog={false} />
      </mesh>

      {/* 胶片卷缎带（原版：group scale 0.4 × mesh scale 1.05 = 0.42；
          y = p = 1.6·remap(scroll, .05,.5)+.2 ≈ 0.28~1.0 随推进抬升。
          漏乘 group 0.4 会让胶片放大 2.5 倍糊满屏幕） */}
      <mesh ref={reelMeshRef} position={[0, 0.28, 0]} scale={[0.42, 0.42, 0.42]} geometry={geometry}>
        <shaderMaterial
          vertexShader={ReelShader.vertexShader}
          fragmentShader={ReelShader.fragmentShader}
          uniforms={uniforms}
          transparent
          side={THREE.DoubleSide}
          // 原版材质未关深度写入（three 默认 true）：缎带自身在屏幕上
          // 重叠时靠深度缓冲做前后遮挡；关掉会按三角形顺序乱画（前后穿帮）
          depthWrite
        />
      </mesh>
    </>
  );
}
