import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * 胶片后处理参数（参考 shader.se 扒出的源码）
 *
 * 字段说明：
 *  - bloomIntensity            Bloom 辉光强度（0~2）
 *  - bloomThreshold            Bloom 亮度阈值（0~1）
 *  - bloomRadius               Bloom 模糊半径（0~2）
 *  - bloomSmoothing            Bloom 平滑度（0~1）
 *  - pow                       伽马校正指数（0~5），>1 提亮、<1 压暗
 *  - sepiaIntensity            棕褐色调强度（0~1），老胶片色
 *  - brightness                亮度（0~2）
 *  - contrast                  对比度（0~2）
 *  - chromaticAbberationStrength RGB 色差强度（0~5），垂直方向偏移
 *  - lensDistortion            镜头畸变（0~1），桶形畸变
 *  - lensDistortionBorder      镜头边缘畸变（0~1）
 *  - motionBlur                动态模糊强度（0~1）
 *  - vignetteIntensity         暗角强度（0~1）
 *  - vignetteRadius            暗角半径（0~1）
 *  - vignetteSmoothness        暗角平滑度（0~1）
 *  - noiseIntensity            胶片颗粒强度（0~2）
 *  - noiseVelocity             颗粒动画速度（0~5）
 */
export interface FilmFXParams {
  bloomIntensity: number;
  bloomThreshold: number;
  bloomRadius: number;
  bloomSmoothing: number;
  pow: number;
  sepiaIntensity: number;
  brightness: number;
  contrast: number;
  chromaticAbberationStrength: number;
  lensDistortion: number;
  lensDistortionBorder: number;
  motionBlur: number;
  vignetteIntensity: number;
  vignetteRadius: number;
  vignetteSmoothness: number;
  noiseIntensity: number;
  noiseVelocity: number;
  /** 体积雾密度（0~1.5，越大雾越浓） */
  fogDensity: number;
  /** 体积雾最大不透明度（0~1，0 = 完全关闭雾效果） */
  fogOpacity: number;
}

/**
 * 默认胶片参数（参考 shader.se 的 loadingScreen 配置反推）
 *
 * 功能：提供一组观感接近 shader.se 的默认值
 * 注意事项：
 *  - bloomThreshold 0.85：只让屏幕中心最亮区参与辉光，避免屏幕大面积过亮 →
 *    鼠标视差时 bloom 区域随屏幕投影面积波动而剧烈闪烁
 *  - bloomIntensity 0.8：辉光强度适中，配合 threshold 0.85 只在屏幕高光区扩散
 *  - noiseIntensity 0.2：颗粒压低，避免每帧 noise 叠加在画面波动上加重闪烁感
 */
export const DEFAULT_FILM_PARAMS: FilmFXParams = {
  bloomIntensity: 0.5,
  bloomThreshold: 0.9,
  bloomRadius: 0.3,
  bloomSmoothing: 0.6,
  pow: 1.0,
  sepiaIntensity: 0.25,
  brightness: 1.0,
  contrast: 1.1,
  chromaticAbberationStrength: 0.5,
  lensDistortion: 0.15,
  lensDistortionBorder: 0.0,
  motionBlur: 0.0,
  vignetteIntensity: 0.45,
  vignetteRadius: 0.5,
  vignetteSmoothness: 0.3,
  noiseIntensity: 0.2,
  noiseVelocity: 1.0,
  // 雾浓度按主体距离校准：胶片平面距初始相机约 7 个单位，
  // 密度过高会把深色片基/齿孔整个盖没（0.55 时胶片上约 69% 雾、
  // 边缘消失）；0.22 + 0.45 时约 29% 薄雾，主体可读
  fogDensity: 0.22,
  fogOpacity: 0.45,
};

/* =========================================================================
 * VolumetricFogShader - 体积雾 pass（深度重建 + 噪声光线步进）
 *
 * 功能：模拟胶片走廊里漂浮的雾气，随镜头运动产生真实体积感：
 *  1. 从 depthTexture 重建像素视线（屏幕 UV → NDC → 逆投影 → 视线段）
 *  2. 沿视线步进 12 步（固定上限，运行时 uSteps 可降级到 8），
 *     采样世界坐标 hash 噪声（2 octave fbm）作为雾密度
 *  3. 密度沿视线累积 → 指数透过率 → 与暖褐雾色混合
 *  4. 方向光散射近似（phase）：朝光源方向的雾更亮 → 再被后续
 *     BloomPass 染上光晕，形成"光柱穿过雾气"的胶片质感
 *
 * 注意事项：
 *  - 噪声采样在世界坐标系：雾"长在原地"，镜头平移/拉远时产生正确视差
 *  - 天空/背景（depth=1）也参与雾：视线长度封顶 uMaxDist，避免背景糊死
 *  - 插在链尾直绘屏幕（Film 调色之后）：链中 pass 的绘制目标是带深度附件的
 *    RT，采样深度纹理会构成 WebGL 反馈环（draw 被拒绝 → 全屏黑），链尾
 *    直绘屏幕则没有深度附件，结构上安全（钢琴页 grade 同款架构）
 *  - 步长越长密度按比例缩减，总雾量近似与步数无关（降级不跳变）
 *  - prefers-reduced-motion 时漂移速度置 0（雾静止）
 * ========================================================================= */
const FOG_DRIFT_SPEED = 0.05;
const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const VolumetricFogShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uProjInv: { value: new THREE.Matrix4() },
    uViewInv: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    // 暖黑褐：贴合 sepia 调色的暗部基调
    uFogColor: { value: new THREE.Color(0.11, 0.085, 0.06) },
    uDensity: { value: 0.22 },
    // 噪声频率：0.75 → 特征约 1.3 世界单位宽，胶片距相机 ~7 单位时
    // 屏幕上能容纳 4~5 个浓团（0.55 时只有 2~3 个、且被低对比抹平，看不出纹理）
    uNoiseScale: { value: 0.75 },
    uDrift: { value: REDUCED_MOTION ? 0 : FOG_DRIFT_SPEED },
    uMaxDist: { value: 26.0 },
    uMaxOpacity: { value: 0.45 },
    uLightDir: { value: new THREE.Vector3(-0.45, 0.7, 0.35).normalize() },
    uSteps: { value: 12 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform mat4 uProjInv;
    uniform mat4 uViewInv;
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uDensity;
    uniform float uNoiseScale;
    uniform float uDrift;
    uniform float uMaxDist;
    uniform float uMaxOpacity;
    uniform vec3 uLightDir;
    uniform float uSteps;
    varying vec2 vUv;

    // 3D hash 噪声（整点格 + 三线性插值），无纹理依赖
    float hash13(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }
    float vnoise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash13(i);
      float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
      float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
      float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
      float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
      float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
      float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
      float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
      return mix(
        mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
        mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
        f.z
      );
    }
    // 2 octave fbm：细节够用，也是性能降级的第一档
    float fbm(vec3 p) {
      return vnoise(p) * 0.65 + vnoise(p * 2.13) * 0.35;
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).x;

      // 屏幕 UV → NDC → 逆投影：视线段两端（视空间，相机在原点看 -Z）
      vec4 cn = uProjInv * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
      vec3 vNear = cn.xyz / cn.w;
      vec4 cf = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec3 vFar = cf.xyz / cf.w;
      vec3 dirView = normalize(vFar - vNear);

      // 世界坐标方向/起点：噪声锚定在世界里，镜头移动才有正确视差
      vec3 camWorld = (uViewInv * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 dirWorld = normalize((uViewInv * vec4(dirView, 0.0)).xyz);

      // 天空/背景（depth=1）视线长度封顶，避免远背景被雾完全糊死
      float dist = (depth >= 0.9999) ? uMaxDist : length(vFar);

      float stepLen = dist / uSteps;
      // 步长越长密度按比例缩减：总雾量近似与步数无关（步数降级不跳变）
      float densityScale = max(0.05, stepLen) * uDensity;
      // 前向散射近似：朝光源方向看的雾更亮
      float phase = 0.55 + 0.45 * max(0.0, dot(dirWorld, -uLightDir));

      float acc = 0.0;
      float wsum = 0.0; // 权重和（近距窗口），用于求平均密度给雾"上色"
      for (int i = 0; i < 12; i++) {
        if (float(i) >= uSteps) break;
        float t = (float(i) + 0.5) * stepLen;
        vec3 wp = camWorld + dirWorld * t;
        // 慢速漂移（各轴异速，避免整体平移感）
        vec3 np = wp * uNoiseScale + vec3(uTime * uDrift, uTime * uDrift * 0.35, -uTime * uDrift * 0.6);
        // 近距窗口：镜头跟前留 0.6~2.2 的清晰区，中距最浓
        float w = smoothstep(0.6, 2.2, t);
        // 对比度整形：值噪声 fbm 输出平缓（集中在 0.5 附近），直接累积出的雾
        // 是一层均匀灰幕；smoothstep 抬高对比后才有"浓团与间隙"的絮状结构
        float n = smoothstep(0.32, 0.82, fbm(np));
        acc += n * w;
        wsum += w;
      }
      float fog = 1.0 - exp(-acc * densityScale * 2.2);
      fog = clamp(fog, 0.0, 1.0) * uMaxOpacity;

      // 雾亮度跟随局部密度：浓处亮、稀处暗 —— 颜色本身携带密度信息，
      // 絮状纹理才真正可见（若 fogLit 是常量色，只剩混合比例在变，
      // 指数累积又会把比例差异抹平，观感即"没有纹理"）
      float nAvg = wsum > 0.001 ? acc / wsum : 0.0;
      vec3 fogLit = uFogColor * (0.55 + 0.85 * phase) * (0.4 + 1.15 * nAvg);
      gl_FragColor = vec4(mix(base.rgb, fogLit, fog), base.a);
    }
  `,
};

/**
 * 完整胶片后处理 Shader（GLSL，翻译自 shader.se TSL 源码）
 *
 * 实现（按渲染顺序）：
 *  1. 桶形畸变 + 边缘缩放（参考 DH + DV 函数）
 *     - DH: scale = 1 + r² × (k + kVec × sqrt(r))
 *     - DV: 含 border 边缘系数，基础系数 0.3655
 *  2. 垂直方向 RGB 色差（参考 ChromaticAberrationNode2）
 *     - 仅在 Y 轴偏移，强度 = 0.001 × r × 2 × strength
 *     - 边缘渐隐防溢出
 *  3. 调色：pow 伽马 + sepia 棕褐 + brightness + contrast
 *  4. 动态胶片颗粒（参考 filmGrainFn）
 *     - hash 噪声：fract(sin(dot(uv, vec2(12.9898, 78.233))) × 43758.5453 + time × velocity)
 *     - 仅在暗部增亮（颗粒"闪光"特性）
 *  5. 径向暗角（smoothstep 平滑过渡）
 *
 * 参数（uniforms）：
 *  - tDiffuse              输入纹理
 *  - uLensDistortion       镜头畸变强度
 *  - uLensDistortionBorder 边缘畸变系数
 *  - uChromaticAberration  色差强度
 *  - uAspect               宽高比
 *  - uPow                  伽马指数
 *  - uSepiaIntensity       棕褐强度
 *  - uBrightness           亮度
 *  - uContrast             对比度
 *  - uNoiseIntensity       颗粒强度
 *  - uNoiseVelocity        颗粒速度
 *  - uTime                 时间（秒）
 *  - uVignetteIntensity    暗角强度
 *  - uVignetteRadius       暗角半径
 *  - uVignetteSmoothness   暗角平滑度
 *
 * 返回值：vec4 后处理后的像素颜色
 *
 * 注意事项：
 *  - 所有效果在一个 fragment shader 内完成，性能优于多 pass 串联
 *  - 桶形畸变 + 色差共用同一套畸变 UV，视觉自然
 *  - 颗粒用 hash 噪声而非纹理采样，省一次 texture lookup
 */
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uLensDistortion: { value: 0.15 },
    uLensDistortionBorder: { value: 0.0 },
    uChromaticAberration: { value: 0.8 },
    uAspect: { value: 1.0 },
    uPow: { value: 1.0 },
    uSepiaIntensity: { value: 0.25 },
    uBrightness: { value: 1.0 },
    uContrast: { value: 1.1 },
    uNoiseIntensity: { value: 0.5 },
    uNoiseVelocity: { value: 1.0 },
    uTime: { value: 0.0 },
    uVignetteIntensity: { value: 0.45 },
    uVignetteRadius: { value: 0.5 },
    uVignetteSmoothness: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uLensDistortion;
    uniform float uLensDistortionBorder;
    uniform float uChromaticAberration;
    uniform float uAspect;
    uniform float uPow;
    uniform float uSepiaIntensity;
    uniform float uBrightness;
    uniform float uContrast;
    uniform float uNoiseIntensity;
    uniform float uNoiseVelocity;
    uniform float uTime;
    uniform float uVignetteIntensity;
    uniform float uVignetteRadius;
    uniform float uVignetteSmoothness;
    varying vec2 vUv;

    /**
     * 桶形畸变 + 边缘缩放（参考 shader.se 的 DH + DV 函数）
     *
     * 公式：
     *  - n = mix(0.3655, 0.0, border)   // border 越大主畸变越弱
     *  - scale = 1 - distortion × n     // 整体缩放避免溢出
     *  - offset = distortion × n × 0.5  // UV 平移
     *  - r² = (uv-0.5)²                  // 到中心距离平方
     *  - k = 1 + r² × distortion         // 径向畸变系数
     *  - distorted = scale × (i × k + 0.5) + offset
     *
     * 参数：
     *  - uv         原始 UV [0,1]
     *  - distortion 畸变强度
     *  - border     边缘系数
     *
     * 返回值：畸变后的 UV
     */
    vec2 barrelDistort(vec2 uv, float distortion, float border) {
      float n = mix(0.3655, 0.0, border);
      float scale = 1.0 - distortion * n;
      float offset = distortion * n * 0.5;

      vec2 i = uv - 0.5;
      float r2 = dot(i, i);
      float k = 1.0 + r2 * distortion;

      return scale * (vec2(i.x * k, i.y * k) + 0.5) + offset;
    }

    /**
     * 圆角矩形 SDF（参考 shader.se 的 Dz 函数）
     *
     * 功能：计算点到圆角矩形边界的带符号距离
     *  - < 0 在内部；> 0 在外部
     *
     * 参数：
     *  - p       点位置（归一化到 -0.5~0.5）
     *  - aspect  宽高比，校正 X 方向
     *  - corner  圆角半径
     */
    float roundedBoxSDF(vec2 p, float aspect, float corner) {
      vec2 q = abs(p * vec2(aspect, 1.0)) - vec2(0.5 * aspect - corner, 0.5 - corner);
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
    }

    void main() {
      vec2 uv = vUv;

      // === 1. 桶形畸变 ===
      vec2 distortedUV = barrelDistort(uv, uLensDistortion, uLensDistortionBorder);

      // UV 越界 → 透明（避免采样到画面外杂讯）
      // 注意：必须输出 alpha=0，否则透明背景会变成不透明黑色，遮挡下层 Canvas
      if (distortedUV.x < 0.0 || distortedUV.x > 1.0 ||
          distortedUV.y < 0.0 || distortedUV.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
      }

      // === 2. 垂直方向 RGB 色差 ===
      // dist = 到中心距离（aspect 校正）
      // offset = 0.001 × dist × 2 × strength（参考 Dq class 的 n 计算）
      vec2 aspectCorrect = vec2(uAspect, 1.0) / max(uAspect, 1.0);
      float dist = length((uv - 0.5) * aspectCorrect * 2.0);
      float caOffset = 0.001 * dist * 2.0 * uChromaticAberration;

      // 边缘渐隐（参考 Dq class 的 ex × ey）
      float edge = 0.005;
      float ex = smoothstep(0.0, edge, uv.x) * smoothstep(0.0, edge, 1.0 - uv.x);
      float ey = smoothstep(0.0, edge, uv.y) * smoothstep(0.0, edge, 1.0 - uv.y);
      float edgeMask = ex * ey;

      float r = texture2D(tDiffuse, distortedUV + vec2(0.0, -caOffset)).r;
      float g = texture2D(tDiffuse, distortedUV).g;
      float b = texture2D(tDiffuse, distortedUV + vec2(0.0, caOffset)).b;
      // 保留输入纹理的 alpha，让透明背景保持透明（用于叠加在纸张 Canvas 上层）
      float inputAlpha = texture2D(tDiffuse, distortedUV).a;
      vec4 shiftedColor = vec4(r, g, b, inputAlpha);
      vec4 originalColor = texture2D(tDiffuse, distortedUV);
      vec4 color = mix(originalColor, shiftedColor, edgeMask);

      // 透明背景保护：如果输入 alpha 接近 0，说明该像素是透明背景
      // （shader 输出的透明区域），直接输出透明，跳过所有后续效果
      // （bloom/motionblur 已把 alpha 污染为 1），保证下层 Canvas 可见
      if (inputAlpha < 0.01) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
      }

      // === 3. 调色 ===
      // 3a. pow 伽马
      color.rgb = pow(color.rgb, vec3(uPow));

      // 3b. sepia 棕褐（标准电影 sepia 矩阵）
      float sr = dot(color.rgb, vec3(0.393, 0.769, 0.189));
      float sg = dot(color.rgb, vec3(0.349, 0.686, 0.168));
      float sb = dot(color.rgb, vec3(0.272, 0.534, 0.131));
      vec3 sepiaColor = vec3(sr, sg, sb);
      color.rgb = mix(color.rgb, sepiaColor, uSepiaIntensity);

      // 3c. brightness
      color.rgb = color.rgb * uBrightness;

      // 3d. contrast（中心 0.5 调整）
      color.rgb = (color.rgb - 0.5) * uContrast + 0.5;
      color.rgb = clamp(color.rgb, 0.0, 1.0);

      // === 4. 动态胶片颗粒 ===
      // hash 噪声：fract(sin(dot(uv, vec2(12.9898, 78.233))) × 43758.5453 + time × velocity)
      // 参考 shader.se filmGrainFn，仅在暗部增亮（颗粒"闪光"特性）
      float seed = uTime * uNoiseVelocity;
      float noiseHash = fract(
        sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453 + seed
      );
      // 归一化到 [0, 0.7² × 0.7] ≈ [0, 0.34]
      float grain = abs(noiseHash - 0.0) * (0.7 * 0.7);
      // 仅在暗部增亮：grain × (1 - color.rgb)
      vec3 grainColor = grain * (1.0 - color.rgb);
      color.rgb = color.rgb + grainColor * uNoiseIntensity;

      // === 5. 径向暗角 ===
      // 参考 shader.se：dist = vignetteRadius - length(uv - 0.5)
      //               mask = smoothstep(-smoothness, smoothness, dist)
      //               color = mix(color, color × mask, intensity)
      float vDist = uVignetteRadius - length(uv - 0.5);
      float vMask = smoothstep(-uVignetteSmoothness, uVignetteSmoothness, vDist);
      vec3 vignetted = clamp(color.rgb * vMask, 0.0, 1.0);
      color.rgb = mix(color.rgb, vignetted, uVignetteIntensity);

      gl_FragColor = color;
    }
  `,
};

/**
 * Motion Blur Shader（参考 shader.se 的 DZ class，简化版）
 *
 * 实现：当前帧与上一帧按 strength 混合
 *  - strength=0: 完全显示当前帧
 *  - strength=1: 完全显示上一帧（最大拖影）
 *
 * 参数：
 *  - tDiffuse      当前帧
 *  - tPrevious     上一帧
 *  - uStrength     混合强度 [0, 1]
 *
 * 注意事项：
 *  - 用 ping-pong RT 实现：每帧渲染时读取上一帧 RT，写入另一张 RT
 *  - 帧率独立：strength 已在外部按 deltaTime 调整
 */
const MotionBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tPrevious: { value: null as THREE.Texture | null },
    uStrength: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tPrevious;
    uniform float uStrength;
    varying vec2 vUv;

    void main() {
      vec4 current = texture2D(tDiffuse, vUv);
      vec4 previous = texture2D(tPrevious, vUv);
      gl_FragColor = mix(current, previous, uStrength);
    }
  `,
};

interface FilmPostProcessingProps {
  /** 后处理参数（外部传入，实时更新） */
  params: FilmFXParams;
  /** 是否启用后处理 */
  enabled?: boolean;
  /**
   * 透明模式：用于叠加在另一个 Canvas 上层的场景
   * - 跳过 UnrealBloomPass 和 MotionBlurPass（它们会污染 alpha 通道）
   * - 只保留镜头畸变 + 色散 + 暗角 + 颗粒
   * - 透明背景保持透明，露出下层 Canvas
   */
  transparent?: boolean;
}

/**
 * 完整胶片后处理组件
 *
 * 功能：
 *  - 在 R3F Canvas 内创建 EffectComposer
 *  - 顺序：RenderPass → UnrealBloomPass → MotionBlurPass → FilmShaderPass
 *  - useFrame 中按 shader.se 算法动态调整 bloom 强度（4 sin 波叠加）
 *  - useFrame 中按 deltaTime 帧率独立调整 motion blur 强度
 *
 * 参数：
 *  - params:  FilmFXParams，运行时可调的后处理参数
 *  - enabled: boolean，是否启用（默认 true）
 *
 * 返回值：null（纯逻辑组件）
 *
 * 异常：EffectComposer 创建失败时回退到 R3F 默认渲染
 *
 * 注意事项：
 *  - 必须放在 Canvas 内部
 *  - useFrame renderPriority=1 接管 R3F 默认渲染
 *  - Bloom 动态闪烁：1.5 × base + 0.03 × base × (4 sin 波) + bloomBoost
 *  - MotionBlur 帧率独立：以 120fps 为基准，dt 大于基准时减弱，小于时增强
 */
export function FilmPostProcessing({ params, enabled = true, transparent = false }: FilmPostProcessingProps) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const filmPassRef = useRef<ShaderPass | null>(null);
  const motionPassRef = useRef<ShaderPass | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);
  // 体积雾 pass + 共享深度纹理（RenderPass 写入，雾 pass 读取）
  const fogPassRef = useRef<ShaderPass | null>(null);
  const depthTexRef = useRef<THREE.DepthTexture | null>(null);

  // ping-pong RT 用于 MotionBlur：保存上一帧
  const prevRTRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const currRTRef = useRef<THREE.WebGLRenderTarget | null>(null);

  // 上一帧时间戳，用于计算 deltaTime
  const prevTimeRef = useRef(0);

  // 创建 EffectComposer + 各 Pass
  useMemo(() => {
    // eslint-disable-next-line no-console
    console.log('[FilmPostProcessing] useMemo executing, transparent=', transparent, 'hasGl=', !!gl, 'hasScene=', !!scene, 'hasCamera=', !!camera);
    try {
    // ping-pong RT（HalfFloatType 保证 HDR 精度）
    const rtOptions = {
      depthBuffer: false,
      type: THREE.HalfFloatType,
    };
    prevRTRef.current = new THREE.WebGLRenderTarget(
      gl.domElement.width || 1,
      gl.domElement.height || 1,
      rtOptions
    );
    currRTRef.current = new THREE.WebGLRenderTarget(
      gl.domElement.width || 1,
      gl.domElement.height || 1,
      rtOptions
    );

    // 带 depthTexture 的 HDR RT：体积雾需要读场景深度做视线步进
    // （EffectComposer 内部 clone 出 ping-pong 双缓冲，共享同一个 depthTexture，
    //   RenderPass 每帧渲染时深度写入该纹理）
    const depthTexture = new THREE.DepthTexture(
      gl.domElement.width || 1,
      gl.domElement.height || 1
    );
    depthTexture.type = THREE.UnsignedIntType;
    const composerRT = new THREE.WebGLRenderTarget(
      gl.domElement.width || 1,
      gl.domElement.height || 1,
      { depthBuffer: true, depthTexture, type: THREE.HalfFloatType }
    );
    depthTexRef.current = depthTexture;

    const c = new EffectComposer(gl, composerRT);
    // 注意：renderTarget2（clone）保留其克隆深度纹理即可，不要与 rt1 显式共享
    // 同一张纹理对象（否则雾 pass 采样它、又画进挂着它的 rt2，构成 WebGL
    // 反馈环，Chrome 拒绝整个 draw → 后处理链断掉 → 全屏黑）。
    // clone 出的深度与 rt1 的共享同一 .source（同一块 GPU 纹理），因此无论
    // RenderPass 因 ping-pong 写进 rt1 还是 rt2，场景深度总落在同一块纹理里，
    // 雾 pass 读 rt1 的 depthTexture 永远是本帧深度。
    c.addPass(new RenderPass(scene, camera));

    // Bloom 和 MotionBlur 会污染 alpha 通道（假设不透明场景），
    // 透明模式（叠加 Canvas）下跳过它们，只保留镜头畸变 + 色散 + 暗角 + 颗粒
    if (!transparent) {
      // Bloom（参考 shader.se 的胶片过曝感）
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(gl.domElement.width || 1, gl.domElement.height || 1),
        params.bloomIntensity,
        params.bloomRadius,
        params.bloomThreshold
      );
      c.addPass(bloom);
      bloomRef.current = bloom;

      // MotionBlur（ping-pong）
      const motionPass = new ShaderPass(MotionBlurShader);
      motionPass.material.depthTest = false;
      motionPass.material.depthWrite = false;
      motionPass.uniforms.tPrevious.value = prevRTRef.current.texture;
      motionPass.uniforms.uStrength.value = params.motionBlur;
      c.addPass(motionPass);
      motionPassRef.current = motionPass;
    }

    // Film shader：畸变 + 色差 + 调色 + 颗粒 + 暗角（画进 RT；链尾雾才是直绘屏幕的 pass）
    const filmPass = new ShaderPass(FilmShader);
    filmPass.material.depthTest = false;
    filmPass.material.depthWrite = false;
    c.addPass(filmPass);
    filmPassRef.current = filmPass;

    // 体积雾：链尾直绘屏幕（钢琴页 PianoPostProcessing 的 grade 同款架构）。
    // 雾 pass 需要采样场景深度纹理，而链中 pass 的绘制目标是带深度附件的 RT ——
    // 采样与附件同体即触发 WebGL 反馈环（Chrome 直接拒绝该 draw，后处理链
    // 从此断掉 → 全屏黑）。放在链尾直绘屏幕后，绘制目标是默认 framebuffer，
    // 没有深度附件，结构上不可能构成反馈环。
    // 雾在 Film 调色之后：雾气会被暗角/颗粒一并处理，视觉一致。
    if (!transparent) {
      const fogPass = new ShaderPass(VolumetricFogShader);
      fogPass.material.depthTest = false;
      fogPass.material.depthWrite = false;
      // 深度纹理用 rt1 那张：renderTarget2 的克隆深度与其共享 .source
      // （同一块 GPU 纹理），RenderPass 无论因 ping-pong 写进 rt1 还是 rt2，
      // 场景深度总落在同一块纹理上，这里读到的永远是本帧深度
      fogPass.uniforms.tDepth.value = c.renderTarget1.depthTexture;
      c.addPass(fogPass);
      fogPassRef.current = fogPass;
    }

    composerRef.current = c;
    // eslint-disable-next-line no-console
    console.log('[FilmPostProcessing] EffectComposer created successfully, transparent=', transparent);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[FilmPostProcessing] useMemo ERROR:', err);
    }
  }, [gl, scene, camera, transparent]);

  // 同步 size 变化
  useEffect(() => {
    // depthTexture 显式跟随（逻辑尺寸 × 像素比），dispose 强制按新尺寸重新分配
    if (depthTexRef.current) {
      const pr = gl.getPixelRatio();
      depthTexRef.current.image.width = Math.max(1, Math.floor(size.width * pr));
      depthTexRef.current.image.height = Math.max(1, Math.floor(size.height * pr));
      depthTexRef.current.dispose();
    }
    // rt2 克隆出的深度纹理同步尺寸：构造时取的是 canvas 初始尺寸（常 300×150），
    // 不手动改 image 会导致 RenderPass 写 rt2 时颜色/深度附件尺寸不匹配
    const rt2Depth = composerRef.current?.renderTarget2?.depthTexture;
    if (rt2Depth && rt2Depth !== depthTexRef.current) {
      const pr = gl.getPixelRatio();
      rt2Depth.image.width = Math.max(1, Math.floor(size.width * pr));
      rt2Depth.image.height = Math.max(1, Math.floor(size.height * pr));
      rt2Depth.dispose();
    }
    if (composerRef.current) {
      composerRef.current.setSize(size.width, size.height);
      composerRef.current.setPixelRatio(gl.getPixelRatio());
    }
    if (prevRTRef.current) {
      prevRTRef.current.setSize(size.width, size.height);
    }
    if (currRTRef.current) {
      currRTRef.current.setSize(size.width, size.height);
    }
    if (filmPassRef.current) {
      (filmPassRef.current.uniforms.uAspect.value as number) = size.width / size.height;
    }
  }, [size, gl]);

  // 同步 params 到 uniforms
  useEffect(() => {
    if (!filmPassRef.current) return;
    const u = filmPassRef.current.uniforms;
    u.uLensDistortion.value = params.lensDistortion;
    u.uLensDistortionBorder.value = params.lensDistortionBorder;
    u.uChromaticAberration.value = params.chromaticAbberationStrength;
    u.uPow.value = params.pow;
    u.uSepiaIntensity.value = params.sepiaIntensity;
    u.uBrightness.value = params.brightness;
    u.uContrast.value = params.contrast;
    u.uNoiseIntensity.value = params.noiseIntensity;
    u.uNoiseVelocity.value = params.noiseVelocity;
    u.uVignetteIntensity.value = params.vignetteIntensity;
    u.uVignetteRadius.value = params.vignetteRadius;
    u.uVignetteSmoothness.value = params.vignetteSmoothness;

    if (bloomRef.current) {
      bloomRef.current.strength = params.bloomIntensity;
      bloomRef.current.radius = params.bloomRadius;
      bloomRef.current.threshold = params.bloomThreshold;
    }

    if (fogPassRef.current) {
      fogPassRef.current.uniforms.uDensity.value = params.fogDensity;
      fogPassRef.current.uniforms.uMaxOpacity.value = params.fogOpacity;
    }
  }, [params]);

  // 卸载时释放资源
  useEffect(() => {
    return () => {
      composerRef.current?.dispose();
      prevRTRef.current?.dispose();
      currRTRef.current?.dispose();
      composerRef.current = null;
      filmPassRef.current = null;
      motionPassRef.current = null;
      bloomRef.current = null;
      fogPassRef.current = null;
      depthTexRef.current = null;
    };
  }, []);

  // 每帧渲染
  useFrame((state, delta) => {
    if (!enabled || !composerRef.current) {
      // eslint-disable-next-line no-console
      console.log('[FilmPostProcessing] SKIP render: enabled=', enabled, 'hasComposer=', !!composerRef.current);
      return;
    }

    const time = state.clock.elapsedTime;

    // === Bloom 动态闪烁（参考 shader.se 的 4 sin 波叠加算法）===
    // flicker = (sin(5.3×t×0.5) + sin(11.7×t×0.5) + sin(2.1×t×0.5) + sin(23.9×t×0.5)) × 0.012 × base
    // 实际强度 = 1.4 × base + flicker
    // 4 个非谐波频率叠加，避免周期性可见，模拟胶片放映机灯光的有机闪烁
    // 幅度从 0.03 降到 0.012，避免滚动时画面变化叠加闪烁造成"一动就闪"感
    if (bloomRef.current) {
      const base = params.bloomIntensity;
      const flicker =
        (Math.sin(5.3 * time * 0.5) +
          Math.sin(11.7 * time * 0.5 + 2.4 * Math.sin(time)) +
          Math.sin(2.1 * time * 0.5) +
          Math.sin(23.9 * time * 0.5 + 1.3 * Math.cos(7.1 * time * 0.5))) *
        0.012 * base;
      bloomRef.current.strength = 1.4 * base + flicker;
    }

    // === MotionBlur 帧率独立（参考 shader.se 的 DZ class 算法）===
    // 以 120fps (1/120 ≈ 0.00833s) 为基准
    // dt > 基准：帧率低 → blur 减弱（避免拖影过重）
    // dt < 基准：帧率高 → blur 增强
    if (motionPassRef.current && params.motionBlur > 0) {
      const targetDt = 1 / 120;
      let adjusted: number;
      if (delta > targetDt) {
        adjusted = params.motionBlur * (targetDt / delta);
      } else {
        adjusted = Math.pow(params.motionBlur, delta / targetDt);
      }
      motionPassRef.current.uniforms.uStrength.value = 1.3 * adjusted;
    } else if (motionPassRef.current) {
      motionPassRef.current.uniforms.uStrength.value = 0;
    }

    // 更新 Film shader 时间
    if (filmPassRef.current) {
      filmPassRef.current.uniforms.uTime.value = time;
    }

    // 体积雾：时间 + 相机矩阵（视线重建；雾锚定世界坐标随镜头产生视差）
    // tDepth 在创建时一次性绑定 rt1 的深度纹理即可（见创建处注释：
    // rt1/rt2 的克隆深度共享同一块 GPU 纹理，读哪张都是本帧场景深度）
    if (fogPassRef.current) {
      const u = fogPassRef.current.uniforms;
      u.uTime.value = time;
      (u.uProjInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
      (u.uViewInv.value as THREE.Matrix4).copy(camera.matrixWorld);
    }

    // 渲染
    composerRef.current.render();

    // === DEBUG: 在 composer.render() 后立即 readPixels 检查渲染结果 ===
    // 只在 transparent 模式下检查（粉碎机 Canvas）
    if (transparent) {
      const dbgFrame = (state as any).clock.elapsedTime;
      if (Math.floor(dbgFrame * 2) % 2 === 0) {
        const px = new Uint8Array(4);
        gl.readPixels(Math.floor(gl.domElement.width / 2), Math.floor(gl.domElement.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // eslint-disable-next-line no-console
        console.log('[FilmPostProcessing] post-render center pixel:', px[0], px[1], px[2], px[3]);
      }
    }

    // ping-pong：把当前渲染结果拷贝到 prevRT，下一帧用作 tPrevious
    // 注意：composer.render() 后 gl 的当前 RT 已是屏幕，需要 blit 到 prevRT
    if (prevRTRef.current && motionPassRef.current) {
      const prevTexture = motionPassRef.current.uniforms.tPrevious.value;
      // 交换：下一帧读取的就是这一帧刚渲染的
      motionPassRef.current.uniforms.tPrevious.value = motionPassRef.current.readBuffer?.texture || prevTexture;
    }
  }, 1);

  return null;
}
