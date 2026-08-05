import { useRef, useState, useEffect, useCallback, useMemo, Suspense, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { FilmScene, SECTIONS, PROJECTS, ContactScene, OfficeScene } from './components/FilmScene';
import {
  FilmPostProcessing,
  DEFAULT_FILM_PARAMS,
  type FilmFXParams,
} from './components/FilmPostProcessing';
import { ContactPostProcessing } from './components/ContactPostProcessing';
import { NavBar } from './components/NavBar';
import gsap from 'gsap';

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

  // 详情模式：滚轮滚到底（镜头贴到最近）时丝滑进入对应 section 的展示页面
  // - detailOpen=true 时显示全屏详情覆盖层（项目卡片 + 完整信息）
  // - 用滞回阈值避免在边界来回抖动：进入 >0.92，退出 <0.85
  const [detailOpen, setDetailOpen] = useState(false);
  // 用于滞回判断的 ref（避免闭包读到旧 state）
  const detailOpenRef = useRef(false);
  // 详情覆盖层 ref（用于绑定原生 wheel 事件，转发到 scrollContainer）
  const detailOverlayRef = useRef<HTMLDivElement>(null);

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
   * 功能：读取滚动容器的 scrollTop，计算 0~1 的进度并写入 state；
   *      同时用滞回阈值判断是否进入详情模式：
   *       - progress > 0.92 且当前未进入 → 进入详情（detailOpen=true）
   *       - progress < 0.85 且当前已进入 → 退出详情（detailOpen=false）
   *      滞回避免在边界来回抖动，保证丝滑切换
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 用 passive 监听提升性能，避免阻塞滚动
   *  - 用 ref 读取当前 detailOpen 状态，避免闭包读到旧值
   *  - 详情进入/退出由 CSS transition 控制过渡，state 切换是离散的但视觉是丝滑的
   */
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const progress = max > 0 ? el.scrollTop / max : 0;
    setScrollProgress(progress);

    // 滞回判断详情模式
    const isOpen = detailOpenRef.current;
    if (!isOpen && progress > 0.92) {
      detailOpenRef.current = true;
      setDetailOpen(true);
    } else if (isOpen && progress < 0.85) {
      detailOpenRef.current = false;
      setDetailOpen(false);
    }
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
   * 详情覆盖层 wheel 事件转发
   *
   * 功能：详情覆盖层 pointer-events:auto 会拦截 wheel 事件，导致
   *      scrollContainer 收不到滚动 → progress 不变 → 无法退出详情。
   *      这里在覆盖层上用原生 addEventListener 监听 wheel（passive:false），
   *      阻止默认行为（避免页面/覆盖层自身滚动），把 deltaY 同步到
   *      scrollContainer.scrollTop，触发 handleScroll 更新 progress。
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 必须用 passive:false 才能 preventDefault()
   *  - 覆盖层未 visible 时 pointer-events:none，wheel 不会触发在它上面，
   *    直接到 scrollContainer，所以只在详情打开时拦截，不影响正常滚动
   *  - deltaY 同步到 scrollTop 后会触发 scroll 事件，handleScroll 中滞回
   *    判断 progress<0.85 会退出详情
   */
  useEffect(() => {
    const overlay = detailOverlayRef.current;
    if (!overlay) return;
    const onWheel = (e: WheelEvent) => {
      const el = scrollContainerRef.current;
      if (!el) return;
      e.preventDefault();
      // 把 wheel delta 同步到底层 scrollContainer
      el.scrollTop += e.deltaY;
    };
    overlay.addEventListener('wheel', onWheel, { passive: false });
    return () => overlay.removeEventListener('wheel', onWheel);
  }, []);

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

        {/* 底部进度指示器：4 个小点，当前 section 高亮
            - 容器整体居中后，再向左偏移让 active 那个点对齐屏幕水平中央
              （即对齐上方 About Us 等标题的水平中间）
            - 偏移量 = (activeIdx - (n-1)/2) × 单步间距
              n=4, (n-1)/2=1.5, 单步间距 = 8px(dot) + 14px(gap) = 22px */}
        <div
          className="film-progress-dots"
          style={{
            transform: `translateX(calc(-50% - ${(sectionIndex - (SECTIONS.length - 1) / 2) * 22}px))`,
          }}
        >
          {SECTIONS.map((s, i) => (
            <span
              key={i}
              className={`film-dot ${i === sectionIndex ? 'active' : ''}`}
              style={{
                backgroundColor: i === sectionIndex ? s.accentColor : 'rgba(255,255,255,0.2)',
                color: i === sectionIndex ? s.accentColor : 'rgba(255,255,255,0.2)',
              }}
            />
          ))}
        </div>

        <div className="scroll-hint">Scroll to switch sections</div>
      </div>

      {/* 第 4 层：详情展示覆盖层 z-60
          滚轮滚到底（progress>0.92）时丝滑淡入，展示当前 section 的完整信息
          - opacity + transform 由 CSS transition 控制（0.6s cubic-bezier）
          - detailOpen=true 时 visible class 触发淡入
          - sectionIndex === 3 (CONTACT) 时显示 shader.se/#contact 风格页面：
            独立 3D Canvas 渲染电话模型 + "Hello." 大标题 + 横向联系信息
          - 其他 section：显示项目卡片网格
          - 滚轮回退（progress<0.85）时淡出，丝滑回到 3D 场景 */}
      <div
        ref={detailOverlayRef}
        className={`film-detail-overlay ${detailOpen ? 'visible' : ''} ${sectionIndex === 3 ? 'contact-mode' : ''}`}
      >
        {sectionIndex === 3 ? (
          /* === Contact 详情页：shader.se/#contact 风格 ===
           - 独立滚动容器驱动相机下降动画
           - 初始：相机高处俯视，Hello 居中显示，看不见电话机
           - 滚动后：相机降到电话机水平，露出电话机，显示联系信息 */
          <ContactDetailPage mouseRef={mouseRef} detailOpen={detailOpen} />
        ) : sectionIndex === 2 ? (
          /* === About Us 详情页：格子间办公场景 ===
           - 独立滚动容器驱动相机下降动画
           - 初始：相机高处俯视，About Us 居中显示，看不见格子间
           - 滚动后：相机降到桌子水平，露出 8 个面对面排列的格子间 */
          <OfficeDetailPage mouseRef={mouseRef} detailOpen={detailOpen} />
        ) : sectionIndex === 1 ? (
          /* === Selected Work 详情页：无限滑动展示柜 ===
           - 移植 ArikaShow 的无限滑动实现
           - 进入后可鼠标拖拽任意方向滑动卡片矩阵
           - 卡片超出边界时瞬间回绕到对面，形成无限循环 */
          <WorkDetailPage mouseRef={mouseRef} detailOpen={detailOpen} />
        ) : (
          /* === 默认详情页：项目卡片网格 === */
          <div className="film-detail-inner">
            {/* 顶部：section 标识 + 标题 */}
            <div className="film-detail-header">
              <span
                className="film-detail-index"
                style={{ color: currentSection.accentColor }}
              >
                0{sectionIndex + 1} / 0{SECTIONS.length}
              </span>
              <h2 className="film-detail-title">{currentSection.title}</h2>
              <p
                className="film-detail-subtitle"
                style={{ color: currentSection.accentColor }}
              >
                {currentSection.subtitle}
              </p>
              <p className="film-detail-desc">{currentSection.description}</p>
            </div>

            {/* 中部：项目卡片网格（展示 PROJECTS 数据） */}
            <div className="film-detail-grid">
              {PROJECTS.map((p, i) => (
                <div
                  key={p.id}
                  className="film-detail-card"
                  style={{
                    // 卡片淡入延迟，逐个出现
                    transitionDelay: `${0.15 + i * 0.08}s`,
                  }}
                >
                  <div className="film-detail-card-thumb">
                    <img src={p.thumb} alt={p.name} />
                  </div>
                  <div className="film-detail-card-info">
                    <span className="film-detail-card-year">{p.year}</span>
                    <h3 className="film-detail-card-name">{p.name}</h3>
                    <p className="film-detail-card-tagline">{p.tagline}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* 底部：提示滚回 */}
            <div className="film-detail-footer">
              <span>Scroll up to return</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * ContactDetailPage - Contact section 详情页（shader.se/#contact 复刻）
 *
 * 功能：
 *  - 独立滚动容器驱动 contact 详情页内部滚动状态（与外层 scroll-container 解耦）
 *  - 初始状态（progress=0）：
 *      - 相机在高处俯视，lookAt 在电话机上方 → 看不见电话机
 *      - "Hello." 标题居中显示
 *  - 滚动后（progress→1）：
 *      - 相机降到电话机水平，lookAt 落到电话机 → 露出电话机
 *      - 联系信息卡片淡入
 *  - 滚轮回退到顶部（progress<0.05）后再继续滚 → 退出详情页回 3D 场景
 *  - 每次进入详情页（detailOpen false→true）时重置内部滚动状态，
 *    避免上次退出时残留的 scrollTop 导致相机直接到最低端
 *
 * 参数：
 *  - mouseRef    鼠标归一化坐标 ref（-1~1），传给 ContactScene 驱动模型视差旋转
 *  - detailOpen 外层详情页是否打开（用于在每次进入时重置滚动状态）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 滚动容器 contactScrollRef 占据整个详情页，z-30 在内容下方
 *  - 内容层 z-40 在滚动容器上方，包含 Hello 标题和联系信息
 *  - 3D Canvas 在最底层 z-0，相机随 progress 下降露出电话机
 *  - contactScrollProgress 用 ref 不用 state，避免每帧重渲染
 *  - ContactDetailPage 在 sectionIndex===3 期间保持 mount，不会因 detailOpen
 *    变化而 unmount，所以需要在 detailOpen 变 true 时手动重置滚动状态
 */
function ContactDetailPage({
  mouseRef,
  detailOpen,
}: {
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  detailOpen: boolean;
}) {
  // contact 详情页内部独立滚动容器 ref
  const contactScrollRef = useRef<HTMLDivElement>(null);
  // contact 详情页内部滚动进度 0~1（驱动相机下降）
  const contactScrollProgress = useRef(0);
  // 是否已经滚到顶部（防止滚轮回退时误触发外层退出逻辑）
  const atTopRef = useRef(true);
  // 内容层 ref（用于写入 CSS 变量 --contact-progress 驱动子元素淡入）
  const contentLayerRef = useRef<HTMLDivElement>(null);
  // contact-detail-inner 根元素 ref（用于绑定 wheel 事件，拦截滚轮）
  const contactInnerRef = useRef<HTMLDivElement>(null);

  /**
   * contact 详情页内部滚动事件处理
   *
   * 功能：读取 contactScrollRef 的 scrollTop，计算 0~1 的进度
   *      1. 写入 contactScrollProgress.current（驱动 3D 相机下降，由 useFrame 读取）
   *      2. 写入内容层的 CSS 变量 --contact-progress（驱动联系信息淡入）
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 用 passive 监听提升性能
   *  - 不触发 React 重渲染（用 ref + CSS 变量直接驱动样式）
   *  - CSS 变量驱动副标题/联系信息卡片随滚动进度淡入
   */
  const handleContactScroll = useCallback(() => {
    const el = contactScrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const progress = max > 0 ? el.scrollTop / max : 0;
    const clamped = Math.max(0, Math.min(1, progress));
    contactScrollProgress.current = clamped;
    atTopRef.current = el.scrollTop <= 0;
    // 写入 CSS 变量驱动子元素淡入（副标题/联系信息卡片）
    if (contentLayerRef.current) {
      contentLayerRef.current.style.setProperty('--contact-progress', String(clamped));
    }
  }, []);

  // 绑定滚动监听
  useEffect(() => {
    const el = contactScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    contactScrollProgress.current = 0;
    el.addEventListener('scroll', handleContactScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleContactScroll);
  }, [handleContactScroll]);

  /**
   * 进入/退出详情页时重置内部滚动状态
   *
   * 功能：监听 detailOpen 变化，每次进入详情页（detailOpen=true）时
   *      重置 contact-scroll-container 的 scrollTop 和 contactScrollProgress。
   *
   * 原因：ContactDetailPage 在 sectionIndex===3 期间保持 mount，
   *      上次退出详情页时残留的 scrollTop 不会自动清零。
   *      如果不重置，下次进入时：
   *        - scrollTop=最大值 → 用户无法继续滚动 → "滚不进去"
   *        - contactScrollProgress=1 → 相机直接在最低端 → "摄像头到最低端"
   *
   * 参数：无（通过闭包读取 detailOpen）
   * 返回值：无
   *
   * 注意事项：
   *  - 同时重置 CSS 变量 --contact-progress，让联系信息卡片回到隐藏状态
   *  - 用 requestAnimationFrame 确保重置在浏览器布局之后执行，
   *    避免 scrollTop=0 被 React 批量更新覆盖
   */
  useEffect(() => {
    if (!detailOpen) return;
    const el = contactScrollRef.current;
    if (!el) return;
    // 用 rAF 确保在 overlay .visible 过渡完成后重置，避免视觉跳变
    const raf = requestAnimationFrame(() => {
      el.scrollTop = 0;
      contactScrollProgress.current = 0;
      atTopRef.current = true;
      if (contentLayerRef.current) {
        contentLayerRef.current.style.setProperty('--contact-progress', '0');
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [detailOpen]);

  /**
   * contact 详情页根元素 wheel 事件拦截
   *
   * 功能：在 contact-detail-inner 根元素上拦截 wheel 事件，手动滚动
   *      contact-scroll-container，避免外层 overlay 的 wheel 转发逻辑
   *      拦截滚轮事件。
   *      特例：已滚到顶（scrollTop<=0）且继续上滑（deltaY<0）时，
   *      允许事件冒泡到 overlay，让外层 wheel 转发逻辑触发退出详情页。
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 必须用 passive: false 才能 preventDefault
   *  - preventDefault 阻止浏览器默认滚动行为（避免外层 scroll-container 滚动）
   *  - stopPropagation 阻止事件冒泡到 overlay，避免被外层 wheel 转发逻辑拦截
   *  - 手动把 deltaY 同步到 contactScrollRef.scrollTop，触发 scroll 事件
   *  - 滚到顶后用户继续上滑，事件冒泡到 overlay，外层 wheel 转发把 deltaY
   *    同步到 scrollContainerRef.scrollTop，触发外层 handleScroll 中
   *    progress<0.85 → 退出详情页
   *  - 监听器绑在 contact-detail-inner 而不是 contact-scroll-container，
   *    因为 contact-content-layer 的子元素（Hello 标题等）有 pointer-events: auto，
   *    鼠标在它们上面时 wheel 事件不经过 contact-scroll-container
   */
  useEffect(() => {
    const el = contactInnerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const scrollEl = contactScrollRef.current;
      if (!scrollEl) return;
      // 已滚到顶且继续上滑 → 允许冒泡到 overlay，让外层 wheel 转发逻辑触发退出
      if (scrollEl.scrollTop <= 0 && e.deltaY < 0) {
        return;
      }
      // 阻止默认行为（避免外层 scroll-container 滚动）和冒泡（避免 overlay 拦截）
      e.preventDefault();
      e.stopPropagation();
      // 手动滚动 contact-scroll-container，触发 scroll 事件 → handleContactScroll
      scrollEl.scrollTop += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={contactInnerRef} className="contact-detail-inner">
      {/* 3D Canvas：独立 WebGL 上下文渲染电话模型
          - 不开 shadows：contact 场景相机跨度大（y=18→1.5），
            阴影相机范围无法覆盖，会产生方形阴影截断
          - alpha:true 让背景透明
          - 相机初始位置在 (0, 18, 8) 高处俯视，与 ContactScene 的 camPosRef 初始值一致
            避免 mount 第一帧从 (0,8,8) 跳到 (0,18,8) 的视觉跳变
          - FOV 初始值 30，与 ContactScene 的 FOV_START 一致 */}
      <div className="contact-canvas-wrapper">
        <Canvas
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ fov: 30, near: 0.1, far: 100, position: [0, 18, 8] }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color('#000000'), 0);
          }}
        >
          <Suspense fallback={null}>
            <ContactScene
              mouseRef={mouseRef}
              contactScrollProgress={contactScrollProgress}
            />
          </Suspense>
          {/* 鱼眼 + 色散 + 暗角 后处理：随 progress 增强效果 */}
          <ContactPostProcessing progressRef={contactScrollProgress} />
        </Canvas>
      </div>

      {/* 独立滚动容器：撑出滚动空间让用户能滚动驱动相机下降
          - z-30 在 3D Canvas 之上，但低于内容层 z-40
          - pointer-events: auto 接收滚轮事件
          - 高度 = 2 倍视口高度，让滚动有足够距离让相机动画完整 */}
      <div ref={contactScrollRef} className="contact-scroll-container">
        <div className="contact-scroll-placeholder" />
      </div>

      {/* 内容层：固定全屏，包含 Hello 标题 + 联系信息
          - pointer-events: none 让滚轮事件穿透到滚动容器
          - 单独子元素 pointer-events: auto 才能交互（链接等）
          - 通过 ref 写入 --contact-progress CSS 变量驱动子元素淡入 */}
      <div ref={contentLayerRef} className="contact-content-layer">
        {/* 居中 "Hello." 大标题（逐字浮现，呼应 shader.se 的标题动画）
            - 用 .contact-hello-char span 包裹每个字符，递增 transitionDelay
            - 父级 .visible 时所有字符同时触发动画
            - text-shadow 多层叠加营造柔和发光 */}
        <h1 className="contact-hello-title">
          {'Hello.'.split('').map((ch, i) => (
            <span
              key={i}
              className="contact-hello-char"
              style={{ transitionDelay: `${0.25 + i * 0.08}s` }}
            >
              {ch === ' ' ? '\u00A0' : ch}
            </span>
          ))}
        </h1>

        {/* 副标题：联系说明（随滚动进度淡入） */}
        <p className="contact-tagline">
          Contact us about your digital project idea or general enquires.
          <br />
          Let&apos;s interface, call us today!
        </p>

        {/* 横向联系信息：三张卡片（随滚动进度淡入） */}
        <div className="contact-info-row">
          <div className="contact-info-card">
            <span className="contact-info-label">General Enquiries</span>
            <a
              href="mailto:hello@shader.se"
              className="contact-info-value"
            >
              hello@shader.se
            </a>
          </div>
          <div className="contact-info-card">
            <span className="contact-info-label">Book a call</span>
            <a
              href="https://cal.com/simon-hedlund-kglzne"
              target="_blank"
              rel="noopener noreferrer"
              className="contact-info-value"
            >
              Schedule a call →
            </a>
          </div>
          <div className="contact-info-card">
            <span className="contact-info-label">Visit us</span>
            <span className="contact-info-value">
              Laxholmstorget 3
              <br />
              602 21 Norrköping, Sweden
            </span>
          </div>
        </div>

        {/* 底部 footer：新业务邮箱 + 滚回提示 */}
        <div className="contact-footer">
          <span className="contact-footer-business">
            New business:{' '}
            <a href="mailto:ceo@shader.se">ceo@shader.se</a>
          </span>
          <span className="contact-footer-hint">Scroll up to return</span>
        </div>
      </div>
    </div>
  );
}

/**
 * OfficeDetailPage - About Us section 详情页（格子间办公场景）
 *
 * 功能：
 *  - 独立滚动容器驱动 office 详情页内部滚动状态（与外层 scroll-container 解耦）
 *  - 初始状态（progress=0）：
 *      - 相机在高处俯视，lookAt 在桌子上方 → 看不见格子间
 *      - "About Us" 标题居中显示
 *  - 滚动后（progress→1）：
 *      - 相机降到桌子水平，lookAt 落到桌面 → 露出 8 个面对面排列的格子间
 *      - About Us 描述卡片淡入
 *  - 滚轮回退到顶部（progress<0.05）后再继续滚 → 退出详情页回 3D 场景
 *  - 每次进入详情页（detailOpen false→true）时重置内部滚动状态
 *
 * 参数：
 *  - mouseRef    鼠标归一化坐标 ref（-1~1），传给 OfficeScene 驱动模型视差旋转
 *  - detailOpen 外层详情页是否打开（用于在每次进入时重置滚动状态）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 复用 ContactDetailPage 的滚动 + 视差机制，仅替换场景和文案
 *  - 不使用 ContactPostProcessing（避免鱼眼扭曲格子间的几何感）
 */
function OfficeDetailPage({
  mouseRef,
  detailOpen,
}: {
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  detailOpen: boolean;
}) {
  // office 详情页内部独立滚动容器 ref
  const officeScrollRef = useRef<HTMLDivElement>(null);
  // office 详情页内部滚动进度 0~1（驱动相机下降）
  const officeScrollProgress = useRef(0);
  // 是否已经滚到顶部（防止滚轮回退时误触发外层退出逻辑）
  const atTopRef = useRef(true);
  // 内容层 ref（用于写入 CSS 变量 --office-progress 驱动子元素淡入）
  const contentLayerRef = useRef<HTMLDivElement>(null);
  // office-detail-inner 根元素 ref（用于绑定 wheel 事件，拦截滚轮）
  const officeInnerRef = useRef<HTMLDivElement>(null);
  // 视差变形层 ref（写入 --px/--py/--rx/--ry 驱动标题 3D 视差）
  const officeHeroBlockRef = useRef<HTMLDivElement>(null);

  /**
   * office 详情页内部滚动事件处理
   *
   * 功能：读取 officeScrollRef 的 scrollTop，计算 0~1 的进度
   *      1. 写入 officeScrollProgress.current（驱动 3D 相机下降）
   *      2. 写入内容层的 CSS 变量 --office-progress（驱动描述卡片淡入）
   *
   * 参数：无
   * 返回值：无
   */
  const handleOfficeScroll = useCallback(() => {
    const el = officeScrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const progress = max > 0 ? el.scrollTop / max : 0;
    const clamped = Math.max(0, Math.min(1, progress));
    officeScrollProgress.current = clamped;
    atTopRef.current = el.scrollTop <= 0;
    if (contentLayerRef.current) {
      contentLayerRef.current.style.setProperty('--office-progress', String(clamped));
    }
  }, []);

  // 绑定滚动监听
  useEffect(() => {
    const el = officeScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    officeScrollProgress.current = 0;
    el.addEventListener('scroll', handleOfficeScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleOfficeScroll);
  }, [handleOfficeScroll]);

  /**
   * 鼠标视差处理
   *
   * 功能：监听全局鼠标移动，写入 CSS 变量 --px/--py/--rx/--ry 到视差变形层，
   *      驱动 .office-hello-title 做 3D 旋转 + 位移，营造视差感
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 用 rAF 节流，避免高频 mousemove 引起重渲染
   *  - 位移幅度 6px + 旋转 ±6°（与主页 hero-block 一致）
   *  - 通过 mouseRef 共享鼠标坐标（同时驱动 3D 相机视差旋转）
   */
  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        const el = officeHeroBlockRef.current;
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
  }, [mouseRef]);

  /**
   * 进入/退出详情页时重置内部滚动状态
   *
   * 功能：监听 detailOpen 变化，每次进入详情页时重置 scrollTop 和 progress，
   *      避免上次退出时残留的 scrollTop 导致下次进入时相机直接到最低端
   *
   * 参数：无（通过闭包读取 detailOpen）
   * 返回值：无
   */
  useEffect(() => {
    if (!detailOpen) return;
    const el = officeScrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = 0;
      officeScrollProgress.current = 0;
      atTopRef.current = true;
      if (contentLayerRef.current) {
        contentLayerRef.current.style.setProperty('--office-progress', '0');
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [detailOpen]);

  /**
   * office 详情页根元素 wheel 事件拦截
   *
   * 功能：在 office-detail-inner 根元素上拦截 wheel 事件，手动滚动
   *      office-scroll-container，避免外层 overlay 的 wheel 转发逻辑拦截。
   *      特例：已滚到顶（scrollTop<=0）且继续上滑（deltaY<0）时，
   *      允许事件冒泡到 overlay，让外层 wheel 转发逻辑触发退出详情页。
   *
   * 参数：无
   * 返回值：无
   */
  useEffect(() => {
    const el = officeInnerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const scrollEl = officeScrollRef.current;
      if (!scrollEl) return;
      // 已滚到顶且继续上滑 → 允许冒泡到 overlay，让外层 wheel 转发逻辑触发退出
      if (scrollEl.scrollTop <= 0 && e.deltaY < 0) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      scrollEl.scrollTop += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={officeInnerRef} className="contact-detail-inner">
      {/* 3D Canvas：独立 WebGL 上下文渲染格子间场景
          - 相机初始位置在高处远处（与 OfficeScene 起点风格一致）
          - OfficeScene 的 useFrame 会根据模型实际尺寸动态 lerp 到正确位置
          - 初始值设一个合理高位避免 mount 第一帧视觉跳变 */}
      <div className="contact-canvas-wrapper">
        <Canvas
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ fov: 55, near: 0.1, far: 5000, position: [0, 1000, 0] }}
          shadows
          onCreated={({ gl }) => {
            // 米黄色背景：暖调办公空间氛围
            gl.setClearColor(new THREE.Color('#f5e6c8'), 1);
          }}
        >
          <Suspense fallback={null}>
            <OfficeScene
              mouseRef={mouseRef}
              officeScrollProgress={officeScrollProgress}
            />
          </Suspense>
        </Canvas>
      </div>

      {/* 独立滚动容器：撑出滚动空间让用户能滚动驱动相机下降 */}
      <div ref={officeScrollRef} className="contact-scroll-container">
        <div className="contact-scroll-placeholder" />
      </div>

      {/* 内容层：固定全屏，包含 About Us 标题 + 描述卡片
          - pointer-events: none 让滚轮事件穿透到滚动容器
          - 通过 ref 写入 --office-progress CSS 变量驱动子元素淡入
          - 内嵌 office-hero-block 包裹标题，写入 --px/--py/--rx/--ry 驱动 3D 视差 */}
      <div ref={contentLayerRef} className="office-content-layer">
        {/* 视差变形层：鼠标移动时整体做 3D 旋转 + 位移 */}
        <div ref={officeHeroBlockRef} className="office-hero-block">
          {/* 居中 "About Us." 大标题（逐字浮现 + 鼠标视差变形） */}
          <h1 className="office-hello-title">
            {'About Us.'.split('').map((ch, i) => (
              <span
                key={i}
                className="office-hello-char"
                style={{ transitionDelay: `${0.25 + i * 0.08}s` }}
              >
                {ch === ' ' ? '\u00A0' : ch}
              </span>
            ))}
          </h1>
        </div>

        {/* 副标题：联系说明（随滚动进度淡入） */}
        <p className="office-tagline">
          Playful, Powerful, Alive.
          <br />
          Serious about business, based in Sweden.
        </p>

        {/* 横向信息卡片：三张（随滚动进度淡入） */}
        <div className="office-info-row">
          <div className="office-info-card">
            <span className="office-info-label">Team</span>
            <span className="office-info-value">
              12 designers & engineers
            </span>
          </div>
          <div className="office-info-card">
            <span className="office-info-label">Founded</span>
            <span className="office-info-value">
              2018 in Norrköping
            </span>
          </div>
          <div className="office-info-card">
            <span className="office-info-label">Studio</span>
            <span className="office-info-value">
              Laxholmstorget 3
              <br />
              602 21 Norrköping, Sweden
            </span>
          </div>
        </div>

        {/* 底部 footer：业务邮箱 + 滚回提示 */}
        <div className="office-footer">
          <span className="office-footer-business">
            Careers:{' '}
            <a href="mailto:jobs@shader.se">jobs@shader.se</a>
          </span>
          <span className="office-footer-hint">Scroll up to return</span>
        </div>
      </div>
    </div>
  );
}

/**
 * WorkDetailPage - SELECTED WORK section 详情页（无限滑动展示柜）
 *
 * 功能：
 *  - 移植 ArikaShow 的无限滑动实现，用 GSAP 驱动卡片网格做无限拖拽浏览
 *  - 进入后用户可鼠标拖拽（或触摸）任意方向滑动卡片矩阵
 *  - 卡片超出容器边界时瞬间回绕到对面，形成无限循环错觉
 *  - 滚轮回退（progress<0.85）时退出回 3D 场景（由外层 overlay 处理）
 *  - 每次进入详情页（detailOpen false→true）时重新计算布局尺寸
 *
 * 参数：
 *  - mouseRef    鼠标归一化坐标 ref（保持接口一致，本组件不使用 3D 相机视差）
 *  - detailOpen 外层详情页是否打开（用于在每次进入时重置布局）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 核心算法移植自 ArikaShow/js/slip.js 的 photobox 对象
 *  - 每张卡片记录初始位置 (x,y) 和累积偏移 (mov_x,mov_y)
 *  - 边界回绕规则（提前半个卡片尺寸消除跳变）：
 *      右溢出 → mov_x -= container_width（跳到左边）
 *      左溢出 → mov_x += container_width（跳到右边）
 *      下溢出 → mov_y -= container_height（跳到上边）
 *      上溢出 → mov_y += container_height（跳到下边）
 *  - 回绕时 GSAP duration=0 立即跳转，正常拖拽 duration=1 平滑过渡
 *  - 容器整体 scale 适配不同屏幕（基准宽度 1440px）
 *  - 卡片数据循环复用 PROJECTS（7 列 × 4 行 = 28 张）
 */
function WorkDetailPage({
  mouseRef,
  detailOpen,
}: {
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  detailOpen: boolean;
}) {
  // 无限滑动容器 ref（.work-photos，用于获取尺寸和绑定拖拽事件）
  const photosRef = useRef<HTMLDivElement>(null);
  // 详情页根元素 ref（用于绑定 wheel 事件，让外层 overlay 处理退出）
  const innerRef = useRef<HTMLDivElement>(null);
  // 视差变形层 ref（写入 --px/--py/--rx/--ry 驱动标题 3D 视差）
  const heroBlockRef = useRef<HTMLDivElement>(null);

  /**
   * 卡片位置索引数据结构
   *
   * 字段说明：
   *  - node  卡片 DOM 节点（GSAP 操作目标）
   *  - x,y   初始 offsetLeft/offsetTop（resize 时记录，回绕判定基准）
   *  - mov_x,mov_y 累积偏移量（拖拽时累加，回绕时 ±容器尺寸）
   *  - ani    当前 GSAP 动画引用（新动画前 kill 旧的避免冲突）
   */
  type ImgData = {
    node: HTMLElement;
    x: number;
    y: number;
    mov_x: number;
    mov_y: number;
    ani: gsap.core.Tween | null;
  };
  const imgDataRef = useRef<ImgData[]>([]);

  /**
   * 容器/卡片尺寸缓存（resize 时更新，move 时读取）
   *
   * 字段说明：
   *  - containerWidth/Height 容器实际尺寸（回绕判定边界）
   *  - photoWidth/Height     单张卡片尺寸（提前回绕阈值 = ±半张卡片）
   *  - scaleNums             当前视口相对基准宽度的缩放比例
   *  - standardWidth         设计基准宽度 1440px
   */
  const dimsRef = useRef({
    containerWidth: 0,
    containerHeight: 0,
    photoWidth: 0,
    photoHeight: 0,
    scaleNums: 1,
    standardWidth: 1440,
  });

  /**
   * 拖拽状态（移植 ArikaShow photobox 的拖拽字段）
   *
   * 字段说明：
   *  - ifMovable      是否正在拖动（mousedown 触发，mouseup/mouseleave 取消）
   *  - mouseX/Y       上一帧鼠标坐标（用于计算本帧位移）
   *  - dragStartX/Y   mousedown 起始坐标（用于判断是否是拖拽还是点击）
   *  - hasDragged     是否已确认拖拽（移动超过阈值后置 true）
   *  - dragThreshold  拖拽确认阈值 5px（避免点击误触）
   */
  const dragRef = useRef({
    ifMovable: false,
    mouseX: 0,
    mouseY: 0,
    dragStartX: 0,
    dragStartY: 0,
    hasDragged: false,
    dragThreshold: 5,
  });

  /**
   * 卡片数据：4 行 × 7 列 = 28 张，循环复用 PROJECTS（移植自原版结构）
   *
   * 结构说明：
   *  - 按行分组：外层数组每项是一行，内层数组是行内的 7 张卡片
   *  - 索引计算：rowIdx * cols + colIdx（与 ArikaShow 的 HTML 结构一致）
   *  - project 字段循环复用 PROJECTS 数据（4 个项目循环填充 28 张卡片）
   *  - unit 字段：UNIT_01 ~ UNIT_28 编号（呼应 ArikaShow 的卡片标签）
   */
  const cardRows = useMemo(() => {
    const rows = 4;
    const cols = 7;
    return Array.from({ length: rows }, (_, rowIdx) =>
      Array.from({ length: cols }, (_, colIdx) => {
        const i = rowIdx * cols + colIdx;
        const project = PROJECTS[i % PROJECTS.length];
        return {
          id: `work-card-${i}`,
          index: i + 1,
          unit: `UNIT_${String(i + 1).padStart(2, '0')}`,
          project,
        };
      })
    );
  }, []);

  /**
   * 重新计算布局尺寸并重建位置索引
   *
   * 功能：
   *  - 读取容器和卡片的实际像素尺寸
   *  - 计算缩放比例 scaleNums = 视口宽度 / 基准宽度 1440
   *  - 对容器整体应用 scale(scaleNums) 适配不同屏幕
   *  - 重置所有卡片偏移量为 0（清除残留的 translate）
   *  - 遍历所有卡片，读取 offsetLeft/offsetTop 重建 img_data 位置索引
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 必须在 DOM 渲染完成后调用（useEffect + detailOpen 触发）
   *  - resize 时会重置所有动画和偏移，卡片回到初始网格位置
   *  - offsetLeft/offsetTop 是相对 offsetParent 的坐标，需确保父级有定位
   */
  const resize = useCallback(() => {
    const container = photosRef.current;
    if (!container) return;
    const cards = container.querySelectorAll<HTMLElement>('.work-photo-card');
    if (cards.length === 0) return;

    const dims = dimsRef.current;
    dims.containerWidth = container.offsetWidth;
    dims.containerHeight = container.offsetHeight;
    dims.photoWidth = cards[0].offsetWidth;
    dims.photoHeight = cards[0].offsetHeight;
    dims.scaleNums = document.body.offsetWidth / dims.standardWidth;
    // 用 CSS 变量设置 scale，避免直接写 style.transform 覆盖视差变量
    // （CSS 中 .work-photos 的 transform 同时包含 scale 和视差变形）
    container.style.setProperty('--scale', String(dims.scaleNums));

    // 重置所有卡片偏移量并清除动画
    gsap.to(Array.from(cards), {
      transform: 'translate(0,0)',
      duration: 0,
      ease: 'power4.out',
    });

    // 重建位置索引数组
    imgDataRef.current = Array.from(cards).map(card => ({
      node: card,
      x: card.offsetLeft,
      y: card.offsetTop,
      mov_x: 0,
      mov_y: 0,
      ani: null,
    }));
  }, []);

  /**
   * 处理单帧拖拽位移（无限滑动核心算法，移植自 ArikaShow photobox.move）
   *
   * 功能：
   *  - 计算本帧相对上一帧的位移（经缩放补偿除以 scaleNums）
   *  - 累加到每张卡片的 mov_x/mov_y
   *  - 当卡片完全离开容器可视区域时，瞬间调整偏移量使其从对面出现（回绕）
   *  - 回绕时 GSAP duration=0 立即跳转，正常拖拽 duration=1 平滑过渡
   *
   * 参数：
   *  - x {number} 当前鼠标屏幕 X 坐标
   *  - y {number} 当前鼠标屏幕 Y 坐标
   *
   * 返回值：无
   *
   * 注意事项：
   *  - 边界判定与原版一致：卡片完全离开容器才回绕
   *      右溢出：img.x + img.mov_x > containerWidth（卡片左边超出容器右边）
   *      左溢出：img.x + img.mov_x < -photoWidth（卡片右边超出容器左边）
   *      下溢出：img.y + img.mov_y > containerHeight
   *      上溢出：img.y + img.mov_y < -photoHeight
   *  - 不能提前回绕，否则卡片还未离开视口就跳到对面，造成重叠遮挡
   *  - 新动画前 kill 旧动画，避免 GSAP 动画堆叠冲突
   *  - 位移需除以 scaleNums 补偿容器整体缩放（缩放后鼠标实际拖动距离变小）
   */
  const move = useCallback((x: number, y: number) => {
    const drag = dragRef.current;
    if (!drag.ifMovable) return;
    const dims = dimsRef.current;
    const distanceX = (x - drag.mouseX) / dims.scaleNums;
    const distanceY = (y - drag.mouseY) / dims.scaleNums;

    imgDataRef.current.forEach(img => {
      let duration = 1;
      img.mov_x += distanceX;
      // X 轴右溢出：卡片左边超出容器右边 → 跳到左边
      if (img.x + img.mov_x > dims.containerWidth) {
        img.mov_x -= dims.containerWidth;
        duration = 0;
      }
      // X 轴左溢出：卡片右边超出容器左边 → 跳到右边
      if (img.x + img.mov_x < -dims.photoWidth) {
        img.mov_x += dims.containerWidth;
        duration = 0;
      }
      img.mov_y += distanceY;
      // Y 轴下溢出：卡片上边超出容器下边 → 跳到上边
      if (img.y + img.mov_y > dims.containerHeight) {
        img.mov_y -= dims.containerHeight;
        duration = 0;
      }
      // Y 轴上溢出：卡片下边超出容器上边 → 跳到下边
      if (img.y + img.mov_y < -dims.photoHeight) {
        img.mov_y += dims.containerHeight;
        duration = 0;
      }
      // kill 旧动画避免冲突，启动新动画
      if (img.ani) img.ani.kill();
      img.ani = gsap.to(img.node, {
        transform: `translate(${img.mov_x}px,${img.mov_y}px)`,
        duration,
        ease: 'power4.out',
      });
    });
    drag.mouseX = x;
    drag.mouseY = y;
  }, []);

  /**
   * 鼠标拖拽事件绑定
   *
   * 功能：
   *  - mousedown：标记可拖动，记录起始坐标
   *  - mousemove：检测是否确认拖拽（移动超过阈值），执行 move() 位移
   *  - mouseup/mouseleave：结束拖动，恢复 cursor
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 拖拽阈值 5px，避免点击误触
   *  - 拖拽时设置 cursor: grabbing 提示用户
   *  - mousemove 绑定在 document 上，避免鼠标移出容器后丢失追踪
   */
  useEffect(() => {
    const container = photosRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // 仅左键
      // 阻止事件冒泡到 window，避免触发外层 KiraFilmDemo 的
      // section 左右拖拽切换逻辑（dragOffsetRef 改变会导致背景 section 切换）
      e.stopPropagation();
      const drag = dragRef.current;
      drag.ifMovable = true;
      drag.hasDragged = false;
      drag.mouseX = e.clientX;
      drag.mouseY = e.clientY;
      drag.dragStartX = e.clientX;
      drag.dragStartY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag.ifMovable) return;
      // 检测是否确认拖拽（移动距离超过阈值）
      if (!drag.hasDragged) {
        const dx = e.clientX - drag.dragStartX;
        const dy = e.clientY - drag.dragStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > drag.dragThreshold) {
          drag.hasDragged = true;
          document.body.style.cursor = 'grabbing';
        }
      }
      move(e.clientX, e.clientY);
    };

    const endDrag = () => {
      const drag = dragRef.current;
      if (drag.ifMovable) {
        drag.ifMovable = false;
        document.body.style.cursor = '';
      }
    };

    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', endDrag);
    container.addEventListener('mouseleave', endDrag);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', endDrag);
      container.removeEventListener('mouseleave', endDrag);
      document.body.style.cursor = '';
    };
  }, [move]);

  /**
   * 触摸拖拽事件绑定（移动端支持）
   *
   * 功能：与鼠标拖拽逻辑一致，适配 touchstart/touchmove/touchend
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - touch 事件用 passive 监听，不阻止默认行为（保留页面滚动可能）
   *  - 读取 touches[0] 的 clientX/clientY
   */
  useEffect(() => {
    const container = photosRef.current;
    if (!container) return;

    const onTouchStart = (e: TouchEvent) => {
      // 阻止冒泡，与鼠标拖拽一致（避免触发外层 section 切换逻辑）
      e.stopPropagation();
      const t = e.touches[0];
      const drag = dragRef.current;
      drag.ifMovable = true;
      drag.hasDragged = false;
      drag.mouseX = t.clientX;
      drag.mouseY = t.clientY;
      drag.dragStartX = t.clientX;
      drag.dragStartY = t.clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag.ifMovable) return;
      const t = e.touches[0];
      if (!drag.hasDragged) {
        const dx = t.clientX - drag.dragStartX;
        const dy = t.clientY - drag.dragStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > drag.dragThreshold) {
          drag.hasDragged = true;
        }
      }
      move(t.clientX, t.clientY);
    };

    const onTouchEnd = () => {
      dragRef.current.ifMovable = false;
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [move]);

  /**
   * 窗口 resize 监听
   *
   * 功能：窗口尺寸变化时重新计算布局，重置卡片位置
   *
   * 参数：无
   * 返回值：无
   */
  useEffect(() => {
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resize]);

  /**
   * 进入/退出详情页时重新计算布局
   *
   * 功能：监听 detailOpen 变化，每次进入详情页（detailOpen=true）时
   *      延迟一帧后调用 resize() 重新计算尺寸（确保 DOM 已渲染完成）
   *
   * 参数：无（通过闭包读取 detailOpen）
   * 返回值：无
   *
   * 注意事项：
   *  - 用 rAF 延迟一帧，确保 overlay 的 visible 过渡完成后 DOM 尺寸稳定
   *  - 退出时不需要 resize（下次进入时会重新计算）
   */
  useEffect(() => {
    if (!detailOpen) return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => resize());
    });
    return () => cancelAnimationFrame(raf);
  }, [detailOpen, resize]);

  /**
   * 鼠标视差处理（标题 + 卡片网格 3D 变形）
   *
   * 功能：监听全局鼠标移动，同时驱动两层视差：
   *   1. 标题层（.work-hero-block）：写入 --px/--py 位移 6px + --rx/--ry 旋转 ±6°
   *   2. 卡片网格层（.work-photos）：写入 --px/--py 位移 14px + --rx/--ry 旋转 ±4°
   *      幅度比标题更大，让卡片网格整体跟着鼠标倾斜，增强空间纵深感
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 用 rAF 节流，避免高频 mousemove 引起重渲染
   *  - 卡片网格的视差变量与 scale 变量在 CSS transform 中组合（不会互相覆盖）
   *  - 旋转方向：鼠标在右上 → 网格向右倾斜（rotateY 正值）+ 向上仰（rotateX 负值）
   *  - 通过 mouseRef 共享鼠标坐标
   */
  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        // 标题层视差：6px 位移 + 6deg 旋转
        const heroEl = heroBlockRef.current;
        if (heroEl) {
          heroEl.style.setProperty('--px', `${nx * 6}px`);
          heroEl.style.setProperty('--py', `${ny * 6}px`);
          heroEl.style.setProperty('--rx', `${ny * 6}deg`);
          heroEl.style.setProperty('--ry', `${nx * 6}deg`);
        }
        // 卡片网格层视差：14px 位移 + 4deg 旋转（幅度更大，增强空间感）
        const photosEl = photosRef.current;
        if (photosEl) {
          photosEl.style.setProperty('--px', `${nx * 14}px`);
          photosEl.style.setProperty('--py', `${ny * 14}px`);
          photosEl.style.setProperty('--rx', `${-ny * 4}deg`);
          photosEl.style.setProperty('--ry', `${nx * 4}deg`);
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
  }, [mouseRef]);

  return (
    <div ref={innerRef} className="work-detail-inner">
      {/* 色散 + 边缘虚化变形：纯 CSS 实现（避免 SVG filter 的 JSX 解析问题）
          - 色散：.work-photo-card 上 filter:drop-shadow 实现 R/B 通道偏移
          - 边缘虚化：.work-photos 上 mask-image 径向渐变让边缘渐隐
          - 暗角：.work-vignette-overlay 径向渐变 + multiply 混合
          - 边缘渐隐：.work-edge-fade-overlay 径向渐变覆盖
          - 与主页面的 FilmPostProcessing shader 效果对应 */}

      {/* 暗角覆盖层：模拟主页面 shader 的 vignette 暗角效果
          - 径向渐变从透明到黑色，让画面四周渐暗
          - pointer-events: none 不拦截鼠标，让拖拽穿透到卡片网格
          - mix-blend-mode: multiply 让暗角与下层内容相乘混合 */}
      <div className="work-vignette-overlay" aria-hidden="true" />

      {/* 色散边缘渐隐覆盖层：模拟主页面 shader 的 edge mask 效果
          - 径向渐变从中心透明到边缘黑色，让色散在边缘更明显
          - pointer-events: none 不拦截鼠标 */}
      <div className="work-edge-fade-overlay" aria-hidden="true" />

      {/* 顶部 header：SELECTED WORK 标识 + 状态指示
          - heroBlockRef 绑定标题区，写入 --px/--py/--rx/--ry 驱动 3D 视差 */}
      <header className="work-header">
        <div ref={heroBlockRef} className="work-hero-block">
          <div className="work-header-title">SELECTED WORK</div>
          <div className="work-header-subtitle">// 精 选 作 品</div>
        </div>
        <div className="work-header-status">
          <span className="work-status-text">SYS:ONLINE</span>
          <div className="work-status-dot" />
        </div>
      </header>

      {/* 拖拽提示 */}
      <div className="work-drag-hint">◄ DRAG TO EXPLORE ►</div>

      {/* 无限滑动卡片容器（移植自原版 .photos 结构）
          - .work-photos: 容器（absolute, column, overflow hidden, scale 由 JS 写入）
          - .work-photos-row: 行（横向排列 7 张卡片）
          - .work-photo-card: 单张卡片（GSAP 操作 translate） */}
      <div ref={photosRef} className="work-photos">
        {cardRows.map((row, rowIdx) => (
          <div key={`row-${rowIdx}`} className="work-photos-row">
            {row.map(card => (
              <div
                key={card.id}
                className="work-photo-card"
                data-project={card.project.id}
              >
                {/* 四角装饰（复古胶片风） */}
                <span className="work-corner work-corner--tl" />
                <span className="work-corner work-corner--tr" />
                <span className="work-corner work-corner--bl" />
                <span className="work-corner work-corner--br" />
                {/* 项目缩略图（gif 自动播放） */}
                <img
                  src={card.project.thumb}
                  alt={card.project.name}
                  draggable={false}
                />
                {/* 卡片标签 + 编号 + 项目名 + 年份 */}
                <span className="work-card-label">{card.unit}</span>
                <span className="work-card-index">
                  #{String(card.index).padStart(3, '0')}
                </span>
                <span className="work-card-name">{card.project.name}</span>
                <span className="work-card-year">{card.project.year}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 底部 footer：版本标识 + 拖拽提示 */}
      <footer className="work-footer">
        <span>SELECTED WORK // SHOWCASE</span>
        <span>DRAG TO NAVIGATE ◄►</span>
      </footer>
    </div>
  );
}
