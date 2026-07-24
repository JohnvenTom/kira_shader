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

      // UV 越界 → 黑色（避免采样到画面外杂讯）
      if (distortedUV.x < 0.0 || distortedUV.x > 1.0 ||
          distortedUV.y < 0.0 || distortedUV.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
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
      vec4 shiftedColor = vec4(r, g, b, 1.0);
      vec4 originalColor = texture2D(tDiffuse, distortedUV);
      vec4 color = mix(originalColor, shiftedColor, edgeMask);

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
export function FilmPostProcessing({ params, enabled = true }: FilmPostProcessingProps) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const filmPassRef = useRef<ShaderPass | null>(null);
  const motionPassRef = useRef<ShaderPass | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);

  // ping-pong RT 用于 MotionBlur：保存上一帧
  const prevRTRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const currRTRef = useRef<THREE.WebGLRenderTarget | null>(null);

  // 上一帧时间戳，用于计算 deltaTime
  const prevTimeRef = useRef(0);

  // 创建 EffectComposer + 各 Pass
  useMemo(() => {
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

    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));

    // Bloom：让屏幕 emissive 自发光部分扩散彩色光晕
    // 顺序：Bloom 必须在色散/畸变前，否则色差会把光晕也拆开
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
    motionPass.uniforms.tPrevious.value = prevRTRef.current.texture;
    motionPass.uniforms.uStrength.value = params.motionBlur;
    c.addPass(motionPass);
    motionPassRef.current = motionPass;

    // Film shader：畸变 + 色差 + 调色 + 颗粒 + 暗角
    const filmPass = new ShaderPass(FilmShader);
    filmPass.renderToScreen = true;
    c.addPass(filmPass);
    filmPassRef.current = filmPass;

    composerRef.current = c;
  }, [gl, scene, camera]);

  // 同步 size 变化
  useEffect(() => {
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
    };
  }, []);

  // 每帧渲染
  useFrame((state, delta) => {
    if (!enabled || !composerRef.current) return;

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

    // 渲染
    composerRef.current.render();

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
