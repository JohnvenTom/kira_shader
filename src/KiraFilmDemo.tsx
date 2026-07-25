import { useRef, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { FilmScene, SECTIONS } from './components/FilmScene';
import {
  FilmPostProcessing,
  DEFAULT_FILM_PARAMS,
  type FilmFXParams,
} from './components/FilmPostProcessing';
import { NavBar } from './components/NavBar';

/**
 * 把字符串拆成逐字 span（用于逐字浮现动画）
 *
 * 功能：将传入的字符串按字符拆分，每个字符包进一个 <span class="hero-char">，
 *      并根据字符索引递增设置 transitionDelay，实现"一个一个字蹦出来"的效果。
 *      空格会渲染为不可折叠的空白 span，避免被 HTML 合并。
 *
 * 参数：
 *  - text           {string}  要拆分的字符串
 *  - baseDelay      {number}  该字符串起始延迟（ms）
 *  - step           {number}  每个字符之间的延迟间隔（ms）
 *  - visible        {boolean} 是否可见（控制 .visible class）
 *
 * 返回值：ReactNode[] 每个字符对应的 span 节点数组
 *
 * 异常：无
 *
 * 注意事项：
 *  - 空格用 \u00A0（不间断空格）替换，防止行内空白被折叠
 *  - display:inline-block 让 transform 生效（inline 元素 transform 不起作用）
 */
function splitTextToChars(
  text: string,
  baseDelay: number,
  step: number,
  visible: boolean
): ReactNode[] {
  return Array.from(text).map((ch, i) => (
    <span
      key={`${text}-${i}`}
      className="hero-char"
      style={{
        transitionDelay: `${baseDelay + i * step}ms`,
        display: 'inline-block',
      }}
    >
      {ch === ' ' ? '\u00A0' : ch}
    </span>
  ));
}

/**
 * KiraFilmDemo - 多 section 滚动驱动 + 无缝切换的电影感页面
 *
 * 功能：
 *  - 搭建三层架构：
 *    1. z-50 滚动容器（捕获滚动，含虚拟高度占位，4 个 section × 视口高度）
 *    2. z-40 WebGL Canvas（渲染 FilmScene 3D 内容，不接收交互）
 *    3. z-45 内容覆盖层（文字 UI，随 section 切换更新）
 *  - 滚动进度通过 ref + state 双通道传递给 Canvas 内的 3D 场景
 *  - 鼠标视差：文字层 CSS 变量 + 3D 相机视差旋转（mouseRef）
 *  - section 切换由 FilmScene 内部根据 scrollProgress 自动完成（闪光掩盖），
 *    外层通过 onSectionChange 回调同步更新文字 UI
 *
 * 参数：无
 * 返回值：React.ReactElement
 * 异常：无
 *
 * 注意事项：
 *  - 滚动总进度 0~1 被分成 4 段，每段 0.25 对应一个 section
 *  - section 切换发生在段末（scrollProgress 接近 0.25/0.5/0.75 时），
 *    此时屏幕被闪光完全掩盖，用户感知不到内容切换
 *  - 文字 UI 在 onSectionChange 触发时整体淡入淡出过渡（CSS transition）
 */
export default function KiraFilmDemo() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // 滚动进度 0~1，用于驱动 3D 场景
  const [scrollProgress, setScrollProgress] = useState(0);
  // 当前 section 索引（由 FilmScene 的 onSectionChange 回调更新）
  const [sectionIndex, setSectionIndex] = useState(0);
  // 文字 UI 是否可见（section 切换时短暂隐藏再淡入）
  const [textVisible, setTextVisible] = useState(true);
  // 进入闪光：从 App 切换过来时，全屏白色淡出露出新场景
  // mount 时 entering=true（白屏），下一帧加 fade-out class 触发淡出过渡
  const [enteringFadeOut, setEnteringFadeOut] = useState(false);

  // mount 后立即触发淡出（用 rAF 确保浏览器先把 entering 状态渲染成白屏）
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEnteringFadeOut(true));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // 鼠标视差偏移量（写入 CSS 变量，供 hero-block 使用）
  const heroBlockRef = useRef<HTMLDivElement>(null);
  // 共享鼠标归一化坐标（-1~1），供 3D 相机视差旋转使用
  const mouseRef = useRef({ x: 0, y: 0 });
  // 鼠标拖动偏移（世界坐标 x，负值表示胶片向左移动）
  // 范围 0 ~ -12（section 0 在 x=0，section 3 在 x=-12）
  const dragOffsetRef = useRef(0);

  // 后处理参数（参考 shader.se 的胶片质感）
  // bloomIntensity 1.2 + 4 sin 波动态闪烁，sepia 0.25 略偏暖，
  // chromaticAbberation 0.8 中等色散，lensDistortion 0.15 微畸变
  const filmParams = useMemo<FilmFXParams>(() => ({ ...DEFAULT_FILM_PARAMS }), []);

  /**
   * 滚动事件处理
   *
   * 功能：读取滚动容器的 scrollTop，计算 0~1 的进度并写入 state
   * 参数：无
   * 返回值：无
   *
   * 注意事项：用 passive 监听提升性能，避免阻塞滚动
   */
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const progress = max > 0 ? el.scrollTop / max : 0;
    setScrollProgress(progress);
  }, []);

  // 绑定滚动监听
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // 从 App 切换过来时，浏览器可能记忆了滚动位置，强制滚到顶
    el.scrollTop = 0;
    setScrollProgress(0);
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  /**
   * section 切换回调
   *
   * 功能：当 FilmScene 内部触发 section 切换（闪光掩盖下）时，
   *      外层文字 UI 同步更新：
   *      1. 先隐藏当前文字（触发淡出过渡）
   *      2. 延迟 200ms 后切换到新 section 的文字
   *      3. 再延迟 50ms 后显示新文字（触发淡入过渡）
   *
   * 参数：
   *  - index {number} 新的 section 索引（0~3）
   *
   * 返回值：无
   *
   * 注意事项：
   *  - 200ms 延迟与 FilmScene 的闪光峰值时机对齐，确保文字切换被闪光掩盖
   *  - 用 ref 避免重复触发（FilmScene 内部已有 lastNotifiedSectionRef 去重，
   *    这里二次保护）
   */
  const handleSectionChange = useCallback((index: number) => {
    setTextVisible(false);
    setTimeout(() => {
      setSectionIndex(index);
      setTimeout(() => setTextVisible(true), 50);
    }, 200);
  }, []);

  /**
   * 鼠标视差处理
   *
   * 功能：监听鼠标移动，同时驱动两层视差：
   *   1. 文字层：写入 hero-block 的 CSS 变量 --px/--py（位移 6px）+ --rx/--ry（旋转 ±6°）
   *   2. 3D 相机层：写入 mouseRef.current.x/y（归一化 -1~1），让相机绕 target 微旋转
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 使用 rAF 节流，避免高频 mousemove 引起重渲染
   *  - 文字位移幅度 6px + 旋转 ±6°，3D 相机视差幅度由 FilmScene 控制
   *  - perspective 在父级 .content-overlay 上，子元素 .hero-block 的 rotate 才有立体感
   */
  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        const el = heroBlockRef.current;
        if (el) {
          el.style.setProperty('--px', `${nx * 6}px`);
          el.style.setProperty('--py', `${ny * 6}px`);
          el.style.setProperty('--rx', `${ny * 6}deg`);
          el.style.setProperty('--ry', `${nx * 6}deg`);
        }
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

  /**
   * 鼠标拖动监听（左右切换 section）
   *
   * 功能：
   *  - mousedown 记录起始位置，但不立即标记为拖动（避免误触）
   *  - mousemove 检查水平移动距离，超过阈值（5px）才标记为拖动
   *  - 标记为拖动后，后续 mousemove 更新 dragOffsetRef
   *  - mouseup 结束拖动，吸附到最近的帧（-i*4，i=0~3）
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 拖动缩放因子 DRAG_SCALE = 0.015：鼠标移动 100px ≈ 世界坐标 1.5 单位
   *    （4 个 section 间距 4，需要拖动约 270px 切换一帧，手感适中）
   *  - dragOffset 范围限制在 [-12, 0]（section 0 ~ 3）
   *  - 不阻止默认行为（保留滚动功能），仅水平拖动触发切换
   *  - 拖动时设置 cursor: grabbing，提示用户正在拖动
   *  - 仅在鼠标位于视口中间区域（屏幕区域）时触发拖动，避免误触 NavBar
   */
  useEffect(() => {
    let isPending = false;     // mousedown 已触发，等待移动阈值确认
    let isDragging = false;    // 已确认拖动
    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    const DRAG_SCALE = 0.015;  // 鼠标像素 → 世界坐标的缩放因子
    const DRAG_THRESHOLD = 5;  // 水平移动阈值（px），超过才确认拖动

    const onMouseDown = (e: MouseEvent) => {
      // 仅左键触发
      if (e.button !== 0) return;
      // 仅在视口中间区域（Y 在 15%~85%）触发，避免误触 NavBar 和底部
      const yRatio = e.clientY / window.innerHeight;
      if (yRatio < 0.15 || yRatio > 0.85) return;
      isPending = true;
      isDragging = false;
      startX = e.clientX;
      startY = e.clientY;
      startOffset = dragOffsetRef.current;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isPending) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      // 水平移动超过阈值才确认拖动（避免垂直滚动误触）
      if (!isDragging) {
        if (Math.abs(deltaX) < DRAG_THRESHOLD) return;
        // 水平移动超过阈值，且水平移动大于垂直移动（确认是水平拖动而非滚动）
        if (Math.abs(deltaX) < Math.abs(deltaY)) return;
        isDragging = true;
        document.body.style.cursor = 'grabbing';
      }
      // 更新 dragOffset
      let newOffset = startOffset + deltaX * DRAG_SCALE;
      // 限制范围 [-12, 0]
      newOffset = Math.max(-12, Math.min(0, newOffset));
      dragOffsetRef.current = newOffset;
    };

    const onMouseUp = () => {
      isPending = false;
      if (!isDragging) return;
      isDragging = false;
      document.body.style.cursor = '';
      // 吸附到最近的帧（-i*4，i = round(-offset / 4)）
      const currentOffset = dragOffsetRef.current;
      const nearestFrame = Math.round(-currentOffset / 4);
      const clampedFrame = Math.max(0, Math.min(3, nearestFrame));
      dragOffsetRef.current = -clampedFrame * 4;
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
    };
  }, []);

  // 当前 section 内容
  const currentSection = SECTIONS[sectionIndex];

  return (
    <>
      {/* 进入闪光层：从 App 切换过来时全屏白色，mount 后淡出露出新场景 */}
      <div className={`demo-flash entering ${enteringFadeOut ? 'fade-out' : ''}`} />

      {/* 顶部导航 */}
      <NavBar />

      {/* 第 1 层：滚动容器 z-50
          高度 = 4 个 section × 视口高度，撑出足够滚动空间让 section 切换有过渡距离 */}
      <div ref={scrollContainerRef} className="scroll-container film-scroll-container">
        <div className="scroll-placeholder film-scroll-placeholder" />
      </div>

      {/* 第 2 层：WebGL Canvas z-40 */}
      <div className="canvas-wrapper">
        <Canvas
          gl={{
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance',
          }}
          camera={{ fov: 45, near: 0.1, far: 1000, position: [0, 0, 7] }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color('#0a0a0a'), 1);
          }}
        >
          <FilmScene
            scrollProgress={scrollProgress}
            mouseRef={mouseRef}
            dragOffsetRef={dragOffsetRef}
            onSectionChange={handleSectionChange}
          />
          <FilmPostProcessing params={filmParams} />
        </Canvas>
      </div>

      {/* 第 3 层：内容覆盖层 z-45
          文字 UI 随 section 切换淡入淡出，由 textVisible 控制 */}
      <div className="content-overlay film-content-overlay">
        <div
          className={`hero-block film-hero-block ${textVisible ? 'visible' : ''}`}
          ref={heroBlockRef}
        >
          <div className="film-section-index">
            <span className="film-index-current">0{sectionIndex + 1}</span>
            <span className="film-index-separator">/</span>
            <span className="film-index-total">0{SECTIONS.length}</span>
          </div>
          <h1 className={`hero-title film-hero-title ${textVisible ? 'visible' : ''}`}>
            {currentSection.title.split(' ').map((word, wi, arr) => (
              <span className="hero-line" key={wi}>
                {splitTextToChars(word, wi * 200, 30, textVisible)}
                {wi < arr.length - 1 && <span className="hero-char" style={{ display: 'inline-block' }}>{'\u00A0'}</span>}
              </span>
            ))}
          </h1>
          <p className={`hero-subtitle film-hero-subtitle ${textVisible ? 'visible' : ''}`}
             style={{ color: currentSection.accentColor }}>
            {currentSection.subtitle}
          </p>
          <p className={`film-description ${textVisible ? 'visible' : ''}`}>
            {currentSection.description}
          </p>
        </div>

        {/* 底部进度指示器：4 个小点，当前 section 高亮 */}
        <div className="film-progress-dots">
          {SECTIONS.map((s, i) => (
            <span
              key={i}
              className={`film-dot ${i === sectionIndex ? 'active' : ''}`}
              style={{
                backgroundColor: i === sectionIndex ? s.accentColor : 'rgba(255,255,255,0.2)',
              }}
            />
          ))}
        </div>

        <div className="scroll-hint">Scroll to switch sections</div>
      </div>
    </>
  );
}
