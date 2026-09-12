import { useRef, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { ComputerScene } from './components/ComputerScene';
import { LoadingScreen } from './components/LoadingScreen';
import { NavBar } from './components/NavBar';
import { PostProcessing, type PostFXParams } from './components/PostProcessing';

/**
 * === 镜头推进惯性系统参数（速度门控 + 自动回退）===
 *
 * 交互模型：
 *  - 滚轮瞬时速度 >= SCROLL_V_ON（刻意快速甩滚）→ 按 SCROLL_GAIN_FAST 充能，
 *    持续快速滚动才能把能量推到顶"越过屏幕"（进入 #film）
 *  - 低于 SCROLL_V_ON（慢滚）→ 按 SCROLL_GAIN_SLOW 微推（有阻力感），
 *    且被泄能抵消，推不动
 *  - 滚轮速度不足/停止后，能量以 SCROLL_LEAK/s 泄放 →
 *    镜头自动平滑回退到初始位置（不回弹到一半，一直退回原点）
 */
const SCROLL_V_ON = 2.0;         // 快速滚动速度阈值（px/ms），需刻意快速甩滚才能超过
const SCROLL_GAIN_FAST = 0.0008; // 快速滚每像素充能（一格约 100px → +0.08）
const SCROLL_GAIN_SLOW = 0.0005; // 慢速滚每像素充能（一格 +0.05，随后被泄能回弹）
const SCROLL_LEAK = 0.40;        // 每秒泄能率（速度不足后约 2.5s 从顶平滑退回原位）
const SCROLL_SMOOTH = 12;        // 显示进度追能量的时间常数（lambda/s，约 80ms 收敛）

/**
 * wheel 事件位移归一化（像素）
 *
 * 功能：不同浏览器 wheel 事件 deltaY 单位不同：
 *  - Chromium：deltaMode=0，deltaY 已是像素
 *  - Firefox：deltaMode=1，deltaY 单位是"行"（一行约 33px）
 *  - 少数设备：deltaMode=2，deltaY 单位是"页"（一页 = 视口高度）
 *  统一折算成像素，保证推进手感跨浏览器一致
 *
 * 参数：
 *  - e {WheelEvent} wheel 事件对象
 *
 * 返回值：{number} 归一化后的像素位移（向下为正）
 */
function normalizeWheelDelta(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * 33;
  if (e.deltaMode === 2) return e.deltaY * window.innerHeight;
  return e.deltaY;
}

/**
 * 把字符串拆成逐字 span（用于逐字浮现 + 滚动飞出动画）
 *
 * 功能：将传入的字符串按字符拆分，每个字符包进一个 <span class="hero-char">，
 *      并根据字符索引递增设置 transitionDelay，实现"一个一个字蹦出来"的效果。
 *      空格会渲染为不可折叠的空白 span，避免被 HTML 合并。
 *      同时根据当前滚动进度 scrollProgress 与该字符的飞出阈值 exitThreshold，
 *      计算该字符是否应飞出消失，并设置对应的 transform/opacity inline style。
 *
 * 参数：
 *  - text           {string}  要拆分的字符串
 *  - baseDelay      {number}  该字符串起始延迟（ms），用于跨行衔接
 *  - step           {number}  每个字符之间的延迟间隔（ms）
 *  - exitThreshold  {number}  该字符的飞出阈值（0~1）：当 scrollProgress 超过此值时飞出
 *  - exitStep       {number}  字符之间的飞出阈值步长（让字符逐个飞出而非同时）
 *  - scrollProgress {number}  当前滚动进度（0~1）
 *  - flyDirection   {number}  飞出方向（-1=向左，1=向右），默认 -1（向左飞出）
 *
 * 返回值：ReactNode[] 每个字符对应的 span 节点数组
 *
 * 异常：无
 *
 * 注意事项：
 *  - 空格用 \u00A0（不间断空格）替换，防止行内空白被折叠
 *  - 飞出动画通过 inline style 直接控制 transform/opacity，不依赖 CSS 变量
 *    transition 让飞出过程有平滑过渡感（300ms ease-out）
 */
function splitTextToChars(
  text: string,
  baseDelay: number,
  step: number,
  exitThreshold: number,
  exitStep: number,
  scrollProgress: number,
  flyDirection: number = -1
): ReactNode[] {
  // 飞出动画的过渡区间长度：超过阈值后用 0.05 的进度完成整个飞出
  // 让字符在 scrollProgress 越过 exitThreshold 后的 0.05 范围内完成飞出
  const EXIT_DURATION = 0.05;
  return Array.from(text).map((ch, i) => {
    // 当前字符的飞出阈值：字符 i 在 exitThreshold + i * exitStep 处开始飞出
    const threshold = exitThreshold + i * exitStep;
    // 飞出进度：0=未飞出（静止显示），1=已完全飞出（消失）
    // 当 scrollProgress < threshold 时 exitRaw < 0 → clamp 到 0
    // 当 scrollProgress > threshold + EXIT_DURATION 时 exitRaw > 1 → clamp 到 1
    const exitRaw = (scrollProgress - threshold) / EXIT_DURATION;
    const exitProgress = Math.max(0, Math.min(1, exitRaw));
    // 飞出 transform：向左/右平移 60px，并稍微下沉和旋转，营造"被甩出去"感
    const flyX = flyDirection * 60 * exitProgress;
    const flyY = 20 * exitProgress;
    const rotate = flyDirection * 8 * exitProgress;
    // opacity 从 1 衰减到 0
    const opacity = 1 - exitProgress;
    return (
      <span
        key={`${text}-${i}`}
        className="hero-char"
        style={{
          transitionDelay: `${baseDelay + i * step}ms`,
          // 飞出动画的 transform/opacity（仅当 exitProgress>0 时生效）
          transform: exitProgress > 0
            ? `translate(${flyX}px, ${flyY}px) rotate(${rotate}deg)`
            : undefined,
          opacity: exitProgress > 0 ? opacity : undefined,
          // transition 让 transform/opacity 变化时平滑过渡
          transitionProperty: 'transform, opacity',
          transitionDuration: '300ms',
          transitionTimingFunction: 'ease-out',
          // display:inline-block 让 transform 生效（inline 元素 transform 不起作用）
          display: 'inline-block',
        }}
      >
        {ch === ' ' ? '\u00A0' : ch}
      </span>
    );
  });
}

/**
 * 顶层应用组件
 *
 * 功能：搭建 shader.se 风格的三层架构
 *   1. z-50 滚动容器（捕获滚动，含虚拟高度占位）
 *   2. z-40 WebGL Canvas（渲染 3D 内容，不接收交互）
 *   3. z-45 内容覆盖层（文字 UI）
 *
 * 参数：无
 * 返回值：React.ReactElement
 * 异常：无
 *
 * 注意事项：
 *  - 滚动进度通过 ref + state 双通道传递给 Canvas 内的 3D 场景
 *  - Canvas 的 pointer-events 设为 none，交互由滚动容器接收
 */
export default function App() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // 惯性推进系统状态（速度门控 + 自动回退）：
  // - v       滚轮瞬时速度 EMA（px/ms），超过 SCROLL_V_ON 视为"快速滚"
  // - energy  累积能量 0~1.08，快速滚充能、慢/停时泄能（"不够快就退回原地"）
  // - display 显示进度（energy 的平滑值），驱动 3D 镜头推进与跨页切换判断
  const scrollStateRef = useRef({ v: 0, energy: 0, display: 0, lastTs: 0, lastFrame: 0, raf: 0, running: false });
  // 滚动进度 0~1，用于驱动 3D 场景
  const [scrollProgress, setScrollProgress] = useState(0);
  // 模型加载状态
  const [loaded, setLoaded] = useState(false);
  // 加载完成回调：用 useCallback 稳定引用，避免 inline 箭头函数每次重渲染都变 →
  // 触发 ComputerScene 的 useEffect 重新执行 → 重置 introProgressRef → 入场动画重播
  // 空依赖数组：setLoaded 是稳定引用，函数永远不变
  const handleLoaded = useCallback(() => setLoaded(true), []);
  // 首屏标题是否已显现
  const [titleVisible, setTitleVisible] = useState(false);
  // 鼠标视差偏移量（写入 CSS 变量，供 hero-block 使用）
  const heroBlockRef = useRef<HTMLDivElement>(null);
  // 共享鼠标归一化坐标（-1~1），供 3D 相机视差旋转使用
  // 用 ref 避免高频 setState 引起重渲染，ComputerScene 在 useFrame 里直接读取
  const mouseRef = useRef({ x: 0, y: 0 });

  // 后处理参数（色散 + 鱼眼 + 暗角 + Bloom 辉光）
  // useMemo 避免每次渲染都创建新对象，否则 PostProcessing 的 useEffect 会频繁触发
  // 参数取值参考 shader.se：色散 1.0（中等），falloff 2.0（中心干净、边缘陡然加重）
  // 鱼眼 0.35（明显但不夸张），暗角 0.35
  // Bloom：threshold 0.85 只让屏幕 emissive（亮度>1）参与辉光，避免整张图都发糊；
  //        strength 1.4 让彩色光晕明显扩散到屏幕外（呼应 shader.se 的"屏幕反射出彩色光"效果）；
  //        radius 0.6 让光晕柔和弥散而非硬边
  const postFXParams = useMemo<PostFXParams>(
    () => ({
      chromaticAberration: 1.0,
      chromaticFalloff: 2,
      lensDistortion: 0.35,
      lensDistortionBorder: 0.0,
      vignetteIntensity: 0.35,
      vignetteRadius: 0.5,
      bloomStrength: 0.3,
      bloomRadius: 0.2,
      bloomThreshold: 0.7,
    }),
    []
  );

  /**
   * 惯性推进驱动帧循环（速度门控 + 自动回退）
   *
   * 功能：每个动画帧推进惯性系统状态：
   *       1. 滚轮速度自身指数衰减（停止滚动后约 250ms 内跌下快速阈值）
   *       2. 速度低于阈值 → 能量持续泄放（"滚速不足以越过屏幕时，
   *          镜头自动平滑回退到初始位置"）
   *       3. 显示进度向能量平滑趋近（镜头运动丝滑，无跳变）
   *       4. 能量与显示进度收敛且速度归零 → 停止动画帧（省资源）
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - dt 上限 0.05s，避免后台标签页切回时大步长跳变
   */
  const tickScroll = useCallback(() => {
    const st = scrollStateRef.current;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(now - st.lastFrame, 0.001));
    st.lastFrame = now;

    // 滚轮速度衰减：停止滚动后很快跌下快速阈值，转入泄能
    st.v *= Math.exp(-dt * 9);

    // 泄能回退：速度不足时能量持续泄放 → 镜头平滑退回初始位置
    if (st.v < SCROLL_V_ON) {
      st.energy = Math.max(0, st.energy - SCROLL_LEAK * dt);
    }

    // 显示进度平滑趋近能量（lambda=SCROLL_SMOOTH，约 80ms 收敛）
    st.display += (st.energy - st.display) * (1 - Math.exp(-dt * SCROLL_SMOOTH));
    if (Math.abs(st.energy - st.display) < 0.0004) st.display = st.energy;
    setScrollProgress(Math.min(1, st.display));

    // 收敛静止 → 停帧（滚轮注入时会重新唤醒）
    if (Math.abs(st.energy - st.display) < 0.0004 && st.v < 0.01) {
      st.running = false;
      return;
    }
    st.raf = requestAnimationFrame(tickScroll);
  }, []);

  /**
   * 唤醒惯性驱动循环（幂等）
   *
   * 功能：惯性系统默认不跑动画帧，注入滚轮/触摸位移时调用本函数启动，
   *      直到能量泄空且显示进度收敛才自行停止，避免空转浪费
   *
   * 参数：无
   * 返回值：无
   */
  const ensureScrollLoop = useCallback(() => {
    const st = scrollStateRef.current;
    if (!st.running) {
      st.running = true;
      st.lastFrame = performance.now();
      st.raf = requestAnimationFrame(tickScroll);
    }
  }, [tickScroll]);

  /**
   * 滚轮/触摸位移注入惯性系统
   *
   * 功能：把一次滚轮/触摸滑动位移（dy，与 wheel deltaY 同向：向下为正）
   *       按速度门控规则注入惯性系统：
   *       - 瞬时速度 >= 快速阈值 → 大增益充能（镜头快速推进，
   *         "滚得够快才能越过屏幕"）
   *       - 低于阈值 → 极小增益微推（有阻力的慢推，且被泄能抵消）
   *
   * 参数：
   *  - dy  {number} 本次位移（像素，向下为正，与 wheel.deltaY 一致）
   *  - now {number} performance.now() 时间戳
   *
   * 返回值：无
   *
   * 注意事项：
   *  - 瞬时速度用 EMA 平滑（0.55/0.45），消除单次事件抖动
   *  - dt 下限 8ms 并夹紧，避免连续事件间隔过短导致速度爆炸
   *  - energy 上限 1.08，给"冲过头"留余量再回弹，手感更自然
   */
  const injectScroll = useCallback((dy: number, now: number) => {
    const st = scrollStateRef.current;
    const dt = Math.max(now - st.lastTs, 8);
    st.lastTs = now;
    const inst = Math.abs(dy) / dt;          // 瞬时速度 px/ms
    st.v = st.v * 0.55 + inst * 0.45;        // EMA 平滑

    // 速度门控增益：快滚充能，慢滚有阻力
    const gain = st.v >= SCROLL_V_ON ? SCROLL_GAIN_FAST : SCROLL_GAIN_SLOW;
    st.energy = Math.max(0, Math.min(1.08, st.energy + dy * gain));
    ensureScrollLoop();
  }, [ensureScrollLoop]);

  // 滚动输入监听：把 wheel/touch 位移注入惯性系统（速度门控 + 自动回退）
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      injectScroll(normalizeWheelDelta(e), performance.now());
    };

    // 触摸：垂直滑动按位移与速度注入（与滚轮同语义）；水平滑动不拦截
    let tLastX = 0, tLastY = 0;
    const onTStart = (e: TouchEvent) => {
      const t = e.touches[0];
      tLastX = t.clientX; tLastY = t.clientY;
    };
    const onTMove = (e: TouchEvent) => {
      const t = e.touches[0];
      const dy = tLastY - t.clientY;          // 上滑为正（与 wheel deltaY 同向）
      const dx = t.clientX - tLastX;
      if (Math.abs(dy) > Math.abs(dx)) {
        e.preventDefault();
        injectScroll(dy, performance.now());
      }
      tLastX = t.clientX; tLastY = t.clientY;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTStart, { passive: true });
    el.addEventListener('touchmove', onTMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTStart);
      el.removeEventListener('touchmove', onTMove);
    };
  }, [injectScroll]);

  // 组件卸载时停止惯性动画帧，避免 rAF 泄漏
  useEffect(() => () => {
    const st = scrollStateRef.current;
    st.running = false;
    cancelAnimationFrame(st.raf);
  }, []);

  // === 跨 demo 切换：滚动到末尾相机穿过屏幕时，白色闪光掩盖切换到 #film ===
  // flashVisible 控制全屏白色 overlay 渐显
  const [flashVisible, setFlashVisible] = useState(false);
  // 防止重复触发切换
  const switchingRef = useRef(false);

  useEffect(() => {
    // progress >= 0.88（相机已穿过屏幕到背面，画面是黑色背板）→ 白色闪光渐强
    if (scrollProgress >= 0.88 && !flashVisible) {
      setFlashVisible(true);
    }
    // progress < 0.82（能量泄放回退）→ 取消闪光
    if (scrollProgress < 0.82 && flashVisible) {
      setFlashVisible(false);
    }
    // progress >= 0.97 且闪光已接近峰值（给 0.4s transition 时间达到峰值）→ 切换 hash
    if (scrollProgress >= 0.97 && !switchingRef.current) {
      switchingRef.current = true;
      // 延迟 450ms 让 flash transition（0.5s）达到接近峰值再切换；
      // 期间若用户松手导致能量泄放、镜头回退 → 取消本次切换，允许再次冲击
      setTimeout(() => {
        if (scrollStateRef.current.display >= 0.90) {
          window.location.hash = '#film';
        } else {
          switchingRef.current = false;
        }
      }, 450);
    }
  }, [scrollProgress, flashVisible]);

  // 加载完成后短暂延迟再显示标题，制造入场动画
  useEffect(() => {
    if (loaded) {
      const t = setTimeout(() => setTitleVisible(true), 200);
      return () => clearTimeout(t);
    }
  }, [loaded]);

  /**
   * 鼠标视差处理
   * 功能：监听鼠标移动，同时驱动两层视差：
   *   1. 文字层：写入 hero-block 的 CSS 变量 --px/--py（位移 6px）+ --rx/--ry（旋转 ±6°）
   *   2. 3D 相机层：写入 mouseRef.current.x/y（归一化 -1~1），让相机绕 target 微旋转
   * 参数：无
   * 返回值：无
   * 注意事项：
   *  - 使用 rAF 节流，避免高频 mousemove 引起重渲染
   *  - 文字位移幅度 6px + 旋转 ±6°，3D 相机视差幅度由 ComputerScene 控制
   *  - perspective 在父级 .content-overlay 上，子元素 .hero-block 的 rotate 才有立体感
   *  - mouseRef 用 ref 不触发重渲染，ComputerScene 在 useFrame 里直接读取
   */
  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 归一化到 [-1, 1]，鼠标在屏幕中心时偏移为 0
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        // 1. 文字层视差：写入 CSS 变量 --px/--py（位移）+ --rx/--ry（旋转）
        //    位移幅度 6px，旋转幅度 ±6°（配合父级 perspective 1000px 营造立体感）
        const el = heroBlockRef.current;
        if (el) {
          el.style.setProperty('--px', `${nx * 6}px`);
          el.style.setProperty('--py', `${ny * 6}px`);
          // 旋转：鼠标向右 → 文字微微右倾（rotateY），鼠标向下 → 微微低头（rotateX）
          el.style.setProperty('--rx', `${ny * 6}deg`);
          el.style.setProperty('--ry', `${nx * 6}deg`);
        }
        // 2. 3D 相机视差：写入共享 ref，ComputerScene 的 useFrame 读取后做 yaw/pitch 偏移
        mouseRef.current.x = nx;
        mouseRef.current.y = ny;
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      {/* 加载屏 */}
      <LoadingScreen hidden={loaded} />

      {/* 跨 demo 切换闪光层：滚动到末尾时白色渐强，掩盖相机穿过屏幕的切换 */}
      <div className={`demo-flash ${flashVisible ? 'visible' : ''}`} />

      {/* 顶部导航 */}
      <NavBar />

      {/* 第 1 层：输入捕获容器 z-50（无原生滚动，wheel/touch 由惯性推进系统处理） */}
      <div
        ref={scrollContainerRef}
        className="scroll-container"
      />

      {/* 第 2 层：WebGL Canvas z-40 */}
      <div className="canvas-wrapper">
        <Canvas
          gl={{
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance',
          }}
          camera={{ fov: 35, near: 0.1, far: 1000, position: [0, 0, 8] }}
          onCreated={({ gl }) => {
            // 设置透明背景，让 body 的 #0a0a0a 显出来
            gl.setClearColor(new THREE.Color('#0a0a0a'), 1);
          }}
        >
          <ComputerScene
            scrollProgress={scrollProgress}
            onLoaded={handleLoaded}
            mouseRef={mouseRef}
          />
          <PostProcessing params={postFXParams} />
        </Canvas>
      </div>

      {/* 第 3 层：内容覆盖层 z-45
          滚动时左侧文字逐个飞出消失：
          每个字符按行内顺序在 scrollProgress 越过它的 exitThreshold 时飞出
          字符之间 exitThreshold 步长 0.005，让它们一个接一个飞出而非同时 */}
      <div className="content-overlay">
        <div className="hero-block" ref={heroBlockRef}>
          <h1 className={`hero-title ${titleVisible ? 'visible' : ''}`}>
            <span className="hero-line">
              {splitTextToChars('A Creative', 0, 30, 0.0, 0.02, scrollProgress, -1)}
            </span>
            <span className="hero-line">
              {splitTextToChars('Developer,Plugged', 350, 30, 0.25, 0.02, scrollProgress, -1)}
            </span>
            <span className="hero-line">
              {splitTextToChars('into the Future', 950, 30, 0.55, 0.02, scrollProgress, -1)}
            </span>
          </h1>
        </div>
        <div className="scroll-hint">Scroll to Explore</div>
      </div>
    </>
  );
}
