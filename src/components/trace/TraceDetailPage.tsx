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
 * 功能：六幕滚动叙事：
 *   1. 首屏：作品名 + 提示
 *   2. 主播放区（sticky 定格）：滚动进度 0~1 映射到 14.65s 动画时间轴，
 *      WAAPI 统一接管全部 CSSAnimation 的 currentTime，实现滚动=画笔、可回退倒放；
 *      侧边阶段指示器随进度点亮四个阶段
 *   3. 制作流程：五段滚入讲清这幅画怎么被生成（真产物 + 真数字，不引 WASM）
 *   4. 原理拆解区：三个技法小节各带独立随滚 demo（描边 / 分层时间轴 / clip-path 揭示）
 *   5. 代码对照区：核心 CSS 摘录 + 注释
 *   6. 结尾：返回按钮白闪回 #film
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

  // 已注入的动画列表（含各自的延迟与时长，供"只写变化项"判断；last 记录上次写入值）
  const animsRef = useRef<{ anim: CSSAnimation; delay: number; frag: number; last: number }[]>([]);
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
    fetch(ART_SVG_URL)
      .then(r => r.text())
      .then(t => setSvgText(t))
      .catch(err => console.error('[trace] svg load failed', err));
  }, []);

  /**
 * === 页面滚动：保持原生滚动，不做 JS 接管（实测结论，勿轻易改回）===
 *
 * 曾经试过在 window 层接管 wheel、逐帧 scrollTo 做"页面级缓入缓出"，结果滚动卡到 4fps。
 * 原因不在脚本（滚动事件链只占 0.5~0.7ms），而在光栅化：本页有 4 份近 6000 条 path 的 SVG
 * （合计约 3.5 万条 path），每块新进入视野的图块重新光栅化要几十~上百毫秒/帧（实测 279ms/帧）。
 *  - 原生滚动：光栅化由合成线程并行做，滚动本身始终顺滑，掉帧只表现为"内容晚一拍出现"
 *  - JS 驱动滚动：滚动被主线程的光栅化拖住 → 肉眼可见的卡顿
 * 所以"缓入缓出"只作用在**动画进度**上（见 DAMP_SMOOTH_TIME），页面滚动保持即时跟手。
 */

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
  // 只写"状态真的变了"的动画：主播放区有近 6000 条 per-path 动画，
  // 每帧全量写 currentTime 会让整幅画每帧重排重绘（实测滑行时帧间隔 ~200ms）。
  // 单条动画的观感只取决于 clamp(t, 延迟, 延迟+时长)：已结束写收尾点、中间写 t；
  // 未开始必须写 0（before 相位）而不是延迟点——forwards 填充在延迟前不生效，
  // 写延迟点会把动画强制推进活动相位起点、from 帧随即生效
  // （ink 的 from{opacity:.38} 曾让彩色底稿从 0% 就可见，母体同期是白纸）。
  // both 填充的动画写 0 与写延迟点观感一致（backwards 填充渲染同一 0% 帧）。
  let budget = 3000;
  for (const item of animsRef.current) {
    const target =
      t < item.delay ? 0 : t >= item.delay + item.frag ? item.delay + item.frag : t;
    if (item.last === target) continue;
    if (budget-- <= 0) break;
    item.last = target;
    item.anim.currentTime = target;
  }

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
        // 统一暂停并归零，等待滚动接管；顺带记下每条动画的延迟与时长
        animsRef.current = anims.map(a => {
          a.pause();
          a.currentTime = 0;
          const timing = (a.effect as KeyframeEffect | null)?.getComputedTiming?.();
          return {
            anim: a,
            delay: typeof timing?.delay === 'number' ? timing.delay : 0,
            frag: typeof timing?.duration === 'number' ? timing.duration : 0,
            last: Number.NaN,
          };
        });
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
          - 主播放区与技法③画布（.trace-art-layer）都把动画锁在 paused：
            动画自创建即静止，进度完全由 JS 的 currentTime 驱动
            （杜绝"自动播完停在成品"的时序缺陷） */}
      <style>{`${TRACE_ANIM_CSS}\n.trace-frame{width:min(760px,90vw)}\n.trace-stage-inner.trace-playing *{animation-play-state:paused!important}\n.trace-art-layer.trace-playing *{animation-play-state:paused!important}\n.trace-mini-art.trace-playing *{animation-play-state:paused!important}\n`}</style>

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

      {/* === 第三幕：制作流程（从一张位图到这幅动画） === */}
      <ProcessAct />

      {/* === 第四幕：原理拆解 === */}
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

      {/* === 第五幕：代码对照 === */}
      <CodeGallery />

      {/* === 第六幕：结尾返回 === */}
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
 * 计算元素在视口中的"演示进度"（0~1，保证演完时元素还在视口里）
 *
 * 功能：元素顶边从视口 85% 高度处滚进来时 p=0，滚到"元素底边落在视口 72% 高度处"时 p=1。
 *      终点用元素自身高度兜底 —— 元素越高越早演完，结局始终发生在元素仍完全可见的时候。
 *
 * 参数：
 *  - el {HTMLElement} 演示元素（传 demo 框本身，不要传整节）
 *
 * 返回值：number 0~1 的演示进度
 *
 * 注意事项：这里不能用"p=1 ⟺ 元素顶边滑到 -h"的写法（原来那版就是）：
 *          对高 demo 它意味着演完时元素已经划出视口 —— 技法① 的框高 493，
 *          按旧公式 p=1 时整节全在视口上方，等于"画完的那一刻没人看得见"。
 */
function elProgressInView(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const start = vh * 0.85;
  const end = vh * 0.72 - rect.height;
  const span = Math.max(1, start - end);
  return Math.max(0, Math.min(1, (start - rect.top) / span));
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
 * 技法②三层位图（原作素材栅格化结果）
 */
type TraceLayerBitmaps = {
  /** 草稿层：白纸 + 45 组草稿线（钉在"已画完"状态） */
  sketch: string;
  /** 墨线层：白纸 + 灰度上墨的成品画 */
  ink: string;
  /** 成品层：30 段拼合后的完整成品画 */
  art: string;
};

/**
 * 单张位图的栅格化参数
 */
type TraceRasterPaint = {
  /** 内容不透明度（1 = 原样，0.62 = 原作的"上墨"） */
  alpha: number;
  /** 画布滤镜（'' = 不加滤镜） */
  filter: string;
};

/** 草稿线组起点标记（45 组 .trace-skb 依次递延描线） */
const SKETCH_GROUP_MARK = '<g class="trace-skst">';
/** 底稿引用标记：草稿层切片到此为止（其后就是成品层定义） */
const ART_USE_MARK = '<use href="#trace-art"';
/** 成品层起点标记（30 段 .trace-pg 分段） */
const ART_GROUP_MARK = '<g id="trace-art">';
/** 画纸底色：对应原作 .trace-frame 的白纸，先铺满画布保证位图不透明 */
const TRACE_PAPER = '#ffffff';
/** 上墨滤镜：照抄原作 .trace-sketch 的 filter:grayscale(1) brightness(.72) contrast(1.35) */
const INK_FILTER = 'grayscale(1) brightness(.72) contrast(1.35)';
/** 上墨不透明度：原作 ink 关键帧终值 0.62 */
const INK_ALPHA = 0.62;

/**
 * 解码一段独立 SVG 文本为可绘制的图片对象
 *
 * 功能：把 SVG 标记包成 blob URL 交给 <img> 解码，解码完成后立刻释放该 blob URL
 *      （图片数据已进内存，之后可反复 drawImage）。
 *
 * 参数：
 *  - svgMarkup {string} 完整的独立 SVG 文本（自带 viewBox，不依赖外部样式）
 *
 * 返回值：Promise<HTMLImageElement> 解码完成的图片对象
 *
 * 异常：SVG 语法错误或浏览器拒绝解码时 reject（调用方静默降级）
 *
 * 注意事项：blob URL 与页面同源，画进 canvas 不会污染画布，toBlob 可用
 */
function decodeSvgImage(svgMarkup: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('svg decode failed'));
    };
    img.src = url;
  });
}

/**
 * 把已解码的 SVG 图片栅格化成本地位图
 *
 * 功能：在 1600×1095 的离屏画布上先铺白纸，再按参数把图片画上去
 *      （可带滤镜与不透明度），最后导出 PNG 的 objectURL。
 *      近 6000 条 path 只在这里渲染一次，滚动帧只剩三张位图的合成。
 *
 * 参数：
 *  - img   {HTMLImageElement} 已解码的 SVG 图片（原始尺寸即原作坐标系）
 *  - paint {TraceRasterPaint} 栅格化参数（不透明度 / 滤镜）
 *
 * 返回值：Promise<string> 位图的 objectURL
 *
 * 异常：2d 上下文缺失或 toBlob 失败时 reject（调用方静默降级）
 *
 * 注意事项：画布尺寸取原作坐标系 1600×1095，与 viewBox 1:1，
 *          避免重采样把细描边糊掉
 */
function rasterizeLayer(img: HTMLImageElement, paint: TraceRasterPaint): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = ART_W;
  canvas.height = ART_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('2d context unavailable'));
  ctx.fillStyle = TRACE_PAPER;
  ctx.fillRect(0, 0, ART_W, ART_H);
  if (paint.filter) ctx.filter = paint.filter;
  ctx.globalAlpha = paint.alpha;
  ctx.drawImage(img, 0, 0, ART_W, ART_H);
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(URL.createObjectURL(blob));
      else reject(new Error('canvas toBlob failed'));
    }, 'image/png');
  });
}

/** 模块级缓存：技法②位图只栅格化一次（StrictMode 双跑 / 返回重进都复用） */
let traceLayersPromise: Promise<TraceLayerBitmaps> | null = null;

/**
 * 载入技法②所需的三张位图（草稿 / 墨线 / 成品）
 *
 * 功能：
 *  1. 取 4.7MB 原作 SVG 文本，按标记切成两段：
 *     `<g class="trace-skst">` 到 `<use href="#trace-art">` 之前的草稿组、
 *     `<g id="trace-art">` 到文件末尾的成品层
 *  2. 两段各自包成独立 SVG：草稿段内嵌"钉住画完状态"的样式（去掉描线动画），
 *     成品段原样保留 30 段 .trace-pg
 *  3. 成品图解码一次、栅格化两次：原样出成品层，灰度 + 0.62 出墨线层
 *
 * 参数：无
 * 返回值：Promise<TraceLayerBitmaps> 三层位图的 objectURL
 *
 * 异常：素材请求失败 / 标记缺失 / 栅格化失败时 reject，并清空缓存以便重试
 *
 * 注意事项：
 *  - 结果缓存在模块作用域，重复挂载不会二次解码 4.7MB 素材
 *  - 位图 objectURL 不主动 revoke：随文档卸载一起释放，
 *    否则 StrictMode 二次挂载会拿到失效地址
 */
function loadTraceLayers(): Promise<TraceLayerBitmaps> {
  if (traceLayersPromise) return traceLayersPromise;
  traceLayersPromise = (async () => {
    const text = await fetch(ART_SVG_URL).then(r => r.text());
    const sketchStart = text.indexOf(SKETCH_GROUP_MARK);
    const useIdx = text.indexOf(ART_USE_MARK);
    const artStart = text.indexOf(ART_GROUP_MARK);
    if (sketchStart < 0 || useIdx <= sketchStart || artStart < 0) {
      throw new Error('trace layers markup not found');
    }
    const wrap = (inner: string, style: string) =>
      `<svg viewBox="0 0 ${ART_W} ${ART_H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><style>${style}</style>${inner}</svg>`;
    // 草稿段：沿用原作描线样式，但把 stroke-dashoffset 钉在 0（= 45 组线全部画完）
    const sketchSvg = wrap(
      text.slice(sketchStart, useIdx),
      `${TRACE_ANIM_CSS}\n.trace-skb path{stroke-dashoffset:0!important}`
    );
    // 成品段：30 段 .trace-pg 原样保留（本节不做揭示，直接当完整成品画用）
    const artSvg = wrap(text.slice(artStart).replace(/<\/svg>[\s\S]*$/, ''), '');

    const [sketchImg, artImg] = await Promise.all([decodeSvgImage(sketchSvg), decodeSvgImage(artSvg)]);
    const [sketch, ink, art] = await Promise.all([
      rasterizeLayer(sketchImg, { alpha: 1, filter: '' }),
      rasterizeLayer(artImg, { alpha: INK_ALPHA, filter: INK_FILTER }),
      rasterizeLayer(artImg, { alpha: 1, filter: '' }),
    ]);
    return { sketch, ink, art };
  })().catch(err => {
    traceLayersPromise = null;
    throw err;
  });
  return traceLayersPromise;
}

/* ====================================================================
 * 幕 2.5 · 制作流程（PROCESS）
 *
 * 讲解"这幅画是怎么被生成出来的"：五段滚入 + 五张真实产物卡。
 * 全部数字取自本页已有的真产物（trace.png / trace-body.svg / trace-thumb.html），
 * 页面不引入 VTracer WASM —— 展示的是"跑过一次的结果"，不是实时转换。
 * ==================================================================== */

/** 原始位图路径（被描摹的那张 PNG，与本页作品一一对应） */
const RASTER_URL = '/asset/textures/projects/trace.png';
/** 工具导出的自包含动画 HTML（本页这幅画的母体） */
const EXPORT_HTML_URL = '/asset/trace/trace-thumb.html';

/** 打稿批次真值：原作 .trace-skb 分组数（工具按墨量均衡分批的产物） */
const SKETCH_BATCHES = 45;
/** 打稿节奏（s）：起笔 .2、每批 +.05、单笔 .7（对应 CSS calc(.2s + var(--i)*.05s)） */
const SKETCH_T0 = 0.2;
const SKETCH_STEP = 0.05;
const SKETCH_FRAG = 0.7;
/** 上色层数真值：原作 .trace-pg 分组数（即工具的「层数」参数） */
const ART_LAYERS = 30;
/** 上色节奏（s）：T₀ 4.1、每层 +.3、单段 .55（对应 CSS calc(4.1s + var(--i)*0.3s)） */
const PAINT_T0 = 4.1;
const PAINT_STEP = 0.3;
const PAINT_FRAG = 0.55;
/** 定格与总时长（s）：末层收尾 13.35、整体 14.65（= 工具的 t.end / t.total） */
const ACT_END = 13.35;
const ACT_TOTAL = 14.65;
/** 同一条总时长的毫秒写法：CSS 动画延迟与 WAAPI currentTime 都以毫秒计，
 *  示例播放器（第五幕）的虚拟时间统一用它，避免秒/毫秒混用 */
const ACT_MS = ACT_TOTAL * 1000;
/** 调子淡入 / 上墨加深的时刻（s，工具的 t.tone / t.ink） */
const TONE_AT = 2.8;
const INK_AT = 3.6;

/** 甘特图几何（viewBox 坐标）：左侧留轴标，右侧留末层条的宽度 */
const GANTT_VBW = 480;
const GANTT_VBH = 348;
const GANTT_X0 = 40;
const GANTT_W = 424;

/**
 * 时间（s）→ 甘特图 x 坐标
 *
 * 参数：
 *  - t {number} 时间（秒），0~14.65
 * 返回值：number viewBox 坐标系内的 x
 */
function ganttX(t: number): number {
  return GANTT_X0 + (t / ACT_TOTAL) * GANTT_W;
}

/** 四种揭示方向的展示元数据（顺序即图例顺序，色同时用于层网格与甘特条） */
const DIR_META: { key: string; cls: string; glyph: string; zh: string; color: string }[] = [
  { key: 'wipe-r', cls: 'trace-wipe-r', glyph: '→', zh: '右扫', color: '#2fbf9a' },
  { key: 'wipe-l', cls: 'trace-wipe-l', glyph: '←', zh: '左扫', color: '#6fd6bd' },
  { key: 'wipe-d', cls: 'trace-wipe-d', glyph: '↓', zh: '下扫', color: '#7c8a84' },
  { key: 'dab', cls: 'trace-dab', glyph: '◉', zh: '点染', color: '#cfdad6' },
];

/**
 * 方向 key → 展示色（取不到时退回第一种方向色）
 *
 * 参数：
 *  - key {string | undefined} 方向 key（wipe-r / wipe-l / wipe-d / dab）
 * 返回值：string 十六进制颜色
 */
function dirColor(key: string | undefined): string {
  return (DIR_META.find(m => m.key === key) ?? DIR_META[0]).color;
}

/** 注入 SVG 后从 DOM 量出来的真实结构（卡 02 的读数、卡 03 的层网格都由它渲染） */
type ProcessArtInfo = {
  /** 路径总数 */
  paths: number;
  /** .trace-pg 分组数 */
  groups: number;
  /** 每层的路径数（按 DOM 顺序，即绘制顺序） */
  per: number[];
  /** 每层的揭示方向 key（按 DOM 顺序） */
  dirs: string[];
  /** 四种方向各占多少层 */
  dirCount: Record<string, number>;
};

/**
 * 制作流程的单个阶段外壳（左：序号 + 文案；右：产物卡）
 *
 * 功能：统一五段的行结构（12 栏网格：序号 1 栏 / 文案 2~6 栏 / 产物卡 7~13 栏），
 *      并由 drive() 在滚到该段时给外层加 is-on 点亮序号与连接线。
 *
 * 参数：
 *  - n        {string}           段序号（"01"~"05"）
 *  - zh       {string}           阶段中文名
 *  - en       {string}           阶段英文名（小字 kicker）
 *  - lead     {React.ReactNode}  阶段说明（2~3 句）
 *  - facts    {string[]}         真值脚注（每行一条，等宽小字）
 *  - children {React.ReactNode}  右侧产物卡内容
 * 返回值：React.ReactElement
 */
function ProcessStage({ n, zh, en, lead, facts, children }: {
  n: string;
  zh: string;
  en: string;
  lead: React.ReactNode;
  facts: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="trace-proc-stage">
      <div className="trace-proc-num">{n}</div>
      <div className="trace-proc-copy">
        <span className="trace-proc-en">{en}</span>
        <h3>{zh}</h3>
        <p>{lead}</p>
        <ul className="trace-proc-facts">
          {facts.map(f => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
      <div className="trace-proc-card">{children}</div>
    </div>
  );
}

/**
 * 幕 2.5 — 制作流程（从一张位图到这幅动画）
 *
 * 功能：用五段"滚入 + 产物卡"讲清这幅画的生成链：
 *      01 输入位图 → 02 矢量化描摹 → 03 分组成层 → 04 编舞时间轴 → 05 导出，
 *      幕末附一张「同一工具的现在」注脚，交代后来改掉/新增的部分。
 *
 *      演出分三处，全部由滚动驱动（复用页面既有的 elProgressInView + trace:scroll 广播）：
 *      - 五段各自滚到 30% 时点亮序号与竖线
 *      - 卡 03 的 30 格层网格随进度逐格点亮（= 层的登场顺序）
 *      - 卡 04 的甘特播放头沿 14.65s 时间轴移动并刷新读数
 *      卡 02 另有两条独立交互：鼠标悬停高亮光标下的那条真实路径；
 *      鼠标不在卡上时每 0.7s 自动换一条高亮（尊重 prefers-reduced-motion）。
 *
 * 参数：无
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 注入的成品层（2.4MB / 5891 条 path）是静态展示，不挂 .trace-playing、
 *    不参与 WAAPI 时间轴；高亮只改单条 path 的 class，重绘范围被限制在局部
 *  - 滚动帧里先读完五段进度再统一写样式，避免读-写交替引发多次强制布局
 *  - 注入容器（.trace-proc-vec-art）不能有 React 子节点：innerHTML 会覆盖它们，
 *    导致 React 二次渲染时找不到自己创建的节点
 */
function ProcessAct() {
  const sectionRef = useRef<HTMLElement>(null);
  // 真 SVG 的注入点
  const artHostRef = useRef<HTMLDivElement>(null);
  // 甘特播放头（整组平移，一次属性写入）
  const ganttHeadRef = useRef<SVGGElement>(null);
  // 甘特读数（"6.42s"）
  const ganttTxtRef = useRef<HTMLSpanElement>(null);
  // 卡 02 的路径读数（"#132 · #A88086"）
  const vecTagRef = useRef<HTMLSpanElement>(null);
  // 量出来的真实结构（注入完成后才有值）
  const [art, setArt] = useState<ProcessArtInfo | null>(null);
  // 注入后的路径元素表 + 当前高亮的那条
  const pathsRef = useRef<SVGPathElement[]>([]);
  const hotRef = useRef<SVGPathElement | null>(null);
  // 鼠标是否压在卡 02 上（压住时暂停自动轮播，交还给用户）
  const hoverRef = useRef(false);
  // 自动轮播的游标
  const cycleRef = useRef(0);
  // 五段 stage 元素与它们的点亮状态（只在状态翻转时写 DOM）
  const stageElsRef = useRef<HTMLElement[]>([]);
  const stageOnRef = useRef<number[]>([]);
  // 30 格层网格与当前点亮格数
  const cellElsRef = useRef<HTMLElement[]>([]);
  const cellLitRef = useRef(-1);

  /**
   * 挂载后收集 stage / 层网格元素（一次性查询，之后滚动只做属性写入）
   */
  useEffect(() => {
    const sec = sectionRef.current;
    if (!sec) return;
    stageElsRef.current = Array.from(sec.querySelectorAll<HTMLElement>('.trace-proc-stage'));
    cellElsRef.current = Array.from(sec.querySelectorAll<HTMLElement>('.trace-proc-cell'));
  }, []);

  /**
   * 注入真成品层（#trace-art）并量出真实结构
   *
   * 功能：取 trace-body.svg，切出成品层 <g id="trace-art">（30 段 .trace-pg），
   *      包成独立 svg 注入产物卡做静态全展示；随后从 DOM 读出真值：
   *      路径总数、分组数、每层路径数与揭示方向 —— 卡 02 的读数与
   *      卡 03 的层网格全部由这些真值渲染，因此屏幕上不会出现编造的参数。
   *
   * 参数：无
   * 返回值：无（异步，完成后 setArt 触发读数区重渲染）
   *
   * 异常：请求失败 / 标记缺失时静默降级（卡内留占位提示，不影响滚动）
   *
   * 注意事项：
   *  - 解析 2.4MB 需要一两百毫秒，注入后立刻量一次 DOM 即可
   *  - 该容器由 innerHTML 接管，React 侧只能给它空子节点（见组件头注释）
   */
  useEffect(() => {
    let stopped = false;
    fetch(ART_SVG_URL)
      .then(r => r.text())
      .then(text => {
        if (stopped) return;
        const host = artHostRef.current;
        if (!host) return;
        const start = text.indexOf(ART_GROUP_MARK);
        if (start < 0) throw new Error('trace-art group not found');
        const frag = text.slice(start).replace(/<\/svg>[\s\S]*$/, '');
        host.innerHTML = `<svg viewBox="0 0 ${ART_W} ${ART_H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${frag}</svg>`;

        const groups = Array.from(host.querySelectorAll<SVGGElement>('g.trace-pg'));
        const per: number[] = [];
        const dirs: string[] = [];
        const dirCount: Record<string, number> = {};
        for (const g of groups) {
          per.push(g.querySelectorAll('path').length);
          const key = (DIR_META.find(m => g.classList.contains(m.cls)) ?? DIR_META[0]).key;
          dirs.push(key);
          dirCount[key] = (dirCount[key] ?? 0) + 1;
        }
        const paths = Array.from(host.querySelectorAll<SVGPathElement>('path'));
        pathsRef.current = paths;
        setArt({ paths: paths.length, groups: groups.length, per, dirs, dirCount });
      })
      .catch(err => console.error('[trace] 制作流程卡注入失败', err));
    return () => {
      stopped = true;
    };
  }, []);

  /**
   * 高亮某条真实路径（并把上一条恢复原样）
   *
   * 功能：只改这两条 path 的 class —— 近 6000 条路径的 SVG 里，
   *      把重绘范围限制在单条路径是"逐条高亮"能跑得动的前提；
   *      同时把编号与填充色写进读数。
   *
   * 参数：
   *  - p {SVGPathElement | null} 要高亮的路径；传 null 表示清空
   * 返回值：void
   */
  const highlight = useCallback((p: SVGPathElement | null) => {
    const prev = hotRef.current;
    if (prev === p) return;
    if (prev) prev.classList.remove('is-hot');
    hotRef.current = p;
    if (vecTagRef.current) {
      if (p) {
        const i = pathsRef.current.indexOf(p);
        vecTagRef.current.textContent = `#${i} · ${p.getAttribute('fill') ?? '—'}`;
      } else {
        vecTagRef.current.textContent = `全部 ${pathsRef.current.length} 条路径`;
      }
    }
    if (p) p.classList.add('is-hot');
  }, []);

  /**
   * 卡 02 路径轮播：无鼠标接管时每 0.7s 换一条高亮
   *
   * 功能：让"这幅画其实是几千条独立路径"这件事自己动起来；
   *      步长取一圈约 43 步，高亮在画面上跳着走，不会只扫一条边；
   *      卡离开视口或鼠标压在卡上时暂停（不写样式、不重绘）。
   *
   * 参数：无
   * 返回值：无（卸载时断开观察者与定时器）
   *
   * 注意事项：prefers-reduced-motion 下不自动轮播，悬停高亮仍然可用
   */
  useEffect(() => {
    if (!art) return;
    const list = pathsRef.current;
    const host = artHostRef.current;
    if (!list.length || !host) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let visible = false;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) visible = e.isIntersecting;
    });
    io.observe(host);
    const stride = Math.max(1, Math.floor(list.length / 43));
    const timer = window.setInterval(() => {
      if (!visible || hoverRef.current) return;
      cycleRef.current = (cycleRef.current + stride) % list.length;
      highlight(list[cycleRef.current]);
    }, 700);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
  }, [art, highlight]);

  /**
   * 滚动驱动这一幕的三处演出
   *
   * 功能：
   *  1. 五段各自滚到 30% 进度时给 stage 打 is-on（点亮序号与竖线）
   *  2. 卡 03：30 格层网格按进度逐格点亮，直观呈现"层是按顺序登场的"
   *  3. 卡 04：播放头沿 0~14.65s 移动，读数同步刷新
   *
   * 参数：无
   * 返回值：void
   *
   * 注意事项：先读完五段进度再统一写样式（读-写分离），
   *          否则每写一次样式都会让下一次 getBoundingClientRect 触发强制布局
   */
  const drive = useCallback(() => {
    const stages = stageElsRef.current;
    if (!stages.length) return;

    const ps: number[] = [];
    for (const el of stages) ps.push(elProgressInView(el));

    for (let i = 0; i < stages.length; i++) {
      const on = ps[i] > 0.3 ? 1 : 0;
      if (stageOnRef.current[i] !== on) {
        stageOnRef.current[i] = on;
        stages[i].classList.toggle('is-on', on === 1);
      }
    }

    const t = Math.max(0, Math.min(ACT_TOTAL, (ps[3] ?? 0) * ACT_TOTAL));
    const x = GANTT_X0 + (t / ACT_TOTAL) * GANTT_W;
    if (ganttHeadRef.current) ganttHeadRef.current.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
    if (ganttTxtRef.current) ganttTxtRef.current.textContent = `${t.toFixed(2)}s`;

    const cells = cellElsRef.current;
    const lit = Math.round((ps[2] ?? 0) * cells.length);
    if (cellLitRef.current !== lit) {
      cellLitRef.current = lit;
      for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('is-lit', i < lit);
    }
  }, []);

  useTraceScroll(drive);

  /** 卡 02 的鼠标接管：光标压在哪条 path 上就高亮哪条（事件目标即命中结果，无需再算） */
  const onVecMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      hoverRef.current = true;
      const el = e.target as Element;
      highlight(el instanceof SVGPathElement ? el : null);
    },
    [highlight]
  );
  const onVecLeave = useCallback(() => {
    hoverRef.current = false;
    highlight(null);
  }, [highlight]);

  /** 注入后的层网格读数（未就绪时用真值兜底：45 批 / 30 层是产物的确定结构） */
  const pathCount = art ? art.paths : 5891;
  const ganttW = Math.round((SKETCH_FRAG / ACT_TOTAL) * GANTT_W);
  const paintW = Math.round((PAINT_FRAG / ACT_TOTAL) * GANTT_W);

  return (
    <section ref={sectionRef} className="trace-act trace-act--process">
      <header className="trace-proc-head">
        <span className="trace-kicker">PROCESS</span>
        <h2 className="trace-proc-title">从一张位图到这幅动画</h2>
        <p className="trace-proc-sub">
          这幅画的矢量结构、分层与时间轴都不是手搓的，而是 svg-trace-studio 一次跑出来的。
          五步，每一步都能在本页核到真值。
        </p>
      </header>

      <ProcessStage
        n="01"
        zh="输入一张位图"
        en="INPUT · RASTER"
        lead={<>起点是一张普通位图，没有任何分层信息。工具整条流水线跑在浏览器里：VTracer 编译成
          WASM 内联在单个 HTML 文件中，图片不出本机。</>}
        facts={['输入 trace.png · 1064 × 728 · 617 KB', '离线运行 · 无网络请求', '坐标系另算：描摹输出 1600 × 1095']}
      >
        <figure className="trace-proc-raster">
          <img src={RASTER_URL} alt="被描摹的原始位图" draggable={false} />
          <figcaption>悬停放大 4× —— 位图是一格格像素</figcaption>
        </figure>
      </ProcessStage>

      <ProcessStage
        n="02"
        zh="矢量化描摹"
        en="TRACE · VTracer WASM"
        lead={<>VTracer 把像素栅格转成彩色矢量路径：一次输出 {pathCount} 条 path、{art ? art.groups : ART_LAYERS} 组。
          风格由参数决定 —— 分层结构（叠层 / 挖剪）、曲线模式（样条 / 折线 / 像素）、
          颜色精度、斑点过滤、层差、预放大。</>}
        facts={[
          `${pathCount} 条 path · ${art ? art.groups : ART_LAYERS} 组 · 1600 × 1095`,
          '每条 path 自带填充色，形状即轮廓',
          '参数：分层结构 / 曲线模式 / 颜色精度 / 斑点过滤 / 层差 / 预放大',
        ]}
      >
        <div className="trace-proc-vec">
          <div className="trace-proc-vec-bar">
            <span>描摹结果（静态展示，不播动画）</span>
            <span ref={vecTagRef} className="trace-proc-vec-tag">
              全部 {pathCount} 条路径
            </span>
          </div>
          <div
            ref={artHostRef}
            className="trace-proc-vec-art"
            onPointerMove={onVecMove}
            onPointerLeave={onVecLeave}
          />
          {!art && <span className="trace-proc-wait">正在解析原作 4.8MB SVG…</span>}
          <span className="trace-proc-vec-hint">悬停任一处 → 高亮的是一条独立路径（自动轮播时同理）</span>
        </div>
      </ProcessStage>

      <ProcessStage
        n="03"
        zh="分组成层"
        en="LAYERS · 30 GROUPS"
        lead={<>按"墨量"（路径数据长度）把全部 path 均衡切成 {ART_LAYERS} 层，每层随机绑一个揭示方向。
          注意均衡的是墨量而不是条数 —— 所以层内路径数 {art ? `${Math.min(...art.per)} → ${Math.max(...art.per)}` : '4 → 644'} 条不等，
          后面几层塞的全是碎细节。层叠顺序就是绘制顺序，后画的自然后盖前画；方向决定这一层从哪边进场。</>}
        facts={[
          `分层权重 = 路径数据长度（墨量），均衡切 ${ART_LAYERS} 份`,
          `方向分布：${DIR_META.map(m => `${m.zh} ${art ? (art.dirCount[m.key] ?? 0) : '—'}`).join(' / ')}`,
          '层叠顺序 = 绘制顺序（后画盖先画）',
        ]}
      >
        <div className="trace-proc-groups">
          <div className="trace-proc-grid">
            {Array.from({ length: ART_LAYERS }, (_, i) => {
              const key = art?.dirs[i];
              const meta = DIR_META.find(m => m.key === key);
              return (
                <div
                  key={i}
                  className={`trace-proc-cell d-${key ?? 'dab'}`}
                  title={`第 ${i + 1} 层 · ${meta ? meta.zh : '方向未知'} · ${art ? art.per[i] : '—'} 条路径`}
                >
                  <span className="trace-proc-cell-i">{String(i).padStart(2, '0')}</span>
                  <span className="trace-proc-cell-g">{meta ? meta.glyph : ''}</span>
                  <span className="trace-proc-cell-n">{art ? art.per[i] : '—'}</span>
                </div>
              );
            })}
          </div>
          <div className="trace-proc-legend">
            {DIR_META.map(m => (
              <span key={m.key} className={`d-${m.key}`}>
                <i />
                {m.zh} {art ? (art.dirCount[m.key] ?? 0) : '—'}
              </span>
            ))}
          </div>
        </div>
      </ProcessStage>

      <ProcessStage
        n="04"
        zh="编舞时间轴"
        en="CHOREOGRAPHY · 14.65s"
        lead={<>两层编排叠在一条时间轴上：先按墨量分批打稿，{SKETCH_BATCHES} 批每批差 {SKETCH_STEP}s、
          单笔 {SKETCH_FRAG}s 勾出；{TONE_AT}s 调子淡入、{INK_AT}s 上墨加深，
          然后 {PAINT_T0}s 起逐层上色，每层差 {PAINT_STEP}s、单层 {PAINT_FRAG}s，
          {ACT_END}s 收尾定格，总时长 {ACT_TOTAL}s。滚动就是这条轴的播放头。</>}
        facts={[
          `打稿：${SKETCH_T0}s + i × ${SKETCH_STEP}s · 单笔 ${SKETCH_FRAG}s · ${SKETCH_BATCHES} 批`,
          `上墨：${TONE_AT}s 调子 → ${INK_AT}s 加深 → ${PAINT_T0}s 上色`,
          `上色：i × ${PAINT_STEP}s 递延 · 单层 ${PAINT_FRAG}s · 定格 ${ACT_END}s / 总长 ${ACT_TOTAL}s`,
        ]}
      >
        <div className="trace-proc-gantt">
          <div className="trace-proc-gantt-bar">
            <span>时间轴 · 总长 {ACT_TOTAL}s</span>
            <span ref={ganttTxtRef} className="trace-proc-gantt-t">0.00s</span>
          </div>
          <svg viewBox={`0 0 ${GANTT_VBW} ${GANTT_VBH}`} className="trace-proc-gantt-svg" role="img" aria-label="打稿与上色的时间轴甘特图">
            {/* 打稿：45 批依次起笔（每批 +.05s，长 .7s） */}
            {Array.from({ length: SKETCH_BATCHES }, (_, i) => (
              <rect
                key={`s${i}`}
                x={ganttX(SKETCH_T0 + i * SKETCH_STEP)}
                y={16 + i * 2.4}
                width={ganttW}
                height={1.6}
                fill="#454a4d"
              />
            ))}
            <text x={GANTT_VBW - 10} y={12} textAnchor="end" className="trace-proc-gantt-lb">
              打稿 · {SKETCH_BATCHES} 批
            </text>
            {/* 两个时刻线（调子淡入 / 上墨加深）：线只画不各自标字，
                标注统一放在上墨线右侧，避免两条线的标签相距 23px 互相压字 */}
            {[TONE_AT, INK_AT].map(t => (
              <line
                key={t}
                x1={ganttX(t)}
                y1={16}
                x2={ganttX(t)}
                y2={128}
                stroke="rgba(125,250,222,.35)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ))}
            <text x={ganttX(INK_AT) + 8} y={124} className="trace-proc-gantt-lb">
              {TONE_AT}s 调子淡入
            </text>
            <text x={ganttX(INK_AT) + 8} y={136} className="trace-proc-gantt-lb">
              {INK_AT}s 上墨加深
            </text>
            {/* 上色：30 层依次登场（每层 +.3s，长 .55s），颜色 = 该层的揭示方向 */}
            {Array.from({ length: ART_LAYERS }, (_, i) => (
              <rect
                key={`p${i}`}
                x={ganttX(PAINT_T0 + i * PAINT_STEP)}
                y={152 + i * 5.4}
                width={paintW}
                height={4.2}
                fill={dirColor(art?.dirs[i])}
              />
            ))}
            <text x={GANTT_VBW - 10} y={148} textAnchor="end" className="trace-proc-gantt-lb">
              上色 · {ART_LAYERS} 层（按揭示方向着色）
            </text>
            {/* 轴刻度：末刻（总时长）不标字，直接写在标题栏，避免与 13.35s 挤在一起 */}
            {[0, PAINT_T0, ACT_END, ACT_TOTAL].map((t, i, arr) => (
              <g key={`x${t}`}>
                <line x1={ganttX(t)} y1={GANTT_VBH - 22} x2={ganttX(t)} y2={GANTT_VBH - 18} stroke="rgba(155,190,180,.5)" strokeWidth={1} />
                {i < arr.length - 1 && (
                  <text x={ganttX(t)} y={GANTT_VBH - 6} textAnchor="middle" className="trace-proc-gantt-lb">
                    {t}s
                  </text>
                )}
              </g>
            ))}
            {/* 播放头：随滚动平移整组（只画竖线，读数在卡片标题栏，避免圆点压住块标签） */}
            <g ref={ganttHeadRef} transform="translate(0 0)">
              <line x1={0} y1={8} x2={0} y2={GANTT_VBH - 18} stroke="#7dfade" strokeWidth={1} />
            </g>
          </svg>
        </div>
      </ProcessStage>

      <ProcessStage
        n="05"
        zh="导出可直接打开的文件"
        en="EXPORT · SELF-CONTAINED"
        lead={<>工具不产出"工程"，产出能双击的自包含文件：静态 HTML 只放成品图、动画 HTML 带上整条时间轴、
          纯 CSS 绘图包把图层摊成 <code>--fill</code> + <code>clip-path: path()</code> 的分层结构。
          本页这幅画的母体就是它导出的动画 HTML。</>}
        facts={['动画 HTML · 4.83 MB · 含 45 + 30 组、5891 条 path', '无外部依赖 · 双击即播', '另一路：纯 CSS 包（zip）可继续手改图层']}
      >
        <div className="trace-proc-export">
          <a className="trace-proc-file is-hero" href={EXPORT_HTML_URL} target="_blank" rel="noreferrer">
            <span className="trace-proc-file-name">trace-animated.html</span>
            <span className="trace-proc-file-meta">动画 HTML · 4.83 MB · 45 + 30 组 · 5891 条 path</span>
            <span className="trace-proc-file-tag">本页作品的母体 · 打开看看 ↗</span>
          </a>
          <div className="trace-proc-file">
            <span className="trace-proc-file-name">static.html</span>
            <span className="trace-proc-file-meta">静态 HTML · 只放成品图，无动画时间轴</span>
          </div>
          <div className="trace-proc-file">
            <span className="trace-proc-file-name">css-pack.zip</span>
            <span className="trace-proc-file-meta">纯 CSS 绘图包 · --fill + clip-path: path() 分层</span>
          </div>
        </div>
      </ProcessStage>

      <footer className="trace-proc-foot">
        <span className="trace-proc-foot-tag">同一工具的现在</span>
        <p>
          本页作品是它某个版本的快照。之后这些部分被改掉或新增，才成了今天的样子：
        </p>
        <ul>
          <li>
            <b>上色</b>：clip-path 分段揭示已回退 —— 它在 SVG 上逐帧重栅格化会抖，
            现在改成 opacity 落点 + 0.08s 时间槽合并，把每帧的重绘量压下来。
          </li>
          <li>
            <b>打稿</b>：从"按墨量均分 45 批"改成按墨量取 top-32、按空间最近邻逐笔勾，
            手抖微扰直接烘焙进坐标（不用滤镜，避免每帧重算噪声）。
          </li>
          <li>
            <b>描摹</b>：新增子路径拆分 —— VTracer 常把同色多块并成一条 path，
            拆开后大色块也能一部分一部分地出现。
          </li>
          <li>
            <b>后处理</b>：另有 piece-cutter 把图层切成互不重叠的矢量块（上层从下层挖空），
            再挂鼠标划过的块状排斥。
          </li>
        </ul>
      </footer>
    </section>
  );
}

/** 技法①机制条几何（viewBox 420×58）：拉直后的"路径"起点与长度 */
const DASH_X0 = 14;
const DASH_LEN = 392;

/**
 * 技法①小节 — stroke-dashoffset 描边
 *
 * 功能：演示 SVG 线条描画原理：pathLength 归一化后 dasharray=1，
 * dashoffset 从 1 → 0 即"沿线描出"。左侧 demo 分上下两半：
 * 上半是"结果"（曲线被一笔写出），下半是"为什么"（把同一条路径拉直，
 * 看 dasharray=1 产生的实线段 / 空白段，以及 offset 推进时边界扫过），
 * 框内右下角给出实时参数读数。右侧为中文原理 + 核心代码。
 *
 * 参数：无
 * 返回值：React.ReactElement
 */
function TechDashoffset() {
  const sectionRef = useRef<HTMLDivElement>(null);
  // 演示框本身：进度按它算，保证"画完"发生在框还完全可见的时候
  const demoRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  // 机制条：实线段右端 + 边界游标（同一进度驱动的两次属性写入）
  const solidRef = useRef<SVGLineElement>(null);
  const edgeRef = useRef<SVGLineElement>(null);
  // 框内右下角读数
  const meterRef = useRef<HTMLSpanElement>(null);

  /**
   * 滚动驱动描边 + 机制条 + 读数
   *
   * 功能：把本节演示进度 p 映射成三处同步显示：
   *  1. 曲线上的 strokeDashoffset（1 → 0）：实线段沿路径前进，线被写出来
   *  2. 机制条的实线段右端与边界游标：把路径拉直后，边界正好扫过 (1 - offset) 位置
   *  3. 右下角读数：写出当前 stroke-dashoffset / dasharray 的值
   *
   * 参数：无
   * 返回值：void
   *
   * 注意事项：机制条的坐标用它自己的 viewBox（420×58），
   *          实线段从 DASH_X0 起、长度按 p 线性增长
   */
  const drive = useCallback(() => {
    const demo = demoRef.current;
    const path = pathRef.current;
    if (!demo || !path) return;
    const p = elProgressInView(demo);
    const offset = 1 - p;
    path.style.strokeDashoffset = String(offset);
    const end = (DASH_X0 + p * DASH_LEN).toFixed(1);
    if (solidRef.current) solidRef.current.setAttribute('x2', end);
    if (edgeRef.current) {
      edgeRef.current.setAttribute('x1', end);
      edgeRef.current.setAttribute('x2', end);
    }
    if (meterRef.current) {
      meterRef.current.textContent = `stroke-dashoffset: ${offset.toFixed(2)} · dasharray: 1`;
    }
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
        <div ref={demoRef} className="trace-tech-demo trace-demo-stroke">
          {/* 上半：结果 —— 曲线被一笔写出（滚动 = 画笔）。
              viewBox 紧贴笔画自身的外接框（约 276×192，比例 1.44），
              这样"meet"缩放下笔画能同时吃满上半区的高与大部分宽 */}
          <svg viewBox="52 12 276 192" className="trace-demo-line-svg" aria-hidden="true">
            <path
              ref={pathRef}
              pathLength={1}
              d="M64 196 C 60 116, 100 40, 184 30 C 268 20, 344 66, 316 130 C 292 184, 214 196, 158 150"
              fill="none"
              stroke="#2fbf9a"
              strokeWidth={5.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ strokeDasharray: 1, strokeDashoffset: 1 }}
            />
          </svg>
          {/* 下半：机制 —— 同一条路径拉直，"实线段 + 空白段"与 offset 边界 */}
          <div className="trace-dash-strip">
            <svg viewBox="0 0 420 58" className="trace-dash-strip-svg" aria-hidden="true">
              <text x={DASH_X0} y="12" className="trace-dash-lb">
                把路径拉直：实线段 = 还没画到的部分
              </text>
              {/* 整条轨道 = 路径全长（空白段） */}
              <line
                x1={DASH_X0}
                y1="30"
                x2={DASH_X0 + DASH_LEN}
                y2="30"
                stroke="rgba(155,190,180,.22)"
                strokeWidth={8}
              />
              {/* 实线段：右端随 offset 推进 */}
              <line ref={solidRef} x1={DASH_X0} y1="30" x2={DASH_X0} y2="30" stroke="#2fbf9a" strokeWidth={8} />
              {/* 边界游标 */}
              <line ref={edgeRef} x1={DASH_X0} y1="17" x2={DASH_X0} y2="43" stroke="#7dfade" strokeWidth={1} />
              <text x={DASH_X0} y="54" className="trace-dash-lb">0 起点</text>
              <text x={DASH_X0 + DASH_LEN} y="54" textAnchor="end" className="trace-dash-lb">1 终点</text>
            </svg>
          </div>
          <div className="trace-demo-meter">
            <span>随滚动 · 线条一笔写出</span>
            <span ref={meterRef} className="trace-demo-meter-v">
              stroke-dashoffset: 1.00 · dasharray: 1
            </span>
          </div>
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
 * 技法②小节 — 分层时间轴（真作品三层）
 *
 * 功能：演示分层作画结构：底层草稿 → 中层墨线 → 顶层成品三层叠放。
 *      三层画面全部取自原作素材——挂载时把 4.7MB 的 trace-body.svg 切成
 *      "草稿组（45 组 .trace-skb）"与"成品层（30 段 .trace-pg）"两段并栅格化成位图，
 *      墨线层就是成品的灰度上墨版（.62 + grayscale 滤镜，与原作 .trace-sketch 同语言）。
 *      滚动进度驱动快速交接：草稿 0.44 前满幅、墨线 0.30 起入 / 0.72 起出、
 *      成品 0.58 起入 / 0.72 满幅；入画层满幅之后出画层才开始退场，
 *      所以任一时刻叠合处都有一层是"实"的，纸面不透底、画面不发虚。
 *      底部时间轴条为三段色标（草稿 / 墨线 / 成品），随进度高亮当前阶段。
 *
 * 参数：无
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 位图只在挂载时栅格化一次（模块级缓存），滚动只改 opacity 与 data-phase，
 *    近 6000 条 path 的重绘成本被彻底移出滚动帧
 *  - 位图 objectURL 是页面作用域的，路由切换时随文档释放，不主动 revoke
 *    （否则 StrictMode 二次挂载会拿到失效 URL）
 */
function TechLayers() {
  const sectionRef = useRef<HTMLDivElement>(null);
  // 演示框本身：进度按它算（成品要在框还完全可见时就位）
  const demoRef = useRef<HTMLDivElement>(null);
  const sketchLayerRef = useRef<HTMLDivElement>(null);
  const inkLayerRef = useRef<HTMLDivElement>(null);
  const finalLayerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // 框内右下角读数（三层实时不透明度）
  const meterRef = useRef<HTMLSpanElement>(null);
  // 三层真作品位图（异步就绪；未就绪时先显示空白画纸）
  const [layers, setLayers] = useState<TraceLayerBitmaps | null>(null);

  /**
   * 载入三层位图：命中模块级缓存时立即返回，重复挂载不再解码 4.7MB 素材
   */
  useEffect(() => {
    let alive = true;
    loadTraceLayers()
      .then(res => {
        if (alive) setLayers(res);
      })
      .catch(err => console.error('[trace] 技法②图层栅格化失败', err));
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 滚动驱动三层快速交接 + 时间轴条阶段高亮
   *
   * 功能：把本节演示进度 p 映射为三层不透明度，并更新底部三段色标的当前阶段。
   *      交接窗口刻意收窄且"入画先满、出画后退"：墨线 0.44 满幅时草稿才开始退，
   *      成品 0.72 满幅时墨线才开始退，所以叠合处始终有一层满幅。
   *
   * 参数：无
   * 返回值：void
   *
   * 注意事项：只写 opacity 与 data-phase，不触碰位图与 SVG，滚动帧内无重绘
   */
  const drive = useCallback(() => {
    const demo = demoRef.current;
    if (!demo) return;
    const p = elProgressInView(demo);
    const ramp = (from: number, to: number) => Math.max(0, Math.min(1, (p - from) / (to - from)));
    const sketch = 1 - ramp(0.44, 0.56);
    const ink = ramp(0.3, 0.44) * (1 - ramp(0.72, 0.86));
    const art = ramp(0.58, 0.72);
    if (sketchLayerRef.current) sketchLayerRef.current.style.opacity = String(sketch);
    if (inkLayerRef.current) inkLayerRef.current.style.opacity = String(ink);
    if (finalLayerRef.current) finalLayerRef.current.style.opacity = String(art);
    if (barRef.current) {
      // 阶段切换取交接窗口的中点：入画层过半时才算"进入该阶段"
      barRef.current.dataset.phase = p < 0.37 ? '0' : p < 0.65 ? '1' : '2';
    }
    // 读数：三层的实时不透明度 —— 数字上就能看出"任一时刻总有一层是 1.00"
    if (meterRef.current) {
      meterRef.current.textContent = `草稿 ${sketch.toFixed(2)} · 墨线 ${ink.toFixed(2)} · 成品 ${art.toFixed(2)}`;
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
        <div ref={demoRef} className="trace-tech-demo trace-demo-stack">
          {/* 画纸 + 三层真作品位图：草稿（45 组描线）→ 墨线（灰度成品）→ 成品（30 段拼合） */}
          <div className="trace-demo-paper">
            <div ref={sketchLayerRef} className="trace-layer" style={{ opacity: 1 }}>
              {layers && <img src={layers.sketch} alt="" draggable={false} />}
            </div>
            <div ref={inkLayerRef} className="trace-layer" style={{ opacity: 0 }}>
              {layers && <img src={layers.ink} alt="" draggable={false} />}
            </div>
            <div ref={finalLayerRef} className="trace-layer" style={{ opacity: 0 }}>
              {layers && <img src={layers.art} alt="" draggable={false} />}
            </div>
          </div>
          {/* 读数：三层实时不透明度（数字上验证"任一时刻总有一层是 1.00"） */}
          <div className="trace-demo-meter trace-demo-meter--stack">
            <span>三层快速交接（滚动驱动）</span>
            <span ref={meterRef} className="trace-demo-meter-v">
              草稿 1.00 · 墨线 0.00 · 成品 0.00
            </span>
          </div>
          {/* 时间轴条：三段色标（草稿 / 墨线 / 成品），当前阶段随进度高亮 */}
          <div ref={barRef} className="trace-demo-layers-bar" data-phase="0">
            <span>草稿 · 45 组描线</span>
            <span>墨线 · 灰度底稿</span>
            <span>成品 · 30 段拼合</span>
          </div>
        </div>
        <div className="trace-tech-copy">
          <p>
            整段动画其实是<strong>三层画面在一条时间轴上接力</strong>：
            <em>草稿线</em>逐笔画出（0~3s）→ <em>草稿淡出、底稿浮现上墨</em>（2.8~4.4s）
            → <em>成品画</em>分段揭示（4.1s 起）。这里的画面就是原作那三层——
            草稿 45 组、上墨是成品的灰度版、成品 30 段拼合。滚轮即播放头，
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

/** 成品图资源路径（原作 trace-body.svg：1600×1095，含 30 段成品画与 45 组草稿线） */
const ART_SVG_URL = '/asset/trace/trace-body.svg';
/** 成品图坐标系尺寸：注入视图的 viewBox 与画布比例都取它 */
const ART_W = 1600;
const ART_H = 1095;
/** 原作揭示起点（ms）：第 i 段的延迟是 4100 + i*300、单段时长 550，
 *  末段正好在 T_REVEAL_END(13350) 收尾——循环沿用原始节奏，不另造时间轴 */
const REVEAL_START_MS = 4100;
/** 单段揭示时长（ms，原 keyframes 的 .55s）：分发时用它圈出"正在播"的那几段 */
const REVEAL_FRAG_MS = 550;
/** 循环里成品拼合后停留多久（ms），让观众看清"拼成的样子" */
const LOOP_HOLD_MS = 1400;
/** 循环回卷用时（ms）：把成品快速退回未揭示状态，衔接不硬切 */
const LOOP_REWIND_MS = 700;

/**
 * 技法③小节 — clip-path 分段揭示（原作真实 30 段）
 *
 * 功能：把原作成品图层（trace-body.svg 里的 #trace-art，30 段 .trace-pg）原样注入画布，
 *      并复用原作 CSS 的 wipe-r/wipe-l/wipe-d/dab 关键帧；画布独立自动循环播放：
 *      每段按自己的 --i 延迟（4100 + i*300ms）依次接力揭示 → 成品停留 → 快速回卷 → 再播。
 *      切分方式、揭示顺序、方向与缓动全部与原作一致，且不绑定滚轮——放着就一直演。
 *
 * 参数：无
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 原作这 30 段并不是均匀格子：每段自带一组路径，并在整幅画布上做定向 wipe / 圆心绽开，
 *    所以必须渲染真实图层，不能用"整图按格子裁切"来近似
 *  - 只注入 #trace-art 层（约 2.3MB），草稿线/墨线层与本节无关，省掉一半体积与一半 path
 */
function TechClipPath() {
  const sectionRef = useRef<HTMLDivElement>(null);
  // 真实成品层注入容器
  const artRef = useRef<HTMLDivElement>(null);
  // 30 段的 CSSAnimation + 各自延迟（原 keyframes，已 pause，由循环接管 currentTime）
  const animsRef = useRef<{ anim: CSSAnimation; delay: number }[]>([]);
  // 上一次分发的虚拟时间：用于"值没变就不写样式"与整批重写兜底
  const lastTRef = useRef(-1);
  // 循环播放头：t = 虚拟时间，phase = 阶段，left = 停留剩余，last = 上一帧时间戳
  const loopRef = useRef({
    t: REVEAL_START_MS,
    phase: 'play' as 'play' | 'hold' | 'rewind',
    left: 0,
    last: 0,
  });
  // 本节是否在视口内（IntersectionObserver 标记：绝不能每帧 getBoundingClientRect——
  // 那会强制整页布局，这一页有近 6000 条 SVG path，帧率会被拖到个位数）
  const visibleRef = useRef(true);
  // 框内右下角读数（第 i 段 / 方向 / 虚拟时间）
  const meterRef = useRef<HTMLSpanElement>(null);
  // 上一帧写过的读数：只有变化才落 DOM（值每 300ms 才变一次）
  const meterLabelRef = useRef('');

  /**
   * 视口可见性订阅：本节离开视口时暂停循环推进，回到视口内自动接着播
   *
   * 参数：无
   * 返回值：无（卸载时 disconnect）
   */
  useEffect(() => {
    const sec = sectionRef.current;
    if (!sec) return;
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) visibleRef.current = entry.isIntersecting;
    });
    io.observe(sec);
    return () => io.disconnect();
  }, []);

  /**
   * 注入真实成品图层并接管动画（挂载即开始，用户还在上面几幕时就完成）
   *
   * 功能：
   *  1. 取 trace-body.svg 文本，切出成品画层 <g id="trace-art">（30 段 .trace-pg）
   *  2. 包成独立 <svg viewBox="0 0 1600 1095"> 注入画布容器（30 段的重叠/切分关系原样保留）
   *  3. 挂 .trace-playing 让原作 CSS 把 wipe-r/wipe-l/wipe-d/dab 关键帧挂到各段上，
   *     再用 document.getAnimations() 收集这 30 段动画、统一 pause 并锁在揭示起点
   *
   * 参数：无
   * 返回值：无
   *
   * 异常：资源加载失败时静默降级——画布留深色底，不影响滚动
   *
   * 注意事项：
   *  - rAF 重试等待动画注册（2.3MB SVG 解析可能慢几帧），与主播放区同一套写法
   *  - 动画自创建即被锁在揭示起点，不会抢跑；之后完全由自动循环接管 currentTime
   *  - 捕获成功后立刻把 30 段重置到"未揭示"，让循环从干净状态起步
   */
  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    fetch(ART_SVG_URL)
      .then(r => r.text())
      .then(text => {
        if (stopped) return;
        const host = artRef.current;
        if (!host) return;
        // 只取成品画层：从 <g id="trace-art"> 一直切到文件末尾，去掉尾部 </svg>
        const start = text.indexOf('<g id="trace-art">');
        if (start < 0) return;
        const art = text.slice(start).replace(/<\/svg>[\s\S]*$/, '');
        host.innerHTML = `<svg viewBox="0 0 ${ART_W} ${ART_H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${art}</svg>`;
        host.classList.add('trace-playing');

        const tryCapture = () => {
          if (stopped) return;
          const anims = document
            .getAnimations()
            .filter(
              (a): a is CSSAnimation =>
                a instanceof CSSAnimation &&
                (a.effect as KeyframeEffect | null)?.target instanceof Element &&
                host.contains((a.effect as KeyframeEffect).target as Element)
            );
          // 只保留 30 段 .trace-pg 的动画：原作 CSS 里还有一条挂在 #trace-art 上的
          // settle（整体色彩沉降），它不是"段"——收进来会让段号与总数都算错
          const segs = anims.filter(a => {
            const el = (a.effect as KeyframeEffect | null)?.target;
            return el instanceof Element && el.classList.contains('trace-pg');
          });
          if (segs.length > 0) {
            // 统一暂停并锁到揭示起点；顺带缓存各段延迟，供分发时判断窗口
            animsRef.current = segs.map(a => {
              a.pause();
              a.currentTime = REVEAL_START_MS;
              const timing = a.effect?.getTiming?.();
              const delay = typeof timing?.delay === 'number' ? timing.delay : 0;
              return { anim: a, delay };
            });
            // 干净起步：从"未揭示"状态交给自动循环
            applyT(REVEAL_START_MS, true);
            return;
          }
          attempt += 1;
          if (attempt < 120) requestAnimationFrame(tryCapture);
        };
        requestAnimationFrame(tryCapture);
      })
      .catch(() => {
        /* 静默降级：画布留深色底 */
      });
    return () => {
      stopped = true;
    };
  }, []);

  /**
   * 把显示时间写进各段动画
   *
   * 功能：把虚拟时间 t 分发到 30 段动画的 currentTime，并做两处节流：
   *      - t 与上次相同 → 不写样式
   *      - 只写"处在揭示窗口内"的段（约 4 段/帧），窗口外的段已停在 0%/100% 两端，
   *        目的是把每帧的重绘范围限制在真正变化的那几段上
   *
   * 参数：
   *  - t     {number}  虚拟时间（ms）
   *  - force {boolean} 是否强制整批重写（循环首尾用它把状态钉准，默认 false）
   * 返回值：无
   *
   * 注意事项：快速推进时某段的最后一次写入可能落在 wipe 中段，循环首尾一律走 force，
   *          避免窗口外的段残留半揭示状态
   */
  const applyT = useCallback((t: number, force = false) => {
    const list = animsRef.current;
    if (!list.length) return;
    const last = lastTRef.current;
    if (!force && t === last) return;
    const burst = force || last < 0;
    lastTRef.current = t;
    for (const item of list) {
      if (!burst && (t < item.delay || t > item.delay + REVEAL_FRAG_MS)) continue;
      item.anim.currentTime = t;
    }
  }, []);

  /**
   * 自动循环播放（不绑定滚轮）
   *
   * 功能：挂载即启动独立帧循环——沿原作时间轴正向揭示一遍（4.1s~13.35s）→
   *      成品停留 LOOP_HOLD_MS → 用 LOOP_REWIND_MS 快速回卷到未揭示状态 → 再重来。
   *      本节完全离开视口时暂停推进（不写样式、不重绘），回到视口内自动接着播。
   *
   * 参数：无
   * 返回值：无（卸载时取消帧循环）
   *
   * 注意事项：
   *  - 每帧 dt 上限 50ms，避免后台标签页切回时大步跳变
   *  - 每帧都走 applyT，因此窗口节流与重绘范围控制照旧生效
   *  - 循环首尾用 applyT(..., true) 强制整批重写，把状态钉准
   */
  useEffect(() => {
    let raf = 0;
    const st = loopRef.current;
    st.last = performance.now();
    const frame = () => {
      const now = performance.now();
      const dt = Math.min(50, Math.max(now - st.last, 1));
      st.last = now;
      if (animsRef.current.length && visibleRef.current) {
        if (st.phase === 'play') {
          st.t += dt;
          if (st.t >= T_REVEAL_END) {
            st.t = T_REVEAL_END;
            st.phase = 'hold';
            st.left = LOOP_HOLD_MS;
            // 钉准成品状态：快速推进时每段最后一次写入可能落在 wipe 中段
            applyT(st.t, true);
          }
        } else if (st.phase === 'hold') {
          st.left -= dt;
          if (st.left <= 0) st.phase = 'rewind';
        } else {
          st.t -= dt * ((T_REVEAL_END - REVEAL_START_MS) / LOOP_REWIND_MS);
          if (st.t <= REVEAL_START_MS) {
            st.t = REVEAL_START_MS;
            st.phase = 'play';
            // 回卷结束同样强制重写：否则"没来得及回退"的段会残留半揭示状态
            applyT(st.t, true);
          }
        }
        applyT(st.t);
        // 读数：正在揭示的是第几段、什么方向、虚拟时间走到哪（每 300ms 才变一次）
        const list = animsRef.current;
        if (meterRef.current && list.length) {
          let label: string;
          if (st.phase === 'hold') {
            label = `${list.length} / ${list.length} 段拼合完成 · 停留 · ${(T_REVEAL_END / 1000).toFixed(2)}s`;
          } else if (st.phase === 'rewind') {
            label = `回卷 → 重播 · ${(st.t / 1000).toFixed(2)}s`;
          } else {
            // 第 k 段的延迟是 4.1s + k×0.3s，所以按 300ms 折算当前段号
            const k = Math.max(0, Math.min(list.length - 1, Math.floor((st.t - REVEAL_START_MS) / (PAINT_STEP * 1000))));
            const target = (list[k].anim.effect as KeyframeEffect | null)?.target ?? null;
            const dir = DIR_META.find(m => target?.classList.contains(m.cls));
            label = `第 ${k + 1} / ${list.length} 段 · ${dir ? dir.zh : '揭示'} · ${(st.t / 1000).toFixed(2)}s`;
          }
          if (meterLabelRef.current !== label) {
            meterLabelRef.current = label;
            meterRef.current.textContent = label;
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [applyT]);

  return (
    <div ref={sectionRef} className="trace-tech trace-tech--free">
      {/* 出血海报数字（自由构图：数字沉到右下出血） */}
      <span className="trace-bleed-num" aria-hidden>03</span>
      <div className="trace-tech-head">
        <span className="trace-tech-idx">03</span>
        <h3>技法三 · clip-path 分段揭示</h3>
        <span className="trace-tech-tag">REVEAL PHASE</span>
      </div>
      <div className="trace-tech-body">
        <div className="trace-tech-demo">
          <div className="trace-art-canvas">
            {/* 真实成品层注入点：30 段 .trace-pg 由原作 CSS 关键帧驱动 */}
            <div ref={artRef} className="trace-art-layer" />
            {/* 方向图例：四种片段类型各一枚 chip，压在画布右下角（不遮主体构图） */}
            <div className="trace-art-legend">
              <span>wipe-r · 右扫</span>
              <span>wipe-l · 左扫</span>
              <span>wipe-d · 下扫</span>
              <span>dab · 点染</span>
            </div>
          </div>
          <div className="trace-demo-meter">
            <span>30 段 · 按 --i 顺序接力（自动循环）</span>
            <span ref={meterRef} className="trace-demo-meter-v">等待起笔</span>
          </div>
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
  0%   { opacity:0;
         clip-path:circle(0% at 50% 50%); }
  35%  { opacity:1; }
  100% { opacity:1;
         clip-path:circle(120% at 50% 50%); }
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}

/**
 * 时间（s）→ 迷你时间轴带的百分比位置
 *
 * 参数：
 *  - t {number} 时间（秒，0~14.65）
 * 返回值：string CSS 百分比（如 "28.000%"）
 */
function miniPct(t: number): string {
  return `${((t / ACT_TOTAL) * 100).toFixed(3)}%`;
}

/**
 * 代码对照区 — 核心逻辑总览（右侧五行桥接 + 左侧全真的示例播放器）
 *
 * 功能：把滚动驱动的最小实现（本页用的 WAAPI 接管）以代码画廊形式展示，关键行高亮；
 *      左侧配一个"同款桥接"的**全真**示例播放器做对照，两栏同步走同一个虚拟时间 t：
 *      - 舞台里注入的是整份 trace-body.svg（45 组逐笔草稿 + 30 段 wipe/dab 定向揭示），
 *        与幕 2 同一份资源、同一套 keyframes —— 不是三阶段近似
 *      - 默认自动循环：14.65s 演完 → 停留 → 快速回卷 → 再来；按住滑块即接管成手动推拉
 *      - 下方横向时间轴带：45 格打稿 + 上墨段 + 30 格上色（真实方向色）+ 定格段 + 播放头
 *
 * 参数：无
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 4.8MB 的 SVG 用 requestIdleCallback 注入（不拖首屏、不抢滚动）；
 *    注入时把 id 改名，避免与页面上另外两份副本撞 id
 *  - 动画数量约 5.9k 条（每条草稿路径一条），所以 currentTime 写入按
 *    clamp(t, 延迟, 延迟+时长) 只写"状态真的变了"的那些，并带每帧写入上限
 *  - 帧循环只在模块进入视口时推进；离屏或处于接管状态时不动
 */
function CodeGallery() {
  const sectionRef = useRef<HTMLElement>(null);
  // 迷你播放器的根（WAAPI 只抓它内部的动画）
  const rootRef = useRef<HTMLDivElement>(null);
  // 真动画层（整份 trace-body.svg）的注入容器
  const artHostRef = useRef<HTMLDivElement>(null);
  // 滑块（既是手动输入，也是自动播放时的进度显示）
  const rangeRef = useRef<HTMLInputElement>(null);
  // 读数：p = 0.37 → currentTime = 5420ms
  const readoutRef = useRef<HTMLSpanElement>(null);
  // 时间轴带上的播放头
  const headRef = useRef<HTMLSpanElement>(null);
  // 已接管的 CSSAnimation（含各自的延迟与时长，供窗口判断；last 记录上次写入值）
  const animsRef = useRef<{ anim: CSSAnimation; delay: number; frag: number; last: number }[]>([]);
  // 还要扫描多少帧来接管"新出现的"动画（挂载后与 SVG 注入后各扫一阵，不做长期每帧扫描）
  const pendingCaptureRef = useRef(40);
  // 循环状态机：t=虚拟时间，phase=阶段，left=停留剩余，last=上一帧，mode=自动/被接管
  const miniRef = useRef({
    t: 0,
    phase: 'play' as 'play' | 'hold' | 'rewind',
    left: 0,
    last: 0,
    mode: 'auto' as 'auto' | 'drag',
    visible: false,
  });
  // 真 SVG 是否已注入（未就绪时舞台留白 + 提示）
  const [ready, setReady] = useState(false);
  // 30 段真实方向序列（从自己注入的 DOM 里读出，给下方时间轴带着色）
  const [dirs, setDirs] = useState<string[] | null>(null);

  /**
   * 空闲注入整份原作 SVG（45 组草稿 + 30 段成品，约 4.8MB）
   *
   * 功能：把 trace-body.svg 原样注入迷你舞台 —— 与幕 2 同一份资源、同一套 keyframes，
   *      所以这里的 45 组逐笔描线与 30 段 wipe/dab 定向揭示都是真动画，不是三阶段近似；
   *      注入时把 id="trace-art" / href="#trace-art" 改名，避免与页面上另外两份副本撞 id。
   *
   * 参数：无
   * 返回值：无（异步：完成后置 ready，并读出 30 段的真实方向）
   *
   * 异常：请求或解析失败时静默降级（舞台留白，下方时间轴带照常演）
   *
   * 注意事项：用 requestIdleCallback 注入，不拖首屏也不与滚动抢主线程（无该 API 时退回延时）
   */
  useEffect(() => {
    let stopped = false;
    const host = artHostRef.current;
    if (!host) return;
    const inject = () => {
      if (stopped) return;
      fetch(ART_SVG_URL)
        .then(r => r.text())
        .then(text => {
          if (stopped) return;
          host.innerHTML = text
            .replace(/id="trace-art"/g, 'id="trace-art-mini"')
            .replace(/href="#trace-art"/g, 'href="#trace-art-mini"');
          const groups = host.querySelectorAll('g.trace-pg');
          setDirs(
            Array.from(groups).map(
              g => (DIR_META.find(m => g.classList.contains(m.cls)) ?? DIR_META[0]).key
            )
          );
          setReady(true);
          // 注入后多扫几帧，把新注册的 5.9k 条动画一起接上
          pendingCaptureRef.current = Math.max(pendingCaptureRef.current, 40);
        })
        .catch(err => console.error('[trace] 示例播放器注入失败', err));
    };
    const idleWin = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof idleWin.requestIdleCallback === 'function') {
      idleWin.requestIdleCallback(inject, { timeout: 4000 });
    } else {
      window.setTimeout(inject, 1200);
    }
    return () => {
      stopped = true;
    };
  }, []);

  /**
   * 把虚拟时间分发到迷你舞台 + 读数 + 播放头
   *
   * 功能：这一帧要做的事，就是右边第 3 行代码：把 t 写进全部动画的 currentTime，
   *      顺带把读数（p 与 ms）、滑块位置/填充、时间轴带播放头同步到同一个 t。
   *
   * 参数：
   *  - t {number} 虚拟时间（ms，0~14650）
   * 返回值：void
   *
   * 注意事项：接管状态下不回写滑块 value（否则会和用户的手抢位置）
   */
  const apply = useCallback((t: number) => {
    const list = animsRef.current;
    // 每帧最多写这么多条：拖动/回卷造成的大跳变会让大量动画需要"补写状态"，
    // 分摊到相邻几帧完成，避免单帧长任务
    let budget = 3000;
    for (const item of list) {
      // 一条动画的观感只取决于 clamp(t, 延迟, 延迟+时长)：
      // 未开始 → 写 0（before 相位，forwards 填充不生效；写延迟点会强制 from 帧
      // 生效，ink 的 from{opacity:.38} 曾让底稿在循环起点就可见），中间 → 写 t，
      // 已结束 → 写收尾点。这样跳变后不会留下"该结束却停在半途"的残影。
      const target =
        t < item.delay ? 0 : t >= item.delay + item.frag ? item.delay + item.frag : t;
      if (item.last === target) continue;
      if (budget-- <= 0) break;
      item.last = target;
      item.anim.currentTime = target;
    }
    const p = t / ACT_MS;
    if (readoutRef.current) {
      readoutRef.current.textContent = `p = ${p.toFixed(2)} → currentTime = ${Math.round(t)}ms`;
    }
    if (rangeRef.current) {
      if (miniRef.current.mode === 'auto') rangeRef.current.value = String(Math.round(t));
      rangeRef.current.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
    }
    if (headRef.current) headRef.current.style.left = `${(p * 100).toFixed(2)}%`;
  }, []);

  /** 视口可见性：离屏时不推进时间（与页面其它 demo 同一套省电约定） */
  useEffect(() => {
    const sec = sectionRef.current;
    if (!sec) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) miniRef.current.visible = e.isIntersecting;
    });
    io.observe(sec);
    return () => io.disconnect();
  }, []);

  /**
   * 接管迷你舞台内的全部 CSS 动画（幂等，可自愈）
   *
   * 功能：抓取该容器内的 CSSAnimation，统一 pause 并把 currentTime 锁到当前虚拟时间，
   *      之后完全由循环/滑块驱动。
   *
   * 参数：无
   * 返回值：void
   *
   * 注意事项：CSS 层已把 mini 动画置为 animation-play-state: paused（自创建即静止），
   *          所以即使接管晚了几帧也不会"抢跑"；放在帧循环里反复调用是为了自愈
   *          （首次样式重算、HMR 重建动画等情况都能被下一次调用接上）
   */
  const captureMini = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const known = new Set(animsRef.current.map(i => i.anim));
    const st = miniRef.current;
    let added = 0;
    for (const a of document.getAnimations()) {
      if (!(a instanceof CSSAnimation)) continue;
      const target = (a.effect as KeyframeEffect | null)?.target;
      if (!(target instanceof Element) || !root.contains(target)) continue;
      if (known.has(a)) continue;
      // 顺带把延迟与时长记下来（窗口判断与"跳变补写"都用它）
      const timing = (a.effect as KeyframeEffect | null)?.getComputedTiming?.();
      a.pause();
      a.currentTime = st.t;
      animsRef.current.push({
        anim: a,
        delay: typeof timing?.delay === 'number' ? timing.delay : 0,
        frag: typeof timing?.duration === 'number' ? timing.duration : 0,
        last: Number.NaN,
      });
      added += 1;
    }
    // 这一轮有新增（通常是 4.8MB SVG 刚注入）就再多扫几帧，避免漏掉后注册的动画
    if (added > 0) pendingCaptureRef.current = Math.max(pendingCaptureRef.current, 3);
  }, []);

  /**
   * 挂 class 让迷你舞台的 CSS 动画自创建（真正的接管在帧循环里由 captureMini 完成）
   */
  useEffect(() => {
    rootRef.current?.classList.add('trace-mini-playing');
  }, []);

  /**
   * 自动循环（不绑滚轮）：正向演完 14.65s → 停留 → 快速回卷 → 再来
   *
   * 功能：每一帧按 dt 推进虚拟时间并按阶段流转，再交给 apply 分发；
   *      被滑块接管（mode = 'drag'）或模块离屏时这一帧不推进。
   *      动画还没接管上时（首帧样式重算/重建）先尝试接管，接上再推进。
   *
   * 参数：无
   * 返回值：无（卸载时取消帧循环）
   *
   * 注意事项：dt 上限 50ms，避免后台标签页切回时大步跳变
   */
  useEffect(() => {
    let raf = 0;
    const st = miniRef.current;
    st.last = performance.now();
    const frame = () => {
      const now = performance.now();
      const dt = Math.min(50, Math.max(now - st.last, 1));
      st.last = now;
      if (pendingCaptureRef.current > 0) {
        pendingCaptureRef.current -= 1;
        captureMini();
      }
      if (animsRef.current.length && st.visible && st.mode === 'auto') {
        if (st.phase === 'play') {
          st.t += dt;
          if (st.t >= ACT_MS) {
            st.t = ACT_MS;
            st.phase = 'hold';
            st.left = LOOP_HOLD_MS;
          }
        } else if (st.phase === 'hold') {
          st.left -= dt;
          if (st.left <= 0) st.phase = 'rewind';
        } else {
          st.t -= dt * (ACT_MS / LOOP_REWIND_MS);
          if (st.t <= 0) {
            st.t = 0;
            st.phase = 'play';
          }
        }
        apply(st.t);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [apply, captureMini]);

  /** 滑块按下即接管（暂停自动推进），拖动写 t；松手/失焦交还自动 */
  const onRangeDown = useCallback(() => {
    miniRef.current.mode = 'drag';
  }, []);
  const onRangeInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const st = miniRef.current;
      st.mode = 'drag';
      st.t = Number(e.currentTarget.value);
      apply(st.t);
    },
    [apply]
  );
  const onRangeRelease = useCallback(() => {
    const st = miniRef.current;
    st.mode = 'auto';
    st.phase = 'play';
    st.last = performance.now();
  }, []);

  return (
    <section ref={sectionRef} className="trace-act trace-act--code">
      <header className="trace-explain-header">
        <span className="trace-kicker">UNDER THE HOOD</span>
        <h2 className="trace-explain-title">滚动驱动 · 最小实现</h2>
        <p className="trace-explain-sub">
          本页把 14.65 秒的 CSS 动画时间轴直接交给滚轮——桥接只有五行
        </p>
      </header>

      {/* 示例：左侧播放器用的就是右边这几行桥接（自动循环，按住滑块可接管） */}
      <div ref={rootRef} className="trace-mini">
        <div className="trace-mini-bar">
          <span>示例 · 拖动即接管</span>
          <span ref={readoutRef} className="trace-mini-t">p = 0.00 → currentTime = 0ms</span>
        </div>
        <div className="trace-mini-body">
          {/* 舞台：整份原作 SVG（45 组逐笔草稿 + 30 段 wipe/dab 定向揭示），由下方同一套桥接驱动 */}
          <div className="trace-mini-stage">
            <div ref={artHostRef} className="trace-mini-art trace-playing" />
            {!ready && <span className="trace-mini-wait">正在解析原作 4.8MB SVG…</span>}
          </div>
          {/* 横向时间轴带：45 格打稿（.2s + i×.05s）+ 上墨段 + 30 格上色（4.1s + i×0.3s）+ 定格段 */}
          <div className="trace-mini-axis" aria-hidden="true">
            {Array.from({ length: SKETCH_BATCHES }, (_, i) => (
              <span
                key={`s${i}`}
                className="trace-mini-cell trace-mini-cell--sketch"
                style={{
                  left: miniPct(SKETCH_T0 + i * SKETCH_STEP),
                  width: miniPct(SKETCH_FRAG),
                  ['--i' as string]: i,
                }}
              />
            ))}
            <span
              className="trace-mini-seg trace-mini-seg--ink"
              style={{
                left: miniPct(TONE_AT),
                width: miniPct(PAINT_T0 - TONE_AT),
              }}
            />
            {Array.from({ length: ART_LAYERS }, (_, i) => (
              <span
                key={`p${i}`}
                className={`trace-mini-cell trace-mini-cell--art d-${dirs ? dirs[i] : DIR_META[i % DIR_META.length].key}`}
                style={{
                  left: miniPct(PAINT_T0 + i * PAINT_STEP),
                  width: miniPct(PAINT_FRAG),
                  ['--i' as string]: i,
                }}
              />
            ))}
            <span
              className="trace-mini-seg trace-mini-seg--settle"
              style={{
                left: miniPct(ACT_END),
                width: miniPct(ACT_TOTAL - ACT_END),
              }}
            />
            <span ref={headRef} className="trace-mini-head" />
          </div>
        </div>
        <input
          ref={rangeRef}
          type="range"
          className="trace-mini-range"
          min={0}
          max={ACT_MS}
          step={10}
          defaultValue={0}
          aria-label="拖动接管时间轴（松手恢复自动循环）"
          onPointerDown={onRangeDown}
          onPointerUp={onRangeRelease}
          onPointerCancel={onRangeRelease}
          onInput={onRangeInput}
          onBlur={onRangeRelease}
        />
      </div>

      <pre className="trace-code trace-code--big">
{`/* 1. 挂 class 启动全部 CSS 动画（原作品 keyframes 一行未改） */
root.classList.add('trace-playing');

/* 2. 抓取画布内全部 CSSAnimation，统一接管 */
const anims = document.getAnimations()
  .filter(a => a instanceof CSSAnimation
    && root.contains(a.effect.target));
anims.forEach(a => { a.pause(); a.currentTime = 0; });

/* 3. 滚动进度 → 动画时间（含 animation-delay 语义） */
const p = clamp(滚动距离 / 可滚距离, 0, 1);
anims.forEach(a => a.currentTime = p * 14650);   // 14.65s = 整条轴`}
      </pre>
    </section>
  );
}