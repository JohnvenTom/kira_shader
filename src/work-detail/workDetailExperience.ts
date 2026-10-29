/**
 * WorkDetailExperience —— /work/<slug> 详情页 WebGPU 体验（反编译 1:1 重建）
 *
 * 架构对照原站（_bundles/glossary-work-details.md，行号可回查）：
 *  - ProjectScene（fov65，baseZ=5，相机沿 X 平移 = scrollProgress×viewportWidth）
 *      ├ 背景板 50×50 @ z=-10（#FAFAF2）
 *      └ uikit 内容条（7 视口宽 px 布局：文字块 750 + 媒体卡行 + Next 面板）
 *  - GrainPass（fov65 z=10 视差颗粒相机 + 纸色映射/三层 hash 颗粒 quad，采样 ProjectScene FBO）
 *  - heroCompose 后期链（effects=projectPageEffectsConfig，curTexOverride=颗粒 FBO）
 *      —— 与首页同一条管线、只换参数（原站同构，04kr:36699）
 *  - subPageTransition spring(damping20/stiffness85/delay0.1)：相机 z 10→5 飞入 +
 *    合成亮度 0.5→1（v1 经 heroCompose 前的亮度 uniform 近似，卷页转场 TODO）
 *  - 媒体卡（p1）：hls.js → mux m3u8（480p/720p/1080p 档位）、缩略图→视频 0.5s 交叉淡入、
 *    NDC 视锥判定播停、SDF 软边 alpha（0.002 边 + 0.1 羽化）
 *
 * v1 简化（TODO 已知差异）：双实例卷页换页（2s curl）、portrait 分支、detail 导航条入 uikit、
 * 鼠标视差接 springMouse（暂 0）、n7() 噪声纹理用同尺寸白噪声近似（原纹理内容未取证）。
 */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { UIElement } from '../uikit/element.ts';
import { UIKitRenderer } from '../uikit/renderer.ts';
import { loadFont, type UIKitFont } from '../uikit/font.ts';
import { createHeroCompose, type HeroComposeHandle } from '../hero/heroCompose.ts';
import { PROJECT_PAGE_EFFECTS, PROJECT_CAMERA, SUBPAGE_TRANSITION, CAMERA_SPRING, CONTENT, MEDIA_CARD, GRAIN } from './workDetailConfig.ts';
import { loadMuxVideo, type MuxVideoHandle } from './videoTexture.ts';
import { nextWorkProject, type WorkProject } from './data.ts';

const N = TSL as any;
void N;

/** ProjectScene 相机在 z=0 平面的视锥高（世界单位）：2·z·tan(fov/2) */
function frustumHeight(z: number, fovDeg: number): number {
  return 2 * z * Math.tan((fovDeg * Math.PI) / 360);
}

interface CardState {
  el: UIElement;
  material: any;
  /** TSL uniform/纹理节点组（r169：纹理节点 .value 可换） */
  u: {
    uImageOpacity: any;
    uVideoOpacity: any;
    uAspectRatio: any;
    thumbNode: any;
    videoNode: any;
  };
  playbackId: string;
  preloadVideo: boolean;
  handle: MuxVideoHandle | null;
  loading: Promise<MuxVideoHandle | null> | null;
  visible: boolean;
  fade: number;
}

export interface WorkDetailExperience {
  gl: THREE.WebGPURenderer;
  /** 调试：布局尺寸快照 */
  __debug: () => Record<string, unknown>;
  /** 每帧推进（dt 秒） */
  frame: (dt: number, time: number) => Promise<void>;
  /** 目标滚动（px，页面滚轮/滚动写入；内部阻尼） */
  setScrollTarget: (px: number) => void;
  /** 内容条屏数（pageCount = 内容宽/视口宽，布局后可得） */
  getPageCount: () => number;
  /** subPageTransition 入场（挂载后调一次：spring 0→1）
   *  - cameraFlight: true = 相机 z 10→5 飞入（直链 boot 后揭示用）
   *                  false = 相机固定在 baseZ（胶片点击入场由合成链做页面缩放） */
  enter: (opts?: { cameraFlight?: boolean }) => void;
  /** subPageTransition 退场（Close 前调：spring →0，onDone 回调） */
  exit: (onDone: () => void) => void;
  resize: () => void;
  /** 已渲染帧数（原站子页 30 帧预热门：navigateToSubPage 里的 v=30） */
  getFrames: () => number;
  /** subPageTransition 当前值（0..1；宿主用它算子页亮度 0.5+0.5·t） */
  getSpring: () => number;
  /** 子页纹理（ProjectScene → GrainPass 的最终 FBO），供主合成链 subPage 采样 */
  getTexture: () => THREE.Texture;
  /** 是否运行在「外部渲染器 + 外部合成链」的嵌入模式（Selected Work 子页） */
  embedded: boolean;
  dispose: () => void;
}

/** 嵌入模式选项：主体验把自己的 WebGPU 渲染器借给详情页子场景 */
export interface WorkDetailEmbedOptions {
  /** 主体验渲染器；提供后本模块不自建 renderer / compose，只负责子页场景与纹理 */
  renderer?: THREE.WebGPURenderer;
}

export async function createWorkDetailExperience(
  host: HTMLElement,
  project: WorkProject,
  opts: WorkDetailEmbedOptions = {},
): Promise<WorkDetailExperience> {
  const embedded = !!opts.renderer;
  // ---------- 渲染器（独立页自建；嵌入模式复用主体验渲染器） ----------
  const gl = opts.renderer ?? new THREE.WebGPURenderer({ antialias: false, alpha: true, forceWebGL: !(typeof navigator !== 'undefined' && 'gpu' in navigator) });
  if (!opts.renderer) {
    await gl.init();
    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    gl.setSize(host.clientWidth, host.clientHeight);
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = 1;
    host.appendChild(gl.domElement);
  }

  // ---------- 相机 ----------
  const camera = new THREE.PerspectiveCamera(PROJECT_CAMERA.fov, host.clientWidth / host.clientHeight, PROJECT_CAMERA.near, PROJECT_CAMERA.far);
  camera.position.set(0, 0, PROJECT_CAMERA.enterZ);
  const vhWorld = frustumHeight(PROJECT_CAMERA.baseZ, PROJECT_CAMERA.fov); // z=0 平面视锥高
  const vwWorld = vhWorld * camera.aspect;

  // ---------- uikit ----------
  const [regular, medium] = await Promise.all([loadFont('/fonts/stix_regular.json'), loadFont('/fonts/stix_medium.json')]);
  const uikit = new UIKitRenderer({ color: CONTENT.textColor });
  const cards: CardState[] = [];
  let nextPanelEl0: UIElement | null = null;
  let titleEl0: UIElement | null = null;
  let textRootEl: UIElement | null = null;

  /** 文本快捷（uP） */
  const T = (text: string, opts: { font: UIKitFont; fontSize: any; lineHeight?: any; textAlign?: any }, style: any = {}) =>
    UIElement.text(text, { font: opts.font, fontSize: opts.fontSize, lineHeight: opts.lineHeight, textAlign: opts.textAlign }, style);

  /** 媒体卡（p1）：uk(aspectRatio) → mesh 槽位（TSL SDF 材质 plane） */
  function buildCard(playbackId: string, preloadVideo: boolean): UIElement {
    const aspect = MEDIA_CARD.defaultAspect;
    const thumbUrl = `/work-media/${project.uid}/${playbackId}-thumb.webp`;
    new THREE.TextureLoader().load(thumbUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      const a = t.image.width / t.image.height;
      u.uAspectRatio.value = a;
      u.thumbNode.value = t;
      el.style.aspectRatio = a;
      relayout();
    });
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    // TSL uniform 节点（r169 无 uniformTexture → N.texture(tex) 节点 .value 可换）
    const thumbNode = N.texture(white, N.uv());
    const videoNode = N.texture(white, N.uv());
    const u = {
      uImageOpacity: N.uniform(1),
      uVideoOpacity: N.uniform(0),
      uAspectRatio: N.uniform(aspect),
      thumbNode,
      videoNode,
    };
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.toneMapped = false;
    material.colorNode = N.Fn(() => {
      const soft = N.float(MEDIA_CARD.borderSoftness);
      const ar = u.uAspectRatio;
      const i = N.uv().sub(0.5).mul(N.vec2(ar, 1));
      const half = N.vec2(ar.mul(0.5), 0.5);
      const d = N.max(N.abs(i.x).sub(half.x), N.abs(i.y).sub(half.y));
      const inside = N.step(d, 0);
      const border = N.step(soft.negate(), d);
      const thumb = u.thumbNode.rgb;
      const vid = u.videoNode.rgb;
      const col = N.mix(thumb, vid, u.uVideoOpacity);
      return N.mix(N.vec4(col, inside), N.vec4(0, 0, 0, MEDIA_CARD.borderAlpha), border);
    })();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(), material);
    (plane as any).userData = { color: new THREE.Color('#fff') };
    const el = UIElement.container({
      width: 'auto',
      height: '100%',
      aspectRatio: aspect,
      positionType: 'relative',
      // 原站媒体卡是「纸色底板 + 圆角 + 内边距」的相框，视频嵌在内容盒里（re2-select-booted 实证）
      backgroundColor: '#fbfaf3',
      borderRadius: 10,
      padding: 12,
    });
    const inner = UIElement.container({ width: '100%', height: '100%', positionType: 'relative' });
    const slotWrap = UIElement.container({ width: '100%', height: '100%' });
    slotWrap.add(UIElement.meshSlot(plane, { width: '100%', height: '100%' }));
    inner.add(slotWrap);
    el.add(inner);
    const st: CardState = {
      el,
      material,
      u,
      playbackId,
      preloadVideo,
      handle: null,
      loading: null,
      visible: false,
      fade: 0,
    };
    cards.push(st);
    return el;
  }

  /** 内容条 uikit 树（glossary §5.1 逐项） */
  function buildTree(): UIElement {
    const vhPx = host.clientHeight;
    const innerMaxH = Math.min(CONTENT.innerMaxHeightCap, vhPx - 200);
    /** 文字列宽：桌面 750，窄屏按屏宽 45% 收缩（否则 1280 下正文列吃掉 59% 屏宽，
     *  右侧媒体卡会被推出屏幕——re2-select-booted 参考帧里正文列约占 44%） */
    const colW = Math.min(CONTENT.textColumn.width, Math.round(host.clientWidth * 0.45));
    /** 标题字号随列宽等比缩放：750px 列 = 100px 字（原件 lg），窄屏不换行 */
    const titleFs = Math.max(56, Math.round(CONTENT.textColumn.title.lg.fontSize * (colW / CONTENT.textColumn.width)));

    // 文字块
    const textCol = UIElement.container({
      width: colW,
      height: '100%',
      paddingLeft: CONTENT.textColumn.paddingLeft,
      paddingRight: CONTENT.textColumn.paddingRight,
      marginRight: CONTENT.textColumn.marginRight,
      flexDirection: 'column',
      flexShrink: 0,
    });
    textCol.add(UIElement.container({ height: CONTENT.textColumn.topSpacer }));
    const titleEl = T(project.title, {
      font: regular,
      fontSize: titleFs,
      lineHeight: `${titleFs}px`,
    }, {});
    titleEl0 = titleEl;
    textCol.add(titleEl);
    textCol.add(
      T(
        project.collaborator ? `${project.subtitle} with ${project.collaborator}` : project.subtitle,
        { font: regular, fontSize: { base: CONTENT.textColumn.subtitle.fontSize, lg: CONTENT.textColumn.subtitle.lg.fontSize } },
        { marginTop: 0, maxWidth: 600 },
      ),
    );
    const desc = UIElement.container({
      gap: CONTENT.textColumn.desc.gap,
      marginTop: CONTENT.textColumn.desc.marginTop,
      display: 'flex',
      flexDirection: 'column',
      maxWidth: 600,
    });
    // lg 断点覆盖（20/28/32）——uikit fontSize 走 applyViewport，容器级 lineHeight/字号给文本
    for (const p of project.descriptionParagraphs) {
      desc.add(
        T(p, {
          font: regular,
          fontSize: { base: CONTENT.textColumn.desc.fontSize, lg: CONTENT.textColumn.desc.lg.fontSize },
          lineHeight: { base: `${CONTENT.textColumn.desc.lineHeight}px`, lg: `${CONTENT.textColumn.desc.lg.lineHeight}px` },
        }),
      );
    }
    textCol.add(desc);
    const visitRow = UIElement.container({
      width: 'auto',
      marginTop: CONTENT.textColumn.visitRow.marginTop,
      flexDirection: 'row',
      alignItems: 'flex-start',
    });
    if (project.siteLink) {
      // p8：u5 underline 变体 fontSize 24 + 外链图标（图标资产 TODO 本地化，v1 文本+箭头字符）
      visitRow.add(
        T(`Visit site ↗`, { font: regular, fontSize: 24, lineHeight: '24px' }, { marginTop: 12 }),
      );
    }
    textCol.add(visitRow);
    textRootEl = textCol;

    // 媒体条（p2）：row + gap 32，卡按 mux_playback_id 去重
    // 媒体卡高度 52%：即使缩略图是 16:9，卡片也不会被推出屏宽（参考帧媒体卡约占内容高一半）
    const mediaStrip = UIElement.container({ flexDirection: 'row', gap: CONTENT.mediaStrip.gap, flexShrink: 0, height: Math.round(innerMaxH * 0.52) });
    const seen = new Set<string>();
    project.projectMedia.forEach((id, idx) => {
      if (seen.has(id)) return;
      seen.add(id);
      mediaStrip.add(buildCard(id, idx === 0));
    });

    // Next Project 面板（pq）
    const next = nextWorkPanel();
    nextPanelEl0 = next;

    // 内层（行）：[文字块 | 媒体条 | Next 面板]
    const inner = UIElement.container({ height: '100%', maxHeight: innerMaxH, flexDirection: 'row', alignItems: 'center' });
    inner.add(textCol, mediaStrip, next);

    // 根（内容条）：显式 7 视口宽（原站 sizeX=7*viewportWidth 同款——子元素相对中心
    // 定位的坐标系必须比内容宽，否则 overflow 部分会整体左移）
    const root = UIElement.container({
      width: CONTENT.rootViewports * host.clientWidth,
      gap: CONTENT.rootGap,
      paddingTop: CONTENT.rootPaddingTop,
      paddingLeft: CONTENT.rootPaddingLeft,
      paddingRight: CONTENT.rootPaddingRight,
      color: CONTENT.textColor,
      flexGrow: 0,
      height: '100%',
      marginY: 'auto',
      alignItems: 'center',
      flexDirection: 'row',
    });
    root.add(inner);
    return root;
  }

  /** Next 面板（pq 规格） */
  function nextWorkPanel(): UIElement {
    const nx = nextWorkProject(project.uid);
    const panel = UIElement.container({
      width: CONTENT.nextPanel.width,
      height: '100%',
      paddingLeft: CONTENT.nextPanel.paddingLeft,
      paddingRight: CONTENT.nextPanel.paddingRight,
      flexDirection: 'column',
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
    });
    const labelRow = UIElement.container({
      borderColor: CONTENT.nextPanel.divider,
      borderBottomWidth: 1,
      paddingBottom: 8,
    });
    labelRow.add(T('Next Project', { font: regular, fontSize: CONTENT.nextPanel.label.fontSize, lineHeight: `${CONTENT.nextPanel.label.lineHeight}px` }, { marginBottom: CONTENT.nextPanel.label.marginBottom }));
    panel.add(labelRow);
    panel.add(
      T(nx.title, {
        font: medium,
        fontSize: { base: CONTENT.nextPanel.title.fontSize, md: CONTENT.nextPanel.title.md.fontSize, lg: CONTENT.nextPanel.title.lg.fontSize },
        lineHeight: { base: `${CONTENT.nextPanel.title.lineHeight}px`, md: `${CONTENT.nextPanel.title.md.lineHeight}px`, lg: `${CONTENT.nextPanel.title.lg.lineHeight}px` },
        textAlign: 'center',
      }, { marginTop: 32 }),
    );
    panel.add(
      T(nx.collaborator ? `${nx.subtitle} with ${nx.collaborator}` : nx.subtitle, {
        font: regular,
        fontSize: CONTENT.nextPanel.subtitle.fontSize,
        lineHeight: `${CONTENT.nextPanel.subtitle.lineHeight}px`,
        textAlign: 'center',
      }, { marginTop: 16 }),
    );
    // Continue（origin-next 实证：黑色实心按钮）
    const btn = UIElement.container({
      backgroundColor: '#1a1918',
      borderRadius: 8,
      width: 111,
      height: 46,
      marginTop: 40,
      alignItems: 'center',
      justifyContent: 'center',
    });
    btn.add(T('Continue →', { font: regular, fontSize: 15, lineHeight: '15px', textAlign: 'center' }, { color: '#f4f1e8' }));
    panel.add(btn);
    return panel;
  }

  // ---------- 场景组装 ----------
  const contentScene = new THREE.Scene();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    new THREE.MeshBasicNodeMaterial({ color: CONTENT.backgroundColor }),
  );
  bg.position.set(0, 0, -10);
  contentScene.add(bg);

  const rootLayoutHeight = host.clientHeight;
  const treeRoot = buildTree();
  treeRoot.applyViewport(host.clientWidth);
  treeRoot.calculateLayout(host.clientWidth, rootLayoutHeight);
  const uikitRoot = uikit.rootObject;
  contentScene.add(uikitRoot);

  /** uikit 根定位：内容条从 x=0 起（相机 x=progress*vw 扫过），y 居中于视锥 */
  function placeUikitRoot(): void {
    const ps = vhWorld / host.clientHeight;
    uikit.setPixelSize(ps);
    // 根条左缘对齐视锥左缘（原站 position.x = 7vw/2 − vw/2 同款：progress=0 时
    // 文案从屏幕左侧起，progress 增大相机右移扫过内容条）
    const wPx = treeRoot.size.width || host.clientWidth * CONTENT.rootViewports;
    uikitRoot.position.set((wPx * ps) / 2 - vwWorld / 2, 0, 0);
  }
  placeUikitRoot();
  uikit.mount(treeRoot);
  uikit.update();

  /** 滚动上限（视口数）：内容右缘停靠在屏宽 45% 处（origin-next 实测语义）。
   *  只遍历根的 children——根是 7vw 框架，不参与内容量测。 */
  function computeProgressMax(): number {
    let right = 0;
    for (const c of treeRoot.children) {
      const walk = (el: UIElement): void => {
        const l = el.node.getComputedLeft();
        const w = el.node.getComputedWidth();
        if (w > 0) right = Math.max(right, l + w);
        for (const cc of el.children) walk(cc);
      };
      walk(c);
    }
    const contentRightWorld = (right + CONTENT.rootPaddingRight) * (vhWorld / host.clientHeight);
    return Math.max(0.05, contentRightWorld / vwWorld - 0.55);
  }
  let pageCount = computeProgressMax();

  function relayout(): void {
    treeRoot.applyViewport(host.clientWidth);
    treeRoot.calculateLayout(host.clientWidth, rootLayoutHeight);
    placeUikitRoot();
    uikit.update();
    pageCount = computeProgressMax();
  }

  // ---------- 颗粒 Pass（GrainPass） ----------
  const grainScene = new THREE.Scene();
  const grainCamera = new THREE.PerspectiveCamera(PROJECT_CAMERA.fov, camera.aspect, 0.1, 100);
  grainCamera.position.set(0, 0, 10);
  // 噪声纹理（n7()：512² 白噪声 DataTexture；原纹理内容未取证，白噪声为该查表模式的标准实现）
  const noiseData = new Uint8Array(GRAIN.noiseSize * GRAIN.noiseSize * 4);
  for (let i = 0; i < GRAIN.noiseSize * GRAIN.noiseSize; i++) {
    const v = Math.floor(Math.random() * 256);
    noiseData[i * 4] = v; noiseData[i * 4 + 1] = v; noiseData[i * 4 + 2] = v; noiseData[i * 4 + 3] = 255;
  }
  const noiseTex = new THREE.DataTexture(noiseData, GRAIN.noiseSize, GRAIN.noiseSize);
  noiseTex.wrapS = THREE.RepeatWrapping;
  noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.minFilter = THREE.LinearFilter;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.needsUpdate = true;

  const grainUniforms = {
    contentTexture: N.texture(new THREE.Texture(), N.screenUV),
    dimensions: N.uniform(new THREE.Vector2(1, 1)),
    progress: N.uniform(0),
    isPortraitDisplay: N.uniform(0),
  };
  const grainMat = new THREE.MeshBasicNodeMaterial();
  grainMat.transparent = true;
  grainMat.toneMapped = false;
  {
    // 噪声查表：n(e) = texture(uNoise, fract(e/512)).r
    const n = N.Fn(([e]: any[]) => N.texture(noiseTex, N.fract(e.div(GRAIN.noiseSize))).r);
    // grainFn(a, c)：三层颗粒（04kr:62706-62720）
    const grainFn = N.Fn(([a, c]: any[]) => {
      const r = a.mul(c);
      const a1 = n(N.floor(r.mul(0.5))).mul(0).add(n(r.mul(0.25)).mul(0.05));
      const s1 = n(a.mul(c).mul(0.6)).mul(0).add(n(a.mul(c).mul(0.03)).mul(0.05));
      const u1 = N.smoothstep(0.52, 0.92, n(r.mul(N.vec2(1.43, 0.77))).mul(0.59).add(n(r.mul(N.vec2(0.61, 1.31)).add(N.vec2(19.2, 7.4))).mul(0.41))).mul(0.25);
      return a1.add(s1).sub(u1.mul(0));
    });
    const t = grainUniforms;
    grainMat.colorNode = N.Fn(() => {
      const e = t.contentTexture.toVar();
      const r = N.mix(N.vec3(1), e.rgb, e.a);
      const i = N.vec4(r, 1).toVar();
      const s = i.rgb.toVar();
      // 纸色映射（暗端 o / 亮端 l / clamp*0.8）
      const o = N.vec3(...GRAIN.darkTone);
      const l = N.vec3(...GRAIN.paperTone);
      const u = N.clamp(s, 0, 1).pow(N.vec3(1)).mul(0.8);
      i.rgb.assign(o.add(u.mul(l.sub(o))));
      // uv（y 翻转）+ 滚动半速视差
      const A = N.vec2(N.uv().x, N.float(1).sub(N.uv().y));
      const c = t.dimensions.mul(2);
      const d = N.vec2(
        t.progress.mul(0.5).mul(N.float(1).sub(t.isPortraitDisplay.toFloat())),
        t.progress.mul(0.5).mul(t.isPortraitDisplay.toFloat()),
      );
      const h = A.add(d);
      const g = grainFn(h, c);
      const f = N.dot(i.rgb, N.vec3(0.3333333, 0.3333333, 0.3333333));
      const p = N.float(1).sub(f);
      const m = N.mix(N.float(1), N.float(1.15), e.a);
      const E = N.smoothstep(0.55, 0.98, f);
      const I = N.smoothstep(0.15, 0.9, p);
      const y = E.mul(0.3).add(0.95);
      const C = I.mul(1.6).add(1);
      const vv = N.float(4);
      const bb = N.float(1);
      const S = N.clamp(N.float(1).add(E.mul(vv.sub(1))).add(I.mul(bb.sub(1))), 0.05, 3);
      const x = N.float(1).add(g.mul(GRAIN.baseStrength).mul(y).mul(C).mul(m).mul(S).mul(bb));
      // 纸张纤维（暗部）
      const w = h.mul(c);
      const Q = n(N.vec2(w.x.mul(1.27).add(w.y.mul(0.81)), w.x.mul(-0.73).add(w.y.mul(1.11))));
      const R = N.smoothstep(0.66, 0.98, Q).mul(N.smoothstep(0.55, 0.98, p)).mul(0.05);
      i.rgb.assign(i.rgb.mul(x).add(N.vec3(R)));
      return N.clamp(i, 0, 1);
    })();
  }
  const grainQuad = new THREE.Mesh(new THREE.PlaneGeometry(2 * vwWorld, 2 * vhWorld), grainMat);
  grainScene.add(grainQuad);

  // ---------- FBO ----------
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const mkFBO = () =>
    new THREE.RenderTarget(Math.floor(host.clientWidth * dpr), Math.floor(host.clientHeight * dpr), {
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
  const projectFBO = mkFBO();
  const grainFBO = mkFBO();

  // ---------- 后期链（与首页同一条，参数换 project 页配置） ----------
  // 嵌入模式：后期由主体验合成链统一做（subPage 采样），本模块只出子页纹理
  const compose: HeroComposeHandle | null = embedded ? null : createHeroCompose(host.clientWidth, host.clientHeight);

  // ---------- 状态 ----------
  const spring = { value: 0, velocity: 0, target: 0, done: false, delay: 0 };
  const scroll = { target: 0, current: 0 };
  const cameraZ: { b: number } = { b: PROJECT_CAMERA.enterZ };
  /** 入场是否走相机 z 飞入（点击入场的缩放由合成链负责，相机保持 baseZ） */
  let cameraFlight = true;
  const offset = { s: 0 };
  const mouse = { x: 0, y: 0 };
  let portrait = false;
  /** 累计渲染帧（原站子页 30 帧预热门的计数源） */
  let frames = 0;

  const onMouse = (e: PointerEvent) => {
    mouse.x = (e.clientX / host.clientWidth - 0.5) * 2;
    mouse.y = (e.clientY / host.clientHeight - 0.5) * 2;
  };
  window.addEventListener('pointermove', onMouse);

  // ---------- 每帧 ----------
  const rawBypass = new URLSearchParams(location.search).has('wdraw');

  async function frame(dt: number, time: number): Promise<void> {
    const dtc = Math.min(0.1, Math.max(dt, 0.0001));
    if (rawBypass) {
      // 旁路：直出内容场景（二分：区分树/管线问题）
      camera.position.x = (scroll.current / host.clientHeight) * vwWorld;
      camera.lookAt(camera.position.x, 0, 0);
      uikit.update();
      gl.setRenderTarget(null);
      await gl.renderAsync(contentScene, camera);
      frames++;
      return;
    }
    // 滚动阻尼（Lenis 手感；指数趋近）
    scroll.current += (scroll.target - scroll.current) * (1 - Math.exp(-12 * dtc));
    if (Math.abs(scroll.target - scroll.current) < 0.1) scroll.current = scroll.target;
    const progress = scroll.current / host.clientHeight; // 视口数

    // subPageTransition spring（damping20/stiffness85，restDelta）
    if (!spring.done) {
      if (spring.delay > 0) {
        spring.delay = Math.max(0, spring.delay - dtc);
      } else {
        const steps = 2; // 半隐式欧拉子步（稳定性）
        const h = dtc / steps;
        for (let i = 0; i < steps; i++) {
          const a = -SUBPAGE_TRANSITION.stiffness * (spring.value - spring.target) - SUBPAGE_TRANSITION.damping * spring.velocity;
          spring.velocity += a * h;
          spring.value += spring.velocity * h;
        }
        if (Math.abs(spring.value - spring.target) < SUBPAGE_TRANSITION.restDelta && Math.abs(spring.velocity) < SUBPAGE_TRANSITION.restDelta * 10) {
          spring.value = spring.target;
          spring.done = true;
        }
      }
    }
    const mst = Math.min(1, Math.max(0, spring.value));
    const springVel = spring.velocity;

    // 相机（p9 帧内逻辑）：cameraFlight=false 时固定 baseZ（缩放交给合成链）
    const vpW = vwWorld;
    const zTarget = cameraFlight ? PROJECT_CAMERA.enterZ + (PROJECT_CAMERA.baseZ - PROJECT_CAMERA.enterZ) * mst : PROJECT_CAMERA.baseZ;
    const sZ = Math.min(Math.max(CAMERA_SPRING.velGainZ * springVel, -CAMERA_SPRING.clampZ), CAMERA_SPRING.clampZ);
    const zSpringTarget = zTarget + CAMERA_SPRING.exp * sZ;
    cameraZ.b += (zSpringTarget - cameraZ.b) * (1 - Math.exp(-CAMERA_SPRING.exp * dtc));
    const sO = Math.min(Math.max(CAMERA_SPRING.velGainOffset * springVel, -CAMERA_SPRING.clampOffset), CAMERA_SPRING.clampOffset);
    offset.s += (mst * 0.2 + CAMERA_SPRING.exp * sO - offset.s) * (1 - Math.exp(-CAMERA_SPRING.exp * dtc));

    camera.position.x = progress * vpW;
    camera.position.y = 0;
    camera.position.z = cameraZ.b;
    camera.lookAt(camera.position.x, 0, 0);
    grainCamera.position.x = 0.1 * mouse.x;
    grainCamera.position.y = offset.s - 0.1 * mouse.y;
    grainCamera.position.z = cameraZ.b;
    grainCamera.lookAt(0, 0, 0);

    // uikit 镜像
    uikit.update();

    // 媒体卡：视锥判定（NDC）→ 播停 + 交叉淡入
    for (const card of cards) {
      const rect = uikit.getElementWorldRect(card.el);
      let vis = false;
      if (rect) {
        const halfW = vpW / 2;
        vis = rect.cx + rect.w / 2 > camera.position.x - halfW && rect.cx - rect.w / 2 < camera.position.x + halfW;
      }
      if (vis && !card.visible) {
        card.visible = true;
        if (!card.handle && !card.loading) {
          card.loading = loadMuxVideo(card.playbackId, MEDIA_CARD.maxResolution()).then((h) => {
            if (h) {
              card.handle = h;
              card.u.videoNode.value = h.texture;
              h.aspect.then((a) => {
                card.u.uAspectRatio.value = a;
                card.el.style.aspectRatio = a;
                relayout();
              });
            }
            return h;
          });
        }
      } else if (!vis && card.visible) {
        card.visible = false;
      }
      if (card.visible && card.handle) {
        if (card.fade < 1) {
          card.fade = Math.min(1, card.fade + dtc / MEDIA_CARD.crossfadeDuration);
          card.u.uVideoOpacity.value = card.fade;
          if (card.fade >= 1) card.handle.play();
          else card.handle.play();
        } else card.handle.play();
      } else if (!card.visible && card.handle) {
        if (card.fade > 0) {
          card.fade = Math.max(0, card.fade - dtc / MEDIA_CARD.crossfadeDuration);
          card.u.uVideoOpacity.value = card.fade;
        }
        card.handle.pause();
      }
    }

    // 渲染 ProjectScene → FBO
    const sizeOk = gl.getDrawingBufferSize(new THREE.Vector2());
    grainUniforms.dimensions.value.set(sizeOk.x, sizeOk.y);
    grainUniforms.progress.value = progress;
    grainUniforms.isPortraitDisplay.value = portrait ? 1 : 0;
    if ((frame as any).__probe !== true) {
      (frame as any).__probe = true;
      console.error('[wd-probe]', 'pageCount=', pageCount,
        'card0.rect=', JSON.stringify(uikit.getElementWorldRect(cards[0]?.el)),
        'next.rect=', JSON.stringify(nextPanelEl0 ? uikit.getElementWorldRect(nextPanelEl0) : null),
        'rootSize=', JSON.stringify(treeRoot.size),
        'scroll.current=', scroll.current);
    }
    gl.setRenderTarget(projectFBO);
    await gl.renderAsync(contentScene, camera);
    // 颗粒 pass
    grainUniforms.contentTexture.value = projectFBO.texture;
    gl.setRenderTarget(grainFBO);
    await gl.renderAsync(grainScene, grainCamera);
    gl.setRenderTarget(null);
    frames++;

    // 嵌入模式：后期交给主体验合成链（subPage 采样），这里只出 grainFBO 纹理
    if (!compose) return;

    // 合成 + 全局后期（与首页同一条链，project 页参数）
    await compose.render(gl, contentScene, camera, {
      time,
      dt: dtc,
      portrait,
      loadingActive: false,
      loadingMix: 0,
      pageScroll: 0,
      crossfade: false,
      curTexOverride: grainFBO.texture,
      effects: PROJECT_PAGE_EFFECTS,
    });
  }

  // ---------- resize ----------
  function resize(): void {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!embedded) gl.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    grainCamera.aspect = w / h;
    grainCamera.updateProjectionMatrix();
    const pxW = Math.floor(w * dpr);
    const pxH = Math.floor(h * dpr);
    projectFBO.setSize(pxW, pxH);
    grainFBO.setSize(pxW, pxH);
    compose?.setSize(w, h);
    const newVh = frustumHeight(PROJECT_CAMERA.baseZ, PROJECT_CAMERA.fov);
    const newVw = newVh * camera.aspect;
    grainQuad.geometry.dispose();
    grainQuad.geometry = new THREE.PlaneGeometry(2 * newVw, 2 * newVh);
    relayout();
  }

  return {
    gl,
    frame,
    setScrollTarget: (px: number) => { scroll.target = px; },
    getPageCount: () => pageCount,
    enter: (opts) => {
      cameraFlight = opts?.cameraFlight ?? true;
      if (!cameraFlight) {
        // 无相机飞行：直接落 baseZ，避免首帧从 enterZ 慢慢追上（页面缩放已由合成链承担）
        cameraZ.b = PROJECT_CAMERA.baseZ;
        offset.s = 0.2;
      }
      spring.target = 1;
      spring.delay = SUBPAGE_TRANSITION.delay;
      spring.done = false;
    },
    exit: (onDone) => {
      spring.target = 0;
      spring.done = false;
      const check = () => {
        if (spring.done) onDone();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    },
    resize,
    getFrames: () => frames,
    getSpring: () => Math.min(1, Math.max(0, spring.value)),
    getTexture: () => grainFBO.texture,
    embedded,
    /**
     * 释放子页资源
     *
     * 功能：摘除指针监听、释放合成链 / FBO / 卡片 / uikit 图集 / 几何与材质
     *
     * 参数：无
     * 返回值：无
     * 异常：无
     * 注意事项：嵌入模式下渲染器与画布归主体验所有，这里必须跳过 dispose
     */
    dispose: () => {
      window.removeEventListener('pointermove', onMouse);
      compose?.dispose();
      for (const c of cards) {
        c.handle?.dispose();
        c.material.dispose();
      }
      projectFBO.dispose();
      grainFBO.dispose();
      noiseTex.dispose();
      uikit.dispose();
      bg.geometry.dispose();
      (bg.material as THREE.Material).dispose();
      grainQuad.geometry.dispose();
      grainMat.dispose();
      if (!embedded) {
        gl.dispose();
        gl.domElement.remove();
      }
    },
    __debug: () => ({
      titleSize: titleEl0?.size ?? null,
      textColSize: textRootEl?.size ?? null,
      innerSize: treeRoot.children[0]?.size ?? null,
      pageCount,
      scroll: { ...scroll },
      /** 相机 z（入场 spring 收敛应为 baseZ=5，初值 enterZ=10） */
      cameraZ: +cameraZ.b.toFixed(3),
    }),
  };
}
