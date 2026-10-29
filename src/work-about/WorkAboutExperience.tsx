/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { createSelectedWorkScene } from '../selected-work/scene';
import { SELECTED_PROJECTS } from '../selected-work/data';
import { WORK_PROJECTS } from '../work-detail/data';
import { findWorkProject } from '../work-detail/data';
import { createWorkDetailExperience, type WorkDetailExperience } from '../work-detail/workDetailExperience';
import { PROJECT_PAGE_EFFECTS } from '../work-detail/workDetailConfig';
import WorkDetailBootOverlay from '../work-detail/WorkDetailBootOverlay';
import { consumeSpaNav } from '../work-detail/navigate';
import { createAboutOfficeScene } from '../about/officeScene';
import { createAboutContactScene, AboutContactHandle } from '../about/contactScene';
import { createNavUiScene, type NavUiSceneHandle } from './navUiScene';
import { createStarTransitionScene } from './starTransitionScene';
import { createHeroCompose } from '../hero/heroCompose';
import { createHeroScene } from '../hero/heroScene';
import { createUiCanvas, type UiCanvasHandle, type UiDrawState } from './uiCanvas';
import {
  HERO_PAGES,
  resolvePageEffectsFor,
  type HeroEffects,
  type HeroPageConfig,
} from '../hero/heroConfig';
import { createAboutPaper, disposeAboutPaper, AboutPaperResult } from './paperContent';
import { createAboutPaperScene, PaperSceneHandle } from './paperScene';
import { createShredderScene, ShredderSceneHandle } from './shredderScene';
import { createGoldenTieRevealScene, GoldenTieRevealHandle } from './goldenTieRevealScene';
import { createGoldenTieScene, GoldenTieSceneHandle } from './goldenTieScene';
import {
  bootStore,
  skipBoot,
} from '../boot/bootStore';
import type { AboutTheme } from './AboutUI';
import './about.css';
// 项目子页复用独立详情页的 boot 屏 / 顶栏样式（.wd-boot / .wd-topbar / .wd-close）
import '../work-detail/work-detail.css';

const T = TSL as any;
/** Lenis 默认 `lerp: 0.1` → 阻尼系数 `lerp·60 = 6/s`（原站未改 lerp） */
const SCROLL_LERP = 6;
/** Lenis 行模式滚轮换算（100/6 px per line） */
const LENIS_LINE_HEIGHT = 100 / 6;
/**
 * 全站统一滚动轴：s 即原站全局 scroll（单位屏，0 = hero 页首）。
 * 原站页面划分（pagesConfig 静态值）：hero [0,1]、projects [1,2]、office [2,3.8]、
 * about-us [3.8,11.1367…]、golden-tie-reveal [..,12.8367…]、golden-tie [..,18.8367…]、
 * contact [..,22.1606…]；本组件的 about 以后各段边界按纸面高度动态算（原件同款公式）。
 */
/** Selected Work 停驻点：原站 projects 页起点（全局 scroll 1.0） */
const WORK_REST_S = 1.0;
/** 原站 projects→office 页边界（向下切 #about-us / 视图切换点） */
const PAGE_SWITCH_S = 2.0;
/** 向上回到胶片视图的边界：原站 projects 页窗口终点 = 2 − 0.7（pageOffset.end −.7） */
const PAGE_BACK_S = 1.3;
/** hero → projects 视图边界：向下 0.9（projects 页窗口起点）/ 向上 0.8（hero 页窗口终点） */
const HERO_PAGE_DOWN_S = 0.9;
const HERO_PAGE_UP_S = 0.8;
/** 画格蒙版：原站 exitProgress 区间 scroll 1.3 → 1.5 */
const MASK_START_SCROLL = 1.3;
const MASK_END_SCROLL = 1.5;
/** 可滚动下限 = 全局 0（hero 页首） */
const TOP_LIMIT_S = 0;
/** 碎纸终幕滚动长度（屏）。原站 AS=4： shredder 每滚一屏上升一屏 */
const ENDING_SCREENS = 4;
/** projects→office 的通用 fade：原站 transitionLength 0.4（scroll 1.6→2.0），由 sceneMode type 0 承担 */
const FADE_START_S = 1.6;
/** office 页长度（原站 pagesConfig length 1.8） */
const OFFICE_SCREENS = 1.8;
/** office 页起点（全局 scroll 2.0）；office 场景进度 = (scroll − 2)/1.8 */
const OFFICE_START_S = 2.0;
/** About 内容起点 = office 页终点（原站 about-us.start 3.8） */
const ABOUT_START = OFFICE_START_S + OFFICE_SCREENS;
/** 纸卷 enterProgress 起点：原站 about.start − transitionLength = 1.8（折页在 office 页中后段就开始扫入） */
const FOLD_LEAD_SCREENS = ABOUT_START - 2;
/** 原站 enterProgress = nM(scroll, about.start−2, about.start+.6, 0, 1) 的跨度 */
const FOLD_ENTER_SPAN = 2.6;
/** 原站 about UI 起点 about.start−0.35 → 3.45（uiPageOffset.start −.35） */
const ABOUT_UI_START = ABOUT_START - 0.35;
/** golden-tie-reveal 页长度（原站 pagesConfig length: 1.7） */
const REVEAL_SCREENS = 1.7;
/** golden-tie 页长度（原站 pagesConfig length: 6） */
const TIE_SCREENS = 6;
/**
 * Contact 段长度：原站动态测高（列内容高/视口高，d−1 页滚动）。
 * 场景未就绪时的兜底值 ≈ 桌面 1600×900 的列高（hello/info/卡片/footer）。
 */
const CONTACT_FALLBACK_SCREENS = 4.2;
/** 跳转/直链进入 Contact 的落点（屏）：对齐原站 #contact 直链首帧（Hello 顶 ≈8% 视口，列滚 ≈0.8 页） */
const CONTACT_JUMP = 0; // 原站 #contact 跳转 = contact.range.start 精确值（运行时 store 实测 scroll=20.1078=start，2026-10-24 fiber 探针取证；旧值 0.02 来自粗测量 127px，实为 141px）
const BOOK_URL = 'mailto:hello@shader.se?subject=Book%20a%20call';
const CLEAR_PAPER = new THREE.Color(0x0b0b0b);
const CLEAR_CONTACT = new THREE.Color(0x040405);
const CLEAR_TRANSPARENT = new THREE.Color(0x000000);

type View = 'hero' | 'work' | 'about';
/** project = /work/<slug> 子页（原站同构：同一套 experience，胶片在底下，详情作为 subPage 叠加） */
type RouteMode = View | 'contact' | 'project';

interface ExperienceState {
  ready: boolean;
  view: View;
  uiVisible: boolean;
  theme: AboutTheme;
  contactActive: boolean;
  /** 统一滚动轴（原站 Lenis）：s/target 的单位是「屏」，局部原点 = 全局 scroll 1.6 */
  about: { s: number; target: number; shred: number; vel: number; dir: number; inputMultiplier: number };
  finalShown: boolean;
}

interface WorkState {
  index: number;
  dragPx: number;
  wheelAcc: number;
  wheelLockUntil: number;
  wheelResetTimer: number | null;
  pending: boolean;
  dragging: boolean;
  dragAxis: 'x' | 'y' | null;
  startX: number;
  startY: number;
  /** 纵向拖拽开始时的 target（拖拽按总位移换算，避免逐帧累加漂移） */
  dragStartTarget: number;
  lastD: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smoothstep = (a: number, b: number, v: number) => {
  const x = clamp((v - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
const smootherstep = (a: number, b: number, v: number) => {
  const x = clamp((v - a) / (b - a), 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * 两套页效果参数线性混合
 *
 * 功能：胶片 → 详情子页期间把 projects 页参数（有 bloom/强运动模糊）平滑过渡到
 *      projectPageEffectsConfig（无 bloom），避免切换瞬间「辉光突然消失」的跳变
 *
 * 参数：
 *  - a {HeroEffects} 起始效果（projects 页）
 *  - b {HeroEffects} 目标效果（详情页）
 *  - t {number}      0..1 混合权重
 *
 * 返回值：HeroEffects 逐字段插值后的新对象
 * 异常：无
 * 注意事项：所有字段都是数值；返回新对象，避免污染页表里的静态配置
 */
const blendEffects = (a: HeroEffects, b: HeroEffects, t: number): HeroEffects => {
  const out: Record<string, number> = {};
  for (const k of Object.keys(b)) {
    const av = Number((a as unknown as Record<string, number>)[k] ?? 0);
    const bv = Number((b as unknown as Record<string, number>)[k] ?? 0);
    out[k] = av + (bv - av) * t;
  }
  return out as unknown as HeroEffects;
};

/**
 * 原站 mainPage.snapPoints 里真正生效的两个锚点（about/footer 没有 range，会被插件过滤）
 *
 * 单位：屏（全局 scroll）。forward = 向下滚动，backward = 向上滚动；
 * multiplier 为数组时按 `+!anchorAbove` 取值（原站 `multiplier[+!t]`）。
 */
const SNAPS: Array<{
  position: number;
  forward: { range: [number, number]; multiplier: number | [number, number] };
  backward: { range: [number, number]; multiplier: number | [number, number] };
}> = [
  {
    position: 0,
    forward: { range: [-1e4, 0.1], multiplier: 1 },
    backward: { range: [-1e4, 0.8], multiplier: 1 },
  },
  {
    position: 1,
    forward: { range: [-0.9, 0.3], multiplier: 1 },
    backward: { range: [-0.22, 0.6], multiplier: [3, 0.3] },
  },
];

function createFullscreenQuad() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 4);
  camera.position.z = 2;
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicNodeMaterial());
  scene.add(mesh);
  return { scene, camera, mesh, geometry };
}

/**
 * 原件 at 组件的纸页进入折痕（paperplane.js 的 a/s）：
 * 纸面 mesh 屏幕固定，折痕沿 normalize(.5, 1) 从底部斜向上扫过；
 * 卷边用 cos 明暗 + 背面暖色表现，折痕外侧透明、透出下层 office。
 */
function makeFoldMaterial(officeTex: THREE.Texture, paperTex: THREE.Texture) {
  const mat = new THREE.MeshBasicNodeMaterial();
  const uEnter = T.uniform(0);
  mat.toneMapped = false;
  mat.depthTest = false;
  mat.depthWrite = false;

  const build = T.Fn(() => {
    const uv = T.uv();
    const o = T.float(0.4);
    const pi = T.float(Math.PI);
    const radius = T.float(0.15);
    const dir = T.vec2(0.4472135955, 0.894427191);
    // 原件 enterProgress 公式：m = -0.8 + 2.9068·e
    // e≈0.2236 时卷边顶沿才进入屏幕；e≈0.7115 时完全铺开
    const mz = T.float(-0.8).add(uEnter.mul(2.9068));
    // animateUp = 1：折痕方向量 I 就是 three 的 uv（底为 0）
    const I = uv;
    const y = T.dot(I, dir);
    const C = T.abs(T.vec2(1, 1).sub(I).div(dir));
    const B = y.add(T.min(C.x, C.y));

    const v = T.vec2(0, 0).toVar();
    const s = T.vec2(y, 1).toVar();
    T.If(y.lessThan(mz.sub(radius)), () => {
      v.assign(s);
    })
      .ElseIf(y.greaterThan(mz.add(radius)), () => {
        v.assign(T.vec2(-1, -1));
      })
      .Else(() => {
        const theta = T.asin(y.sub(mz).div(radius));
        const l = theta.negate().add(pi);
        s.x.assign(mz.add(l.mul(radius)));
        s.y.assign(T.cos(l));
        T.If(s.x.lessThan(B), () => {
          v.assign(s);
        })
          .ElseIf(y.lessThan(mz), () => {
            v.assign(T.vec2(y, 1));
          })
          .Else(() => {
            s.y.assign(T.cos(theta));
            s.x.assign(mz.add(theta.mul(radius)));
            v.assign(T.mix(T.vec2(-1, -1), s, s.x.lessThan(B).toFloat()));
          });
      });

    const shadow = T.float(1)
      .sub(T.smoothstep(0, o.mul(2), mz.sub(y)))
      .mul(T.smoothstep(o.negate(), o, B.sub(v.x.add(pi.mul(1.5).mul(o)).add(o))));
    const offset = dir.mul(v.x.sub(y));
    const folded = uv.add(offset);
    const paper = T.texture(paperTex, T.vec2(folded.x, T.float(1).sub(folded.y)));
    const lit = paper.rgb.mul(v.y).mul(T.float(1).sub(shadow));
    const back = paper.rgb
      .mul(0.25)
      .add(T.vec3(0.7, 0.67, 0.5))
      .mul(v.y.negate());
    const shaded = T.mix(back, lit, v.y.greaterThan(0).toFloat());
    const mask = T.float(1).sub(v.x.lessThan(0).toFloat()).mul(paper.a);
    // rgb：折痕外透出下层 office（作为当前页显示时正确）；alpha：纸覆盖度——
    // 合成链 overlay 转场（type 2）按它门控，折页扫过处才露出本页
    const below = T.texture(officeTex, T.vec2(uv.x, T.float(1).sub(uv.y)));
    return T.vec4(T.mix(below.rgb, shaded, mask), mask);
  });

  mat.colorNode = build();
  return { mat, uEnter };
}

/**
 * 详情页转场曲线（原站 2026-10-29 CDP 实测规格）：
 * 入场（点击 View project）：
 *  1. 画格蒙版揭示（短）：spring 前 1/3 内画格内换成详情页（屏幕 1:1 采样）
 *  2. 胶片推近（快）：spring 0.12→0.7 画格 zoom 1→3 放大铺满（原站转场启动后 ~350ms 铺满，
 *     伴随强运动模糊与胶片带上移——上移由 zoom 中心与画格位置自然形成，未单独驱动）
 *  3. 全屏交接（稳）：spring 0.55→0.95 全屏详情页渐显覆盖，与铺满的画格内容重合无跳变
 * 退场 = 同一 spring 反向回落，两段自然倒放（原站 Close 实测：胶片缩回 → 画格内页面淡出）。
 */
const FRAME_REVEAL_GAIN = 3;
const FRAME_ZOOM_PEAK = 3;
const CROSSFADE_START = 0.55;
const CROSSFADE_END = 0.95;

export default function WorkAboutExperience({ mode, projectSlug }: { mode: RouteMode; projectSlug?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const hotspotRef = useRef<HTMLAnchorElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    startAbout: (source?: 'scroll' | 'auto') => void;
    switchToWork: () => void;
    jumpToHero: () => void;
    jumpToContact: () => void;
    jumpToAboutTop: () => void;
    /** 打开项目子页（Selected Work 胶片点击 / 路由直链） */
    openProject: (uid: string, pushUrl: boolean, zoomReveal?: boolean) => void;
    /** 关闭项目子页（Close ✕ / Esc）：spring 退场后回 #selected-work */
    closeProject: (pushUrl?: boolean) => void;
  } | null>(null);

  /**
   * 直链 / 刷新 /work/<slug> 的 boot 门：
   * SPA 内部点击进入不播 boot（原站实证），硬加载才播；
   * 初值只在挂载时求一次，之后由 <WorkDetailBootOverlay onDone> 推进。
   */
  const [bootProject] = useState(() => (mode === 'project' && projectSlug && !consumeSpaNav() ? findWorkProject(projectSlug) ?? null : null));
  const [bootDone, setBootDone] = useState(() => !bootProject);
  /**
   * SPA 点击进入的兜底加载层：预建未就绪（滑动后立即点击）时短暂显示，
   * 子页创建完成即消失。预建命中时不出现（与原站一致：转场立即启动无加载感）。
   */
  const [projectLoading, setProjectLoading] = useState(false);

  const initialView: View = mode === 'hero' ? 'hero' : mode === 'work' || mode === 'project' ? 'work' : 'about';
  const [ready, setReady] = useState(false);
  // chrome UI 已全部由 canvas 烘焙层绘制：视图/主题/阶段只活在 stateRef 里，不再驱动 React 渲染
  void initialView;

  const stateRef = useRef<ExperienceState>({
    ready: false,
    view: initialView,
    uiVisible: mode === 'about' || mode === 'contact',
    theme: mode === 'about' ? 'dark' : 'light',
    contactActive: mode === 'contact',
    about: {
      // 全局 0 基轴：#hero 从 0 起步（boot 播放）；#selected-work / #work 落停驻点 1.0；
      // #about-us 直链落 About 内容页首；contact 由 pendingContact 流程落黑场起点
      s: mode === 'hero' ? 0 : mode === 'about' ? ABOUT_START : WORK_REST_S,
      target: mode === 'hero' ? 0 : mode === 'about' ? ABOUT_START : WORK_REST_S,
      shred: 0,
      vel: 0,
      dir: 0,
      inputMultiplier: 1,
    },
    finalShown: false,
  });

  const workRef = useRef<WorkState>({
    index: 0,
    dragPx: 0,
    wheelAcc: 0,
    wheelLockUntil: 0,
    wheelResetTimer: null,
    pending: false,
    dragging: false,
    dragAxis: null,
    startX: 0,
    startY: 0,
    dragStartTarget: WORK_REST_S,
    lastD: 0,
  });

  const prevModeRef = useRef<RouteMode>(mode);
  /** 当前路由模式（渲染循环里读；mode 变化时由 effect 同步） */
  const modeRef = useRef<RouteMode>(mode);
  useEffect(() => {
    modeRef.current = mode;
    if (!ready) return;
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    const st = stateRef.current;
    // 浏览器 Back / 外部路由离开 /work/<slug> → 子页退场（URL 已由路由层改好，不再推）
    if (prev === 'project' && mode !== 'project') {
      apiRef.current?.closeProject(false);
    }
    if (mode === 'contact') {
      apiRef.current?.jumpToContact();
      return;
    }
    if (mode === 'hero') {
      // boot 每次页面加载只播一次：从其他段回到 #hero 不重播，轴瞬时回到 0
      apiRef.current?.jumpToHero();
      return;
    }
    if (mode === 'about') {
      if (st.view === 'work' || st.view === 'hero') apiRef.current?.startAbout('auto');
      else if (prev === 'contact' || st.contactActive) apiRef.current?.jumpToAboutTop();
      return;
    }
    if (st.view !== 'work') apiRef.current?.switchToWork();
  }, [mode, ready]);

  /**
   * /work/<slug> 直链 / SPA 路由进入 → 打开项目子页
   *
   * 说明：点击进入时 openProject 已在点击回调里先启动（避免等待 React 渲染一拍），
   *      这里再调一次是幂等的（projectActive/projectPending 门直接返回）；
   *      硬加载则等 boot 屏 onDone（bootDone=true）后才拉起，boot 期间不渲染子页。
   */
  useEffect(() => {
    if (!ready || !bootDone) return;
    if (mode !== 'project' || !projectSlug) return;
    apiRef.current?.openProject(projectSlug, false);
  }, [mode, projectSlug, ready, bootDone]);

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const cleanups: Array<() => void> = [];
    const host = hostRef.current;
    if (!host) return;

    const st = stateRef.current;
    const work = workRef.current;
    const mouse = { x: 0, y: 0, cssX: -1, cssY: -1 };
    let renderer: THREE.WebGPURenderer | null = null;
    let compose: ReturnType<typeof createHeroCompose> | null = null;
    let hero: ReturnType<typeof createHeroScene> | null = null;
    let workScene: ReturnType<typeof createSelectedWorkScene> | null = null;
    let office: ReturnType<typeof createAboutOfficeScene> | null = null;
    let contact: AboutContactHandle | null = null;
    let paper: AboutPaperResult | null = null;
    let paperScene: PaperSceneHandle | null = null;
    let shredder: ShredderSceneHandle | null = null;
    let reveal: GoldenTieRevealHandle | null = null;
    let tie: GoldenTieSceneHandle | null = null;
    let revealRT: THREE.RenderTarget | null = null;
    let nextRT: THREE.RenderTarget | null = null;
    let paperPromise: Promise<void> | null = null;
    let paperToken = 0;
    // ---------- 项目子页（/work/<slug>）运行时 ----------
    /** 详情页 ProjectScene 句柄（复用主渲染器；嵌入模式，无自己的画布/合成链） */
    let projectExp: WorkDetailExperience | null = null;
    /** 正在异步创建（防重复点击） */
    let projectPending = false;
    /** 子页已上屏（compose 采样 subPageTexture 的门） */
    let projectActive = false;
    /** 子页 spring 已启动（openProject 创建完成回调统一调用） */
    let projectEntered = false;
    /** 子页滚动目标（px；clamp 到 (pageCount-1)*视口高） */
    let projectScrollPx = 0;
    /** 退场中（防重复 Close） */
    let projectClosing = false;
    /** 子页创建代数（异步竞态防护） */
    let projectGen = 0;
    /** 最近一帧写给合成链的子页参数（调试/探针） */
    let projectSubMix = 0;
    let projectSubBrightness = 1;
    /** 入场是否走「胶片推近 + 详情页中心弹出」（点击进入 true；直链 boot 后 false） */
    let projectZoomReveal = false;
    /** P2 转场：星星阵列场景 + 它的 RT（原站 TransitionScene） */
    let starScene: ReturnType<typeof createStarTransitionScene> | null = null;
    /** 等纸页尺寸就绪后跳到 Contact（直链 / 从 Selected Work 进入 / 点导航） */
    let pendingContact = mode === 'contact';
    /** ?jump=tie 调试直链：纸页就绪后落到 tie 段（起点 +0.5 屏，标题/人群/领带同框） */
    let pendingJumpTie = new URLSearchParams(window.location.search).get('jump') === 'tie';
    /** ?uiflat=1 消融：UI 合成不吃桶形畸变（隔离 navbar 变暗是否来自 uiA 采样偏移） */
    const ABLATE_UI_FLAT = new URLSearchParams(window.location.search).has('uiflat');
    /** 程序化跳转期间暂停 snap（原站 snapLockTarget 的等价物） */
    let snapLockUntil = 0;
    const lockSnap = (ms = 1400) => {
      snapLockUntil = performance.now() + ms;
    };

    // ---------- P2 导航跳转状态机（原站 useNavbarClickHandler） ----------
    // 相邻 hero↔projects：0.8s 缓动滚动（bezier(.48,.09,.22,1) + lock）；
    // 跨段：1.25s fade-through 转场（前半黑幕渐入、中点 immediate 跳轴+切状态、后半渐出；
    // 原站是目标页画面 alpha 混入，本地 v1 用黑幕掩盖切换，观感为呼吸式切换）。
    // URL 在点击瞬间 replaceState（原站 history.replaceState(href) 语义）。
    type NavPage = 'hero' | 'projects' | 'about-us' | 'contact';
    let navNav: {
      kind: 'scroll' | 'transition';
      page: NavPage;
      fromS: number;
      toS: number;
      toIdx: number;
      t: number;
      t0: number;
      jumped: boolean;
      duration: number;
      /** 最近一次成功强渲的目标页纹理（领头星内芯的画面源；未就绪为 null） */
      toTex?: THREE.Texture | null;
    } | null = null;
    /** 转场的定时器（组件卸载清理；转场动画走 CSS/墙钟，不依赖渲染帧率——
     *  SwiftShader 下渲染帧 1-2s/帧，rAF 驱动的 1.25s 转场会在 1-2 帧内跑完退化成瞬移） */
    const navTimers: number[] = [];
    /** css cubic-bezier(.48,.09,.22,1)：牛顿迭代解 x(u)=t 后取 y(u)（原站 scrollTo easing） */
    const navEase = (t: number): number => {
      const x1 = 0.48, y1 = 0.09, x2 = 0.22, y2 = 1;
      const bez = (u: number, a: number, b: number) =>
        3 * u * (1 - u) * (1 - u) * a + 3 * u * u * (1 - u) * b + u * u * u;
      let u = t;
      for (let i = 0; i < 8; i++) {
        const x = bez(u, x1, x2) - t;
        const d = 3 * (1 - u) * (1 - u) * x1 + 6 * u * (1 - u) * (x2 - x1) + 3 * u * u * (1 - x2);
        if (Math.abs(x) < 1e-5 || Math.abs(d) < 1e-6) break;
        u -= x / d;
      }
      return Math.min(1, Math.max(0, bez(Math.min(1, Math.max(0, u)), y1, y2)));
    };
    const initialContactMode = mode === 'contact';
    let wasEnding = false;
    let rtW = 1;
    let rtH = 1;
    // === 转场方向调试（?debugRT=film|office）：把页 RT 以两种 V 方向分屏直铺上屏 ===
    // 左半 = quad uv()（y 向上惯例）采样，右半 = screenUV（y 向下惯例）采样。
    // 任一半正立刻确定该 RT 的存储方向约定，用于定位页间转场的画面颠倒问题。
    const dbgRTName = new URLSearchParams(window.location.search).get('debugRT');
    let dbgQuad: ReturnType<typeof createFullscreenQuad> | null = null;
    /** 逐页 RT（原件 sceneMode 的 c[0..6]）：每页场景渲进自己的 RT，合成链统一采样 */
    let heroRT: THREE.RenderTarget | null = null;
    let filmRT: THREE.RenderTarget | null = null;
    let officeRT: THREE.RenderTarget | null = null;
    let aboutRT: THREE.RenderTarget | null = null;
    let tieRT: THREE.RenderTarget | null = null;
    let contactRT: THREE.RenderTarget | null = null;
    let paperRT: THREE.RenderTarget | null = null;
    let composite: ReturnType<typeof createFullscreenQuad> | null = null;
    /** 折页 quad：办公室在下、纸面在上、alpha=纸覆盖度——渲进 aboutRT（原件 overlay 页 RT 语义） */
    let entryMat: ReturnType<typeof makeFoldMaterial> | null = null;
    /** canvas 烘焙 UI（原件 uikit 路径）：light/dark 纹理 + 区域表 + 命中测试 */
    let ui: UiCanvasHandle | null = null;
    /** navbar uikit 层（2026-10-25 P1：header/菜单改由 uikit 渲染，canvas 只留 work 箭头/提示） */
    let nav: NavUiSceneHandle | null = null;
    let navMenuT = 0;
    let uiModeDamped = 0;
    let uiTransitionDamped = 0;
    let logoHoverDamped = 0;
    let actionHoverDamped = 0;
    let menuOpen = false;

    const setUiVisibleState = (value: boolean) => {
      st.uiVisible = value;
    };
    const setThemeState = (value: AboutTheme) => {
      st.theme = value;
    };
    const setFinalState = (value: boolean) => {
      st.finalShown = value;
    };
    const setViewState = (value: View) => {
      st.view = value;
    };
    const setContactActiveState = (value: boolean) => {
      st.contactActive = value;
    };
    const hideHotspots = () => {
      if (hotspotRef.current) hotspotRef.current.style.display = 'none';
    };

    const ensurePaper = (): Promise<void> => {
      const mobile = window.innerWidth < 768;
      if (paper && paper.mobile === mobile) return Promise.resolve();
      if (paperPromise) return paperPromise;
      const token = ++paperToken;
      paperPromise = (async () => {
        try {
          const result = await createAboutPaper(mobile);
          if (disposed || token !== paperToken) {
            disposeAboutPaper(result);
            return;
          }
          shredder?.dispose();
          shredder = null;
          paperScene?.dispose();
          paper = result;
          paperScene = createAboutPaperScene(result, host.clientWidth, host.clientHeight);
          if (renderer) {
            shredder = createShredderScene(renderer, result, host.clientWidth, host.clientHeight);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[About] 纸页纹理生成失败：', err);
        } finally {
          paperPromise = null;
        }
      })();
      return paperPromise;
    };

    const getContactStart = () => {
      if (!paper) return null;
      const scale = window.innerWidth / paper.width;
      const shredStart = ABOUT_START + (paper.ctaY * scale) / Math.max(1, window.innerHeight);
      return shredStart + ENDING_SCREENS + REVEAL_SCREENS + TIE_SCREENS;
    };

    const officeFrame = (time: number, dt: number, progress: number) => {
      if (!office) return;
      office.update(dt, time, {
        scrollProgress: progress,
        mouseX: mouse.x,
        mouseY: mouse.y,
        touch: 'ontouchstart' in window,
      });
    };

    const buildTargets = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      rtW = Math.max(1, Math.floor(host.clientWidth * dpr));
      rtH = Math.max(1, Math.floor(host.clientHeight * dpr));
      heroRT?.dispose();
      filmRT?.dispose();
      officeRT?.dispose();
      paperRT?.dispose();
      aboutRT?.dispose();
      revealRT?.dispose();
      tieRT?.dispose();
      contactRT?.dispose();
      nextRT?.dispose();
      // 真实场景页 RT 开 4x MSAA（胶片画格/齿孔是 alphaTest 硬边；其余页同待遇保持一致）
      const pageRT = () =>
        new THREE.RenderTarget(rtW, rtH, { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 });
      heroRT = pageRT();
      filmRT = pageRT();
      officeRT = pageRT();
      aboutRT = pageRT();
      revealRT = pageRT();
      tieRT = pageRT();
      contactRT = pageRT();
      paperRT = new THREE.RenderTarget(rtW, rtH, { type: THREE.HalfFloatType, depthBuffer: true });
      nextRT = new THREE.RenderTarget(rtW, rtH, { type: THREE.HalfFloatType, depthBuffer: true });
      entryMat?.mat.dispose();
      if (!composite) composite = createFullscreenQuad();
      entryMat = makeFoldMaterial(officeRT.texture, paperRT.texture);
      hero?.setFilmTarget(filmRT.texture, rtW, rtH);
    };

    const resetWorkInput = () => {
      work.pending = false;
      work.dragging = false;
      work.dragAxis = null;
      work.dragPx = 0;
      document.body.style.cursor = '';
    };

    /** 输入回调里读当前轴位（全局 0 基 = 原站 scroll） */
    const scrollNow = () => stateRef.current.about.s;

    /** canvas 菜单开关（原站 menu 浮层的状态移出 DOM） */
    const toggleMenu = (open: boolean) => {
      menuOpen = open;
      if (open) document.body.dataset.aboutMenu = '1';
      else delete document.body.dataset.aboutMenu;
    };

    /**
     * UI 命中统一入口：navbar uikit 区域表（header/菜单）优先，canvas 区域表兜底
     * （work 箭头/提示仍在 canvas 层）。键名两侧对齐（logo/navXxx/burger/book/menuXxx）。
     */
    const uiHit = (x: number, y: number): string | null => {
      if (nav) {
        for (const [k, r] of Object.entries(nav.regions)) {
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            // 菜单项仅菜单展开时可命中（面板 opacity 门控）
            if (k.startsWith('menu') && navMenuT < 0.5) continue;
            return k;
          }
        }
      }
      return ui?.hitTest(x, y) ?? null;
    };

    /**
     * 从 Selected Work 进入 office/About（点击提示、导航或路由直达）
     *
     * 说明：这条轴和滚轮是同一条（原站 Lenis）：这里只把 target 推到 About 内容页首，
     *      显示位置仍由 6/s 阻尼推进，途中自然经过 1.3–1.5 的画格蒙版与 1.6–2.0 的 fade。
     */
    const startAbout = (_source: 'scroll' | 'auto' = 'auto') => {
      if (!st.ready || (st.view !== 'work' && st.view !== 'hero')) return;
      resetWorkInput();
      // 跳转期间抑制 snap（原站为程序化滚动设置 snapLockTarget）
      lockSnap(2600);
      st.about.target = Math.max(st.about.target, ABOUT_START);
      pendingContact = false;
      void ensurePaper();
    };

    const jumpToHero = () => {
      if (!st.ready) return;
      resetWorkInput();
      const aim = st.about;
      // boot 不重播：轴瞬时回 0（原站从 about 滚回 hero 只是同一条轴反向）
      aim.s = 0;
      aim.target = 0;
      aim.shred = 0;
      aim.vel = 0;
      aim.dir = 0;
      aim.inputMultiplier = 1;
      snapLockUntil = 0;
      pendingContact = false;
      st.finalShown = false;
      setContactActiveState(false);
      setViewState('hero');
      setUiVisibleState(false);
      setThemeState('light');
      hideHotspots();
      work.dragPx = 0;
      work.pending = false;
      work.dragging = false;
      work.dragAxis = null;
      work.wheelAcc = 0;
      if (work.wheelResetTimer !== null) {
        window.clearTimeout(work.wheelResetTimer);
        work.wheelResetTimer = null;
      }
    };

    const switchToWork = () => {
      if (!st.ready) return;
      pendingContact = false;
      const aim = st.about;
      aim.s = WORK_REST_S;
      aim.target = WORK_REST_S;
      aim.shred = 0;
      aim.vel = 0;
      aim.dir = 0;
      aim.inputMultiplier = 1;
      snapLockUntil = 0;
      st.finalShown = false;
      setContactActiveState(false);
      setViewState('work');
      setUiVisibleState(false);
      setThemeState('light');
      hideHotspots();
      work.dragPx = 0;
      work.pending = false;
      work.dragging = false;
      work.dragAxis = null;
      work.wheelAcc = 0;
      if (work.wheelResetTimer !== null) {
        window.clearTimeout(work.wheelResetTimer);
        work.wheelResetTimer = null;
      }
    };

    const jumpToAboutTop = () => {
      if (!st.ready) return;
      const aim = st.about;
      aim.s = ABOUT_START;
      aim.target = ABOUT_START;
      aim.shred = 0;
      aim.vel = 0;
      aim.dir = 0;
      aim.inputMultiplier = 1;
      snapLockUntil = 0;
      pendingContact = false;
      setViewState('about');
      setUiVisibleState(true);
      setThemeState('dark');
      setFinalState(false);
      setContactActiveState(false);
      hideHotspots();
      void ensurePaper();
    };

    const jumpToContact = () => {
      if (!st.ready) return;
      resetWorkInput();
      lockSnap(2600);
      const contactStart = getContactStart();
      const aim = st.about;
      if (contactStart === null) {
        pendingContact = true;
        void ensurePaper();
      } else {
        // 直接落到黑场起点，再让阻尼把镜头带进 Hello（避免从 projects 页一路快滚过去）
        aim.s = contactStart + CONTACT_JUMP;
        aim.target = contactStart + CONTACT_JUMP;
        aim.vel = 0;
        aim.dir = 1;
        aim.inputMultiplier = 1;
        pendingContact = false;
      }
      setViewState('about');
      setUiVisibleState(true);
      setThemeState('light');
      setFinalState(false);
      setContactActiveState(true);
      hideHotspots();
    };

    /**
     * SPA URL 同步（不写 sessionStorage 的 boot 旗标）
     *
     * 功能：pushState + 派发 popstate，让 Root 的 pathname/hash 路由更新而**不卸载本体验**；
     *      同一实例内的 /work/<slug> ↔ /#selected-work 切换不播 boot（原站客户端路由同语义）。
     *
     * 参数：
     *  - url {string} 目标地址（同源绝对路径，可带 hash）
     *
     * 返回值：无
     *
     * 异常：无
     *
     * 注意事项：dispatch 是同步的，Root 会在本调用栈内重渲染；openProject/closeProject
     *          自身的 projectActive/projectPending 门保证 mode effect 重复调用是幂等的。
     */
    const syncUrl = (url: string) => {
      if (window.location.pathname + window.location.search + window.location.hash === url) return;
      history.pushState(null, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };

    /**
     * 打开项目子页（原站 `navigateToSubPage` + p7 ProjectScene 叠加）
     *
     * 功能：把详情页 ProjectScene 挂进主体验渲染器（嵌入模式），等首帧就绪后作为
     *      subPage 纹理盖在胶片上，并按原站节奏做 30 帧预热 → spring 0→1 入场。
     *
     * 参数：
     *  - uid     {string}  项目 slug（/work/<uid>）
     *  - pushUrl {boolean} 是否同步 URL（点击进入 true；直链/路由进入 false）
     *
     * 返回值：无
     *
     * 异常：创建失败时回滚到胶片页并打印错误（不留半开状态）
     *
     * 注意事项：
     *  - 胶片索引与项目序号反序（scene.ts：active = count-1-index），打开时先把胶片居中到该项目，
     *    Close 后正好停在它上面（原站 Close 行为）
     *  - 子页创建期间保持胶片可见、UI 淡出，不做黑场
     */
    const openProject = (uid: string, pushUrl: boolean, zoomReveal = false) => {
      if (!st.ready || !renderer) return;
      if (projectActive || projectPending) return;
      const proj = findWorkProject(uid);
      const idx = WORK_PROJECTS.findIndex((p) => p.uid === uid);
      if (!proj || idx < 0) return;
      resetWorkInput();
      lockSnap(1e9);
      // 胶片索引 = 项目序（titlePrism 按 SELECTED_PROJECTS[index] 直取）；
      // 打开时先把胶片居中到该项目，Close 后正好停在它上面（原站 Close 行为）
      work.index = idx;
      work.dragPx = 0;
      work.wheelAcc = 0;
      projectPending = true;
      projectClosing = false;
      projectEntered = false;
      projectZoomReveal = zoomReveal;
      projectScrollPx = 0;
      setViewState('work');
      setUiVisibleState(false);
      setThemeState('light');
      hideHotspots();
      // 原站手感：不做任何后台预建（拖动全程零冻结），点击后即时创建，
      // 由底部「✳ Loading work...」提示掩盖等待（flushSync 保证提示立即上屏——
      // 否则创建冻结结束前 React 批处理不会渲染，提示会错过整个等待窗口）
      flushSync(() => setProjectLoading(true));
      const gen = ++projectGen;
      void (async () => {
        try {
          const exp = await createWorkDetailExperience(host, proj, { renderer: renderer as THREE.WebGPURenderer });
          if (disposed || gen !== projectGen || !st.ready) {
            exp.dispose();
            return;
          }
          projectExp?.dispose();
          projectExp = exp;
          projectPending = false;
          projectActive = true;
          // 创建完成即 enter（原站：Loading work 消失即刻转场）
          projectEntered = true;
          exp.enter({ cameraFlight: !projectZoomReveal });
          exp.setScrollTarget(projectScrollPx);
          setProjectLoading(false);
          if (pushUrl) syncUrl(`/work/${uid}`);
        } catch (err) {
          projectPending = false;
          setProjectLoading(false);
          snapLockUntil = 0;
          // eslint-disable-next-line no-console
          console.error('[WorkAbout] 项目子页创建失败：', err);
        }
      })();
    };

    /**
     * 关闭项目子页（Close ✕ / Esc）
     *
     * 功能：spring 1→0 退场（相机 z 5→10、亮度 1→0.5），收敛后释放子页并回 `/#selected-work`；
     *      胶片保持打开时居中的那个项目（原站实证行为）。
     *
     * 参数：无
     * 返回值：无
     * 异常：无
     * 注意事项：创建未完成时直接取消（projectGen 递增使迟到的实例自行 dispose）。
     */
    const closeProject = (pushUrl = true) => {
      if (projectClosing) return;
      if (projectPending) {
        projectPending = false;
        projectGen++;
        setProjectLoading(false);
        setViewState('work');
        snapLockUntil = 0;
        return;
      }
      if (!projectActive || !projectExp) return;
      projectClosing = true;
      const exp = projectExp;
      exp.exit(() => {
        if (disposed) return;
        projectActive = false;
        projectClosing = false;
        projectExp = null;
        exp.dispose();
        snapLockUntil = 0;
        setViewState('work');
        setUiVisibleState(false);
        setThemeState('light');
        work.dragPx = 0;
        work.pending = false;
        work.dragging = false;
        work.dragAxis = null;
        if (pushUrl) syncUrl('/#selected-work');
      });
    };

    apiRef.current = { startAbout, switchToWork, jumpToHero, jumpToContact, jumpToAboutTop, openProject, closeProject };

    // ---------- P2 导航跳转入口（navbar 点击统一走这里） ----------
    const navTargetS = (page: NavPage): number | null => {
      switch (page) {
        case 'hero': return 0;
        case 'projects': return WORK_REST_S;
        case 'about-us': return ABOUT_START;
        case 'contact': return getContactStart();
      }
    };
    const navHashFor = (page: NavPage): string => {
      const base = `${window.location.pathname}${window.location.search}`;
      switch (page) {
        case 'hero': return base; // 原站 hero→"/"：URL 去掉 hash
        case 'projects': return `${base}#selected-work`;
        case 'about-us': return `${base}#about-us`;
        case 'contact': return `${base}#contact`;
      }
    };
    const navNavigate = (page: NavPage) => {
      if (!st.ready || navNav) return;
      const toS = navTargetS(page);
      if (toS == null) {
        // contact 且纸页未就绪：退化为既有瞬移路径（pendingContact 机制接管）
        history.replaceState(null, '', navHashFor(page));
        jumpToContact();
        return;
      }
      const fromS = st.about.s;
      // URL 立即变（原站 history.replaceState(href) 语义；hash 只是 URL 状态，不触发滚动）
      history.replaceState(null, '', navHashFor(page));
      if (Math.abs(fromS - toS) < 0.01) return; // 同页：只改 URL
      // 相邻 hero↔projects → 0.8s 缓动滚动；其余跨段 → 星星阵列转场（1.25s，原站 TransitionScene）
      const adjacent = fromS <= WORK_REST_S + 0.01 && toS <= WORK_REST_S + 0.01;
      const toIdx = page === 'hero' ? 0 : page === 'projects' ? 1 : page === 'about-us' ? 3 : 6;
      // ?navdur= 调试：覆盖转场时长（ms），便于慢环境抓帧
      const navDur = Math.max(
        200,
        +(new URLSearchParams(window.location.search).get('navdur') ?? 0) || (adjacent ? 800 : 1250),
      );
      if (adjacent) {
        navNav = { kind: 'scroll', page, fromS, toS, toIdx, t: 0, t0: performance.now(), jumped: true, duration: 800 };
        lockSnap(1000);
      } else {
        navNav = { kind: 'transition', page, fromS, toS, toIdx, t: 0, t0: performance.now(), jumped: false, duration: navDur };
        lockSnap(Math.max(1600, navDur + 400));
        st.about.vel = 0;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!st.ready) return;
      if (document.body.dataset.aboutMenu === '1') return;
      e.preventDefault();
      let dx = e.deltaX;
      let dy = e.deltaY;
      // 原站 Lenis 1.3.3 的滚轮归一化：行模式 ×100/6，页模式 × 视口尺寸
      if (e.deltaMode === 1) {
        dx *= LENIS_LINE_HEIGHT;
        dy *= LENIS_LINE_HEIGHT;
      } else if (e.deltaMode === 2) {
        dx *= window.innerWidth;
        dy *= window.innerHeight;
      }
      // 子页（/work/<slug>）：滚轮驱动内容条横移（workDetailExperience 内部阻尼）
      if (projectActive || projectPending) {
        if (projectActive && projectExp) {
          const maxPx = Math.max(0, (projectExp.getPageCount() - 1) * window.innerHeight);
          projectScrollPx = clamp(projectScrollPx + dy, 0, maxPx);
          projectExp.setScrollTarget(projectScrollPx);
        }
        return;
      }
      if (pendingContact) return;
      // P2 导航跳转期间锁滚动输入（原站 lenis.stop() 语义）
      if (navNav) return;
      // boot 弹簧收敛前锁滚动（与 bootInteractionUnlocked 同一意图）
      if (!bootStore.springDone) return;

      // 横向滚轮 = 胶片翻帧（film 段 scroll > 0.9 起生效，原站 FilmReel 同款手势）
      if (scrollNow() > 0.9 && Math.abs(dx) > Math.abs(dy)) {
        if (work.dragging || work.pending) return;
        const now = performance.now();
        if (now < work.wheelLockUntil) return;
        if (work.wheelResetTimer !== null) window.clearTimeout(work.wheelResetTimer);
        work.wheelResetTimer = window.setTimeout(() => {
          work.wheelAcc = 0;
        }, 150);
        work.wheelAcc -= dx;
        const threshold = 0.1 * host.clientWidth;
        if (Math.abs(work.wheelAcc) > threshold) {
          work.index -= Math.sign(work.wheelAcc);
          work.wheelAcc = 0;
          work.wheelLockUntil = now + 700;
        }
        return;
      }
      if (scrollNow() > OFFICE_START_S && Math.abs(dx) > Math.abs(dy) * 1.4) return;

      // 纵向：统一滚动轴。原站 snap 插件在 onVirtualScroll 里先乘 inputMultiplier
      const aim = st.about;
      aim.target += (dy / window.innerHeight) * aim.inputMultiplier;
    };

    const onMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = 1 - (e.clientY / window.innerHeight) * 2;
      mouse.cssX = e.clientX;
      mouse.cssY = e.clientY;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!st.ready) return;
      // 子页打开：只接管 canvas 烘焙层的顶栏命中（Close / logo），其余拖拽/点击全部让位。
      // 这里必须用 ui.hitTest（canvas 区域表），不能走 uiHit —— 后者会先命中已冻结的 navbar 表。
      if (projectActive || projectPending) {
        const hit = ui?.hitTest(e.clientX, e.clientY) ?? null;
        if (hit === 'projectClose') {
          e.preventDefault();
          closeProject();
        } else if (hit === 'projectLogo') {
          // logo = 回首页（原站顶栏 logo 语义）：URL 交给导航跳转，
          // 子页退场不再自行 push，避免两次 replaceState 互相覆盖
          e.preventDefault();
          closeProject(false);
          navNavigate('hero');
        }
        return;
      }
      if (navNav) return; // P2 跳转期间锁拖拽滚动
      if (!bootStore.springDone) return;
      // contact 段链接命中（3D 投影区域，优先于 canvas UI——原站 uikit 点击语义）
      if (st.contactActive && contact) {
        const hit = contact
          .hitRegions()
          .find((r) => e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h);
        if (hit) {
          e.preventDefault();
          if (hit.key === 'ctEmail') window.location.href = 'mailto:hello@shader.se?subject=Book%20a%20call';
          else if (hit.key === 'ctBook') window.open('https://cal.com/filip-kantedal-hd30xa/30min', '_blank', 'noopener,noreferrer');
          else if (hit.key === 'ctCeo') window.location.href = 'mailto:ceo@shader.se';
          else if (hit.key === 'ctLi') window.open('https://www.linkedin.com/company/shadersweden/', '_blank', 'noopener,noreferrer');
          else if (hit.key === 'ctIg') window.open('https://www.instagram.com/shadersweden/', '_blank', 'noopener,noreferrer');
          else if (hit.key === 'ctX') window.open('https://x.com/shadersweden', '_blank', 'noopener,noreferrer');
          return;
        }
      }
      // canvas UI 命中分发（原件 uikit 区域表；navbar/菜单在 uikit 层，箭头/提示在 canvas 层）。
      // 导航项统一走 navNavigate（P2 状态机：URL 立即同步 + 相邻缓动/跨段转场）
      if (ui || nav) {
        const hit = uiHit(e.clientX, e.clientY);
        if (hit) {
          e.preventDefault();
          switch (hit) {
            case 'logo':
            case 'navHome':
            case 'menuHome':
              if (menuOpen) toggleMenu(false);
              navNavigate('hero');
              break;
            case 'navWork':
            case 'menuWork':
              if (menuOpen) toggleMenu(false);
              navNavigate('projects');
              break;
            case 'navAbout':
            case 'menuAbout':
              if (menuOpen) toggleMenu(false);
              navNavigate('about-us');
              break;
            case 'navContact':
            case 'menuContact':
            case 'menuBook':
              if (menuOpen) toggleMenu(false);
              navNavigate('contact');
              break;
            case 'book':
              window.location.href = 'mailto:hello@shader.se?subject=Book%20a%20call';
              break;
            case 'burger':
              toggleMenu(!menuOpen);
              break;
            case 'prevArrow':
              work.index -= 1;
              break;
            case 'nextArrow':
              work.index += 1;
              break;
            case 'hint':
              startAbout('scroll');
              break;
            case 'viewProject': {
              // 原站 projects-view：打开子页 /work/<slug>（同 canvas 叠加，不卸载 experience）
              // 映射：标题/画格数据按 SELECTED_PROJECTS[index] 直取（titlePrism 同源），
              // 不是 3D 场景内部 activeIndex 的反序（那只服务着色器画格编号）
              const n = SELECTED_PROJECTS.length;
              const activeIdx = ((work.index % n) + n) % n;
              openProject(WORK_PROJECTS[activeIdx].uid, true, true);
              break;
            }
          }
          return;
        }
        if (menuOpen) toggleMenu(false);
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-sw-ui],[data-ab-ui],.ab-hotspot,.ab-menu,.ab-final')) return;
      if (e.button !== 0) return;
      if (scrollNow() > 0.9) {
        // film 段：横拖翻帧 / 纵拖滚动轴（原件同款双意图判定）
        const yRatio = e.clientY / window.innerHeight;
        if (yRatio < 0.18 || yRatio > 0.92) return;
        work.pending = true;
        work.dragging = false;
        work.dragAxis = null;
        work.startX = e.clientX;
        work.startY = e.clientY;
        work.dragStartTarget = st.about.target;
        work.lastD = 0;
      } else {
        // hero 段：纵向拖拽 = 同一条滚动轴
        work.pending = true;
        work.dragging = false;
        work.dragAxis = 'y';
        work.startY = e.clientY;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!work.pending) return;
      if (work.dragAxis !== 'y') {
        const dx = e.clientX - work.startX;
        const dy = e.clientY - work.startY;
        if (!work.dragging) {
          if (Math.abs(dx) + Math.abs(dy) <= 10) return;
          work.dragging = true;
          work.dragAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          document.body.style.cursor = work.dragAxis === 'y' ? 'ns-resize' : 'grabbing';
        }
        if (work.dragAxis === 'y') {
          // 纵向拖拽 = 同一条滚动轴（向上拖进入 office），松手后交给阻尼与 snap
          st.about.target = work.dragStartTarget - dy / window.innerHeight;
          work.lastD = dy;
          return;
        }
        const limit = 0.2 * window.innerWidth;
        work.lastD = clamp(dx, -limit, limit);
        work.dragPx = work.lastD;
        return;
      }
      const dy = e.clientY - work.startY;
      if (!work.dragging) {
        if (Math.abs(dy) <= 6) return;
        work.dragging = true;
        document.body.style.cursor = 'ns-resize';
      }
      const aim = st.about;
      aim.target = clamp(aim.target - dy / window.innerHeight, 0, 1e6);
      work.startY = e.clientY;
    };

    const endDrag = () => {
      if (!work.pending) return;
      work.pending = false;
      document.body.style.cursor = '';
      if (work.dragging && work.dragAxis === 'x') {
        work.dragging = false;
        work.dragPx = 0;
        if (Math.abs(work.lastD) > 0.1 * window.innerWidth) {
          work.index += work.lastD > 0 ? -1 : 1;
        }
        return;
      }
      if (work.dragging) {
        work.dragging = false;
        work.dragPx = 0;
        return;
      }
      // 未拖动 = 单击：胶片段点激活画格 → 打开详情子页（用户要求「点具体胶片内容」）
      const cx = work.startX;
      const cy = work.startY;
      const inFilm =
        Math.abs(cx - window.innerWidth / 2) <= window.innerWidth * 0.3 &&
        cy >= window.innerHeight * 0.28 &&
        cy <= window.innerHeight * 0.92;
      if (inFilm && scrollNow() > 0.9 && scrollNow() < 1.1) {
        const n = SELECTED_PROJECTS.length;
        const activeIdx = ((work.index % n) + n) % n;
        openProject(WORK_PROJECTS[activeIdx].uid, true, true);
      }
      work.dragPx = 0;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!st.ready) return;
      // 子页：Esc = Close，翻页键驱动内容条横移
      if (projectActive || projectPending) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeProject();
          return;
        }
        if (projectExp && !projectPending) {
          const maxPx = Math.max(0, (projectExp.getPageCount() - 1) * window.innerHeight);
          if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
            e.preventDefault();
            projectScrollPx = clamp(projectScrollPx + window.innerHeight * 0.8, 0, maxPx);
            projectExp.setScrollTarget(projectScrollPx);
          } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
            e.preventDefault();
            projectScrollPx = clamp(projectScrollPx - window.innerHeight * 0.8, 0, maxPx);
            projectExp.setScrollTarget(projectScrollPx);
          } else if (e.key === 'Home') {
            e.preventDefault();
            projectScrollPx = 0;
            projectExp.setScrollTarget(0);
          } else if (e.key === 'End') {
            e.preventDefault();
            projectScrollPx = maxPx;
            projectExp.setScrollTarget(maxPx);
          }
        }
        return;
      }
      if (navNav) return; // P2 跳转期间锁键盘滚动
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const aim = st.about;
      if (scrollNow() > 0.9 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (e.key === 'ArrowLeft') work.index -= 1;
        else work.index += 1;
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        aim.target += 0.65;
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        aim.target -= 0.65;
      } else if (e.key === 'Home') {
        aim.target = 0;
      } else if (e.key === 'End') {
        aim.target = 1e6;
      }
    };

    const rebuildRTs = () => {
      if (!host || !renderer) return;
      buildTargets();
    };

    const onResize = () => {
      if (!renderer || !workScene || !office) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h);
      hero?.setSize(w, h);
      ui?.setSize(w, h);
      nav?.setSize(w, h);
      workScene.setSize(w, h);
      office.setSize(w, h);
      contact?.setSize(w, h);
      compose?.setSize(w, h);
      paperScene?.setSize(w, h);
      shredder?.setSize(w, h);
      reveal?.setSize(w, h);
      tie?.setSize(w, h);
      projectExp?.resize();
      rebuildRTs();
      if (paper && paper.mobile !== (window.innerWidth < 768)) void ensurePaper();
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    cleanups.push(() => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      document.body.style.cursor = '';
      if (work.wheelResetTimer !== null) window.clearTimeout(work.wheelResetTimer);
    });

    (async () => {
      const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
      // ?gl=webgl 调试：强制 WebGL backend（WebGPU backend 的星星场景 RT 渲染排障）
      const forceGL = new URLSearchParams(window.location.search).get('gl') === 'webgl';
      const r = new THREE.WebGPURenderer({ antialias: false, alpha: true, forceWebGL: !hasWebGPU || forceGL });
      renderer = r;
      await r.init();
      if (disposed) {
        r.dispose?.();
        return;
      }
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      r.setSize(host.clientWidth, host.clientHeight);
      r.toneMapping = THREE.NeutralToneMapping;
      r.toneMappingExposure = 1;
      host.appendChild(r.domElement);
      (window as any).__r3 = r; // 调试句柄（CDP eval 用）

      workScene = createSelectedWorkScene(host.clientWidth, host.clientHeight);
      office = createAboutOfficeScene(host.clientWidth, host.clientHeight);
      contact = createAboutContactScene(host.clientWidth, host.clientHeight);
      (window as any).__contact = contact; // 调试句柄（CDP eval 用）
      reveal = createGoldenTieRevealScene(r, host.clientWidth, host.clientHeight);
      tie = createGoldenTieScene(r, host.clientWidth, host.clientHeight);
      cleanups.push(workScene.dispose);
      cleanups.push(office.dispose);
      cleanups.push(contact.dispose);
      cleanups.push(reveal.dispose);
      cleanups.push(tie.dispose);
      // hero 段场景（boot 只在 #hero 首载播放；直链/回访 skipBoot）
      // 非 hero/project 模式：bootStore 单例必须显式收敛（springDone=true），否则
      // onPointerDown/wheel 的 springDone 门会锁死本页全部交互。
      // project 硬加载由 <WorkDetailBootOverlay> 自己 reset/tick（与独立详情页同一套 BIOS），
      // 所以这里不能抢先把 springDone 置真。
      if (mode === 'work' || mode === 'about' || mode === 'contact') skipBoot();
      try {
        hero = createHeroScene(r, host, host.clientWidth, host.clientHeight, { playBoot: mode === 'hero' });
        cleanups.push(hero.dispose);
        (window as any).__hero = hero; // 调试句柄（CDP eval 用）
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[WorkAbout] hero 场景创建失败：', err);
      }
      // P2 转场：星星阵列场景（原站 TransitionScene，cx 共享工厂）
      try {
        starScene = createStarTransitionScene(r);
        starScene.setSize(host.clientWidth, host.clientHeight);
        cleanups.push(starScene.dispose);
        (window as any).__star = starScene; // 调试句柄（CDP eval 用）
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('[WorkAbout] 星星转场场景创建失败：', err?.stack ?? String(err));
      }
      try {
        compose = createHeroCompose(host.clientWidth, host.clientHeight);
        cleanups.push(compose.dispose);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[WorkAbout] 合成管线创建失败，退化为直渲：', err);
      }
      // canvas UI（原件 uikit 路径）；纹理注入合成链
      try {
        ui = createUiCanvas(host.clientWidth, host.clientHeight);
        cleanups.push(ui.dispose);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[WorkAbout] UI 画布创建失败：', err);
      }
      // navbar uikit 层（header/菜单从 canvas 迁出；区域表由 uikit 布局导出）
      try {
        nav = await createNavUiScene(host.clientWidth, host.clientHeight);
        cleanups.push(nav.dispose);
        (window as any).__nav = nav; // 调试句柄（CDP eval 用）
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[WorkAbout] navbar uikit 创建失败：', err);
      }
      if (compose && ui) {
        compose.setUiTextures(ui.lightTexture, ui.darkTexture, nav?.lightTexture, nav?.darkTexture);
      }
      buildTargets();
      void ensurePaper();
      if (initialContactMode) {
        // 直链 #contact：等纸页尺寸与电话模型都就绪，避免先闪一帧 About 页首
        await ensurePaper();
        await contact.ready;
      } else if (mode === 'about') {
        // 直链 #about-us：直接落到 About 内容页首，等纸页就绪避免闪 office
        await ensurePaper();
      }
      st.ready = true;
      setReady(true);

      const clock = new THREE.Clock();
      let lastTime = 0;
      const render = async () => {
        if (disposed || !renderer || !workScene || !office) return;
        try {
          const dt = Math.min(clock.getDelta(), 0.05);
          const time = clock.elapsedTime;
          lastTime = time;

          // ---------- 统一滚动轴（原站 Lenis + snap） ----------
          const h = window.innerHeight;
          const w = window.innerWidth;
          const aim = st.about;
          const scale = paper ? w / paper.width : 1;
          const shredStart = paper ? ABOUT_START + (paper.ctaY * scale) / h : 1e9;
          const revealStart = shredStart + ENDING_SCREENS;
          const tieStart = revealStart + REVEAL_SCREENS;
          const tieEnd = tieStart + TIE_SCREENS;
          const contactStart = paper ? tieEnd : 1e9;
          /** Contact 段长度（屏）：场景列动态测高，未就绪时用兜底值 */
          const contactLen = contact?.length() ?? CONTACT_FALLBACK_SCREENS;
          const maxS = paper ? contactStart + contactLen : 1e9;

          if (pendingContact && paper) {
            aim.s = contactStart + CONTACT_JUMP;
            aim.target = aim.s;
            aim.vel = 0;
            aim.dir = 0;
            pendingContact = false;
          }
          if (pendingJumpTie && paper) {
            aim.s = tieStart + 0.5;
            aim.target = aim.s;
            aim.vel = 0;
            aim.dir = 0;
            pendingJumpTie = false;
            st.view = 'about';
            history.replaceState(null, '', `${window.location.pathname}${window.location.search}#about-us`);
          }

          aim.target = clamp(aim.target, TOP_LIMIT_S, maxS);

          // 原站 snap 插件逐帧逻辑（snap-zone.txt）：只保留带 range 的 start / projects 两个锚点
          const c = Math.abs(aim.vel);
          const dir = aim.dir;
          if (!pendingContact && performance.now() >= snapLockUntil) {
            // 全局 0 基轴：display 即原站 scroll
            const display = aim.s;
            const target = aim.target;
            const affected = SNAPS.flatMap((p) => {
              const cfg = dir === -1 ? p.backward : p.forward;
              const lo = p.position + cfg.range[0];
              const hi = p.position + cfg.range[1];
              if (display < lo || display > hi) return [];
              const above = p.position >= display;
              const multiplier = Array.isArray(cfg.multiplier) ? cfg.multiplier[above ? 0 : 1] : cfg.multiplier;
              const currentDeltaY = p.position - display;
              return [{
                position: p.position,
                rangeRaw: cfg.range,
                multiplier,
                snapDirection: above ? 1 : -1,
                currentDeltaY,
                distance: Math.abs(currentDeltaY),
              }];
            }).sort(
              (a, b) => a.distance / Math.max(a.multiplier, 0.001) - b.distance / Math.max(b.multiplier, 0.001)
            );
            if (affected.length > 0) {
              let d = 0;
              const fps = dt > 0 ? 1 / dt : 60;
              for (const e of affected) {
                if (e.distance <= 0.01) continue;
                let t = e.currentDeltaY * e.multiplier * 0.025;
                const sign = Math.sign(t);
                t = Math.abs(t) ** 0.8 * sign;
                if (e.snapDirection !== dir) t *= 0.4 + 0.05 * c;
                d += (60 * t) / fps;
              }
              if (d > 0.1) d = 0.1;
              if (aim.inputMultiplier !== 1 && c < 1) aim.inputMultiplier = 1;
              const last = affected[affected.length - 1];
              const passed = last.snapDirection > 0 ? target > last.position : target < last.position;
              if (c > 5 && c < 100 && last.snapDirection === dir && passed) {
                // 甩出吸附区间：抑制输入直到速度衰减（原站 inputMultiplier=0）
                aim.inputMultiplier = 0;
                const edge = dir === 1 ? last.rangeRaw[1] : last.rangeRaw[0];
                aim.target = last.position + (edge * c) / 150;
              } else if (d !== 0) {
                aim.target += d;
              }
            } else if (aim.inputMultiplier !== 1 && c < 1) {
              aim.inputMultiplier = 1;
            }
          } else if (aim.inputMultiplier !== 1 && c < 1) {
            aim.inputMultiplier = 1;
          }

          // Lenis 阻尼：damp(scroll, target, lerp·60 = 6)
          const prevS = aim.s;
          aim.s += (aim.target - aim.s) * (1 - Math.exp(-SCROLL_LERP * dt));
          if (Math.abs(aim.target - aim.s) * h < 0.5) {
            // Lenis 追到整数像素后 reset：速度与方向清零
            aim.s = aim.target;
            aim.vel = 0;
            aim.dir = 0;
          } else {
            aim.vel = (aim.s - prevS) * h;
            aim.dir = Math.sign(aim.s - prevS);
          }

          /** 原站全局 scroll（屏，0 = hero 页首）—— 本组件唯一的滚动真值 */
          const scroll = aim.s;
          /** projects 页画格蒙版：scroll 1.3 → 1.5 */
          const mask = clamp((scroll - MASK_START_SCROLL) / (MASK_END_SCROLL - MASK_START_SCROLL), 0, 1);
          /** office 页滚动进度（原站 nM(scroll, office.start, office.end, 0, 1)，fade 期间可为负） */
          const officeProgress = (scroll - OFFICE_START_S) / OFFICE_SCREENS;

          // ---- 视图切换与 hash 窗口（pageOffset 滞回：向下 0.9/2.0，向上 0.8/1.3）----
          // P2 跳转期间跳过：URL 已由 navNavigate 立即 replaceState，别覆盖成出发段 hash
          if (!pendingContact && !navNav && !projectActive && !projectPending && modeRef.current !== 'project') {
            if (st.view === 'hero' && scroll >= HERO_PAGE_DOWN_S) setViewState('work');
            else if (st.view === 'work' && scroll >= PAGE_SWITCH_S) setViewState('about');
            else if (st.view === 'work' && scroll < HERO_PAGE_UP_S) setViewState('hero');
            else if (st.view === 'about' && scroll < PAGE_BACK_S) setViewState('work');
            const wantHash = st.contactActive
              ? '#contact'
              : st.view === 'hero'
                ? '#hero'
                : st.view === 'work'
                  ? '#selected-work'
                  : '#about-us';
            if (window.location.hash.split('?')[0] !== wantHash) {
              history.replaceState(null, '', `${window.location.pathname}${window.location.search}${wantHash}`);
            }
          }

          // hero 段推进（相机路径/烟/百叶幕/屏幕内容）——页窗口 [0, 1)
          if (hero && scroll < 1.05) {
            hero.update({ dt, time, scroll, mouseX: mouse.x, mouseY: mouse.y });
          }

          // projects UI 淡入淡出：uiPageOffset 窗口 [0.7, 2)，实际淡入 [0.7,0.9]、在蒙版前淡出 [1.1,1.3]
          // 子页打开/创建期间：projects UI 强制淡出（原站 subPage 覆盖时 uikit 不画）
          const projectOpen = projectActive || projectPending;
          const swFade = projectOpen
            ? 0
            : smoothstep(0.7, 0.9, scroll) * (1 - smoothstep(1.1, 1.3, scroll));

          // ---------- about 段时间轴（纸页/碎纸/reveal/tie/contact 共用的派生量） ----------
          // 页激活（原站 pageOffset.start = -0.9：contact 段提前 0.9 屏激活 stage/update/UI）
          const inContact = !!paper && scroll >= contactStart - 0.9;
          // RT 渲染窗（原站 renderOffset.beforeStart = 1.25：contactRT 提前 1.25 屏开始渲染，
          // 保证 tie→contact 的合成 crossfade 期间 next 纹理是活帧——否则 fade 叠印冻结帧造成重影）
          const inContactRender = !!paper && scroll >= contactStart - 1.25;
          const stage: 'fade' | 'office' | 'paper' | 'ending' | 'reveal' | 'tie' | 'contact' = inContact
            ? 'contact'
            : scroll >= tieStart
              ? 'tie'
              : scroll >= revealStart
                ? 'reveal'
                : scroll >= shredStart
                  ? 'ending'
                  : scroll >= ABOUT_START
                    ? 'paper'
                    : scroll >= FADE_START_S
                      ? 'office'
                      : 'fade';
          const contactEnterScreens = inContact ? scroll - contactStart : 0;
          const shred = scroll >= shredStart ? clamp((scroll - shredStart) / ENDING_SCREENS, 0, 1) : 0;
          st.about.shred = shred;
          // 原站 enterProgress：about.start−2 → about.start+.6（2.6 屏）；
          // 可见折痕扫过约 1.27 屏，铺满后内容仍停在页首，直到 about.start。
          const foldEnter = clamp((scroll - FOLD_LEAD_SCREENS) / FOLD_ENTER_SPAN, 0, 1);
          const paperTop = scroll < ABOUT_START ? 0 : -(scroll - ABOUT_START) * h;

          // golden-tie-reveal 时间轴（原站：文案 l = (scroll-start+4)/5.6；
          // 卡片 n_((scroll-(start-3))/(end-(start-3)))，end-start=1.7）
          const revealText = clamp((scroll - shredStart) / 5.6, 0, 1);
          const revealCards = smootherstep(shredStart + 1, shredStart + 5.7, scroll);

          // golden-tie 页（原站 pagesConfig: start-2 → end-.5 相机推进；
          // 握手 A = (end-3.6 → end-.7)；墨迹 (end-1.6 → end+.5)）
          const tieDolly = clamp((scroll - (tieStart - 2)) / (tieEnd - 0.5 - (tieStart - 2)), 0, 1);
          const tieHandshake = clamp((scroll - (tieEnd - 3.6)) / 2.9, 0, 1);
          // 原站 n_/nF 均为 clamp 包装（非缓动）：火花窗口线性扩张、白闪线性淡出
          const tieTransition = clamp((scroll - (tieEnd - 1.6)) / 2.1, 0, 1);
          // contact.update 每帧去重标记（tie 转场分支与 contact RT 分支可能同帧命中）
          let contactUpdated = false;
          const tieFlash = clamp((scroll - (tieEnd - 1.56)) / 0.96, 0, 1);
          const tiePin = clamp((scroll - (tieStart - 1.5)) / (tieEnd - (tieStart - 1.5)), 0, 1);
          const tieCopyOpacity = stage === 'tie' ? 1 - smoothstep(0.02, 0.25, tieTransition) : 0;

            if (stage === 'fade') {
              // 原站 projects UI 在 fade 前已消失；office UI 从 office 页首才出现
              setUiVisibleState(false);
              setThemeState('light');
            } else {
              setUiVisibleState(true);
              if (stage === 'office' || stage === 'paper') {
                // 原站 office uiMode=light、about uiMode=dark；about UI 从 about.start−0.35 起
                setThemeState(scroll >= ABOUT_UI_START ? 'dark' : 'light');
              } else {
                setThemeState('light');
              }
            }

            setContactActiveState(inContact);

            // ---------- P2 导航跳转推进 ----------
            // 相邻缓动：帧循环直驱轴插值。跨段星星转场：进度走墙钟（帧率无关），
            // 星星场景每帧渲进 starRT、由合成器 navTransition 通道混入（原站 isTransitioningToSection）
            if (navNav && navNav.kind === 'scroll') {
              navNav.t = Math.min(1, navNav.t + dt * 1000 / navNav.duration);
              const e2 = navEase(navNav.t);
              const s = navNav.fromS + (navNav.toS - navNav.fromS) * e2;
              aim.s = s;
              aim.target = s;
              aim.vel = 0;
              if (navNav.t >= 1) navNav = null;
            } else if (navNav && navNav.kind === 'transition') {
              navNav.t = Math.min(1, (performance.now() - navNav.t0) / navNav.duration);
              if (navNav.t >= 1 && !navNav.jumped) {
                // 原站：animate(sectionTransition,1) onComplete 才 scrollTo(target, immediate)
                navNav.jumped = true;
                switch (navNav.page) {
                  case 'hero': jumpToHero(); break;
                  case 'projects': switchToWork(); break;
                  case 'about-us': jumpToAboutTop(); break;
                  case 'contact': jumpToContact(); break;
                }
                navNav = null;
              }
            } else if (!navNav && veilRef.current && veilRef.current.style.opacity !== '0') {
              veilRef.current.style.opacity = '0';
            }

            // tie→contact 转场由 goldenTieScene 的火花窗口承担（原站 f5 转场板），无黑幕层
            (window as any).__aim = {
              s: +aim.s.toFixed(3),
              target: +aim.target.toFixed(3),
              vel: +aim.vel.toFixed(3),
              mult: aim.inputMultiplier,
            };

            // ---------- 各页场景逐帧更新（渲染进各自页 RT 的参数都在这里备好） ----------
            if (stage === 'contact') {
              wasEnding = false;
              setFinalState(false);
              if (hotspotRef.current) hotspotRef.current.style.display = 'none';

              contact?.update(dt, time, {
                enterScreens: contactEnterScreens,
                lengthScreens: contact?.length() ?? CONTACT_FALLBACK_SCREENS,
                mouseX: mouse.x,
                mouseY: mouse.y,
                touch: 'ontouchstart' in window,
              });
            }
            if (stage === 'ending' || stage === 'reveal') {
              // reveal 段清 wasEnding：重新下滚进碎纸段时 shredder.reset 会再次触发（合并前语义）
              if (stage === 'reveal') wasEnding = false;
              setFinalState(false);
              if (hotspotRef.current) hotspotRef.current.style.display = 'none';
            }
            if (stage === 'tie') {
              wasEnding = false;
              setFinalState(false);
              if (hotspotRef.current) hotspotRef.current.style.display = 'none';
            }
            if (stage === 'fade' || stage === 'office' || stage === 'paper') {
              wasEnding = false;
              setFinalState(false);
              if (hotspotRef.current) hotspotRef.current.style.display = 'none';
            }

            // ---------- canvas UI（原件 uikit）：逐帧绘制 + 主题/显隐/hover 阻尼 ----------
            const uiPage: UiDrawState['page'] = st.contactActive
              ? 'contact'
              : stage === 'tie'
                ? 'tie'
                : st.view === 'work' || st.view === 'hero'
                  ? 'work'
                  : 'about';
            ui?.draw({
              page: uiPage,
              activeNav: st.contactActive ? 'contact' : st.view === 'about' ? 'about' : 'work',
              mobile: w < 1024,
              fade: swFade,
              menuOpen,
              time,
              mode: uiModeDamped,
              tieCopy: tieCopyOpacity,
              headerless: nav != null,
              // 详情子页：canvas UI 只画子页顶栏（logo + Close），随页面一起过桶形畸变
              projectOpen,
              // projects 段激活项目 → 棱柱标题下绘制 View Project 入口行（原站 projects-view）
              // 与 titlePrism / 点击映射同源：SELECTED_PROJECTS[index] 直取
              projectIndex:
                !st.contactActive && st.view === 'work' && stage !== 'tie'
                  ? ((work.index % SELECTED_PROJECTS.length) + SELECTED_PROJECTS.length) % SELECTED_PROJECTS.length
                  : undefined,
            });
            (window as any).__ui = ui;
            (window as any).__uiVisible = ui ? ui.visibleRegions() : 'UI-NULL';
            const uiModeTarget = st.theme === 'dark' ? 1 : 0;
            uiModeDamped += (uiModeTarget - uiModeDamped) * Math.min(1, dt * 8);
            // 子页打开时 UI 层转为「子页顶栏集」（draw 只画 logo + Close），仍需可见；
            // 隐藏的只是胶片页 navbar 层（compose 的 navVisible=0）
            const uiTransTarget = projectOpen || st.uiVisible || st.view === 'hero' || st.view === 'work' ? 1 : 0;
            // 子页打开时 UI 以更快速率淡出（原站转场帧里 navbar/标题是渐隐而非瞬切）
            const uiRate = projectOpen ? 14 : 8;
            uiTransitionDamped += (uiTransTarget - uiTransitionDamped) * Math.min(1, dt * uiRate);
            if (ui) {
              const hit = uiHit(mouse.cssX, mouse.cssY);
              logoHoverDamped += ((hit === 'logo' ? 1 : 0) - logoHoverDamped) * Math.min(1, dt * 10);
              actionHoverDamped += ((hit === 'book' || hit === 'burger' ? 1 : 0) - actionHoverDamped) * Math.min(1, dt * 10);
            }
            // navbar uikit 层逐帧驱动（spring/菜单动画/镜像/双 RT 渲染）
            // 子页打开时冻结 navbar 绘制：合成链的 uiTransition 已收敛到 0，旧纹理不可见
            navMenuT += ((menuOpen ? 1 : 0) - navMenuT) * Math.min(1, dt * 10);
            if (nav && !projectOpen) {
              await nav.update(
                {
                  activeNav: st.contactActive
                    ? 'contact'
                    : st.view === 'about'
                      ? 'about-us'
                      : st.view === 'work'
                        ? 'projects'
                        : 'hero',
                  menuT: navMenuT,
                  logoHover: logoHoverDamped,
                  actionHover: actionHoverDamped,
                  uiMode: uiModeDamped,
                },
                dt,
                renderer,
              );
            }

            // ---------- 项目子页逐帧推进（必须先于 film 渲染） ----------
            // 画格蒙版按 screenUV 采样子页 grainFBO —— 若 grainFBO 在 film 之后才渲，
            // WebGPU 侧「先采样后写入」的跨帧资源状态容易拿到空绑定（画格内全黑的根因之一）；
            // 提前到 film 前即「先写后读」的常规 pass 顺序，画格内永远拿到本帧内容。
            // enter 已统一在 openProject 创建完成回调里调用（原站 Loading 消失即刻转场）。
            if (projectActive && projectExp) {
              await projectExp.frame(dt, time);
            }

            // ---------- 逐页 RT 渲染（renderRange ≈ start − max(beforeStart, 转场 TL)，stale 尾部同原站） ----------
            // 依赖顺序：office → film（蒙版按屏幕坐标采样）/ about（折页下层）；contact → tie → reveal
            const dynEnd = shredStart + ENDING_SCREENS;
            const dynRevealEnd = dynEnd + REVEAL_SCREENS;
            const dynTieEnd = dynRevealEnd + TIE_SCREENS;

            if (office && officeRT && scroll >= 1.25 && scroll < 4.45) {
              officeFrame(time, dt, officeProgress);
              renderer.setClearColor(CLEAR_PAPER, 1);
              renderer.setRenderTarget(officeRT);
              await (renderer as any).renderAsync(office.scene, office.camera);
            }
            if (filmRT && scroll < 2.0) {
              // 胶片场景逐帧推进（弹簧/图集上传/蒙版 uniform 都在 update 里）
              const filmSpring = projectActive && projectExp ? Math.min(1, Math.max(0, projectExp.getSpring())) : 0;
              workScene.update(dt, time, {
                mouseX: mouse.x,
                mouseY: mouse.y,
                selectedIndex: work.index,
                dragPx: work.dragPx,
                pageScroll: scroll,
                // 子页开启时不用 projects→office 的 exit 蒙版
                exitProgress: projectActive ? 0 : mask,
                // 转场镜头推近（原站入场核心形态）：spring 0.12→0.7 画格 zoom 1→3；
                // 直链 boot 后直接满值（不走蒙版/推近）
                frameZoom: projectActive && projectExp
                  ? (projectZoomReveal
                    ? 1 + (FRAME_ZOOM_PEAK - 1) * smoothstep(0.12, 0.7, filmSpring)
                    : FRAME_ZOOM_PEAK)
                  : 1,
              });
              // 胶片蒙版：激活画格内按屏幕坐标混入 office 页 RT（原件 transitionTexture）
              workScene.setTransitionTexture(!projectActive && mask > 0 && officeRT ? officeRT.texture : null);
              // 详情子页：激活画格当遮罩，spring 前 1/3 完成画格内揭示
              workScene.setFrameTexture(projectActive && projectZoomReveal && projectExp ? projectExp.getTexture() : null);
              workScene.setFrameProgress(
                projectActive && projectZoomReveal ? Math.min(1, filmSpring * FRAME_REVEAL_GAIN) : 0
              );
              renderer.setRenderTarget(filmRT);
              await (renderer as any).renderAsync(workScene.scene, workScene.camera);
            }
            if (hero && heroRT && scroll < 1.0) {
              renderer.setRenderTarget(heroRT);
              await (renderer as any).renderAsync(hero.scene, hero.camera);
            }
            // about-us 页 RT：折页 quad（office 在下、纸面在上、alpha=覆盖度）→ 纸页 → 碎纸机
            if (aboutRT && scroll >= FOLD_LEAD_SCREENS - 0.05 && scroll < dynEnd + 0.05) {
              renderer.setClearColor(CLEAR_TRANSPARENT, 0);
              renderer.setRenderTarget(aboutRT);
              if (entryMat && composite && paperRT && paperScene && scroll < ABOUT_START) {
                // 折页期间 paperScene 渲纸面源纹理（enterProgress 驱动折痕）
                paperScene.update({ stage: 'paper', paperTop: 0, shred: 0, ctaTop: 0, time });
                renderer.setRenderTarget(paperRT);
                await (renderer as any).renderAsync(paperScene.scene, paperScene.camera);
                renderer.setClearColor(CLEAR_TRANSPARENT, 0);
                renderer.setRenderTarget(aboutRT);
                entryMat.uEnter.value = foldEnter;
                composite.mesh.material = entryMat.mat;
                await (renderer as any).renderAsync(composite.scene, composite.camera);
              } else if (paperScene && scroll >= ABOUT_START && scroll < shredStart) {
                paperScene.update({ stage: 'paper', paperTop, shred: 0, ctaTop: 0, time });
                await (renderer as any).renderAsync(paperScene.scene, paperScene.camera);
                const hotspot = paper?.hotspots[0];
                if (hotspot && hotspotRef.current) {
                  const x = hotspot.x * scale;
                  const y = paperTop + hotspot.y * scale;
                  const hw = hotspot.w * scale;
                  const hh = hotspot.h * scale;
                  const visible = y + hh > 0 && y < h && paperTop <= 0;
                  const el = hotspotRef.current;
                  el.style.display = visible ? 'block' : 'none';
                  el.style.left = `${x}px`;
                  el.style.top = `${y}px`;
                  el.style.width = `${hw}px`;
                  el.style.height = `${hh}px`;
                }
              } else if (scroll >= shredStart) {
                if (!wasEnding && shredder) {
                  shredder.reset();
                  wasEnding = true;
                }
                if (shredder) {
                  await shredder.update(renderer, {
                    shred,
                    time,
                    dt,
                    mouseX: mouse.x,
                    mouseY: mouse.y,
                  });
                  // shredder.update 内部的 Verlet 模拟会自行 setRenderTarget 到模拟 RT，
                  // 渲碎纸机场景前必须重新绑定 aboutRT（合并前显式重绑 shredderRT 的同款做法）
                  renderer.setClearColor(CLEAR_TRANSPARENT, 0);
                  renderer.setRenderTarget(aboutRT);
                  await (renderer as any).renderAsync(shredder.scene, shredder.camera);
                }
              }
              renderer.setRenderTarget(null);
            }
            // golden-tie 页 RT（内部用 nextRT 采样 contact 页做转场；又被 reveal 的星形窗口采样）
            if (tie && tieRT && scroll >= tieStart - 1.8 && scroll < dynTieEnd + 0.05) {
              if (contact && nextRT) {
                if (!contactUpdated) {
                  contact.update(dt, time, {
                    enterScreens: scroll - contactStart,
                    lengthScreens: contact.length(),
                    mouseX: mouse.x,
                    mouseY: mouse.y,
                    touch: 'ontouchstart' in window,
                  });
                  contactUpdated = true;
                }
                renderer.setClearColor(CLEAR_CONTACT, 1);
                renderer.setRenderTarget(nextRT);
                await (renderer as any).renderAsync(contact.scene, contact.camera);
              }
              tie.update({
                dolly: tieDolly,
                handshake: tieHandshake,
                transition: tieTransition,
                flash: tieFlash,
                pin: tiePin,
                time,
                dt,
                mouseX: mouse.x,
                mouseY: mouse.y,
                contactTexture: nextRT?.texture ?? null,
                contactW: rtW,
                contactH: rtH,
              });
              renderer.setClearColor(CLEAR_CONTACT, 1);
              renderer.setRenderTarget(tieRT);
              await (renderer as any).renderAsync(tie.scene, tie.camera);
            }
            // golden-tie-reveal 页 RT（星形窗口采样 tieRT；碎纸段窗口保持空采样——合并前语义）
            if (reveal && revealRT && scroll >= shredStart - 0.1 && scroll < dynRevealEnd + 0.05) {
              reveal.update({
                text: revealText,
                cards: revealCards,
                time,
                mouseX: mouse.x,
                mouseY: mouse.y,
              });
              reveal.setNextTexture(scroll >= tieStart - 1.8 && tieRT ? tieRT.texture : null, rtW, rtH);
              renderer.setClearColor(CLEAR_TRANSPARENT, 1);
              renderer.setRenderTarget(revealRT);
              await (renderer as any).renderAsync(reveal.scene, reveal.camera);
            }
            // contact 页 RT
            if (contact && contactRT && inContactRender) {
              // update 每帧一次：tie 转场分支（1284 窗口）已更新过则跳过，防烟雾双速/弹簧双步
              if (!contactUpdated) {
                contact.update(dt, time, {
                  enterScreens: scroll - contactStart,
                  lengthScreens: contact.length(),
                  mouseX: mouse.x,
                  mouseY: mouse.y,
                  touch: 'ontouchstart' in window,
                });
                contactUpdated = true;
              }
              renderer.setClearColor(CLEAR_CONTACT, 1);
              renderer.setRenderTarget(contactRT);
              await (renderer as any).renderAsync(contact.scene, contact.camera);
            }

            // ---------- P2 星星转场：目标页 RT 强渲（领头星内芯的画面源） + 星星场景渲染 ----------
            // 原站做法：宿主每帧临时把 scroll 设为 target 取目标页纹理。本地页 RT 是条件渲，
            // 转场时目标页多半没渲 → 在这里按 toS 局部重算参数强渲对应 RT（t≥0.5 起即可，
            // 内芯 0.8 才可见，给 WebGPU 预热余量）。about 页 fromS 不可能=toIdx（同页短路），
            // about 目标页退化用 stale aboutRT。
            if (navNav && navNav.kind === 'transition' && navNav.t >= 0.5) {
              const toS = navNav.toS;
              // 强渲成功才把 RT 喂给内芯：采样从未渲染的 RT 会让 WebGPU pipeline
              // invalid，整帧被弃（星星 RT 全空、转场黑屏实证）
              navNav.toTex = null;
              try {
                if (navNav.toIdx === 0 && hero && heroRT) {
                  hero.update({ dt, time, scroll: 0, mouseX: mouse.x, mouseY: mouse.y });
                  renderer.setClearColor(CLEAR_TRANSPARENT, 1);
                  renderer.setRenderTarget(heroRT);
                  await (renderer as any).renderAsync(hero.scene, hero.camera);
                  navNav.toTex = heroRT.texture;
                } else if (navNav.toIdx === 1 && filmRT) {
                  workScene.update(dt, time, {
                    mouseX: mouse.x,
                    mouseY: mouse.y,
                    selectedIndex: work.index,
                    dragPx: 0,
                    pageScroll: toS,
                    exitProgress: 0,
                  });
                  workScene.setTransitionTexture(null);
                  renderer.setRenderTarget(filmRT);
                  await (renderer as any).renderAsync(workScene.scene, workScene.camera);
                  navNav.toTex = filmRT.texture;
                } else if (navNav.toIdx === 3 && paperScene && aboutRT) {
                  // toS=ABOUT_START：纸页顶（paperTop=0），paperScene 直渲 aboutRT（同 1304 分支）
                  paperScene.update({ stage: 'paper', paperTop: 0, shred: 0, ctaTop: 0, time });
                  renderer.setClearColor(CLEAR_TRANSPARENT, 0);
                  renderer.setRenderTarget(aboutRT);
                  await (renderer as any).renderAsync(paperScene.scene, paperScene.camera);
                  navNav.toTex = aboutRT.texture;
                } else if (navNav.toIdx === 6 && contact && contactRT) {
                  contact.update(dt, time, {
                    enterScreens: 0,
                    lengthScreens: contact.length(),
                    mouseX: mouse.x,
                    mouseY: mouse.y,
                    touch: 'ontouchstart' in window,
                  });
                  renderer.setClearColor(CLEAR_CONTACT, 1);
                  renderer.setRenderTarget(contactRT);
                  await (renderer as any).renderAsync(contact.scene, contact.camera);
                  navNav.toTex = contactRT.texture;
                }
              } catch {
                // 强渲失败不阻塞转场（内芯退化为透明）
              }
            }

            // ---------- sceneMode 合成（原件 c[0..6] + 转场类型，动态页表） ----------
            const pages: HeroPageConfig[] = paper
              ? [
                  HERO_PAGES[0],
                  HERO_PAGES[1],
                  HERO_PAGES[2],
                  { ...HERO_PAGES[3], end: dynEnd },
                  { ...HERO_PAGES[4], start: dynEnd, end: dynRevealEnd },
                  { ...HERO_PAGES[5], start: dynRevealEnd, end: dynTieEnd },
                  { ...HERO_PAGES[6], start: dynTieEnd, end: dynTieEnd + (contact?.length() ?? CONTACT_FALLBACK_SCREENS) },
                ]
              : [...HERO_PAGES];
            let idx = pages.length - 1;
            for (let e = 0; e < pages.length; e++) {
              if (scroll <= pages[e].end) {
                idx = e;
                break;
              }
            }
            const pageRTs = [heroRT, filmRT, officeRT, aboutRT, revealRT, tieRT, contactRT];
            const curPage = pages[idx];
            const nextPage = pages[idx + 1];
            const tl = nextPage ? nextPage.transitionLength : 0;
            const tt = nextPage ? smoothstep(curPage.end - tl, curPage.end, scroll) : 0;
            const tType = nextPage
              ? nextPage.transition === 'overlay'
                ? 2
                : nextPage.transition === 'below'
                  ? 3
                  : nextPage.transition === 'direct'
                    ? 1
                    : 0
              : 0;
            const pageEffects = resolvePageEffectsFor(pages, scroll);
            // 子页激活时渐混到 projectPageEffectsConfig（原件详情页参数：bloom=0 / pow1.4 /
            // sepia.1 / brightness1 / vignette0）；入场期间保持 projects 的 bloom/运动模糊，
            // 否则胶片推近的辉光会突然消失（混合权重 = 入场 reveal）
            const bootActive = bootStore.phase === 'loading' || bootStore.phase === 'warmup';
            // ---------- 项目子页逐帧：ProjectScene → GrainPass → subPageTexture ----------
            // 原站：子页 RT 就绪后先数 30 帧（onSubPageFrameRendered），再 animate(subPageTransition,1)。
            // 这里退化条件用「30 帧 或 0.6s 墙钟」——SwiftShader 下一帧可能几百 ms，纯帧数会让入场迟滞。
            let subPageFrame: {
              tex: THREE.Texture;
              mix: number;
              brightness: number;
              lens: number;
              border: number;
              zoom: number;
            } | null = null;
            let mainZoom = 1;
            if (projectActive && projectExp) {
              // frame() 已在本帧开头（film 渲染前）推进过 —— 这里只读 spring 并算覆盖参数
              /** 入场进度：点击进入用 spring（亮度+效果混合），直链 boot 后直接满值 */
              const springNow = Math.min(1, Math.max(0, projectExp.getSpring()));
              // 整页交接（原站铺满后 subPageTexture 接管）：胶片推近铺满后
              // （spring ≥ CROSSFADE_START）全屏详情页渐显覆盖，铺满的画格内容与
              // 全屏页面 1:1 重合 → 无跳变；关闭时同一 spring 回落自然倒放
              const overlayMix = projectZoomReveal
                ? smoothstep(CROSSFADE_START, CROSSFADE_END, springNow)
                : (projectClosing ? springNow : 1);
              subPageFrame = {
                tex: projectExp.getTexture(),
                mix: overlayMix,
                brightness: 1,
                // 页面 1:1 全屏覆盖：揭示交给胶片格蒙版，这里只做整页渐显（office fade 同款）
                zoom: 1,
                lens: 0.16,
                border: 0,
              };
              projectSubMix = subPageFrame.mix;
              projectSubBrightness = subPageFrame.brightness;
              // 调试探针（CDP eval 用）：当前子页 spring / 合成混合
              (window as any).__project = {
                spring: +springNow.toFixed(3),
                mix: +overlayMix.toFixed(3),
                closing: projectClosing,
              };
            }
            /** 入场进度（0=胶片页效果，1=详情页效果）：与转场同根 spring */
            const projectReveal =
              projectActive && projectExp
                ? projectZoomReveal
                  ? Math.min(1, Math.max(0, projectExp.getSpring()))
                  : 1
                : 0;
            const composeEffects = projectActive ? blendEffects(pageEffects, PROJECT_PAGE_EFFECTS, projectReveal) : pageEffects;
            if (compose) {
              await compose.render(renderer, (hero ?? workScene).scene, (hero ?? workScene).camera, {
                time,
                dt,
                portrait: window.innerHeight > window.innerWidth,
                loadingActive: bootActive,
                loadingMix: 1 - Math.min(1, Math.max(0, bootStore.spring)),
                pageScroll: scroll,
                curTexOverride: pageRTs[idx]?.texture,
                nextTexOverride: pageRTs[idx + 1]?.texture,
                sectionPage: idx,
                transition: nextPage ? { t: tt, type: tType } : null,
                navTransition: null, // 星星转场走画布 overlay（WebGPU RT 渲染不画内容，见 starTransitionScene 注释）
                subPage: subPageFrame,
                mainZoom,
                effects: composeEffects,
                ui: {
                  mode: uiModeDamped,
                  transition: uiTransitionDamped,
                  // ?uiflat=1 消融：UI 层不吃桶形畸变（隔离 navbar 变暗/错位是否来自 uiA 采样）
                  lens: ABLATE_UI_FLAT ? 0 : pageEffects.lensDistortion,
                  border: ABLATE_UI_FLAT ? 0 : pageEffects.lensDistortionBorders,
                  logoHover: logoHoverDamped,
                  pageActionHover: actionHoverDamped,
                  // 子页打开：胶片页 uikit 导航层隐藏（子页顶栏由 canvas 烘焙层单独绘制）
                  navVisible: projectOpen ? 0 : 1,
                },
              });
              // P2 星星转场 overlay：星星场景直渲画布（autoClear=false 叠在 compose 输出上）。
              // WebGPU backend 的 renderAsync-to-RT 不画内容（lab+主页面实证），走画布 overlay。
              // 内芯分辨率 = 目标页 RT 的像素尺寸（screenCoordinate 除数，原站 width·dpr 同语义）
              if (navNav && navNav.kind === 'transition' && starScene) {
                starScene.update({
                  progress: navNav.t,
                  nextSceneTexture: navNav.toTex ?? null,
                  cssW: host.clientWidth,
                  resW: rtW,
                  resH: rtH,
                });
                await starScene.render(renderer, true);
              }
            } else {
              // 无合成链兜底：直渲当前页场景
              const fallback: Array<[THREE.Object3D, THREE.Camera] | null> = [
                hero ? [hero.scene, hero.camera] : null,
                [workScene.scene, workScene.camera],
                office ? [office.scene, office.camera] : null,
                composite && entryMat ? [composite.scene, composite.camera] : null,
                reveal ? [reveal.scene, reveal.camera] : null,
                tie ? [tie.scene, tie.camera] : null,
                contact ? [contact.scene, contact.camera] : null,
              ];
              const pair = fallback[idx] ?? fallback[1];
              renderer.setRenderTarget(null);
              renderer.setClearColor(CLEAR_TRANSPARENT, 1);
              if (pair) await (renderer as any).renderAsync(pair[0], pair[1]);
              else renderer.clear();
            }
            // === debugRT 分屏铺放（合成之后、上屏即最终调试画面）===
            if (dbgRTName) {
              const rt =
                dbgRTName === 'film'
                  ? filmRT
                  : dbgRTName === 'office'
                    ? officeRT
                    : dbgRTName === 'about'
                      ? aboutRT
                      : null;
              if (rt) {
                if (!dbgQuad) {
                  dbgQuad = createFullscreenQuad();
                  // 左半 uv()（y 向上）/ 右半 screenUV（y 向下）采同一张 RT
                  dbgQuad.mesh.material.colorNode = T.mix(
                    T.texture(rt.texture, T.uv()),
                    T.texture(rt.texture, T.screenUV),
                    T.step(T.float(0.5), T.uv().x)
                  );
                  dbgQuad.mesh.material.toneMapped = false;
                }
                renderer.setRenderTarget(null);
                renderer.setClearColor(CLEAR_TRANSPARENT, 1);
                await (renderer as any).renderAsync(dbgQuad.scene, dbgQuad.camera);
              }
            }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[WorkAbout] 渲染循环抛错：', err);
        }
        if (!disposed) raf = requestAnimationFrame(() => void render());
      };
      raf = requestAnimationFrame(() => void render());

      (window as unknown as { __workAboutProbe?: unknown }).__workAboutProbe = {
        renderer,
        hero,
        workScene,
        office,
        contact,
        ui,
        get filmRT() {
          return filmRT;
        },
        get officeRT() {
          return officeRT;
        },
        get aboutRT() {
          return aboutRT;
        },
        get paper() {
          return paper;
        },
        get paperScene() {
          return paperScene;
        },
        get shredder() {
          return shredder;
        },
        get reveal() {
          return reveal;
        },
        get tie() {
          return tie;
        },
        state: st,
        work,
        compose,
        lastTime: () => lastTime,
        /** 项目子页探针（自动化验证用） */
        project: () => ({
          active: projectActive,
          pending: projectPending,
          closing: projectClosing,
          entered: projectEntered,
          spring: projectExp?.getSpring() ?? null,
          frames: projectExp?.getFrames() ?? null,
          pageCount: projectExp?.getPageCount() ?? null,
          scrollPx: projectScrollPx,
          subMix: projectSubMix,
          subBrightness: projectSubBrightness,
          debug: projectExp?.__debug() ?? null,
        }),
      };
    })().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[WorkAbout] 初始化失败：', err);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      apiRef.current = null;
      work.wheelResetTimer !== null && window.clearTimeout(work.wheelResetTimer);
      for (const id of navTimers) window.clearTimeout(id);
      navNav = null;
      // 子页资源：取消未完成的创建（代数自增）并释放已就绪实例
      projectGen++;
      projectExp?.dispose();
      projectExp = null;
      projectActive = false;
      projectPending = false;
      const probe = (window as unknown as { __workAboutProbe?: { renderer?: any } }).__workAboutProbe;
      probe?.renderer?.dispose?.();
      delete (window as unknown as { __workAboutProbe?: unknown }).__workAboutProbe;
      for (const fn of cleanups) fn();
      shredder?.dispose();
      paperScene?.dispose();
      heroRT?.dispose();
      filmRT?.dispose();
      officeRT?.dispose();
      aboutRT?.dispose();
      tieRT?.dispose();
      contactRT?.dispose();
      paperRT?.dispose();
      revealRT?.dispose();
      nextRT?.dispose();
      entryMat?.mat.dispose();
      composite?.geometry.dispose();
      composite?.mesh.material.dispose();
      const canvas = host.querySelector('canvas');
      if (canvas) canvas.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="wa-host"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: mode === 'contact' ? '#040405' : '#101225',
        touchAction: 'none',
      }}
    >
      {/* chrome UI（header/导航/箭头/提示/菜单/Contact 文案）全部由 canvas 烘焙层绘制
          （原件 uikit 路径，随场景一起过桶形畸变）；此处只留内容性覆盖层 */}

      <div ref={veilRef} className="ab-veil" aria-hidden="true" />

      {/* /work/<slug> 硬加载 boot 屏（与独立详情页同一套 BIOS：bootStore 单例 + 视频缩略图进度） */}
      {bootProject && !bootDone && <WorkDetailBootOverlay project={bootProject} onDone={() => setBootDone(true)} />}

      {/* SPA 点击进入的兜底加载提示（原站同款底部「✳ Loading work...」，不遮画面） */}
      <div
        className="wd-loading"
        data-on={projectLoading ? '1' : '0'}
        style={{ display: projectLoading ? 'flex' : 'none' }}
        role="status"
        aria-label="Loading project"
        aria-hidden={!projectLoading}
      >
        Loading work...
      </div>

      <a ref={hotspotRef} className="ab-hotspot" href={BOOK_URL} aria-label="Book a Call Today" style={{ display: 'none' }}>
        Book a Call Today
      </a>
    </div>
  );
}
