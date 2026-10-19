/**
 * hero 页 boot 屏 —— 复用项目**原有 boot 体系**（不另造画法）
 *
 * 背景：hero 复刻页的场景跑在 three/webgpu + TSL 上，而项目原有 boot 是
 * WebGL 的 GLSL（`src/boot/bootShader.ts` 里的 `BOOT_COMMON_GLSL`）。
 * 为了做到"用户看到的就是项目里那块 boot 屏"，这里不做任何重画或近似：
 * 直接用一台轻量 WebGLRenderer 跑**同一段 `BOOT_COMMON_GLSL`**、
 * **同一批字体/文本 DataTexture**（`getBootTextures()`）、**同一份布局元数据**
 * （`bootLineMetaUniform()`）与**同一个进度/弹簧状态机**（`bootStore`），
 * 把 boot 画面渲染成一张铺满视口的画布盖在 hero 场景之上。
 *
 * 与项目的对应关系：
 *  - 项目的 BootPass（EffectComposer 里的 ShaderPass，见 PostProcessing.tsx）：
 *      boot 内容以 uBootAlpha 混在已渲染场景之上 → 这里换成一整张 DOM 画布，
 *      用**画布整体不透明度**承担同一个"显现期淡出"语义（视觉等价：
 *      mix(scene, boot, alpha) === boot 画布以 alpha 叠在场景上）
 *  - 项目的 BootController：GPU 预热 + 每帧 tickBoot → 这里由自带的 rAF 循环
 *      承担 tickBoot，预热帧数由 hero 主循环上报（见 HeroOneToOne.tsx）
 *
 * 注意事项：
 *  - 本模块只依赖 `three`（WebGL 构建），与 hero 的 `three/webgpu` 互不影响
 *  - 资产登记/重置由调用方负责（hero 挂载时 clearBootAssets + resetBoot，
 *    加载过程中 registerBootAsset 上报进度）
 *  - boot 屏是**铺满视口**的（BOOT_GRID 720×400 contain 适配，超出部分同为
 *    BIOS 蓝），与原项目的 BootPass 行为一致
 */
import * as THREE from 'three';
import {
  BOOT_COMMON_GLSL,
  applyBootAudioState,
  bootLineMetaUniform,
  getBootTextures,
} from '../boot/bootShader';
import { bootStore, tickBoot } from '../boot/bootStore';

/** 全屏四边形顶点着色器（PlaneGeometry(2,2) 直接铺满裁剪空间） */
const BOOT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * boot 屏片元着色器
 *
 * 说明：与项目 `bootShader.ts` 的 BootPassShader 的唯一差别是——不再与
 * tDiffuse 做 mix（那需要一张场景纹理），只输出 boot 内容本身；
 * "盖在场景上"由整张画布的 CSS 不透明度承担。`bootContent` 原样复用。
 */
const BOOT_FRAG = /* glsl */ `
  uniform float uProgress;
  uniform vec2 uResolution;
  uniform sampler2D uBootFont;
  uniform sampler2D uBootTest;
  uniform vec2 uBootTextSize;
  uniform float uBootGlyphCount;
  uniform float uBootDigitBase;
  uniform float uBootGlyphO;
  uniform float uBootGlyphK;
  uniform float uBootTime;
  uniform vec4 uLineMeta[8];
  varying vec2 vUv;

  ${BOOT_COMMON_GLSL}

  void main() {
    vec3 boot = bootContent(vUv, uResolution, uProgress);
    gl_FragColor = vec4(boot, 1.0);
  }
`;

/** boot 屏渲染器 dpr 上限（与原项目 `dpr: [1, 1.5]` 一致） */
const BOOT_MAX_DPR = 1.5;

/** 显现期 alpha 低于该值即视为完全淡出（与 PostProcessing 的判据一致） */
const ALPHA_EPS = 0.001;

/**
 * 创建 hero 页的 boot 屏覆盖层
 *
 * 功能：在给定宿主元素内注入一张铺满视口的画布，用项目原有的 boot GLSL +
 *      字体纹理 + bootStore 状态机每帧绘制 boot 画面；显现期随弹簧淡出，
 *      收敛后自动隐藏画布并停掉 rAF。
 *
 * 参数：
 *  - host {HTMLElement} 挂载宿主（hero 的铺满视口容器）
 *
 * 返回值：{ canvas, dispose }
 *  - canvas {HTMLCanvasElement} 注入的画布（调用方可按需置 display）
 *  - dispose {() => void} 释放渲染器/材质/几何、移除事件与画布
 *
 * 异常：无（WebGL 上下文创建失败时静默返回一张空画布，不阻塞 hero 主流程）
 *
 * 注意事项：
 *  - 画布 pointer-events 为 none，不拦截 hero 的滚轮/鼠标事件
 *  - 每帧调用 tickBoot 推进 bootStore（进度条阻尼 + 500ms 静置 + 显现弹簧），
 *    因此调用方**不要**再重复 tickBoot
 *  - 预热帧数（bootStore 的 warmup 阶段）由调用方在主循环里上报
 */
export function createHeroBootPass(host: HTMLElement) {
  const canvas = document.createElement('canvas');
  // 盖在 hero 的 WebGPU 画布之上；z-index 高于 renderer.domElement
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;opacity:1;';
  host.appendChild(canvas);

  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);

  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  } catch (err) {
    // boot 屏是覆盖层，创建失败不应让 hero 整页挂掉
    // eslint-disable-next-line no-console
    console.warn('[heroBootPass] WebGL 渲染器创建失败，boot 屏不可用：', err);
  }

  const t = getBootTextures();
  /** uniforms 与项目 BootPassShader 同名同义；applyBootAudioState 依赖 uBootTest / uLineMeta */
  const uniforms = {
    uBootFont: { value: t.uBootFont.value },
    uBootTest: { value: t.uBootTest.value },
    uBootTextSize: { value: t.uBootTextSize.value.clone() },
    uBootGlyphCount: { value: t.uBootGlyphCount.value },
    uBootDigitBase: { value: t.uBootDigitBase.value },
    uBootGlyphO: { value: t.uBootGlyphO.value },
    uBootGlyphK: { value: t.uBootGlyphK.value },
    uBootTime: { value: 0 },
    uLineMeta: { value: bootLineMetaUniform() },
    uProgress: { value: 0 },
    uResolution: { value: new THREE.Vector2(width, height) },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: BOOT_VERT,
    fragmentShader: BOOT_FRAG,
    uniforms,
    depthTest: false,
    depthWrite: false,
    // 整屏四边形独占输出，无需与其它绘制混合（画布整体不透明度承担淡出）
    blending: THREE.NoBlending,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** 真实时间基准：boot 进度按**墙钟**推进，不受后台标签页 rAF 节流影响 */
  const startMs = performance.now();
  let lastMs = startMs;

  /** 按宿主尺寸重设绘制缓冲（不覆盖 CSS 的 100% 尺寸，故 updateStyle=false） */
  const resize = () => {
    if (!renderer) return;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, BOOT_MAX_DPR);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    uniforms.uResolution.value.set(w * dpr, h * dpr);
  };
  if (renderer) {
    resize();
    window.addEventListener('resize', resize);
  }

  let raf = 0;
  let disposed = false;

  /** 每帧：推进 bootStore → 写 uniforms → 按显现 alpha 控制画布可见度 */
  const tick = () => {
    if (disposed) return;
    const now = performance.now();
    // 按真实时间补帧（tickBoot 内部把单步 clamp 到 0.05s，所以切成多个 ≤0.05 的小步消费），
    // 这样后台标签页 rAF 被节流到 1fps 时，boot 编排仍按墙钟正常走完，不会卡在进度条上
    let realDt = Math.min((now - lastMs) / 1000, 1.0);
    lastMs = now;
    while (realDt > 0) {
      const step = Math.min(0.05, realDt);
      tickBoot(step);
      realDt -= step;
    }

    uniforms.uProgress.value = bootStore.displayProgress;
    uniforms.uBootTime.value = (now - startMs) / 1000;
    // BGM 解锁态：文本行 "PRESS ANYWHERE…" ↔ "AUDIO: ON"（与 PostProcessing 同一调用）
    applyBootAudioState(uniforms);

    // 显现期淡出：alpha = 1 − spring；已收敛则 0（判据与 PostProcessing 完全一致）
    const alpha =
      bootStore.phase === 'reveal' ? Math.max(0, 1 - bootStore.spring) : bootStore.springDone ? 0 : 1;

    if (alpha > ALPHA_EPS) {
      canvas.style.opacity = String(alpha);
      if (renderer) renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    } else {
      // boot 结束：隐藏画布，并在弹簧收敛（phase = done）后停掉循环
      canvas.style.opacity = '0';
      canvas.style.display = 'none';
      if (bootStore.phase !== 'done') raf = requestAnimationFrame(tick);
    }
  };
  raf = requestAnimationFrame(tick);

  /**
   * 立即结束 boot 屏（异常兜底）
   *
   * 功能：隐藏画布并停掉 rAF 循环，用于「hero 初始化失败、bootStore 会永远停在
   *      loading 阶段」的兜底 —— 否则一块 BIOS 蓝会永久盖住页面。
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   * 注意事项：只停渲染与显示，不摘 DOM/不销毁资源，后续 dispose 仍正常生效
   */
  const finish = () => {
    disposed = true;
    cancelAnimationFrame(raf);
    canvas.style.display = 'none';
  };

  /**
   * 释放 boot 屏资源
   *
   * 功能：停 rAF、摘事件、销毁渲染器/材质/几何并把画布移出 DOM
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   * 注意事项：字体/文本 DataTexture 由 bootShader 的模块级单例持有，此处不销毁
   */
  const dispose = () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    geometry.dispose();
    material.dispose();
    renderer?.dispose();
    if (canvas.parentNode === host) host.removeChild(canvas);
    // 清掉调试钩子，避免卸载后仍指向已销毁的渲染器
    if (probeHost.__heroBootProbe === probe) probeHost.__heroBootProbe = undefined;
  };

  // 调试钩子：供自动化验证强制重绘一帧并回读像素（无副作用，保留）
  // 说明：boot 渲染器未开 preserveDrawingBuffer（省一次整屏拷贝），画布的位图
  //      只在渲染的同一个 JS 任务内可回读 —— 所以提供 redraw() 让验证脚本
  //      「重绘 → 立刻 drawImage 采样」，与 PostProcessing 的 __dofU 同款做法
  const probeHost = window as unknown as { __heroBootProbe?: unknown };
  const probe = {
    canvas,
    uniforms,
    redraw: () => renderer?.render(scene, camera),
  };
  probeHost.__heroBootProbe = probe;

  return { canvas, finish, dispose };
}
