/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { HERO_COMPOSE, HERO_ASSETS } from './heroConfig';

/**
 * 说明：TSL 的节点类型在 TypeScript 下类型极重（每个算子都会产生新的泛型节点类型），
 * 逐算子精确标注会让这一百多行着色器代码充斥类型体操、可读性崩塌。
 * 因此本文件把 TSL 命名空间整体取成 `any`（只在此文件、只用于构建节点图），
 * 数值与语义仍严格按原件实现 —— 这是刻意取舍，不是偷懒。
 */
const N = TSL as any;

/** 合成 pass 的可调参数（对应原件 `p({texture, bloomIntensity, ...})` 的入参） */
export interface HeroComposeParams {
  bloomIntensity: number;
  bloomThreshold: number;
  bloomRadius: number;
  pow: number;
  sepiaIntensity: number;
  brightness: number;
  contrast: number;
  chromaticAberration: number;
  motionBlur: number;
  noiseIntensity: number;
  noiseVelocity: number;
  vignetteRadius: number;
  vignetteSmoothness: number;
  vignetteIntensity: number;
  lensDistortion: number;
}

/**
 * 生成默认合成参数
 *
 * 功能：以 HERO_COMPOSE（原件 uniform 默认值）为基准给出一份可直接使用的参数对象
 *
 * 参数：无
 *
 * 返回值：HeroComposeParams
 *
 * 异常：无
 *
 * 注意事项：原件首页那份逐页效果数值来自运行时 CMS，不在生产包里，
 *          所以这里是「算法一致、数值待按观感校准」的起点。
 */
export function createDefaultComposeParams(): HeroComposeParams {
  return {
    bloomIntensity: HERO_COMPOSE.bloomIntensity,
    bloomThreshold: HERO_COMPOSE.bloomThreshold,
    bloomRadius: HERO_COMPOSE.bloomRadius,
    pow: HERO_COMPOSE.pow,
    sepiaIntensity: HERO_COMPOSE.sepiaIntensity,
    brightness: HERO_COMPOSE.brightness,
    contrast: HERO_COMPOSE.contrast,
    chromaticAberration: HERO_COMPOSE.chromaticAberration,
    motionBlur: HERO_COMPOSE.motionBlur,
    noiseIntensity: HERO_COMPOSE.noiseIntensity,
    noiseVelocity: HERO_COMPOSE.noiseVelocity,
    vignetteRadius: HERO_COMPOSE.vignetteRadius,
    vignetteSmoothness: HERO_COMPOSE.vignetteSmoothness,
    vignetteIntensity: HERO_COMPOSE.vignetteIntensity,
    lensDistortion: 0.3,
  };
}

/** 单次 bloom 模糊的采样圈数 × 每圈采样数（12 个 tap，够出柔和光晕且开销可控） */
const BLOOM_TAPS = 12;

/**
 * 创建 hero 的离屏合成管线
 *
 * 功能：
 *  - 建一张 HalfFloat 的离屏渲染目标（sceneRT），主场景先渲到这里，再由合成 pass 上屏
 *  - 按原件顺序构造合成节点图：
 *      ① 桶形畸变（按宽高比自适应的 lensDistortion，border 控制边缘缩放）
 *      ② 采样场景纹理 + RGB 色散（垂直方向分离）
 *      ③ 饱和度（原件 `ApplySaturation`：mix(亮度, 原色, saturation)）
 *      ④ 暗角（radius / smoothness / intensity）
 *      ⑤ bloom：亮度阈值提取（threshold + smoothing 的 smoothstep）+ 径向 12 tap 模糊 + 强度
 *      ⑥ `min(bloom, 1)` → 屏幕混合 → 暖色加色 `vec3(1, .8, 0) * .1`
 *      ⑦ `pow`
 *      ⑧ sepia 矩阵混合
 *      ⑨ `clamp(rgb * brightness, 0, 1)` → contrast
 *      ⑩ 噪点（rgba_noise 平铺 + time × velocity 偏移，只加不减）
 *  - 全部参数走 uniform，因此逐帧变化（含原件 bloom 的三频呼吸调制）都能直接生效
 *
 * 参数：
 *  - width / height {number} 初始 CSS 画布尺寸（像素）
 *
 * 返回值：{ sceneRT, composeScene, composeCamera, params, setParams, setBloomBreathing, setSize, dispose }
 *  - setParams(p, time)      每帧写 uniform（time 驱动噪点流动）
 *  - setSize(w, h)           画布尺寸变化时重设 RT 与 aspect
 *
 * 异常：噪点贴图加载失败时该项退化（noiseIntensity 保持 0 时几乎无感），不影响其余效果
 *
 * 注意事项：
 *  - **与原件的已知差异（唯一一处）**：原件 bloom 是自研 7 级 mip 模糊链（带 luminanceSmoothing），
 *    这里改为「阈值提取 + 径向 12 tap」的等效近似。理由是 TSL 的节点图在编译期一次成形，
 *    而原件的 bloomIntensity 是逐帧变化的，用固定 bloom 节点无法承载这种变化；
 *    改为全 uniform 驱动后，呼吸调制才能真的动起来。
 *  - 原件把「桶形畸变/暗角/饱和度」放在场景合成 pass、「bloom 及之后」放在最终 compose pass；
 *    这里合并为一次 pass，顺序保持与原件一致。
 *  - dpr 上限 1.5，与原件 `dpr: [1, 1.5]` 一致。
 */
export function createHeroCompose(width: number, height: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let pxW = Math.max(1, Math.floor(width * dpr));
  let pxH = Math.max(1, Math.floor(height * dpr));

  const sceneRT = new THREE.RenderTarget(pxW, pxH, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    samples: 0,
  });

  const noiseTexture = new THREE.TextureLoader().load(
    HERO_ASSETS.noiseUrl,
    undefined,
    undefined,
    () => { /* 加载失败静默忽略 */ }
  );
  noiseTexture.wrapS = THREE.RepeatWrapping;
  noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.colorSpace = THREE.NoColorSpace;

  // ---- uniforms（全部为逐帧可写的动态量） ----
  // 注意：贴图**不**包成 uniform —— TSL 的 `texture()` 要求第一参是 `.isTexture === true` 的真贴图
  //      （普通 uniform 的 isTexture 是 undefined，会抛 "TextureNode: Need a three.js texture."）。
  //      RenderTarget.setSize 只改 image 尺寸、不替换 texture 对象，所以直接引用是安全的。
  const uAspect = N.uniform(width / height);
  const uLensDistortion = N.uniform(0.3);
  const uLensDistortionBorder = N.uniform(0.5);
  const uSaturation = N.uniform(1);
  const uVignetteRadius = N.uniform(0);
  const uVignetteSmoothness = N.uniform(0.3);
  const uVignetteIntensity = N.uniform(0);
  const uBloomIntensity = N.uniform(HERO_COMPOSE.bloomIntensity);
  const uBloomThreshold = N.uniform(HERO_COMPOSE.bloomThreshold);
  const uBloomRadius = N.uniform(HERO_COMPOSE.bloomRadius);
  const uPow = N.uniform(HERO_COMPOSE.pow);
  const uSepia = N.uniform(HERO_COMPOSE.sepiaIntensity);
  const uBrightness = N.uniform(HERO_COMPOSE.brightness);
  const uContrast = N.uniform(HERO_COMPOSE.contrast);
  const uChromatic = N.uniform(HERO_COMPOSE.chromaticAberration);
  const uNoiseIntensity = N.uniform(HERO_COMPOSE.noiseIntensity);
  const uNoiseVelocity = N.uniform(HERO_COMPOSE.noiseVelocity);
  const uTime = N.uniform(0);
  const uResolution = N.uniform(new THREE.Vector2(pxW, pxH));

  /**
   * 桶形畸变（原件 DH/DV 同款）
   *
   * 功能：把 UV 向中心收拢，scale = 1 + r² × distortion；border 控制边缘整体缩放
   *
   * 参数：
   *  - uvIn  TSL 节点，输入 UV
   *
   * 返回值：TSL 节点，畸变后的 UV
   *
   * 异常：无
   *
   * 注意事项：border=0 时边缘被拉伸（n=0.3655），border=1 时不额外缩放（n=0）
   */
  const barrel = (uvIn: any) => {
    const c = uvIn.sub(0.5);
    const r2 = N.dot(c, c);
    const n = N.mix(N.float(0.3655), N.float(0), uLensDistortionBorder);
    const a = N.float(1).sub(uLensDistortion.mul(n));
    const s = uLensDistortion.mul(n).mul(0.5);
    const scale = N.float(1).add(r2.mul(uLensDistortion));
    return N.vec2(c.x.mul(scale), c.y.mul(scale)).add(0.5).mul(a).add(s);
  };

  /**
   * 单点 bloom 亮度阈值提取
   *
   * 功能：原件 bloom 节点的核心 —— 按 threshold + smoothing 的 smoothstep 给亮度加权，
   *      低于阈值的像素被压掉，只有亮部参与模糊
   *
   * 参数：
   *  - uvT  TSL 节点，采样 UV
   *
   * 返回值：TSL 节点，阈值后的 RGB（vec3）
   *
   * 异常：无
   *
   * 注意事项：亮度权重用 0.299/0.587/0.114 的标准亮度公式（与原件 `luminance` 一致）
   */
  const thresholdAt = (uvT: any) => {
    const c = N.texture(sceneRT.texture, uvT);
    const lum = N.dot(c.rgb, N.vec3(0.299, 0.587, 0.114));
    const hi = uBloomThreshold.add(N.float(HERO_COMPOSE.bloomSmoothing));
    const w = N.smoothstep(uBloomThreshold, hi, lum);
    return c.rgb.mul(w);
  };

  const material = new THREE.MeshBasicNodeMaterial();
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;

  // ---- 合成节点图（一次性构建；所有变化量都是 uniform） ----
  // 关键：采样离屏纹理时 V 必须翻转。原件 A5 合成材质的基 UV 就是
  // `vec2(uv().x, oneMinus(uv().y))` —— 离屏 RT 的存储朝向与普通贴图相反，
  // 少这一步整幅画面会上下颠倒。此前合成链路编译失败退回直渲，所以这个差异没暴露。
  const uv0 = N.vec2(N.uv().x, N.oneMinus(N.uv().y));
  const warped = barrel(uv0);

  // ① + ② 畸变后采样 + 色散（垂直分离，偏移随到中心距离增长）
  const aspectCorrect = N.vec2(uAspect, 1).div(N.max(uAspect, 1));
  const chromaDist = N.length(uv0.sub(0.5).mul(aspectCorrect).mul(2));
  const chromaOffset = N.float(0.006).mul(chromaDist).mul(uChromatic);
  const chR = N.texture(sceneRT.texture, warped.add(N.vec2(0, chromaOffset.negate()))).r;
  const chG = N.texture(sceneRT.texture, warped).g;
  const chB = N.texture(sceneRT.texture, warped.add(N.vec2(0, chromaOffset))).b;
  const outAlpha = N.texture(sceneRT.texture, warped).a;
  const sampled = N.vec3(chR, chG, chB);

  // ③ 饱和度
  const lum = N.dot(sampled, N.vec3(0.299, 0.587, 0.114));
  const saturated = N.mix(N.vec3(lum), sampled, uSaturation);

  // ④ 暗角
  const vDist = N.length(uv0.sub(0.5));
  const vig = N.smoothstep(uVignetteRadius, uVignetteRadius.add(uVignetteSmoothness), vDist);
  const vignetted = saturated.mul(N.float(1).sub(vig.mul(uVignetteIntensity)));

  // ⑤ bloom：阈值提取 + 径向 12 tap（半径由 uBloomRadius 控制，强度由 uBloomIntensity 控制）
  const bloomRadiusPx = uBloomRadius.mul(0.018);
  const tapSum = (() => {
    let acc: any = thresholdAt(warped).mul(N.float(1 / BLOOM_TAPS));
    for (let i = 1; i < BLOOM_TAPS; i++) {
      const ang = (i / (BLOOM_TAPS - 1)) * Math.PI * 2;
      const rr = bloomRadiusPx.mul(0.35 + 0.65 * (i / (BLOOM_TAPS - 1)));
      const off = N.vec2(Math.cos(ang), Math.sin(ang)).mul(rr);
      acc = acc.add(thresholdAt(warped.add(off)).mul(N.float(1 / BLOOM_TAPS)));
    }
    return acc;
  })();
  const bloomClamped = N.min(tapSum.mul(uBloomIntensity), N.vec3(1, 1, 1));

  // ⑥ 屏幕混合 + 暖色加色（原件 `blendScreen(p, h) + p * vec3(1, .8, 0) * .1`）
  const screened = bloomClamped.add(vignetted).sub(bloomClamped.mul(vignetted));
  const graded = screened.add(bloomClamped.mul(N.vec3(1, 0.8, 0).mul(0.1)));

  // ⑦ pow（原件 `.pow(vec4(pow))`）
  const powed = graded.pow(N.vec3(uPow, uPow, uPow));

  // ⑧ sepia 矩阵
  const sepia = N.vec3(
    N.dot(powed, N.vec3(0.393, 0.769, 0.189)),
    N.dot(powed, N.vec3(0.349, 0.686, 0.168)),
    N.dot(powed, N.vec3(0.272, 0.534, 0.131))
  );
  const sepiaMixed = N.mix(powed, sepia, uSepia);

  // ⑨ clamp × brightness → contrast
  const bright = N.clamp(sepiaMixed.mul(uBrightness), 0, 1);
  const contrasted = bright.sub(0.5).mul(uContrast).add(0.5);

  // ⑩ 噪点：96×96 贴图按分辨率平铺 + 时间 × 速度滚动
  const noiseUv = uv0.mul(N.vec2(uResolution.x.div(96), uResolution.y.div(96))).add(N.vec2(uTime.mul(uNoiseVelocity)));
  const noiseSample = N.texture(noiseTexture, noiseUv).r;
  const noisy = contrasted.add(noiseSample.sub(0.5).mul(uNoiseIntensity));

  material.colorNode = N.vec4(noisy, outAlpha);

  const composeScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  composeScene.add(quad);
  const composeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const params = createDefaultComposeParams();

  /**
   * 写入每帧参数
   *
   * 功能：把 HeroComposeParams 同步到 uniforms（含暗角三项、桶形畸变与噪点流动时间）
   *
   * 参数：
   *  - p    {HeroComposeParams} 目标参数
   *  - time {number} 当前时间（秒）
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：bloomIntensity 支持逐帧变化，用于还原原件那套三频正弦呼吸调制
   */
  const setParams = (p: HeroComposeParams, time: number) => {
    uLensDistortion.value = p.lensDistortion;
    uVignetteRadius.value = p.vignetteRadius;
    uVignetteSmoothness.value = p.vignetteSmoothness || 0.3;
    uVignetteIntensity.value = p.vignetteIntensity;
    uChromatic.value = p.chromaticAberration;
    uPow.value = p.pow;
    uSepia.value = p.sepiaIntensity;
    uBrightness.value = p.brightness;
    uContrast.value = p.contrast;
    uNoiseIntensity.value = p.noiseIntensity;
    uNoiseVelocity.value = p.noiseVelocity;
    uBloomIntensity.value = p.bloomIntensity;
    uBloomThreshold.value = p.bloomThreshold;
    uBloomRadius.value = p.bloomRadius;
    uTime.value = time;
  };

  /**
   * 按画布宽高比重算桶形畸变强度
   *
   * 功能：还原原件 `lensDistortionFactor = clamp(map(aspect, 9/16→4/3, 0.2→1.2), 0.25, 1)`
   *      再 `lensDistortion = 0.2 * factor + 0.1` 的自适应规则
   *
   * 参数：
   *  - w / h {number} 画布 CSS 宽高
   *
   * 返回值：number 适配后的桶形畸变强度
   *
   * 异常：无
   *
   * 注意事项：竖屏（窄宽高比）畸变更强，横屏更弱 —— 这是原件「CRT 玻璃感」随屏幕变化的原因
   */
  const lensDistortionForAspect = (w: number, h: number) => {
    const aspect = w / h;
    const [a0, a1] = HERO_COMPOSE.lensDistortionFrom;
    const [v0, v1] = HERO_COMPOSE.lensDistortionTo;
    const t = Math.min(1, Math.max(0, (aspect - a0) / (a1 - a0)));
    const [c0, c1] = HERO_COMPOSE.lensDistortionClamp;
    const factor = Math.min(c1, Math.max(c0, v0 + (v1 - v0) * t));
    return 0.2 * factor + 0.1;
  };

  /**
   * 适配画布尺寸
   *
   * 功能：按新的 CSS 尺寸 × dpr 重设 RT，并更新 uResolution / uAspect
   *
   * 参数：
   *  - w / h {number} 新的 CSS 宽高
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：dpr 上限 1.5（与原件一致）
   */
  const setSize = (w: number, h: number) => {
    pxW = Math.max(1, Math.floor(w * dpr));
    pxH = Math.max(1, Math.floor(h * dpr));
    sceneRT.setSize(pxW, pxH);
    uResolution.value.set(pxW, pxH);
    uAspect.value = w / h;
  };

  /**
   * 释放 GPU 资源
   *
   * 功能：dispose 掉 RT、材质、几何与噪点贴图
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   * 注意事项：先释放材质再释放 RT，避免材质仍持有 RT 纹理引用
   */
  const dispose = () => {
    material.dispose();
    quad.geometry.dispose();
    sceneRT.dispose();
    noiseTexture.dispose();
  };

  return { sceneRT, composeScene, composeCamera, params, setParams, setSize, lensDistortionForAspect, dispose };
}
