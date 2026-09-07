/**
 * PianoDetailPage - 钢琴 section 详情页（section5，全屏可弹奏 3D 三角钢琴）
 *
 * 功能：
 *  - 独立滚动容器驱动 PianoScene 的苹果风格镜头旅程（滚动推进运镜），
 *    镜头结束后进入自由交互：轨道拖动 / 滚轮缩放 / 点击琴键弹奏
 *  - 完整复刻原独立项目的 UI：
 *      · 右上控制面板（六个视角机位 / 琴盖 / 键盘盖 / 自动旋转 / 半音键对比 /
 *        演示曲《致爱丽丝》/ 重置 / 音量 / 混响），可折叠
 *      · 右下三条屏幕踏板（弱音 / 选择延音 / 延音），按住生效
 *      · 左下音符读数（弹奏时实时显示音名）与 FPS/三角面统计
 *      · 底部操作提示（拖动/缩放/滑奏/电脑键盘弹奏），首次弹奏后变淡
 *      · 顶部 toast（八度切换等提示）
 *  - 退出路径：交互模式下把相机拉到最远后继续上滑 → 滚轮冒泡到外层
 *    详情覆盖层 → 外层滚动进度回落 → 丝滑退出详情页
 *
 * 参数：
 *  - detailOpen 外层详情页是否打开（每次进入时重置内部滚动与镜头旅程）
 *
 * 返回值：React.ReactElement
 *
 * 异常：无
 *
 * 注意事项：
 *  - 滚轮分两种模式：旅程期间转发到内部滚动容器驱动运镜；
 *    交互期间交给轨道控制器缩放（canvas 上 preventDefault）
 *  - 滚动容器 pointer-events:none，让 canvas 能接收拖动/点击，
 *    滚动完全由根元素 wheel 监听器手动驱动
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  PianoScene,
  type PianoApi,
  type PianoUiSnapshot,
} from './PianoScene';

/** 视角机位按钮定义（与 PIANO_VIEWS 一一对应） */
const VIEW_BUTTONS: { key: string; label: string }[] = [
  { key: 'front', label: '正面' },
  { key: 'player', label: '演奏位' },
  { key: 'top', label: '俯视' },
  { key: 'side', label: '侧面' },
  { key: 'tail', label: '琴尾' },
  { key: 'detail', label: '键盘特写' },
];

/** UI 快照初始值（面板按钮文案） */
const INITIAL_UI: PianoUiSnapshot = {
  lidLabel: '琴盖：全开',
  fallLabel: '键盘盖：打开',
  rotateLabel: '自动旋转：关',
  contrastLabel: '半音键：纯白',
  demoPlaying: false,
};

export function PianoDetailPage({ detailOpen }: { detailOpen: boolean }) {
  // 内部独立滚动容器 ref（驱动镜头旅程进度）
  const pianoScrollRef = useRef<HTMLDivElement>(null);
  // 镜头旅程滚动进度 0~1（由 PianoScene 每帧读取）
  const pianoProgress = useRef(0);
  // 是否已滚到顶（防止滚轮回退时误触发外层退出逻辑）
  const atTopRef = useRef(true);
  // 根元素 ref（绑定 wheel 拦截）
  const innerRef = useRef<HTMLDivElement>(null);
  // PianoScene 命令式 API
  const apiRef = useRef<PianoApi | null>(null);
  // 音符读数 / 统计 / 提示 / toast 的 DOM 元素 ref（由 PianoScene 直接写入）
  const noteElRef = useRef<HTMLDivElement>(null);
  const statElRef = useRef<HTMLDivElement>(null);
  const hintElRef = useRef<HTMLDivElement>(null);
  const toastElRef = useRef<HTMLDivElement>(null);
  // 内容层 ref（写入 CSS 变量 --piano-progress 驱动标题淡出）
  const contentLayerRef = useRef<HTMLDivElement>(null);
  // 是否进入自由交互模式（面板/踏板淡入）
  const [interactive, setInteractive] = useState(false);
  // interactive 的 ref 版本（wheel 回调中读取，避免闭包旧值）
  const interactiveRef = useRef(false);
  // 面板 UI 快照（按钮文案由 PianoScene 回调更新）
  const [ui, setUi] = useState<PianoUiSnapshot>(INITIAL_UI);
  // 当前视角机位（按钮高亮）
  const [view, setView] = useState('front');
  // 面板折叠状态
  const [collapsed, setCollapsed] = useState(false);
  // 音量 / 混响滑杆值（与原项目默认一致）
  const [volume, setVolume] = useState(0.85);
  const [reverb, setReverb] = useState(0.26);

  /**
   * 内部滚动事件处理
   *
   * 功能：读取 pianoScrollRef 的 scrollTop 计算 0~1 进度，
   *      写入 pianoProgress（驱动镜头旅程）与 CSS 变量 --piano-progress（驱动标题淡出）
   *
   * 参数：无
   * 返回值：无
   */
  const handlePianoScroll = useCallback(() => {
    const el = pianoScrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const progress = max > 0 ? el.scrollTop / max : 0;
    const clamped = Math.max(0, Math.min(1, progress));
    pianoProgress.current = clamped;
    atTopRef.current = el.scrollTop <= 0;
    if (contentLayerRef.current) {
      contentLayerRef.current.style.setProperty('--piano-progress', String(clamped));
    }
  }, []);

  // 绑定滚动监听
  useEffect(() => {
    const el = pianoScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    pianoProgress.current = 0;
    el.addEventListener('scroll', handlePianoScroll, { passive: true });
    return () => el.removeEventListener('scroll', handlePianoScroll);
  }, [handlePianoScroll]);

  /**
   * 进入/退出详情页时重置内部滚动状态
   *
   * 功能：detailOpen 变 true 时把内部滚动归零，镜头旅程从头播放
   *
   * 参数：无（通过闭包读取 detailOpen）
   * 返回值：无
   */
  useEffect(() => {
    if (!detailOpen) return;
    const el = pianoScrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = 0;
      pianoProgress.current = 0;
      atTopRef.current = true;
      if (contentLayerRef.current) {
        contentLayerRef.current.style.setProperty('--piano-progress', '0');
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [detailOpen]);

  /**
   * 根元素 wheel 拦截（滚轮路由）
   *
   * 功能：
   *  - 旅程期间（未进入交互）：preventDefault + stopPropagation，
   *    把 deltaY 转发到内部滚动容器驱动运镜；
   *    已滚到顶且继续上滑 → 放行冒泡，让外层退出详情页
   *  - 交互期间：滚轮交给轨道控制器缩放（canvas 上已 preventDefault）；
   *    相机已拉到最远且继续上滑 → 放行冒泡退出详情页；
   *    其余情况 stopPropagation，避免外层滚动误退出
   *
   * 参数：无（通过闭包读取各 ref）
   * 返回值：无
   */
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const scrollEl = pianoScrollRef.current;
      if (!scrollEl) return;
      if (!interactiveRef.current) {
        // 旅程期间：滚到顶再上滑 → 放行给外层退出
        if (scrollEl.scrollTop <= 0 && e.deltaY < 0) return;
        e.preventDefault();
        e.stopPropagation();
        scrollEl.scrollTop += e.deltaY;
        return;
      }
      // 交互期间：拉到最远再上滑 → 放行给外层退出
      if (e.deltaY < 0 && apiRef.current?.isZoomedOut()) return;
      // 其余交给轨道缩放，阻止冒泡避免外层误退出
      e.stopPropagation();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /**
   * 交互模式变化回调（PianoScene 通知）
   *
   * 功能：镜头旅程结束时更新 state（面板/踏板淡入）与 ref（wheel 路由用）
   *
   * 参数：
   *  - v {boolean} 是否进入自由交互
   * 返回值：无
   */
  const handleInteractiveChange = useCallback((v: boolean) => {
    interactiveRef.current = v;
    setInteractive(v);
  }, []);

  /**
   * 视角机位按钮点击
   *
   * 参数：
   *  - key {string} PIANO_VIEWS 的键名
   * 返回值：无
   */
  const handleViewClick = (key: string) => {
    apiRef.current?.setView(key as Parameters<NonNullable<PianoApi['setView']>>[0]);
    setView(key);
  };

  /**
   * 踏板按下/抬起（pointer 事件，按住生效）
   *
   * 参数：
   *  - idx {number} 踏板索引 0 弱音 / 1 选择延音 / 2 延音
   *  - down {boolean} 是否按下
   * 返回值：无
   */
  const handlePedal = (idx: number, down: boolean) => {
    if (down) apiRef.current?.pedalDown(idx);
    else apiRef.current?.pedalUp(idx);
  };

  return (
    <div ref={innerRef} className="contact-detail-inner">
      {/* 摄影棚背景：柔和垂直渐变 + 顶部聚光（canvas 为透明背景，透出此层） */}
      <div className="piano-backdrop" />

      {/* 全屏 Canvas：钢琴 3D 场景
          - 透明背景 + PCFSoft 阴影 + ACES 色调映射（PianoScene 内部设置）
          - 交互模式（overlay visible）下接收指针事件：拖动旋转 / 滚轮缩放 / 点击琴键 */}
      <div className="piano-canvas-wrapper">
        <Canvas
          dpr={[1, 2]}
          shadows
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ fov: 33, near: 0.05, far: 60, position: [2.0, 2.6, -5.6] }}
        >
          <PianoScene
            scrollProgressRef={pianoProgress}
            detailOpen={detailOpen}
            apiRef={apiRef}
            onUiStateChange={setUi}
            onInteractiveChange={handleInteractiveChange}
            noteElRef={noteElRef}
            statElRef={statElRef}
            hintElRef={hintElRef}
            toastElRef={toastElRef}
          />
        </Canvas>
      </div>

      {/* 独立滚动容器：撑出滚动空间让用户能滚动驱动镜头旅程
          pointer-events:none，让下方 canvas 可交互，滚动由根元素 wheel 监听驱动 */}
      <div ref={pianoScrollRef} className="piano-scroll-container">
        <div className="contact-scroll-placeholder" />
      </div>

      {/* 内容层：固定全屏，标题 / 面板 / 踏板 / 读数叠加在钢琴画面上 */}
      <div
        ref={contentLayerRef}
        className={`piano-content-layer ${interactive ? 'interactive' : ''}`}
      >
        {/* 右上角排版式标题（与黑洞页同款编辑杂志风），随旅程进度淡出上移 */}
        <div className="piano-header">
          <span className="piano-kicker">06 — INTERACTIVE INSTRUMENT</span>
          <h1 className="piano-title">GRAND PIANO</h1>
          <div className="piano-rule" />
          <p className="piano-subtitle">Aurora · Concert Grand · Pure White</p>
        </div>

        {/* 旅程提示：滚动推进运镜 */}
        <div className="piano-scroll-hint">SCROLL TO EXPLORE</div>

        {/* 面板折叠按钮 */}
        <button
          className="piano-collapse-btn"
          title="收起 / 展开面板"
          onClick={() => setCollapsed((c) => !c)}
        >
          ≡
        </button>

        {/* 控制面板（复刻原项目）：视角 / 琴体 / 演奏 / 音量 / 混响 */}
        <div className={`piano-panel ${collapsed ? 'collapsed' : ''}`}>
          <h2>视角</h2>
          <div className="piano-row">
            {VIEW_BUTTONS.map((b) => (
              <button
                key={b.key}
                className={`piano-btn half ${view === b.key ? 'on' : ''}`}
                onClick={() => handleViewClick(b.key)}
              >
                {b.label}
              </button>
            ))}
          </div>

          <h2>琴体</h2>
          <div className="piano-row">
            <button className="piano-btn wide on" onClick={() => apiRef.current?.cycleLid()}>
              {ui.lidLabel}
            </button>
            <button className="piano-btn wide on" onClick={() => apiRef.current?.toggleFallboard()}>
              {ui.fallLabel}
            </button>
            <button className="piano-btn half" onClick={() => apiRef.current?.toggleRotate()}>
              {ui.rotateLabel}
            </button>
            <button className="piano-btn half" onClick={() => apiRef.current?.toggleContrast()}>
              {ui.contrastLabel}
            </button>
          </div>

          <h2>演奏</h2>
          <div className="piano-row">
            <button
              className={`piano-btn wide ${ui.demoPlaying ? 'on' : ''}`}
              onClick={() => apiRef.current?.toggleDemo()}
            >
              {ui.demoPlaying ? '停止演奏' : '演奏《致爱丽丝》'}
            </button>
            <button className="piano-btn wide" onClick={() => apiRef.current?.reset()}>
              重置视角与琴音
            </button>
          </div>

          <div className="piano-slider">
            <label>
              <span>音量</span>
              <span>VOL</span>
            </label>
            <input
              type="range"
              min={0}
              max={1.4}
              step={0.01}
              value={volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                apiRef.current?.setVolume(v);
              }}
            />
          </div>
          <div className="piano-slider">
            <label>
              <span>混响</span>
              <span>REVERB</span>
            </label>
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.01}
              value={reverb}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setReverb(v);
                apiRef.current?.setReverb(v);
              }}
            />
          </div>
        </div>

        {/* 屏幕踏板：按住生效（弱音 / 选择延音 / 延音） */}
        <div className="piano-pedals">
          {[0, 1, 2].map((i) => (
            <button
              key={i}
              onPointerDown={(e) => {
                e.preventDefault();
                handlePedal(i, true);
              }}
              onPointerUp={() => handlePedal(i, false)}
              onPointerLeave={() => handlePedal(i, false)}
              onPointerCancel={() => handlePedal(i, false)}
            >
              {['弱音踏板', '选择延音', '延音踏板'][i]}
            </button>
          ))}
        </div>

        {/* 音符读数（弹奏时由 PianoScene 写入文字与透明度） */}
        <div ref={noteElRef} className="piano-note-read" />

        {/* FPS / 三角面 / 发声数统计（由 PianoScene 写入） */}
        <div ref={statElRef} className="piano-stat" />

        {/* 操作提示（首次弹奏后由 PianoScene 加 fade 类变淡） */}
        <div ref={hintElRef} className="piano-hint">
          拖动旋转 · 滚轮缩放 · <kbd>Shift</kbd>+拖动平移 · 点击琴键或按住滑动可滑奏
          <br />
          电脑键盘弹奏：<kbd>Z</kbd>
          <kbd>S</kbd>
          <kbd>X</kbd>
          <kbd>D</kbd>
          <kbd>C</kbd> … <kbd>Q</kbd>
          <kbd>2</kbd>
          <kbd>W</kbd>
          <kbd>3</kbd>
          <kbd>E</kbd> · <kbd>空格</kbd> 延音踏板 · <kbd>←</kbd>
          <kbd>→</kbd> 移八度
          <br />
          拉远相机（滚轮向上到最远）后继续上滑可返回胶片
        </div>

        {/* toast 提示（八度切换等，由 PianoScene 写入） */}
        <div ref={toastElRef} className="piano-toast" />
      </div>
    </div>
  );
}
