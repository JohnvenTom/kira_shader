import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { MotionBlurPass } from './MotionBlurPass';
import { BootPassShader, applyBootAudioState } from '../boot/bootShader';
import { bootStore } from '../boot/bootStore';
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
  /** 运动模糊强度（0~1）。帧间累积混合：值越大运动物体留下的残影拖尾越长越浓，
   *  0 = 完全关闭；相机推进/转场时拖影最明显，静态画面收敛后无拖影 */
  motionBlur: number;
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

/**
 * 景深通道着色器（移植自钢琴页 PianoGrade 的 DOF 段，管线坑位已在那页踩平）
 *
 * 实现：
 *  1. 深度纹理 → 投影逆矩阵重建视空间深度 vz
 *  2. CoC（模糊圈）：焦深带（|vz-uFocusDist| < uFocusRange）内完全清晰，
 *     带外按 uDof 斜率线性增长，饱和于 uDofMax
 *  3. 9-tap disc 模糊：焦点平面 blur=0 时全部采样落在同一 texel，
 *     退化为单次取样（锐利），所以焦平面无额外柔化
 *
 * 注意：
 *  - 深度纹理由主 composer 的渲染目标提供（rt1/rt2 共享同一张），
 *    场景透明区域（无几何体）深度为 1，直接按 vz=far 处理（不参与模糊判定）
 *  - 本页画布不透明（clearColor alpha=1），9-tap 直接均值即可，
 *    无需钢琴页的预乘 alpha 处理
 */
const DofShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uProjInv: { value: new THREE.Matrix4() },
    uFocusDist: { value: 5.0 },
    uFocusRange: { value: 0.6 },
    uDof: { value: 0.16 },
    uDofMax: { value: 0.38 },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
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
    uniform sampler2D tDepth;
    uniform mat4 uProjInv;
    uniform float uFocusDist;
    uniform float uFocusRange;
    uniform float uDof;
    uniform float uDofMax;
    uniform vec2 uTexel;
    varying vec2 vUv;

    vec3 viewPos(vec2 uv, float d) {
      vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      return p.xyz / p.w;
    }

    /* 9 tap disc 模糊（钢琴页同款权重） */
    vec3 disc9(vec2 uv, vec2 r) {
      vec3 s = texture2D(tDiffuse, uv).rgb * 0.22;
      s += texture2D(tDiffuse, uv + vec2(r.x, 0.0)).rgb * 0.10;
      s += texture2D(tDiffuse, uv - vec2(r.x, 0.0)).rgb * 0.10;
      s += texture2D(tDiffuse, uv + vec2(0.0, r.y)).rgb * 0.10;
      s += texture2D(tDiffuse, uv - vec2(0.0, r.y)).rgb * 0.10;
      s += texture2D(tDiffuse, uv + r * 0.70).rgb * 0.095;
      s += texture2D(tDiffuse, uv - r * 0.70).rgb * 0.095;
      s += texture2D(tDiffuse, uv + vec2(r.x, -r.y) * 0.70).rgb * 0.095;
      s += texture2D(tDiffuse, uv + vec2(-r.x, r.y) * 0.70).rgb * 0.095;
      return s;
    }

    void main() {
      float d0 = texture2D(tDepth, vUv).x;
      float vz = 60.0;
      if (d0 < 0.99999) vz = -viewPos(vUv, d0).z;
      float coc = clamp((abs(vz - uFocusDist) - uFocusRange) * uDof, 0.0, 1.0) * uDofMax;
      vec2 blur = uTexel * (coc * 26.0);
      gl_FragColor = vec4(disc9(vUv, blur), 1.0);
    }
  `,
};

interface PostProcessingProps {
  /** 后处理参数（外部传入，实时更新） */
  params: PostFXParams;
  /** 是否启用后处理（false 时直接走 R3F 默认渲染管线） */
  enabled?: boolean;
  /** DOF 焦点目标（ComputerScene 写入：鼠标指向表面的代理命中点） */
  focusRef?: React.MutableRefObject<THREE.Vector3>;
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
export function PostProcessing({ params, enabled = true, focusRef }: PostProcessingProps) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const passRef = useRef<ShaderPass | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);
  // 运动模糊通道引用：强度在参数同步 effect 中更新，dt 在 useFrame 中更新
  const motionBlurRef = useRef<MotionBlurPass | null>(null);
  // 景深通道引用：焦点距离每帧由 focusRef 阻尼驱动
  const dofRef = useRef<ShaderPass | null>(null);
  // boot 合成层：紧贴 RenderPass 之后、Bloom 之前——boot 屏与场景
  // 共享整条后处理链（辉光/色散/暗角/圆角/运动模糊），显现为管线内混合
  const bootPassRef = useRef<ShaderPass | null>(null);
  // focusRef 的 ref 镜像（避免闭包旧值）
  const focusTargetRef = useRef<React.MutableRefObject<THREE.Vector3> | undefined>(focusRef);
  focusTargetRef.current = focusRef;
  // 焦点距离阻尼用的临时向量（避免每帧分配）
  const tmpFocus = useMemo(() => new THREE.Vector3(), []);

  // 创建 EffectComposer + 深度纹理 + RenderPass + 景深 + Bloom + 自定义 ShaderPass + 运动模糊
  // useMemo 避免每次渲染都重建（只在 gl 变化时重建）
  useMemo(() => {
    // === 深度纹理 + 自定义渲染目标（钢琴页验证过的守卫模式）===
    // DOF 需要直读场景深度，主 RT 必须挂深度纹理：
    //  - samples=0（禁 MSAA）：实测 samples>0 时 MSAA 深度 resolve 在部分驱动栈
    //    （SwiftShader / ANGLE-D3D）上静默失败——深度纹理保持清空值 1.0，CoC 全失真
    //  - 类型保持 UnsignedByte：此页曾试过 HalfFloat + MSAA 在高分屏 ANGLE/D3D11
    //    上触发 GL_OUT_OF_MEMORY → CONTEXT_LOST（见下方原注释），不重蹈覆辙
    const dbSize = gl.getDrawingBufferSize(new THREE.Vector2());
    const depthTexture = new THREE.DepthTexture(dbSize.x, dbSize.y);
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    depthTexture.type = THREE.UnsignedIntType;
    const rt = new THREE.WebGLRenderTarget(dbSize.x, dbSize.y, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.LinearSRGBColorSpace,
      samples: 0,
      depthBuffer: true,
      depthTexture,
      resolveDepthBuffer: true,
    });
    const c = new EffectComposer(gl, rt);
    // RenderPass 每帧在两个 target 间交替，clone 可能带走一张克隆深度纹理 →
    // 隔帧拿到上一帧深度。两个 target 指向同一张深度即可（钢琴页同款守卫）
    c.renderTarget2.depthTexture = depthTexture;

    c.addPass(new RenderPass(scene, camera));

    // Boot 合成层：boot 屏（进度条阶段）盖在场景之上，随显现弹簧淡出。
    // 放在 Bloom 前——白色文字/进度条会吃辉光，色散/暗角/圆角统一作用于合成结果
    const bootPass = new ShaderPass(BootPassShader);
    const dbSize0 = gl.getDrawingBufferSize(new THREE.Vector2());
    bootPass.uniforms.uResolution.value.set(dbSize0.x, dbSize0.y);
    c.addPass(bootPass);
    bootPassRef.current = bootPass;

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
    // 色散/畸变/暗角通道让出"最后一帧"位置：运动模糊挂在它之后作为收尾
    pass.renderToScreen = false;
    c.addPass(pass);

    // 运动模糊通道（帧间累积混合）：置于管线末段，
    // 让拖影作用于含 Bloom/色散/暗角在内的完整画面
    const motionBlur = new MotionBlurPass(
      gl.domElement.width || 1,
      gl.domElement.height || 1,
      params.motionBlur
    );
    c.addPass(motionBlur);
    motionBlurRef.current = motionBlur;

    // 景深通道：放在链尾（最终上屏）。
    // 【为什么不能放中段】rt1/rt2 共享同一张深度纹理，若 DOF 往 writeBuffer
    // （挂着这张深度纹理）里写、同时采样它读深度——就是"采样附着在当前
    // framebuffer 上的纹理"反馈环：绘制被 GL 静默拒绝（GL_INVALID_OPERATION，
    // 不抛异常不打印），输出全黑并污染后续所有通道（实测整页画布全黑）。
    // 放在链尾后 DOF 直接写屏幕帧缓冲（未挂深度纹理），采样共享深度无冲突
    // ——与钢琴页 Grade 直写屏幕是同一个避坑思路。
    // 副作用：DOF 作用于运动模糊之后，先拖影后虚化；两者都是镜头层面的
    // 混叠效应，先后顺序在观感上不可区分。
    const dof = new ShaderPass(DofShader);
    dof.uniforms.tDepth.value = depthTexture;
    // 焦距初值取当前相机到焦点的真实距离，避免从默认 5.0 收敛造成"开场先糊后清"
    if (focusRef) {
      dof.uniforms.uFocusDist.value = camera.position.distanceTo(focusRef.current);
    }
    c.addPass(dof);
    dofRef.current = dof;
    // 调试钩子：供自动化验证读取 DOF uniform 实时值（无副作用，保留）
    (window as unknown as { __dofU?: unknown }).__dofU = dof.uniforms;

    passRef.current = pass;
    composerRef.current = c;
    // 注意：params 不进依赖，避免每次参数调整都重建 composer；
    //      params 变化通过下方 useEffect 同步到 uniforms / bloom 属性
  }, [gl, scene, camera]);

  // 同步 size 变化到 composer（深度纹理随 RT setSize 一起缩放）
  useEffect(() => {
    if (composerRef.current) {
      composerRef.current.setSize(size.width, size.height);
      composerRef.current.setPixelRatio(gl.getPixelRatio());
    }
    if (passRef.current) {
      // aspect = width / height，用于色散的 aspect 校正
      (passRef.current.uniforms.uAspect.value as number) = size.width / size.height;
    }
    if (dofRef.current) {
      const db = gl.getDrawingBufferSize(new THREE.Vector2());
      dofRef.current.uniforms.uTexel.value.set(1 / db.x, 1 / db.y);
    }
    if (bootPassRef.current) {
      const db = gl.getDrawingBufferSize(new THREE.Vector2());
      bootPassRef.current.uniforms.uResolution.value.set(db.x, db.y);
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
    // 运动模糊强度同步：混合同一帧的系数在 useFrame 中按 dt 换算
    if (motionBlurRef.current) {
      motionBlurRef.current.strength = params.motionBlur;
    }
  }, [params]);

  // 卸载时释放资源
  useEffect(() => {
    return () => {
      composerRef.current?.dispose();
      composerRef.current = null;
      passRef.current = null;
      // 运动模糊通道持有私有 RenderTarget，需显式销毁防显存泄漏
      motionBlurRef.current?.dispose();
      motionBlurRef.current = null;
    };
  }, []);

  // 每帧：先按 dt 更新运动模糊混合系数与景深焦点，再调用 composer.render()，
  // renderPriority=1 接管 R3F 默认渲染
  useFrame((_state, delta) => {
    if (!enabled || !composerRef.current) return;
    motionBlurRef.current?.update(delta);

    // boot 合成层：进度条显示值 + 显现弹簧驱动的混合系数。
    // 显现期 bootAlpha = 1 − spring（可过冲到负值 → clamp 到 0）；
    // 弹簧收敛后直接禁用该通道，省一整帧全屏 quad 的开销
    const bootPass = bootPassRef.current;
    if (bootPass) {
      bootPass.uniforms.uProgress.value = bootStore.displayProgress;
      bootPass.uniforms.uBootTime.value = _state.clock.elapsedTime;
      const alpha =
        bootStore.phase === 'reveal' ? Math.max(0, 1 - bootStore.spring) : bootStore.springDone ? 0 : 1;
      bootPass.uniforms.uBootAlpha.value = alpha;
      bootPass.enabled = alpha > 0.001;
      // BGM 解锁态：文本行 "PRESS ANYWHERE…" ↔ "AUDIO: ON"
      applyBootAudioState(bootPass.uniforms);
    }

    // 景深焦点：相机到"鼠标指向表面命中点"的距离，阻尼逼近平滑过渡。
    // lambda=14（约 70ms 收敛）：与钢琴页同一档跟手度，快速扫动时焦点连续滑动
    const dof = dofRef.current;
    if (dof) {
      dof.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
      const focusTarget = focusTargetRef.current;
      if (focusTarget) {
        const kf = 1 - Math.exp(-delta * 14.0);
        const target = camera.position.distanceTo(tmpFocus.copy(focusTarget.current));
        const u = dof.uniforms.uFocusDist;
        u.value += (target - u.value) * kf;
      }
    }

    // 关键：渲染期间关闭 autoClear（钢琴页同款守卫）。
    // rt1/rt2 共享一张深度纹理，后续通道（Bloom 复合/色散/运动模糊）的全屏 quad
    // 在 autoClear=true 时会把共享深度清成远平面 1.0——DOF 的 CoC 全部失真。
    // RenderPass 有显式 clear（this.clear），场景颜色/深度仍然每帧正确写入。
    const prevAutoClear = gl.autoClear;
    gl.autoClear = false;
    composerRef.current.render();
    gl.autoClear = prevAutoClear;
  }, 1);

  return null;
}
