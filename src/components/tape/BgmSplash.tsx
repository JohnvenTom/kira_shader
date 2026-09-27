/**
 * BgmSplash —— 开屏 BGM 引导层（浏览器自动播放策略的手势解锁页）
 *
 * 功能：
 *  - 整页加载时（BGM 尚未播放）全屏覆盖：一只纯 SVG 磁带以缓动跟手浮动
 *    （带速度倾斜 + 呼吸漂浮），中央提示"点击任意处"——这一下点击就是
 *    浏览器要求的用户手势，tapeAudio.play() 由此解锁 BGM
 *  - 点击后：磁带 FLIP 飞向右下角音乐盒（量 .music-dock-bar 的矩形，
 *    缩放平移落位），背景与文案淡出，音乐盒的轮毂开始转（音乐已播）
 *  - 卸载即结束：本组件不占路由状态，刷新后重新出现（音频策略随刷新重置，
 *    引导页的意义就是每次都把这次手势收集到）
 *
 * 参数：无
 *
 * 返回值：React.ReactElement | null（收场后返回 null）
 *
 * 异常：无（音乐盒元素缺失、减少动效等一律退化为直接淡出）
 *
 * 注意事项：
 *  - 只出现一次：完成引导（点击播放或跳过）即写 localStorage 持久标记，
 *    之后刷新、再访问都直接不挂载；清站点数据才会再看一次
 *  - 点击就是 tapeAudio.play() 的手势：store 的 onFirstGesture 也会在这次
 *    pointerdown 上兜底，双路起播互不冲突（userTouched 守卫）
 *  - prefers-reduced-motion：不做跟手与 FLIP，退化为直接淡入淡出
 *  - z-index 75：压过详情覆盖层（z-60）与音乐盒（z-55），底下是什么不重要——
 *    反正必须先点这一下
 */
import { useEffect, useRef, useState } from 'react';
import { tapeAudio } from './tapeAudioStore';
import { reduceMotion } from './tapeTransition';
import './bgmSplash.css';

/** 磁带 SVG 的逻辑尺寸（与 CSS 里的宽高一致） */
const TAPE_W = 168;
const TAPE_H = 104;
/** 跟手缓动系数与倾斜幅度 */
const FOLLOW = 0.09;
const TILT = 0.06;
/** "已完成引导"的持久标记键：写过就永不出现（除非清站点数据） */
const DONE_KEY = 'ohmtape.splash.done';

export function BgmSplash() {
  /** 完成过引导（点过播放或跳过）就写持久标记：之后刷新、再访问都不再出现。
      gone 用标记同步初始化——老用户挂载瞬间就是 null，连一帧都不闪 */
  const [gone, setGone] = useState(() => {
    try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return false; }
  });
  /** 是否已进入收场（背景淡出 + 磁带飞行） */
  const [leaving, setLeaving] = useState(false);
  const tapeRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** 跟手状态（rAF 每帧读写，走 ref 不走 state）；初值在屏幕中心偏上——
      触屏/未动鼠标时磁带先在那里呼吸漂浮，动起来才开始追 */
  const pos = useRef({ x: window.innerWidth / 2, y: window.innerHeight * 0.42, seen: true });
  const target = useRef({ x: 0, y: 0 });
  const startedRef = useRef(false);

  /** 写"已完成引导"的持久标记（存储不可用只是每次刷新会再看一次，无碍） */
  const markDone = () => {
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* 存储不可用 */ }
  };

  useEffect(() => {
    /* 极少见：标记丢了但 BGM 自己响起来了（浏览器允许无手势播放）——
       本层没有存在的意义，直接淡出写标记收场 */
    const unsub = tapeAudio.subscribe((s) => {
      if (s.playing) dismiss(false);
    });

    const reduce = reduceMotion();
    /* 指针移动只记目标点；真正的缓动在 rAF 里做 */
    const onMove = (e: PointerEvent) => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
      if (!pos.current.seen) {
        pos.current.x = e.clientX;
        pos.current.y = e.clientY;
        pos.current.seen = true;
      }
    };

    let raf = 0;
    const tick = (t: number) => {
      const cur = pos.current;
      if (cur.seen && tapeRef.current) {
        cur.x += (target.current.x - cur.x) * FOLLOW;
        cur.y += (target.current.y - cur.y) * FOLLOW;
        /* 速度即倾斜：往哪边追，磁带就往哪边微微低头 */
        const tilt = Math.max(-10, Math.min(10, (target.current.x - cur.x) * TILT));
        const float = Math.sin(t * 0.0016) * 4;   // 呼吸漂浮：磁带不是死贴着鼠标
        tapeRef.current.style.transform =
          `translate(${cur.x - TAPE_W / 2}px, ${cur.y - TAPE_H / 2 + float}px) rotate(${tilt}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    if (!reduce) {
      window.addEventListener('pointermove', onMove, { passive: true });
      raf = requestAnimationFrame(tick);
    }

    /* 用户按 Esc / hash 被外部改动等罕见路径：收场但不播音乐（交给续播钩子） */
    const onHash = () => dismiss(false);
    window.addEventListener('hashchange', onHash);

    return () => {
      unsub();
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('hashchange', onHash);
    };
    // dismiss 在挂载后保持稳定（见下），不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 收场：播放起播 + 磁带 FLIP 飞向音乐盒
   *
   * 功能：onClick 入口——第一次调用时起播 BGM（这一下 pointerdown 就是手势），
   *      然后量音乐盒 bar 的矩形，把磁带从当前位置缩放平移过去，背景淡出；
   *      动画结束卸载本层。reduce-motion / 音乐盒缺失时退化为直接淡出。
   *
   * 参数：
   *  - withMusic {boolean} 是否顺带起播（点击路径 true；竞态/hash 路径 false）
   * 返回值：void
   * 异常：无
   */
  const dismiss = (withMusic: boolean) => {
    if (startedRef.current) return;           // 收场只走一次
    startedRef.current = true;
    markDone();
    if (withMusic) tapeAudio.play();          // 这一下手势解锁 BGM（rejection 已吞）
    setLeaving(true);

    const tape = tapeRef.current;
    const dock = document.querySelector('.music-dock-bar')?.getBoundingClientRect();
    const reduce = reduceMotion();
    if (!tape || !dock || reduce) {
      /* 退化路径：整层淡出即可 */
      window.setTimeout(() => setGone(true), 420);
      return;
    }
    /* FLIP：磁带当前中心 → 音乐盒 bar 中心，尺寸缩到 bar 高度比例
       （磁带元素定位在 left:0/top:0，transform 就是绝对视口坐标） */
    tape.style.transition = 'transform 0.55s cubic-bezier(.4, 0, .2, 1), opacity 0.42s ease 0.28s';
    tape.style.transform =
      `translate(${dock.left + dock.width / 2 - TAPE_W / 2}px, ${dock.top + dock.height / 2 - TAPE_H / 2}px) rotate(0deg) scale(${Math.max(0.12, dock.height / TAPE_H)})`;
    tape.style.opacity = '0';
    window.setTimeout(() => setGone(true), 640);
  };

  /**
   * 暂不播放：用户明确拒绝——不起播、直接整层淡出
   *
   * 功能：suppressAutoplay 置 userTouched（否则这一次点击作为手势，会被
   *      onFirstGesture 续播钩子当成"用户想听"，违背"不强制"的选择）；
   *      收场走退化路径直接淡出——音乐没响，磁带没有飞向音乐盒的理由。
   *
   * 参数：无
   * 返回值：void
   * 异常：无
   */
  const skipOut = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    markDone();
    tapeAudio.suppressAutoplay();
    setLeaving(true);
    window.setTimeout(() => setGone(true), 420);
  };

  if (gone) return null;

  return (
    <div
      ref={rootRef}
      className={`bgm-splash${leaving ? ' is-leaving' : ''}`}
      onPointerDown={() => dismiss(true)}
      role="button"
      aria-label="点击任意处开始播放背景音乐"
    >
      <div className="bgm-splash-center">
        <p className="bgm-splash-kicker">BGM · TAPE DECK</p>
        <h1 className="bgm-splash-title">
          点击<em>任意处</em>
        </h1>
        <p className="bgm-splash-sub">CLICK ANYWHERE — THE TAPE STARTS BY ITSELF</p>
        <button
          type="button"
          className="bgm-splash-skip"
          onPointerDown={(e) => { e.stopPropagation(); skipOut(); }}
          aria-label="暂不播放背景音乐"
        >
          暂不播放 · SKIP
        </button>
      </div>

      {/* 跟手磁带：纯 SVG 组合（外壳 / 标签 / 带窗 / 双带轮 / 传动轮 / 螺丝） */}
      <div className="bgm-splash-tape" ref={tapeRef} aria-hidden="true">
        <svg viewBox="0 0 168 104" width={TAPE_W} height={TAPE_H}>
          {/* 外壳 */}
          <rect x="2" y="2" width="164" height="100" rx="7" fill="rgba(22, 20, 17, 0.92)" stroke="#d0783a" strokeWidth="1.5" />
          <rect x="8" y="8" width="152" height="88" rx="4" fill="none" stroke="rgba(252, 249, 243, 0.12)" strokeWidth="1" />
          {/* 标签纸 */}
          <rect x="16" y="14" width="136" height="46" rx="3" fill="rgba(252, 249, 243, 0.93)" />
          <text x="26" y="30" fontSize="9" letterSpacing="2.5" fill="#a3542a" fontFamily="var(--font-mono, monospace)">SIDE A · BGM</text>
          <line x1="26" y1="36" x2="142" y2="36" stroke="rgba(22, 24, 28, 0.28)" strokeWidth="1" />
          <text x="26" y="50" fontSize="8" letterSpacing="1.5" fill="#52564f" fontFamily="var(--font-mono, monospace)">POSITIVE — JAMBACK</text>
          {/* 带窗 */}
          <rect x="30" y="42" width="108" height="16" rx="8" fill="#12100e" />
          {/* 双带轮 + 辐条（跟手时像在倒带） */}
          <g className="bgm-splash-reel" style={{ transformOrigin: '52px 50px' }}>
            <circle cx="52" cy="50" r="9" fill="#1c1a17" stroke="#d0783a" strokeWidth="1.4" />
            <path d="M52 43v14M45 50h14M47.4 45.4l9.2 9.2M56.6 45.4l-9.2 9.2" stroke="rgba(208, 120, 58, 0.7)" strokeWidth="1.1" />
          </g>
          <g className="bgm-splash-reel bgm-splash-reel--b" style={{ transformOrigin: '116px 50px' }}>
            <circle cx="116" cy="50" r="9" fill="#1c1a17" stroke="#d0783a" strokeWidth="1.4" />
            <path d="M116 43v14M109 50h14M111.4 45.4l9.2 9.2M120.6 45.4l-9.2 9.2" stroke="rgba(208, 120, 58, 0.7)" strokeWidth="1.1" />
          </g>
          {/* 传动轮 */}
          <circle cx="84" cy="50" r="4.5" fill="none" stroke="rgba(252, 249, 243, 0.35)" strokeWidth="1.2" />
          {/* 底部刻线与螺丝 */}
          <line x1="16" y1="72" x2="152" y2="72" stroke="rgba(252, 249, 243, 0.14)" strokeWidth="1" />
          <text x="84" y="84" textAnchor="middle" fontSize="7" letterSpacing="3" fill="rgba(252, 249, 243, 0.4)" fontFamily="var(--font-mono, monospace)">CLICK TO PLAY</text>
          <circle cx="12" cy="12" r="1.6" fill="rgba(252, 249, 243, 0.3)" />
          <circle cx="156" cy="12" r="1.6" fill="rgba(252, 249, 243, 0.3)" />
          <circle cx="12" cy="92" r="1.6" fill="rgba(252, 249, 243, 0.3)" />
          <circle cx="156" cy="92" r="1.6" fill="rgba(252, 249, 243, 0.3)" />
        </svg>
      </div>

      {/* 底部提示（不跟手，固定在下方给"点哪里"一个兜底语义） */}
      <p className="bgm-splash-foot">VOLUME VIA THE MUSIC BOX · SCROLL WHEN HOVERING</p>
    </div>
  );
}
