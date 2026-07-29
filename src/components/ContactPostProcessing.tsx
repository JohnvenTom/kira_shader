import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * 鱼眼 + 色散 后处理 shader
 *
 * 功能：
 *  - 鱼眼畸变（Barrel Distortion）：把画面边缘向外拉伸，模拟广角镜头畸变
 *  - RGB 色散（Chromatic Aberration）：R/G/B 三通道偏移，模拟镜头色差
 *  - 边缘暗角（Vignette）：画面四周变暗，营造电影感
 *  - 效果强度随 progress 变化：progress=0 时较弱，progress=1 时最强
 *
 * uniforms：
 *  - tDiffuse      输入纹理
 *  - uFisheye      鱼眼畸变强度（0~1.5）
 *  - uDispersion   色散偏移量（0~0.02）
 *  - uVignette     暗角强度（0~1.5）
 *  - uProgress     滚动进度（0~1），用于动态调整效果
 *
 * 注意事项：
 *  - 鱼眼畸变用 r^2 公式（标准 barrel distortion）
 *  - 色散在画面边缘最强，中心几乎为 0
 *  - 使用 WebGL2 自动支持 texture lod，兼容性良好
 */
export const FisheyeChromaticShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uFisheye: { value: 0.0 },
    uDispersion: { value: 0.0 },
    uVignette: { value: 0.0 },
    uProgress: { value: 0.0 },
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
    uniform float uFisheye;
    uniform float uDispersion;
    uniform float uVignette;
    uniform float uProgress;
    varying vec2 vUv;

    /**
     * 鱼眼畸变（Barrel Distortion）
     * - 把纹理坐标按 r^2 公式向外拉伸，边缘拉伸更强
     * - strength=0 时无畸变，strength=1.0 边缘拉伸明显
     */
    vec2 fisheyeDistort(vec2 uv, float strength) {
      // 把 uv 中心移到原点：范围 [-1, 1]
      vec2 centered = uv * 2.0 - 1.0;
      float r2 = dot(centered, centered);
      // barrel distortion 公式：r' = r * (1 + k * r^2)
      float distortFactor = 1.0 + strength * r2;
      vec2 distorted = centered * distortFactor;
      // 还原到 [0, 1]
      return distorted * 0.5 + 0.5;
    }

    void main() {
      // 计算到中心的距离（用于边缘色散和暗角）
      vec2 centered = vUv * 2.0 - 1.0;
      float r = length(centered);

      // 鱼眼畸变后的 uv
      vec2 distortedUv = fisheyeDistort(vUv, uFisheye);

      // 色散：在畸变后的 uv 基础上，R/G/B 三通道沿径向偏移
      // 偏移量在边缘最强（r 大），中心为 0
      float dispAmount = uDispersion * r;
      vec2 dir = normalize(centered + vec2(1e-5));
      // R 通道向内偏移，B 通道向外偏移，G 不动
      float rColor = texture2D(tDiffuse, distortedUv - dir * dispAmount).r;
      float gColor = texture2D(tDiffuse, distortedUv).g;
      float bColor = texture2D(tDiffuse, distortedUv + dir * dispAmount).b;

      vec3 color = vec3(rColor, gColor, bColor);

      // 暗角：边缘变暗
      float vignette = 1.0 - uVignette * smoothstep(0.5, 1.4, r);
      color *= vignette;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

/**
 * ContactPostProcessing - contact 场景后处理
 *
 * 功能：
 *  - 在 R3F Canvas 内创建 EffectComposer，应用鱼眼 + 色散 + 暗角 shader
 *  - 效果强度随 progressRef 动态变化：
 *    - progress=0（高处俯视）：鱼眼 0.1，色散 0.001，暗角 0.3（轻微）
 *    - progress=1（贴近电话）：鱼眼 0.8，色散 0.008，暗角 1.2（强烈）
 *  - lerp 平滑强度变化，避免滚轮离散变化造成跳变
 *
 * 参数：
 *  - progressRef: contact 滚动进度 ref（0~1）
 *
 * 返回值：null（纯逻辑组件，渲染结果由 EffectComposer 输出到屏幕）
 *
 * 异常：EffectComposer 创建失败时回退到 R3F 默认渲染
 *
 * 注意事项：
 *  - 必须放在 Canvas 内部
 *  - useFrame renderPriority=1 接管 R3F 默认渲染（避免双重渲染）
 *  - resize 时自动同步 size 到 composer
 */
export function ContactPostProcessing({
  progressRef,
}: {
  progressRef: React.MutableRefObject<number>;
}) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const fxPassRef = useRef<ShaderPass | null>(null);

  // 当前效果强度（lerp 平滑追随目标值）
  const currentFisheye = useRef(0.1);
  const currentDispersion = useRef(0.001);
  const currentVignette = useRef(0.3);

  // 创建 EffectComposer + ShaderPass
  useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));

    const fxPass = new ShaderPass(FisheyeChromaticShader);
    fxPass.renderToScreen = true;
    c.addPass(fxPass);

    composerRef.current = c;
    fxPassRef.current = fxPass;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);

  // resize 同步
  useEffect(() => {
    if (composerRef.current) {
      composerRef.current.setSize(size.width, size.height);
    }
  }, [size.width, size.height]);

  // 每帧：根据 progress 计算目标强度，lerp 平滑后写入 uniform
  useFrame(() => {
    const composer = composerRef.current;
    const fxPass = fxPassRef.current;
    if (!composer || !fxPass) return;

    const p = progressRef.current;
    // 用 smootherstep 让 progress 变化更丝滑
    const t = p * p * p * (p * (p * 6 - 15) + 10);

    // 目标强度：progress=0 轻微，progress=1 强烈
    const targetFisheye = 0.1 + 0.7 * t;      // 0.1 → 0.8
    const targetDispersion = 0.001 + 0.007 * t; // 0.001 → 0.008
    const targetVignette = 0.3 + 0.9 * t;      // 0.3 → 1.2

    // lerp 平滑（系数 0.1，约 250ms 到达目标）
    const LERP = 0.1;
    currentFisheye.current += (targetFisheye - currentFisheye.current) * LERP;
    currentDispersion.current +=
      (targetDispersion - currentDispersion.current) * LERP;
    currentVignette.current +=
      (targetVignette - currentVignette.current) * LERP;

    const u = fxPass.uniforms;
    u.uFisheye.value = currentFisheye.current;
    u.uDispersion.value = currentDispersion.current;
    u.uVignette.value = currentVignette.current;
    u.uProgress.value = p;

    composer.render();
  }, 1);

  return null;
}
