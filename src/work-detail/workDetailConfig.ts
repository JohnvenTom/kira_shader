/**
 * /work/<slug> 详情页配置 —— 全部取自反编译对照表（_bundles/glossary-work-details.md），
 * 逐字段对应原站 bundle（dpl_AadA2KVJaJtKN5QXgQu1gAVrbmig），零估算。
 */
import type { HeroEffects } from '../hero/heroConfig';

/** projectPageEffectsConfig（0wb~eqgmow_3x.js:4609-4627，变量 a） */
export const PROJECT_PAGE_EFFECTS: HeroEffects = {
  noiseVelocity: 1,
  noiseIntensity: 0.9,
  sepiaIntensity: 0.1,
  bloomThreshold: 0.92,
  bloomIntensity: 0,
  bloomRadius: 0.8,
  bloomSmoothing: 0.2,
  contrast: 1,
  brightness: 1,
  saturation: 1,
  motionBlur: 0.2,
  lensDistortion: 0.16,
  lensDistortionBorders: 0,
  pow: 1.4,
  chromaticAbberationStrength: 0.5,
  vignetteRadius: 0,
  vignetteSmoothness: 0,
  vignetteIntensity: 0,
};

/** ProjectScene 相机（p9，04kr:62586-62592） */
export const PROJECT_CAMERA = {
  fov: 65,
  near: 0.1,
  far: 100,
  /** basePosition；z 由 subPageTransition 驱动 10→5（§5） */
  baseZ: 5,
  enterZ: 10,
} as const;

/** subPageTransition 弹簧（0wb:4771-4773 b 函数） */
export const SUBPAGE_TRANSITION = {
  damping: 20,
  stiffness: 85,
  /** 异类型 subPage 首次进入时的延迟 */
  delay: 0.1,
  restDelta: 0.001,
} as const;

/** 相机 Z 跟随弹簧（p9 帧内：n = 1 - exp(-6*dt)），速度钳制（04kr:62653-62657） */
export const CAMERA_SPRING = { exp: 6, velGainZ: -0.2, clampZ: 0.35, velGainOffset: 0.008, clampOffset: 0.03 } as const;

/** 内容条布局（uikit px，glossary §5.1；均横屏值） */
export const CONTENT = {
  /** uikit 根内容条总宽 = 7 个视口（04kr:62775，上限语义；pageCount 按实际内容宽算） */
  rootViewports: 7,
  backgroundColor: '#FAFAF2', // 背景板（nf 50×50 @ z-10）
  textColor: '#2B2B29',
  rootGap: 32,
  rootPaddingTop: 80,
  rootPaddingLeft: 120,
  rootPaddingRight: 100,
  innerMaxHeightCap: 900,
  textColumn: {
    width: 750,
    paddingLeft: 60,
    paddingRight: 32,
    marginRight: 60,
    topSpacer: 60,
    title: { fontSize: 58, lineHeight: 58, sm: { fontSize: 64, lineHeight: 64 }, lg: { fontSize: 100, lineHeight: 100 } },
    subtitle: { fontSize: 26, lg: { fontSize: 32 }, maxWidthPct: 0.8 },
    desc: { fontSize: 16, lineHeight: 24, gap: 20, marginTop: 16, lg: { fontSize: 20, lineHeight: 28, marginTop: 32 } },
    visitRow: { marginTop: 20 },
  },
  mediaStrip: { gap: 32 },
  nextPanel: {
    width: 800,
    paddingLeft: 72,
    paddingRight: 28,
    label: {
      fontSize: 20,
      lineHeight: 20,
      marginBottom: -8,
      lg: { fontSize: 30, lineHeight: 30, marginBottom: -10 },
    },
    divider: '#444',
    title: { fontSize: 60, lineHeight: 60, md: { fontSize: 72, lineHeight: 72 }, lg: { fontSize: 100, lineHeight: 100, marginTop: 46 }, marginTop: 32 },
    /** 原站 uP：24/28（lg 32/32），无 marginTop（紧跟在标题下方，04kr:62121-62131） */
    subtitle: { fontSize: 24, lineHeight: 28, lg: { fontSize: 32, lineHeight: 32 } },
    /** Continue 按钮：pq 容器（04kr:62132-62179）+ u5 primary/dark（04kr:32806-33060）
     *  - 外层 uk：marginTop 32 / padding 2 / borderWidth 2 / radius 4 / 聚焦描边 transparent→black
     *  - 内层 u5：黑底 #000、radius 4、padding 24、gap 14、hover opacity 0.96
     *  - 文字：28px medium/lineHeight 28、白色、marginBottom −12（负值让按钮高度收敛到 ~64）
     *  - 文字列 uk：flexDirection column + marginBottom −4；图标 28×28、上下 margin −7
     *  实测（原站参考帧 1578×846）：黑色实心矩形 ≈198×65（含外层透明框 ≈206×73） */
    continue: {
      marginTop: 32,
      framePadding: 2,
      frameBorderWidth: 2,
      frameBorderRadius: 4,
      background: '#000000',
      borderRadius: 4,
      paddingX: 24,
      paddingY: 24,
      gap: 14,
      label: { fontSize: 28, lineHeight: 28, marginBottom: -12, color: '#ffffff' },
      labelColumnMarginBottom: -4,
      iconSize: 28,
      iconMarginY: -7,
      hoverOpacity: 0.96,
      /** 点击后文案切「Loading...」，1500ms 后复原（04kr:62152-62157） */
      loadingResetMs: 1500,
    },
  },
} as const;

/** 媒体卡 p1（04kr:62218-62405） */
export const MEDIA_CARD = {
  defaultAspect: 4 / 3, // p0 @62217
  crossfadeDuration: 0.5,
  /** HLS 档位：reducedMemory→480p；width<700→720p；否则 1080p */
  maxResolution: () => (window.innerWidth < 700 ? '720p' : '1080p'),
  /** 边缘羽化（TSL：step(-0.002, a) 区间 0.1 alpha） */
  borderSoftness: 0.002,
  borderAlpha: 0.1,
  /** 清理延迟（<700px 宽不延迟） */
  disposeDelayMs: 1000,
} as const;

/** 颗粒/纸色（合成 quad M 材质，04kr:62706-62760） */
export const GRAIN = {
  darkTone: [0.12 * 0.5, 0.1 * 0.5, 0.08 * 0.5] as const, // 暗端
  paperTone: [0.99, 0.97, 0.93] as const, // 亮端
  baseStrength: 0.22,
  noiseSize: 512,
} as const;
