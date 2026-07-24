import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { ComputerScene } from './components/ComputerScene';
import { LoadingScreen } from './components/LoadingScreen';
import { NavBar } from './components/NavBar';

/**
 * 把字符串拆成逐字 span（用于逐字浮现动画）
 *
 * 功能：将传入的字符串按字符拆分，每个字符包进一个 <span class="hero-char">，
 *      并根据字符索引递增设置 transitionDelay，实现"一个一个字蹦出来"的效果。
 *      空格会渲染为不可折叠的空白 span，避免被 HTML 合并。
 *
 * 参数：
 *  - text     {string} 要拆分的字符串
 *  - baseDelay{number} 该字符串起始延迟（ms），用于跨行衔接
 *  - step     {number} 每个字符之间的延迟间隔（ms）
 *
 * 返回值：ReactNode[] 每个字符对应的 span 节点数组
 *
 * 异常：无
 *
 * 注意事项：
 *  - 空格用 \u00A0（不间断空格）替换，防止行内空白被折叠
 *  - 每个字符 span 设置 inline style 的 transitionDelay，CSS 动画由此触发
 */
function splitTextToChars(text: string, baseDelay: number, step: number): ReactNode[] {
  return Array.from(text).map((ch, i) => (
    <span
      key={`${text}-${i}`}
      className="hero-char"
      style={{ transitionDelay: `${baseDelay + i * step}ms` }}
    >
      {ch === ' ' ? '\u00A0' : ch}
    </span>
  ));
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
  // 滚动进度 0~1，用于驱动 3D 场景
  const [scrollProgress, setScrollProgress] = useState(0);
  // 模型加载状态
  const [loaded, setLoaded] = useState(false);
  // 首屏标题是否已显现
  const [titleVisible, setTitleVisible] = useState(false);
  // 鼠标视差偏移量（写入 CSS 变量，供 hero-block 使用）
  const heroBlockRef = useRef<HTMLDivElement>(null);
  // 共享鼠标归一化坐标（-1~1），供 3D 相机视差旋转使用
  // 用 ref 避免高频 setState 引起重渲染，ComputerScene 在 useFrame 里直接读取
  const mouseRef = useRef({ x: 0, y: 0 });

  /**
   * 滚动事件处理
   * 功能：读取滚动容器的 scrollTop，计算 0~1 的进度并写入 state
   * 参数：无
   * 返回值：无
   */
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const progress = max > 0 ? el.scrollTop / max : 0;
    setScrollProgress(progress);
  }, []);

  // 绑定滚动监听（passive 提升性能）
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

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

      {/* 顶部导航 */}
      <NavBar />

      {/* 第 1 层：滚动容器 z-50 */}
      <div
        ref={scrollContainerRef}
        className="scroll-container"
      >
        {/* 虚拟高度占位，撑出滚动空间 */}
        <div className="scroll-placeholder" />
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
          camera={{ fov: 35, near: 0.1, far: 1000, position: [0, 0, 8] }}
          onCreated={({ gl }) => {
            // 设置透明背景，让 body 的 #0a0a0a 显出来
            gl.setClearColor(new THREE.Color('#0a0a0a'), 1);
          }}
        >
          <ComputerScene
            scrollProgress={scrollProgress}
            onLoaded={() => setLoaded(true)}
            mouseRef={mouseRef}
          />
        </Canvas>
      </div>

      {/* 第 3 层：内容覆盖层 z-45 */}
      <div className="content-overlay">
        <div className="hero-block" ref={heroBlockRef}>
          <h1 className={`hero-title ${titleVisible ? 'visible' : ''}`}>
            <span className="hero-line">
              {splitTextToChars('A Creative', 0, 30)}
            </span>
            <span className="hero-line">
              {splitTextToChars('Developer,Plugged', 350, 30)}
            </span>
            <span className="hero-line">
              {splitTextToChars('into the Future', 950, 30)}
            </span>
          </h1>
          <p
            className={`hero-subtitle ${titleVisible ? 'visible' : ''}`}
            style={{ transitionDelay: '1500ms' }}
          >
            Scroll to Inspect Our Closed Deals
          </p>
        </div>
        <div className="scroll-hint">Scroll to Explore</div>
      </div>
    </>
  );
}
