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
const DAMPING = 8.2;
/** 碎纸终幕滚动长度（屏）。原站 AS=4： shredder 每滚一屏上升一屏 */
const ENDING_SCREENS = 4;
/** 进入 About 后先保留的 office 屏数（原站 office 页） */
const ENTRY_OFFICE_SCREENS = 1;
/** 原站折痕可见扫掠约 1 屏（enterProgress 前 0.85 屏不可见、后 0.75 屏已铺满，均略去） */
const FOLD_SCREENS = 1;
/** 纸页铺开结束、内容开始上滚的滚动位置（屏） */
const FOLD_END = ENTRY_OFFICE_SCREENS + FOLD_SCREENS;
/** golden-tie-reveal 页长度（原站 pagesConfig length: 1.7） */
const REVEAL_SCREENS = 1.7;
/** golden-tie 页长度（原站 pagesConfig length: 6） */
const TIE_SCREENS = 6;
/** Contact 段总长度（屏数） */
const CONTACT_SCREENS = 3.2;
/** 跳转/直链进入 Contact 时越过黑场过渡的距离（屏数） */
const CONTACT_JUMP = 0.55;
const IRIS_MS = 1050;
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
  iris: { active: boolean; captured: boolean; startedAt: number; progress: number };
  about: { s: number; target: number; shred: number };
  finalShown: boolean;
}

interface WorkState {
  index: number;
  dragPx: number;
  phase: number;
  phaseTarget: number;
  phaseVel: number;
  wheelAcc: number;
  wheelLockUntil: number;
  wheelResetTimer: number | null;
  phaseIdleTimer: number | null;
  pending: boolean;
  dragging: boolean;
  dragAxis: 'x' | 'y' | null;
  startX: number;
  startY: number;
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

function createFullscreenQuad() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 4);
  camera.position.z = 2;
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicNodeMaterial());
  scene.add(mesh);
  return { scene, camera, mesh, geometry };
}

function makeIrisMaterial(workTex: THREE.Texture, officeTex: THREE.Texture, aspect: number) {
  const mat = new THREE.MeshBasicNodeMaterial();
  const uRadius = T.uniform(0.01);
  const uTime = T.uniform(0);
  const uAspect = T.uniform(aspect);
  const uv = T.uv();
  const ruv = T.vec2(uv.x, T.float(1).sub(uv.y));
  const work = T.texture(workTex, ruv);
  const office = T.texture(officeTex, ruv);
  const d = T.length(T.vec2(uv.x.sub(0.5).mul(uAspect), uv.y.sub(0.5)));
  const reveal = T.smoothstep(uRadius, uRadius.add(0.012), d);
  const rim = T.smoothstep(uRadius.sub(0.022), uRadius.sub(0.004), d).mul(
    T.float(1).sub(T.smoothstep(uRadius, uRadius.add(0.01), d))
  );
  const grain = T.fract(
    T.sin(T.dot(uv.mul(T.vec2(1920.0, 1080.0)).add(uTime.mul(61.0)), T.vec2(12.9898, 78.233))).mul(43758.5453)
  );
  const col = T.mix(office.rgb, work.rgb, reveal);
  const withRim = T.mix(col, T.vec3(0.97, 0.94, 0.84), rim.mul(0.5));
  mat.colorNode = T.vec4(withRim.add(grain.sub(0.5).mul(0.035)), 1.0);
  mat.toneMapped = false;
  mat.depthTest = false;
  mat.depthWrite = false;
  return { mat, uRadius, uTime, uAspect };
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
    // 原件可见扫掠段：m = 0.15（贴底、全遮）→ 1.268（全铺开），斜率 1.118/屏
    const mz = T.float(0.15).add(uEnter.mul(1.118));
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

export default function WorkAboutExperience({ mode }: { mode: RouteMode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const workUiHostRef = useRef<HTMLDivElement>(null);
  const finalRef = useRef<HTMLDivElement>(null);
  const tieCopyRef = useRef<HTMLDivElement>(null);
  const hotspotRef = useRef<HTMLAnchorElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const contactUiRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    startAbout: () => void;
    switchToWork: () => void;
    jumpToContact: () => void;
    jumpToAboutTop: () => void;
  } | null>(null);

  const initialView: View = mode === 'work' ? 'work' : 'about';
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>(initialView);
  const [workMounted, setWorkMounted] = useState(mode === 'work');
  const [uiVisible, setUiVisible] = useState(mode !== 'work');
  const [theme, setTheme] = useState<AboutTheme>('light');
  const [finalShown, setFinalShown] = useState(false);
  const [contactActive, setContactActive] = useState(mode === 'contact');
  const [contactPhase, setContactPhase] = useState<ContactPhase>('hello');

  const stateRef = useRef<ExperienceState>({
    ready: false,
    view: initialView,
    uiVisible: mode !== 'work',
    theme: 'light',
    contactActive: mode === 'contact',
    iris: { active: false, captured: false, startedAt: 0, progress: 0 },
    about: { s: mode === 'contact' ? -1 : 0, target: mode === 'contact' ? -1 : 0, shred: 0 },
    finalShown: false,
  });

  const workRef = useRef<WorkState>({
    index: 0,
    dragPx: 0,
    phase: 0,
    phaseTarget: 0,
    phaseVel: 0,
    wheelAcc: 0,
    wheelLockUntil: 0,
    wheelResetTimer: null,
    phaseIdleTimer: null,
    pending: false,
    dragging: false,
    dragAxis: null,
    startX: 0,
    startY: 0,
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
      if (st.view === 'work') apiRef.current?.startAbout();
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
    const initialContactMode = mode === 'contact';
    let contactUiOn = false;
    let wasEnding = false;
    let rtW = 1;
    let rtH = 1;
    let officeRT: THREE.RenderTarget | null = null;
    let paperRT: THREE.RenderTarget | null = null;
    let workRT: THREE.RenderTarget | null = null;
    let composite: ReturnType<typeof createFullscreenQuad> | null = null;
    let irisMat: ReturnType<typeof makeIrisMaterial> | null = null;
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
      const shredStart = FOLD_END + (paper.ctaY * scale) / Math.max(1, window.innerHeight);
      return shredStart + ENDING_SCREENS + REVEAL_SCREENS + TIE_SCREENS;
    };

    const workFrame = (time: number, dt: number) => ({
      time,
      dt,
      portrait: window.innerHeight > window.innerWidth,
      loadingActive: false,
      loadingMix: 0,
      pageScroll: HERO_TIMELINE.total,
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
      if (paperRT) paperRT.dispose();
      if (workRT) workRT.dispose();
      if (revealRT) revealRT.dispose();
      if (shredderRT) shredderRT.dispose();
      if (nextRT) nextRT.dispose();
      officeRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      paperRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      workRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      revealRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      shredderRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      nextRT = new THREE.RenderTarget(rtW, rtH, { depthBuffer: true });
      if (composite && irisMat && entryMat) {
        irisMat.mat.dispose();
        entryMat.mat.dispose();
      }
      if (!composite) composite = createFullscreenQuad();
      irisMat = makeIrisMaterial(workRT.texture, officeRT.texture, host.clientWidth / Math.max(1, host.clientHeight));
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
      st.iris.captured = false;
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

    const startAbout = () => {
      if (!st.ready || st.iris.active || st.view !== 'work') return;
      if (work.phaseIdleTimer !== null) {
        window.clearTimeout(work.phaseIdleTimer);
        work.phaseIdleTimer = null;
      }
      work.pending = false;
      work.dragging = false;
      work.dragAxis = null;
      work.dragPx = 0;
      document.body.style.cursor = '';
      st.iris.active = true;
      st.iris.captured = false;
      st.iris.startedAt = 0;
      st.iris.progress = 0;
      st.about.s = 0;
      st.about.target = 0;
      st.about.shred = 0;
      pendingContact = false;
      setViewState('about');
      setWorkMounted(false);
      setUiVisibleState(false);
      setThemeState('light');
      setFinalState(false);
      setContactActiveState(false);
      resetContactUi();
      if (finalRef.current) finalRef.current.style.opacity = '0';
      hideHotspots();
      void ensurePaper();
    };

    const switchToWork = () => {
      if (!st.ready) return;
      st.iris.active = false;
      st.iris.captured = false;
      st.about.s = 0;
      st.about.target = 0;
      st.about.shred = 0;
      st.finalShown = false;
      pendingContact = false;
      setFinalShown(false);
      setContactActiveState(false);
      resetContactUi();
      if (finalRef.current) finalRef.current.style.opacity = '0';
      setViewState('work');
      setWorkMounted(true);
      setUiVisibleState(false);
      setThemeState('light');
      hideHotspots();
      work.phase = 0;
      work.phaseTarget = 0;
      work.phaseVel = 0;
      work.dragPx = 0;
      work.pending = false;
      work.dragging = false;
      work.dragAxis = null;
      work.wheelAcc = 0;
      if (work.phaseIdleTimer !== null) {
        window.clearTimeout(work.phaseIdleTimer);
        work.phaseIdleTimer = null;
      }
      if (work.wheelResetTimer !== null) {
        window.clearTimeout(work.wheelResetTimer);
        work.wheelResetTimer = null;
      }
    };

    const jumpToAboutTop = () => {
      if (!st.ready) return;
      st.iris.active = false;
      st.iris.captured = false;
      st.about.s = 0;
      st.about.target = 0;
      st.about.shred = 0;
      pendingContact = false;
      setViewState('about');
      setWorkMounted(false);
      setUiVisibleState(true);
      setThemeState('light');
      setFinalState(false);
      setContactActiveState(false);
      resetContactUi();
      if (finalRef.current) finalRef.current.style.opacity = '0';
      hideHotspots();
      void ensurePaper();
    };

    const jumpToContact = () => {
      if (!st.ready) return;
      if (st.view === 'work') {
        st.iris.active = false;
        st.iris.captured = false;
        work.pending = false;
        work.dragging = false;
        work.dragAxis = null;
        work.dragPx = 0;
        document.body.style.cursor = '';
        st.about.s = -1;
        st.about.target = 0;
        pendingContact = true;
        setViewState('about');
        setWorkMounted(false);
        setUiVisibleState(true);
        setThemeState('light');
        setFinalState(false);
        resetContactUi();
        if (finalRef.current) finalRef.current.style.opacity = '0';
        hideHotspots();
        void ensurePaper();
        return;
      }
      const contactStart = getContactStart();
      if (contactStart === null) {
        pendingContact = true;
        void ensurePaper();
      } else if (st.about.s < contactStart) {
        // 从 About 页面里点导航跳过来：先落到黑场起点，再让阻尼把镜头带进 Hello
        st.about.s = contactStart + 0.02;
        st.about.target = contactStart + CONTACT_JUMP;
      }
      setUiVisibleState(true);
      setThemeState('light');
      setFinalState(false);
      setContactActiveState(true);
      if (finalRef.current) finalRef.current.style.opacity = '0';
      hideHotspots();
    };

    apiRef.current = { startAbout, switchToWork, jumpToContact, jumpToAboutTop };

    const finishIris = () => {
      st.iris.active = false;
      st.iris.progress = 1;
      setUiVisibleState(true);
      setContactActiveState(false);
      resetContactUi();
      if (window.location.hash.split('?')[0] !== '#about-us') {
        window.location.hash = '#about-us';
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!st.ready) return;
      if (document.body.dataset.aboutMenu === '1') return;
      e.preventDefault();
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= 16;
        dy *= 16;
      } else if (e.deltaMode === 2) {
        dx *= host.clientWidth;
        dy *= host.clientHeight;
      }

      if (st.view === 'work' && !st.iris.active) {
        if (Math.abs(dx) > Math.abs(dy)) {
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
        work.phaseTarget = clamp(work.phaseTarget + dy / (1.6 * window.innerHeight), 0, 1);
        if (work.phaseIdleTimer !== null) window.clearTimeout(work.phaseIdleTimer);
        work.phaseIdleTimer = window.setTimeout(() => {
          work.phaseIdleTimer = null;
          if (work.phaseTarget >= 0.5) startAbout();
          else work.phaseTarget = 0;
        }, 160);
        return;
      }

      if (st.view === 'about' && !st.iris.active) {
        const aim = st.about as { s: number; target: number; shred: number };
        aim.target = clamp(aim.target + dy / window.innerHeight, 0, 1e6);
        if (Math.abs(dx) > Math.abs(dy) * 1.4) return;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = 1 - (e.clientY / window.innerHeight) * 2;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!st.ready || st.iris.active) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-sw-ui],[data-ab-ui],.ab-hotspot,.ab-menu,.ab-final')) return;
      if (e.button !== 0) return;
      if (st.view === 'work') {
        work.pending = true;
        work.dragging = false;
        work.dragAxis = null;
        work.startX = e.clientX;
        work.startY = e.clientY;
        work.lastD = 0;
      } else {
        work.pending = true;
        work.dragging = false;
        work.dragAxis = 'y';
        work.startY = e.clientY;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!work.pending || st.iris.active) return;
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
          work.phaseTarget = clamp(work.phaseTarget - dy / (1.6 * window.innerHeight), 0, 1);
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
        if (work.dragAxis === 'y') {
          work.dragPx = 0;
          if (work.phaseTarget >= 0.5) startAbout();
          else work.phaseTarget = 0;
          return;
        }
        work.dragPx = 0;
        if (Math.abs(work.lastD) > 0.1 * window.innerWidth) {
          work.index += work.lastD > 0 ? -1 : 1;
        }
      } else {
        work.dragging = false;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!st.ready || st.iris.active) return;
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (st.view === 'work') {
        if (e.key === 'ArrowLeft') work.index -= 1;
        else if (e.key === 'ArrowRight') work.index += 1;
        else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
          e.preventDefault();
          startAbout();
        }
        return;
      }
      const aim = st.about;
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
      if (work.phaseIdleTimer !== null) window.clearTimeout(work.phaseIdleTimer);
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

          if (st.view === 'work' && !st.iris.active) {
            work.phaseVel += (90 * (work.phaseTarget - work.phase) - 14 * work.phaseVel) * dt;
            work.phase += work.phaseVel * dt;
            if (work.phase < 0 && work.phaseTarget === 0 && Math.abs(work.phaseVel) < 0.05) {
              work.phase = 0;
              work.phaseVel = 0;
            }
            const phase = clamp(work.phase, 0, 1);
            const uiEl = workUiHostRef.current?.firstElementChild as HTMLElement | null;
            if (uiEl) {
              const fade = 1 - Math.min(1, phase * 2.4);
              uiEl.style.setProperty('--sw-ui-fade', String(fade));
              uiEl.toggleAttribute('data-ui-hidden', fade < 0.05);
            }
            workScene.update(dt, time, {
              mouseX: mouse.x,
              mouseY: mouse.y,
              selectedIndex: work.index,
              dragPx: work.dragPx,
              scrollPhase: phase,
            });
            if (compose) {
              await compose.render(renderer, workScene.scene, workScene.camera, workFrame(time, dt));
            } else {
              renderer.setRenderTarget(null);
              await (renderer as any).renderAsync(workScene.scene, workScene.camera);
            }
          } else if (st.iris.active) {
            officeFrame(time, dt, 0);
            if (!st.iris.captured && compose && workRT) {
              await compose.renderToTarget(
                renderer,
                workScene.scene,
                workScene.camera,
                workFrame(time, dt),
                workRT
              );
              st.iris.captured = true;
              st.iris.startedAt = performance.now();
            }
            if (st.iris.captured) {
              const t = clamp((performance.now() - st.iris.startedAt) / IRIS_MS, 0, 1);
              const eased = 1 - Math.pow(1 - t, 2.35);
              st.iris.progress = t;
              if (t > 0.52) setUiVisibleState(true);
              const radius = 0.012 + eased * 1.45;
              if (compose && officeRT && irisMat && composite && renderer) {
                await compose.renderToTarget(renderer, office.scene, office.camera, workFrame(time, dt), officeRT);
                irisMat.uRadius.value = radius;
                irisMat.uTime.value = time;
                irisMat.uAspect.value = host.clientWidth / Math.max(1, host.clientHeight);
                composite.mesh.material = irisMat.mat;
                renderer.setRenderTarget(null);
                await (renderer as any).renderAsync(composite.scene, composite.camera);
                if (t >= 1) finishIris();
              } else {
                finishIris();
              }
            }
          } else {
            const h = window.innerHeight;
            const w = window.innerWidth;
            const aim = st.about;
            const scale = paper ? w / paper.width : 1;
            const shredStart = paper ? FOLD_END + (paper.ctaY * scale) / h : 1e9;
            const revealStart = paper ? shredStart + ENDING_SCREENS : 1e9;
            const tieStart = paper ? revealStart + REVEAL_SCREENS : 1e9;
            const tieEnd = tieStart + TIE_SCREENS;
            const contactStart = paper ? tieEnd : 1e9;
            const maxS = paper ? contactStart + CONTACT_SCREENS : 1;

            if (pendingContact && paper) {
              aim.s = contactStart + CONTACT_JUMP;
              aim.target = aim.s;
              pendingContact = false;
            }
            if (aim.s < 0) aim.s = 0;

            aim.target = clamp(aim.target, 0, maxS);
            const diff = aim.target - aim.s;
            aim.s += diff * (1 - Math.exp(-DAMPING * dt));
            if (Math.abs(diff) < 0.0004) aim.s = aim.target;
            const s = clamp(aim.s, 0, maxS);
            const inContact = !!paper && s >= contactStart;
            const stage: 'paper' | 'ending' | 'reveal' | 'tie' | 'contact' = inContact
              ? 'contact'
              : s >= tieStart
                ? 'tie'
                : s >= revealStart
                  ? 'reveal'
                  : s >= shredStart
                    ? 'ending'
                    : 'paper';
            const contactP = inContact ? clamp((s - contactStart) / CONTACT_SCREENS, 0, 1) : 0;
            /** 进入 Contact 的位移，单位：屏（s 本身是屏单位，不是像素） */
            const contactEnterScreens = inContact ? s - contactStart : 0;
            const shred = stage === 'paper' ? 0 : clamp((s - shredStart) / ENDING_SCREENS, 0, 1);
            st.about.shred = shred;
            // 原站：铺开期间纸面固定在页首，折痕扫过；铺开后才开始卷动内容
            const foldProgress = clamp((s - ENTRY_OFFICE_SCREENS) / FOLD_SCREENS, 0, 1);
            const paperTop = s < FOLD_END ? 0 : -(s - FOLD_END) * h;
            const officeProgress = clamp(s, 0, 1);

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

            if (stage === 'paper') {
              setThemeState(s >= FOLD_END ? 'dark' : 'light');
            } else {
              setThemeState('light');
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
            } else if (paperScene && paper) {
              wasEnding = false;
              officeFrame(time, dt, officeProgress);
              paperScene.update({
                stage: 'paper',
                paperTop,
                shred: 0,
                ctaTop: 0,
                time,
              });

              if (finalRef.current) finalRef.current.style.opacity = '0';
              setFinalState(false);
              host.style.background = '#0b0b0b';
              const hotspot = paper.hotspots[0];
              if (hotspot && hotspotRef.current) {
                const x = hotspot.x * scale;
                const y = paperTop + hotspot.y * scale;
                const hw = hotspot.w * scale;
                const hh = hotspot.h * scale;
                const visible = s >= FOLD_END && y + hh > 0 && y < h && paperTop <= 0;
                const el = hotspotRef.current;
                el.style.display = visible ? 'block' : 'none';
                el.style.left = `${x}px`;
                el.style.top = `${y}px`;
                el.style.width = `${hw}px`;
                el.style.height = `${hh}px`;
              }
              // 原站 overlay 转场：纸页铺开期间固定在全屏，折痕从底部扫过并透出 office
              if (foldProgress < 1 && compose && officeRT && paperRT && entryMat && composite) {
                renderer.setClearColor(CLEAR_TRANSPARENT, 0);
                renderer.setRenderTarget(paperRT);
                await (renderer as any).renderAsync(paperScene.scene, paperScene.camera);
                renderer.setClearColor(CLEAR_PAPER, 1);
                await compose.renderToTarget(renderer, office.scene, office.camera, workFrame(time, dt), officeRT);
                entryMat.uEnter.value = foldProgress;
                composite.mesh.material = entryMat.mat;
                renderer.setRenderTarget(null);
                await (renderer as any).renderAsync(composite.scene, composite.camera);
              } else {
                renderer.setClearColor(CLEAR_PAPER, 1);
                renderer.setRenderTarget(null);
                await (renderer as any).renderAsync(paperScene.scene, paperScene.camera);
              }
            } else {
              wasEnding = false;
              officeFrame(time, dt, officeProgress);
              if (compose) {
                await compose.render(renderer, office.scene, office.camera, workFrame(time, dt));
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
      work.phaseIdleTimer !== null && window.clearTimeout(work.phaseIdleTimer);
      work.wheelResetTimer !== null && window.clearTimeout(work.wheelResetTimer);
      const probe = (window as unknown as { __workAboutProbe?: { renderer?: any } }).__workAboutProbe;
      probe?.renderer?.dispose?.();
      delete (window as unknown as { __workAboutProbe?: unknown }).__workAboutProbe;
      for (const fn of cleanups) fn();
      shredder?.dispose();
      paperScene?.dispose();
      officeRT?.dispose();
      paperRT?.dispose();
      workRT?.dispose();
      revealRT?.dispose();
      shredderRT?.dispose();
      nextRT?.dispose();
      belowMat?.dispose();
      irisMat?.mat.dispose();
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
