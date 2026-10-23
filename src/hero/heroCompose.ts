/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import {
  HERO_EFFECTS,
  HERO_LOADING_EFFECTS,
  HERO_PAGES,
  HERO_SETTINGS,
  pageIndexAtScroll,
  resolvePageEffects,
  type HeroEffects,
} from './heroConfig';

/**
 * shader.se 首页合成链的 1:1 复刻（原件 `A5` 最终 pass + 场景合成 pass）
 *
 * 反编译来源（原件生产包 `04kr7kd5riobb.js` 字符偏移）：
 *  - 场景合成组件（uniforms / 逐帧赋值 / 节点图）：715,300 ~ 734,300（内部类名记为 ComposeScene）
 *  - 最终合成组件 `A5`（节点链）：707,800 ~ 715,100
 *  - 工具函数：`AH` 694,600 / `Aj`(桶形) 695,486 / `Az`(圆角 SDF) 695,900 /
 *             `AV`(四边渐隐) 695,924 / `AW`(桶形+渐隐) 696,513
 *  - `A$`(MipMapBlurNode，7 级 bloom) 696,700 / `AZ`(色散) 703,632 /
 *             `A0`(高斯) 705,236 / `A3`(运动模糊 ping-pong) 705,446
 *
 * —— 关于「uv 翻转」——
 * 原件的场景合成 pass 读各 section RT 时用 `vec2(uv.x, 1 - uv.y)`（翻转），最终 pass `A5` 读合
 * 成 RT 时用 `uv()`（不翻转）。本文件统一采用「读离屏 RT 一律翻 V」这一条规则（与本项目此前
 * 已验证可用的做法一致），差异只可能出现在最终 pass 的读取方向上 —— 该点已用离屏 RT 回读比对
 * 参考帧验证（见 `RT_READ_FLIP` 常量）。
 *
 * 本文件把 TSL 命名空间整体取成 `any`：TSL 的节点类型在 TS 下逐算子泛型化，精确标注会让这
 * 三百多行着色器逻辑崩塌为类型体操。数值与语义严格照原件 —— 这是刻意取舍，不是偷懒。
 */
const N = TSL as any;

/** mip 金字塔级数（原件 `levels: 7`） */
const MIP_LEVELS = HERO_SETTINGS.bloomLevels;
/** 上采样 RT 张数 = levels - 1（原件 up[0] 是输出，另有 levels-2 张中间） */
const UP_LEVELS = MIP_LEVELS - 1;

/**
 * 每帧运行时输入
 *
 * 说明：与原件合成组件 `useImperativeHandle` 里每帧写入的那批状态一一对应
 */
export interface HeroComposeFrame {
  /** 当前时间（秒），驱动 bloom 呼吸、噪点流动、运动模糊帧率归一化 */
  time: number;
  /** 距上一帧的秒数（原件用 `x - o.current` 做运动模糊的帧率归一化） */
  dt: number;
  /** 竖屏（原件 `isPortraitDisplay`：竖屏时场景桶形畸变换算前先减半） */
  portrait: boolean;
  /** loading 期（原件 `isReadyToRender == 0`）：用 loading 屏纹理覆盖场景色 */
  loadingActive: boolean;
  /** loading 参数渐出权重（原件 `e$ = smoothstep(0,1, 1 - initialTransition)`：
   *  1 = 完全是 loading 效果，0 = 完全是 hero 效果） */
  loadingMix: number;
  /**
   * 整条时间轴的滚动位置（单位 vh，从 hero 0 一直到 contact 22.16）
   *
   * 两件事由它驱动：
   *  - 效果参数：原件按 pagesConfig 的进入/退出区间对各页效果做加权和
   *  - 场景合成：当前页与下一页各用自己的 lens/border/saturation，
   *    在下一页 transitionLength 内交叉淡入（原件 sceneMode=2）
   */
  pageScroll: number;
  /**
   * 关闭场景合成内部的跨页交叉淡入（默认开启）
   *
   * WorkAbout 里 projects→office 的淡入由外层 fadeMat 完成，两页各自单独过合成链；
   * 若这里再混一次，office 会被重复淡入两次。
   */
  crossfade?: boolean;
  /**
   * 强制指定场景合成使用哪一页的 lens/border/saturation（默认按 pageScroll 自动取当前页）
   *
   * WorkAbout 里 projects→office 的淡入由外层 fadeMat 完成，两页各自单独过合成链；
   * 若这里再混一次，office 会被重复淡入两次。
   */
  sectionPage?: number;
  /**
   * 直接指定本帧采样的页纹理（逐页 RT 架构）
   *
   * 逐页 RT 注册表生效后，宿主先把各页场景渲进**各自的 RT**，再把纹理递进来——
   * 此时合成链跳过内部 sceneRT 渲染（scene/camera 参数被忽略），只跑场景合成 + 后期链。
   */
  curTexOverride?: THREE.Texture;
  /** 配套的下一页纹理（缺省沿用构造时的 nextTexture） */
  nextTexOverride?: THREE.Texture;
  /**
   * 转场（原件 sceneMode=2）：宿主按 `smoothstep(curEnd − nextTL, curEnd, scroll)` 算好 t，
   * type 取**下一页**的 transitionType（0 fade / 1 direct / 2 overlay / 3 below）
   *
   * 反编译原文：`u = mix(a, s, l)`；type 2 → `u = mix(a, s, s.a)`（overlay：下一页 alpha 门控）；
   * type 3 → `u = mix(s, a, a.a)`（below：当前页 alpha 门控）。
   */
  transition?: { t: number; type: number } | null;
  /**
   * 动态页表的逐页效果加权和（宿主用动态边界算好递入）
   *
   * about 以后的段边界按纸面高度动态算（原件同款公式），静态 HERO_PAGES 的权重会漂移；
   * 缺省时仍按 pageScroll 查静态 HERO_PAGES。
   */
  effects?: HeroEffects;
}

/** 合成管线句柄 */
export interface HeroComposeHandle {
  /** 场景（3D）渲染目标 —— 主渲染循环先把场景渲到这里 */
  sceneRT: THREE.RenderTarget;
  /** 按 CSS 尺寸重设全部 RT 与纹理尺寸类 uniform */
  setSize: (cssWidth: number, cssHeight: number) => void;
  /** 执行整条合成链并把最终结果上屏 */
  render: (renderer: any, scene: THREE.Object3D, camera: THREE.Camera, frame: HeroComposeFrame) => Promise<void>;
  /** 执行同一条合成链，但把结果写进离屏 RT（用于转场冻结帧） */
  renderToTarget: (
    renderer: any,
    scene: THREE.Object3D,
    camera: THREE.Camera,
    frame: HeroComposeFrame,
    target: THREE.RenderTarget
  ) => Promise<void>;
  /** 释放全部 RT / 材质 / 几何 */
  dispose: () => void;
  /**
   * 调试用中间渲染目标（只读，供自动化回读逐级像素定位问题）
   *
   * 说明：与项目其它页的 `__xxxProbe` 同款做法 —— 无副作用、不参与逻辑，仅在调试时读取
   */
  debugRTs: {
    compose: THREE.RenderTarget;
    bloom: THREE.RenderTarget;
    motionBlend: [THREE.RenderTarget, THREE.RenderTarget];
    graded: THREE.RenderTarget;
  };
  /** 调试：uniform 直读（自动化验证用） */
  __debug: { u: Record<string, any>; HERO_PAGES: typeof HERO_PAGES; resolvePageEffects: typeof resolvePageEffects };
}

/**
 * 取「基准 uv」
 *
 * 功能：把屏幕 uv 翻 V。离屏 RT 在 WebGPU 侧是逆序存放的，读纹理必须翻 V，否则整幅上下颠倒。
 *
 * 参数：
 *  - screenUv {any} TSL 的屏幕 uv 节点
 *
 * 返回值：TSL 节点，基准 uv
 *
 * 异常：无
 *
 * 注意事项：本文件所有离屏纹理采样都基于这个基准 uv，不要在别处再混用未翻转的 uv
 */
const baseUv = (screenUv: any) => N.vec2(screenUv.x, N.oneMinus(screenUv.y));

/**
 * 桶形畸变（原件 `Aj`，内含 `AH` 的径向缩放）
 *
 * 功能：按 `warp = (1 - d·n) · (p·(1 + d·|p|^1.5)) + d·n·0.5` 把 uv 向中心收拢，
 *      `n = mix(0.3655, 0, border)` —— border 越大畸变被拉回得越多
 *
 * 参数：
 *  - uvBase      {any} 基准 uv
 *  - distortion  {any} 畸变强度（原件场景合成 pass 用的是 `0.2*d+0.1` 换算后的值）
 *  - border      {any} 边框系数（原件换算为 `0.5+0.2*b`）
 *
 * 返回值：TSL 节点（vec2），畸变后的 uv
 *
 * 异常：无
 *
 * 注意事项：与原件一致，核心项是 |p| 的 1.5 次方（不是常见实现的 |p|²）
 */
const barrel = (uvBase: any, distortion: any, border: any) => {
  const n = N.mix(N.float(0.3655), N.float(0), border);
  const k = distortion.mul(n);
  const shrink = N.vec2(N.float(1).sub(k), N.float(1).sub(k));
  const shift = N.vec2(k.mul(0.5), k.mul(0.5));
  const p = uvBase.sub(0.5);
  const r2 = p.x.mul(p.x).add(p.y.mul(p.y));
  // AH(uv, 0, d) = p · (1 + d · r2^1.5) + 0.5
  const radial = N.float(1).add(distortion.mul(r2).mul(N.pow(r2, 0.5)));
  const warped = N.vec2(p.x.mul(radial), p.y.mul(radial)).add(0.5);
  return shrink.mul(warped).add(shift);
};

/**
 * 圆角矩形 SDF（原件 `Az`）
 *
 * 功能：返回点 p 到「中心在原点、半尺寸 b、圆角半径 r」的圆角矩形边界的有符号距离
 *
 * 参数：
 *  - p {any} 相对中心的坐标（vec2）
 *  - b {any} 半尺寸（vec2）
 *  - r {any} 圆角半径（标量）
 *
 * 返回值：TSL 节点（标量），内部为负、外部为正
 *
 * 异常：无
 *
 * 注意事项：原件 `AV` 用它构造四角圆角遮罩；半径是 `mix(0, 0.04, border)`
 */
const sdRoundBox = (p: any, b: any, r: any) => {
  const d = N.abs(p).sub(b).add(r);
  const dm = N.max(d, N.vec2(0, 0));
  return N.length(dm).add(N.min(N.max(d.x, d.y), N.float(0))).sub(r);
};

/**
 * 四边渐隐 + 圆角遮罩（原件 `AV`）
 *
 * 功能：输出颜色乘以一行遮罩 —— 圆角矩形内为 1，边缘按 `inset` 宽度渐隐，圆角外侧为 0。
 *      这就是参考帧里画面四角那圈「圆角暗边 + 边缘渐隐」的来源。
 *
 * 参数：
 *  - color      {any} 待遮罩的颜色（vec4）
 *  - uvBase     {any} 基准 uv（原件用的是**畸变后**的 uv，所以圆角会随畸变一起被拉伸）
 *  - border     {any} 边框系数：圆角半径 `mix(0,0.04,border)`、边宽 `mix(0,0.005,border)`
 *  - dimensions {any} 像素尺寸（vec2），用于按宽高比做各向同性圆角
 *
 * 返回值：TSL 节点（vec4），遮罩后的颜色
 *
 * 异常：无
 *
 * 注意事项：本页不做 UI 贴图合成，但这条遮罩必须保留 —— 它是画面轮廓的一部分
 */
const edgeFade = (color: any, uvBase: any, border: any, dimensions: any) => {
  const radius = N.mix(N.float(0), N.float(0.04), border);
  const aa = N.mix(N.float(0), N.float(0.005), border);
  const perimeter = N.smoothstep(aa.negate(), aa, uvBase.x)
    .mul(N.smoothstep(aa.negate(), aa, uvBase.y))
    .mul(N.smoothstep(aa.negate(), aa, N.float(1).sub(uvBase.x)))
    .mul(N.smoothstep(aa.negate(), aa, N.float(1).sub(uvBase.y)));
  const aspect = N.vec2(dimensions.x.div(dimensions.y), N.float(1));
  const sdf = sdRoundBox(uvBase.sub(0.5).mul(aspect), aspect.mul(0.5), radius);
  const mask = N.float(1).sub(N.smoothstep(aa.negate(), aa, sdf)).mul(perimeter);
  return N.vec4(color.rgb.mul(mask), color.a);
};

/**
 * 高斯核（原件 `A0`）
 *
 * 功能：`exp(-(x-mu)² / (2σ²)) / (σ√(2π))`
 *
 * 参数：
 *  - x     {any} 输入
 *  - mu    {any} 均值
 *  - sigma {any} 标准差
 *
 * 返回值：TSL 节点
 *
 * 异常：无
 *
 * 注意事项：原件噪点用 `A0(hash, 0, 0.7 * 0.7)` —— σ = 0.49
 */
const gaussian = (x: any, mu: any, sigma: any) => {
  const d = x.sub(mu);
  const norm = N.float(1).div(sigma.mul(N.float(Math.sqrt(2 * Math.PI))));
  return norm.mul(N.exp(d.mul(d).div(N.float(-2).mul(sigma.mul(sigma)))));
};

/**
 * 屏幕材质里 projectsScene 的采样（原件 `AW`）
 *
 * 功能：对映射后的屏幕 uv 做桶形畸变，落在 [0,1] 内时采样并过圆角/四边渐隐；界外为黑。
 *
 * 参数：
 *  - tex        {any} projects 场景纹理 —— **TextureNode**（可用 `.value` 换纹理）；
 *               内部用 `tex.uv(...)` 采样，与场景合成 pass 的 sampleSection 同款约定
 *  - uv         {any} 已经过屏幕 contain 映射的 uv（原件 `d`，可超出 [0,1]）
 *  - distortion {any} 畸变（原件固定 `.16 * lensDistortionFactor`）
 *  - border     {any} 边框（原件固定 `1 * lensDistortionFactor`）
 *  - dimensions {any} 视口像素尺寸（vec2，仅用宽高比）
 *
 * 返回值：TSL 节点（vec4）
 *
 * 异常：无
 *
 * 注意事项：与场景合成里的每 section 采样不同 —— 这里**不做** `l > .01` 门控，
 *          界外直接黑（原件 `AW` 原文），所以显示器边缘能看到圆角遮罩的黑边
 */
export const sampleScreenProjects = (tex: any, uv: any, distortion: any, border: any, dimensions: any) => {
  const warped = barrel(uv, distortion, border);
  const inRange = N.step(N.float(0), warped.x)
    .mul(N.step(warped.x, N.float(1)))
    .mul(N.step(N.float(0), warped.y))
    .mul(N.step(warped.y, N.float(1)));
  const sampled = edgeFade(tex.uv(warped), warped, border, dimensions);
  return N.mix(N.vec4(0, 0, 0, 0), sampled, inRange);
};

/**
 * 饱和度（原件 `ApplySaturation`）
 *
 * 功能：`mix(luminance(color), color, saturation)`，亮度权重 0.299/0.587/0.114
 *
 * 参数：
 *  - color      {any} 颜色（vec4）
 *  - saturation {any} 饱和度（1 为原样）
 *
 * 返回值：TSL 节点（vec4）
 *
 * 异常：无
 *
 * 注意事项：原件只在场景合成 pass 里对每个 section 采样后调用一次
 */
const applySaturation = (color: any, saturation: any) => {
  const lum = N.dot(color.rgb, N.vec3(0.299, 0.587, 0.114));
  return N.vec4(N.mix(N.vec3(lum), color.rgb, saturation), color.a);
};

/**
 * bloom 的亮度阈值提取（原件 `A$` 的 `preFilter`）
 *
 * 功能：按 `smoothstep(threshold, threshold + smoothing, luminance)` 给整枚颜色加权，
 *      阈值以下的像素被压掉，只有亮部参与后续 mip 模糊
 *
 * 参数：
 *  - color     {any} 颜色（vec4）
 *  - threshold {any} 阈值
 *  - smoothing {any} 平滑宽度
 *
 * 返回值：TSL 节点（vec4）
 *
 * 异常：无
 *
 * 注意事项：原件把整枚 vec4（含 alpha）都乘上权重，照抄
 */
const preFilter = (color: any, threshold: any, smoothing: any) =>
  color.mul(N.smoothstep(threshold, threshold.add(smoothing), N.dot(color.rgb, N.vec3(0.299, 0.587, 0.114))));

/**
 * 四抽盒式模糊（原件 mip 降/升采样用的 `n()`）
 *
 * 功能：在 `uv ± texel/2` 四个对角点各采一次并平均
 *
 * 参数：
 *  - tex    {any} 源纹理
 *  - uvBase {any} 基准 uv
 *  - texel  {any} 源纹理的 texel 尺寸（vec2，1/源分辨率）
 *
 * 返回值：TSL 节点（vec4）
 *
 * 异常：无
 *
 * 注意事项：偏移是对角方向的 ±half-texel，不是上下左右
 */
const blur4 = (tex: any, uvBase: any, texel: any) => {
  const o = texel.mul(0.5);
  const a = N.texture(tex, uvBase.add(N.vec2(o.x.negate(), o.y)));
  const b = N.texture(tex, uvBase.add(N.vec2(o.x, o.y)));
  const c = N.texture(tex, uvBase.add(N.vec2(o.x.negate(), o.y.negate())));
  const d = N.texture(tex, uvBase.add(N.vec2(o.x, o.y.negate())));
  return a.add(b).add(c).add(d).mul(0.25);
};

/**
 * 创建 hero 的 1:1 合成管线
 *
 * 功能：按原件两段式架构建整条链：
 *  ① 场景合成 pass：读 3D 场景 RT → 桶形畸变 + 圆角四边渐隐 + 饱和度 + loading 屏覆盖 + 暗角 → composeRT
 *  ② mip 金字塔：7 级下采样（首级带阈值提取 + 两级模拟）+ 6 级上采样（`mix(支撑层, 模糊, radius)`）
 *  ③ 泛光混合 + 运动模糊：`m = blendScreen(min(bloom·I, 1), scene) + bloom·(1,0.8,0)·0.1`，
 *     再与上一帧做 ping-pong 混合 `mix(m, prev, 1.3·Q)`
 *  ④ 调色：`pow` → sepia 矩阵 → `clamp(rgb·brightness)` → 绕 0.5 轴的 contrast
 *  ⑤ 最终 pass：纵向 RGB 色散（带边缘内缩遮罩）+ 高斯哈希噪点（乘 `1 - color`，亮部不出噪）
 *
 * 参数：
 *  - width / height {number} 初始 CSS 画布尺寸（像素）
 *  - bootCanvas     {HTMLCanvasElement | undefined} boot 覆盖屏画布；原件把 loading 屏纹理喂进合成链，
 *                   所以这张画布**同时在合成链里当 loading 屏**（不是只当显示器贴图）
 *  - projectsTexture {THREE.Texture | undefined} 第二个场景（胶片卷）的离屏 RT 纹理；
 *                   最后 0.2vh 与 hero 场景 RT 交叉淡入，穿越后成为整屏画面
 *
 * 返回值：HeroComposeHandle —— { sceneRT, setSize, render, dispose }
 *
 * 异常：无（贴图缺失时退化，不影响其余效果）
 *
 * 注意事项：
 *  - **原件是「每 section 一张 RT → 场景合成」的多 section 架构**；本页实现 hero 与 projects
 *    两个 section：各用自己的镜头参数/饱和度采样，再按 `portalBlend` 交叉淡入。
 *    其余 section（office 之后）、子页（project/not-found）分支、UI 贴图合成分支不实现。
 *  - 运动模糊用两张全分辨率 HalfFloat RT 交替（原件 `A3` 的 ping-pong）
 *  - 每帧约 18 趟全屏/半屏绘制 —— 与原件同量级
 */
export function createHeroCompose(
  width: number,
  height: number,
  bootCanvas?: HTMLCanvasElement,
  projectsTexture?: THREE.Texture
): HeroComposeHandle {
  const dpr = Math.min(window.devicePixelRatio || 1, HERO_SETTINGS.dprMax);
  let cssW = Math.max(1, width);
  let cssH = Math.max(1, height);
  let pxW = Math.max(1, Math.floor(cssW * dpr));
  let pxH = Math.max(1, Math.floor(cssH * dpr));

  // ---------- 渲染目标 ----------
  // 注意：**所有 pass RT 都必须 depthBuffer: true**，哪怕全屏 pass 根本不用深度。
  // three 0.169 的 WebGPU 后端会无条件给渲染通道挂一个 depthStencilAttachment 视图，
  // 却只在 `renderContext.depth` 为真时才写 `depthLoadOp`；depthBuffer:false 的 RT 因此
  // 通不过 Dawn 校验，整趟 CommandBuffer 被丢弃 —— 表现为「pass 静默不绘制、目标 RT 全 0」，
  // 而控制台只有一条 depthLoadOp 的 warn，极难定位（本项目实测踩过）。
  const sceneRT = new THREE.RenderTarget(pxW, pxH, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    samples: 0,
  });
  const composeRT = new THREE.RenderTarget(pxW, pxH, { type: THREE.HalfFloatType, depthBuffer: true });
  const bRT = new THREE.RenderTarget(pxW, pxH, { type: THREE.HalfFloatType, depthBuffer: true });
  /** 运动模糊 ping-pong 双缓冲（原件 `A3` 的 `_renderTarget1/2`） */
  const mbRT: [THREE.RenderTarget, THREE.RenderTarget] = [
    new THREE.RenderTarget(pxW, pxH, { type: THREE.HalfFloatType, depthBuffer: true }),
    new THREE.RenderTarget(pxW, pxH, { type: THREE.HalfFloatType, depthBuffer: true }),
  ];
  /** mip 下采样链（原件 `_downsamplingRenderTargets`，长度 = levels） */
  const downRT = Array.from({ length: MIP_LEVELS }, () =>
    new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true })
  );
  /** mip 上采样链（原件 `_upsamplingRenderTargets`，[0] 即 bloom 输出，长度 = levels - 1） */
  const upRT = Array.from({ length: UP_LEVELS }, () =>
    new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true })
  );
  const allRT = [sceneRT, composeRT, bRT, ...mbRT, ...downRT, ...upRT];

  // ---------- loading 屏纹理 ----------
  // 原件把 loading 屏的 FBO 纹理（`loadingScreenTexture`）直接拼进场景合成 pass。
  // 这里同理：boot 覆盖屏画布既当显示器贴图，也当 loading 屏纹理。
  const bootTexture = bootCanvas
    ? new THREE.CanvasTexture(bootCanvas)
    : new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  bootTexture.colorSpace = THREE.NoColorSpace;
  if (bootCanvas) bootTexture.needsUpdate = true;

  // ---------- 全屏 quad ----------
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicNodeMaterial());
  quad.frustumCulled = false;
  quadScene.add(quad);
  // 相机照原件 `nZ({... near:.1, far:100, basePosition:[0,0,1]})` 摆：**必须把相机放在 z=1**。
  // 若相机与 quad 同在 z=0 且 near=0，quad 正好落在近平面边界上，会被整趟裁掉 ——
  // 表现就是「pass 静默不绘制、目标 RT 全 0」，非常隐蔽。
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  quadCamera.position.z = 1;

  /**
   * 建一枚全屏 pass 材质
   *
   * 功能：统一关闭深度、色调映射，返回可直接挂到 quad 上的 NodeMaterial
   *
   * 参数：
   *  - name {string} 材质名（便于 WebGPU 调试面板识别）
   *
   * 返回值：THREE.MeshBasicNodeMaterial
   *
   * 异常：无
   *
   * 注意事项：与原件一致 —— 合成链全程绕过色调映射（HDR→LDR 已由链内 `pow`/clamp 完成）
   */
  const makeMat = (name: string) => {
    const m = new THREE.MeshBasicNodeMaterial();
    m.depthTest = false;
    m.depthWrite = false;
    m.toneMapped = false;
    m.name = name;
    return m;
  };

  // ---------- uniforms ----------
  const u = {
    // 场景合成 pass
    /** 当前页 / 下一页场景纹理（原件 `currentTexture` / `nextTexture`，逐帧换 value） */
    curTexture: N.texture(sceneRT.texture),
    nextTexture: N.texture(projectsTexture ?? sceneRT.texture),
    /** 当前页场景 RT → 下一页场景 RT 的交叉淡入权重（下一页 transitionLength 区间） */
    portalBlend: N.uniform(0),
    /** 下一页的转场类型（原件 nextTransitionType：0 fade / 1 direct / 2 overlay / 3 below） */
    nextTransitionType: N.uniform(0),
    /** 当前页 / 下一页各自的镜头参数（原件 sceneMode：逐页原值，不是加权和） */
    curLens: N.uniform(0),
    curBorder: N.uniform(0),
    curSaturation: N.uniform(1),
    nextLens: N.uniform(0),
    nextBorder: N.uniform(0),
    nextSaturation: N.uniform(1),
    vigRadius: N.uniform(0),
    vigSmooth: N.uniform(0.3),
    vigIntensity: N.uniform(0),
    loadingActive: N.uniform(0),
    dimensions: N.uniform(new THREE.Vector2(pxW, pxH)),
    // mip
    bloomThreshold: N.uniform(HERO_EFFECTS.bloomThreshold),
    bloomSmoothing: N.uniform(HERO_EFFECTS.bloomSmoothing),
    bloomRadius: N.uniform(HERO_EFFECTS.bloomRadius),
    bloomIntensity: N.uniform(HERO_EFFECTS.bloomIntensity),
    srcTexel: N.uniform(new THREE.Vector2(1 / pxW, 1 / pxH)),
    halfTexelCount: N.uniform(new THREE.Vector2(Math.floor(pxW / 2), Math.floor(pxH / 2))),
    maxTexelIndex: N.uniform(new THREE.Vector2(Math.max(0, Math.floor(pxW / 2) - 1), Math.max(0, Math.floor(pxH / 2) - 1))),
    /** 各 mip 级源纹理的 texel 尺寸（下标 k 对应 down[k] / up[k] 的源） */
    levelTexel: Array.from({ length: MIP_LEVELS }, () => N.uniform(new THREE.Vector2(1, 1))),
    // 运动模糊 / 调色
    motionBlur: N.uniform(0),
    pow: N.uniform(HERO_EFFECTS.pow),
    sepia: N.uniform(HERO_EFFECTS.sepiaIntensity),
    brightness: N.uniform(HERO_EFFECTS.brightness),
    contrast: N.uniform(HERO_EFFECTS.contrast),
    // 最终 pass
    chromatic: N.uniform(HERO_EFFECTS.chromaticAbberationStrength),
    aspect: N.uniform(cssW / cssH),
    noiseIntensity: N.uniform(0),
    noiseVelocity: N.uniform(HERO_EFFECTS.noiseVelocity),
    time: N.uniform(0),
  };

  // ---------- ① 场景合成 pass ----------
  const sceneComposeMat = makeMat('HeroSceneCompose');
  {
    const uvS = N.uv();
    const uvB = baseUv(uvS);

    /**
     * 采样一个 section 的 RT（原件场景合成里的 `n(texture, lensDistortion, border, saturation, uv, ...)`）
     *
     * 顺序照原件：畸变 → 越界判 → 圆角/四边渐隐（AV）→ 饱和度（ApplySaturation）。
     * 注意每个 section 用的是**自己的**镜头参数，而不是加权后的全局值。
     */
    const sampleSection = (tex: any, lens: any, border: any, saturation: any) => {
      const warped = barrel(uvB, lens, border);
      const active = N.step(N.float(0.01), lens); // 原件 `A = l > 0.01`
      const inRange = N.step(N.float(0), warped.x)
        .mul(N.step(warped.x, N.float(1)))
        .mul(N.step(N.float(0), warped.y))
        .mul(N.step(warped.y, N.float(1)));
      const raw = tex.uv(uvB);
      // 原件 AW：畸变 uv 出界时整颗输出透明黑（圆角黑边与四角切角由此而来），界内再走 AV 边遮罩
      const awColor = edgeFade(tex.uv(warped), warped, border, u.dimensions);
      const masked = N.mix(N.vec4(0, 0, 0, 0), awColor, inRange);
      return applySaturation(N.mix(raw, masked, active), saturation);
    };

    // 当前页与下一页各自采样：镜头/边框/饱和度逐页原值（原件 sceneMode=2 的 current/next）
    // 本管线最多只有两张场景纹理：sceneRT（第一场景）与 projectsTexture（第二场景）。
    // 当前页落到第二页及以后时由 writeUniforms 把 curTexture 换成 projectsTexture ——
    // 否则 HeroOneToOne 的胶片页在 scroll≥1 会突然闪回第一个场景。
    const curScene = sampleSection(u.curTexture, u.curLens, u.curBorder, u.curSaturation);
    const nextScene = sampleSection(u.nextTexture, u.nextLens, u.nextBorder, u.nextSaturation);
    // 转场类型分支（原件场景 pass 原文）：默认 smoothstep mix；overlay 用下一页 alpha 门控、
    // below 用当前页 alpha 门控。select 三路都求值（无副作用），避免 If/toVar 的 currentStack 问题。
    const isOverlay = u.nextTransitionType.equal(N.float(2));
    const isBelow = u.nextTransitionType.equal(N.float(3));
    const mixedScene = N.select(
      isOverlay,
      N.mix(curScene, nextScene, nextScene.a),
      N.select(isBelow, N.mix(nextScene, curScene, curScene.a), N.mix(curScene, nextScene, u.portalBlend))
    );
    // loading 屏覆盖（原件 `isReadyToRender == 0` 分支）：按基准 uv 直采，**不吃畸变**
    const withLoading = N.mix(mixedScene, N.texture(bootTexture, uvB), u.loadingActive);
    // 暗角：`smoothstep(-s, s, radius - length(uv - 0.5))`
    const g = u.vigRadius.sub(N.length(uvS.sub(0.5)));
    const vf = N.smoothstep(u.vigSmooth.negate(), u.vigSmooth, g);
    const vignetted = N.mix(withLoading.rgb, N.clamp(withLoading.rgb.mul(vf), 0, 1), u.vigIntensity);
    // alpha 随 portalBlend 过渡到下一页的门禁结果（0/1 硬边）：单页时保持 1 不变，
    // 出界页的门禁黑边必须是「透明黑」，后续 bloom 混合按它遮罩（见 makeBloomBlendMat）。
    // overlay/below 转场时 alpha 走类型分支的混合结果（原件 mix(a,s,s.a) 连 alpha 一起混）
    const alphaNow = N.select(
      isOverlay.or(isBelow),
      mixedScene.a,
      N.mix(N.float(1), nextScene.a, u.portalBlend)
    );
    sceneComposeMat.colorNode = N.vec4(vignetted, alphaNow);
  }

  // ---------- ② mip 金字塔 ----------
  const down0Mat = makeMat('HeroBloomDown0');
  {
    const uvS = N.uv();
    const uvB = baseUv(uvS);
    const half = u.srcTexel.mul(0.5);
    const s0 = uvB.sub(half).mul(u.halfTexelCount).sub(0.5);
    const s1 = uvB.add(half).mul(u.halfTexelCount).sub(0.5);
    const lo = N.floor(s0);
    const hi = N.floor(s1);
    const fA = s0.sub(lo);
    const fC = s1.sub(hi);
    const fD = hi.sub(lo);
    /** 3×3 抽取（原件 `h[e][i]`，e 为 y 向、i 为 x 向） */
    const rows = [0, 1, 2].map((yy) =>
      [0, 1, 2].map((xx) =>
        N.texture(
          composeRT.texture,
          N.clamp(lo.add(N.vec2(xx, yy)), N.vec2(0, 0), u.maxTexelIndex).add(0.5).div(u.halfTexelCount)
        )
      )
    );
    /** 双线性合成（原件 `g(e, t, r)`） */
    const g = (x: any, y: any, r2: any) => {
      const pick = (ti: number) => {
        const row = rows[ti];
        return N.mix(N.mix(row[0], row[1], x), N.mix(row[1], row[2], x), r2.x);
      };
      return N.mix(N.mix(pick(0), pick(1), y), N.mix(pick(1), pick(2), y), r2.y);
    };
    const tl = g(N.float(0), fD.y, N.vec2(fA.x, fC.y));
    const tr = g(fD.x, fD.y, N.vec2(fC.x, fC.y));
    const bl = g(N.float(0), N.float(0), N.vec2(fA.x, fA.y));
    const br = g(fD.x, N.float(0), N.vec2(fC.x, fA.y));
    // 原件在两级模拟之后才套阈值提取，再四路平均 —— 顺序不能换
    const filtered = preFilter(tl, u.bloomThreshold, u.bloomSmoothing)
      .add(preFilter(tr, u.bloomThreshold, u.bloomSmoothing))
      .add(preFilter(bl, u.bloomThreshold, u.bloomSmoothing))
      .add(preFilter(br, u.bloomThreshold, u.bloomSmoothing));
    down0Mat.colorNode = filtered.mul(0.25);
  }

  /** 下采样材质：k = 1..levels-1，各自读上一级；texel 用上一级的源尺寸 */
  const downMats = Array.from({ length: MIP_LEVELS - 1 }, (_, k) => {
    const m = makeMat(`HeroBloomDown${k + 1}`);
    const uvS = N.uv();
    const uvB = baseUv(uvS);
    m.colorNode = blur4(downRT[k].texture, uvB, u.levelTexel[k]);
    return m;
  });

  /** 上采样材质：k = 0..levels-2，input 为更粗一级（k=levels-2 时是 down[levels-1]），support 为 down[k] */
  const upMats = Array.from({ length: UP_LEVELS }, (_, k) => {
    const m = makeMat(`HeroBloomUp${k}`);
    const uvS = N.uv();
    const uvB = baseUv(uvS);
    const inputTex = k === UP_LEVELS - 1 ? downRT[MIP_LEVELS - 1].texture : upRT[k + 1].texture;
    const blurred = blur4(inputTex, uvB, u.levelTexel[k === UP_LEVELS - 1 ? MIP_LEVELS - 1 : k + 1]);
    m.colorNode = N.mix(N.texture(downRT[k].texture, uvB), blurred, u.bloomRadius);
    return m;
  });

  // ---------- ③ 泛光混合 + 运动模糊（ping-pong） ----------
  /**
   * 建泛光混合材质
   *
   * 功能：`m = blendScreen(min(bloom·I, 1), scene) + bloom·vec3(1,0.8,0)·0.1`，再与上一帧输出
   *      `mix(m, prev, 1.3·Q)` 做 ping-pong 累积（原件 `A3` 的 blend 材质）
   *
   * 参数：
   *  - prevTex {any} 上一帧所在的 RT 纹理
   *  - name    {string} 材质名
   *
   * 返回值：THREE.MeshBasicNodeMaterial
   *
   * 异常：无
   *
   * 注意事项：原件把 `m` 内联进 blend 材质的片元（不是先渲一张 m 的 RT），这里同样内联
   */
  const makeBloomBlendMat = (prevTex: any, name: string) => {
    const m = makeMat(name);
    const uvS = N.uv();
    const uvB = baseUv(uvS);
    const bloom = N.texture(upRT[0].texture, uvB).mul(u.bloomIntensity);
    const clamped = N.min(bloom, N.vec4(1, 1, 1, 1));
    const scene = N.texture(composeRT.texture, uvB);
    const screened = clamped.add(scene).sub(clamped.mul(scene));
    const warmed = screened.add(clamped.mul(N.vec3(1, 0.8, 0).mul(0.1)));
    // 场景 alpha 门禁（projects 页出界=0）：bloom 不得涂进门禁黑边，否则亮渐变会被
    // mip 模糊拖进黑边形成一条假「延续带」（参考图该区域是纯黑硬边）
    const masked = warmed.mul(scene.a);
    m.colorNode = N.mix(masked, N.texture(prevTex, uvB), u.motionBlur);
    return m;
  };
  const bloomBlendMatA = makeBloomBlendMat(mbRT[1].texture, 'HeroBloomBlendA'); // 读 mbRT[1] → 写 mbRT[0]
  const bloomBlendMatB = makeBloomBlendMat(mbRT[0].texture, 'HeroBloomBlendB'); // 读 mbRT[0] → 写 mbRT[1]

  // ---------- ④ 调色 ----------
  /**
   * 建调色材质
   *
   * 功能：`pow` → sepia 矩阵混合 → `clamp(rgb·brightness, 0, 1)` → 绕 0.5 轴对比度 → 写入 bRT
   *
   * 参数：
   *  - srcTex {any} 运动模糊输出纹理
   *  - name   {string} 材质名
   *
   * 返回值：THREE.MeshBasicNodeMaterial
   *
   * 异常：无
   *
   * 注意事项：contrast 是 `(c - 0.5)·k + 0.5`（**绕 0.5 轴**，不是直接乘）—— 这是与常见实现
   *          最容易出错的一处；此处必须写成 RTT pass，因为最终 pass 的色散要把调色结果当纹理采样
   */
  const makeGradeMat = (srcTex: any, name: string) => {
    const m = makeMat(name);
    const uvS = N.uv();
    const uvB = baseUv(uvS);
    const src = N.texture(srcTex, uvB);
    const powed = src.pow(N.vec4(u.pow, u.pow, u.pow, N.float(1)));
    const sepia = N.vec3(
      N.dot(powed.rgb, N.vec3(0.393, 0.769, 0.189)),
      N.dot(powed.rgb, N.vec3(0.349, 0.686, 0.168)),
      N.dot(powed.rgb, N.vec3(0.272, 0.534, 0.131))
    );
    const mixed = N.mix(powed.rgb, sepia, u.sepia);
    const bright = N.clamp(mixed.mul(u.brightness), 0, 1);
    const contrasted = N.clamp(bright.sub(0.5).mul(u.contrast).add(0.5), 0, 1);
    // alpha 原样透传（上游是场景 pass 的门禁结果），不能强制 1 —— 否则 bloom 遮罩失效
    m.colorNode = N.vec4(contrasted, powed.a);
    return m;
  };
  const gradeMatA = makeGradeMat(mbRT[0].texture, 'HeroGradeA'); // A 帧写 mbRT[0] → 读 mbRT[0]
  const gradeMatB = makeGradeMat(mbRT[1].texture, 'HeroGradeB'); // B 帧写 mbRT[1] → 读 mbRT[1]

  // ---------- ⑤ 最终 pass：色散 + 噪点 ----------
  const finalMat = makeMat('HeroFinal');
  {
    const uvS = N.uv();
    const uvB = baseUv(uvS);
    // 色散：偏移 `a = 0.001 · (radial·2) · strength`，R 向 -a、G 居中、B 向 +a
    const aspectVec = N.vec2(u.aspect, N.float(1)).div(N.max(u.aspect, N.float(1)));
    const radial = N.length(uvB.sub(0.5).mul(aspectVec).mul(2));
    const offset = N.float(HERO_SETTINGS.chromaticScale).mul(radial.mul(2)).mul(u.chromatic);
    const ca = N.vec4(
      N.texture(bRT.texture, uvB.add(N.vec2(0, offset.negate()))).r,
      N.texture(bRT.texture, uvB).g,
      N.texture(bRT.texture, uvB.add(N.vec2(0, offset))).b,
      N.texture(bRT.texture, uvB).a
    );
    // 边缘内缩：色散只在画面内圈生效（原件 `p = 0.005`）
    const inset = N.float(HERO_SETTINGS.edgeInset);
    const mx = N.min(N.smoothstep(N.float(0), inset, uvS.x), N.smoothstep(N.float(0), inset, N.float(1).sub(uvS.x)));
    const my = N.min(N.smoothstep(N.float(0), inset, uvS.y), N.smoothstep(N.float(0), inset, N.float(1).sub(uvS.y)));
    const colored = N.mix(N.texture(bRT.texture, uvB), ca, mx.mul(my));
    // 噪点：哈希 → 高斯核 → 乘以 (1 - color)，即亮部不出噪、暗部出噪（原件写法）
    const hash = N.fract(
      N.sin(N.dot(uvS, N.vec2(12.9898, 78.233))).mul(43758.5453).add(u.time.mul(u.noiseVelocity))
    );
    const grain = N.vec3(gaussian(hash, N.float(0), N.float(HERO_SETTINGS.noiseGaussianSigma))).mul(
      N.vec3(1, 1, 1).sub(colored.rgb)
    );
    finalMat.colorNode = N.vec4(colored.rgb.add(grain.mul(u.noiseIntensity)), colored.a);
  }

  // ---------- 内部状态 ----------
  /** 运动模糊 ping-pong 奇偶（偶数帧写 mbRT[0]） */
  let parity = 0;
  /** 上次尺寸（避免每帧重算 mip 尺寸） */
  let lastPxW = pxW;
  let lastPxH = pxH;

  /**
   * 按当前像素尺寸重算全部 RT 与 texel 类 uniform
   *
   * 功能：等价原件 `A$.setSize` —— 逐级 `round(0.5 * size)` 得到 mip 各级尺寸；
   *      up[k] 与 down[k] 同尺寸；再刷新所有 texel uniform
   *
   * 参数：无（读模块内的 pxW / pxH）
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：mip 尺寸用「逐级取半再取整」而非一次算幂，与原件完全一致（避免累积偏差）
   */
  const applySizes = () => {
    sceneRT.setSize(pxW, pxH);
    composeRT.setSize(pxW, pxH);
    bRT.setSize(pxW, pxH);
    mbRT[0].setSize(pxW, pxH);
    mbRT[1].setSize(pxW, pxH);

    let w = pxW;
    let h = pxH;
    for (let k = 0; k < MIP_LEVELS; k++) {
      w = Math.round(0.5 * w);
      h = Math.round(0.5 * h);
      downRT[k].setSize(w, h);
      if (k < UP_LEVELS) upRT[k].setSize(w, h);
      // levelTexel[k] = down[k] 的 texel 尺寸。用它的地方有三处，均已核对：
      //  - downMats[k] 读 down[k]（k = 0..5）
      //  - upMats[k]  输入读 up[k+1]，与 down[k+1] 同尺寸（k = 0..4）
      //  - upMats[last] 输入读 down[last]（k = 6）
      u.levelTexel[k].value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
    }
    // down0 的 9 抽两级模拟以「源（合成 RT）」尺寸为基准
    u.srcTexel.value.set(1 / pxW, 1 / pxH);
    u.halfTexelCount.value.set(Math.floor(pxW / 2), Math.floor(pxH / 2));
    u.maxTexelIndex.value.set(Math.max(0, Math.floor(pxW / 2) - 1), Math.max(0, Math.floor(pxH / 2) - 1));
    u.dimensions.value.set(pxW, pxH);
    lastPxW = pxW;
    lastPxH = pxH;
  };
  applySizes();

  /**
   * 把效果表的静态项写进 uniforms（含 loading 期与 hero 期的混合）
   *
   * 功能：按 `loadingMix` 的 smoothstep 权重在 loading / hero 两套效果之间插值，并完成原件的
   *      换算：场景畸变 `0.2·d+0.1`（竖屏再减半）、边框 `0.5+0.2·b`、单帧 bloom 强度
   *      `1.5·I + R + boost`、运动模糊 `1.3·Q`、噪点 `0.037·N·dprFactor`
   *
   * 参数：
   *  - frame {HeroComposeFrame} 每帧输入
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：bloom 的三频呼吸调制与运动模糊的帧率归一化都是**逐帧推导量**，必须每帧重算
   */
  const writeUniforms = (frame: HeroComposeFrame) => {
    const { time, dt, loadingMix, loadingActive, pageScroll } = frame;
    // 原件：`e$ = eg*eg*(3-2*eg)`，eg = 1 - initialTransition
    const mixT = loadingMix <= 0 ? 0 : loadingMix >= 1 ? 1 : loadingMix * loadingMix * (3 - 2 * loadingMix);
    const L = HERO_LOADING_EFFECTS;
    // 原件逐页权重 → 加权和；loading 期再按 smoothstep(1 - initialTransition) 混回 loading 表。
    // about 以后的段边界按纸面高度动态算，宿主会用动态页表算好 effects 递入
    const pageEffects = frame.effects ?? resolvePageEffects(pageScroll);
    /** 原件 `e = e*(1-e$) + loading*e$` */
    const eff = (k: keyof HeroEffects) => pageEffects[k] + (L[k] - pageEffects[k]) * mixT;

    // ---- 场景合成 pass：当前页 → 下一页（原件 sceneMode） ----
    // sectionPage：宿主强制当前页（逐页 RT 架构）；curTexOverride/nextTexOverride：
    // 页 RT 纹理由宿主直接递入；transition：宿主算好的 { t, type }。
    const forced = frame.sectionPage;
    const idx = forced ?? pageIndexAtScroll(pageScroll);
    const cur = HERO_PAGES[Math.min(HERO_PAGES.length - 1, Math.max(0, idx))];
    const useOverride = frame.curTexOverride !== undefined;
    const next = useOverride
      ? HERO_PAGES[idx + 1]
      : forced === undefined
        ? HERO_PAGES[idx + 1]
        : undefined;
    u.curTexture.value =
      frame.curTexOverride ??
      (forced !== undefined || idx < 1 || !projectsTexture ? sceneRT.texture : projectsTexture);
    if (frame.nextTexOverride) u.nextTexture.value = frame.nextTexOverride;
    u.curLens.value = cur.effects.lensDistortion;
    u.curBorder.value = cur.effects.lensDistortionBorders;
    u.curSaturation.value = cur.effects.saturation;
    let portal = 0;
    let transType = 0;
    if (frame.transition) {
      portal = frame.transition.t;
      transType = frame.transition.type;
    } else if (next && frame.crossfade !== false && !useOverride) {
      // 内置公式只服务旧的内部 sceneRT 路径；override 模式下转场完全由宿主给出
      const r = next.transitionLength;
      if (r > 0) {
        const ft = Math.min(1, Math.max(0, (pageScroll - (cur.end - r)) / r));
        portal = ft * ft * (3 - 2 * ft);
      }
    }
    const nfx = next ? next.effects : cur.effects;
    u.nextLens.value = nfx.lensDistortion;
    u.nextBorder.value = nfx.lensDistortionBorders;
    u.nextSaturation.value = nfx.saturation;
    u.portalBlend.value = portal;
    u.nextTransitionType.value = transType;
    u.vigRadius.value = eff('vignetteRadius');
    u.vigSmooth.value = eff('vignetteSmoothness');
    u.vigIntensity.value = eff('vignetteIntensity');
    u.loadingActive.value = loadingActive ? 1 : 0;

    // ---- bloom ----
    u.bloomThreshold.value = eff('bloomThreshold');
    u.bloomSmoothing.value = eff('bloomSmoothing');
    u.bloomRadius.value = eff('bloomRadius');
    const breath =
      (Math.sin(5.3 * time * 0.5) +
        Math.sin(11.7 * time * 0.5 + 2.4 * Math.sin(2.1 * time * 0.5) * 0.5) +
        Math.sin(23.9 * time * 0.5 + 1.3 * Math.cos(7.1 * time * 0.5) * 0.5)) *
      HERO_SETTINGS.bloomBreathAmp *
      eff('bloomIntensity');
    u.bloomIntensity.value =
      HERO_SETTINGS.bloomIntensityBase * eff('bloomIntensity') + breath + HERO_SETTINGS.bloomBoost;

    // ---- 运动模糊（原件 A5 的逐帧归一化） ----
    // 关键：原件每帧都**从配置值重新播种** `Q`（`let Q = m; Q *= ...`），它不是跨帧累积的衰减器。
    // 若写成跨帧累积（每帧再乘一次 (1/120)/dt），强度会指数衰减到 0，且帧长一抖动画面就忽明忽暗
    // —— 这正是「奇怪闪烁」的来源，照原件必须每帧重播种。
    let q = eff('motionBlur');
    const frameNorm = 1 / 120;
    q = dt > frameNorm ? q * (frameNorm / dt) : Math.pow(q, dt / frameNorm);
    u.motionBlur.value = HERO_SETTINGS.motionBlurGain * q;

    // ---- 调色 ----
    u.pow.value = eff('pow');
    u.sepia.value = eff('sepiaIntensity');
    u.brightness.value = eff('brightness');
    u.contrast.value = eff('contrast');

    // ---- 最终 pass ----
    u.chromatic.value = eff('chromaticAbberationStrength');
    const dpr0 = window.devicePixelRatio;
    const dprFactor = dpr0 === 2 || dpr0 === 3 ? 1 : dpr0 === 1 ? 0.7 : 0;
    u.noiseIntensity.value = HERO_SETTINGS.noiseAmp * eff('noiseIntensity') * dprFactor * HERO_SETTINGS.noiseFactor;
    u.noiseVelocity.value = eff('noiseVelocity');
    u.time.value = time;
  };

  /**
   * 执行整条合成链并把最终结果上屏
   *
   * 功能：按 ①→⑤ 顺序逐趟绘制；运动模糊用 ping-pong 交替、调色 pass 按奇偶读对应 RT
   *
   * 参数：
   *  - renderer {any} WebGPURenderer（需要 renderAsync 才能等 GPU 端完成）
   *  - scene    {THREE.Object3D} 3D 场景
   *  - camera   {THREE.Camera} 场景相机
   *  - frame    {HeroComposeFrame} 每帧输入
   *
   * 返回值：Promise<void>
   *
   * 异常：无（单趟失败会向上抛给主循环的兜底，主循环会退化为直渲）
   *
   * 注意事项：
   *  - 全屏 pass 期间 `autoClear = false`（每趟 quad 都写满整屏，无需清屏，可省带宽）
   *  - boot 画布纹理每帧要标 `needsUpdate`，否则 WebGPU 侧读到的是旧帧
   */
  const renderInner = async (
    renderer: any,
    scene: THREE.Object3D,
    camera: THREE.Camera,
    frame: HeroComposeFrame,
    target: THREE.RenderTarget | null
  ) => {
    if (pxW !== lastPxW || pxH !== lastPxH) applySizes();
    writeUniforms(frame);
    if (bootCanvas) bootTexture.needsUpdate = true;

    // ① 3D 场景 → sceneRT（override 模式跳过：页 RT 已由宿主渲染）
    if (frame.curTexOverride === undefined) {
      renderer.setRenderTarget(sceneRT);
      await renderer.renderAsync(scene, camera);
    }

    // 注意：**不要**关 autoClear。three 0.169 的 WebGPU 后端在 `autoClear === false` 时不会给
    // 渲染通道写 depthLoadOp，Dawn 校验会直接判这个 CommandBuffer 非法并整个丢弃
    // （表现为画面若干趟静默不执行）。代价是每帧多几次清屏，带宽换正确性，值得。

    // ② 场景合成 → composeRT
    quad.material = sceneComposeMat;
    renderer.setRenderTarget(composeRT);
    await renderer.renderAsync(quadScene, quadCamera);

    // ③ mip 下采样
    quad.material = down0Mat;
    renderer.setRenderTarget(downRT[0]);
    await renderer.renderAsync(quadScene, quadCamera);
    for (let k = 0; k < downMats.length; k++) {
      quad.material = downMats[k];
      renderer.setRenderTarget(downRT[k + 1]);
      await renderer.renderAsync(quadScene, quadCamera);
    }

    // ④ mip 上采样（从最粗一级回到 up[0]，up[0] 即 bloom 输出）
    for (let k = UP_LEVELS - 1; k >= 0; k--) {
      quad.material = upMats[k];
      renderer.setRenderTarget(upRT[k]);
      await renderer.renderAsync(quadScene, quadCamera);
    }

    // ⑤ 泛光混合 + 运动模糊（偶数帧：读 mbRT[1] 写 mbRT[0]）
    const writeIdx = parity === 0 ? 0 : 1;
    quad.material = parity === 0 ? bloomBlendMatA : bloomBlendMatB;
    renderer.setRenderTarget(mbRT[writeIdx]);
    await renderer.renderAsync(quadScene, quadCamera);

    // ⑥ 调色 → bRT
    quad.material = parity === 0 ? gradeMatA : gradeMatB;
    renderer.setRenderTarget(bRT);
    await renderer.renderAsync(quadScene, quadCamera);

    // ⑦ 色散 + 噪点 → 屏幕（或离屏目标）
    quad.material = finalMat;
    renderer.setRenderTarget(target);
    await renderer.renderAsync(quadScene, quadCamera);

    parity = writeIdx === 0 ? 1 : 0;
  };

  const render = (renderer: any, scene: THREE.Object3D, camera: THREE.Camera, frame: HeroComposeFrame) =>
    renderInner(renderer, scene, camera, frame, null);

  const renderToTarget = (
    renderer: any,
    scene: THREE.Object3D,
    camera: THREE.Camera,
    frame: HeroComposeFrame,
    target: THREE.RenderTarget
  ) => renderInner(renderer, scene, camera, frame, target);

  /**
   * 适配画布尺寸
   *
   * 功能：按新的 CSS 尺寸 × dpr 重算像素尺寸，并在下一帧重新分配全部 RT（避免拖动窗口时每帧重建）
   *
   * 参数：
   *  - w / h {number} 新的 CSS 宽高
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：dpr 上限 1.5（与原件 `dpr: [1, 1.5]` 一致）
   */
  const setSize = (w: number, h: number) => {
    cssW = Math.max(1, w);
    cssH = Math.max(1, h);
    pxW = Math.max(1, Math.floor(cssW * dpr));
    pxH = Math.max(1, Math.floor(cssH * dpr));
    u.aspect.value = cssW / cssH;
    applySizes();
  };

  /**
   * 释放 GPU 资源
   *
   * 功能：dispose 掉全部 RT、材质、几何与 loading 纹理
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   * 注意事项：先放材质再放 RT，避免材质仍持有 RT 纹理引用
   */
  const dispose = () => {
    quad.geometry.dispose();
    quad.material.dispose();
    [
      sceneComposeMat,
      down0Mat,
      ...downMats,
      ...upMats,
      bloomBlendMatA,
      bloomBlendMatB,
      gradeMatA,
      gradeMatB,
      finalMat,
    ].forEach((m) => m.dispose());
    allRT.forEach((rt) => rt.dispose());
    bootTexture.dispose();
  };

  return {
    sceneRT,
    setSize,
    render,
    renderToTarget,
    dispose,
    debugRTs: {
      // getter：applySizes 会重建 RT，快照会拿到已释放的旧目标 —— 必须每次取当前引用
      get compose() {
        return composeRT;
      },
      get bloom() {
        return upRT[0];
      },
      get motionBlend() {
        return mbRT;
      },
      get graded() {
        return bRT;
      },
    },
    /** 调试：运行时 uniform 直读（自动化验证用，与 debugRTs 同款无副作用） */
    __debug: { u, HERO_PAGES, resolvePageEffects },
  };
}
