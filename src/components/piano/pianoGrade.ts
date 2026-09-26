/**
 * pianoGrade - 钢琴页风格化后期（对齐磁带页的 暗房/影棚/动画 三件套）
 *
 * 功能：
 *  - 一条全屏 Grade 通道，包含三个可叠加的舞台：
 *      · 胶片舞台：径向色散 + 冷暖分离调色 + 光晕 halation + 暗角 + 胶片颗粒
 *      · 三渲二舞台（动画）：亮度色阶海报化（带抖动）+ 深度/法线双信号墨线描边
 *        （移植自磁带页 cassette/src/post.js 的 toon stage）
 *      · 合成舞台：把 3D 画面按 alpha 合成到程序化摄影棚背景上
 *        （对应 CSS .piano-backdrop 的渐变，使暗角/颗粒作用于整帧，
 *        三种风格各有一套背景色板，与雾色在地平线衔接）
 *  - PIANO_STYLES：三种风格的完整预设（Grade uniforms + 场景侧参数）。
 *    切换风格时由 PianoPostProcessing / PianoScene 对数值做指数阻尼渐变，
 *    与磁带页 setTheme 的"整套房间一起走"观感一致。
 *
 * 参数：无（纯常量与 shader 定义）
 *
 * 返回值：PIANO_GRADE_SHADER / PIANO_STYLES / PianoStyleName
 *
 * 异常：无
 *
 * 注意事项：
 *  - 墨线依赖深度纹理：透明区域（天空）深度为 1，片元里直接跳过，
 *    与磁带页一致（否则从 d=1 重建视空间坐标会产生 NaN）
 *  - 本 shader 工作在 OutputPass 之后的显示空间（sRGB），与磁带页 Grade 相同
 */
import * as THREE from 'three';

/** 风格名（与磁带页 theme 命名对齐） */
export type PianoStyleName = 'studio' | 'noir' | 'toon';

/** Grade 通道 uniform 预设（数值语义与磁带页 Grade 一致） */
export interface PianoGradePreset {
  /** 胶片颗粒强度 */
  grain: number;
  /** 暗角强度 */
  vig: number;
  /** 径向色散强度 */
  ca: number;
  /** 高光光晕（halation）强度 */
  hal: number;
  /** 饱和度（noir 压到 0.22 得到近黑白） */
  sat: number;
  /** 冷暖分离调色强度（阴影偏冷 / 高光偏暖） */
  split: number;
  /** 三渲二权重（0 关 / 1 开） */
  toon: number;
  /** 亮度色阶数 */
  levels: number;
  /** 色阶压平强度 */
  flat: number;
  /** 墨线强度 */
  ink: number;
  /** 墨线采样宽度（texel 倍数） */
  inkWidth: number;
}

/** 场景侧风格参数（由 PianoScene 在帧循环里阻尼逼近） */
export interface PianoScenePreset {
  /** 雾色（≈背景中段色，保证地平线无缝） */
  fog: [number, number, number];
  /** 地面圆盘颜色 */
  ground: [number, number, number];
  /** 曝光 */
  exposure: number;
  /** 灯光缩放：主光 / 半球环境 / 补光与轮廓光 */
  key: number;
  hemi: number;
  fill: number;
  /** 漂浮微尘整体透明度 */
  dust: number;
  /** 体积光柱不透明度 */
  beam: number;
}

/** 单一风格完整预设 */
export interface PianoStyle {
  grade: PianoGradePreset;
  scene: PianoScenePreset;
  /** 程序化背景色板：顶部 / 地平线中段 / 画幅底部 */
  bgTop: [number, number, number];
  bgMid: [number, number, number];
  bgFloor: [number, number, number];
  /** 顶部聚光（对应 CSS radial-gradient 的顶部白光）：uv 位置 / 半径 / 颜色 / 强度 */
  spotPos: [number, number];
  spotRadius: number;
  spotColor: [number, number, number];
  spotStrength: number;
}

/** 十六进制 → 原始 sRGB 0~1 三元组。
 *  注意：三种消费端各自解释 ——
 *  - Grade 背景色板工作在 OutputPass 之后的显示空间，直接用原始分量；
 *  - 雾 / 地面颜色在线性工作空间，由 PianoScene 用 setRGB(..., SRGBColorSpace) 转换。 */
function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** 三种风格预设：影棚（默认，明亮摄影棚+轻胶片）/ 暗房（黑白戏剧光）/ 动画（三渲二） */
export const PIANO_STYLES: Record<PianoStyleName, PianoStyle> = {
  studio: {
    grade: { grain: 0.030, vig: 0.28, ca: 0.30, hal: 0.025, sat: 1.0, split: 0.20, toon: 0, levels: 4, flat: 0.85, ink: 0.6, inkWidth: 1.5 },
    scene: { fog: rgb(0xe9ecf1), ground: rgb(0xdfe3ea), exposure: 0.95, key: 1.0, hemi: 1.0, fill: 1.0, dust: 0.55, beam: 0.10 },
    bgTop: rgb(0xfdfdfe), bgMid: rgb(0xeceef3), bgFloor: rgb(0xdde1e9),
    spotPos: [0.5, -0.06], spotRadius: 0.62, spotColor: rgb(0xffffff), spotStrength: 0.55,
  },
  noir: {
    grade: { grain: 0.085, vig: 0.95, ca: 0.55, hal: 0.060, sat: 0.22, split: 0.50, toon: 0, levels: 4, flat: 0.85, ink: 0.6, inkWidth: 1.5 },
    scene: { fog: rgb(0x10141b), ground: rgb(0x14181f), exposure: 0.82, key: 0.92, hemi: 0.45, fill: 0.55, dust: 0.6, beam: 0.16 },
    bgTop: rgb(0x05060a), bgMid: rgb(0x10141a), bgFloor: rgb(0x171b22),
    spotPos: [0.5, 0.06], spotRadius: 0.46, spotColor: rgb(0x8ca2c8), spotStrength: 0.30,
  },
  toon: {
    grade: { grain: 0.020, vig: 0.32, ca: 0.15, hal: 0.015, sat: 1.12, split: 0.20, toon: 1, levels: 4, flat: 0.88, ink: 0.60, inkWidth: 1.5 },
    scene: { fog: rgb(0xeef0f2), ground: rgb(0xdfe2e7), exposure: 1.0, key: 1.06, hemi: 1.15, fill: 1.0, dust: 0.30, beam: 0.06 },
    bgTop: rgb(0xdfe3e8), bgMid: rgb(0xeef0f2), bgFloor: rgb(0xf8f9fa),
    spotPos: [0.5, -0.04], spotRadius: 0.60, spotColor: rgb(0xffffff), spotStrength: 0.45,
  },
};

/** Grade 全屏通道 shader（磁带页 Grade 的钢琴版：胶片舞台 + 三渲二舞台 + 背景合成） */
export const PIANO_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.DepthTexture | null },
    uProjInv: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uGrain: { value: 0.03 },
    uVig: { value: 0.28 },
    uCA: { value: 0.3 },
    uSat: { value: 1.0 },
    uSplit: { value: 0.55 },
    uHal: { value: 0.03 },
    // 三渲二舞台
    uToon: { value: 0 },
    uLevels: { value: 4.0 },
    uFlat: { value: 0.85 },
    uInk: { value: 0.6 },
    uInkWidth: { value: 1.5 },
    uInkColor: { value: new THREE.Color(0x0b0a10) },
    // 程序化背景色板
    uBgTop: { value: new THREE.Color(0xfdfdfe) },
    uBgMid: { value: new THREE.Color(0xeceef3) },
    uBgFloor: { value: new THREE.Color(0xdde1e9) },
    uSpot: { value: new THREE.Vector2(0.5, -0.06) },
    uSpotRadius: { value: 0.62 },
    uSpotColor: { value: new THREE.Color(0xffffff) },
    uSpotStrength: { value: 0.55 },
    uAspect: { value: 1.0 },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDepth;
    uniform mat4 uProjInv;
    uniform float uTime, uGrain, uVig, uCA, uSat, uSplit, uHal;
    uniform float uToon, uLevels, uFlat, uInk, uInkWidth;
    uniform vec3 uInkColor;
    uniform vec3 uBgTop, uBgMid, uBgFloor, uSpotColor;
    uniform vec2 uSpot, uTexel;
    uniform float uSpotRadius, uSpotStrength, uAspect;
    varying vec2 vUv;

    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p + 19.19); return fract(p.x * p.y); }

    /* 程序化摄影棚背景：垂直渐变 + 顶部聚光（对应 CSS .piano-backdrop） */
    vec3 backdrop(vec2 uv) {
      // 地平线（背景中段）固定在画幅 42% 高度附近，与雾色衔接
      vec3 col = mix(uBgTop, uBgMid, 1.0 - smoothstep(0.42, 1.0, uv.y));
      col = mix(col, uBgFloor, smoothstep(0.42, 0.98, uv.y));
      vec2 asp = vec2(uAspect, 1.0);
      float sp = smoothstep(uSpotRadius, 0.0, distance((uv - uSpot) * asp, vec2(0.0)));
      return mix(col, uSpotColor, sp * uSpotStrength);
    }

    vec3 viewPos(vec2 uv, float d) {
      vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      return p.xyz / p.w;
    }
    vec3 normalAt(vec2 uv, float d) {
      vec3 p = viewPos(uv, d);
      return normalize(cross(dFdx(p), dFdy(p)));
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      // 径向色散：RGB 沿视半径方向分离（画面中心不变形）
      vec2 off = d * r2 * uCA * 0.012;
      vec4 scene;
      scene.r = texture2D(tDiffuse, uv + off).r;
      scene.g = texture2D(tDiffuse, uv).g;
      scene.b = texture2D(tDiffuse, uv - off).b;
      scene.a = texture2D(tDiffuse, uv).a;

      // 合成：3D 画面按覆盖度压在程序化背景上，后续整帧统一调色
      vec3 c = mix(backdrop(uv), scene.rgb, scene.a);

      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

      // filmic split tone —— 冷阴影 / 暖高光，强度随风格
      vec3 shadowTint = mix(vec3(1.0), vec3(0.93, 0.985, 1.07), uSplit);
      vec3 highTint = mix(vec3(1.0), vec3(1.055, 1.005, 0.935), uSplit);
      c *= mix(shadowTint, highTint, smoothstep(0.16, 0.86, l));
      // halation：最亮高光处的暖色溢出
      c += vec3(1.0, 0.60, 0.32) * smoothstep(0.78, 1.0, l) * uHal;
      c = mix(vec3(l), c, uSat);

      /* ---- 三渲二舞台：色阶海报化 + 墨线折痕/轮廓 ------------------------
         墨线来自两路独立信号（与磁带页一致）：深度一阶差分重建的法线突变
         捕捉部件相接的折痕，视空间深度台阶捕捉对地面/天空的剪影。
         透明区域深度为 1（无几何体），直接跳过避免 NaN。 */
      if (uToon > 0.001) {
        float d0 = texture2D(tDepth, uv).x;
        if (d0 < 0.99999) {
          vec2 tx = uTexel * uInkWidth;
          float dR = texture2D(tDepth, uv + vec2(tx.x, 0.0)).x;
          float dL = texture2D(tDepth, uv - vec2(tx.x, 0.0)).x;
          float dU = texture2D(tDepth, uv + vec2(0.0, tx.y)).x;
          float dD = texture2D(tDepth, uv - vec2(0.0, tx.y)).x;

          float z0 = -viewPos(uv, d0).z;
          float thr = 0.013 * z0;
          float step0 = abs(-viewPos(uv + vec2(tx.x, 0.0), dR).z - z0);
          step0 = max(step0, abs(-viewPos(uv - vec2(tx.x, 0.0), dL).z - z0));
          step0 = max(step0, abs(-viewPos(uv + vec2(0.0, tx.y), dU).z - z0));
          step0 = max(step0, abs(-viewPos(uv - vec2(0.0, tx.y), dD).z - z0));
          float depthEdge = smoothstep(thr, thr * 2.2, step0);

          vec3 N = normalAt(uv, d0);
          float nd = 0.0;
          if (dR < 0.99999) nd += 1.0 - dot(N, normalAt(uv + vec2(tx.x, 0.0), dR));
          if (dU < 0.99999) nd += 1.0 - dot(N, normalAt(uv + vec2(0.0, tx.y), dU));
          float normalEdge = smoothstep(0.10, 0.55, nd);

          float edge = clamp(max(depthEdge, normalEdge) * uInk, 0.0, 1.0);

          float dith = (hash(uv * 977.0) - 0.5) * (0.85 / uLevels);
          float lq = clamp(floor(l * uLevels + 0.5 + dith) / uLevels, 0.0, 1.0);
          c *= mix(1.0, lq / max(l, 0.0015), uFlat * uToon);
          c = mix(c, uInkColor, edge * uToon);
        }
      }

      float vig = smoothstep(1.18, 0.28, length(d) * 1.42);
      c *= mix(1.0, vig, uVig);

      float g = hash(uv * vec2(1927.0, 1087.0) + fract(uTime) * 91.7);
      c += (g - 0.5) * uGrain * mix(1.35, 0.35, smoothstep(0.0, 0.8, l));

      gl_FragColor = vec4(c, 1.0);
    }
  `,
};
