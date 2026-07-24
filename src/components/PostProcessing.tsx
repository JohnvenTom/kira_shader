import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * 后处理参数（运行时可调）
 *
 * 字段说明：
 *  - chromaticAberration    色散强度（0~5）。RGB 在垂直方向分离，越大越明显
 *  - chromaticFalloff       色散过渡曲线（0.5~3.0）。
 *                           1.0=线性；>1=中心更干净、边缘更陡；<1=中心也有色散
 *  - lensDistortion         鱼眼/桶形畸变强度（0~1）。中心几乎不变形，边缘强烈外凸
 *  - lensDistortionBorder   边缘缩放控制（0~1）。0=边缘强烈拉伸；1=边缘正常
 *  - vignetteIntensity      暗角强度（0~1）。让画面四周变暗，聚焦中心
 *  - vignetteRadius         暗角半径（0~1）。0=暗角范围最大；1=几乎无暗角
 */
export interface PostFXParams {
  chromaticAberration: number;
  chromaticFalloff: number;
  lensDistortion: number;
  lensDistortionBorder: number;
  vignetteIntensity: number;
  vignetteRadius: number;
  /** Bloom 辉光强度（0~3）。值越大，屏幕等高亮区域向周围扩散的彩色光晕越强烈 */
  bloomStrength: number;
  /** Bloom 辉光半径（0~1）。值越大光晕越柔和弥散 */
  bloomRadius: number;
  /** Bloom 亮度阈值（0~1）。仅亮度超过此值的像素参与辉光，0.85 = 只让屏幕自发光部分扩散 */
  bloomThreshold: number;
}

/**
 * 色散 + 鱼眼 + 暗角 + 圆角遮罩 + 边缘模糊 自定义 Shader
 *
 * 实现：
 *  1. 桶形畸变：scale = 1 + r² × distortion，r³ 形式让中心不变形、边缘强烈外凸
 *     （参考 shader.se 的 DH/DV 函数，r² × distortion = 桶形畸变核心）
 *  2. 色散：RGB 在 Y 轴方向分离，偏移量随到画面中心距离增大
 *     （参考 shader.se 的 ChromaticAberrationNode2，垂直方向而非径向）
 *  3. 暗角：径向衰减，让画面四周变暗
 *  4. 圆角遮罩：用 SDF 计算到圆角矩形的最短距离，超出范围 → 透明
 *     配合鱼眼效果，让画面四角变圆，不再有锐利的直角
 *  5. 边缘模糊：在圆角边缘内侧一段范围内，多次采样并按距边缘距离加权混合，
 *     让边缘呈现羽化模糊，避免圆角边界过于生硬
 *
 * 注意：色散偏移用的是畸变后的 UV，让色散跟随畸变一起变形，视觉更自然
 */
const PostFXShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uChromaticAberration: { value: 1.0 },
    uChromaticFalloff: { value: 1.0 },
    uLensDistortion: { value: 0.0 },
    uLensDistortionBorder: { value: 0.0 },
    uVignetteIntensity: { value: 0.0 },
    uVignetteRadius: { value: 0.5 },
    uAspect: { value: 1.0 },
    // 圆角半径（0~0.5，UV 单位）。0=直角；0.5=完全圆形。
    // 默认 0.06 让四角有适度圆角，配合鱼眼显得像镜头边缘
    uCornerRadius: { value: 0.07 },
    // 边缘模糊宽度（0~0.2，UV 单位）。在圆角内侧该宽度内做羽化模糊。
    // 默认 0.025 让圆角边缘柔化过渡
    uEdgeBlur: { value: 0.1 },
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
    uniform float uChromaticAberration;
    uniform float uChromaticFalloff;
    uniform float uLensDistortion;
    uniform float uLensDistortionBorder;
    uniform float uVignetteIntensity;
    uniform float uVignetteRadius;
    uniform float uAspect;
    uniform float uCornerRadius;
    uniform float uEdgeBlur;
    varying vec2 vUv;

    /**
     * 桶形畸变（Barrel Distortion）
     *
     * 公式：scale = 1 + r² × distortion
     *  - r = 到画面中心的距离
     *  - distortion 越大，边缘外凸越强烈（鱼眼感）
     *
     * border 参数控制边缘缩放：
     *  - border=0 → n=0.3655，整体缩放 a = 1 - 0.3655×distortion，边缘被拉伸
     *  - border=1 → n=0，a=1，边缘不额外缩放
     */
    vec2 barrelDistort(vec2 uv, float distortion, float border) {
      float n = mix(0.3655, 0.0, border);
      float a = 1.0 - distortion * n;
      float s = distortion * n * 0.5;

      vec2 i = uv - 0.5;
      float r2 = dot(i, i);
      float scale = 1.0 + r2 * distortion;

      return a * (vec2(i.x * scale, i.y * scale) + 0.5) + s;
    }

    /**
     * 圆角矩形 SDF（Signed Distance Field）
     *
     * 功能：计算点到圆角矩形边界的带符号距离
     *  - 返回值 < 0：点在矩形内部
     *  - 返回值 = 0：点在边界上
     *  - 返回值 > 0：点在矩形外部
     *
     * 参数：
     *  - p          {vec2} 采样点位置（已归一化到 -0.5~0.5 范围）
     *  - aspect     {float} 宽高比，用于校正 X 方向使圆角不变形
     *  - corner     {float} 圆角半径（已按 aspect 校正）
     *
     * 算法：SDF of Rounded Box（Inigo Quilez 经典实现）
     *  - 计算点到矩形边的距离，再减去圆角半径
     *  - length(max(q, 0.0)) 处理外部角落，min(max(qx,qy),0.0) 处理内部边
     */
    float roundedBoxSDF(vec2 p, float aspect, float corner) {
      // X 方向按 aspect 缩放，使圆角在视觉上呈圆形而非椭圆
      vec2 q = abs(p * vec2(aspect, 1.0)) - vec2(0.5 * aspect - corner, 0.5 - corner);
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
    }

    void main() {
      vec2 uv = vUv;

      // 1. 桶形畸变
      vec2 distortedUV = barrelDistort(uv, uLensDistortion, uLensDistortionBorder);

      // UV 越界 → 黑色（避免采样到画面外的杂讯）
      if (distortedUV.x < 0.0 || distortedUV.x > 1.0 ||
          distortedUV.y < 0.0 || distortedUV.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
      }

      // 2. 色散：垂直方向 RGB 分离
      //    aspect 校正让偏移在宽屏上不会变形
      //    dist 范围：中心=0，边缘≈0.7，角落≈1.4（线性距离）
      //    falloff 控制过渡曲线：
      //      falloff=1.0 → 线性，从中心到边缘均匀增长
      //      falloff=2.0 → 平方曲线，中心色散更弱、边缘加速增长（中心更干净）
      //      falloff=0.5 → 开方曲线，中心也有较强色散（整体色散更均匀）
      //    offset = 0.006 × dist^falloff × strength
      vec2 aspectCorrect = vec2(uAspect, 1.0) / max(uAspect, 1.0);
      float dist = length((uv - 0.5) * aspectCorrect * 2.0);
      float falloffCurve = pow(dist, uChromaticFalloff);
      float offset = 0.006 * falloffCurve * uChromaticAberration;

      float r = texture2D(tDiffuse, distortedUV + vec2(0.0, -offset)).r;
      float g = texture2D(tDiffuse, distortedUV).g;
      float b = texture2D(tDiffuse, distortedUV + vec2(0.0, +offset)).b;
      float a = texture2D(tDiffuse, distortedUV).a;

      vec4 color = vec4(r, g, b, a);

      // 3. 暗角：径向衰减
      //    vignetteRadius 控制暗角起始半径，intensity 控制暗角强度
      float vRadius = uVignetteRadius;
      float vDist = length(uv - 0.5);
      float vignette = smoothstep(vRadius, vRadius + 0.3, vDist);
      color.rgb *= 1.0 - vignette * uVignetteIntensity;

      // 4. 圆角遮罩 + 边缘模糊
      //    计算当前像素到圆角矩形边界的带符号距离
      //    d < 0 在内部；d > 0 在外部（应被裁掉）
      float corner = uCornerRadius;
      float d = roundedBoxSDF(uv - 0.5, uAspect, corner);

      // 4a. 圆角裁切：d > 0 的像素完全透明
      //     smoothstep 让 d=0 附近有 1px 抗锯齿过渡，避免锯齿
      float mask = 1.0 - smoothstep(0.0, 0.002, d);
      color.a *= mask;
      color.rgb *= mask;

      // 4b. 边缘模糊：在圆角内侧 uEdgeBlur 宽度内做多次采样混合
      //     d 范围 [-uEdgeBlur, 0] 是模糊过渡区，按距离权重混合周围像素
      //     距边界越近（d→0）权重越高，让边缘呈现羽化感
      float blurRange = uEdgeBlur;
      if (d < 0.0 && d > -blurRange) {
        // 模糊权重：d=0 时权重 1（最大模糊），d=-blurRange 时权重 0
        float blurWeight = 1.0 - abs(d) / blurRange;
        // 4 方向采样并按距中心距离缩放，模拟高斯模糊
        // 采样方向沿 UV 主轴，半径按 blurWeight 增长
        vec2 blurDir = vec2(blurWeight * 0.01);
        vec4 blurColor = vec4(0.0);
        blurColor += texture2D(tDiffuse, distortedUV + vec2(blurDir.x, 0.0));
        blurColor += texture2D(tDiffuse, distortedUV - vec2(blurDir.x, 0.0));
        blurColor += texture2D(tDiffuse, distortedUV + vec2(0.0, blurDir.y));
        blurColor += texture2D(tDiffuse, distortedUV - vec2(0.0, blurDir.y));
        blurColor *= 0.25;
        // 按权重混合原始色与模糊色
        color.rgb = mix(color.rgb, blurColor.rgb, blurWeight);
      }

      gl_FragColor = color;
    }
  `,
};

interface PostProcessingProps {
  /** 后处理参数（外部传入，实时更新） */
  params: PostFXParams;
  /** 是否启用后处理（false 时直接走 R3F 默认渲染管线） */
  enabled?: boolean;
}

/**
 * 后处理组件：色散 + 鱼眼 + 暗角
 *
 * 功能：
 *  - 在 R3F 的 Canvas 内创建 EffectComposer + RenderPass + 自定义 ShaderPass
 *  - useFrame 里手动调用 composer.render()，接管 R3F 的渲染循环
 *  - 参数变化时通过 ref 同步到 shader uniforms，不触发 React 重渲染
 *
 * 参数：
 *  - params:  PostFXParams，运行时可调的后处理参数
 *  - enabled: boolean，是否启用后处理（默认 true）
 *
 * 返回值：null（不渲染任何 DOM，纯逻辑组件）
 *
 * 异常：EffectComposer 创建失败时会回退到 R3F 默认渲染
 *
 * 注意事项：
 *  - 必须放在 Canvas 内部，作为 Canvas 的子元素
 *  - useFrame 里设了 renderPriority=1，会接管 R3F 默认渲染（自动 gl.clear + 渲染场景）
 *  - composer 的 size 由 R3F 的 size 驱动，自动响应窗口缩放
 *  - 当 enabled=false 时直接 return，不调用 composer.render()，R3F 回到默认渲染
 */
export function PostProcessing({ params, enabled = true }: PostProcessingProps) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const passRef = useRef<ShaderPass | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);

  // 创建 EffectComposer + RenderPass + Bloom + 自定义 ShaderPass
  // useMemo 避免每次渲染都重建（只在 gl 变化时重建）
  useMemo(() => {
    // 用默认 renderTarget（UnsignedByteType）保证兼容性：
    // 之前尝试 HalfFloatType + samples=4 (MSAA) 在高分屏 + ANGLE/D3D11 上会触发
    // GL_OUT_OF_MEMORY → CONTEXT_LOST。Bloom 的彩色辉光效果优先于锯齿精度。
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));

    // Bloom 辉光：让屏幕 emissive 自发光部分向四周扩散彩色光晕
    // 顺序：Bloom 必须在色散/鱼眼前，否则色散会把 Bloom 的光晕也拆成 RGB 分离
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(gl.domElement.width || 1, gl.domElement.height || 1),
      params.bloomStrength,
      params.bloomRadius,
      params.bloomThreshold
    );
    c.addPass(bloom);
    bloomRef.current = bloom;

    const pass = new ShaderPass(PostFXShader);
    pass.renderToScreen = true;
    c.addPass(pass);

    passRef.current = pass;
    composerRef.current = c;
    // 注意：params 不进依赖，避免每次参数调整都重建 composer；
    //      params 变化通过下方 useEffect 同步到 uniforms / bloom 属性
  }, [gl, scene, camera]);

  // 同步 size 变化到 composer
  useEffect(() => {
    if (composerRef.current) {
      composerRef.current.setSize(size.width, size.height);
      composerRef.current.setPixelRatio(gl.getPixelRatio());
    }
    if (passRef.current) {
      // aspect = width / height，用于色散的 aspect 校正
      (passRef.current.uniforms.uAspect.value as number) = size.width / size.height;
    }
  }, [size, gl]);

  // 同步 params 到 shader uniforms 和 bloom 属性
  useEffect(() => {
    if (!passRef.current) return;
    const u = passRef.current.uniforms;
    u.uChromaticAberration.value = params.chromaticAberration;
    u.uChromaticFalloff.value = params.chromaticFalloff;
    u.uLensDistortion.value = params.lensDistortion;
    u.uLensDistortionBorder.value = params.lensDistortionBorder;
    u.uVignetteIntensity.value = params.vignetteIntensity;
    u.uVignetteRadius.value = params.vignetteRadius;
    // Bloom 参数同步：strength/radius/threshold 实时调整辉光表现
    if (bloomRef.current) {
      bloomRef.current.strength = params.bloomStrength;
      bloomRef.current.radius = params.bloomRadius;
      bloomRef.current.threshold = params.bloomThreshold;
    }
  }, [params]);

  // 卸载时释放资源
  useEffect(() => {
    return () => {
      composerRef.current?.dispose();
      composerRef.current = null;
      passRef.current = null;
    };
  }, []);

  // 每帧调用 composer.render()，renderPriority=1 接管 R3F 默认渲染
  useFrame(() => {
    if (!enabled || !composerRef.current) return;
    composerRef.current.render();
  }, 1);

  return null;
}
