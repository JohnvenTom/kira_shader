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
    fetch(ART_SVG_URL)
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
          - 主播放区与技法③画布（.trace-art-layer）都把动画锁在 paused：
            动画自创建即静止，进度完全由 JS 的 currentTime 驱动
            （杜绝"自动播完停在成品"的时序缺陷） */}
      <style>{`${TRACE_ANIM_CSS}\n.trace-frame{width:min(760px,90vw)}\n.trace-stage-inner.trace-playing *{animation-play-state:paused!important}\n.trace-art-layer.trace-playing *{animation-play-state:paused!important}\n`}</style>

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
  const sketchLayerRef = useRef<HTMLDivElement>(null);
  const inkLayerRef = useRef<HTMLDivElement>(null);
  const finalLayerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
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
    const sec = sectionRef.current;
    if (!sec) return;
    const p = elProgress(sec, 0.7);
    const ramp = (from: number, to: number) => Math.max(0, Math.min(1, (p - from) / (to - from)));
    if (sketchLayerRef.current) {
      sketchLayerRef.current.style.opacity = String(1 - ramp(0.44, 0.56));
    }
    if (inkLayerRef.current) {
      inkLayerRef.current.style.opacity = String(ramp(0.3, 0.44) * (1 - ramp(0.72, 0.86)));
    }
    if (finalLayerRef.current) {
      finalLayerRef.current.style.opacity = String(ramp(0.58, 0.72));
    }
    if (barRef.current) {
      // 阶段切换取交接窗口的中点：入画层过半时才算"进入该阶段"
      barRef.current.dataset.phase = p < 0.37 ? '0' : p < 0.65 ? '1' : '2';
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
          if (anims.length > 0) {
            // 统一暂停并锁到揭示起点；顺带缓存各段延迟，供分发时判断窗口
            animsRef.current = anims.map(a => {
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
          <span className="trace-demo-note">30 段 · 按 --i 顺序逐段接力</span>
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