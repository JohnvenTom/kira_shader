/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { createSelectedWorkScene } from '../selected-work/scene';
import SelectedWorkUI from '../selected-work/SelectedWorkUI';
import { createAboutOfficeScene } from '../about/officeScene';
import { createAboutContactScene, AboutContactHandle } from '../about/contactScene';
import { createHeroCompose } from '../hero/heroCompose';
import { HERO_TIMELINE } from '../hero/heroConfig';
import { createAboutPaper, disposeAboutPaper, AboutPaperResult } from './paperContent';
import { createAboutPaperScene, PaperSceneHandle } from './paperScene';
import { createShredderScene, ShredderSceneHandle } from './shredderScene';
import { createGoldenTieRevealScene, GoldenTieRevealHandle } from './goldenTieRevealScene';
import { createGoldenTieScene, GoldenTieSceneHandle } from './goldenTieScene';
import AboutUI, { AboutTheme } from './AboutUI';
import ContactUI, { ContactPhase } from './ContactUI';
import './about.css';

const T = TSL as any;
/** Lenis 默认 `lerp: 0.1` → 阻尼系数 `lerp·60 = 6/s`（原站未改 lerp） */
const SCROLL_LERP = 6;
/** Lenis 行模式滚轮换算（100/6 px per line） */
const LENIS_LINE_HEIGHT = 100 / 6;
/** 本页时间轴的局部原点：原站全局 scroll 1.6（projects→office 的 fade 起点） */
const S_ORIGIN = 1.6;
/** Selected Work 停驻点：原站全局 scroll 1.0（projects 页起点）→ local −0.6 */
const WORK_REST_S = -0.6;
/** 原站 projects→office 页边界：全局 scroll 2.0（页配置 projects 终点）→ local 0.4 */
const PAGE_SWITCH_S = 0.4;
/** 画格蒙版：原站 exitProgress 区间 scroll 1.3 → 1.5 */
const MASK_START_SCROLL = 1.3;
const MASK_END_SCROLL = 1.5;
/** 顶部边界：向上滚过全局 0.8 后原站 snap 把页面交给 hero（本项目用路由衔接） */
const HERO_HANDOFF_SCROLL = 0.8;
/** 可滚动下限（局部）= 全局 0 */
const TOP_LIMIT_S = -S_ORIGIN;
/** 碎纸终幕滚动长度（屏）。原站 AS=4： shredder 每滚一屏上升一屏 */
const ENDING_SCREENS = 4;
/** 进入 About 前 projects→office 的通用 fade：原站 transitionLength 0.4（scroll 1.6→2.0） */
const FADE_SCREENS = 0.4;
/** office 页长度（原站 pagesConfig length 1.8） */
const OFFICE_SCREENS = 1.8;
/** About 内容起点；本时间轴 local s=0 = 原站 scroll 1.6（fade 起点） */
const ABOUT_START = FADE_SCREENS + OFFICE_SCREENS;
/** 纸卷 enterProgress 起点：原站 about.start − transitionLength = 1.8 → local 0.2 */
const FOLD_LEAD_SCREENS = 0.2;
/** 原站 enterProgress = nM(scroll, about.start−2, about.start+.6, 0, 1) 的跨度 */
const FOLD_ENTER_SPAN = 2.6;
/** 原站 about UI 起点 about.start−0.35 → local 1.85 */
const ABOUT_UI_START = ABOUT_START - 0.35;
/** golden-tie-reveal 页长度（原站 pagesConfig length: 1.7） */
const REVEAL_SCREENS = 1.7;
/** golden-tie 页长度（原站 pagesConfig length: 6） */
const TIE_SCREENS = 6;
/** Contact 段总长度（屏数） */
const CONTACT_SCREENS = 3.2;
/** 跳转/直链进入 Contact 时越过黑场过渡的距离（屏数） */
const CONTACT_JUMP = 0.55;
const BOOK_URL = 'mailto:hello@shader.se?subject=Book%20a%20call';
const CLEAR_PAPER = new THREE.Color(0x0b0b0b);
const CLEAR_CONTACT = new THREE.Color(0x040405);
const CLEAR_TRANSPARENT = new THREE.Color(0x000000);

type View = 'work' | 'about';
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
    const below = T.texture(officeTex, T.vec2(uv.x, T.float(1).sub(uv.y)));
    return T.vec4(T.mix(below.rgb, shaded, mask), 1);
  });

  mat.colorNode = build();
  return { mat, uEnter };
}

/** 原站通用 fade（transitionTypeMap.fade=0）：smoothstep 过渡两页已渲染纹理 */
function makeFadeMaterial(workTex: THREE.Texture, officeTex: THREE.Texture) {
  const mat = new THREE.MeshBasicNodeMaterial();
  const uFade = T.uniform(0);
  const uv = T.uv();
  const ruv = T.vec2(uv.x, T.float(1).sub(uv.y));
  const work = T.texture(workTex, ruv);
  const office = T.texture(officeTex, ruv);
  mat.colorNode = T.vec4(T.mix(work.rgb, office.rgb, uFade), 1.0);
  mat.toneMapped = false;
  mat.depthTest = false;
  mat.depthWrite = false;
  return { mat, uFade };
}

export default function WorkAboutExperience({ mode }: { mode: RouteMode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const workUiHostRef = useRef<HTMLDivElement>(null);
  const finalRef = useRef<HTMLDivElement>(null);
  const tieCopyRef = useRef<HTMLDivElement>(null);
  const hotspotRef = useRef<HTMLAnchorElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const contactUiRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    startAbout: (source?: 'scroll' | 'auto') => void;
    switchToWork: () => void;
    jumpToContact: () => void;
    jumpToAboutTop: () => void;
  } | null>(null);

  const initialView: View = mode === 'work' ? 'work' : 'about';
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>(initialView);
  const [workMounted, setWorkMounted] = useState(mode === 'work');
  const [uiVisible, setUiVisible] = useState(mode !== 'work');
  const [theme, setTheme] = useState<AboutTheme>(mode === 'about' ? 'dark' : 'light');
  const [finalShown, setFinalShown] = useState(false);
  const [contactActive, setContactActive] = useState(mode === 'contact');
  const [contactPhase, setContactPhase] = useState<ContactPhase>('hello');

  const stateRef = useRef<ExperienceState>({
    ready: false,
    view: initialView,
    uiVisible: mode !== 'work',
    theme: mode === 'about' ? 'dark' : 'light',
    contactActive: mode === 'contact',
    about: {
      // #about-us 直链直接落在 About 内容页首；work/contact 从 Selected Work 停驻点进入
      s: mode === 'about' ? ABOUT_START : WORK_REST_S,
      target: mode === 'about' ? ABOUT_START : WORK_REST_S,
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
    if (mode === 'about') {
      if (st.view === 'work') apiRef.current?.startAbout('auto');
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
    const mouse = { x: 0, y: 0 };
    let renderer: THREE.WebGPURenderer | null = null;
    let compose: ReturnType<typeof createHeroCompose> | null = null;
    let workScene: ReturnType<typeof createSelectedWorkScene> | null = null;
    let office: ReturnType<typeof createAboutOfficeScene> | null = null;
    let contact: AboutContactHandle | null = null;
    let paper: AboutPaperResult | null = null;
    let paperScene: PaperSceneHandle | null = null;
    let shredder: ShredderSceneHandle | null = null;
    let reveal: GoldenTieRevealHandle | null = null;
    let tie: GoldenTieSceneHandle | null = null;
    let revealRT: THREE.RenderTarget | null = null;
    let shredderRT: THREE.RenderTarget | null = null;
    let nextRT: THREE.RenderTarget | null = null;
    let belowMat: THREE.MeshBasicNodeMaterial | null = null;
    let paperPromise: Promise<void> | null = null;
    let paperToken = 0;
    /** 等纸页尺寸就绪后跳到 Contact（直链 / 从 Selected Work 进入 / 点导航） */
    let pendingContact = mode === 'contact';
    /** 程序化跳转期间暂停 snap（原站 snapLockTarget 的等价物） */
    let snapLockUntil = 0;
    const lockSnap = (ms = 1400) => {
      snapLockUntil = performance.now() + ms;
    };
    const initialContactMode = mode === 'contact';
    let contactUiOn = false;
    let wasEnding = false;
    let rtW = 1;
    let rtH = 1;
    let officeRT: THREE.RenderTarget | null = null;
    /** 未过后期的 office 原始渲染（原件 projects 页画格蒙版采样的就是这层） */
    let officeRawRT: THREE.RenderTarget | null = null;
    let paperRT: THREE.RenderTarget | null = null;
    let workRT: THREE.RenderTarget | null = null;
    let composite: ReturnType<typeof createFullscreenQuad> | null = null;
    let fadeMat: ReturnType<typeof makeFadeMaterial> | null = null;
    let entryMat: ReturnType<typeof makeFoldMaterial> | null = null;

    const setUiVisibleState = (value: boolean) => {
      if (st.uiVisible === value) return;
      st.uiVisible = value;
      setUiVisible(value);
    };
    const setThemeState = (value: AboutTheme) => {
      if (st.theme === value) return;
      st.theme = value;
      setTheme(value);
    };
    const setFinalState = (value: boolean) => {
      if (st.finalShown === value) return;
      st.finalShown = value;
      setFinalShown(value);
    };
    const setViewState = (value: View) => {
      if (st.view === value) return;
      st.view = value;
      setView(value);
    };
    let contactPhaseNow: ContactPhase = 'hello';
    const setContactPhaseState = (value: ContactPhase) => {
      if (contactPhaseNow === value) return;
      contactPhaseNow = value;
      setContactPhase(value);
    };
    const setContactActiveState = (value: boolean) => {
      if (st.contactActive === value) return;
      st.contactActive = value;
      setContactActive(value);
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

    const workFrame = (
      time: number,
      dt: number,
      pageScroll: number = HERO_TIMELINE.total,
      sectionPage?: number
    ) => ({
      time,
      dt,
      portrait: window.innerHeight > window.innerWidth,
      loadingActive: false,
      loadingMix: 0,
      pageScroll,
      // 本页的跨页淡入由外层 fadeMat 负责；合成链只处理单页
      crossfade: false,
      // projects / office 共用同一条时间轴，但场景合成参数必须各取自己那一页
      sectionPage,
    });

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
      if (officeRT) officeRT.dispose();
      if (officeRawRT) officeRawRT.dispose();
      if (paperRT) paperRT.dispose();
      if (workRT) workRT.dispose();
      if (revealRT) revealRT.dispose();
      if (shredderRT) shredderRT.dispose();
      if (nextRT) nextRT.dispose();
      officeRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      officeRawRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      paperRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      workRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      revealRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      shredderRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      nextRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      if (composite && fadeMat) {
        fadeMat.mat.dispose();
      }
      if (composite && entryMat) {
        entryMat.mat.dispose();
      }
      if (!composite) composite = createFullscreenQuad();
      fadeMat = makeFadeMaterial(workRT.texture, officeRT.texture);
      entryMat = makeFoldMaterial(officeRT.texture, paperRT.texture);
      belowMat?.dispose();
      belowMat = new THREE.MeshBasicNodeMaterial();
      {
        const uv = T.uv();
        const ruv = T.vec2(uv.x, T.float(1).sub(uv.y));
        const rv = T.texture(revealRT.texture, ruv);
        const sh = T.texture(shredderRT.texture, ruv);
        belowMat.colorNode = T.vec4(T.mix(rv.rgb, sh.rgb, sh.a), 1);
        belowMat.toneMapped = false;
        belowMat.depthTest = false;
        belowMat.depthWrite = false;
      }
    };

    const resetContactUi = () => {
      const root = contactUiRef.current;
      if (root) {
        root.style.setProperty('--ct-hello', '0');
        root.style.setProperty('--ct-info', '0');
        root.style.setProperty('--ct-footer', '0');
      }
      setContactPhaseState('hello');
      contactUiOn = false;
    };

    const resetWorkInput = () => {
      work.pending = false;
      work.dragging = false;
      work.dragAxis = null;
      work.dragPx = 0;
      document.body.style.cursor = '';
    };

    /**
     * 从 Selected Work 进入 office/About（点击提示、导航或路由直达）
     *
     * 说明：这条轴和滚轮是同一条（原站 Lenis）：这里只把 target 推到 About 内容页首，
     *      显示位置仍由 6/s 阻尼推进，途中自然经过 1.3–1.5 的画格蒙版与 1.6–2.0 的 fade。
     */
    const startAbout = (_source: 'scroll' | 'auto' = 'auto') => {
      if (!st.ready || st.view !== 'work') return;
      resetWorkInput();
      // 跳转期间抑制 snap（原站为程序化滚动设置 snapLockTarget）
      lockSnap(2600);
      st.about.target = Math.max(st.about.target, ABOUT_START);
      pendingContact = false;
      void ensurePaper();
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
      setFinalShown(false);
      setContactActiveState(false);
      resetContactUi();
      if (finalRef.current) finalRef.current.style.opacity = '0';
      setViewState('work');
      setWorkMounted(true);
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
      setWorkMounted(false);
      setUiVisibleState(true);
      setThemeState('dark');
      setFinalState(false);
      setContactActiveState(false);
      resetContactUi();
      if (finalRef.current) finalRef.current.style.opacity = '0';
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
        aim.s = contactStart + 0.02;
        aim.target = contactStart + CONTACT_JUMP;
        aim.vel = 0;
        aim.dir = 1;
        aim.inputMultiplier = 1;
        pendingContact = false;
      }
      setViewState('about');
      setWorkMounted(false);
      setUiVisibleState(true);
      setThemeState('light');
      setFinalState(false);
      setContactActiveState(true);
      if (finalRef.current) finalRef.current.style.opacity = '0';
      hideHotspots();
    };

    apiRef.current = { startAbout, switchToWork, jumpToContact, jumpToAboutTop };

    const onWheel = (e: WheelEvent) => {
      if (!st.ready) return;
      if (document.body.dataset.aboutMenu === '1') return;
      e.preventDefault();
      if (pendingContact) return;
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

      // Selected Work 的横向滚轮 = 胶片翻帧（原站 FilmReel 同款手势）
      if (st.view === 'work' && Math.abs(dx) > Math.abs(dy)) {
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
      if (st.view === 'about' && Math.abs(dx) > Math.abs(dy) * 1.4) return;

      // 纵向：统一滚动轴。原站 snap 插件在 onVirtualScroll 里先乘 inputMultiplier
      const aim = st.about;
      aim.target += (dy / window.innerHeight) * aim.inputMultiplier;
    };

    const onMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = 1 - (e.clientY / window.innerHeight) * 2;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!st.ready) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-sw-ui],[data-ab-ui],.ab-hotspot,.ab-menu,.ab-final')) return;
      if (e.button !== 0) return;
      if (st.view === 'work') {
        work.pending = true;
        work.dragging = false;
        work.dragAxis = null;
        work.startX = e.clientX;
        work.startY = e.clientY;
        work.dragStartTarget = st.about.target;
        work.lastD = 0;
      } else {
        work.pending = true;
        work.dragging = false;
        work.dragAxis = 'y';
        work.startY = e.clientY;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!work.pending) return;
      if (st.view === 'work') {
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
      if (st.view === 'work') {
        if (!work.dragging) {
          work.dragPx = 0;
          return;
        }
        work.dragging = false;
        work.dragPx = 0;
        if (work.dragAxis === 'x' && Math.abs(work.lastD) > 0.1 * window.innerWidth) {
          work.index += work.lastD > 0 ? -1 : 1;
        }
      } else {
        work.dragging = false;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!st.ready) return;
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const aim = st.about;
      if (st.view === 'work') {
        if (e.key === 'ArrowLeft') work.index -= 1;
        else if (e.key === 'ArrowRight') work.index += 1;
        else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
          e.preventDefault();
          aim.target += 0.65;
        } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
          e.preventDefault();
          aim.target -= 0.65;
        }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        aim.target += 0.65;
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        aim.target -= 0.65;
      } else if (e.key === 'Home') {
        aim.target = WORK_REST_S;
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

      workScene = createSelectedWorkScene(host.clientWidth, host.clientHeight);
      office = createAboutOfficeScene(host.clientWidth, host.clientHeight);
      contact = createAboutContactScene(host.clientWidth, host.clientHeight);
      reveal = createGoldenTieRevealScene(r, host.clientWidth, host.clientHeight);
      tie = createGoldenTieScene(r, host.clientWidth, host.clientHeight);
      cleanups.push(workScene.dispose);
      cleanups.push(office.dispose);
      cleanups.push(contact.dispose);
      cleanups.push(reveal.dispose);
      cleanups.push(tie.dispose);
      try {
        compose = createHeroCompose(host.clientWidth, host.clientHeight);
        cleanups.push(compose.dispose);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[WorkAbout] 合成管线创建失败，退化为直渲：', err);
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
          const maxS = paper ? contactStart + CONTACT_SCREENS : 1e9;

          if (pendingContact && paper) {
            aim.s = contactStart + CONTACT_JUMP;
            aim.target = aim.s;
            aim.vel = 0;
            aim.dir = 0;
            pendingContact = false;
          }

          // 顶部边界：原站从 projects 向上越过全局 0.8 后由 snap 交给 hero（这里走路由）
          if (st.view === 'work' && !pendingContact && aim.dir < 0 && aim.target + S_ORIGIN < HERO_HANDOFF_SCROLL) {
            window.location.hash = '#hero';
          }
          aim.target = clamp(aim.target, TOP_LIMIT_S, maxS);

          // 原站 snap 插件逐帧逻辑（snap-zone.txt）：只保留带 range 的 start / projects 两个锚点
          const c = Math.abs(aim.vel);
          const dir = aim.dir;
          if (!pendingContact && performance.now() >= snapLockUntil) {
            const display = aim.s + S_ORIGIN;
            const target = aim.target + S_ORIGIN;
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
                aim.target = last.position + (edge * c) / 150 - S_ORIGIN;
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

          const s = aim.s;
          /** 原站全局 scroll（屏） */
          const scroll = s + S_ORIGIN;
          /** projects 页画格蒙版：scroll 1.3 → 1.5 */
          const mask = clamp((scroll - MASK_START_SCROLL) / (MASK_END_SCROLL - MASK_START_SCROLL), 0, 1);
          /** office 页滚动进度（原站 nM(scroll, office.start, office.end, 0, 1)，fade 期间可为负） */
          const officeProgress = (s - FADE_SCREENS) / OFFICE_SCREENS;
          const fadeT = clamp(s / FADE_SCREENS, 0, 1);

          // projects ↔ office 页边界（原站 scroll 2.0）：切换视图并同步 hash（不触发路由重挂载）
          if (!pendingContact) {
            if (st.view === 'work' && s >= PAGE_SWITCH_S) {
              setViewState('about');
              setWorkMounted(false);
              setUiVisibleState(true);
              setThemeState('light');
              if (window.location.hash.split('?')[0] !== '#about-us') {
                history.replaceState(null, '', `${window.location.pathname}${window.location.search}#about-us`);
              }
            } else if (st.view === 'about' && s < PAGE_SWITCH_S) {
              setViewState('work');
              setWorkMounted(true);
              setUiVisibleState(false);
              setThemeState('light');
              if (window.location.hash.split('?')[0] !== '#selected-work') {
                history.replaceState(null, '', `${window.location.pathname}${window.location.search}#selected-work`);
              }
            }
          }

          if (st.view === 'work') {
            const uiEl = workUiHostRef.current?.firstElementChild as HTMLElement | null;
            if (uiEl) {
              // 原站 projects UI 的 uiPageOffset [0.9, 1.3]：向下滚动时在 mask 前淡出
              const fade = 1 - smoothstep(-0.5, -0.3, s);
              uiEl.style.setProperty('--sw-ui-fade', String(fade));
              uiEl.toggleAttribute('data-ui-hidden', fade < 0.05);
            }
            workScene.update(dt, time, {
              mouseX: mouse.x,
              mouseY: mouse.y,
              selectedIndex: work.index,
              dragPx: work.dragPx,
              pageScroll: scroll,
              exitProgress: mask,
            });

            // 原件 film shader 在激活画格里按屏幕坐标采样 office 原始渲染
            if (mask > 0 && office && officeRawRT) {
              officeFrame(time, dt, officeProgress);
              renderer.setClearColor(CLEAR_PAPER, 1);
              renderer.setRenderTarget(officeRawRT);
              await (renderer as any).renderAsync(office.scene, office.camera);
              renderer.setRenderTarget(null);
              workScene.setTransitionTexture(officeRawRT.texture);
            } else {
              workScene.setTransitionTexture(null);
            }

            if (s > 0.0001 && compose && workRT && officeRT && fadeMat && composite && office) {
              // 原站 projects→office 通用 fade（transition fade .2~.4，这里按页配置 0.4）
              await compose.renderToTarget(
                renderer,
                workScene.scene,
                workScene.camera,
                workFrame(time, dt, scroll, 1),
                workRT
              );
              officeFrame(time, dt, officeProgress);
              await compose.renderToTarget(
                renderer,
                office.scene,
                office.camera,
                workFrame(time, dt, scroll, 2),
                officeRT
              );
              fadeMat.uFade.value = smoothstep(0, 1, fadeT);
              composite.mesh.material = fadeMat.mat;
              renderer.setClearColor(CLEAR_TRANSPARENT, 1);
              renderer.setRenderTarget(null);
              await (renderer as any).renderAsync(composite.scene, composite.camera);
            } else if (compose) {
              await compose.render(renderer, workScene.scene, workScene.camera, workFrame(time, dt, scroll));
            } else {
              renderer.setRenderTarget(null);
              await (renderer as any).renderAsync(workScene.scene, workScene.camera);
            }
          } else {
            const inContact = !!paper && s >= contactStart;
            const stage: 'fade' | 'office' | 'paper' | 'ending' | 'reveal' | 'tie' | 'contact' = inContact
              ? 'contact'
              : s >= tieStart
                ? 'tie'
                : s >= revealStart
                  ? 'reveal'
                  : s >= shredStart
                    ? 'ending'
                    : s >= ABOUT_START
                      ? 'paper'
                      : s >= FADE_SCREENS
                        ? 'office'
                        : 'fade';
            const contactP = inContact ? clamp((s - contactStart) / CONTACT_SCREENS, 0, 1) : 0;
            /** 进入 Contact 的位移，单位：屏（s 本身是屏单位，不是像素） */
            const contactEnterScreens = inContact ? s - contactStart : 0;
            const shred = s >= shredStart ? clamp((s - shredStart) / ENDING_SCREENS, 0, 1) : 0;
            st.about.shred = shred;
            // 原站 enterProgress：about.start−2 → about.start+.6（2.6 屏）；
            // 可见折痕扫过约 1.27 屏，铺满后内容仍停在页首，直到 about.start。
            const foldEnter = clamp((s - FOLD_LEAD_SCREENS) / FOLD_ENTER_SPAN, 0, 1);
            const paperTop = s < ABOUT_START ? 0 : -(s - ABOUT_START) * h;

            // golden-tie-reveal 时间轴（原站：文案 l = (scroll-start+4)/5.6；
            // 卡片 n_((scroll-(start-3))/(end-(start-3)))，end-start=1.7）
            const revealText = clamp((s - shredStart) / 5.6, 0, 1);
            const revealCards = smootherstep(shredStart + 1, shredStart + 5.7, s);

            // golden-tie 页（原站 pagesConfig: start-2 → end-.5 相机推进；
            // 握手 A = (end-3.6 → end-.7)；墨迹 (end-1.6 → end+.5)）
            const tieDolly = clamp((s - (tieStart - 2)) / (tieEnd - 0.5 - (tieStart - 2)), 0, 1);
            const tieHandshake = clamp((s - (tieEnd - 3.6)) / 2.9, 0, 1);
            const tieTransition = smootherstep(tieEnd - 1.6, tieEnd + 0.5, s);
            const tieFlash = smoothstep(tieEnd - 1.56, tieEnd - 0.6, s);
            const tiePin = clamp((s - (tieStart - 1.5)) / (tieEnd - (tieStart - 1.5)), 0, 1);
            const tieCopyOpacity = stage === 'tie' ? 1 - smoothstep(0.02, 0.25, tieTransition) : 0;

            if (stage === 'fade') {
              // 原站 projects UI 在 fade 前已消失；office UI 从 office 页首才出现
              setUiVisibleState(false);
              setThemeState('light');
            } else {
              setUiVisibleState(true);
              if (stage === 'office' || stage === 'paper') {
                // 原站 office uiMode=light、about uiMode=dark；about UI 从 about.start−0.35 起
                setThemeState(s >= ABOUT_UI_START ? 'dark' : 'light');
              } else {
                setThemeState('light');
              }
            }

            setContactActiveState(inContact);
            if (!inContact && contactUiOn) resetContactUi();

            let veil = 0;
            if (stage === 'tie') veil = smoothstep(tieEnd - 1.2, tieEnd, s);
            else if (stage === 'contact') veil = 1 - smoothstep(0, 0.22, contactEnterScreens);
            if (veilRef.current) veilRef.current.style.opacity = String(veil);
            if (tieCopyRef.current) tieCopyRef.current.style.opacity = String(tieCopyOpacity);

            if (stage === 'contact') {
              wasEnding = false;
              setFinalState(false);
              if (finalRef.current) finalRef.current.style.opacity = '0';
              host.style.background = '#040405';
              if (hotspotRef.current) hotspotRef.current.style.display = 'none';

              contact?.update(dt, time, {
                progress: contactP,
                enter: clamp(contactEnterScreens / 0.35, 0, 1),
                mouseX: mouse.x,
                mouseY: mouse.y,
                touch: 'ontouchstart' in window,
              });

              const hello = 1 - smoothstep(0.22, 0.44, contactP);
              const info = smoothstep(0.28, 0.5, contactP) * (1 - smoothstep(0.66, 0.84, contactP));
              const footer = smoothstep(0.72, 0.92, contactP);
              const root = contactUiRef.current;
              if (root) {
                root.style.setProperty('--ct-hello', String(hello));
                root.style.setProperty('--ct-info', String(info));
                root.style.setProperty('--ct-footer', String(footer));
              }
              contactUiOn = true;
              setContactPhaseState(contactP > 0.8 ? 'footer' : contactP > 0.32 ? 'info' : 'hello');

              renderer.setClearColor(CLEAR_CONTACT, 1);
              renderer.setRenderTarget(null);
              if (contact) await renderer.renderAsync(contact.scene, contact.camera);
              else renderer.clear();
            } else if (stage === 'ending') {
              if (!wasEnding) {
                shredder?.reset();
                wasEnding = true;
              }
              if (finalRef.current) finalRef.current.style.opacity = '0';
              setFinalState(false);
              host.style.background = '#000000';
              if (hotspotRef.current) hotspotRef.current.style.display = 'none';

              if (shredder && reveal && revealRT && shredderRT && belowMat && composite) {
                // 原站 "below" 转场：golden-tie-reveal 场景垫在碎纸页下面，
                // 碎纸页以自身 alpha 叠在上面（纸被切掉的区域会透出下一场景）
                reveal.update({
                  text: revealText,
                  cards: revealCards,
                  time,
                  mouseX: mouse.x,
                  mouseY: mouse.y,
                });
                reveal.setNextTexture(null, rtW, rtH);
                renderer.setClearColor(CLEAR_TRANSPARENT, 1);
                renderer.setRenderTarget(revealRT);
                await renderer.renderAsync(reveal.scene, reveal.camera);

                await shredder.update(renderer, {
                  shred,
                  time,
                  dt,
                  mouseX: mouse.x,
                  mouseY: mouse.y,
                });
                renderer.setClearColor(CLEAR_TRANSPARENT, 0);
                renderer.setRenderTarget(shredderRT);
                await renderer.renderAsync(shredder.scene, shredder.camera);

                composite.mesh.material = belowMat;
                renderer.setClearColor(CLEAR_TRANSPARENT, 1);
                renderer.setRenderTarget(null);
                await renderer.renderAsync(composite.scene, composite.camera);
              } else {
                if (shredder) {
                  await shredder.update(renderer, {
                    shred,
                    time,
                    dt,
                    mouseX: mouse.x,
                    mouseY: mouse.y,
                  });
                }
                renderer.setClearColor(CLEAR_TRANSPARENT, 1);
                renderer.setRenderTarget(null);
                if (shredder) await renderer.renderAsync(shredder.scene, shredder.camera);
                else renderer.clear();
              }
            } else if (stage === 'reveal') {
              wasEnding = false;
              if (finalRef.current) finalRef.current.style.opacity = '0';
              setFinalState(false);
              host.style.background = '#000000';
              if (hotspotRef.current) hotspotRef.current.style.display = 'none';

              reveal?.update({
                text: revealText,
                cards: revealCards,
                time,
                mouseX: mouse.x,
                mouseY: mouse.y,
              });

              // 星形窗口采样 golden-tie 页场景
              if (tie && nextRT && reveal) {
                tie.update({
                  dolly: tieDolly,
                  handshake: tieHandshake,
                  transition: 0,
                  flash: 0,
                  pin: tiePin,
                  time,
                  dt,
                  mouseX: mouse.x,
                  mouseY: mouse.y,
                  contactTexture: null,
                  contactW: rtW,
                  contactH: rtH,
                });
                renderer.setClearColor(CLEAR_TRANSPARENT, 1);
                renderer.setRenderTarget(nextRT);
                await renderer.renderAsync(tie.scene, tie.camera);
                reveal.setNextTexture(nextRT.texture, rtW, rtH);
                renderer.setRenderTarget(null);
              }

              renderer.setClearColor(CLEAR_TRANSPARENT, 1);
              renderer.setRenderTarget(null);
              if (reveal) await renderer.renderAsync(reveal.scene, reveal.camera);
              else renderer.clear();
            } else if (stage === 'tie') {
              wasEnding = false;
              if (finalRef.current) finalRef.current.style.opacity = '0';
              setFinalState(false);
              host.style.background = '#000000';
              if (hotspotRef.current) hotspotRef.current.style.display = 'none';

              if (contact && nextRT) {
                contact.update(dt, time, {
                  progress: 0,
                  enter: 0,
                  mouseX: mouse.x,
                  mouseY: mouse.y,
                  touch: 'ontouchstart' in window,
                });
                renderer.setClearColor(CLEAR_CONTACT, 1);
                renderer.setRenderTarget(nextRT);
                await renderer.renderAsync(contact.scene, contact.camera);
                renderer.setRenderTarget(null);
              }

              tie?.update({
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
              renderer.setRenderTarget(null);
              if (tie) await renderer.renderAsync(tie.scene, tie.camera);
              else renderer.clear();
            } else if (stage === 'fade') {
              wasEnding = false;
              if (finalRef.current) finalRef.current.style.opacity = '0';
              setFinalState(false);
              host.style.background = '#0b0b0b';
              if (hotspotRef.current) hotspotRef.current.style.display = 'none';

              // 同一根轴上的 projects → office fade（view 尚未跨过页边界时的兜底分支）
              workScene.update(dt, time, {
                mouseX: mouse.x,
                mouseY: mouse.y,
                selectedIndex: work.index,
                dragPx: work.dragPx,
                pageScroll: scroll,
                exitProgress: mask,
              });
              if (mask > 0 && officeRawRT) {
                officeFrame(time, dt, officeProgress);
                renderer.setClearColor(CLEAR_PAPER, 1);
                renderer.setRenderTarget(officeRawRT);
                await (renderer as any).renderAsync(office.scene, office.camera);
                renderer.setRenderTarget(null);
                workScene.setTransitionTexture(officeRawRT.texture);
              } else {
                workScene.setTransitionTexture(null);
              }
              officeFrame(time, dt, officeProgress);
              if (compose && workRT && officeRT && fadeMat && composite) {
                await compose.renderToTarget(renderer, workScene.scene, workScene.camera, workFrame(time, dt, scroll, 1), workRT);
                await compose.renderToTarget(renderer, office.scene, office.camera, workFrame(time, dt, scroll, 2), officeRT);
                fadeMat.uFade.value = smoothstep(0, 1, fadeT);
                composite.mesh.material = fadeMat.mat;
                renderer.setClearColor(CLEAR_TRANSPARENT, 1);
                renderer.setRenderTarget(null);
                await (renderer as any).renderAsync(composite.scene, composite.camera);
              } else {
                renderer.setClearColor(CLEAR_PAPER, 1);
                renderer.setRenderTarget(null);
                await (renderer as any).renderAsync(office.scene, office.camera);
              }
            } else if (stage === 'office') {
              wasEnding = false;
              if (finalRef.current) finalRef.current.style.opacity = '0';
              setFinalState(false);
              host.style.background = '#000000';
              if (hotspotRef.current) hotspotRef.current.style.display = 'none';

              officeFrame(time, dt, officeProgress);
              paperScene?.update({ stage: 'paper', paperTop: 0, shred: 0, ctaTop: 0, time });

              // 原站 office→about overlay：office 在底，纸质折痕按 enterProgress 覆盖
              if (paperScene && compose && officeRT && paperRT && entryMat && composite) {
                renderer.setClearColor(CLEAR_TRANSPARENT, 0);
                renderer.setRenderTarget(paperRT);
                await (renderer as any).renderAsync(paperScene.scene, paperScene.camera);
                renderer.setClearColor(CLEAR_PAPER, 1);
                await compose.renderToTarget(renderer, office.scene, office.camera, workFrame(time, dt, scroll, 2), officeRT);
                entryMat.uEnter.value = foldEnter;
                composite.mesh.material = entryMat.mat;
                renderer.setRenderTarget(null);
                await (renderer as any).renderAsync(composite.scene, composite.camera);
              } else if (compose) {
                await compose.render(renderer, office.scene, office.camera, workFrame(time, dt, scroll, 2));
              } else {
                renderer.setClearColor(CLEAR_PAPER, 1);
                renderer.setRenderTarget(null);
                await (renderer as any).renderAsync(office.scene, office.camera);
              }
            } else if (paperScene && paper) {
              wasEnding = false;
              if (finalRef.current) finalRef.current.style.opacity = '0';
              setFinalState(false);
              host.style.background = '#0b0b0b';
              paperScene.update({
                stage: 'paper',
                paperTop,
                shred: 0,
                ctaTop: 0,
                time,
              });

              const hotspot = paper.hotspots[0];
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
              renderer.setClearColor(CLEAR_PAPER, 1);
              renderer.setRenderTarget(null);
              await (renderer as any).renderAsync(paperScene.scene, paperScene.camera);
            } else {
              wasEnding = false;
              officeFrame(time, dt, officeProgress);
              if (compose) {
                await compose.render(renderer, office.scene, office.camera, workFrame(time, dt, scroll, 2));
              } else {
                renderer.setRenderTarget(null);
                await (renderer as any).renderAsync(office.scene, office.camera);
              }
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
        workScene,
        office,
        contact,
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
      officeRT?.dispose();
      officeRawRT?.dispose();
      paperRT?.dispose();
      workRT?.dispose();
      revealRT?.dispose();
      shredderRT?.dispose();
      nextRT?.dispose();
      belowMat?.dispose();
      fadeMat?.mat.dispose();
      entryMat?.mat.dispose();
      composite?.geometry.dispose();
      const canvas = host.querySelector('canvas');
      if (canvas) canvas.remove();
    };
  }, []);

  const handleAboutNav = (key: 'about' | 'contact') => {
    const target = key === 'contact' ? '#contact' : '#about-us';
    // 真正改 hash（而不是 replaceState），让前进/后退和直达链接都成立；
    // 内部跳转本身是幂等的，hashchange 再次触发不会把滚动位置打回去
    if (window.location.hash.split('?')[0] !== target) {
      window.location.hash = target;
    }
    if (key === 'contact') apiRef.current?.jumpToContact();
    else apiRef.current?.jumpToAboutTop();
  };

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
      {view === 'work' && workMounted && (
        <div ref={workUiHostRef}>
          <SelectedWorkUI
            onPrev={() => {
              workRef.current.index -= 1;
            }}
            onNext={() => {
              workRef.current.index += 1;
            }}
            onScrollHint={() => apiRef.current?.startAbout()}
            onAbout={() => apiRef.current?.startAbout()}
          />
        </div>
      )}

      {view === 'about' && (
        <>
          <AboutUI
            theme={theme}
            visible={uiVisible}
            activeKey={contactActive ? 'contact' : 'about'}
            onNav={handleAboutNav}
          />
          <ContactUI ref={contactUiRef} phase={contactPhase} active={contactActive} />
        </>
      )}

      <div ref={finalRef} className="ab-final" aria-hidden={!finalShown}>
        <h2>
          <span className="ab-line-desktop">
            Still Not
            <br />
            Convinced We&apos;re
            <br />
            Serious About
            <br />
            Business?
          </span>
          <span className="ab-line-mobile">
            Still Not Convinced
            <br />
            We&apos;re Serious About
            <br />
            Business?
          </span>
        </h2>
        <p>We&apos;ve got one last trick up our sleeve.</p>
      </div>

      <div ref={tieCopyRef} className="ab-tie-copy" aria-hidden="true">
        <h2>Check Out This Golden Tie</h2>
        <p>You made it this far. You deserve a tie-break.</p>
      </div>

      <div ref={veilRef} className="ab-veil" aria-hidden="true" />

      <a ref={hotspotRef} className="ab-hotspot" href={BOOK_URL} aria-label="Book a Call Today" style={{ display: 'none' }}>
        Book a Call Today
      </a>
    </div>
  );
}
