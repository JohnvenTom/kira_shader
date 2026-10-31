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
  /** 卡尺寸约束（视频比例就绪后重算实际宽高用） */
  layout: { heightPx: number };
  handle: MuxVideoHandle | null;
  loading: Promise<MuxVideoHandle | null> | null;
  /** VideoTexture 已挂载（首帧就绪后）——之前 crossfade 保持缩略图，避免淡入到占位色 */
  videoAttached: boolean;
  /** 实例已释放（异步回调里据此放弃挂载） */
  disposed: boolean;
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
   *                  false = 相机固定在 baseZ（胶片点击入场由合成链做页面缩放）
   *  - instant: true = 跳过动画直接落位（Continue 换页的新实例用） */
  enter: (opts?: { cameraFlight?: boolean; instant?: boolean }) => void;
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
  /** Continue 卷页换页完成时回调（原站 subPage uid 变化语义）：宿主换 projectExp 引用、
   *  复位滚动、更新胶片居中索引，并 dispose 旧实例（即本实例自身） */
  onProjectSwitched?: (next: WorkDetailExperience, project: WorkProject) => void;
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
  let titleEl0: UIElement | null = null;
  let textRootEl: UIElement | null = null;

  /** 文本快捷（uP） */
  const T = (text: string, opts: { font: UIKitFont; fontSize: any; lineHeight?: any; textAlign?: any }, style: any = {}) =>
    UIElement.text(text, { font: opts.font, fontSize: opts.fontSize, lineHeight: opts.lineHeight, textAlign: opts.textAlign }, style);

  /** 媒体卡（p1）：uk(aspectRatio) → mesh 槽位（TSL SDF 材质 plane）
   *  - ownerUid  缩略图归属项目（/work-media/<uid>/<id>-thumb.webp）
   *  - heightPx  卡高（= 内层满高）；宽度 = 高 × 视频真实比例（原站无宽约束） */
  function buildCard(playbackId: string, preloadVideo: boolean, ownerUid: string, heightPx: number): UIElement {
    const aspect = MEDIA_CARD.defaultAspect;
    const thumbUrl = `/work-media/${ownerUid}/${playbackId}-thumb.webp`;
    // 实际尺寸：高固定、宽随比例（原站同款——面板宽高随媒体比例）
    const applySize = (a: number): void => {
      el.style.width = Math.round(heightPx * a);
      el.style.height = Math.round(heightPx);
    };
    new THREE.TextureLoader().load(thumbUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      const a = t.image.width / t.image.height;
      u.uAspectRatio.value = a;
      u.thumbNode.value = t;
      applySize(a);
      relayout();
    });
    // 占位纹理：纸色（原站缩略图预载后才建卡；本地异步加载——缺图时兜底显示纸色
    // 而非纯白，避免颗粒 pass 把纯白映射成比纸面更亮的白块）
    const placeholder = new THREE.DataTexture(new Uint8Array([250, 250, 242, 255]), 1, 1);
    placeholder.needsUpdate = true;
    // TSL uniform 节点（r169 无 uniformTexture → N.texture(tex) 节点 .value 可换）
    const thumbNode = N.texture(placeholder, N.uv());
    const videoNode = N.texture(placeholder, N.uv());
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
      height: heightPx,
      aspectRatio: aspect,
      positionType: 'relative',
      flexShrink: 0,
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
      layout: { heightPx },
      handle: null,
      loading: null,
      videoAttached: false,
      disposed: false,
      visible: false,
      fade: 0,
    };
    cards.push(st);
    return el;
  }

  /** Continue 按钮（Next 段）——布局后供命中测试（点击 = 原站路由语义 → 卷页换页） */
  let continueBtnEl: UIElement | null = null;

  /** 详情页内容树 —— 横向内容条（原站 bundle 实证：场景相机沿 X 扫过 7vw 内容条，
   *  #scroll-container 的纵向滚轮只是输入映射；pageCount = 内容宽/视口宽）：
   *  [文字列 | 主 mux 面板 | 媒体大卡们 | Next Project 面板] */
  function buildTree(): UIElement {
    const vwPx = host.clientWidth;
    const vhPx = host.clientHeight;
    const innerMaxH = Math.min(CONTENT.innerMaxHeightCap, vhPx - 200);
    // 文字列内容约束：原站 uP maxWidth:"80%" —— 断行实测对应 750 列的 80%（=600px，
    // subtitle 一行放下、desc 断行点与原站一致；按内容宽 658 算 526 会多换行）
    const textMaxW = Math.round(CONTENT.textColumn.width * CONTENT.textColumn.subtitle.maxWidthPct);

    // 文字块（bundle 字面值：width 750 固定、flexShrink 0，小视口下溢出由内容条吸收）
    const textCol = UIElement.container({
      width: CONTENT.textColumn.width,
      height: '100%',
      paddingLeft: CONTENT.textColumn.paddingLeft,
      paddingRight: CONTENT.textColumn.paddingRight,
      marginRight: CONTENT.textColumn.marginRight,
      flexDirection: 'column',
      justifyContent: 'center',
      flexShrink: 0,
    });
    // 标题（bundle：58/58px，sm 64，lg 100——断点字号，非列宽缩放）
    const titleEl = T(project.title, {
      font: regular,
      fontSize: {
        base: CONTENT.textColumn.title.fontSize,
        sm: CONTENT.textColumn.title.sm.fontSize,
        lg: CONTENT.textColumn.title.lg.fontSize,
      },
      lineHeight: {
        base: `${CONTENT.textColumn.title.lineHeight}px`,
        sm: `${CONTENT.textColumn.title.sm.lineHeight}px`,
        lg: `${CONTENT.textColumn.title.lg.lineHeight}px`,
      },
    }, {});
    titleEl0 = titleEl;
    textCol.add(titleEl);
    textCol.add(
      T(
        project.collaborator ? `${project.subtitle} with ${project.collaborator}` : project.subtitle,
        { font: regular, fontSize: { base: CONTENT.textColumn.subtitle.fontSize, lg: CONTENT.textColumn.subtitle.lg.fontSize } },
        { marginTop: 0, maxWidth: textMaxW },
      ),
    );
    const desc = UIElement.container({
      gap: CONTENT.textColumn.desc.gap,
      // uikit margin 不走断点解析 → 取 lg 档字面值（桌面 1:1）
      marginTop: CONTENT.textColumn.desc.lg.marginTop,
      display: 'flex',
      flexDirection: 'column',
      maxWidth: textMaxW,
    });
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
    // Visit site 行（u5 规格：24px 下划线文字 + 右侧外链图标；uikit 无 textDecoration，
    // 下划线用 borderBottomWidth 2 模拟，颜色同文字）
    const visitRow = UIElement.container({
      width: 'auto',
      // 原站 lg 档 marginTop 32（uikit margin 仅数值 → 取桌面值）
      marginTop: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    });
    if (project.siteLink) {
      // 下划线画在容器上（text 元素无 panel mesh，borderBottom 不渲染）
      const visitText = UIElement.container({
        borderBottomWidth: 2,
        borderColor: CONTENT.textColor,
        paddingBottom: 2,
      });
      visitText.add(T(`Visit site`, { font: regular, fontSize: 24, lineHeight: '24px' }, {}));
      visitRow.add(visitText);
      visitRow.add(UIElement.image(20, 1, {}, '/textures/icons/external_link.svg'));
    }
    textCol.add(visitRow);
    textRootEl = textCol;

    // 主 mux 面板（首屏右缘）+ 媒体条：卡高 = 内层满高（原站 p2 height:100%、p1 aspect 定宽，
    // 宽度完全由视频真实比例决定——原站无最大宽约束）
    const mainCard = buildCard(project.muxPlaybackId, true, project.uid, innerMaxH);

    // 媒体条：大卡横排（卡按 mux_playback_id 去重）
    const mediaStrip = UIElement.container({ flexDirection: 'row', gap: CONTENT.mediaStrip.gap, flexShrink: 0, height: innerMaxH, alignItems: 'center' });
    const seen = new Set<string>();
    project.projectMedia.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      mediaStrip.add(buildCard(id, false, project.uid, innerMaxH));
    });

    // Next Project 面板（pq 规格 + son-2 实拍）：居中文字列——下划线 label / 大标题(medium) /
    // 副标题 / Continue 黑按钮；**无左侧媒体预览卡**（媒体大卡属当前项目媒体流，勿混淆）
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
    // label 下划线画在包裹容器上（text 元素无 panel mesh，borderBottom 不渲染）
    const labelWrap = UIElement.container({
      borderBottomWidth: 1,
      borderColor: CONTENT.nextPanel.divider,
      paddingBottom: 8,
      // uikit margin 仅数值 → 取 lg 档字面值
      marginBottom: CONTENT.nextPanel.label.lg.marginBottom,
    });
    labelWrap.add(T('Next Project', {
      font: regular,
      fontSize: { base: CONTENT.nextPanel.label.fontSize, lg: CONTENT.nextPanel.label.lg.fontSize },
      lineHeight: { base: `${CONTENT.nextPanel.label.lineHeight}px`, lg: `${CONTENT.nextPanel.label.lg.lineHeight}px` },
      textAlign: 'center',
    }, {}));
    panel.add(labelWrap);
    panel.add(
      T(nx.title, {
        font: medium,
        fontSize: { base: CONTENT.nextPanel.title.fontSize, md: CONTENT.nextPanel.title.md.fontSize, lg: CONTENT.nextPanel.title.lg.fontSize },
        lineHeight: { base: `${CONTENT.nextPanel.title.lineHeight}px`, md: `${CONTENT.nextPanel.title.md.lineHeight}px`, lg: `${CONTENT.nextPanel.title.lg.lineHeight}px` },
        textAlign: 'center',
      }, { marginTop: CONTENT.nextPanel.title.lg.marginTop }),
    );
    panel.add(
      T(nx.collaborator ? `${nx.subtitle} with ${nx.collaborator}` : nx.subtitle, {
        font: regular,
        fontSize: CONTENT.nextPanel.subtitle.fontSize,
        lineHeight: `${CONTENT.nextPanel.subtitle.lineHeight}px`,
        textAlign: 'center',
      }, { marginTop: 16 }),
    );
    // Continue（son-2 实拍：黑色实心圆角按钮 ~122×42，白字 + 右侧白色箭头图标。
    // 箭头必须用图标而非 → 字符——STIX MSDF 字集无 U+2192，缺字回退会让按钮文字度量错位）
    const btn = UIElement.container({
      backgroundColor: '#1a1918',
      borderRadius: 4,
      width: 122,
      height: 42,
      marginTop: 32,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    });
    btn.add(T('Continue', { font: regular, fontSize: 16, lineHeight: '16px' }, { color: '#f4f1e8' }));
    btn.add(UIElement.image(14, 1, {}, '/textures/icons/arrow_right_white.svg'));
    panel.add(btn);
    continueBtnEl = btn;

    // 内层（行）：[文字块 | 主面板 | 媒体条 | Next 面板]
    const inner = UIElement.container({ height: '100%', maxHeight: innerMaxH, flexDirection: 'row', alignItems: 'center' });
    inner.add(textCol, mainCard, mediaStrip, panel);

    // 根（内容条）：显式 7 视口宽（原站 sizeX=7*viewportWidth 同款——子元素相对中心
    // 定位的坐标系必须比内容宽，否则 overflow 部分会整体左移）
    const root = UIElement.container({
      width: CONTENT.rootViewports * vwPx,
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


  // ---------- 场景组装 ----------
  const contentScene = new THREE.Scene();
  // 背景板（原站 nf 50×50 @ z=-10）：本地相机沿 X 行程可达 ~5 视口宽（≈57 世界单位），
  // 50 宽平面右缘（x=25）会进入视锥——板外区域经颗粒 pass 映射成比纸面更亮的白带，
  // 故本地加宽到 600 覆盖全部行程（颜色不变，视觉与原站 50×50 等价）
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 50),
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

  /** uikit 根定位（横向）：内容条左缘对齐视锥左缘（原站 position.x = 7vw/2 − vw/2 同款：
   *  progress=0 时文案从屏幕左侧起，progress 增大相机右移扫过内容条） */
  function placeUikitRoot(): void {
    const ps = vhWorld / host.clientHeight;
    uikit.setPixelSize(ps);
    const wPx = treeRoot.size.width || host.clientWidth * CONTENT.rootViewports;
    uikitRoot.position.set((wPx * ps) / 2 - vwWorld / 2, 0, 0);
  }
  placeUikitRoot();
  uikit.mount(treeRoot);
  uikit.update();

  /** 滚动上限（视口数，横向语义）：滚到底时内容右缘对齐视口右缘（son-2 实测：该状态下
   *  Next 面板中心停在视口 ~70% 处、左侧仍见媒体流尾卡——不加额外停靠偏移） */
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
    return Math.max(0.05, contentRightWorld / vwWorld);
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

  // ---------- 卷页换页合成（p7 composite quad 逐行移植：04kr:63082-63199） ----------
  // 换页期间 getTexture() 改采 curlFBO：旧页（本实例 grainFBO，滚动冻结）在下方压暗，
  // 新页（下一项目实例纹理）经圆柱卷曲从左缘卷入。out = mix(旧页×压暗, 卷页, 卷页α)。
  // 采样节点：r169 的 N.texture 首参必须是真实纹理（TextureNode 不能嵌套）——先用 1×1
  // 纸色占位建节点，换页开始时统一切 .value（同卡片 thumbNode 模式）
  const curlPlaceholder = new THREE.DataTexture(new Uint8Array([250, 250, 242, 255]), 1, 1);
  curlPlaceholder.needsUpdate = true;
  const curlUniforms = { uTransition: N.uniform(0) };
  let curlPrevNode: any = null;
  let curlCurNode: any = null;
  const curlScene = new THREE.Scene();
  const curlCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  curlCamera.position.z = 1;
  const curlMat = new THREE.MeshBasicNodeMaterial();
  curlMat.toneMapped = false;
  {
    // r(e)：采当前页纹理（04kr:63086）——构建期记录节点，换页时切 .value
    const r = (coord: any) => {
      const n = N.texture(curlPlaceholder, coord);
      curlCurNode = n;
      return n;
    };
    // 圆柱折叠映射 i(e, t, r)（04kr:63087-63124）：输入横坐标 → (卷起后坐标, 正/背面系数)；
    // e < r.z-0.15 平面区 → (e,1)；e > r.z+0.15 → (-1,-1) 无效；其余按 asin 卷到柱面
    const fold = N.Fn(([e, t, rr]: any[]) => {
      const rad = 0.15;
      const a = N.vec2(0).toVar();
      const s = N.vec2(e, 1).toVar();
      N.If(e.lessThan(rr.z.sub(rad)), () => {
        a.assign(s);
      })
        .ElseIf(e.greaterThan(rr.z.add(rad)), () => {
          a.assign(N.vec2(-1, -1));
        })
        .Else(() => {
          const o = N.asin(e.sub(rr.z).div(rad));
          const l = o.negate().add(Math.PI);
          s.x.assign(rr.z.add(l.mul(rad)));
          s.y.assign(N.cos(l));
          N.If(s.x.lessThan(t), () => {
            a.assign(s);
          })
            .ElseIf(e.lessThan(rr.z), () => {
              a.assign(N.vec2(e, 1));
            })
            .Else(() => {
              s.y.assign(N.cos(o));
              s.x.assign(rr.z.add(o.mul(rad)));
              a.assign(N.mix(N.vec2(-1, -1), s, s.x.lessThan(t).toFloat()));
            });
        });
      return a;
    });
    // 卷页 n(e, t, n, a, s)（04kr:63125-63170）：transition 驱动圆柱心从 g=1.6d-0.3 扫到 -0.3，
    // 正面=新页卷面（带 S 软影），背面=纸色暗面（w*0.25 + 暖色调 0.8/0.75/0.6）
    const curl = N.Fn(([eT, t, nn, aa, ss]: any[]) => {
      const o = N.float(0.15);
      const u = ss.x.lessThan(0);
      const A = N.vec2(ss.x.abs(), ss.y);
      const c = A.div(A.length());
      const d = A.length();
      const h = N.float(1).add(o.mul(4));
      const g = d.mul(h).sub(o.mul(2));
      const f = o.mul(-2);
      const p = N.clamp(N.float(1).sub(eT), 0, 1);
      const m = N.mix(g, f, p);
      const E = N.vec3(c, m);
      const I = N.vec2(
        N.mix(t.x, N.oneMinus(t.x), u.toFloat()),
        N.mix(N.oneMinus(t.y), t.y, nn),
      );
      const y = N.dot(I, E.xy);
      const C = N.abs(N.vec2(1).sub(I).div(E.xy));
      const B = y.add(N.min(C.x, C.y));
      const v = fold(y, B, E);
      const b = v.x.lessThan(0);
      const S = N.float(1)
        .sub(N.smoothstep(0, o.mul(2), y.sub(E.z).negate()))
        .mul(N.smoothstep(o.negate(), o, B.sub(v.x.add(Math.PI * 1.5 * o).add(o))));
      const x = E.xy.mul(v.x.sub(y)).toVar();
      x.x.assign(N.mix(x.x, x.x.negate(), u.toFloat()));
      x.y.assign(x.y.mul(N.mix(N.float(-1), N.float(1), nn)));
      const w = r(t.add(x)).toVar();
      const Q = w.mul(v.y).mul(N.float(1).sub(S));
      const R = w.mul(0.25).add(aa.mul(N.vec3(0.8, 0.75, 0.6))).mul(v.y.negate());
      w.assign(N.mix(R, Q, v.y.greaterThan(0).toFloat()));
      const T = N.vec4(w.rgb, 1);
      return N.mix(T, N.vec4(0, 0, 0, 0), b.toFloat());
    });
    curlMat.colorNode = N.Fn(() => {
      const e = N.vec2(N.uv().x, N.float(1).sub(N.uv().y));
      const s = curl(curlUniforms.uTransition, e, N.float(1), N.vec3(1, 1, 1), N.vec2(-1, 0.5));
      const o = N.texture(curlPlaceholder, e);
      curlPrevNode = o;
      const l = N.smoothstep(0, 1, curlUniforms.uTransition).mul(0.6);
      return N.mix(N.mix(o, N.vec4(0, 0, 0, 1), l), s, s.a);
    })();
  }
  const curlQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), curlMat);
  curlScene.add(curlQuad);
  let curlFBO: THREE.RenderTarget | null = null;

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

  // ---------- Continue 卷页换页（原站 p7 subPage uid 变化流程，04kr:63027-63058） ----------
  // uid 变化 → isTransitioning=1 → projectTransition 0→1（2s easeInOut）→ 完成后归零；
  // Lenis scrollTo(0, immediate) 等价 = 新实例 scroll 0 + 本实例滚动冻结 + 宿主复位 projectScrollPx。
  const transition: {
    active: boolean;
    t: number;
    next: WorkDetailExperience | null;
  } = { active: false, t: 0, next: null };

  /** easeInOut（framer-motion 同名缓动：t<0.5 ? 2t² : 1-(−2t+2)²/2） */
  const easeInOut = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  /** 构建下一项目实例（同渲染器嵌入）并 snap 到已入场态，启动 2s 卷页 */
  async function switchNext(): Promise<void> {
    if (transition.active || !embedded) return;
    const nx = nextWorkProject(project.uid);
    const nextExp = await createWorkDetailExperience(host, nx, { renderer: gl, onProjectSwitched: opts.onProjectSwitched });
    nextExp.enter({ cameraFlight: false, instant: true });
    transition.active = true;
    transition.t = 0;
    transition.next = nextExp;
    // 原站 = 客户端路由 /work/<next>（不重播 boot）；等价 history 推栈
    history.pushState({}, '', `/work/${nx.uid}`);
  }

  /** Continue 按钮（Next 段）命中：世界 rect → 屏幕像素（相机 x 随滚动），命中 = 原站
   *  `<a href="/work/<next>">` 路由语义 → 卷页换页（switchNext）。
   *  注意：getElementWorldRect 返回树局部世界坐标——必须加 uikitRoot.position 偏移 */
  function continueScreenRect(): { x: number; y: number; w: number; h: number } | null {
    if (!continueBtnEl) return null;
    const r = uikit.getElementWorldRect(continueBtnEl);
    if (!r) return null;
    const wx = r.cx + uikitRoot.position.x;
    const wy = r.cy + uikitRoot.position.y;
    return {
      x: host.clientWidth / 2 + ((wx - camera.position.x) / vwWorld) * host.clientWidth - (r.w / vwWorld) * host.clientWidth / 2,
      y: host.clientHeight / 2 - (wy / vhWorld) * host.clientHeight - (r.h / vhWorld) * host.clientHeight / 2,
      w: (r.w / vwWorld) * host.clientWidth,
      h: (r.h / vhWorld) * host.clientHeight,
    };
  }
  const onPointerDown = (e: PointerEvent) => {
    if (transition.active) return;
    const r = continueScreenRect();
    if (r && e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h) {
      void switchNext();
    }
  };
  window.addEventListener('pointerdown', onPointerDown);

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
    const zTarget = cameraFlight ? PROJECT_CAMERA.enterZ + (PROJECT_CAMERA.baseZ - PROJECT_CAMERA.enterZ) * mst : PROJECT_CAMERA.baseZ;
    const sZ = Math.min(Math.max(CAMERA_SPRING.velGainZ * springVel, -CAMERA_SPRING.clampZ), CAMERA_SPRING.clampZ);
    const zSpringTarget = zTarget + CAMERA_SPRING.exp * sZ;
    cameraZ.b += (zSpringTarget - cameraZ.b) * (1 - Math.exp(-CAMERA_SPRING.exp * dtc));
    const sO = Math.min(Math.max(CAMERA_SPRING.velGainOffset * springVel, -CAMERA_SPRING.clampOffset), CAMERA_SPRING.clampOffset);
    offset.s += (mst * 0.2 + CAMERA_SPRING.exp * sO - offset.s) * (1 - Math.exp(-CAMERA_SPRING.exp * dtc));

    // 横向滚动（原站同款）：内容条横排，相机沿 X 右移扫过（scroll px / 视口高 = 视口数）
    const vpW = vwWorld;
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
    // 调试探针：Continue 按钮的实时屏幕 rect（命中公式校准用）
    (window as unknown as { __continueRect?: unknown }).__continueRect = continueScreenRect();

    // 媒体卡：视锥判定（NDC，横向）→ 播停 + 交叉淡入
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
              // 首帧就绪后才挂 VideoTexture：空帧视频纹理会让 object bindGroup 校验失效，
              // 整条渲染指令被 WebGPU 静默丢弃（内容冻结、只有纸纹颗粒在动的根因）
              h.ready.then(() => {
                if (card.disposed) return;
                card.u.videoNode.value = h.texture;
                card.videoAttached = true;
                h.aspect.then((a) => {
                  card.u.uAspectRatio.value = a;
                  card.el.style.aspectRatio = a;
                  // 视频真实比例就绪 → 高固定、宽随比例重算实际尺寸
                  card.el.style.width = Math.round(card.layout.heightPx * a);
                  card.el.style.height = Math.round(card.layout.heightPx);
                  relayout();
                });
              });
            }
            return h;
          });
        }
      } else if (!vis && card.visible) {
        card.visible = false;
      }
      if (card.visible && card.handle && card.videoAttached) {
        if (card.fade < 1) {
          card.fade = Math.min(1, card.fade + dtc / MEDIA_CARD.crossfadeDuration);
          card.u.uVideoOpacity.value = card.fade;
          card.handle.play();
        } else card.handle.play();
      } else if (card.handle) {
        // 未挂载视频或不可见：停播并回落缩略图
        if (!card.visible && card.fade > 0) {
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
        'continue.rect=', JSON.stringify(continueScreenRect()),
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

    // ---------- 卷页换页推进（原站 projectTransition 0→1，2s easeInOut，04kr:63033-63041） ----------
    if (transition.active && transition.next) {
      // 先推进新页实例（scroll 0、spring 已 snap；视频/布局自走）——其 grainFBO 即卷页正面纹理
      await transition.next.frame(dtc, time);
      if (transition.t === 0) {
        curlPrevNode.value = grainFBO.texture;
        curlCurNode.value = transition.next.getTexture();
        curlFBO ??= mkFBO();
      }
      transition.t = Math.min(1, transition.t + dtc / 2);
      curlUniforms.uTransition.value = easeInOut(transition.t);
      gl.setRenderTarget(curlFBO!);
      await gl.renderAsync(curlScene, curlCamera);
      gl.setRenderTarget(null);
      if (transition.t >= 1) {
        const next = transition.next;
        transition.active = false;
        transition.next = null;
        // 完成回调：宿主换引用/复位滚动并 dispose 本实例（本帧已收尾，安全）
        opts.onProjectSwitched?.(next, nextWorkProject(project.uid));
      }
    }

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
      curTexOverride: transition.active && curlFBO ? curlFBO.texture : grainFBO.texture,
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
    setScrollTarget: (px: number) => {
      // 卷页换页期间锁定滚动（原站 Lenis scrollTo(0, immediate) 后旧页静止）
      if (!transition.active) scroll.target = px;
    },
    /** 屏数（原站语义：pageCount = 内容宽/视口宽，camera.x = t×vw, t ∈ [0, pageCount-1]
     *  ——宿主 maxScroll = (pageCount−1)·vh，滚到底内容右缘贴视口右缘） */
    getPageCount: () => pageCount,
    /** subPageTransition 入场
     *  - cameraFlight: true = 相机 z 10→5 飞入；false = 固定 baseZ（缩放由合成链承担）
     *  - instant: 跳过动画直接落到位（Continue 换页构建的新实例用——原站该场景
     *    subPageTransition 恒为 1，无二次入场） */
    enter: (opts) => {
      cameraFlight = opts?.cameraFlight ?? true;
      if (!cameraFlight) {
        // 无相机飞行：直接落 baseZ，避免首帧从 enterZ 慢慢追上（页面缩放已由合成链承担）
        cameraZ.b = PROJECT_CAMERA.baseZ;
        offset.s = 0.2;
      }
      if (opts?.instant) {
        spring.value = 1;
        spring.velocity = 0;
        spring.target = 1;
        spring.delay = 0;
        spring.done = true;
        cameraZ.b = PROJECT_CAMERA.baseZ;
        offset.s = 0.2;
        return;
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
    /** 卷页换页期间采合成结果（旧页压暗 + 新页卷入），其余时刻直出颗粒 FBO */
    getTexture: () => (transition.active && curlFBO ? curlFBO.texture : grainFBO.texture),
    embedded,
    /**
     * 释放子页资源
     *
     * 功能：摘除指针监听、释放合成链 / FBO / 卡片 / uikit 图集 / 几何与材质；
     *      卷页换页中途释放时级联释放未完成的新实例
     *
     * 参数：无
     * 返回值：无
     * 异常：无
     * 注意事项：嵌入模式下渲染器与画布归主体验所有，这里必须跳过 dispose
     */
    dispose: () => {
      window.removeEventListener('pointermove', onMouse);
      window.removeEventListener('pointerdown', onPointerDown);
      compose?.dispose();
      for (const c of cards) {
        c.disposed = true;
        c.handle?.dispose();
        c.material.dispose();
      }
      // 换页中途被释放（如 Esc 关闭）：级联释放新实例，避免泄漏
      if (transition.next) {
        const next = transition.next;
        transition.next = null;
        transition.active = false;
        next.dispose();
      }
      projectFBO.dispose();
      grainFBO.dispose();
      curlFBO?.dispose();
      curlMat.dispose();
      curlQuad.geometry.dispose();
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
      /** 布局探针：各段实际尺寸 + 根定位 + 相机（横向滚动对账用） */
      segmentSizes: (() => {
        const inner = treeRoot.children[0];
        return (inner?.children ?? []).map((c: any) => ({ w: c.size.width, h: c.size.height }));
      })(),
      rootPos: { x: uikitRoot.position.x, y: uikitRoot.position.y },
      cameraX: camera.position.x,
      vwWorld,
      pageCount,
      scroll: { ...scroll },
      /** 相机 z（入场 spring 收敛应为 baseZ=5，初值 enterZ=10） */
      cameraZ: +cameraZ.b.toFixed(3),
    }),
  };
}
