/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  HERO_CAMERA, HERO_SCROLL, HERO_SMOKE, HERO_AMBIENT, HERO_ASSETS,
  HERO_MODEL, HERO_SCREEN_PLANE, HERO_PROJECTOR, HERO_SCREEN, HERO_TIMELINE,
} from './heroConfig';
import { createHeroSmoke } from './heroSmoke';
import { createHeroEnvironment } from './heroLightRig';
import { createHeroCompose, sampleScreenProjects } from './heroCompose';
import { createSelectedWorkScene } from '../selected-work/scene';
import SelectedWorkUI from '../selected-work/SelectedWorkUI';
import { createHeroScreenLoop } from './heroScreenLoop';
import { createHeroSpillFactory } from './heroSpill';
import { createHeroBootPass } from './heroBootPass';
import { createHeroSlats } from './heroSlats';
import {
  bootStore,
  clearBootAssets,
  markBootWarmupDone,
  registerBootAsset,
  resetBoot,
  setBootWarmupProgress,
} from '../boot/bootStore';

/**
 * TSL 命名空间置为 any
 *
 * 说明：与 heroCompose.ts 同一取舍 —— TSL 的节点类型在 TS 下逐算子泛型化，
 * 精确标注会让这几段材质配方充斥类型体操。语义与数值仍严格照原件。
 */
const T = TSL as any;

/**
 * GPU 预热与"何时撤下 boot"的判据
 *
 * 说明：boot 必须在 3D 页面**真正渲染顺畅**之后才消失，否则撤下那一刻还在编译着色器、
 *      上传纹理，用户看到的就是「boot 没了但画面卡一下」。判据对齐项目 BootController：
 *      先 compileAsync 预编译 → 统计真实渲染帧数与连续平滑帧 → 满帧数且连续平滑且过最短时长才毕业，
 *      另设超时兜底（慢机器不把用户卡在进度条上）。
 */
const WARMUP_SECONDS = 0.4;
/** 预热帧数下限（必须真正渲染过这么多帧才算预热开始生效） */
const WARMUP_MIN_FRAMES = 12;
/** 连续平滑帧下限（着色器编译 / 纹理上传都完成后才会连续出现） */
const WARMUP_MIN_SMOOTH = 6;
/** 单帧超过该值即视为"不平滑"（帧间隔被 clamp 到 0.05，编译卡顿必然 > 该阈值） */
const WARMUP_FRAME_SEC = 0.04;
/** 预热超时兜底（秒） */
const WARMUP_TIMEOUT_SEC = 3;

/** 拖动像素钳制（原件 ±0.2·width） */
const REEL_DRAG_CLAMP_RATIO = 0.2;
/** 释放翻帧阈值（原件 |drag| > 0.1·width） */
const REEL_DRAG_SNAP_RATIO = 0.1;
/** 横向滚轮翻帧累计阈值（原件 0.1·width） */
const REEL_WHEEL_STEP_RATIO = 0.1;
/** 横向滚轮翻帧锁（原件 700ms） */
const REEL_WHEEL_LOCK_MS = 700;

/**
 * hero 1:1 复刻页
 *
 * 功能：用 three/webgpu 渲染 shader.se 首页场景。全部摆位与材质配方**照搬原件实测值**：
 *  - 整机：`group(pos [-1.1,-1.4,0], scale 0.14, rotY π)` 内放原件那份 computer.glb
 *  - 屏幕：整机内再套 `group(pos [-22,11,2], rotY π-0.735)` → 单位平面 `scale [10.15,7.875,1],
 *    pos [-0.2,-0.55,0.1], rotX -0.07`（世界尺寸 1.421 × 1.1025，宽高比 1.289）
 *  - 材质：computer(metalness .83/roughness .8/DoubleSide + 提亮幂)、keyboard(纯黑)、
 *    logo(metalness 1/roughness 0 + 自发光 ×0.4)、background(grunge×cloud 复合配方)
 *  - 灯光：ambientLight 1.8 + Lightformer 环境灯架 + 屏幕投射聚光灯（带抖动动画、decay 0）
 *  - 烟层：30 片 0.04 不透明度的前景薄雾（只转不移）
 *  - 相机：基础位 (0,0.2,4.5) 看向原点；推进终点按屏幕**世界缩放**反解取景距离 ×0.9
 *  - 合成：离屏 HalfFloat + 10 步合成链（桶形畸变随宽高比自适应）
 *
 * 参数：无
 *
 * 返回值：React.ReactElement —— 铺满视口的容器 + 左下角诊断 HUD
 *
 * 异常：初始化失败或渲染循环抛错都会写进 HUD 与 console；合成链路抛错会自动退化为直渲
 *
 * 注意事项：
 *  - **不再做包围盒归一化** —— 上一版最大的偏差就来自这里。本页加载的是原件同一份 GLB，
 *    原件那组世界变换直接适用
 *  - boot 屏**复用项目原有 boot 体系**（`src/boot/` 的 bootStore + BOOT_COMMON_GLSL +
 *    5×7 点阵字体纹理），由 heroBootPass 用一台轻量 WebGLRenderer 渲染成铺满视口的覆盖画布；
 *    **同一张画布同时作为贴图喂给显示器屏幕材质**（原件同源做法），所以 3D 电脑屏幕上也是那块
 *    蓝色 boot 画面而不是黑的 boot_screen.png（那张原图 93% 近黑，原件靠着色器替换成 BIOS 蓝）
 *  - **boot 是"切掉"不是"渐隐"**（原件实测）：资产一就绪 boot 立刻消失，此刻相机正停在
 *    屏幕特写位，boot 面板与显示器重合；随后 500ms 静置 + 弹簧(30/8) 才把镜头拉远。
 *    相机的入场与滚动**共用同一条插值**（原件没有独立入场曲线），详见下方主循环注释
 *  - boot 的撤下时机由 GPU 预热带门（compileAsync + 连续平滑帧），保证是 3D 页面**真的渲染顺畅**
 *    之后才消失，不会出现"boot 没了、画面卡一下才动"（判据见文件顶部常量）
 *  - 24 片百叶标题幕照原件 `pp` 实现：相机推回基础机位（进度 s ≤ 0.1）时标题显形，
 *    24 片各自从侧立转到正对相机拼出标题；文案与字号在 `heroSlats.ts` 顶部集中定义
 */
export default function HeroOneToOne() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState('正在初始化 WebGPU…');
  /** 诊断 HUD 默认隐藏（1:1 页面不该出现调试行）；`#hero?debug=1` 打开 */
  const showHud =
    typeof window !== 'undefined' && (window.location.hash.split('?')[1] ?? '').includes('debug=1');
  /** 预热统计（资产就绪后进入 warmup 阶段时开始累计，见文件顶部的判据说明） */
  const warmupRef = useRef({ startedAt: 0, frames: 0, smooth: 0, compiled: false });
  const hudRef = useRef(setHud);
  hudRef.current = setHud;

  const scrollTargetRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  /** 整条时间轴（hero 页 0~1、projects 页 1~2，单位 vh）；帧循环写入，输入回调读取 */
  const pageScrollRef = useRef(0);
  /** Selected Work 当前选中序号（整数，可为负；场景内部取模） */
  const selectedIndexRef = useRef(0);
  /** 拖拽窥视位移（CSS px，右正；场景按 dragPx/(0.05w) 换算成胶片偏移） */
  const dragPxRef = useRef(0);
  /** 供覆盖层 UI 调用的翻页入口（在 effect 内绑定到场景输入） */
  const selectedApiRef = useRef<{ prev: () => void; next: () => void; about: () => void } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const cleanups: Array<() => void> = [];
    const diag: string[] = [];
    const pushHud = (head: string) => hudRef.current(head + (diag.length ? ' · ' + diag.join(' · ') : ''));
    /** boot 覆盖屏实例（初始化失败时由外层 catch 兜底结束它） */
    let bootPass: ReturnType<typeof createHeroBootPass> | null = null;

    (async () => {
      const host = hostRef.current;
      if (!host) return;

      // ---------- 0. boot 屏（复用项目原有 boot 体系） ----------
      // 清空上一个路由登记过的资产并重置状态机，再登记本页自己的加载资产；
      // 覆盖屏由 heroBootPass 用项目原有的 boot GLSL + 字体纹理 + bootStore 每帧绘制
      clearBootAssets();
      resetBoot();
      const bootAsset = registerBootAsset('hero-init', 1);
      bootAsset.setProgress(0.12);
      const bootOverlay = createHeroBootPass(host);
      bootPass = bootOverlay;
      cleanups.push(bootOverlay.dispose);
      diag.push('boot 屏(原有体系)');

      // ---------- 1. 渲染器 ----------
      const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const renderer = new THREE.WebGPURenderer({ antialias: false, alpha: true, forceWebGL: !hasWebGPU });
      await renderer.init();
      if (disposed) { renderer.dispose?.(); return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1;
      host.appendChild(renderer.domElement);

      const backend = (renderer as unknown as { backend?: { isWebGLBackend?: boolean } }).backend;
      diag.push('后端 ' + (backend?.isWebGLBackend ? 'WebGL(回退)' : 'WebGPU'));
      pushHud('正在加载模型…');

      const rendererAny = renderer as unknown as {
        renderAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown>;
        render: (s: THREE.Object3D, c: THREE.Camera) => unknown;
      };
      const doRender = async (s: THREE.Object3D, c: THREE.Camera) => {
        if (rendererAny.renderAsync) await rendererAny.renderAsync(s, c);
        else rendererAny.render(s, c);
      };

      // ---------- 2. 场景 / 相机 / 补光 ----------
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0b0d);
      const camera = new THREE.PerspectiveCamera(
        HERO_CAMERA.fov, host.clientWidth / host.clientHeight, HERO_CAMERA.near, HERO_CAMERA.far
      );
      camera.position.set(...HERO_CAMERA.basePosition);
      camera.lookAt(...HERO_CAMERA.baseLookAt);
      scene.add(new THREE.AmbientLight(new THREE.Color(HERO_AMBIENT.color), HERO_AMBIENT.intensity));

      // ---------- 3. 环境灯架 ----------
      try {
        const env = createHeroEnvironment(renderer, scene);
        cleanups.push(env.dispose);
        diag.push('环境贴图 ' + (scene.environment ? 'OK' : '无'));
      } catch (err) {
        diag.push('环境贴图失败');
        // eslint-disable-next-line no-console
        console.warn('[HeroOneToOne] 环境灯架失败：', err);
      }
      bootAsset.setProgress(0.35);

      // ---------- 4. 贴图 ----------
      const loader = new THREE.TextureLoader();
      const dirt = loader.load(HERO_ASSETS.dirtUrl);
      dirt.wrapS = THREE.RepeatWrapping; dirt.wrapT = THREE.RepeatWrapping;
      const grunge = loader.load(HERO_ASSETS.grungeUrl);
      grunge.wrapS = THREE.RepeatWrapping; grunge.wrapT = THREE.RepeatWrapping;
      // 显示器上的 boot 画面与覆盖层**必须同源**（原件就是把 loading 屏的 FBO 纹理直接喂进屏幕材质）：
      // 这里把 boot 覆盖画布包成一张贴图，覆盖层可见期间每帧 needsUpdate 重传。
      // 注意 boot_screen.png 本身 93% 是近黑像素，原件靠着色器把近黑替换成 BIOS 蓝 ——
      // 直接用那张图会让显示器发黑，所以改用程序化 boot 画面本身。
      const bootTexture = new THREE.CanvasTexture(bootOverlay.canvas);
      bootTexture.colorSpace = THREE.SRGBColorSpace;
      bootTexture.minFilter = THREE.LinearFilter; bootTexture.magFilter = THREE.LinearFilter;
      bootTexture.generateMipmaps = false;
      // 原件 loadingScreen 是 FBO 纹理（flipY=false 语义），makeScreenContentNode 里的
      // `1 - n.y` 是按这个语义写的。CanvasTexture 默认 flipY=true，WebGPU 上传时会再翻
      // 一次 → 显示器上的 boot 上下颠倒。这里恢复 FBO 语义（同时省掉逐帧上传的翻转 pass）。
      bootTexture.flipY = false;
      cleanups.push(() => bootTexture.dispose());

      // 屏幕循环片（原件那条 Mux 主片已本地化，同帧派生光）：contentTexture 给屏幕、
      // lightTexture 给投射灯 gobo 与背景光溢出
      const screenLoop = createHeroScreenLoop();
      screenLoop.update();
      cleanups.push(screenLoop.dispose);
      diag.push('循环片 OK');
      bootAsset.setProgress(0.6);

      // 解析式屏幕光溅射：原件靠 spotLight.map 的 gobo，但 three 0.169 的 WebGPU 后端未实现该特性，
      // 故改为在材质上直接做投影采样（gobo 用循环片的 lightTexture，与屏幕内容同源）。
      // 支持 URL 开关做二分：`#hero?spill=0` 关闭溅射 —— 便于判断画面问题是它引起的还是别的。
      const spillDisabled = (window.location.hash.split('?')[1] ?? '').includes('spill=0');
      let spillFactory: ReturnType<typeof createHeroSpillFactory> | null = null;
      if (spillDisabled) {
        diag.push('溅射 OFF(?spill=0)');
      } else {
        try {
          spillFactory = createHeroSpillFactory(screenLoop.lightTexture);
          diag.push('溅射 OK');
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[HeroOneToOne] 溅射工厂创建失败，已跳过：', err);
          diag.push('溅射创建失败');
        }
      }

      // ---------- 5. 模型：**照搬原件世界变换，不做归一化** ----------
      const gltfLoader = new GLTFLoader();
      const draco = new DRACOLoader();
      draco.setDecoderPath(HERO_ASSETS.dracoDecoderPath);
      gltfLoader.setDRACOLoader(draco);

      const gltf = await new Promise<any>((resolve, reject) =>
        gltfLoader.load(HERO_ASSETS.modelUrl, resolve, undefined, reject)
      ).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[HeroOneToOne] 模型加载失败：', err);
        diag.push('模型加载失败');
        return null;
      });
      if (disposed) return;

      /** 整机 group：与原件 `pu` 同款变换 */
      const modelGroup = new THREE.Group();
      modelGroup.position.set(...HERO_MODEL.groupPosition);
      modelGroup.scale.setScalar(HERO_MODEL.groupScale);
      modelGroup.rotation.y = HERO_MODEL.groupRotY;
      modelGroup.updateMatrixWorld(true);
      scene.add(modelGroup);

      if (gltf?.scene) {
        const model = gltf.scene as THREE.Group;
        // 材质配方（原件 pn/pa/ps/pi）——按节点名替换材质，几何与节点变换保持 glTF 原样
        const matDiag = replaceModelMaterials(model, dirt, grunge, screenLoop.lightTexture, spillFactory);
        diag.push('材质[' + matDiag + ']');
        modelGroup.add(model);
        modelGroup.updateMatrixWorld(true);
        diag.push('模型 OK');
      } else {
        diag.push('无模型');
      }
      // 资产齐备 → boot 状态机进入 warmup（预热帧由下方主循环按真实时间上报）
      bootAsset.markDone();

      // ---------- 6. Selected Work 场景（显示器传送门 + 穿越后的第二场景） ----------
      // 原件里这是 /projects 页自己的场景 RT：同一张纹理既被显示器屏幕材质采样，
      // 又在最后 0.2vh 被合成链整屏交叉淡入。这里用新版 TSL 胶片卷 + 旋转棱柱标题复刻。
      const projects = createSelectedWorkScene(host.clientWidth, host.clientHeight);
      cleanups.push(projects.dispose);
      const renderDpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const projectsPxW = Math.max(1, Math.floor(host.clientWidth * renderDpr));
      const projectsPxH = Math.max(1, Math.floor(host.clientHeight * renderDpr));
      // 真实场景 RT 开 4x MSAA：胶片画格与齿孔是 alphaTest 硬边，FXAA 不在链里
      const projectsRT = new THREE.RenderTarget(projectsPxW, projectsPxH, {
        type: THREE.HalfFloatType,
        depthBuffer: true,
        samples: 4,
      });
      cleanups.push(() => projectsRT.dispose());
      diag.push('传送门场景 OK');

      // ---------- 6b. 屏幕平面（三层嵌套，与原件同构） ----------
      const screenMat = new THREE.MeshBasicNodeMaterial();
      screenMat.toneMapped = false;
      // 原件屏幕材质：`mix(reelTexture.rgb*4 min 1, mix(loadingScreen, projectsScene, sceneBlend), smoothstep(.05,.55,progress))`
      // 其中 progress 就是相机那条进度 s（见主循环）：boot 期间为 1 → 屏幕显示 boot 画面；
      // 随 s 降到 0 切到循环片。sceneBlend 在入场结束后恒为 1 → 内层显示 projects 场景。
      const uScreenIntro = T.uniform(1);
      const uScreenBlend = T.uniform(0);
      // 视口宽高比 / 像素尺寸做成 uniform：原件 `dimensions` 逐帧可写，resize 后映射要跟着变
      const uViewportAspect = T.uniform(host.clientWidth / Math.max(1, host.clientHeight));
      const uViewportDimensions = T.uniform(new THREE.Vector2(projectsPxW, projectsPxH));
      (screenMat as unknown as { colorNode: unknown }).colorNode = makeScreenContentNode(
        screenLoop.contentTexture,
        bootTexture,
        projectsRT.texture,
        uScreenIntro,
        uScreenBlend,
        uViewportAspect,
        uViewportDimensions
      );

      const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), screenMat);
      screenMesh.position.set(...HERO_SCREEN_PLANE.meshPosition);
      screenMesh.rotation.x = HERO_SCREEN_PLANE.meshRotX;
      screenMesh.scale.set(...HERO_SCREEN_PLANE.meshScale);

      const screenGroup = new THREE.Group();
      screenGroup.position.set(...HERO_SCREEN_PLANE.groupPosition);
      screenGroup.rotation.y = HERO_SCREEN_PLANE.groupRotY;
      screenGroup.add(screenMesh);
      modelGroup.add(screenGroup);
      modelGroup.updateMatrixWorld(true);

      // ---------- 7. 屏幕投射灯（原件 po） ----------
      const projGroup = new THREE.Group();
      projGroup.position.set(...HERO_PROJECTOR.groupPosition);
      const projTarget = new THREE.Object3D();
      projTarget.position.set(...HERO_PROJECTOR.targetLocal);
      projGroup.add(projTarget);
      const projLight = new THREE.SpotLight(
        new THREE.Color('#ffffff'),
        HERO_PROJECTOR.baseIntensity,
        HERO_PROJECTOR.distance,
        (HERO_PROJECTOR.angleDeg * Math.PI) / 180,
        HERO_PROJECTOR.penumbra,
        HERO_PROJECTOR.decay
      );
      projLight.position.set(0, 0, 0);
      projLight.target = projTarget;
      // 投射灯 gobo：原件用「从属视频」纹理当投影图案，这里用同一动画派生的光纹理（主从同源）
      projLight.map = screenLoop.lightTexture;
      projGroup.add(projLight);
      scene.add(projGroup);
      projGroup.updateMatrixWorld(true);
      diag.push('投射灯 OK');

      // ---------- 8. 前景烟层 ----------
      const smokeMap = loader.load(HERO_SMOKE.textureUrl);
      smokeMap.colorSpace = THREE.SRGBColorSpace;
      smokeMap.minFilter = THREE.LinearFilter;
      const smoke = createHeroSmoke(smokeMap);
      scene.add(smoke.group);
      cleanups.push(smoke.dispose);

      // ---------- 8b. 24 片百叶标题幕（原件 pp，1:1 照搬） ----------
      // 相机推回基础机位（进度 s ≤ 0.1）时标题显形：24 片各自从侧立转到正对相机拼出标题
      const slats = createHeroSlats();
      scene.add(slats.mesh);
      cleanups.push(slats.dispose);
      diag.push('百叶幕 OK');

      // ---------- 9. 合成管线 ----------
      let compose: ReturnType<typeof createHeroCompose> | null = null;
      try {
        compose = createHeroCompose(host.clientWidth, host.clientHeight, bootOverlay.canvas, projectsRT.texture);
        cleanups.push(compose.dispose);
        diag.push('合成管线 OK');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[HeroOneToOne] 合成管线创建失败，退化为直渲：', err);
        diag.push('合成管线失败→直渲');
      }
      diag.push('场景子节点 ' + scene.children.length);
      pushHud('已就绪');

      // ---------- 10. 输入（整条时间轴 + 胶片拖拽/横向滚轮） ----------
      let wheelAcc = 0;
      let wheelLockUntil = 0;
      let wheelResetTimer: number | null = null;
      let dragging = false;
      let pending = false;
      let startX = 0;
      let startY = 0;
      let pointerStart = 0;
      let lastD = 0;

      /** 翻一帧（选中序号只做整数步进；场景内部按 11 取模） */
      const stepSelected = (delta: number) => {
        selectedIndexRef.current += delta;
      };

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        // 入场期间锁滚动（与项目 bootInteractionUnlocked 同一意图）：弹簧收敛前
        // 滚轮不得推进相机，否则会与入场拉远的插值打架
        if (!bootStore.springDone) return;
        let dx = e.deltaX;
        let dy = e.deltaY;
        if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
        else if (e.deltaMode === 2) { dx *= host.clientWidth; dy *= host.clientHeight; }

        // projects 页：横向滚轮翻胶片帧（原件 mh 拖拽层：累计 0.1w 翻一帧，700ms 锁）
        const onProjects = pageScrollRef.current > HERO_TIMELINE.heroLength - 0.1;
        if (onProjects && Math.abs(dx) > Math.abs(dy)) {
          if (dragging || pending) return;
          const now = performance.now();
          if (now < wheelLockUntil) return;
          if (wheelResetTimer !== null) window.clearTimeout(wheelResetTimer);
          wheelResetTimer = window.setTimeout(() => { wheelAcc = 0; }, 150);
          wheelAcc -= dx;
          const step = REEL_WHEEL_STEP_RATIO * window.innerWidth;
          if (Math.abs(wheelAcc) > step) {
            // 原件 `x + -Math.sign(acc)`：向右滚前进一帧
            stepSelected(-Math.sign(wheelAcc));
            wheelAcc = 0;
            wheelLockUntil = now + REEL_WHEEL_LOCK_MS;
          }
          return;
        }

        // 纵向滚轮推进整条时间轴（单位 vh：hero 0~1、projects 1~2）
        scrollTargetRef.current = Math.min(
          HERO_TIMELINE.total,
          Math.max(0, scrollTargetRef.current + dy / Math.max(1, host.clientHeight))
        );
      };
      const onMouseMove = (e: MouseEvent) => {
        mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouseRef.current.y = (e.clientY / window.innerHeight) * 2 - 1;
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (pageScrollRef.current < HERO_TIMELINE.heroLength - 0.1) return;
        if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key === 'ArrowLeft') stepSelected(-1);
        else if (e.key === 'ArrowRight') stepSelected(1);
      };
      const onPointerDown = (e: PointerEvent) => {
        if (!bootStore.springDone) return;
        if (pageScrollRef.current < HERO_TIMELINE.heroLength - 0.1) return;
        if (e.button !== 0) return;
        if ((e.target as HTMLElement | null)?.closest('[data-sw-ui]')) return;
        const yRatio = e.clientY / window.innerHeight;
        if (yRatio < 0.15 || yRatio > 0.85) return;
        pending = true;
        dragging = false;
        startX = e.clientX;
        startY = e.clientY;
        pointerStart = selectedIndexRef.current;
        lastD = 0;
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!pending) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
          if (Math.abs(dx) + Math.abs(dy) <= 10) return;
          if (Math.abs(dx) <= Math.abs(dy)) {
            pending = false; // 垂直意图，放弃
            return;
          }
          dragging = true;
          document.body.style.cursor = 'grabbing';
        }
        const lim = REEL_DRAG_CLAMP_RATIO * window.innerWidth;
        const d = Math.max(-lim, Math.min(lim, dx));
        lastD = d;
        dragPxRef.current = d;
      };
      const onPointerUp = () => {
        if (!pending) return;
        pending = false;
        document.body.style.cursor = '';
        dragPxRef.current = 0;
        if (!dragging) return;
        dragging = false;
        let target = Math.round(pointerStart);
        if (Math.abs(lastD) > REEL_DRAG_SNAP_RATIO * window.innerWidth) {
          target = Math.round(pointerStart) + (lastD > 0 ? -1 : 1);
        }
        selectedIndexRef.current = target;
      };
      selectedApiRef.current = {
        prev: () => stepSelected(-1),
        next: () => stepSelected(1),
        about: () => { window.location.hash = '#about'; },
      };
      const onResize = () => {
        const w = host.clientWidth, h = host.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        projects.setSize(w, h);
        const dprNow = renderer.getPixelRatio();
        const pw = Math.max(1, Math.floor(w * dprNow));
        const ph = Math.max(1, Math.floor(h * dprNow));
        projectsRT.setSize(pw, ph);
        uViewportAspect.value = w / h;
        uViewportDimensions.value.set(pw, ph);
        compose?.setSize(w, h);
      };
      window.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      window.addEventListener('resize', onResize);
      cleanups.push(() => {
        window.removeEventListener('wheel', onWheel);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('resize', onResize);
        document.body.style.cursor = '';
        selectedApiRef.current = null;
        if (wheelResetTimer !== null) window.clearTimeout(wheelResetTimer);
      });

      // ---------- 11. 相机端位（原件公式：屏幕世界【缩放】反解，因屏幕几何是单位平面） ----------
      const screenWorldPos = new THREE.Vector3();
      const screenWorldScale = new THREE.Vector3();
      const screenWorldQuat = new THREE.Quaternion();
      screenMesh.getWorldPosition(screenWorldPos);
      screenMesh.getWorldScale(screenWorldScale);
      screenMesh.getWorldQuaternion(screenWorldQuat);
      const screenNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(screenWorldQuat).normalize();

      const halfFov = ((HERO_CAMERA.fov * Math.PI) / 180) / 2;
      const aspect = host.clientWidth / host.clientHeight;
      const sw = screenWorldScale.x;
      const sh = screenWorldScale.y;
      const frameDist =
        (aspect < sw / sh ? sh / 2 / Math.tan(halfFov) : sw / 2 / (Math.tan(halfFov) * aspect)) *
        HERO_CAMERA.framingFactor;

      const endPos = screenWorldPos.clone().add(screenNormal.clone().multiplyScalar(frameDist));
      const endLookAt = screenWorldPos.clone();
      const basePos = new THREE.Vector3(...HERO_CAMERA.basePosition);
      diag.push('屏幕世界 ' + screenWorldPos.x.toFixed(2) + ',' + screenWorldPos.y.toFixed(2) + ',' + screenWorldPos.z.toFixed(2));
      diag.push('屏幕尺寸 ' + sw.toFixed(2) + '×' + sh.toFixed(2));

      // 入场起点 = 屏幕特写位（即滚动推入的终点：屏幕中心 + 法线 × 取景距离，
      // 此时屏幕基本占满画幅）。boot 期间相机停在这里，显现弹簧启动后一路拉远到 basePos。
      camera.position.copy(endPos);
      camera.lookAt(endLookAt);

      // 调试钩子：供自动化验证读取相机实时位置、boot 弹簧，并回读离屏场景 RT 的像素
      // （无副作用，保留；与 PostProcessing 的 __dofU 同款做法）
      (window as unknown as { __heroCamProbe?: unknown }).__heroCamProbe = {
        camera,
        scene,
        store: bootStore,
        renderer,
        sceneRT: compose?.sceneRT ?? null,
        composeRTs: compose?.debugRTs ?? null,
        screenWorldPos,
        projects,
        projectsRT,
        pageScroll: () => pageScrollRef.current,
        selectedIndex: () => selectedIndexRef.current,
        dragPx: () => dragPxRef.current,
      };

      // ---------- 12. 主循环 ----------
      const clock = new THREE.Clock();
      let scrollSmooth = 0, mouseSmoothX = 0, mouseSmoothY = 0;
      const tmpLook = new THREE.Vector3();
      let useCompose = !!compose;
      let frameErrored = false;

      const frame = async () => {
        if (disposed) return;
        try {
          const dt = Math.min(clock.getDelta(), 0.05);
          const time = clock.elapsedTime;

          // === GPU 预热（它决定 boot 屏何时撤下）===
          // boot 必须等到 3D 页面**真正渲染顺畅**之后才消失 —— 否则撤下那一刻仍在编译
          // 着色器 / 上传纹理，用户就会看到「boot 没了、画面卡一下才动」。判据见文件顶部常量注释。
          if (bootStore.phase === 'warmup') {
            const w = warmupRef.current;
            if (!w.compiled) {
              w.compiled = true;
              w.startedAt = performance.now();
              // 预编译场景全部材质（项目 BootController 同款手法），吃掉首次 pipeline 创建卡顿
              const compileAsync = (renderer as unknown as {
                compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown>;
              }).compileAsync;
              if (compileAsync) {
                Promise.resolve(compileAsync.call(renderer, scene, camera)).catch(() => {
                  /* 预编译失败不阻塞流程：后续渲染仍会即时编译 */
                });
              }
            }
            w.frames++;
            w.smooth = dt < WARMUP_FRAME_SEC ? w.smooth + 1 : 0;
            const elapsed = (performance.now() - w.startedAt) / 1000;
            setBootWarmupProgress(Math.min(1, elapsed / WARMUP_SECONDS));
            const ready = w.frames >= WARMUP_MIN_FRAMES && w.smooth >= WARMUP_MIN_SMOOTH && elapsed >= WARMUP_SECONDS;
            if (ready || elapsed >= WARMUP_TIMEOUT_SEC) markBootWarmupDone();
          }

          // boot 画布仍在绘制期间刷新共享贴图：显示器屏幕用的是同一张 boot 画面（原件同源做法）。
          // 注意这里问的是「是否仍在绘制」而非「是否显示在 DOM 上」—— countdown / reveal 期间
          // 画布已隐藏（画面交给合成链），但它仍在绘制，屏上的 boot 画面要保持是活的。
          if (bootOverlay.isLive()) bootTexture.needsUpdate = true;

          // === 相机进度（原件 pC 原文，1:1）===
          // 滚动推进与入场**共用同一条路径**，没有独立入场曲线：
          //   s = max(-1, scroll + (initialTransitionDone ? 0 : 1 - initialTransition))
          //   u = 1 - (1 - clamp(s / 0.8, 0, 1)) ^ 1.4
          // boot 期间 initialTransition = 0 → s = 1 → 相机停在屏幕特写（此时 boot 覆盖画面）；
          // 资产就绪 boot 被切掉后，500ms 静置 + 弹簧(30/8) 把 s 从 1 拉到 0 → 镜头拉远到基础机位。
          // bootStore 的 countdown / reveal 就是这两段（同一组弹簧参数），故此处直接读它。
          scrollSmooth += (scrollTargetRef.current - scrollSmooth) * Math.min(1, dt * 6);
          pageScrollRef.current = scrollSmooth;
          // hero 相机只消费时间轴的前 1vh；进入 projects 页后停在穿越终点（画面已整屏交给 projects）
          const heroScroll = Math.min(scrollSmooth, HERO_TIMELINE.heroLength);
          const progress = Math.max(-1, heroScroll + (bootStore.springDone ? 0 : 1 - bootStore.spring));
          const u = Math.min(progress / HERO_SCROLL.pushRange, 1);
          const ease = 1 - Math.pow(1 - u, HERO_SCROLL.easeOutPower);

          // 鼠标视差：原件 `getMouseOffset() × 0.3 × (1 - u)`，其中
          // offset = (0.5 - mouseX, mouseY - 0.5) ∈ ±0.5（mouseY 为 1 - clientY/height）
          // 本页 mouseRef 是 ±1 归一化坐标 → 换算：x 取负半幅、y 取正半幅，幅度因此是 0.3 × 0.5。
          mouseSmoothX += (mouseRef.current.x - mouseSmoothX) * Math.min(1, dt * 8);
          mouseSmoothY += (mouseRef.current.y - mouseSmoothY) * Math.min(1, dt * 8);
          const par = HERO_SCROLL.parallaxAmount * (1 - ease) * 0.5;
          const offX = -mouseSmoothX * par;
          const offY = mouseSmoothY * par;

          // 相机 = lerp(基础机位, 屏幕特写位, ease)，再叠鼠标视差（原件两条都按 eased u 取值）
          camera.position.set(
            basePos.x + (endPos.x - basePos.x) * ease + offX,
            basePos.y + (endPos.y - basePos.y) * ease + offY,
            basePos.z + (endPos.z - basePos.z) * ease
          );
          // 注视点 = lerp(场景原点, 屏幕世界中心, ease)
          tmpLook.set(
            HERO_CAMERA.baseLookAt[0] + (endLookAt.x - HERO_CAMERA.baseLookAt[0]) * ease,
            HERO_CAMERA.baseLookAt[1] + (endLookAt.y - HERO_CAMERA.baseLookAt[1]) * ease,
            HERO_CAMERA.baseLookAt[2] + (endLookAt.z - HERO_CAMERA.baseLookAt[2]) * ease
          );
          camera.lookAt(tmpLook);

          // 投射灯强度抖动（原件 po：5 + 0.6sin10t + 0.25sin23t + 0.15sin47t）
          const [a0, a1, a2] = HERO_PROJECTOR.animAmplitudes;
          const [f0, f1, f2] = HERO_PROJECTOR.animFrequencies;
          projLight.intensity =
            HERO_PROJECTOR.baseIntensity + a0 * Math.sin(f0 * time) + a1 * Math.sin(f1 * time) + a2 * Math.sin(f2 * time);

          smoke.update(dt);
          // 百叶标题幕：原件在 `s ≤ 0.1` 时显形、`s > 0.1` 时收场（阈值见 HERO_SCROLL.textHideThreshold）
          slats.update(dt, time, progress <= HERO_SCROLL.textHideThreshold);
          // 循环片每帧重绘；屏幕内容切换用相机同一条进度 s（原件 `smoothstep(.05,.55,progress)`）：
          // s=1 时屏幕显示开机底图，随 s 降到 0 切到循环片 —— 与镜头拉远同一进度、天然同步
          screenLoop.update();
          uScreenIntro.value = progress;
          // 原件 `sceneBlend = initialTransitionDone ? 1 : clamp(scroll/.15, 0, 1)`：
          // 入场未完成时显示器只能看到 boot，入场一结束立刻切到 projects 场景
          uScreenBlend.value = bootStore.springDone
            ? 1
            : Math.min(1, Math.max(0, heroScroll / 0.15));

          // 穿越完成 → Selected Work UI 覆盖层淡入
          if (overlayRef.current) {
            const ot = Math.min(1, Math.max(0, (scrollSmooth - 0.96) / 0.1));
            const oo = ot * ot * (3 - 2 * ot);
            overlayRef.current.style.opacity = String(oo);
            overlayRef.current.style.visibility = oo < 0.002 ? 'hidden' : 'visible';
          }

          // Selected Work 场景每帧渲到离屏 RT：显示器屏幕与合成链共用这张纹理。
          // 鼠标 y 在场景里是「向上为正」，而本页 mouseRef.y 是 DOM 的下正上负 → 取反。
          projects.update(dt, time, {
            mouseX: mouseRef.current.x,
            mouseY: -mouseRef.current.y,
            selectedIndex: selectedIndexRef.current,
            dragPx: dragPxRef.current,
          });
          renderer.setRenderTarget(projectsRT);
          await doRender(projects.scene, projects.camera);
          renderer.setRenderTarget(null);

          if (useCompose && compose) {
            // boot 期的两条门（对应原件 `isReadyToRender == 0` 与 `e$ = smoothstep(0,1,1-initialTransition)`）：
            //  - loadingActive：**只覆盖到「还没就绪」为止**（loading / warmup）—— 原件是资产一就绪就硬切，
            //    切掉那一刻相机正停在屏幕特写位，随后 500ms 静置 + 弹簧才把镜头拉远。
            //    注意不要写成 `phase !== 'done'`：那会把 loading 屏一路盖到弹簧收敛，
            //    镜头拉远整段被挡在 boot 画面后面，观感就是「加载完的推进没了」。
            //  - loadingMix：效果参数的渐出权重，随显现弹簧 0→1 从 loading 值过渡到 hero 值
            //    （原件就是按 initialTransition 渐出的，与上面的纹理门是两个不同的门）
            const bootActive = bootStore.phase === 'loading' || bootStore.phase === 'warmup';
            await compose.render(renderer, scene, camera, {
              time,
              dt,
              portrait: window.innerHeight > window.innerWidth,
              loadingActive: bootActive,
              loadingMix: 1 - Math.min(1, Math.max(0, bootStore.spring)),
              pageScroll: scrollSmooth,
            });
          } else {
            renderer.setRenderTarget(null);
            await doRender(scene, camera);
          }
        } catch (err) {
          if (!frameErrored) {
            frameErrored = true;
            useCompose = false;
            // eslint-disable-next-line no-console
            console.error('[HeroOneToOne] 渲染循环抛错，已退化为直渲：', err);
            diag.push('循环错误→直渲');
            pushHud('已就绪');
          }
        }
        raf = requestAnimationFrame(() => { void frame(); });
      };
      raf = requestAnimationFrame(() => { void frame(); });

      // ---------- 13. 卸载 ----------
      cleanups.push(() => {
        cancelAnimationFrame(raf);
        gltf?.scene?.traverse((o: THREE.Object3D) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.geometry?.dispose();
            const mat = mesh.material as THREE.Material | THREE.Material[];
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else mat?.dispose();
          }
        });
        screenMesh.geometry.dispose();
        screenMat.dispose();
        dirt.dispose(); grunge.dispose(); smokeMap.dispose();
        screenLoop.dispose();
        draco.dispose?.();
        renderer.dispose?.();
        host.removeChild(renderer.domElement);
      });
    })().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[HeroOneToOne] 初始化失败：', err);
      hudRef.current('初始化失败：' + (err?.message ?? String(err)));
      // 初始化失败 → bootStore 会永远停在 loading，必须强制结束 boot 覆盖屏，
      // 否则一块 BIOS 蓝会永久盖住页面
      bootPass?.finish();
    });

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return (
    <div ref={hostRef} style={{ position: 'fixed', inset: 0, background: '#0a0b0d', overflow: 'hidden' }}>
      {/* 穿越完成后的 Selected Work 覆盖层：导航 / 翻页箭头 / 滚动提示与独立页同源，
          透明度由主循环按时间轴驱动（pageScroll ≥ 0.96 开始淡入） */}
      <div
        ref={overlayRef}
        style={{
          position: 'fixed',
          inset: 0,
          opacity: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          zIndex: 45,
          willChange: 'opacity',
        }}
      >
        <SelectedWorkUI
          onPrev={() => selectedApiRef.current?.prev()}
          onNext={() => selectedApiRef.current?.next()}
          onScrollHint={() => selectedApiRef.current?.about()}
        />
      </div>
      {/* boot 覆盖屏由 createHeroBootPass 以画布注入（见 effect），此处只留 HUD */}
      <div
        style={{
          position: 'absolute', left: 16, bottom: 16, right: 16, color: 'rgba(255,255,255,.6)',
          font: '12px/1.6 ui-monospace, Consolas, monospace', pointerEvents: 'none',
          display: showHud ? 'block' : 'none',
        }}
      >
        {hud}
      </div>
    </div>
  );
}

/**
 * 按原件配方替换模型材质（原件 `pn` / `pa` / `ps` / `pi`）
 *
 * 功能：遍历加载好的 glTF，按节点名 computer / keyboard / logo / background 分别套上
 *      原件那四套 MeshStandardNodeMaterial 配方，几何与节点自身变换保持 glTF 原样。
 *
 * 参数：
 *  - root     {THREE.Object3D} glTF 场景根
 *  - dirt     {THREE.Texture}  机身污渍贴图（原件 cloudTexture = dirt.jpg）
 *  - grunge   {THREE.Texture}  机身材质磨损贴图（原件 grungeTexture = grunge.webp）
 *
 * 返回值：无
 *
 * 异常：无（节点名缺失时跳过该节点，保留原材质）
 *
 * 注意事项：
 *  - computer：metalness .83 / roughness .8 / DoubleSide，colorNode 走「提亮 + 幂曲线」
 *    `((rgb * vec3(.9,1,1)) * 1.5 + 0.25)^1.2`（原件 mix 的混合系数是 0，等价于不混亮度）
 *  - keyboard：纯黑 + metalness 0 / roughness .2
 *  - logo：自带贴图 + metalness 1 / roughness 0 + emissiveNode = 贴图 × 0.4
 *  - background：原件是一段复合配方（grunge(uv×50) 与 cloud(uv×7) 参与提亮/压暗、
 *    再按局部 Y 与两个距离场做渐隐、最后叠加「屏幕光溢出」）。这里**完整实现**：
 *    光溢出由循环片的 lightTexture 驱动（原件里对应「从属视频」），4 点环绕采样后按
 *    距离渐隐乘 0.1
 */
function replaceModelMaterials(
  root: THREE.Object3D,
  dirt: THREE.Texture,
  grunge: THREE.Texture,
  lightTexture: THREE.Texture,
  spillFactory: ReturnType<typeof createHeroSpillFactory> | null
): string {
  const lum = T.vec3(0.299, 0.587, 0.114);
  const NODE_NAMES = ['computer', 'keyboard', 'logo', 'background'];
  /** 逐节点材质诊断（贴图是否可用），拼成字符串返回给 HUD */
  const nodeDiag: string[] = [];

  /**
   * 安全取一份溅射节点
   *
   * 功能：从工厂构建一份**独立**的溅射节点（每个材质各一份，不跨材质共享实例），
   *      并把构建失败也吞掉 —— 溅射是本页的加法装饰项，绝不能因为它让整机消失。
   *
   * 参数：
   *  - factory {ReturnType<typeof createHeroSpillFactory> | null} 溅射工厂（可能为 null）
   *
   * 返回值：TSL 节点或 null（null 表示不使用溅射）
   *
   * 异常：无（内部 try/catch）
   *
   * 注意事项：`positionWorld` 等节点依赖材质上下文，所以必须每材质各建一份
   */
  const safeSpillNode = (): unknown | null => {
    if (!spillFactory) return null;
    try {
      return spillFactory.makeNode();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[HeroOneToOne] 溅射节点构建失败，该材质跳过溅射：', err);
      return null;
    }
  };

  /**
   * 把 glTF 贴图转成本实例的贴图（关键修复）
   *
   * 功能：`three/addons/loaders/GLTFLoader.js` 内部 `import … from 'three'`，
   *      所以它解出的贴图属于**另一份 three 实例**。把这种贴图丢给 `three/webgpu` 的
   *      TSL `texture()` 会被拒（`TextureNode: Need a three.js texture.`）并让整块材质编译失败。
   *      本函数用同一张图像数据在本实例重新包一层 Texture，并提供空值兜底。
   *
   * 参数：
   *  - tex {THREE.Texture | null | undefined} 可能来自另一份 three 实例的贴图
   *
   * 返回值：本实例的 THREE.Texture；无法转换或为空时返回 null
   *
   * 异常：无
   *
   * 注意事项：用 `instanceof THREE.Texture` 判定是否同实例 —— 跨实例时该判定为 false，
   *          正好用来识别「外来贴图」。复制 colorSpace / wrapping / repeat / flipY 等关键属性，
   *          避免重新包一层后外观变化。
   */
  const toOwnTexture = (tex: unknown): THREE.Texture | null => {
    if (!tex) return null;
    if (tex instanceof THREE.Texture) return tex;
    // 外来实例：类型体系不同但结构一致，按结构访问其属性
    const src = tex as THREE.Texture;
    try {
      const t = new THREE.Texture(src.image as HTMLImageElement | undefined);
      t.colorSpace = src.colorSpace;
      t.wrapS = src.wrapS;
      t.wrapT = src.wrapT;
      t.repeat.copy(src.repeat);
      t.offset.copy(src.offset);
      t.flipY = src.flipY;
      t.generateMipmaps = src.generateMipmaps;
      t.needsUpdate = true;
      return t;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[HeroOneToOne] 外来贴图转换失败：', err);
      return null;
    }
  };

  /**
   * 解析 mesh 归属的原件节点名
   *
   * 说明：glTF 在不同导入路径下可能把节点名挂在 Group 上、mesh 自己叫几何名，
   * 所以先看自身名，再看祖先链，保证四套配方都能命中。
   */
  const resolveNodeName = (mesh: THREE.Mesh): string => {
    if (NODE_NAMES.includes(mesh.name)) return mesh.name;
    let p: THREE.Object3D | null = mesh.parent;
    while (p) {
      if (NODE_NAMES.includes(p.name)) return p.name;
      p = p.parent;
    }
    return '';
  };

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const srcMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const srcMap = srcMat?.map ?? null;
    const nodeName = resolveNodeName(mesh);

    if (nodeName === 'computer') {
      const ownMap = toOwnTexture(srcMap);
      nodeDiag.push('computer:map=' + (ownMap ? 'ok' : 'none') + (srcMap && !(srcMap instanceof THREE.Texture) ? '(外来)' : ''));
      const m = new THREE.MeshStandardNodeMaterial();
      if (ownMap) m.map = ownMap;
      m.metalness = 0.83;
      m.roughness = 0.8;
      m.side = THREE.DoubleSide;
      const rgb = ownMap ? T.vec3(T.texture(ownMap, T.uv()).rgb) : T.vec3(T.float(0.55));
      (m as any).colorNode = rgb.mul(T.vec3(0.9, 1, 1)).mul(1.5).add(0.25).pow(T.vec3(1.2));
      // 屏幕光溅射走 emissiveNode（加法项）：不受 metalness 0.83 的金属吸收影响，才能看得见
      const spillNode = safeSpillNode();
      if (spillNode) (m as any).emissiveNode = spillNode;
      mesh.material = m;
      return;
    }

    if (nodeName === 'keyboard') {
      nodeDiag.push('keyboard:black');
      const m = new THREE.MeshStandardNodeMaterial();
      m.color.set('black');
      m.metalness = 0;
      m.roughness = 0.2;
      // 键盘基材 albedo 是纯黑，若把溅射加进 colorNode 会永远看不见 —— 所以必须走 emissiveNode
      const kbSpill = safeSpillNode();
      if (kbSpill) (m as any).emissiveNode = kbSpill;
      mesh.material = m;
      return;
    }

    if (nodeName === 'logo') {
      const ownMap = toOwnTexture(srcMap);
      nodeDiag.push('logo:map=' + (ownMap ? 'ok' : 'none'));
      const m = new THREE.MeshStandardNodeMaterial();
      if (ownMap) m.map = ownMap;
      m.metalness = 1;
      m.roughness = 0;
      const logoSpill = safeSpillNode();
      const logoEmissive = ownMap ? T.texture(ownMap).rgb.mul(0.4) : T.vec3(1, 1, 1);
      (m as any).emissiveNode = logoSpill ? logoEmissive.add(logoSpill) : logoEmissive;
      mesh.material = m;
      return;
    }

    if (nodeName === 'background') {
      const ownMap = toOwnTexture(srcMap);
      nodeDiag.push('background:map=' + (ownMap ? 'ok' : 'none'));
      const m = new THREE.MeshStandardNodeMaterial();
      if (ownMap) m.map = ownMap;
      m.roughness = 0.8;
      m.metalness = 0;

      const pl = T.positionLocal;
      // grunge 与 cloud 的提亮项
      const gTex = T.texture(grunge, T.uv().mul(50)).rgb;
      const gLum = T.dot(gTex, lum).sqrt();
      const cTex = T.texture(dirt, T.uv().mul(7)).rgb;
      const cLum = T.clamp(T.dot(cTex, lum).mul(2), 0, 2).pow(3);
      const base = ownMap ? T.texture(ownMap, T.uv()).rgb : T.vec3(T.float(0.35));
      const A = T.clamp(base.mul(cLum).mul(0.7).add(base).add(base.mul(gLum).mul(0.1)), 0, 1);

      // 两个距离场：一个高处的「暗点」（原件 d 的 y 分量桌面端取 4）与一个暖点
      const cY = T.smoothstep(5, 20, pl.y);
      const d = T.vec3(-47, 4, 30);
      const h = T.length(pl.sub(d));
      const g = T.smoothstep(15, 45, h);
      const f = T.vec3(-16, 0, -7);
      const p = T.length(pl.sub(f));
      const mFac = T.float(0.7).add(T.float(0.3).mul(T.smoothstep(0, 10, p)));

      // 屏幕光溢出：原件用「从属视频」纹理做 4 点环绕采样，按到暗点的距离渐隐后乘 0.1
      // 这里用循环片的 lightTexture（与内容同源），机制一致
      const dxy = pl.sub(d).xy.div(42).mul(0.5).add(0.5);
      const E = T.float(1).sub(T.smoothstep(10, 30, h));
      const lightTap = (ox: number, oy: number) =>
        T.texture(lightTexture, dxy.add(T.vec2(ox, oy))).rgb;
      const spill = lightTap(0, 0)
        .mul(0.5)
        .add(lightTap(0.5, 0.5))
        .add(lightTap(-0.5, 0.5))
        .add(lightTap(0.5, -0.5))
        .add(lightTap(-0.5, -0.5))
        .div(4.5)
        .mul(E)
        .mul(0.1);

      (m as any).colorNode = T.mix(A, T.vec3(0), g)
        .add(T.mix(A, T.vec3(0), cY).mul(g))
        .mul(1.5)
        .pow(T.vec3(1.5))
        .mul(mFac)
        .add(spill);
      mesh.material = m;
    }
  });

  // 返回逐节点贴图诊断，交由 HUD 展示（贴图缺失/跨实例是此前整机不可见的根因）
  return nodeDiag.length ? nodeDiag.join(' ') : '未命中任何节点';
}

/**
 * 生成屏幕颜色节点（照原件 `pl` 的 colorNode 原文）
 *
 * 功能：实现原件那条
 *      `mix(reelTexture.rgb * 4 min 1, mix(loadingScreen, projectsScene, sceneBlend), smoothstep(.05,.55,progress))`
 *      —— 开机/入场期间（progress→1）屏幕显示 boot 画面，随 progress 降到 0 切到循环片；
 *      `sceneBlend` 决定内层是 boot 还是 projects 实时场景（入场结束后恒为 1）。
 *
 * 参数：
 *  - content          {THREE.Texture} 循环片内容纹理（程序化自制，对应原件的视频流）
 *  - loadingScreen    {THREE.Texture} boot 画面纹理（与全屏覆盖层**同一张画布**，见调用处）
 *  - projectsTexture  {THREE.Texture} projects 场景离屏 RT
 *  - intro            {unknown}       TSL float uniform，取相机那一条进度 s（1 = 开机中，0 = 已入场）
 *  - sceneBlend       {unknown}       TSL float uniform，`initialTransitionDone ? 1 : clamp(scroll/.15,0,1)`
 *  - viewportAspect   {unknown}       TSL float uniform，视口宽高比（原件 dimensions.x/dimensions.y）
 *  - viewportDims     {unknown}       TSL vec2 uniform，视口像素尺寸（只用于 AW 的宽高比圆角）
 *
 * 返回值：TSL 节点（vec3，屏幕颜色）
 *
 * 异常：无
 *
 * 注意事项：
 *  - 两套取样 uv 都照原件：
 *      `i = (uv - 0.5) / 0.9 + 0.5`（不裁剪）→ `n = clamp(i, 0, 1)`（loadingScreen 用 n 的映射 c）
 *      横屏时 x 直取、y 按 `a/s` 拉伸；竖屏时 x 按 `s/a` 收窄。projects 用未裁剪的 i 的映射 d，
 *      再交给 `sampleScreenProjects`（原件 AW：桶形 + 圆角，界外黑）。
 *  - `1 - ...` 对应 FBO 语义（flipY=false / WebGPU RT）的贴图；调用方必须把 bootTexture.flipY 置 false，
 *    否则 CanvasTexture 默认的 flipY=true 会再翻一次，显示器上的 boot 反成上下颠倒。
 *  - 内容亮度按原件乘 4 后截顶（`mul(4).min(1)`），让屏幕成为画面里最亮的元素
 */
function makeScreenContentNode(
  content: THREE.Texture,
  loadingScreen: THREE.Texture,
  projectsTexture: THREE.Texture,
  intro: any,
  sceneBlend: any,
  viewportAspect: any,
  viewportDims: any
): unknown {
  const i = T.uv().sub(0.5).div(0.9).add(0.5);
  const n = T.clamp(i, 0, 1);
  const planeAspect = HERO_SCREEN.planeAspect[0] / HERO_SCREEN.planeAspect[1];
  const a = viewportAspect;
  const s = T.float(planeAspect);
  const l = s.div(a);
  const A = a.div(s);
  const wide = a.greaterThan(s);
  /** 原件映射：横屏 x 直取 / 竖屏 x 收窄；y 反向（FBO 方向） */
  const mapX = (x: any) => T.select(wide, x, x.mul(l).sub(l.sub(1).mul(0.5)));
  const mapY = (y: any) => T.oneMinus(T.select(wide, y.mul(A).sub(A.sub(1).mul(0.5)), y));
  const c = T.vec2(mapX(n.x), mapY(n.y));
  const d = T.vec2(mapX(i.x), mapY(i.y));

  const projects = sampleScreenProjects(
    projectsTexture,
    d,
    T.float(HERO_TIMELINE.screenLensDistortion),
    T.float(HERO_TIMELINE.screenLensBorder),
    viewportDims
  );
  const boot = T.texture(loadingScreen, c).rgb;
  const inner = T.mix(boot, projects.rgb, sceneBlend);

  const reel = T.texture(content, T.uv()).rgb.mul(HERO_SCREEN_PLANE.reelBoost).min(1);
  const [m0, m1] = HERO_SCREEN_PLANE.bootMixRange;
  return T.mix(reel, inner, T.smoothstep(m0, m1, intro));
}
