/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { sampleScreenProjects } from './heroCompose';
import { createHeroScreenLoop } from './heroScreenLoop';
import { GoboSpotLight, GoboSpotLightNode } from './heroGoboLight';
import { createHeroBootPass } from './heroBootPass';
import { createHeroSlats } from './heroSlats';
import {
  bootStore, clearBootAssets, markBootWarmupDone, registerBootAsset,
  resetBoot, setBootWarmupProgress, skipBoot,
} from '../boot/bootStore';

/**
 * hero 段场景模块（原件 `pC` / `pu` / `pl` / `po` / `pp` / `pT` 的整体封装）
 *
 * 从 HeroOneToOne.tsx 抽出，供全站合并后的 experience 宿主：
 *  - 场景/相机/材质配方/灯架/烟层/百叶幕/boot 覆盖屏全部在本模块内
 *  - 胶片页 RT 由宿主注入（`setFilmTarget`）——全站只有一份胶片场景，
 *    显示器屏幕内容与穿越交叉淡化读同一张 RT（原件同源做法）
 *  - 滚动轴 / 输入 / 合成链 / UI 由宿主持有；本模块只吃 `scroll` 摆相机
 *
 * 反编译来源（原件生产包 `04kr7kd5riobb.js`）：
 *  - 相机：基础位 (0,0.2,4.5) 看原点；滚动推进与入场共用同一条插值
 *    `s = max(-1, scroll + (initialTransitionDone ? 0 : 1 - initialTransition))`、
 *    `u = 1-(1-clamp(s/0.8,0,1))^1.4`、相机 = lerp(基础位, 屏幕特写位, u)
 *  - 屏幕特写位 = 屏幕世界中心 + 法线 × 取景距离（按屏幕世界缩放反解 ×0.9）
 *  - 屏幕材质：`mix(reel.rgb*4 min 1, mix(loadingScreen, projects, sceneBlend), smoothstep(.05,.55,s))`
 *  - 投射灯 `po`：intensity = 5 + 0.6sin10t + 0.25sin23t + 0.15sin47t
 *  - 百叶幕 `pp`：s ≤ 0.1 显形
 */
const T = TSL as any;

/** GPU 预热判据（boot 必须在 3D 页面真正渲染顺畅后才撤下，判据对齐项目 BootController） */
const WARMUP_SECONDS = 0.4;
const WARMUP_MIN_FRAMES = 12;
const WARMUP_MIN_SMOOTH = 6;
const WARMUP_FRAME_SEC = 0.04;
const WARMUP_TIMEOUT_SEC = 3;

export interface HeroSceneFrame {
  dt: number;
  time: number;
  /** 全局滚动（屏，0 基）；hero 相机只消费前 1vh */
  scroll: number;
  /** 鼠标 NDC（-1~1，y 向上为正——由宿主换算） */
  mouseX: number;
  mouseY: number;
}

export interface HeroSceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** boot 覆盖屏（画布同时喂 compose 的 loading 纹理与屏幕材质）；不播 boot 时为兜底 1×1 画布 */
  boot: {
    canvas: HTMLCanvasElement;
    isLive: () => boolean;
    finish: () => void;
  };
  /** 注入胶片页 RT（显示器屏幕内容 + 穿越纹理同源）；px 尺寸用于屏幕映射的圆角宽高比 */
  setFilmTarget: (texture: THREE.Texture | null, pxW: number, pxH: number) => void;
  /** 逐帧推进，返回相机进度 s（原件 progress，调试与轴联动用） */
  update: (frame: HeroSceneFrame) => number;
  setSize: (w: number, h: number) => void;
  /** 模型加载完成（失败也 resolve，场景以「无模型」降级运行） */
  ready: Promise<void>;
  /** 调试：屏幕世界参数与 boot store 直读（自动化验证用，无副作用） */
  __debug: { screenWorldPos: THREE.Vector3; endPos: THREE.Vector3; endLookAt: THREE.Vector3 };
  dispose: () => void;
}

export function createHeroScene(
  renderer: THREE.WebGPURenderer,
  host: HTMLElement,
  width: number,
  height: number,
  opts: { playBoot: boolean }
): HeroSceneHandle {
  const { playBoot } = opts;
  let disposed = false;
  const cleanups: Array<() => void> = [];

  // ---------- boot 屏 ----------
  // 播 boot：复用项目原有 boot 体系（bootStore + boot GLSL + 点阵字体），覆盖画布
  // 同时作为贴图喂给显示器屏幕材质（原件同源做法）。不播：1×1 兜底画布，
  // loadingActive 恒 false、屏幕 sceneBlend 恒 1，这张纹理永远不会被采样。
  let bootOverlay: ReturnType<typeof createHeroBootPass> | null = null;
  let bootCanvas: HTMLCanvasElement;
  let bootAsset: ReturnType<typeof registerBootAsset> | null = null;
  if (playBoot) {
    clearBootAssets();
    resetBoot();
    bootAsset = registerBootAsset('hero-init', 1);
    bootAsset.setProgress(0.12);
    bootOverlay = createHeroBootPass(host);
    cleanups.push(bootOverlay.dispose);
    bootCanvas = bootOverlay.canvas;
    bootAsset.setProgress(0.35);
  } else {
    skipBoot();
    bootCanvas = document.createElement('canvas');
    bootCanvas.width = 1;
    bootCanvas.height = 1;
    // WebGPU 的纹理上传走 copyExternalImageToTexture，要求 canvas 已绑定渲染
    // 上下文；这个兜底画布若从不 getContext，只要它所在场景一被渲染（例如
    // #selected-work 直链回滚跨过 scroll 1.0 后 hero 段恢复渲染）就会抛
    // OperationError "canvas without rendering context"，并让整帧渲染中断。
    // 拿一个 2D 上下文并画一个纯白像素即满足上传前提（该纹理在 loadingActive
    // 恒 false 之下永远不会被实际采样，内容无关紧要）。
    const bootCtx = bootCanvas.getContext('2d');
    if (bootCtx) {
      bootCtx.fillStyle = '#ffffff';
      bootCtx.fillRect(0, 0, 1, 1);
    }
  }

  // ---------- 场景 / 相机 / 补光 ----------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0b0d);
  const camera = new THREE.PerspectiveCamera(
    HERO_CAMERA.fov, width / Math.max(1, height), HERO_CAMERA.near, HERO_CAMERA.far
  );
  camera.position.set(...HERO_CAMERA.basePosition);
  camera.lookAt(...HERO_CAMERA.baseLookAt);
  scene.add(new THREE.AmbientLight(new THREE.Color(HERO_AMBIENT.color), HERO_AMBIENT.intensity));

  try {
    const env = createHeroEnvironment(renderer, scene);
    cleanups.push(env.dispose);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[heroScene] 环境灯架失败：', err);
  }

  // ---------- 贴图 ----------
  const loader = new THREE.TextureLoader();
  const dirt = loader.load(HERO_ASSETS.dirtUrl);
  dirt.wrapS = THREE.RepeatWrapping; dirt.wrapT = THREE.RepeatWrapping;
  const grunge = loader.load(HERO_ASSETS.grungeUrl);
  grunge.wrapS = THREE.RepeatWrapping; grunge.wrapT = THREE.RepeatWrapping;
  // boot 画面纹理（FBO 语义 flipY=false，与屏幕材质里的 `1 - n.y` 配对）
  const bootTexture = new THREE.CanvasTexture(bootCanvas);
  bootTexture.colorSpace = THREE.SRGBColorSpace;
  bootTexture.minFilter = THREE.LinearFilter; bootTexture.magFilter = THREE.LinearFilter;
  bootTexture.generateMipmaps = false;
  bootTexture.flipY = false;
  cleanups.push(() => bootTexture.dispose());

  // 屏幕循环片（contentTexture 给屏幕、lightTexture 给投射灯 gobo 与背景光溢出）
  const screenLoop = createHeroScreenLoop();
  screenLoop.update();
  cleanups.push(screenLoop.dispose);

  // gobo 灯光节点注册（three 0.169 WebGPU 无 SpotLight.map —— 自定义 GoboSpotLightNode
  // 照官方 IESSpotLightNode 范本 fork，把 gobo 图案调制进完整 PBR 直接光）。
  // 注意：NodeLibrary 挂在 renderer.nodes.library（Nodes 实例的 library 属性）。
  (renderer.nodes as any).library.addLight(GoboSpotLightNode, GoboSpotLight);

  // ---------- 模型（照搬原件世界变换，不做归一化） ----------
  const gltfLoader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(HERO_ASSETS.dracoDecoderPath);
  gltfLoader.setDRACOLoader(draco);

  const modelGroup = new THREE.Group();
  modelGroup.position.set(...HERO_MODEL.groupPosition);
  modelGroup.scale.setScalar(HERO_MODEL.groupScale);
  modelGroup.rotation.y = HERO_MODEL.groupRotY;
  modelGroup.updateMatrixWorld(true);
  scene.add(modelGroup);

  const ready = (async () => {
    const gltf = await new Promise<any>((resolve, reject) =>
      gltfLoader.load(HERO_ASSETS.modelUrl, resolve, undefined, reject)
    ).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[heroScene] 模型加载失败：', err);
      return null;
    });
    if (disposed) return;
    if (gltf?.scene) {
      const model = gltf.scene as THREE.Group;
      replaceModelMaterials(model, dirt, grunge, screenLoop.lightTexture);
      modelGroup.add(model);
      modelGroup.updateMatrixWorld(true);
    }
    // 资产齐备 → boot 状态机进入 warmup（预热帧由 update 按真实渲染上报）
    bootAsset?.markDone();
  })();

  // ---------- 屏幕平面（三层嵌套，与原件同构） ----------
  const screenMat = new THREE.MeshBasicNodeMaterial();
  screenMat.toneMapped = false;
  const uScreenIntro = T.uniform(1);
  const uScreenBlend = T.uniform(0);
  const uViewportAspect = T.uniform(width / Math.max(1, height));
  // 胶片页 RT：宿主建好后经 setFilmTarget 换 `.value`（TextureNode 可换纹理约定）
  const filmPlaceholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  filmPlaceholder.needsUpdate = true;
  const filmTexNode = T.texture(filmPlaceholder);
  const uFilmDims = T.uniform(new THREE.Vector2(1, 1));
  (screenMat as unknown as { colorNode: unknown }).colorNode = makeScreenContentNode(
    screenLoop.contentTexture,
    bootTexture,
    filmTexNode,
    uScreenIntro,
    uScreenBlend,
    uViewportAspect,
    uFilmDims
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

  // ---------- 屏幕投射灯（原件 po）----------
  // gobo 灯：图案（灯光版纹理）调制进完整 PBR 直接光 —— diffuse×albedo（地板光斑贴材质色）、
  // specular（键帽镜面高光）、NdotL（明暗面）全部走 three 光照管线，等价原站 spotLight.map。
  const projGroup = new THREE.Group();
  projGroup.position.set(...HERO_PROJECTOR.groupPosition);
  const projTarget = new THREE.Object3D();
  projTarget.position.set(...HERO_PROJECTOR.targetLocal);
  projGroup.add(projTarget);
  const projLight = new GoboSpotLight(
    new THREE.Color('#ffffff'),
    HERO_PROJECTOR.baseIntensity,
    HERO_PROJECTOR.distance,
    HERO_PROJECTOR.angleRad,
    HERO_PROJECTOR.penumbra,
    HERO_PROJECTOR.decay
  );
  projLight.position.set(0, 0, 0);
  projLight.target = projTarget;
  projLight.goboMap = screenLoop.lightTexture;
  projGroup.add(projLight);
  // 消融开关：#hero?gobo=0 关掉 gobo 灯（对照「无屏幕光」的观感）
  if ((window.location.hash.split('?')[1] ?? '').includes('gobo=0')) {
    projLight.intensity = 0;
  }
  scene.add(projGroup);
  projGroup.updateMatrixWorld(true);

  // ---------- 前景烟层 ----------
  const smokeMap = loader.load(HERO_SMOKE.textureUrl);
  smokeMap.colorSpace = THREE.SRGBColorSpace;
  smokeMap.minFilter = THREE.LinearFilter;
  const smoke = createHeroSmoke(smokeMap);
  scene.add(smoke.group);
  cleanups.push(smoke.dispose);

  // ---------- 24 片百叶标题幕（原件 pp） ----------
  const slats = createHeroSlats();
  scene.add(slats.mesh);
  cleanups.push(slats.dispose);

  // ---------- 胶片纹理注入 ----------
  const setFilmTarget = (texture: THREE.Texture | null, pxW: number, pxH: number) => {
    if (texture) filmTexNode.value = texture;
    uFilmDims.value.set(Math.max(1, pxW), Math.max(1, pxH));
  };

  // 相机端位（原件公式：屏幕世界【缩放】反解，因屏幕几何是单位平面）
  const screenWorldPos = new THREE.Vector3();
  const screenWorldScale = new THREE.Vector3();
  const screenWorldQuat = new THREE.Quaternion();
  screenMesh.getWorldPosition(screenWorldPos);
  screenMesh.getWorldScale(screenWorldScale);
  screenMesh.getWorldQuaternion(screenWorldQuat);
  const screenNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(screenWorldQuat).normalize();

  const halfFov = ((HERO_CAMERA.fov * Math.PI) / 180) / 2;
  const aspect = width / Math.max(1, height);
  const sw = screenWorldScale.x;
  const sh = screenWorldScale.y;
  const frameDist =
    (aspect < sw / sh ? sh / 2 / Math.tan(halfFov) : sw / 2 / (Math.tan(halfFov) * aspect)) *
    HERO_CAMERA.framingFactor;

  const endPos = screenWorldPos.clone().add(screenNormal.clone().multiplyScalar(frameDist));
  const endLookAt = screenWorldPos.clone();
  const basePos = new THREE.Vector3(...HERO_CAMERA.basePosition);
  camera.position.copy(endPos);
  camera.lookAt(endLookAt);

  // ---------- 预热统计（playBoot 时由 update 驱动 bootStore） ----------
  const warmup = { startedAt: 0, frames: 0, smooth: 0, compiled: false };
  /** 相机视差的鼠标平滑值（原件 8/s 阻尼） */
  let mouseSmoothX = 0;
  let mouseSmoothY = 0;

  const setSize = (w: number, h: number) => {
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    uViewportAspect.value = w / Math.max(1, h);
  };
  setSize(width, height);

  const update = (frame: HeroSceneFrame): number => {
    const { dt, time, scroll, mouseX, mouseY } = frame;
    const dts = Math.min(Math.max(dt, 0.0001), 0.05);

    // === GPU 预热（它决定 boot 屏何时撤下） ===
    if (playBoot && bootStore.phase === 'warmup') {
      if (!warmup.compiled) {
        warmup.compiled = true;
        warmup.startedAt = performance.now();
        const compileAsync = (renderer as unknown as {
          compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown>;
        }).compileAsync;
        if (compileAsync) {
          Promise.resolve(compileAsync.call(renderer, scene, camera)).catch(() => {
            /* 预编译失败不阻塞流程 */
          });
        }
      }
      warmup.frames++;
      warmup.smooth = dts < WARMUP_FRAME_SEC ? warmup.smooth + 1 : 0;
      const elapsed = (performance.now() - warmup.startedAt) / 1000;
      setBootWarmupProgress(Math.min(1, elapsed / WARMUP_SECONDS));
      const done = warmup.frames >= WARMUP_MIN_FRAMES && warmup.smooth >= WARMUP_MIN_SMOOTH && elapsed >= WARMUP_SECONDS;
      if (done || elapsed >= WARMUP_TIMEOUT_SEC) markBootWarmupDone();
    }

    // boot 画布仍在绘制期间刷新共享贴图（countdown/reveal 期间画布已隐藏但仍活着）
    if (bootOverlay?.isLive()) bootTexture.needsUpdate = true;

    // === 相机进度（原件 pC 原文，1:1）===
    //   s = max(-1, scroll + (initialTransitionDone ? 0 : 1 - initialTransition))
    //   u = 1 - (1 - clamp(s / 0.8, 0, 1)) ^ 1.4
    // boot 期间 initialTransition = 0 → s = 1 → 相机停在屏幕特写（boot 覆盖画面）；
    // boot 切掉后 500ms 静置 + 弹簧(30/8) 把 s 从 1 拉到 0 → 镜头拉远到基础机位。
    const heroScroll = Math.min(scroll, HERO_TIMELINE.heroLength);
    const progress = Math.max(-1, heroScroll + (bootStore.springDone ? 0 : 1 - bootStore.spring));
    const u = Math.min(progress / HERO_SCROLL.pushRange, 1);
    const ease = 1 - Math.pow(1 - u, HERO_SCROLL.easeOutPower);

    // 鼠标视差：原件 `getMouseOffset() × 0.3 × (1 - u)` → NDC 入参换算 ±0.15；
    // 平滑 8/s 与 y 的 DOM 下正符号照 HeroOneToOne（y-up 入参取负）
    mouseSmoothX += (mouseX - mouseSmoothX) * Math.min(1, dts * 8);
    mouseSmoothY += (mouseY - mouseSmoothY) * Math.min(1, dts * 8);
    const par = HERO_SCROLL.parallaxAmount * (1 - ease) * 0.5;
    const offX = -mouseSmoothX * par;
    const offY = -mouseSmoothY * par;

    camera.position.set(
      basePos.x + (endPos.x - basePos.x) * ease + offX,
      basePos.y + (endPos.y - basePos.y) * ease + offY,
      basePos.z + (endPos.z - basePos.z) * ease
    );
    camera.lookAt(
      0 + (endLookAt.x - 0) * ease,
      0 + (endLookAt.y - 0) * ease,
      0 + (endLookAt.z - 0) * ease
    );

    // 投射灯强度抖动（原件 po：5 + 0.6sin10t + 0.25sin23t + 0.15sin47t）
    const [a0, a1, a2] = HERO_PROJECTOR.animAmplitudes;
    const [f0, f1, f2] = HERO_PROJECTOR.animFrequencies;
    projLight.intensity =
      HERO_PROJECTOR.baseIntensity + a0 * Math.sin(f0 * time) + a1 * Math.sin(f1 * time) + a2 * Math.sin(f2 * time);

    smoke.update(dts);
    // 百叶标题幕：s ≤ 0.1 显形（HERO_SCROLL.textHideThreshold）
    slats.update(dts, time, progress <= HERO_SCROLL.textHideThreshold);
    screenLoop.update();
    uScreenIntro.value = progress;
    // `sceneBlend = initialTransitionDone ? 1 : clamp(scroll/.15, 0, 1)`
    uScreenBlend.value = bootStore.springDone ? 1 : Math.min(1, Math.max(0, heroScroll / 0.15));

    return progress;
  };

  const dispose = () => {
    disposed = true;
    cleanups.forEach((fn) => fn());
    draco.dispose();
    filmPlaceholder.dispose();
  };

  return {
    scene,
    camera,
    boot: {
      canvas: bootCanvas,
      isLive: () => (bootOverlay ? bootOverlay.isLive() : false),
      finish: () => bootOverlay?.finish(),
    },
    setFilmTarget,
    update,
    setSize,
    ready,
    __debug: { screenWorldPos, endPos, endLookAt },
    dispose,
  };
}

/**
 * 按原件配方替换模型材质（原件 `pn` / `pa` / `ps` / `pi`）
 *
 * computer：metalness .83 / roughness .8 / DoubleSide，`((rgb*(0.9,1,1))*1.5+0.25)^1.2`；
 * keyboard：纯黑（光照观感由 gobo 聚光灯 + ambient + 环境承担）；
 * logo：metalness 1 / roughness 0 + 自发光 ×0.4；
 * background：grunge(uv×50) 与 cloud(uv×7) 复合配方 + 双距离场渐隐 + 屏幕光溢出（4 点环绕 ×0.1）
 */
function replaceModelMaterials(
  root: THREE.Object3D,
  dirt: THREE.Texture,
  grunge: THREE.Texture,
  lightTexture: THREE.Texture
): string {
  const lum = T.vec3(0.299, 0.587, 0.114);
  const NODE_NAMES = ['computer', 'keyboard', 'logo', 'background'];
  const nodeDiag: string[] = [];

  const toOwnTexture = (tex: unknown): THREE.Texture | null => {
    if (!tex) return null;
    if (tex instanceof THREE.Texture) return tex;
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
      console.warn('[heroScene] 外来贴图转换失败：', err);
      return null;
    }
  };

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
      nodeDiag.push('computer:map=' + (ownMap ? 'ok' : 'none'));
      const m = new THREE.MeshStandardNodeMaterial();
      if (ownMap) m.map = ownMap;
      m.metalness = 0.83;
      m.roughness = 0.8;
      m.side = THREE.DoubleSide;
      const rgb = ownMap ? T.vec3(T.texture(ownMap, T.uv()).rgb) : T.vec3(T.float(0.55));
      (m as any).colorNode = rgb.mul(T.vec3(0.9, 1, 1)).mul(1.5).add(0.25).pow(T.vec3(1.2));
      mesh.material = m;
      return;
    }

    if (nodeName === 'keyboard') {
      nodeDiag.push('keyboard:black');
      const m = new THREE.MeshStandardNodeMaterial();
      m.color.set('black');
      m.metalness = 0;
      m.roughness = 0.2;
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
      (m as any).emissiveNode = ownMap ? T.texture(ownMap).rgb.mul(0.4) : T.vec3(1, 1, 1);
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
      const gTex = T.texture(grunge, T.uv().mul(50)).rgb;
      const gLum = T.dot(gTex, lum).sqrt();
      const cTex = T.texture(dirt, T.uv().mul(7)).rgb;
      const cLum = T.clamp(T.dot(cTex, lum).mul(2), 0, 2).pow(3);
      const base = ownMap ? T.texture(ownMap, T.uv()).rgb : T.vec3(T.float(0.35));
      const A = T.clamp(base.mul(cLum).mul(0.7).add(base).add(base.mul(gLum).mul(0.1)), 0, 1);

      const cY = T.smoothstep(5, 20, pl.y);
      const d = T.vec3(-47, 4, 30);
      const h = T.length(pl.sub(d));
      const g = T.smoothstep(15, 45, h);
      const f = T.vec3(-16, 0, -7);
      const p = T.length(pl.sub(f));
      const mFac = T.float(0.7).add(T.float(0.3).mul(T.smoothstep(0, 10, p)));

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

  return nodeDiag.length ? nodeDiag.join(' ') : '未命中任何节点';
}

/**
 * 生成屏幕颜色节点（照原件 `pl` 的 colorNode 原文）
 *
 * 功能：实现原件那条
 *      `mix(reelTexture.rgb * 4 min 1, mix(loadingScreen, projectsScene, sceneBlend), smoothstep(.05,.55,progress))`
 *      —— 开机/入场期间（progress→1）屏幕显示 boot 画面，随 progress 降到 0 切到循环片；
 *      `sceneBlend` 决定内层是 boot 还是胶片页实时场景（入场结束后恒为 1）。
 *
 * 参数：
 *  - content          {THREE.Texture} 循环片内容纹理（程序化自制，对应原件的视频流）
 *  - loadingScreen    {THREE.Texture} boot 画面纹理（与全屏覆盖层**同一张画布**）
 *  - filmTexNode      {any}           胶片页 RT 的 TextureNode（宿主经 setFilmTarget 换 `.value`）
 *  - intro            {any}           TSL float uniform，取相机那条进度 s（1 = 开机中，0 = 已入场）
 *  - sceneBlend       {any}           TSL float uniform，`initialTransitionDone ? 1 : clamp(scroll/.15,0,1)`
 *  - viewportAspect   {any}           TSL float uniform，视口宽高比（原件 dimensions.x/dimensions.y）
 *  - filmDims         {any}           TSL vec2 uniform，胶片 RT 像素尺寸（只用于 AW 的宽高比圆角）
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
  filmTexNode: any,
  intro: any,
  sceneBlend: any,
  viewportAspect: any,
  filmDims: any
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

  const film = sampleScreenProjects(
    filmTexNode,
    d,
    T.float(HERO_TIMELINE.screenLensDistortion),
    T.float(HERO_TIMELINE.screenLensBorder),
    filmDims
  );
  const boot = T.texture(loadingScreen, c).rgb;
  const inner = T.mix(boot, film.rgb, sceneBlend);

  const reel = T.texture(content, T.uv()).rgb.mul(HERO_SCREEN_PLANE.reelBoost).min(1);
  const [m0, m1] = HERO_SCREEN_PLANE.bootMixRange;
  return T.mix(reel, inner, T.smoothstep(m0, m1, intro));
}
