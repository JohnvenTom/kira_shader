import { useRef, useState, useEffect, useCallback } from 'react';
import { TRACE_ANIM_CSS } from './traceAnimCss';

/**
 * === trace 动画时间轴常量（与 trace-animated.html 的 CSS 完全对应）===
 *
 * 总时长 14650ms：
 *  - 草稿描绘 0~3060ms：45 组 skb 逐笔 draw（0.7s，递延 0.2s + i*0.05s）
 *  - 墨线过渡 2800~4400ms：草稿容器淡出（2.8s 起）→ 底稿浮现（sketch-in 2.8s）→ 上墨（ink 3.6s）
 *  - 成品揭示 4100~13350ms：30 组 pg 分段 clip-path 揭示（0.55s，递延 4.1s + i*0.3s）
 *  - 收笔定格 13350~14650ms：整体 settle 色彩沉降 + 进度条满格
 */
const T_TOTAL = 14650;
const T_SKETCH_END = 3060;
const T_FADE_START = 2800;
const T_FADE_END = 4400;
const T_REVEAL_END = 13350;

/**
 * 阶段指示器数据（滚动映射到动画时间后按区间高亮）
 */
const PHASES = [
  { key: 'SKETCH', zh: '草稿描绘', en: 'stroke-dashoffset 逐笔描写', start: 0, end: T_SKETCH_END },
  { key: 'FADE', zh: '墨线过渡', en: '草稿淡出 · 底稿浮现 · 上墨', start: T_FADE_START, end: T_FADE_END },
  { key: 'REVEAL', zh: '成品揭示', en: 'clip-path 分段登场', start: 4100, end: T_REVEAL_END },
  { key: 'SETTLE', zh: '收笔定格', en: '整体色彩沉降', start: T_REVEAL_END, end: T_TOTAL },
];

/**
 * 返回收藏集（白闪过渡）
 *
 * 功能：点亮全屏白闪层，400ms 后写 sessionStorage 恢复标记并切回 #film。
 * 恢复标记让 KiraFilmDemo mount 时直接回到 SELECTED WORK 详情页。
 *
 * 参数：无
 * 返回值：void
 */
function goBackToCollection(flashRef: React.RefObject<HTMLDivElement | null>) {
  if (flashRef.current) flashRef.current.classList.add('visible');
  setTimeout(() => {
    try {
      sessionStorage.setItem(
        'kira-return',
        JSON.stringify({ section: 1, detail: true })
      );
    } catch {
      /* sessionStorage 不可用时静默降级（仍能跳回 #film） */
    }
    window.location.hash = '#film';
  }, 400);
}

/**
 * TraceDetailPage - trace 作品滚动叙事展示页（#trace 独立路由）
 *
 * 功能：三幕滚动叙事：
 *   1. 首屏：作品名 + 提示
 *   2. 主播放区（sticky 定格）：滚动进度 0~1 映射到 14.65s 动画时间轴，
 *      WAAPI 统一接管全部 CSSAnimation 的 currentTime，实现滚动=画笔、可回退倒放；
 *      侧边阶段指示器随进度点亮四个阶段
 *   3. 原理拆解区：三个技法小节各带独立随滚 demo（描边 / 分层时间轴 / clip-path 揭示）
 *   4. 代码对照区：核心 CSS 摘录 + 注释
 *   5. 结尾：返回按钮白闪回 #film
 *
 * 参数：无
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 本页需要原生滚动：mount 时给 body 加 trace-page class 打开滚动并锁定全站惯性系统，
 *    卸载时移除
 *  - SVG 主体 4.9MB 从 /asset/trace/trace-body.svg fetch 注入（不进 JS bundle）
 *  - 动画 CSS 以 <style> 注入并追加 .trace-frame 放大覆盖规则
 *  - CSSAnimation.currentTime 包含 animation-delay 语义，直接按 t 赋值即可
 */
export default function TraceDetailPage() {
  // 白闪返回层 ref
  const flashRef = useRef<HTMLDivElement>(null);
  // 定格区滚动容器（外层长 section）ref：真正占据滚动路程的元素
  const actRef = useRef<HTMLElement>(null);
  // SVG 内容注入容器
  const frameRef = useRef<HTMLDivElement>(null);
  // 进度百分比文本
  const pctRef = useRef<HTMLSpanElement>(null);
  // 主播放区定格容器 ref（滚动进度驱动其内部画布）
  const pinInnerRef = useRef<HTMLDivElement>(null);

  // 已注入的 CSSAnimation 列表（滚动时逐帧统一设置 currentTime）
  const animsRef = useRef<CSSAnimation[]>([]);
  // 阻尼系统状态：p=显示进度（阻尼后），v=跟踪速度，target=滚动位置目标进度
  const dampRef = useRef({ p: 0, v: 0, target: 0, raf: 0, running: false, lastFrame: 0 });
  // SVG 文本状态（fetch 完成后触发注入）
  const [svgText, setSvgText] = useState<string | null>(null);
  // 当前激活阶段索引（驱动指示器高亮）
  const [phaseIdx, setPhaseIdx] = useState(0);
  const phaseIdxRef = useRef(0);

  /**
   * 入口衔接：从收藏柜四角放大转场（末段白闪）切过来时，
   * 页面先全白再淡出，与转场白闪无缝衔接，避免白→黑的生硬硬切
   */
  useEffect(() => {
    const el = flashRef.current;
    if (!el) return;
    el.classList.add('visible');
    const t = setTimeout(() => el.classList.remove('visible'), 90);
    return () => {
      clearTimeout(t);
      el.classList.remove('visible');
    };
  }, []);

  /**
   * body/html 滚动开关：trace 页需要原生滚动
   *
   * 挂到 html 上：统一滚动容器到视口（根），避免 body overflow:auto
   * 创建中间滚动上下文破坏 position:sticky 定格效果
   */
  useEffect(() => {
    document.documentElement.classList.add('trace-page');
    document.body.classList.add('trace-page');
    return () => {
      document.documentElement.classList.remove('trace-page');
      document.body.classList.remove('trace-page');
    };
  }, []);

  /**
   * 加载 SVG 主体（4.9MB，独立资源不进 bundle）
   *
   * 注意：不用 alive 门旗——StrictMode 下首次 fetch 的 cleanup 会把
   * 首次请求标记为丢弃，若仍用 alive 判断会导致第二次请求的结果
   * 也无人接收；React 18 对卸载组件 setState 是无害 no-op，直接设置即可
   */
  useEffect(() => {
    fetch('/asset/trace/trace-body.svg')
      .then(r => r.text())
      .then(t => setSvgText(t))
      .catch(err => console.error('[trace] svg load failed', err));
  }, []);

  /**
   * === 滚动阻尼系统（缓入缓出速度线）===
   *
   * 交互模型：滚动位置只更新"目标进度" target，显示进度 p 以
   * 临界阻尼二阶系统（Unity SmoothDamp）追踪 target：
   *  - 滚得快时动画落后半拍再加速追上（缓入，且速度受位移驱动、越大越快）
   *  - 接近目标时自动减速、无过冲地停稳（缓出）
   *  - 停手后约 DAMP_SMOOTH_TIME*2 内收敛静止，随后停帧省资源
   * 这样滚轮不再 1:1 直连动画，一格滚动的视觉位移被阻尼"稀释"，
   * 慢滚可精修、快甩有丝滑滑行感，回滚同样倒放可逆。
   */
const DAMP_SMOOTH_TIME = 0.55; // 秒：阻尼时间常数，越大跟随越钝、滑行感越明显

/**
 * 把阻尼后的显示进度分发到动画时间轴 + 阶段指示器
 *
 * 功能：
 *  1. t = p * 14650ms 分发到全部 CSSAnimation.currentTime（含 delay 语义）
 *  2. 同步阶段指示器高亮（state 驱动）与百分比文本（DOM 直改）
 *
 * 参数：
 *  - p {number} 0~1 的显示进度（已阻尼）
 * 返回值：void
 */
const distribute = useCallback((p: number) => {
  const t = p * T_TOTAL;
  for (const a of animsRef.current) a.currentTime = t;

  const idx = PHASES.findIndex(ph => t >= ph.start && t < ph.end);
  const resolved = idx === -1 ? (t >= T_TOTAL ? PHASES.length - 1 : 0) : idx;
  if (phaseIdxRef.current !== resolved) {
    phaseIdxRef.current = resolved;
    setPhaseIdx(resolved);
  }
  if (pctRef.current) {
    pctRef.current.textContent = `${Math.round(p * 100)}%`;
  }
}, []);

/**
 * 读取当前滚动位置对应的目标进度（0~1，未阻尼）
 *
 * 功能：定格区顶端触到视口顶 → 0，区段底端对齐视口底 → 1
 * 返回值：number 0~1
 */
const readTarget = useCallback((): number => {
  const act = actRef.current;
  if (!act) return 0;
  const vh = window.innerHeight;
  const max = act.offsetHeight - vh;
  return max > 0 ? Math.max(0, Math.min(1, -act.getBoundingClientRect().top / max)) : 0;
}, []);

/**
 * 阻尼追踪帧循环（缓入缓出速度线）
 *
 * 功能：每帧用 SmoothDamp 推进显示进度向目标收敛并分发；
 * 收敛静止后自行停帧等待下次滚动唤醒。
 *
 * 参数：无
 * 返回值：void
 *
 * 注意事项：
 *  - dt 上限 0.05s，避免后台标签页切回时大步长跳变
 *  - 收敛阈值 0.0003（约 0.03% 进度），静止判定兼顾手感与停帧
 */
const tickDamp = useCallback(() => {
  const st = dampRef.current;
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(now - st.lastFrame, 0.001));
  st.lastFrame = now;

  // SmoothDamp（临界阻尼、无过冲）
  const omega = 2 / DAMP_SMOOTH_TIME;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = st.p - st.target;
  const temp = (st.v + omega * change) * dt;
  st.v = (st.v - omega * temp) * exp;
  st.p = st.target + (change + temp) * exp;
  distribute(st.p);

  if (Math.abs(st.p - st.target) < 0.0003 && Math.abs(st.v) < 0.0003) {
    st.running = false;
    return;
  }
  st.raf = requestAnimationFrame(tickDamp);
}, [distribute]);

/**
 * 唤醒阻尼帧循环（幂等）
 *
 * 功能：阻尼系统默认不跑帧，滚动注入目标后调用本函数启动，
 * 直到显示进度收敛静止自行停止，避免空转浪费。
 */
const ensureDampLoop = useCallback(() => {
  const st = dampRef.current;
  if (!st.running) {
    st.running = true;
    st.lastFrame = performance.now();
    st.raf = requestAnimationFrame(tickDamp);
  }
}, [tickDamp]);

/**
 * 阻尼状态快照复位（进入页面/资源就绪时直接用当前滚动位置定位）
 *
 * 功能：把 p 与 target 同时快照为当前滚动位置，避免从 0 阻尼爬上来的
 * 启动动画，首帧即为正确画面。
 */
const snapDamp = useCallback(() => {
  const st = dampRef.current;
  st.target = readTarget();
  st.p = st.target;
  st.v = 0;
  distribute(st.p);
}, [readTarget, distribute]);

  /**
   * WAAPI 时间轴接管：svg 注入后挂 .trace-playing 启动全部 CSS 动画并统一 pause
   *
   * 防时序竞争设计（曾出现"动画自由播完、永远停在成品帧"的缺陷）：
   *  - CSS 层已内置 animation-play-state:paused，动画自创建起就是静止的，
   *    即使 JS 迟到也不会自动播放
   *  - 这里用 rAF 重试（最多 120 次≈2s）等待动画注册进 document.getAnimations()
   *    （4.9MB SVG 解析可能慢几帧），成功后 pause + 归零并把引用存入 animsRef
   *  - cleanup 用 stopped 标志终止重试链；StrictMode 双跑 effect 时二次执行
   *    幂等重来（动画已注册，一次即成功）
   */
  useEffect(() => {
    if (!svgText) return;
    const rootEl = pinInnerRef.current;
    if (!rootEl) return;

    rootEl.classList.add('trace-playing');

    let stopped = false;
    let attempt = 0;
    const tryCapture = () => {
      if (stopped) return;
      const anims = document
        .getAnimations()
        .filter(
          (a): a is CSSAnimation =>
            a instanceof CSSAnimation &&
            (a.effect as KeyframeEffect | null)?.target instanceof Element &&
            rootEl.contains((a.effect as KeyframeEffect).target as Element)
        );
      if (anims.length > 0) {
        // 统一暂停并归零，等待滚动接管
        anims.forEach(a => {
          a.pause();
          a.currentTime = 0;
        });
        animsRef.current = anims;
        // 初始帧直接快照定位（scrollY 可能不在 0，不做阻尼爬升）
        snapDamp();
        return;
      }
      attempt += 1;
      if (attempt < 120) requestAnimationFrame(tryCapture);
    };
    requestAnimationFrame(tryCapture);
    return () => {
      stopped = true;
    };
  }, [svgText, snapDamp]);

  /**
   * 滚动/缩放监听：更新阻尼目标 + 唤醒阻尼循环 + 广播原理 demo 驱动
   *
   * 功能：滚动位置不直接分发动画，只更新 dampRef.target 并唤醒阻尼
   * 帧循环（SmoothDamp 提供缓入缓出速度线）；同时广播 trace:scroll 供
   * 原理小节 demo 读取各自位置驱动。
   */
  useEffect(() => {
    const onScroll = () => {
      dampRef.current.target = readTarget();
      ensureDampLoop();
      // 原理 demo 驱动广播（demo 自行读取位置，无需 rAF 节流）
      window.dispatchEvent(new CustomEvent('trace:scroll'));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [readTarget, ensureDampLoop]);

  /**
   * 组件卸载：停止阻尼帧循环，避免 rAF 泄漏
   */
  useEffect(() => {
    return () => {
      const st = dampRef.current;
      st.running = false;
      cancelAnimationFrame(st.raf);
    };
  }, []);

  /**
   * SVG 注入后立即快照定位一次（页面可能带着 scrollY 恢复进入）
   */
  useEffect(() => {
    if (svgText) snapDamp();
  }, [svgText, snapDamp]);

  return (
    <div className="trace-root trace-page-root">
      {/* 白闪返回层 */}
      <div ref={flashRef} className="trace-flash" />

      {/* 动画 CSS 注入：原作品 keyframes + 放大覆盖 + 暂停锁定
          - .trace-frame 放大到展示尺寸
          - 最后一条把所有动画锁在 paused：动画自创建即静止，
            进度完全由 JS 的 currentTime 驱动（杜绝"自动播完停在成品"的时序缺陷） */}
      <style>{`${TRACE_ANIM_CSS}\n.trace-frame{width:min(760px,90vw)}\n.trace-stage-inner.trace-playing *{animation-play-state:paused!important}\n`}</style>

      {/* === 第一幕：首屏 === */}
      <section className="trace-act trace-act--hero">
        <div className="trace-hero-inner">
          <span className="trace-kicker">SELECTED WORK · 05</span>
          <h1 className="trace-title">
            TRACE<span className="trace-title-accent"> · </span>ANIMATED
          </h1>
          <p className="trace-subtitle">
            SVG 描边编舞 — 一幅画如何被一笔一笔画出来
          </p>
          <div className="trace-scroll-hint">
            <span className="trace-hint-line" />
            <span>向下滚动 · 滚动即画笔</span>
          </div>
        </div>
      </section>

      {/* === 第二幕：sticky 定格整段播放 === */}
      <section ref={actRef} className="trace-act trace-act--pin">
        <div className="trace-pin">
          <div className="trace-pin-layout">
            {/* 舞台：注入 4.9MB 的 SVG 画布 + 进度条 */}
            <div ref={pinInnerRef} className="trace-stage-inner">
              <div
                ref={frameRef}
                className="trace-frame"
                dangerouslySetInnerHTML={{ __html: svgText ?? '' }}
              />
              <div className="trace-bar">
                <i />
              </div>
              <div className="trace-pin-caption">
                <span ref={pctRef} className="trace-pct">0%</span>
                <span className="trace-pin-caption-zh">
                  滚动进度 ↔ 动画时间轴（14.65s）
                </span>
              </div>
            </div>

            {/* 阶段指示器 */}
            <aside className="trace-phase-panel">
              <div className="trace-phase-title">
                <span>PHASES</span>
                <span className="trace-phase-title-zh">时间轴阶段</span>
              </div>
              {PHASES.map((ph, i) => (
                <div key={ph.key} className={`trace-phase-item ${i === phaseIdx ? 'active' : ''}`}>
                  <span className="trace-phase-dot" />
                  <div className="trace-phase-text">
                    <span className="trace-phase-key">{ph.key}</span>
                    <span className="trace-phase-zh">{ph.zh}</span>
                    <span className="trace-phase-en">{ph.en}</span>
                  </div>
                  <span className="trace-phase-time">
                    {(ph.start / 1000).toFixed(1)}s
                  </span>
                </div>
              ))}
            </aside>
          </div>
        </div>
      </section>

      {/* === 第三幕：原理拆解 === */}
      <section className="trace-act trace-act--explain">
        <header className="trace-explain-header">
          <span className="trace-kicker">HOW IT WORKS</span>
          <h2 className="trace-explain-title">原理拆解</h2>
          <p className="trace-explain-sub">
            三个核心技法独立成节，每一节都随着滚动自行演示
          </p>
        </header>

        <TechDashoffset />
        <TechLayers />
        <TechClipPath />
      </section>

      {/* === 第四幕：代码对照 === */}
      <CodeGallery />

      {/* === 第五幕：结尾返回 === */}
      <section className="trace-act trace-act--end">
        <p className="trace-end-zh">画作已完结</p>
        <button
          type="button"
          className="trace-back-btn"
          onClick={() => goBackToCollection(flashRef)}
        >
          ← RETURN TO COLLECTION
        </button>
        <p className="trace-end-hint">返回收藏集 · 继续探索其他作品</p>
        {/* 右下出血装饰字：呼应技法区段的海报数字语言，占据右区形成非对称终章构图 */}
        <span className="trace-end-fin" aria-hidden>Fin.</span>
      </section>
    </div>
  );
}

/**
 * 计算元素在视口中的"演示进度"（0~1）
 *
 * 功能：元素从视口底部 65% 高度处滚动到顶部时，进度从 0 线性到 1。
 * 用于原理小节 demo 的进入驱动（IntersectionObserver 的替代方案，可回退倒放）。
 *
 * 参数：
 *  - el {HTMLElement} 目标元素
 *  - startFrac {number} 起始参考高度（视口高度的比例），默认 0.65
 *
 * 返回值：number 0~1 的演示进度
 */
function elProgress(el: HTMLElement, startFrac = 0.65): number {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const start = vh * startFrac;
  const p = (start - rect.top) / (start + rect.height);
  return Math.max(0, Math.min(1, p));
}

/**
 * 订阅 trace:scroll 广播，返回回调 ref（滚轮驱动 demo 的通用基座）
 *
 * 功能：组件挂载时监听 window 的 trace:scroll 事件（主滚动监听 rAF 节流后广播），
 * 卸载时自动注销。回调里读取元素位置计算进度并驱动 demo。
 *
 * 参数：
 *  - handler {() => void} 每次滚动广播时执行
 * 返回值：void
 */
function useTraceScroll(handler: () => void): void {
  useEffect(() => {
    handler();
    window.addEventListener('trace:scroll', handler);
    return () => window.removeEventListener('trace:scroll', handler);
  }, [handler]);
}

/**
 * 技法①小节 — stroke-dashoffset 描边
 *
 * 功能：演示 SVG 线条描画原理：pathLength 归一化后 dasharray=1，
 * dashoffset 从 1 → 0 即"沿线描出"。左侧为随滚动的实况 demo，
 * 右侧为中文原理 + 核心代码。
 *
 * 参数：无
 * 返回值：React.ReactElement
 */
function TechDashoffset() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  /**
   * 滚动驱动描边：把演示进度映射为 strokeDashoffset（1→0）
   */
  const drive = useCallback(() => {
    const sec = sectionRef.current;
    const path = pathRef.current;
    if (!sec || !path) return;
    const p = elProgress(sec, 0.7);
    path.style.strokeDashoffset = String(1 - p);
  }, []);

  useTraceScroll(drive);

  return (
    <div ref={sectionRef} className="trace-tech">
      {/* 出血海报数字（非对称编辑风的标志元素，部分溢出区段） */}
      <span className="trace-bleed-num" aria-hidden>01</span>
      <div className="trace-tech-head">
        <span className="trace-tech-idx">01</span>
        <h3>技法一 · stroke-dashoffset</h3>
        <span className="trace-tech-tag">SKETCH PHASE</span>
      </div>
      <div className="trace-tech-body">
        <div className="trace-tech-demo trace-demo-stroke">
          <svg viewBox="0 0 420 160" className="trace-demo-line-svg">
            <path
              ref={pathRef}
              pathLength={1}
              d="M12 118 C 70 20, 350 20, 408 118 S 220 150, 210 82 M 210 82 C 204 30, 60 60, 40 40"
              fill="none"
              stroke="#2fbf9a"
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ strokeDasharray: 1, strokeDashoffset: 1 }}
            />
          </svg>
          <span className="trace-demo-note">随滚动 · 线条一笔写出</span>
        </div>
        <div className="trace-tech-copy">
          <p>
            让一条线"被画出来"并不需要逐帧生成点坐标，只需把
            <strong> pathLength 归一化为 1</strong>，设置{' '}
            <code>stroke-dasharray: 1</code>（一段实线一段空白），
            再把 <code>stroke-dashoffset</code> 从 <em>1</em> 推到<em> 0</em>——
            实线段就沿着路径"前进"，形成描边。
          </p>
          <pre className="trace-code">
{`/* 隐藏整条线 */
stroke-dasharray:  1;
stroke-dashoffset: 1;
/* 动画到 0 = 一笔描完 */
@keyframes draw { to { stroke-dashoffset: 0 } }`}
          </pre>
          <p className="trace-tech-extra">
            原作把 45 组草稿线依次递延{' '}
            <code>animation-delay: calc(.2s + var(--i) * .05s)</code>，
            于是"一笔接一笔"的作画感就出来了。
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * 技法②小节 — 分层时间轴
 *
 * 功能：演示分层作画结构：底层草稿 → 中层墨线 → 顶层成品三层叠放，
 * 滚动进度驱动：草稿淡出（0~50%）、墨线浮现（30%~70%）、成品接管（60%~100%），
 * 下方时间轴条随进度填色。
 *
 * 参数：无
 * 返回值：React.ReactElement
 */
function TechLayers() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const sketchLayerRef = useRef<HTMLDivElement>(null);
  const inkLayerRef = useRef<HTMLDivElement>(null);
  const finalLayerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  /**
   * 滚动驱动三层层叠：按进度窗口控制各层透明度 + 时间轴条宽度
   */
  const drive = useCallback(() => {
    const sec = sectionRef.current;
    if (!sec) return;
    const p = elProgress(sec, 0.7);
    const fade = (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - b) / (a - b)));
    if (sketchLayerRef.current) sketchLayerRef.current.style.opacity = String(1 - fade(0, 0.5, p));
    if (inkLayerRef.current) inkLayerRef.current.style.opacity = String(fade(0.3, 0.7, p) * (1 - fade(0.6, 1, p)));
    if (finalLayerRef.current) finalLayerRef.current.style.opacity = String(fade(0.6, 1, p));
    const bar = barRef.current;
    if (bar) {
      // 进度到 0.5 前显示草稿色段，之后显示成品色段（示意两阶段）
      bar.style.background =
        p < 0.55
          ? `linear-gradient(90deg,#7b61ff ${p * 100}%,#222 0)`
          : `linear-gradient(90deg,#7b61ff 50%,#2fbf9a ${(p - 0.5) * 100}%,#222 0)`;
    }
  }, []);

  useTraceScroll(drive);

  return (
    <div ref={sectionRef} className="trace-tech trace-tech--flip">
      {/* 出血海报数字 */}
      <span className="trace-bleed-num" aria-hidden>02</span>
      <div className="trace-tech-head">
        <span className="trace-tech-idx">02</span>
        <h3>技法二 · 分层时间轴</h3>
        <span className="trace-tech-tag">FADE PHASE</span>
      </div>
      <div className="trace-tech-body">
        <div className="trace-tech-demo trace-demo-stack">
          {/* 三层叠放：草稿 → 墨线 → 成品（简化示意画：山 + 太阳） */}
          <div ref={sketchLayerRef} className="trace-layer trace-layer--sketch" style={{ opacity: 1 }}>
            <svg viewBox="0 0 420 220">
              <path d="M30 170 L150 60 L230 130 L330 40 L390 150" fill="none" stroke="#7b61ff" strokeWidth={3} strokeLinejoin="round" strokeDasharray="7 7" />
              <circle cx="330" cy="62" r="26" fill="none" stroke="#7b61ff" strokeWidth={3} strokeDasharray="7 7" />
            </svg>
            <span className="trace-layer-tag">草稿 · --i 递延描线</span>
          </div>
          <div ref={inkLayerRef} className="trace-layer trace-layer--ink" style={{ opacity: 0 }}>
            <svg viewBox="0 0 420 220">
              <path d="M30 170 L150 60 L230 130 L330 40 L390 150" fill="none" stroke="#1c1f24" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx="330" cy="62" r="26" fill="none" stroke="#1c1f24" strokeWidth={5} />
            </svg>
            <span className="trace-layer-tag">墨线 · 技法一定型</span>
          </div>
          <div ref={finalLayerRef} className="trace-layer trace-layer--final" style={{ opacity: 0 }}>
            <svg viewBox="0 0 420 220">
              <path d="M30 170 L150 60 L230 130 L330 40 L390 150 L390 190 L30 190 Z" fill="#2fbf9a" opacity={0.9} />
              <circle cx="330" cy="62" r="26" fill="#ffb347" />
              <path d="M30 190 L60 190 L60 30 L180 30 L180 60 L120 60 L120 130 L230 130 L230 40 L330 40 L330 130 L390 130 L390 190 Z" fill="rgba(0,0,0,0)" stroke="#1c1f24" strokeWidth={5} strokeLinejoin="round" />
            </svg>
            <span className="trace-layer-tag">成品 · 30 段 clip-path 揭示</span>
          </div>
          <div ref={barRef} className="trace-demo-layers-bar" />
        </div>
        <div className="trace-tech-copy">
          <p>
            整段动画其实是<strong>三层画面在一条时间轴上接力</strong>：
            <em>草稿线</em>逐笔画出（0~3s）→ <em>草稿淡出、底稿浮现上墨</em>（2.8~4.4s）
            → <em>成品画</em>分段揭示（4.1s 起）。滚轮即播放头，
            回滚则倒带，每一帧都可定格细看。
          </p>
          <pre className="trace-code">
{`/* 草稿容器：2.80s 后淡出 */
.trace-playing .trace-skst {
  animation: skst-out .8s ease both 2.80s;
}
/* 底稿浮现 → 上墨加深 */
.sketch-in 2.8s → .38
ink        3.6s → .62`}
          </pre>
        </div>
      </div>
    </div>
  );
}

/**
 * 技法③小节 — clip-path 分段揭示
 *
 * 功能：演示四种 clip-path 揭示方向（右扫 / 左扫 / 下扫 / 圆心绽开），
 * 2×2 方块随滚动依次展开内部图案，对应原作成品 30 段的 wipe-r/l/d 与 dab。
 *
 * 参数：无
 * 返回值：React.ReactElement
 */
function TechClipPath() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const wipeRRef = useRef<HTMLDivElement>(null);
  const wipeLRef = useRef<HTMLDivElement>(null);
  const wipeDRef = useRef<HTMLDivElement>(null);
  const dabRef = useRef<HTMLDivElement>(null);

  /**
   * 滚动驱动四种揭示：按进度计算各自 clip-path 形状
   */
  const drive = useCallback(() => {
    const sec = sectionRef.current;
    if (!sec) return;
    const p = elProgress(sec, 0.7);
    // 四个 demo 依次错开上演，形成"一段接一段"的接力观感
    const seg = (i: number) => Math.max(0, Math.min(1, (p - i * 0.18) / 0.35));
    if (wipeRRef.current) {
      const q = seg(0) * 113;
      wipeRRef.current.style.clipPath = `polygon(${-3 + q}% 0, 0 0, 0 100%, ${-3 + q}% 100%)`;
      wipeRRef.current.style.opacity = String(seg(0) > 0 ? 1 : 0);
    }
    if (wipeLRef.current) {
      const q = seg(1) * 113;
      wipeLRef.current.style.clipPath = `polygon(100% 0, 103% 0, ${103 - q}% 100%, ${100 - q}% 100%)`;
      wipeLRef.current.style.opacity = String(seg(1) > 0 ? 1 : 0);
    }
    if (wipeDRef.current) {
      const q = seg(2) * 113;
      wipeDRef.current.style.clipPath = `polygon(0 0, 100% 0, ${100 - q}% ${113 - q}%, 0 ${113 - q}%)`;
      wipeDRef.current.style.opacity = String(seg(2) > 0 ? 1 : 0);
    }
    if (dabRef.current) {
      const q = seg(3) * 120;
      dabRef.current.style.clipPath = `circle(${q}% at 50% 50%)`;
      dabRef.current.style.opacity = String(seg(3) > 0 ? 1 : 0);
    }
  }, []);

  useTraceScroll(drive);

  // 四个 demo 的标签与说明
  const items = [
    { ref: wipeRRef, name: 'wipe-r', zh: '右扫', dir: '从左向右拉开幕布' },
    { ref: wipeLRef, name: 'wipe-l', zh: '左扫', dir: '从右向左拉开幕布' },
    { ref: wipeDRef, name: 'wipe-d', zh: '下扫', dir: '从上向下降幕' },
    { ref: dabRef, name: 'dab', zh: '点染', dir: '自圆心向外扩散' },
  ];

  return (
    <div ref={sectionRef} className="trace-tech trace-tech--free">
      {/* 出血海报数字（自由构图：数字沉到右下出血） */}
      <span className="trace-bleed-num" aria-hidden>03</span>
      <div className="trace-tech-head">
        <span className="trace-tech-idx">03</span>
        <h3>技法三 · clip-path 分段揭示</h3>
        <span className="trace-tech-tag">REVEAL PHASE</span>
      </div>
      <div className="trace-tech-body trace-tech-body--grid">
        <div className="trace-clip-grid">
          {items.map(it => (
            <div key={it.name} className="trace-clip-cell">
              <div ref={it.ref} className="trace-clip-demo">
                墨
              </div>
              <div className="trace-clip-label">
                <code>{it.name}</code>
                <span>{it.zh} · {it.dir}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="trace-tech-copy">
          <p>
            成品的 30 个片段不是一起淡入，而是各自用{' '}
            <code>clip-path: polygon()/circle()</code> 剪出一个"窗口"，
            随 <code>--i</code> 递延依次展开——像拼图一块块到位，
            揭示方向（横扫/下扫/圆心绽开）由片段类型决定。
          </p>
          <pre className="trace-code">
{`/* 圆心绽开（dab）关键帧 */
@keyframes dab {
  0%   { opacity:0; clip-path:circle(0%   at 50% 50%); }
  35%  { opacity:1; }
  100% { opacity:1; clip-path:circle(120% at 50% 50%); }
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}

/**
 * 代码对照区 — 核心逻辑总览
 *
 * 功能：把滚动驱动的最小实现（本页用的 WAAPI 接管）以代码画廊形式展示，
 * 关键行高亮，帮助观众理解"滚动 ↔ 时间轴"的桥接只有五行。
 *
 * 参数：无
 * 返回值：React.ReactElement
 */
function CodeGallery() {
  return (
    <section className="trace-act trace-act--code">
      <header className="trace-explain-header">
        <span className="trace-kicker">UNDER THE HOOD</span>
        <h2 className="trace-explain-title">滚动驱动 · 最小实现</h2>
        <p className="trace-explain-sub">
          本页把 14.65 秒的 CSS 动画时间轴直接交给滚轮——桥接只有五行
        </p>
      </header>
      <pre className="trace-code trace-code--big">
{`/* 1. 挂 class 启动全部 CSS 动画（原作品 keyframes 一行未改） */
root.classList.add('trace-playing');

/* 2. 抓取画布内全部 CSSAnimation，统一接管 */
const anims = document.getAnimations()
  .filter(a => a instanceof CSSAnimation && root.contains(a.effect.target));
anims.forEach(a => { a.pause(); a.currentTime = 0; });

/* 3. 滚动进度 → 动画时间（含 animation-delay 语义） */
const p = clamp(滚动距离 / 可滚距离, 0, 1);
anims.forEach(a => a.currentTime = p * 14650);   // 14.65s = 整条时间轴`}
      </pre>
    </section>
  );
}