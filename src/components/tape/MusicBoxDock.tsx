/**
 * MusicBoxDock —— 右下角的音乐盒角标（全站常驻，跨页续播的真播放器）
 *
 * 功能：
 *  - 常驻右下角的一枚磁带图标：点它打开磁带机整页（#tape）；播放时图标里的两只轮毂跟着转
 *  - 悬停浮出信息层：曲名 / 艺人 · 专辑 / 当前时间与总长，底部一条细进度线
 *  - 角标自带播放/暂停小钮（播放期间常显，暂停时悬停才显），控制的就是那个共享音频元素，
 *    所以在胶片页按暂停、进 #tape 后机器会跟着停下来（走带跟随见 tapeApp.js 主循环）
 *  - 未装带（默认曲目缺失或加载失败）时：信息层提示"未装带 · 点开装一首"，播放钮禁用
 *
 * 参数：无（无 props：全站挂载，显隐由路由与样式决定）
 *
 * 返回值：React.ReactElement
 *
 * 异常：无（音频侧异常都由 tapeAudioStore 静默降级）
 *
 * 注意事项：
 *  - 任何详情覆盖层打开时用 CSS `:has()` 把角标淡出（钢琴页右下是踏板，会撞），
 *    这一条写在 musicBox.css 里，不需要 film 页配合
 *  - #tape 整页里不渲染这个角标（由 main.tsx 的路由分支保证），页面里不必再判断
 */
import { useEffect, useRef, useState } from 'react';
import { tapeAudio, type TapeAudioState } from './tapeAudioStore';
import { TIMING, consumeLanded, reduceMotion, rememberOrigin } from './tapeTransition';
import './musicBox.css';

/** 秒数格式化为 mm:ss
 *
 * 参数：
 *  - s {number} 秒数（非法值按 0 处理）
 * 返回值：{string} 形如 03:07
 * 异常：无
 */
function fmt(s: number): string {
  const v = Number.isFinite(s) && s > 0 ? s : 0;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
}

/** 拖拽判定阈值（px）：越过才算"切歌拖拽"，之内是普通点击的抖动 */
const DRAG_THRESHOLD = 26;
/** 跟手位移的阻尼：bar 实际平移量 = 指针位移 × 阻尼（拖起来有"磁带在槽里滑动"的重量感） */
const DRAG_DAMP = 0.45;

export function MusicBoxDock() {
  // 音频单例的状态快照（订阅式：元素是共享的，状态可能来自任何页面）
  const [st, setSt] = useState<TapeAudioState>(tapeAudio.state);
  // 正在起飞（图标淡出那 90ms：期间不接受第二次点击，也不再响应悬停）
  const [launching, setLaunching] = useState(false);
  // 刚完成一次收闭落地（播一次回弹，让"收进去"和"它在角标里接着放"连成一个动作）
  const [landing, setLanding] = useState(false);
  // 音量气泡：ref 直写 DOM——wheel 是原生监听的连续事件，React 18 对连续事件里的
  // setState 走并发渲染，慢渲染环境下提交会被推迟到看不见；音量反馈必须同步上屏
  const volRowRef = useRef<HTMLDivElement | null>(null);
  // 播放列表面板：三横线按钮点开（图标变叉），再点/点外部收起
  const [listOpen, setListOpen] = useState(false);
  // 面板收起动画的缓冲：真卸载前先挂 is-closing 播 160ms 收回
  const [listClosing, setListClosing] = useState(false);
  // 拖拽态：null = 未拖；dx 是指针位移，dir 是"已过阈值待切"的方向
  const [drag, setDrag] = useState<{ dx: number; dir: 'prev' | 'next' | null } | null>(null);
  // 面板 credits 位的临时文案（切歌反馈 / 只有一首提示），空串 = 显示正常曲目信息
  const [hint, setHint] = useState('');
  // 角标本体（量来源矩形用：展开的起点与收闭的落点就是它）
  const barRef = useRef<HTMLDivElement>(null);
  // 根元素（滚轮监听挂这里：指针悬停在角标任何部位都算"hover 中"）
  const rootRef = useRef<HTMLDivElement>(null);
  // 拖拽的命令式账本（pointermove 高频，走 ref 不走 state；state 只留渲染需要的 dx/dir）
  const dragRef = useRef({ startX: 0, active: false, captured: false, dx: 0, movedAt: 0 });
  const volTimer = useRef(0);
  const hintTimer = useRef(0);

  useEffect(() => tapeAudio.subscribe(setSt), []);

  /**
   * 音量气泡：命令式创建、完全脱离 React 树
   *
   * 功能：往 dock 根部挂一个音量气泡节点（深色芯片：标签/填充条/百分比）。
   *      不用 JSX 渲染的原因——气泡的显隐与内容由 onWheel 的 ref 直写驱动，
   *      而 setVolume 会触发 subscribe→setSt 重渲染，React 重渲染会把 ref
   *      直写上去的 class/文本按 vnode 覆盖回去，气泡就会闪没。命令式节点
   *      React 永不管理，ref 直写稳定生效。卸载时随手移除。
   *
   * 参数：无
   * 返回值：void
   * 异常：无
   */
  useEffect(() => {
    const row = document.createElement('div');
    row.className = 'music-dock-volrow';
    row.innerHTML = '<u>音量</u><i class="music-dock-volbar"><b></b></i><em>10%</em>';
    rootRef.current?.appendChild(row);
    volRowRef.current = row;
    return () => { row.remove(); volRowRef.current = null; };
  }, []);

  /** 挂载时若刚发生过收闭，播一次落地回弹 */
  useEffect(() => {
    if (!consumeLanded()) return;
    setLanding(true);
    const t = window.setTimeout(() => setLanding(false), 320);
    return () => window.clearTimeout(t);
  }, []);

  /**
   * 悬停滚轮调音量（非 passive 原生监听）
   *
   * 功能：指针悬停在角标上滚动滚轮，音量按 5% 一档增减并浮出气泡；
   *      preventDefault 挡住页面滚动。必须用原生监听——React 的 onWheel
   *      是 passive 的，在里面 preventDefault 会被控制台警告且无效。
   *
   * 参数：无
   * 返回值：void
   * 异常：无（setVolume 内部自行收敛越界值）
   */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;                 // 浏览器缩放手势不抢
      /* 播放列表面板上的滚轮归列表自己（滚动曲目），不拿来调音量 */
      if ((e.target as HTMLElement | null)?.closest('.music-dock-playlist-scroll')) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = e.deltaY < 0 ? 1 : -1;     // 上滚加、下滚减
      const v = Math.min(1, Math.max(0, tapeAudio.state.volume + dir * 0.05));
      tapeAudio.setVolume(v);
      /* 气泡 ref 直写：transform 与文案同步上屏，1.1s 无操作自动隐去 */
      const row = volRowRef.current;
      if (row) {
        const bar = row.querySelector('.music-dock-volbar b') as HTMLElement;
        const num = row.querySelector('em') as HTMLElement;
        bar.style.transform = `scaleX(${v})`;
        num.textContent = `${Math.round(v * 100)}%`;
        row.classList.add('is-on');
      }
      clearTimeout(volTimer.current);
      volTimer.current = window.setTimeout(() => volRowRef.current?.classList.remove('is-on'), 1100);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(volTimer.current);
      clearTimeout(hintTimer.current);
    };
  }, []);

  /** 面板 credits 位的临时文案（1.6s 后回到正常曲目信息） */
  const showHint = (text: string) => {
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(''), 1600);
  };

  /** 收起播放列表面板：先播 160ms 收回动画再真卸载 */
  const closeList = () => {
    if (!listOpen) return;
    setListClosing(true);
    window.setTimeout(() => { setListClosing(false); setListOpen(false); }, 160);
  };

  /* 列表打开时点外部收起（capture：抢在页面其他点击语义之前） */
  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('.music-dock-playlist, .music-dock-list')) return;
      closeList();
    };
    document.addEventListener('pointerdown', onDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onDown, { capture: true });
    // closeList 依赖 listOpen，但本效果只在打开期间存活，闭包值恒有效
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listOpen]);

  /**
   * 拖拽三件套：按下记账 → 越过 8px 抢占指针进入拖拽 → 松手按阈值切歌
   *
   * 功能：向左拖（过阈值）上一首、向右拖下一首，循环；拖拽期间磁带图标跟手平移、
   *      面板显示方向提示；拖过就必须切（抑制本次 click 误开磁带页）。
   *      指针捕获在"确认拖拽"时才 set——捕获会让 click 落到 bar 上，
   *      太早设会把播放钮的点击也吃掉。
   *
   * 参数：React 指针事件（挂在 bar 上）
   * 返回值：void
   * 异常：无
   */
  const onBarPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, active: true, captured: false, dx: 0, movedAt: 0 };
  };
  const onBarPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.active) return;
    d.dx = e.clientX - d.startX;
    if (!d.captured) {
      if (Math.abs(d.dx) <= 8) return;
      d.captured = true;
      try { barRef.current?.setPointerCapture(e.pointerId); } catch { /* 已释放：放弃本次拖拽 */ }
    }
    if (!d.captured) return;
    setDrag({ dx: d.dx, dir: Math.abs(d.dx) >= DRAG_THRESHOLD ? (d.dx < 0 ? 'prev' : 'next') : null });
  };
  const onBarPointerEnd = () => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    const wasCaptured = d.captured;
    const dx = d.dx;
    d.captured = false;
    /* movedAt 只在"确认拖拽过"时更新——普通点击的 pointerup 也会走到这里，
       若无条件更新，click（在 pointerup 之后派发）会被 openTape 的
       300ms 抑制误吞，磁带页就再也点不开了（实测回归） */
    if (!wasCaptured) return;
    d.movedAt = Date.now();
    setDrag(null);
    if (Math.abs(dx) < DRAG_THRESHOLD) return; // 拖了但不够深：回弹即可，什么都不切
    const ok = dx < 0 ? tapeAudio.prev() : tapeAudio.next();
    showHint(ok ? (dx < 0 ? '已切上一首 ◀' : '已切下一首 ▶') : '只有一首 · 去磁带页装几首');
  };

  /**
   * 打开磁带机整页
   *
   * 功能：先量下角标 bar 的矩形交给过渡模块（展开起点 / 收闭落点 / 来源页），
   *      播一下图标淡出（dockHandoff），再切 hash 让整页从这块矩形长出来
   *
   * 参数：无
   * 返回值：无
   * 异常：无（减少动效时直接切路由）
   */
  const openTape = () => {
    if (launching) return;
    if (Date.now() - dragRef.current.movedAt < 300) return;   // 刚拖完切歌：别把松手当点击
    const bar = barRef.current;
    if (bar) rememberOrigin(bar);
    if (reduceMotion()) { window.location.hash = '#tape'; return; }
    setLaunching(true);
    window.setTimeout(() => { window.location.hash = '#tape'; }, TIMING.dockHandoff);
  };

  const credits = [st.artist, st.album].filter(Boolean).join(' · ');
  const progress = st.duration > 0 ? Math.min(1, st.time / st.duration) : 0;
  /* 面板 credits 行的文案优先级：拖拽方向提示 > 临时反馈 > 未装带 > 正常曲目信息 */
  const panelCredits =
    drag?.dir === 'prev' ? '← 上一首'
    : drag?.dir === 'next' ? '下一首 →'
    : hint || (st.failed ? '未装带 · 点开装一首' : (credits || '未知曲目'));

  return (
    <div
      ref={rootRef}
      className={`music-dock${st.playing ? ' is-playing' : ''}${st.failed ? ' is-empty' : ''}${launching ? ' is-launching' : ''}${landing ? ' is-landing' : ''}${drag ? ' is-dragging' : ''}${listOpen && !listClosing ? ' is-list-open' : ''}`}
    >
      {/* 悬停浮出的信息层（列表打开时让位隐藏） */}
      <div className="music-dock-panel">
        <b className="music-dock-title">{st.title}</b>
        <i className={`music-dock-credits${(drag?.dir || hint) ? ' is-note' : ''}`}>{panelCredits}</i>
        <span className="music-dock-time">
          {fmt(st.time)} <u>/</u> {st.duration > 0 ? fmt(st.duration) : '--:--'}
        </span>
      </div>

      {/* 播放列表面板：从 barrow 上方向上展开；打开期间信息层让位 */}
      {listOpen && (
        <div className={`music-dock-playlist${listClosing ? ' is-closing' : ''}`}>
          <div className="music-dock-playlist-head">
            PLAYLIST <u>·</u> {tapeAudio.list.length} TRACKS
          </div>
          <div className="music-dock-playlist-scroll" role="listbox" aria-label="播放列表">
            {tapeAudio.list.map((t, i) => (
              <button
                key={t.src}
                role="option"
                aria-selected={i === tapeAudio.index}
                className={`music-dock-playlist-item${i === tapeAudio.index ? ' is-current' : ''}`}
                style={{ '--i': i } as React.CSSProperties}
                onClick={() => tapeAudio.playIndex(i)}
              >
                <u>{String(i + 1).padStart(2, '0')}</u>
                <b>{t.title}</b>
                <i>{t.artist || '未知作者'}</i>
                <span className="music-dock-playlist-now" aria-hidden="true">
                  {i === tapeAudio.index && st.playing ? '▶' : i === tapeAudio.index ? '❚❚' : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 列表按钮 + 磁带图标行：列表按钮贴在磁带行左侧 */}
      <div className="music-dock-barrow">
        <button
          className={`music-dock-list${listOpen && !listClosing ? ' is-open' : ''}`}
          onClick={() => (listOpen || listClosing ? closeList() : setListOpen(true))}
          aria-label={listOpen ? '关闭播放列表' : '打开播放列表'}
          aria-expanded={listOpen}
          title={listOpen ? '关闭播放列表' : '播放列表'}
        >
          {/* 三横线 ↔ 叉：三条线段morph（上线右旋下移、中线隐、下线左旋上移） */}
          <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true">
            <line className="music-dock-list-l1" x1="3" y1="5" x2="15" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line className="music-dock-list-l2" x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line className="music-dock-list-l3" x1="3" y1="13" x2="15" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <div
          className="music-dock-bar"
          ref={barRef}
          style={drag ? { transform: `translateX(${drag.dx * DRAG_DAMP}px)` } : undefined}
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerEnd}
          onPointerCancel={onBarPointerEnd}
        >
          {/* 磁带图标：点它进整页（拖拽松手后的 click 会被 movedAt 抑制） */}
          <button
            className="music-dock-main"
            onClick={openTape}
            aria-label="打开磁带机（音乐盒）"
            title="打开磁带机 · 悬停滚轮调音量 · 左右拖切歌"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <rect x="1.4" y="4.4" width="21.2" height="15.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1.4 16.4h21.2" stroke="currentColor" strokeWidth="1.2" />
              <g className="music-dock-reel">
                <circle cx="8.1" cy="11.2" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.1" />
                <path d="M8.1 8.5v5.4" stroke="currentColor" strokeWidth="1.1" />
              </g>
              <g className="music-dock-reel music-dock-reel--b">
                <circle cx="15.9" cy="11.2" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.1" />
                <path d="M15.9 8.5v5.4" stroke="currentColor" strokeWidth="1.1" />
              </g>
            </svg>
          </button>

          {/* 播放 / 暂停 */}
          <button
            className="music-dock-toggle"
            onClick={(e) => { e.stopPropagation(); if (!st.failed) tapeAudio.toggle(); }}
            disabled={st.failed}
            aria-label={st.playing ? '暂停' : '播放'}
            title={st.failed ? '未装带：先打开磁带机装一首' : (st.playing ? '暂停' : '播放')}
          >
            {st.playing ? (
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path d="M5.3 2.8v10.4M10.7 2.8v10.4" stroke="currentColor" strokeWidth="1.6" fill="none" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path d="M4.8 2.6 12.9 8l-8.1 5.4z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* 细进度线：没有时长（未装带）时不显示 */}
      <div className="music-dock-prog" aria-hidden="true">
        <i style={{ transform: `scaleX(${progress})` }} />
      </div>

      {/* 音量气泡由命令式 effect 挂载（见上方 effect 注释），不在 JSX 里 */}
    </div>
  );
}