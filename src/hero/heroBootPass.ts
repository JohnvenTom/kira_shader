/**
 * hero 页 boot 屏 —— 复用项目**原有 boot 体系**的绘制内容，行为照原件反编译结果
 *
 * 背景：hero 复刻页的场景跑在 three/webgpu + TSL 上，而项目原有 boot 是 WebGL 的 GLSL
 * （`src/boot/bootShader.ts` 里的 `BOOT_COMMON_GLSL`）。为了"用户看到的就是项目里那块
 * boot 屏"，这里不做重画或近似：直接用一台轻量 WebGLRenderer 跑**同一段
 * `BOOT_COMMON_GLSL`**、**同一批字体/文本 DataTexture**（`getBootTextures()`）、
 * **同一份布局元数据**（`bootLineMetaUniform()`），把 boot 画面渲染成一张铺满视口的画布。
 *
 * 行为则照 shader.se 原件（`04kr7kd5riobb.js` 的 `pT` / `pR` / 合成着色器）反编译：
 *  - **boot 屏是"切掉"而不是"渐隐"**：原件合成链只在 `isReadyToRender == 0` 时用
 *    loading 屏覆盖画面，而初始页类型映射 `{main: 0}` 不命中第二条覆盖分支 ——
 *    所以资产一就绪，boot 立刻消失。此刻相机正停在屏幕特写位（见 HeroOneToOne 的相机段），
 *    **boot 面板与显示器重合**，随后 500ms 静置 + 弹簧才把镜头拉远。
 *    对应到本项目 bootStore：`loading`/`warmup` 阶段 = 还没就绪（boot 可见），
 *    从 `countdown` 起 boot 已消失。
 *  - boot 面板几何（原件 `pR`）：宽屏（drawingBuffer 宽 > 1024）做 k=0.2 桶形畸变
 *    （`pw`）、圆角矩形遮罩（`pQ`，半径 0.06，圆角外为黑）、四边 ±0.002 渐隐、
 *    径向渐隐（`pS`，`smoothstep(-0.4, 0.4, 0.6 - |uv-0.5|)`）。
 *    这三项让 boot 面板的轮廓与显示器屏幕轮廓对齐，也是"重合"观感的来源。
 *  - 进度值：原件 `hasLoadedContent ? 50 + warmup/2 : progress/2` 再阻尼单调 ——
 *    与项目 bootStore 的 displayProgress 一致，直接复用。
 *
 * 注意事项：
 *  - 本模块只依赖 `three`（WebGL 构建），与 hero 的 `three/webgpu` 互不影响
 *  - 资产登记/重置由调用方负责（hero 挂载时 clearBootAssets + resetBoot）
 *  - 预热进度由 hero 主循环上报（见 HeroOneToOne.tsx）
 *  - 每帧调用 `tickBoot` 推进状态机，因此调用方**不要**再重复 tickBoot
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
 * 说明：内容主体是项目原有的 `bootContent`（原样复用，不改一个字符）；
 * 外面套的是原件 `pR` 的几何处理（桶形畸变 + 圆角遮罩 + 边缘/径向渐隐）。
 * 与项目 `BootPassShader` 的差别只有一处：不再与 tDiffuse 做 mix（那需要一张场景纹理），
 * 只输出 boot 内容本身；"盖在场景上"由整张画布承担。
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

  /**
   * 桶形畸变（原件 pw，k2 = 0 分支）
   *
   * 功能：按到中心的距离径向放大 UV，得到 CRT 玻璃式的桶形外凸
   *
   * 参数：
   *  - uv {vec2} 原始 uv
   *  - k  {float} 畸变强度（原件宽屏取 0.2）
   *
   * 返回值：vec2 畸变后的 uv
   *
   * 异常：无
   *
   * 注意事项：原件 pw 还有带 k2 的分支（用于邻页的镜头畸变），boot 屏只用 k2=0 这一支
   */
  vec2 bootBarrel(vec2 uv, float k) {
    vec2 i = uv - 0.5;
    float r2 = dot(i, i);
    return i * (1.0 + r2 * k) + 0.5;
  }

  /**
   * 圆角矩形 SDF（原件 pQ）
   *
   * 功能：求点到圆角矩形的有符号距离，供遮罩裁出圆角
   *
   * 参数：
   *  - p {vec2} 归一化后的查询点（相对矩形中心）
   *  - b {vec2} 矩形半尺寸
   *  - r {float} 圆角半径
   *
   * 返回值：float 有符号距离（< 0 表示在矩形内部）
   *
   * 异常：无
   *
   * 注意事项：原件里 b 取屏幕半尺寸、r 取 0.06，所以整屏都在矩形内，
   *          只有四个角被圆角切掉 —— 这正是 boot 面板与显示器圆角对齐的由来
   */
  float bootRoundBox(vec2 p, vec2 b, float r) {
    vec2 i = abs(p) - b + r;
    vec2 n = max(i, vec2(0.0));
    return length(n) + min(max(i.x, i.y), 0.0) - r;
  }

  void main() {
    // === 原件 pR 的几何处理（顺序与系数照抄） ===
    // ① 仅宽屏做 k=0.2 桶形畸变（窄屏不畸变），坐标畸变后所有后续采样都用畸变坐标
    vec2 s = vUv;
    if (uResolution.x > 1024.0) s = bootBarrel(s, 0.2);

    // ② 四边 ±0.002 渐隐 + 圆角矩形遮罩（圆角半径 0.06，按宽高比归一）
    const float A = 0.002;
    float edge = smoothstep(-A, A, s.x) * smoothstep(-A, A, s.y)
               * smoothstep(-A, A, 1.0 - s.x) * smoothstep(-A, A, 1.0 - s.y);
    float aspect = uResolution.x / uResolution.y;
    float sd = bootRoundBox((s - 0.5) * vec2(aspect, 1.0), vec2(aspect, 1.0) * 0.5, 0.06);
    float mask = (1.0 - smoothstep(-A, A, sd)) * edge;

    // ③ 径向渐隐（原件 pS：smoothstep(-0.4, 0.4, 0.6 - |uv-0.5|)）—— 边缘压暗
    float falloff = smoothstep(-0.4, 0.4, 0.6 - length(s - 0.5));

    vec3 boot = bootContent(s, uResolution, uProgress);
    gl_FragColor = vec4(boot * mask * falloff, 1.0);
  }
`;

/** boot 屏渲染器 dpr 上限（与原项目 `dpr: [1, 1.5]` 一致） */
const BOOT_MAX_DPR = 1.5;

/**
 * 创建 hero 页的 boot 屏覆盖层
 *
 * 功能：在给定宿主元素内注入一张铺满视口的画布，用项目原有的 boot GLSL +
 *      字体纹理每帧绘制 boot 画面；资产一就绪（bootStore 进入 countdown）**立即撤下**，
 *      弹簧收敛后停掉 rAF。
 *
 * 参数：
 *  - host {HTMLElement} 挂载宿主（hero 的铺满视口容器）
 *
 * 返回值：{ canvas, finish, dispose }
 *  - canvas {HTMLCanvasElement} 注入的画布
 *  - finish {() => void}  强制结束 boot 屏（异常兜底）
 *  - dispose {() => void} 释放渲染器/材质/几何、摘事件并把画布移出 DOM
 *
 * 异常：无（WebGL 上下文创建失败时静默返回一张空画布，不阻塞 hero 主流程）
 *
 * 注意事项：
 *  - 画布 pointer-events 为 none，不拦截 hero 的滚轮/鼠标事件
 *  - 每帧调用 tickBoot 推进 bootStore，调用方不要重复调用
 */
export function createHeroBootPass(host: HTMLElement) {
  const canvas = document.createElement('canvas');
  // 只绘制、不直接显示：这块画布的画面改由合成链承载（原件那块 BIOS 蓝屏本身就是 3D 管线渲染
  // 出来的纹理，进合成链一起过热降级/泛光/暗角）。画布藏在 WebGPU 画布之下（renderer.domElement
  // 是后插入的兄弟节点，同 z-index 下 DOM 顺序决定绘制次序），避免同一块蓝屏被叠加两次。
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  host.appendChild(canvas);

  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);

  let renderer: THREE.WebGLRenderer | null = null;
  try {
    // preserveDrawingBuffer：这张画布除了当覆盖层，还要作为贴图喂给 WebGPU 侧的显示器屏幕
    // （原件就是把 loading 屏的 FBO 纹理喂给屏幕材质，见 HeroOneToOne 的 makeScreenContentNode）。
    // 不开这个开关时画布位图会在合成后被丢弃，另一侧就只能读到空白 —— 所以必须保留。
    // 代价是 boot 期间每帧多一次整屏拷贝，boot 只持续一两秒，可以接受。
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
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
    // 整屏四边形独占输出（显隐由画布 display 控制，原件是硬切不是混合）
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
  /** 画布当前是否可见（原件是硬切，只需记录上一次的显隐） */
  let shown = true;

  /** 每帧：推进 bootStore → 写 uniforms → 按"是否已就绪"决定硬切 */
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

    // 是否继续绘制：boot 编排走完（phase = done）即停绘。
    // 注意这里**不再按「就绪」切显示** —— 画布本身不显示（见文件头 z-index 说明），
    // 它的画面由 heroCompose 的 loading 屏覆盖分支承载；原件也是「资产一就绪硬切」，
    // 合成链侧的硬切由 HeroOneToOne 的 loadingActive 门给出（phase 进入 countdown 即关）。
    const alive = bootStore.phase !== 'done';
    if (alive) {
      if (!shown) { canvas.style.display = 'block'; shown = true; }
      if (renderer) renderer.render(scene, camera);
    } else if (shown) {
      canvas.style.display = 'none';
      shown = false;
    }

    // 弹簧收敛（phase = done）后停掉循环：此后既不渲染也不再推进状态机
    if (bootStore.phase !== 'done') raf = requestAnimationFrame(tick);
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

  return {
    canvas,
    /** boot 覆盖层当前是否可见（调用方据此决定要不要刷新共享贴图） */
    isVisible: () => shown,
    finish,
    dispose,
  };
}
