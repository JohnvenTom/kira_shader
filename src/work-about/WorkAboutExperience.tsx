/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { createSelectedWorkScene } from '../selected-work/scene';
import { createAboutOfficeScene } from '../about/officeScene';
import { createAboutContactScene, AboutContactHandle } from '../about/contactScene';
import { createNavUiScene, type NavUiSceneHandle } from './navUiScene';
import { createHeroCompose } from '../hero/heroCompose';
import { createHeroScene } from '../hero/heroScene';
import { createUiCanvas, type UiCanvasHandle, type UiDrawState } from './uiCanvas';
import {
  HERO_PAGES,
  resolvePageEffectsFor,
  type HeroPageConfig,
} from '../hero/heroConfig';
import { createAboutPaper, disposeAboutPaper, AboutPaperResult } from './paperContent';
import { createAboutPaperScene, PaperSceneHandle } from './paperScene';
import { createShredderScene, ShredderSceneHandle } from './shredderScene';
import { createGoldenTieRevealScene, GoldenTieRevealHandle } from './goldenTieRevealScene';
import { createGoldenTieScene, GoldenTieSceneHandle } from './goldenTieScene';
import {
  bootStore,
} from '../boot/bootStore';
import type { AboutTheme } from './AboutUI';
import './about.css';

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
type RouteMode = View | 'contact';

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

/** 原站通用 fade 已并入合成链 sceneMode（type 0），不再需要独立 fade 材质 */

export default function WorkAboutExperience({ mode }: { mode: RouteMode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const hotspotRef = useRef<HTMLAnchorElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    startAbout: (source?: 'scroll' | 'auto') => void;
    switchToWork: () => void;
    jumpToHero: () => void;
    jumpToContact: () => void;
    jumpToAboutTop: () => void;
  } | null>(null);

  const initialView: View = mode === 'hero' ? 'hero' : mode === 'work' ? 'work' : 'about';
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
      // 全局 0 基轴：#hero 从 0 起步（boot 播放）；#selected-work 落停驻点 1.0；
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
  useEffect(() => {
    if (!ready) return;
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    const st = stateRef.current;
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

    apiRef.current = { startAbout, switchToWork, jumpToHero, jumpToContact, jumpToAboutTop };

    const onWheel = (e: WheelEvent) => {
      if (!st.ready) return;
      if (document.body.dataset.aboutMenu === '1') return;
      e.preventDefault();
      if (pendingContact) return;
      // boot 弹簧收敛前锁滚动（与 bootInteractionUnlocked 同一意图）
      if (!bootStore.springDone) return;
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
      // 直呼 API 而非改 hash——避免与帧循环的 replaceState 同帧竞态
      if (ui || nav) {
        const hit = uiHit(e.clientX, e.clientY);
        if (hit) {
          e.preventDefault();
          switch (hit) {
            case 'logo':
            case 'navHome':
            case 'menuHome':
              if (menuOpen) toggleMenu(false);
              apiRef.current?.jumpToHero();
              break;
            case 'navWork':
            case 'menuWork':
              if (menuOpen) toggleMenu(false);
              apiRef.current?.switchToWork();
              break;
            case 'navAbout':
            case 'menuAbout':
              if (menuOpen) toggleMenu(false);
              startAbout('auto');
              break;
            case 'navContact':
            case 'menuContact':
            case 'menuBook':
              if (menuOpen) toggleMenu(false);
              apiRef.current?.jumpToContact();
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
        if (yRatio < 0.15 || yRatio > 0.85) return;
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
      } else {
        work.dragging = false;
        work.dragPx = 0;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!st.ready) return;
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
      const r = new THREE.WebGPURenderer({ antialias: false, alpha: true, forceWebGL: !hasWebGPU });
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
      try {
        hero = createHeroScene(r, host, host.clientWidth, host.clientHeight, { playBoot: mode === 'hero' });
        cleanups.push(hero.dispose);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[WorkAbout] hero 场景创建失败：', err);
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
          if (!pendingContact) {
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
          const swFade = smoothstep(0.7, 0.9, scroll) * (1 - smoothstep(1.1, 1.3, scroll));

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

            // tie→contact 转场由 goldenTieScene 的火花窗口承担（原站 f5 转场板），无黑幕层
            if (veilRef.current) veilRef.current.style.opacity = '0';
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
            });
            const uiModeTarget = st.theme === 'dark' ? 1 : 0;
            uiModeDamped += (uiModeTarget - uiModeDamped) * Math.min(1, dt * 8);
            const uiTransTarget = st.uiVisible || st.view === 'hero' || st.view === 'work' ? 1 : 0;
            uiTransitionDamped += (uiTransTarget - uiTransitionDamped) * Math.min(1, dt * 8);
            if (ui) {
              const hit = uiHit(mouse.cssX, mouse.cssY);
              logoHoverDamped += ((hit === 'logo' ? 1 : 0) - logoHoverDamped) * Math.min(1, dt * 10);
              actionHoverDamped += ((hit === 'book' || hit === 'burger' ? 1 : 0) - actionHoverDamped) * Math.min(1, dt * 10);
            }
            // navbar uikit 层逐帧驱动（spring/菜单动画/镜像/双 RT 渲染）
            navMenuT += ((menuOpen ? 1 : 0) - navMenuT) * Math.min(1, dt * 10);
            if (nav) {
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
              workScene.update(dt, time, {
                mouseX: mouse.x,
                mouseY: mouse.y,
                selectedIndex: work.index,
                dragPx: work.dragPx,
                pageScroll: scroll,
                exitProgress: mask,
              });
              // 胶片蒙版：激活画格内按屏幕坐标混入 office 页 RT（原件 transitionTexture）
              workScene.setTransitionTexture(mask > 0 && officeRT ? officeRT.texture : null);
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
            const bootActive = bootStore.phase === 'loading' || bootStore.phase === 'warmup';
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
                effects: pageEffects,
                ui: {
                  mode: uiModeDamped,
                  transition: uiTransitionDamped,
                  // ?uiflat=1 消融：UI 层不吃桶形畸变（隔离 navbar 变暗/错位是否来自 uiA 采样）
                  lens: ABLATE_UI_FLAT ? 0 : pageEffects.lensDistortion,
                  border: ABLATE_UI_FLAT ? 0 : pageEffects.lensDistortionBorders,
                  logoHover: logoHoverDamped,
                  pageActionHover: actionHoverDamped,
                },
              });
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

      <a ref={hotspotRef} className="ab-hotspot" href={BOOK_URL} aria-label="Book a Call Today" style={{ display: 'none' }}>
        Book a Call Today
      </a>
    </div>
  );
}
