/**
 * 3D 工牌场景配置（对齐 samfcheng.com 的配置对象）
 *
 * 说明：
 *  - 站点把整份配置拆成 physics / material / lighting / background / filters /
 *    plotter / view / paused 八组，运行时每帧回写，因此所有数值都可以热调。
 *  - 本文件原样搬过来，仅把「默认（绘图仪/滤镜模式）」与「实时模式」拆成两个预设：
 *      站点默认配置：filters.enabled=false、plotter.enabled=true（?filter 模式）
 *      实时模式    ：材质走 unlitArtwork、wear .2、reflections .9、filter/plotter 全关
 */

/** 物理参数分组 */
export interface BadgePhysicsConfig {
  /** 重力加速度（m/s²，作用在 -Y） */
  gravity: number;
  /** 工牌刚体质量（kg） */
  mass: number;
  /** 线性阻尼基线（角阻尼 = 该值 + .2） */
  damping: number;
  /** 鼠标推风的冲量倍率 */
  mouseForce: number;
  /** 拖拽 PD 控制器的比例增益（越大越"跟手"） */
  grip: number;
  /** 织带弯曲刚度（弹簧网络基准刚度） */
  strapStiffness: number;
  /** 卡牌抗扭强度（0 = 关闭，牌面会自由乱转） */
  antiTwist: number;
  /** 抗扭曲线的非线性放大系数（越大越"大角度急剧加重"） */
  twistProgression: number;
  /** 扣具/旋环/轭之间绕轴旋转的阻尼 */
  swivelDamping: number;
}

/** 材质参数分组 */
export interface BadgeMaterialConfig {
  /** 磨损贴花不透明度（灰尘/划痕层） */
  wear: number;
  /** 胶膜边缘啃痕强度 */
  edgeDamage: number;
  /** 胶膜粗糙度 */
  roughness: number;
  /** 胶膜"透明度"（实际接进菲涅尔 alpha 的混合系数） */
  transmission: number;
  /** 胶膜厚度（参与反射增益） */
  thickness: number;
  /** 金属件粗糙度 */
  metalRoughness: number;
  /** 织带颜色 */
  strapColor: string;
  /** true = 印刷面走无光照材质（原图色彩 1:1，不过 tone mapping） */
  unlitArtwork?: boolean;
}

/** 灯光参数分组 */
export interface BadgeLightingConfig {
  /** 全局曝光 */
  exposure: number;
  /** 主光强度 */
  keyLight: number;
  /** 环境反射倍率（同时作用于胶膜与金属件） */
  reflections: number;
  /** 接地阴影不透明度 */
  shadow: number;
}

/** 背景参数分组 */
export interface BadgeBackgroundConfig {
  /** 纯色背景色 */
  color: string;
  /** 是否透明（画布不画背景，交给页面 CSS） */
  transparent: boolean;
  /** 是否用纯色填充场景背景 */
  filterBackground: boolean;
}

/** 后处理滤镜参数分组 */
export interface BadgeFilterConfig {
  /** 总开关：关闭时直接走 renderer.render，零后处理开销 */
  enabled: boolean;
  /** 抖动混合强度 */
  dither: number;
  /** 量化级数 */
  levels: number;
  /** 抖动矩阵格子像素尺寸 */
  ditherSize: number;
  /** 像素化尺寸 */
  pixelSize: number;
  /** 颗粒噪声 */
  grain: number;
  /** 去色 */
  monochrome: number;
  /** 棕褐色调 */
  sepia: number;
  /** 暗角 */
  vignette: number;
}

/** 绘图仪（马克笔）参数分组 */
export interface BadgePlotterConfig {
  /** 总开关 */
  enabled: boolean;
  /** 叠加强度 */
  strength: number;
  /** 笔宽 */
  strokeWidth: number;
  /** 笔画边缘柔化 */
  edgeSoftness: number;
  /** 笔迹重叠混合（墨水接缝） */
  lineBlend: number;
  /** 扫描线角度（度） */
  direction: number;
  /** 颜色分级数 */
  colorSteps: number;
  /** 墨量不均匀度 */
  inkVariation: number;
}

/** 视角参数分组 */
export interface BadgeViewConfig {
  /** 绕 Y 轴环绕角度（度） */
  angle: number;
  /** 相机推拉缩放 */
  zoom: number;
}

/** 整份配置 */
export interface BadgeConfig {
  physics: BadgePhysicsConfig;
  material: BadgeMaterialConfig;
  lighting: BadgeLightingConfig;
  background: BadgeBackgroundConfig;
  filters: BadgeFilterConfig;
  plotter: BadgePlotterConfig;
  view: BadgeViewConfig;
  /** 暂停物理与交互 */
  paused: boolean;
}

/** 卡牌初始静止高度（刚体初始 y，也是"原位"参考高度） */
export const BADGE_REST_Y = 0.15;

/** 工牌刚体默认配置（与站点完全一致的整份默认值） */
export const DEFAULT_BADGE_CONFIG: BadgeConfig = {
  physics: {
    gravity: 9.81,
    mass: 0.72,
    damping: 0.45,
    mouseForce: 1,
    grip: 100,
    strapStiffness: 90,
    antiTwist: 2.2,
    twistProgression: 3,
    swivelDamping: 0.15,
  },
  material: {
    wear: 0.7,
    edgeDamage: 0.55,
    roughness: 0.012,
    transmission: 1,
    thickness: 0.006,
    metalRoughness: 0.2,
    strapColor: '#30382d',
  },
  lighting: { exposure: 1, keyLight: 2.5, reflections: 1.8, shadow: 0.13 },
  background: { color: '#ffffff', transparent: true, filterBackground: false },
  filters: {
    enabled: false,
    dither: 1,
    levels: 4,
    ditherSize: 2,
    pixelSize: 1,
    grain: 0,
    monochrome: 0,
    sepia: 0,
    vignette: 0,
  },
  plotter: {
    enabled: true,
    strength: 1,
    strokeWidth: 5,
    edgeSoftness: 0.35,
    lineBlend: 0.5,
    direction: 0,
    colorSteps: 6,
    inkVariation: 0.55,
  },
  view: { angle: 0, zoom: 1 },
  paused: false,
};

/**
 * 实时模式配置（线上默认跑的那一套）
 *
 * 功能：在默认配置上做四组覆盖，把工牌变成"无光照印刷 + 低磨损 + 高反射"，
 *      并关掉滤镜与绘图仪后处理（此时整条后处理链路完全跳过）。
 *
 * 参数：无
 * 返回值：BadgeConfig 实时模式配置（新对象，不改动 DEFAULT_BADGE_CONFIG）
 * 异常：无
 *
 * 注意事项：
 *  - unlitArtwork 让印刷面用 MeshBasicMaterial + toneMapped:false，
 *    保证 PNG 原色 1:1 上屏，这是"品牌蓝不发灰"的关键
 *  - wear 降到 .2 时塑料看起来是全新的；.7 时会有明显使用痕迹
 */
export function createRealtimeBadgeConfig(): BadgeConfig {
  return {
    ...DEFAULT_BADGE_CONFIG,
    material: {
      ...DEFAULT_BADGE_CONFIG.material,
      unlitArtwork: true,
      wear: 0.2,
    },
    lighting: { ...DEFAULT_BADGE_CONFIG.lighting, reflections: 0.9 },
    filters: { ...DEFAULT_BADGE_CONFIG.filters, enabled: false },
    plotter: { ...DEFAULT_BADGE_CONFIG.plotter, enabled: false },
  };
}

/**
 * 按 URL 查询串挑选预设
 *
 * 功能：站点用「URL 是否带 ?filter」区分两套模式——不带参数是实时模式，
 *      带参数保留滤镜 + 绘图仪（印刷/绘图效果）。本函数复刻这个判定。
 *
 * 参数：
 *  - search {string} location.search（含前导 ?），默认取当前页面
 *
 * 返回值：BadgeConfig 对应预设（每次返回新对象，便于后续热改）
 * 异常：无
 *
 * 注意事项：
 *  - 深拷贝只做两层（组级 + 字段级），配置里没有嵌套对象，够用
 */
export function pickBadgeConfigFromUrl(search: string = window.location.search): BadgeConfig {
  const useFilter = new URLSearchParams(search).has('filter');
  if (useFilter) {
    return {
      ...DEFAULT_BADGE_CONFIG,
      physics: { ...DEFAULT_BADGE_CONFIG.physics },
      material: { ...DEFAULT_BADGE_CONFIG.material },
      lighting: { ...DEFAULT_BADGE_CONFIG.lighting },
      background: { ...DEFAULT_BADGE_CONFIG.background },
      filters: { ...DEFAULT_BADGE_CONFIG.filters },
      plotter: { ...DEFAULT_BADGE_CONFIG.plotter },
      view: { ...DEFAULT_BADGE_CONFIG.view },
    };
  }
  return createRealtimeBadgeConfig();
}
