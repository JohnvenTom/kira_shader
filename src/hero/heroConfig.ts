/**
 * shader.se 首页 hero 场景的复刻常量
 *
 * 来源：对 shader.se 生产包静态反编译（04kr7kd5riobb.js 中的 `pC` / `cC` / `pp` / `pu` / `cS` / `pA` / `pX` 等组件）
 * 说明：除特别标注外，所有数值均为原件实测值，不是估计值。
 */

/** 相机基础参数（原件 `pC` 内 v.current / b.current / nZ 的 perspective 配置） */
export const HERO_CAMERA = {
  /** 基础机位（世界坐标）—— 原件 keep 的 `v.current = new Vector3(0, 0.2, 4.5)` */
  basePosition: [0, 0.2, 4.5] as [number, number, number],
  /** 基础注视点 —— 原件 `b.current = new Vector3(0, 0, 0)` */
  baseLookAt: [0, 0, 0] as [number, number, number],
  /** 场景相机视角 —— 原件反解取景距离时用 `Math.PI / 180 * 50` */
  fov: 50,
  near: 0.1,
  far: 100,
  /**
   * 推进终点取景系数
   * 原件用屏幕 mesh 的世界尺寸与 fov 反解「刚好框住屏幕」的距离，再乘 0.9
   * （`e = (a < i / n ? n / 2 / tan(r / 2) : i / 2 / (tan(r / 2) * a)) * 0.9`）
   */
  framingFactor: 0.9,
} as const;

/** 滚动推进与入场缓动 */
export const HERO_SCROLL = {
  /** 推进进度归一化区间：原件 `u = min(max(n / 0.15, 0), 1)` 用的是 0.15，但主缓动用 `s / 0.8` */
  pushRange: 0.8,
  /** 主缓动指数：原件 `u = 1 - (1 - u) ** 1.4` */
  easeOutPower: 1.4,
  /** hero 文字显隐阈值：原件 `s <= 0.1 ? 显示 : 隐藏` */
  textHideThreshold: 0.1,
  /** 鼠标视差总幅度（世界单位）：原件 `w().x * 0.3 * (1 - u)` */
  parallaxAmount: 0.3,
} as const;

/**
 * 入场过渡（原件 pagesStore + pC 的实测行为，逐条反编译所得）
 *
 * 原件（`04kr7kd5riobb.js`）的真相：
 *  - **没有独立的入场曲线**。相机全程只有一条路径 —— 滚动推入，进度取
 *      `s = max(-1, scroll + (initialTransitionDone ? 0 : 1 − initialTransition))`
 *      `u = 1 − (1 − clamp(s / 0.8, 0, 1)) ^ 1.4`
 *      `相机位 = lerp(基础机位 (0,0.2,4.5), 屏幕特写位, u)`
 *      `注视点 = lerp(原点 (0,0,0), 屏幕世界中心, u)`
 *      入场期把 `s` 从 1 反向拉到 0（等价于"滚退"），用的是与滚轮完全相同的那条插值。
 *  - `initialTransition` 是 spring：`stiffness 30 / damping 8`，由 `setTimeout(…, 500)` 延迟启动
 *    （原件 pagesStore：`animate(initialTransition, 1, {damping:8, stiffness:30, type:"spring"})`）。
 *    本项目 bootStore 的 countdown(500ms) + reveal(spring 30/8) 正是这段编排，故此处不重复定义。
 *  - boot 屏是**切掉**而非渐隐：原件合成着色器仅在 `isReadyToRender == 0` 时用 loading 屏
 *    覆盖画面，而初始页类型映射 `{main: 0}` 不命中第二条覆盖分支 —— 于是资产一就绪 boot 立刻消失，
 *    此刻相机正停在屏幕特写位，**boot 面板与显示器重合**，随后弹簧才把镜头拉远。
 *  - 弹簧收敛（initialTransitionDone）之前滚动被锁（原件 Lenis `stop()`）。
 *
 * 注意：下面三个常数仅作反编译留档 —— 运行期实际由 bootStore 携带（弹簧参数一致）。
 */
export const HERO_INTRO = {
  /** 过渡弹簧刚度（原件 `stiffness: 30`） */
  springStiffness: 30,
  /** 过渡弹簧阻尼（原件 `damping: 8`） */
  springDamping: 8,
  /** 弹簧启动延迟（原件 `setTimeout(…, 500)` 毫秒） */
  delayMs: 500,
} as const;

/**
 * 前景烟层（原件里唯一真正承担「雾」职责的东西）
 *
 * 原件 `pC` 里的调用（照抄）：
 *   <group position={[0, -0.2, 2]}>
 *     <Smoke density={30} enableRotation rotation={[0,0,0.2]}
 *            size={[2,2,2]} color="white" opacity={0.04}
 *            minBounds={[-2,-0.5,-1.5]} maxBounds={[2,1.5,1.5]} />
 *   </group>
 */
export const HERO_SMOKE = {
  /** 片数 */
  count: 30,
  /** 单张平面边长（世界单位），对应 `size: [2,2,2]` 里的 x/y */
  planeSize: 2,
  /** 单层不透明度 —— 关键：0.04，靠 30 层叠加而不是单层浓度 */
  opacity: 0.04,
  /** 颜色（纯白：白烟板 × 低 alpha = 冷灰蓝的错觉） */
  color: '#ffffff',
  /** 所在 group 的世界位置 —— z=+2 表示挡在电脑与相机之间 */
  groupPosition: [0, -0.2, 2] as [number, number, number],
  /** 分布盒下界（对应 minBounds） */
  minBounds: [-2, -0.5, -1.5] as [number, number, number],
  /** 分布盒上界（对应 maxBounds） */
  maxBounds: [2, 1.5, 1.5] as [number, number, number],
  /** 每帧自转角速度（弧度/秒），原件 `rotation: [0,0,0.2]` 且更新为 `rot += rotation * dt` */
  rotationSpeed: [0, 0, 0.2] as [number, number, number],
  /** 贴图路径（原件 `/textures/smoke.webp`，已本地化） */
  textureUrl: '/asset/hero/textures/smoke.webp',
} as const;

/**
 * 整机（原件 `pu` 组件的变换，实测值，**必须原样照搬**）
 *
 * 关键认识：本页加载的就是原件那份 `/models/computer.glb`（78,300 字节，逐字节一致），
 * 所以原件这组世界变换直接适用，**不需要**再做「包围盒归一化」——
 * 归一化是上一版最大的偏差来源（它把整机挪到了原点并把尺寸改成了 4）。
 *
 * 模型自然尺寸（从 GLB accessor min/max + 节点变换算出，纯数学、无需 GPU）：
 *  - computer   26.395 × 15.405 × 26.685
 *  - keyboard   14.309 × 1.179  × 12.583
 *  - logo       11.584 × 1.100  × 10.119
 *  - background 346.530 × 100.682 × 125.409（影棚背景板，不参与整机尺寸认知）
 * 经 scale 0.14 后：显示器约 3.70 × 2.16 × 3.74 世界单位，中心约 (1.91, -0.31, -0.28)。
 */
export const HERO_MODEL = {
  /** 整机 group 的世界位置（原件 `position: [-1.1, -1.4, 0]`） */
  groupPosition: [-1.1, -1.4, 0] as [number, number, number],
  /** 整机 group 的缩放（原件 `scale: 0.14`） */
  groupScale: 0.14,
  /** 整机 group 绕 Y 的旋转（原件 `rotation-y: Math.PI`，即把模型转过来面向相机） */
  groupRotY: Math.PI,
} as const;

/**
 * 屏幕平面（原件 `pl` 组件的变换，实测值）
 *
 * 结构（照抄原件）：屏幕平面是**单位平面 × 缩放**，且挂在一个中间 group 里，
 * 该中间 group 又挂在整机 group 里 —— 所以世界变换由三层叠加而来，
 * 本页直接按同样层级摆放，不手算世界坐标：
 *   modelGroup(scale .14, rotY π, pos [-1.1,-1.4,0])
 *     └ screenGroup(pos [-22,11,2], rotY π-0.735)
 *         └ screenMesh(pos [-0.2,-0.55,0.1], rotX -0.07, scale [10.15,7.875,1], geometry 1×1)
 *
 * 由此得到的屏幕世界尺寸 = 10.15×0.14 = 1.421 宽、7.875×0.14 = 1.1025 高（宽高比 1.289，
 * 与 `planeAspect 4.06×3.15` 一致），世界中心约 (1.950, 0.063, -0.289)。
 */
export const HERO_SCREEN_PLANE = {
  groupPosition: [-22, 11, 2] as [number, number, number],
  groupRotY: Math.PI - 0.735,
  meshPosition: [-0.2, -0.55, 0.1] as [number, number, number],
  meshRotX: -0.07,
  meshScale: [10.15, 7.875, 1] as [number, number, number],
  /** 屏幕贴图亮度增益（原件 `texture(reelTexture, uv()).rgb.mul(4).min(1)`） */
  reelBoost: 4,
  /** boot 画面 → 视频的切换区间（原件 `smoothstep(0.05, 0.55, progress)`） */
  bootMixRange: [0.05, 0.55] as [number, number],
} as const;

/**
 * 屏幕投射灯（原件 `po` 组件，实测值）
 *
 * 作用：一盏带 gobo 的聚光灯从右后方投向屏幕前方，让屏幕的光真的「洒」进场景。
 * 灯本身挂在 (2.2,-1,-1) 的 group 里，目标点在 group 局部 (-3.6,1,5)。
 *
 * 强度原件是逐帧动画的：`intensity = 5 + (0.6·sin(10t) + 0.25·sin(23t) + 0.15·sin(47t))`
 */
export const HERO_PROJECTOR = {
  groupPosition: [2.2, -1, -1] as [number, number, number],
  targetLocal: [-3.6, 1, 5] as [number, number, number],
  /** 基础强度（原件静态 8，动画时用 baseIntensity + 抖动） */
  intensity: 8,
  baseIntensity: 5,
  animAmplitudes: [0.6, 0.25, 0.15] as [number, number, number],
  animFrequencies: [10, 23, 47] as [number, number, number],
  distance: 20,
  /** 原件 `decay: 0` —— 无距离衰减 */
  decay: 0,
  /** 原件写的是 `angle: 20`；three 的 angle 是弧度，这里按「原件单位是度」换算 */
  angleDeg: 20,
  penumbra: 0.4,
  /**
   * 解析式溅射的半锥角（°）
   *
   * 说明：three 0.169 的 WebGPU 构建未实现 `SpotLight.map`（gobo 投影）——
   *      已核实 `build/three.webgpu.js` 里 `spotLightMap` 出现 0 次，而 WebGL 后端有。
   *      原件因为 three 版本更新、后端支持该特性，才能看到「图案在动的溢出」。
   *      本页因此改为在材质上做解析式投影采样（见 heroSpill.ts）。
   *      这里把原件的 `angle: 20` 解释为「圆锥全角」，半角取 10°。
   */
  halfAngleDeg: 10,
  /**
   * 解析式溅射强度
   *
   * 注意事项：**该值不是原件实测值**，是自定系数 —— 原件那一项由 spotLight.map 承担、
   *          本页无法照搬其内部标度，故给一个保守初值，需按观感校准。
   */
  spillStrength: 0.35,
} as const;

/** 补光（原件 `pC` 里的 ambientLight） */
export const HERO_AMBIENT = {
  intensity: 1.8,
  color: '#ffffff',
} as const;

/**
 * 环境灯架（原件 `pA` 组件 + `<Environment background={false} blur={0.8} resolution={1024}>`）
 *
 * `intensity` 为原件的原始值；原件还会整体乘一个 F = 0.4 × lightsIntensity（首页 lightsIntensity = 1）
 */
export const HERO_ENV = {
  /** 环境贴图分辨率（原件 `<Environment resolution={1024}>`） */
  resolution: 1024,
  /** 环境模糊（原件 `blur={0.8}`，走 PMREM 预过滤） */
  blur: 0.8,
  /** 灯架整体强度系数（原件 F = 0.4 * lightsIntensity，lightsIntensity=1） */
  rigScale: 0.4,
  /**
   * 灯位表（逐条对应原件 `pA`，坐标/缩放/颜色/强度均为实测值）
   *  - circle 组：8 个白色圆盘构成顶部灯带（原件用 `[2,0,2,0,2,0,2,0].map(v => 10*v)` 生成 x）
   */
  lights: [
    { form: 'rect', color: '#ffffff', intensity: 5, position: [0, 10, -20], rotation: [Math.PI / 2, 0, 0], scale: [10, 2, 1] },
    ...Array.from({ length: 8 }, (_, i) => ({
      form: 'circle' as const,
      color: '#ffffff',
      intensity: 5,
      position: [(i % 2 === 0 ? 20 : 0), 10, i * 4] as [number, number, number],
      rotation: [Math.PI / 2, 0, 0] as [number, number, number],
      scale: [6, 2, 2] as [number, number, number],
    })),
    { form: 'rect', color: '#0000ff', intensity: 4, position: [-5, 1, -1], rotation: [0, Math.PI / 2, 0], scale: [20, 0.1, 1] },
    { form: 'ring', color: '#334455', intensity: 50, position: [-15, 40, -18], rotation: [0, 0, 0], scale: [100, 100, 100] },
    { form: 'ring', color: '#774520', intensity: 20, position: [-24, 15, -26], rotation: [0, 0, 0], scale: [100, 100, 100] },
    { form: 'ring', color: '#aaaaaa', intensity: 1.5, position: [-10, 10, -20], rotation: [0, 0, 0], scale: [50, 50, 50] },
    { form: 'ring', color: '#ffffff', intensity: 0.75, position: [0, 20, -20], rotation: [0, 0, 0], scale: [50, 50, 50] },
  ],
} as const;

/**
 * 屏幕（原件 `pu` 里的屏幕平面 + 视频纹理）
 *
 * 注意：屏幕平面不是模型的一部分，是代码另加的 mesh；原件用 `screenMeshRef` 指向的
 * 模型节点世界变换来反解机位，所以屏幕位置由模型驱动，不是硬编码世界坐标。
 */
export const HERO_SCREEN = {
  /** 屏幕平面宽高比（原件 `planeAspect: new Vector2(4.06, 3.15)`） */
  planeAspect: [4.06, 3.15] as [number, number],
  /** 视频纹理宽高比（原件 `reelTextureAspect: new Vector2(1026, 770)`） */
  reelAspect: [1026, 770] as [number, number],
  /** 平面宽度（世界单位）—— 原件按屏幕节点的世界缩放推算，此处给一个可调基准值 */
  planeWidth: 2.2,
  /** 视频路径（本地循环片；原件是两条 Mux HLS 流，主 + 从属做光溢出） */
  videoUrl: '/asset/hero/showreel_loop.mp4',
} as const;

/** 模型与贴图（原件路径已本地化到 public/asset/hero/） */
export const HERO_ASSETS = {
  modelUrl: '/asset/hero/models/computer.glb',
  /** Draco 解码器目录（沿用项目已有的本地 vendor 目录） */
  dracoDecoderPath: '/asset/vendor/draco/',
  /** 机身污渍（原件 `cloudTexture = /textures/dirt.jpg`，RepeatWrapping） */
  dirtUrl: '/asset/hero/textures/dirt.jpg',
  /** 机身材质磨损（原件 `grungeTexture = /textures/grunge.webp`，RepeatWrapping） */
  grungeUrl: '/asset/hero/textures/grunge.webp',
  /** 合成 pass 的颗粒噪点图（原件 `/textures/rgba_noise.png`，96×96） */
  noiseUrl: '/asset/hero/textures/rgba_noise.png',
  /** boot 屏底图（原件 720×400 / 移动端 360×260） */
  bootScreenUrl: '/asset/hero/textures/boot_screen.png',
  bootScreenMobileUrl: '/asset/hero/textures/boot_screen_mobile.png',
} as const;

/**
 * boot 屏（原件 `pT` 组件）
 *
 * 原件在着色器里画：4px 粗白外框 + 内部 21 段进度条（每段 10px + 4px 间隙），
 * 并按分辨率做桶形畸变（`resolution.x > 1024` 时启用，畸变系数 0.2）。
 * 底图 720×400，contain 进显示器；移动端 360×260。
 */
export const HERO_BOOT = {
  /** 虚拟分辨率（原件 `pX` 里的 `vec2(720, 400)` / 窄屏 `vec2(360, 260)`） */
  virtualSize: [720, 400] as [number, number],
  /** 进度条段数（原件 `float(21)`） */
  segments: 21,
  /** 每段宽度（原件 `float(10)`） */
  segmentWidth: 10,
  /** 段间隙（原件 `float(4)`） */
  segmentGap: 4,
  /** 外框粗细（原件 `float(4)`） */
  borderWidth: 4,
  /** 进度条距中心的下移量（原件 `C.y -= f.y * 0.18`） */
  barOffsetY: -0.18,
  /** 进度条整体宽度（原件 `vec2(298, 30)`，窄屏乘 1） */
  barSize: [298, 30] as [number, number],
  /** 桶形畸变强度（原件 `float(0.2)`，仅 `resolution.x > 1024` 时启用） */
  barrel: 0.2,
} as const;

/**
 * 24 片百叶标题幕（原件 `pp` 组件）
 *
 * 结构：`BoxGeometry(s, o, s, 12, segments, 12)` 的四个侧面保留、UV 重排成四段，
 * 每段（片）用弹簧从 ±90° 转到 0，拼出标题。弹簧参数（原件实测，按片号线性插值）：
 *  - 窄屏（宽 ≤ 1024，原件的默认分支）：stiffness 130→100，damping 14→18
 *  - 宽屏（宽 > 1024，原件写在 `i>1024` 分支上）：stiffness 96→54，damping 13.5→18
 *  - show 时目标角 0；hide 时宽屏 -π/2 / 窄屏 +π/2
 * 另有逐片呼吸：`I = sin(i*10 + t*4) * 0.007`、`y = sin(i*8 + t*3) * 0.005`
 */
export const HERO_SLATS = {
  /** 段数（原件 `BoxGeometry(..., 12, 24, 12)` 的 heightSegments = 24） */
  segments: 24,
  /** 盒子壳尺寸（原件 `s = 2 * tan(fov/2) * cameraDistance / (1 + tan(fov/2))`，cameraDistance = 6.5） */
  cameraDistance: 6.5,
  /**
   * 弹簧参数（窄屏分支：宽度 ≤ 1024 —— 原件这里是**默认分支** `a=130, s=100, l=14`）
   * 每片按片号 r 在 from→to 之间线性插值：stiffness 由 130 递减到 100，damping 由 14 递增到 18
   */
  springStiffnessFrom: 130,
  springStiffnessTo: 100,
  springDampingFrom: 14,
  springDampingTo: 18,
  /**
   * 弹簧参数（宽屏分支：宽度 > 1024 —— 原件 `i>1024 && (a=96, s=54, l=13.5)`）
   * 注意：原件这里把**宽屏**参数写在 `>1024` 分支上，与"窄屏更软"的直觉相反，照抄即可
   */
  springStiffnessFromWide: 96,
  springStiffnessToWide: 54,
  springDampingFromWide: 13.5,
  springDampingToWide: 18,
  /** 呼吸幅度 */
  wobbleX: 0.007,
  wobbleY: 0.005,
  /** 显示/隐藏目标角（弧度）：hide 时宽屏 ∓π/2（原件 `i<1024 ? +π/2 : -π/2`） */
  showAngle: 0,
  hideAngleWide: -Math.PI / 2,
  hideAngleNarrow: Math.PI / 2,
} as const;

/**
 * 单页效果参数（原件 `pagesConfig[].effects` 的逐字段同构）
 *
 * 注意：字段名照抄原件，包含原件的拼写 `chromaticAbberationStrength`（少一个 r）。
 *      `lensDistortionBorders` 也是原件原样（复数 s 是原件笔误，照抄以免对不上号）。
 */
export interface HeroEffects {
  /** 噪点滚动速度（原件 `noiseVelocity`） */
  noiseVelocity: number;
  /** 噪点强度基准（原件 `noiseIntensity`，实际幅度还要乘 `0.037 * dprFactor`） */
  noiseIntensity: number;
  /** 褪色调强度（原件 `sepiaIntensity`） */
  sepiaIntensity: number;
  /** bloom 亮度阈值（原件 `bloomThreshold`） */
  bloomThreshold: number;
  /** bloom 强度基准（原件 `bloomIntensity`，单帧实际值见 `HERO_SETTINGS.bloomIntensityBase`） */
  bloomIntensity: number;
  /** bloom mip 模糊半径（原件 `bloomRadius`） */
  bloomRadius: number;
  /** bloom 阈值平滑（原件 `bloomSmoothing`，与阈值构成 smoothstep 的上下边界） */
  bloomSmoothing: number;
  /** 对比度（原件 `contrast`，绕 0.5 轴：`(c-0.5)*k+0.5`） */
  contrast: number;
  /** 亮度（原件 `brightness`，先 `clamp(rgb*k,0,1)`） */
  brightness: number;
  /** 饱和度（原件 `saturation`，在场景合成 pass 生效） */
  saturation: number;
  /** 运动模糊基准（原件 `motionBlur`，单帧实际值 = `1.3 * Q`，见 `HERO_SETTINGS.motionBlurGain`） */
  motionBlur: number;
  /** 桶形畸变（原件 `lensDistortion`，场景合成 pass 会换算成 `0.2*d+0.1`） */
  lensDistortion: number;
  /** 桶形畸变的边框系数（原件 `lensDistortionBorders`，换算成 `0.5+0.2*b`） */
  lensDistortionBorders: number;
  /** 幂次（原件 `pow`） */
  pow: number;
  /** 最终 pass 的 RGB 纵向色散强度（原件 `chromaticAbberationStrength`） */
  chromaticAbberationStrength: number;
  /** 暗角半径（原件 `vignetteRadius`） */
  vignetteRadius: number;
  /** 暗角平滑（原件 `vignetteSmoothness`） */
  vignetteSmoothness: number;
  /** 暗角强度（原件 `vignetteIntensity`） */
  vignetteIntensity: number;
}

/**
 * hero 节（首页 section 0）的**真实效果值**
 *
 * 来源：原件生产包 `0wb~eqgmow_3x.js` 里静态写死的 `pagesConfig` 中 `{ id:"hero", uiMode:"light" }` 那条。
 *
 * 重要更正：此前以为「首页逐页数值来自运行时 CMS、不在生产包里」——**这个判断是错的**。
 *          逐页效果表（7 节：hero / projects / office / about-us / golden-tie-reveal / golden-tie / contact）
 *          连同 loading / project / notFound / a11y 四张表一起，全部静态躺在包内，已逐字节取出。
 */
export const HERO_EFFECTS: HeroEffects = {
  noiseVelocity: 1,
  noiseIntensity: 1.12,
  sepiaIntensity: 0.22,
  bloomThreshold: 0.54,
  bloomIntensity: 2,
  bloomRadius: 0.78,
  bloomSmoothing: 0.24,
  contrast: 0.97,
  brightness: 1.2,
  saturation: 1,
  motionBlur: 0.3,
  lensDistortion: 0,
  lensDistortionBorders: 0,
  pow: 1.92,
  chromaticAbberationStrength: 1.04,
  vignetteRadius: 0.5,
  vignetteSmoothness: 0.3,
  vignetteIntensity: 0.1,
};

/**
 * loading 屏效果（原件 `loadingPageEffectsConfig`）
 *
 * 生效区间：boot / loading 期间（原件 `isReadyToRender == 0`，且参数按 `1 - initialTransition`
 * 的 smoothstep 权重渐出到 hero 值）。原件里这块蓝屏**本身就过这条链**：
 * 所以它带褪色、带 bloom、带暗角、带色散 —— 不是一张原样贴上去的图。
 */
export const HERO_LOADING_EFFECTS: HeroEffects = {
  noiseVelocity: 1,
  noiseIntensity: 1.4,
  sepiaIntensity: 0.55,
  bloomThreshold: 0,
  bloomIntensity: 0.24,
  bloomRadius: 0.83,
  bloomSmoothing: 0.5,
  contrast: 1,
  brightness: 0.65,
  saturation: 0.6,
  lensDistortion: 0.25,
  lensDistortionBorders: 0,
  motionBlur: 0.3,
  pow: 1.05,
  chromaticAbberationStrength: 1.5,
  vignetteRadius: 0.52,
  vignetteSmoothness: 0.27,
  vignetteIntensity: 0.3,
};

/**
 * 设置 store 的默认值（原件 `useSettingsStore`）与合成链的换算常数
 *
 * 全部为原件实测：`dpr [1,1.5]`、`lensDistortionFactor 1`、`bloomBoost 0`、`noiseFactor 1`；
 * 换算常数来自原件合成组件里的逐帧公式（见各字段注释）。
 */
export const HERO_SETTINGS = {
  /** 渲染 dpr 下限（原件 `dpr: [1, 1.5]`） */
  dprMin: 1,
  /** 渲染 dpr 上限（原件 `dpr: [1, 1.5]`） */
  dprMax: 1.5,
  /** 畸变总系数（原件 `lensDistortionFactor: 1`） */
  lensDistortionFactor: 1,
  /** bloom 额外增益（原件 `bloomBoost: 0`） */
  bloomBoost: 0,
  /** 噪点系数（原件 `noiseFactor: 1`） */
  noiseFactor: 1,
  /** bloom mip 级数（原件 `levels: 7`） */
  bloomLevels: 7,
  /** 场景合成 pass：畸变换算 `d' = 0.2 * d + 0.1`（原件实测） */
  lensDistortionScale: 0.2,
  lensDistortionBias: 0.1,
  /** 场景合成 pass：边框换算 `b' = 0.5 + 0.2 * b`（原件实测） */
  lensBorderScale: 0.2,
  lensBorderBias: 0.5,
  /** 竖屏时畸变打折（原件 `isPortraitDisplay && (e6 *= .5)`） */
  portraitDistortionFactor: 0.5,
  /** 单帧 bloom 强度 `1.5 * I + R + boost` 的基准倍数（原件实测） */
  bloomIntensityBase: 1.5,
  /** bloom 呼吸调制幅度（原件 `* 0.03 * I`） */
  bloomBreathAmp: 0.03,
  /** 运动模糊成帧倍数（原件 `1.3 * Q`） */
  motionBlurGain: 1.3,
  /** 噪点基准幅度（原件 `0.037 * noiseIntensity * dprFactor * mobileDiscount`） */
  noiseAmp: 0.037,
  /** 移动端噪点折扣（原件 `isMobileDevice ? 0.65 : 1`） */
  noiseMobileFactor: 0.65,
  /** 色散基准系数（原件 `0.001 * length(uv-0.5) * 2 * strength`） */
  chromaticScale: 0.001,
  /** 色散/噪点的边缘内缩（原件 `p = 0.005`） */
  edgeInset: 0.005,
  /** 噪点高斯核的标准差（原件 `A0(x, 0, 0.7*0.7)`） */
  noiseGaussianSigma: 0.49,
} as const;
