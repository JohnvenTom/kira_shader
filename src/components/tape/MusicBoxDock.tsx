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

/**
 * 秒数格式化为 mm:ss
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

export function MusicBoxDock() {
  // 音频单例的状态快照（订阅式：元素是共享的，状态可能来自任何页面）
  const [st, setSt] = useState<TapeAudioState>(tapeAudio.state);
  // 正在起飞（图标淡出那 90ms：期间不接受第二次点击，也不再响应悬停）
  const [launching, setLaunching] = useState(false);
  // 刚完成一次收闭落地（播一次回弹，让"收进去"和"它在角标里接着放"连成一个动作）
  const [landing, setLanding] = useState(false);
  // 角标本体（量来源矩形用：展开的起点与收闭的落点就是它）
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => tapeAudio.subscribe(setSt), []);

  /** 挂载时若刚发生过收闭，播一次落地回弹 */
  useEffect(() => {
    if (!consumeLanded()) return;
    setLanding(true);
    const t = window.setTimeout(() => setLanding(false), 320);
    return () => window.clearTimeout(t);
  }, []);

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
    const bar = barRef.current;
    if (bar) rememberOrigin(bar);
    if (reduceMotion()) { window.location.hash = '#tape'; return; }
    setLaunching(true);
    window.setTimeout(() => { window.location.hash = '#tape'; }, TIMING.dockHandoff);
  };

  const credits = [st.artist, st.album].filter(Boolean).join(' · ');
  const progress = st.duration > 0 ? Math.min(1, st.time / st.duration) : 0;

  return (
    <div
      className={`music-dock${st.playing ? ' is-playing' : ''}${st.failed ? ' is-empty' : ''}${launching ? ' is-launching' : ''}${landing ? ' is-landing' : ''}`}
    >
      {/* 悬停浮出的信息层 */}
      <div className="music-dock-panel">
        <b className="music-dock-title">{st.title}</b>
        <i className="music-dock-credits">{st.failed ? '未装带 · 点开装一首' : (credits || '未知曲目')}</i>
        <span className="music-dock-time">
          {fmt(st.time)} <u>/</u> {st.duration > 0 ? fmt(st.duration) : '--:--'}
        </span>
      </div>

      <div className="music-dock-bar" ref={barRef}>
        {/* 磁带图标：点它进整页 */}
        <button
          className="music-dock-main"
          onClick={openTape}
          aria-label="打开磁带机（音乐盒）"
          title="打开磁带机"
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

      {/* 细进度线：没有时长（未装带）时不显示 */}
      <div className="music-dock-prog" aria-hidden="true">
        <i style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
  );
}