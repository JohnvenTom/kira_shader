import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, useTexture } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Section 内容定义
 *
 * 功能：描述每个 section 在屏幕上显示的内容
 *
 * 字段说明：
 *  - title       主标题（大字）
 *  - subtitle    副标题（小字）
 *  - accentColor 主色（屏幕发光颜色，hex 字符串）
 *  - description 描述文字（小字，屏幕下方）
 */
export interface SectionContent {
  title: string;
  subtitle: string;
  accentColor: string;
  description: string;
}

/**
 * 4 个 section 内容（参考 shader.se 的结构）
 *
 * 注意事项：accentColor 会同时驱动屏幕发光颜色和 RectAreaLight 颜色
 */
export const SECTIONS: SectionContent[] = [
  {
    title: 'CREATIVE STUDIO',
    subtitle: 'Plugged into the Future',
    accentColor: '#ff8a3d',
    description: 'Interactive 3D and AI solutions for the web.',
  },
  {
    title: 'SELECTED WORK',
    subtitle: 'Browse our projects',
    accentColor: '#4dc4ff',
    description: 'eHealth Arena · 3D Showroom · AR experience.',
  },
  {
    title: 'ABOUT US',
    subtitle: 'Playful, Powerful, Alive',
    accentColor: '#b678ff',
    description: 'Serious about business, based in Sweden.',
  },
  {
    title: 'CONTACT',
    subtitle: "Let's interface",
    accentColor: '#7dffae',
    description: 'hello@shader.se · Norrköping, Sweden',
  },
];

/**
 * 项目缩略图信息（用于 SELECTED WORK section 轮播）
 *
 * 字段说明：
 *  - id       项目唯一标识
 *  - name     项目名（屏幕上显示）
 *  - tagline  一句话描述
 *  - thumb    缩略图 URL（gif 动图，DOM <img> 可直接播放）
 *  - year     项目年份
 *
 * 注意事项：gif 在 DOM <img> 中原生播放，无需 gifuct-js 解码
 */
export interface ProjectItem {
  id: string;
  name: string;
  tagline: string;
  thumb: string;
  year: string;
}

export const PROJECTS: ProjectItem[] = [
  {
    id: 'ehealth',
    name: 'eHealth Arena',
    tagline: 'Interactive medical visualization',
    thumb: '/asset/textures/projects/project-1.gif',
    year: '2024',
  },
  {
    id: 'showroom',
    name: '3D Showroom',
    tagline: 'WebGL product configurator',
    thumb: '/asset/textures/projects/project-2.gif',
    year: '2024',
  },
  {
    id: 'ar-experience',
    name: 'AR Experience',
    tagline: 'Augmented reality for retail',
    thumb: '/asset/textures/projects/project-3.gif',
    year: '2023',
  },
  {
    id: 'shader-lab',
    name: 'Shader Lab',
    tagline: 'Real-time graphics R&D',
    thumb: '/asset/textures/projects/project-4.gif',
    year: '2023',
  },
];

/**
 * hex 颜色转 RGB
 *
 * 参数：
 *  - hex {string} 形如 '#ff8a3d'
 *
 * 返回值：{r, g, b} 0~255 整数
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

/**
 * smoothstep 平滑函数
 *
 * 参数：
 *  - edge0 {number} 下界
 *  - edge1 {number} 上界
 *  - x     {number} 输入值
 *
 * 返回值：[0, 1] 平滑过渡
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 屏幕文字组件（用 R3F <Html> 投影到 3D 屏幕平面）
 *
 * 功能：
 *  - 用 drei 的 <Html transform> 模式，把 DOM 文字元素变换到 3D 屏幕平面上
 *  - 文字随相机推近而放大（保持与屏幕内容一致的透视感）
 *  - section 切换时随 transitionFlash 淡出（被闪光掩盖）
 *  - 文字样式由 CSS 控制（.screen-text-content 等），便于精确排版
 *
 * 参数：
 *  - sectionIndex       当前 section 索引（0~3）
 *  - transitionFlashRef 切换闪光强度 ref（每帧读取，调整透明度）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - transform 模式让 DOM 跟随 3D 变换，但仍为 DOM 元素（不受后处理 bloom/色散影响）
 *  - 用 CSS text-shadow/drop-shadow 模拟辉光与色散，呼应屏幕的复古感
 *  - position z=0.01 略高于屏幕平面，避免与 planeGeometry 的 z-fighting
 *  - DOM 容器 1024×768px，scale=4/1024 让其对应 3D 空间的 4×3 单位（屏幕 plane 大小）
 *  - pointer-events: none 避免拦截滚动
 */
function ScreenText({
  sectionIndex,
  transitionFlashRef,
}: {
  sectionIndex: number;
  transitionFlashRef: React.MutableRefObject<number>;
}) {
  const section = SECTIONS[sectionIndex];
  const containerRef = useRef<HTMLDivElement>(null);

  // 每帧：根据 transitionFlash 调整透明度（闪光时淡出掩盖切换）
  useFrame(() => {
    if (!containerRef.current) return;
    const flash = transitionFlashRef.current;
    // 闪光峰值时文字完全透明（被白色屏幕掩盖）
    containerRef.current.style.opacity = `${1 - flash}`;
  });

  // scale：让 DOM 的 1024px 对应 3D 空间的 4 单位（屏幕 plane 宽度）
  // drei <Html transform> 内部有归一化因子，实测 scale=4/1024 时文字仅 ~13px，
  // 需放大到 ~0.156 才能让 DOM 与 3D 屏幕投影大小匹配（约 530px @ z=7）
  const screenScale = 0.156;

  return (
    <Html
      transform
      position={[0, 0, 0.01]}
      center
      scale={screenScale}
      style={{
        width: '1024px',
        height: '768px',
        pointerEvents: 'none',
      }}
    >
      <div className="screen-text-content" ref={containerRef}>
        <h1 className="screen-title">{section.title}</h1>
        <p className="screen-subtitle" style={{ color: section.accentColor }}>
          {section.subtitle}
        </p>
        <p className="screen-description">{section.description}</p>
      </div>
    </Html>
  );
}

/**
 * 项目轮播组件（SELECTED WORK section 专用）
 *
 * 功能：
 *  - 用 drei <Html transform> 投影到 3D 屏幕平面（与 ScreenText 同样的对齐方式）
 *  - 显示当前项目的缩略图（gif 自动播放）+ 项目名 + tagline + 年份
 *  - 每 2.4s 自动切换到下一个项目，cross-fade 过渡（500ms）
 *  - 底部显示 4 个项目指示点，当前项目高亮
 *  - section 切换时随 transitionFlash 淡出（被闪光掩盖）
 *
 * 参数：
 *  - transitionFlashRef 切换闪光强度 ref（每帧读取，调整透明度）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 轮播切换通过 useState 触发 React 重渲染，DOM 自然完成 cross-fade
 *    （旧项 opacity:1→0 + 新项 opacity:0→1，CSS transition 自动过渡）
 *  - 用 ref 跟踪当前项目避免快速切换时状态混乱
 *  - gif 在 <img> 中原生播放，无需额外解码
 *  - position z=0.01 略高于屏幕平面，避免 z-fighting
 */
function WorkCarousel({
  transitionFlashRef,
}: {
  transitionFlashRef: React.MutableRefObject<number>;
}) {
  // 当前显示的项目索引（0~3）
  const [currentIdx, setCurrentIdx] = useState(0);
  // 上一帧的项目索引（cross-fade 期间保留，用于淡出旧项）
  const [prevIdx, setPrevIdx] = useState<number | null>(null);
  // 容器 ref（用于每帧写入 opacity 跟随 transitionFlash）
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动轮播：每 2.4s 切换一次
  // 用 ref 跟踪最新的 currentIdx，避免 setInterval 闭包陷阱（读到旧值）
  const currentIdxRef = useRef(currentIdx);
  currentIdxRef.current = currentIdx;

  useEffect(() => {
    const timer = setInterval(() => {
      const oldIdx = currentIdxRef.current;
      const newIdx = (oldIdx + 1) % PROJECTS.length;
      // 先设 prevIdx（旧项开始淡出），同时 currentIdx 切到新项（新项开始淡入）
      setPrevIdx(oldIdx);
      setCurrentIdx(newIdx);
      // 500ms 后清除 prevIdx（旧项卸载）
      setTimeout(() => setPrevIdx(null), 500);
    }, 2400);
    return () => clearInterval(timer);
  }, []);

  // 每帧：根据 transitionFlash 调整透明度（闪光时淡出掩盖切换）
  useFrame(() => {
    if (!containerRef.current) return;
    const flash = transitionFlashRef.current;
    containerRef.current.style.opacity = `${1 - flash}`;
  });

  const current = PROJECTS[currentIdx];
  const prev = prevIdx !== null ? PROJECTS[prevIdx] : null;

  // scale：与 ScreenText 保持一致，让 DOM 1024px 对应 3D 屏幕的 4 单位宽
  const screenScale = 0.156;

  return (
    <Html
      transform
      position={[0, 0, 0.01]}
      center
      scale={screenScale}
      style={{
        width: '1024px',
        height: '768px',
        pointerEvents: 'none',
      }}
    >
      <div className="work-carousel" ref={containerRef}>
        {/* 缩略图区域：prev 在下层淡出，current 在上层（始终 opacity:1）
            cross-fade 通过 prev 层的 opacity 1→0 实现（current 始终完全可见） */}
        <div className="work-thumb-stage">
          {/* prev 层（淡出）：cross-fade 期间存在，500ms 后卸载 */}
          {prev && (
            <img
              key={`prev-${prev.id}`}
              src={prev.thumb}
              alt={prev.name}
              className="work-thumb work-thumb-out"
              draggable={false}
            />
          )}
          {/* current 层（始终完全可见） */}
          <img
            key={`cur-${current.id}`}
            src={current.thumb}
            alt={current.name}
            className="work-thumb work-thumb-stable"
            draggable={false}
          />
          {/* 缩略图边框装饰（呼应复古 CRT） */}
          <div className="work-thumb-frame" />
        </div>

        {/* 项目信息：名称 + tagline + 年份（随 currentIdx 切换） */}
        <div className="work-info" key={`info-${current.id}`}>
          <h2 className="work-name">{current.name}</h2>
          <p className="work-tagline">{current.tagline}</p>
          <span className="work-year">{current.year}</span>
        </div>

        {/* 底部项目指示点：4 个，当前高亮 */}
        <div className="work-dots">
          {PROJECTS.map((p, i) => (
            <span
              key={p.id}
              className={`work-dot ${i === currentIdx ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>
    </Html>
  );
}

/**
 * 屏幕显示组件（程序化，无外部模型依赖）
 *
 * 功能：
 *  - 用 CanvasTexture 在 2D canvas 上绘制每个 section 的内容
 *  - 屏幕平面用 MeshStandardMaterial + emissiveMap 自发光
 *  - 当 transitionFlash > 0 时，屏幕变白闪烁掩盖切换
 *  - 附加 RectAreaLight 面光源，让屏幕真正照亮周围几何体
 *
 * 参数：
 *  - sectionIndex    当前 section 索引（0~3）
 *  - transitionFlashRef 切换闪光强度 ref（每帧读取，避免 setState）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - CanvasTexture 用 SRGBColorSpace 保证颜色不偏
 *  - emissiveIntensity 在切换瞬间拉到 6+，让屏幕完全过曝掩盖内容切换
 *  - RectAreaLight 颜色 = section.accentColor，强度按闪光增强
 */
function ScreenDisplay({
  sectionIndex,
  transitionFlashRef,
}: {
  sectionIndex: number;
  transitionFlashRef: React.MutableRefObject<number>;
}) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const rectLightRef = useRef<THREE.RectAreaLight>(null);

  // 主 canvas（CanvasTexture 源）— 宽胶片：4 个 section 横向排列
  // 每个 section 占 1024 宽，总宽 4096，对应 3D 空间 16 单位宽（4×4）
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 4096;
    c.height = 768;
    return c;
  }, []);

  // CanvasTexture（仅创建一次）
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, [canvas]);

  /**
   * 在 canvas 上绘制所有 4 个 section 的内容（横向排列）
   *
   * 功能：
   *  - 每个 section 占 1024 宽，共 4096 宽
   *  - 每个 section 绘制：径向渐变背景 + 网格线 + 光晕 + 装饰圆环 + 角标 + 扫描线
   *  - 帧之间用细线分隔（标识胶片画面帧边界）
   *
   * 参数：无
   *
   * 返回值：无
   *
   * 注意事项：
   *  - 一次性绘制所有 section，不再随 sectionIndex 变化重绘
   *  - 文字内容（标题/副标题/描述）由 <Html> 组件渲染（ScreenText/WorkCarousel）
   */
  const drawAllSections = () => {
    const ctx = canvas.getContext('2d')!;
    const totalW = canvas.width;   // 4096
    const h = canvas.height;        // 768
    const frameW = 1024;            // 每个 section 占 1024 宽

    // 1. 整体背景：深色填充
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, totalW, h);

    // 2. 逐个 section 绘制
    SECTIONS.forEach((section, idx) => {
      const xOff = idx * frameW;  // 该 section 在 canvas 上的 x 偏移

      // 2.1 径向渐变背景（以该 section 中心为圆心）
      const cx = xOff + frameW / 2;
      const cy = h / 2;
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, frameW / 1.5);
      bgGrad.addColorStop(0, '#1a1a1f');
      bgGrad.addColorStop(1, '#050507');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(xOff, 0, frameW, h);

      // 2.2 网格线（淡色 CRT 风，仅在该 section 范围内）
      ctx.save();
      ctx.beginPath();
      ctx.rect(xOff, 0, frameW, h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      const gridSize = 64;
      for (let x = xOff; x < xOff + frameW; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(xOff, y);
        ctx.lineTo(xOff + frameW, y);
        ctx.stroke();
      }
      ctx.restore();

      // 2.3 径向光晕（accentColor）
      const accentRgb = hexToRgb(section.accentColor);
      const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, frameW / 2.5);
      glowGrad.addColorStop(0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0.35)`);
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(xOff, 0, frameW, h);

      // 2.4 装饰圆环（左上角，相对该 section 偏移）
      ctx.strokeStyle = section.accentColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(xOff + 120, 120, 60, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(xOff + 120, 120, 80, 0, Math.PI * 2);
      ctx.stroke();

      // 2.5 角标：section 编号（老式 CRT 字体）
      ctx.fillStyle = 'rgba(252,249,243,0.5)';
      ctx.font = '40px "VT323", "Share Tech Mono", "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`0${idx + 1} / 04`, xOff + 40, h - 40);

      // 2.6 角标：右上角时间戳
      ctx.textAlign = 'right';
      ctx.fillText(new Date().toISOString().slice(0, 10), xOff + frameW - 40, h - 40);

      // 2.7 扫描线（复古 CRT 感）
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      for (let y = 0; y < h; y += 8) {
        ctx.fillRect(xOff, y, frameW, 1);
      }
    });

    // 3. 帧分隔线：每个 section 之间画一条竖线（标识胶片画面帧边界）
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    for (let i = 1; i < SECTIONS.length; i++) {
      const x = i * frameW;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // 通知 CanvasTexture 更新
    texture.needsUpdate = true;
  };

  // 首次挂载：等老式字体（VT323）加载完成后绘制所有 section
  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      if (!cancelled) drawAllSections();
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(draw);
    } else {
      setTimeout(draw, 500);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // 缓存当前 section 的 accentColor（避免每帧创建新 Color）
  const accentColorObj = useMemo(
    () => new THREE.Color(SECTIONS[sectionIndex].accentColor),
    [sectionIndex]
  );
  const whiteColor = useMemo(() => new THREE.Color('#ffffff'), []);

  // 每帧：根据 transitionFlash 调整 emissive 强度（闪光掩盖切换）
  useFrame(() => {
    if (!matRef.current) return;
    const flash = transitionFlashRef.current;
    // 基础 emissive 0.9 + 闪光时拉到 4.0
    // 基础值压低避免屏幕大面积过亮 → bloom 区域过大 → 鼠标视差时辉光波动闪烁
    matRef.current.emissiveIntensity = 0.9 + flash * 4.0;
    // 闪光时颜色偏向白色（flash=0 时跳过 lerp，避免每帧写 emissive 触发不必要更新）
    if (flash > 0.001) {
      matRef.current.emissive.lerpColors(accentColorObj, whiteColor, flash);
    } else {
      matRef.current.emissive.copy(accentColorObj);
    }

    // RectAreaLight 同步（基础强度降低，与屏幕 emissive 平衡）
    if (rectLightRef.current) {
      rectLightRef.current.intensity = 4 + flash * 20;
      if (flash > 0.001) {
        rectLightRef.current.color.lerpColors(accentColorObj, whiteColor, flash);
      } else {
        rectLightRef.current.color.copy(accentColorObj);
      }
    }
  });

  return (
    <>
      {/* RectAreaLight 面光源：跟随当前 section 位置，让屏幕照亮周围几何体
          section 0 中心在 x=0，section i 中心在 x=i*4 */}
      <rectAreaLight
        ref={rectLightRef}
        position={[sectionIndex * 4, 0, 0]}
        rotation={[0, 0, 0]}
        width={4}
        height={3}
        color={SECTIONS[sectionIndex].accentColor}
        intensity={8}
      />
      {/* 胶片屏幕平面：宽 16（4 个 section × 每个 4 宽），高 3
          位置 x=6 让 section 0 中心在原点（相机初始看向 0,0,0）
          planeGeometry 以中心为原点，宽 16 → 从 -8 到 +8
          plane 位置 x=6 → plane 从 -2 到 14
          section 0（canvas 0~1024）对应 3D -2~2，中心 0 ✓
          section 1（canvas 1024~2048）对应 3D 2~6，中心 4
          section 2 对应 3D 6~10，中心 8
          section 3 对应 3D 10~14，中心 12 */}
      <mesh ref={meshRef} position={[6, 0, 0]} rotation={[0, 0, 0]}>
        <planeGeometry args={[16, 3]} />
        <meshStandardMaterial
          ref={matRef}
          map={texture}
          emissive={SECTIONS[sectionIndex].accentColor}
          emissiveMap={texture}
          emissiveIntensity={1.5}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* 屏幕内容（Html 投影到胶片各画面帧）：
          渲染所有 4 个 section 的文字/轮播，每个位置 x = i * 4
          当前 sectionIndex 的实例完全可见，其他实例透明度降低（侧边预览） */}
      {SECTIONS.map((_, i) => (
        <group key={i} position={[i * 4, 0, 0]}>
          {i === 1 ? (
            <WorkCarousel transitionFlashRef={transitionFlashRef} />
          ) : (
            <ScreenText sectionIndex={i} transitionFlashRef={transitionFlashRef} />
          )}
        </group>
      ))}
    </>
  );
}

/**
 * 胶片条组件（35mm 电影胶片风格，替代电脑外壳）
 *
 * 功能：
 *  - 胶片横向延伸（比屏幕宽），屏幕作为其中一个画面帧
 *  - 上下边缘有齿孔（perforations）— 35mm 胶片特征
 *  - 用 CanvasTexture 绘制胶片边缘：齿孔 + 胶片编码 + 划痕
 *  - 应用 dirt/grunge 纹理做旧化（污渍、磨损）
 *  - 胶片基底色为深褐色（胶片片基的琥珀色调）
 *
 * 参数：无
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 胶片总尺寸 8×4.2（宽×高），屏幕 4×3 在中间作为画面帧
 *  - 上下边缘各 0.6 高，带齿孔（黑色圆角矩形排列）
 *  - 左右延伸各 2 宽，纯胶片色 + 划痕
 *  - CanvasTexture 1024×512 绘制上下边缘的齿孔和编码
 *  - dirt 作为 map 叠加污渍颜色，grunge 作为 roughnessMap 模拟磨损
 */
function FilmStrip() {
  // 加载 dirt + grunge 纹理做旧化
  const dirtMap = useTexture('/asset/textures/dirt.jpg');
  const grungeMap = useTexture('/asset/textures/grunge.webp');

  // 配置纹理：RepeatWrapping 让纹理平铺
  useMemo(() => {
    [dirtMap, grungeMap].forEach((tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(3, 1);
    });
    dirtMap.colorSpace = THREE.SRGBColorSpace;
  }, [dirtMap, grungeMap]);

  // 胶片边缘 CanvasTexture（齿孔 + 编码 + 划痕）
  const edgeCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 256;
    return c;
  }, []);

  const edgeTexture = useMemo(() => {
    const t = new THREE.CanvasTexture(edgeCanvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, [edgeCanvas]);

  /**
   * 绘制胶片边缘（齿孔 + 编码 + 划痕）
   *
   * 功能：
   *  - 深褐色背景（胶片片基色 #2a1a0e）
   *  - 上下排列齿孔（黑色圆角矩形，模拟 35mm 胶片穿孔）
   *  - 中间区域绘制胶片编码（如 "KODAK 5219 50D"）
   *  - 随机划痕和污渍
   */
  const drawFilmEdge = () => {
    const ctx = edgeCanvas.getContext('2d')!;
    const w = edgeCanvas.width;
    const h = edgeCanvas.height;

    // 1. 背景：深褐色胶片片基
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#1a1008');
    bgGrad.addColorStop(0.5, '#2a1a0e');
    bgGrad.addColorStop(1, '#1a1008');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. 齿孔（perforations）：上下两排，黑色圆角矩形
    // 35mm 胶片每帧 4 个齿孔，这里密集排列模拟
    ctx.fillStyle = '#050300';
    const holeW = 48;
    const holeH = 32;
    const holeGap = 80;  // 齿孔间距
    const holeYTop = 16;
    const holeYBottom = h - holeH - 16;
    for (let x = 16; x < w - holeW; x += holeGap) {
      // 上排齿孔
      roundRect(ctx, x, holeYTop, holeW, holeH, 4);
      ctx.fill();
      // 下排齿孔
      roundRect(ctx, x, holeYBottom, holeW, holeH, 4);
      ctx.fill();
    }

    // 3. 胶片编码（中间区域，老式字体）
    ctx.fillStyle = 'rgba(255, 200, 120, 0.5)';
    ctx.font = 'bold 28px "VT323", "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const codes = ['KODAK 5219', '50D 250T', 'DX 50A 01', '35MM 24FPS'];
    codes.forEach((code, i) => {
      const x = (w / codes.length) * (i + 0.5);
      ctx.fillText(code, x, h / 2);
    });

    // 4. 帧编号（小字，分散排列）
    ctx.fillStyle = 'rgba(255, 180, 100, 0.35)';
    ctx.font = '20px "VT323", monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i < 8; i++) {
      const x = (w / 8) * i + 20;
      ctx.fillText(`#${String(i * 12 + 1).padStart(4, '0')}`, x, h / 2 + 30);
    }

    // 5. 划痕（随机细线）
    ctx.strokeStyle = 'rgba(255, 220, 180, 0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      const x = Math.random() * w;
      const y1 = Math.random() * h;
      const y2 = y1 + (Math.random() - 0.5) * 40;
      ctx.moveTo(x, y1);
      ctx.lineTo(x + (Math.random() - 0.5) * 20, y2);
      ctx.stroke();
    }

    // 6. 污渍（随机深色斑点）
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 2 + Math.random() * 6;
      ctx.fillStyle = `rgba(0, 0, 0, ${0.1 + Math.random() * 0.2})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    edgeTexture.needsUpdate = true;
  };

  // 圆角矩形辅助函数（canvas 无原生 roundRect，手动实现）
  const roundRect = (
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    r: number
  ) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // 首次挂载绘制胶片边缘
  useEffect(() => {
    const draw = () => drawFilmEdge();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(draw);
    } else {
      setTimeout(draw, 500);
    }
  }, []);

  // 胶片基底材质：深褐色 + dirt 污渍 + grunge 粗糙度
  const filmBaseMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2a1a0e',
        map: dirtMap,
        roughnessMap: grungeMap,
        roughness: 0.9,
        metalness: 0.1,
      }),
    [dirtMap, grungeMap]
  );

  // 胶片边缘材质：带齿孔的 CanvasTexture
  const filmEdgeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: edgeTexture,
        color: '#3a2a1a',
        roughnessMap: grungeMap,
        roughness: 0.95,
        metalness: 0.05,
        emissive: '#1a0a00',
        emissiveMap: edgeTexture,
        emissiveIntensity: 0.15,
      }),
    [edgeTexture, grungeMap]
  );

  // 胶片尺寸：宽 20，高 4.2（屏幕 16×3 在中间，左右各延伸 2）
  // 屏幕宽 16 = 4 个 section × 每个 4 宽
  const FILM_W = 20;
  const FILM_H = 4.2;
  const SCREEN_W = 16;
  const SCREEN_H = 3;
  const edgeH = (FILM_H - SCREEN_H) / 2;  // 上下边缘各 0.6 高
  const sideW = (FILM_W - SCREEN_W) / 2;  // 左右延伸各 2 宽

  // 胶片整体偏移 x=6：让 section 0 中心在原点（相机初始看向 0,0,0）
  // 屏幕从 -2 到 14，中心 6；胶片从 -4 到 16，中心 6
  return (
    <group position={[6, 0, 0]}>
      {/* 胶片基底（整体背板）：深褐色，带 dirt 污渍 */}
      <mesh position={[0, 0, -0.15]} material={filmBaseMat}>
        <boxGeometry args={[FILM_W, FILM_H, 0.08]} />
      </mesh>

      {/* 上边缘：齿孔 + 编码（CanvasTexture） */}
      <mesh position={[0, SCREEN_H / 2 + edgeH / 2, -0.05]} material={filmEdgeMat}>
        <planeGeometry args={[FILM_W, edgeH]} />
      </mesh>

      {/* 下边缘：齿孔 + 编码（CanvasTexture） */}
      <mesh position={[0, -SCREEN_H / 2 - edgeH / 2, -0.05]} material={filmEdgeMat}>
        <planeGeometry args={[FILM_W, edgeH]} />
      </mesh>

      {/* 左延伸：纯胶片色 + dirt */}
      <mesh position={[-SCREEN_W / 2 - sideW / 2, 0, -0.05]} material={filmBaseMat}>
        <planeGeometry args={[sideW, SCREEN_H]} />
      </mesh>

      {/* 右延伸：纯胶片色 + dirt */}
      <mesh position={[SCREEN_W / 2 + sideW / 2, 0, -0.05]} material={filmBaseMat}>
        <planeGeometry args={[sideW, SCREEN_H]} />
      </mesh>

      {/* 帧分隔线：每个 section 之间的竖线，标识胶片画面帧边界
          section i 和 i+1 之间在 x = i*4 - SCREEN_W/2 + 4 = i*4 - 4
          即 x = -4, 0, 4, 8（相对 group 中心） */}
      {[-4, 0, 4, 8].map((x, i) => (
        <mesh key={i} position={[x, 0, -0.02]}>
          <planeGeometry args={[0.04, SCREEN_H]} />
          <meshBasicMaterial color="#050300" />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 漂浮粒子层（屏幕周围的发光尘埃）
 *
 * 功能：在屏幕周围生成一组 sprite，用 AdditiveBlending 营造发光尘埃氛围
 *
 * 参数：
 *  - count       粒子数量
 *  - areaSize    扩散范围
 *  - color       颜色
 *
 * 返回值：React.ReactElement
 */
function DustParticles({
  count = 30,
  areaSize = 4,
  color = '#ffd9a0',
}: {
  count?: number;
  areaSize?: number;
  color?: string;
}) {
  const spritesRef = useRef<THREE.Sprite[]>([]);

  // 程序化柔光纹理
  const texture = useMemo(() => {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  // 粒子初始参数
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * areaSize,
      y: (Math.random() - 0.5) * areaSize * 0.7,
      z: (Math.random() - 0.5) * areaSize,
      speed: 0.1 + Math.random() * 0.2,
      amp: 0.1 + Math.random() * 0.2,
      phase: Math.random() * Math.PI * 2,
      flickerSpeed: 1.0 + Math.random() * 1.5,
      scale: 0.4 + Math.random() * 0.8,
    }));
  }, [count, areaSize]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const s = spritesRef.current[i];
      if (!s) continue;
      s.position.x = p.x + Math.sin(t * p.speed + p.phase) * p.amp;
      s.position.y = p.y + Math.cos(t * p.speed * 0.7 + p.phase) * p.amp;
      s.position.z = p.z + Math.sin(t * p.speed * 0.9 + p.phase * 1.3) * p.amp;
      const mat = s.material as THREE.SpriteMaterial;
      const flicker = 0.5 + 0.5 * Math.sin(t * p.flickerSpeed + p.phase);
      mat.opacity = 0.7 * flicker;
    }
  });

  return (
    <group>
      {particles.map((p, i) => (
        <sprite
          key={i}
          ref={(el) => {
            if (el) spritesRef.current[i] = el;
          }}
          scale={[0.2 * p.scale, 0.2 * p.scale, 1]}
        >
          <spriteMaterial
            map={texture}
            color={color}
            transparent
            opacity={0.7}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  );
}

/**
 * 相机配置
 *
 * 字段说明：
 *  - HOME 远景位置（相机距屏幕较远，能看到完整场景）
 *  - END  推入终点（穿过屏幕到背面，屏幕充满视野）
 *  - HOME_FOV 远景 FOV（°）
 *  - END_FOV  推入终 FOV（°，比远景大，广角拉伸感）
 */
const CAMERA_HOME = { x: 0, y: 0, z: 7 };
// 相机终点：z=0.2 停在屏幕前很近（不穿过屏幕，避免屏幕在相机背后消失）
// 屏幕平面在 z=0，相机停在 z=0.2 时屏幕充满视野，配合广角 FOV 营造"贴脸"感
const CAMERA_END = { x: 0, y: 0, z: 0.2 };
const HOME_FOV = 45;
const END_FOV = 70;

interface FilmSceneProps {
  /** 滚动进度 0~1，驱动相机推入（z 轴推进） */
  scrollProgress: number;
  /** 鼠标归一化坐标 ref（-1~1），驱动相机视差旋转 */
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  /** 鼠标拖动偏移 ref（世界坐标 x），驱动胶片水平滑动切换 section
   *  范围 0 ~ -12（section 0 在 x=0，section 3 在 x=-12） */
  dragOffsetRef: React.MutableRefObject<number>;
  /** 当前 section 索引变化回调（通知外层更新文字 UI） */
  onSectionChange?: (index: number) => void;
}

/**
 * 3D 场景组件（胶片版）
 *
 * 功能：
 *  - 渲染宽胶片屏幕（CanvasTexture 4096×768，4 个 section 横向排列）
 *  - 鼠标拖动改变胶片水平偏移，切换显示不同 section
 *  - 滚动控制相机 z 轴推进（远景 → 近景）
 *  - section 切换时触发闪光掩盖
 *
 * 参数：
 *  - scrollProgress: number，0~1，驱动相机推进
 *  - mouseRef: 鼠标归一化坐标 ref
 *  - dragOffsetRef: 鼠标拖动偏移 ref（世界坐标 x）
 *  - onSectionChange: section 切换回调
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - sectionIndex 由 dragOffset 计算：Math.round(-dragOffset / 4)
 *  - 闪光在 sectionIndex 变化时短暂触发
 *  - 相机看向当前 section 中心（sectionIndex * 4, 0, 0）
 */
export function FilmScene({ scrollProgress, mouseRef, dragOffsetRef, onSectionChange }: FilmSceneProps) {
  const { camera } = useThree();
  const progressRef = useRef(scrollProgress);
  progressRef.current = scrollProgress;

  // 鼠标视差平滑值
  const mouseSmoothedRef = useRef({ x: 0, y: 0 });

  // 当前 section 索引（state，触发 ScreenDisplay 重绘 + onSectionChange 回调）
  const [sectionIndex, setSectionIndex] = useState(0);
  // 上一次触发的 section 索引（避免重复回调）
  const lastNotifiedSectionRef = useRef(0);

  // 切换闪光强度 [0, 1]（驱动屏幕过曝掩盖切换）
  // 用 ref 不触发 React 重渲染，每帧由 ScreenDisplay 的 useFrame 读取
  const transitionFlashRef = useRef(0);

  // 胶片水平偏移平滑值（用于平滑插值到目标 dragOffset）
  const filmXSmoothedRef = useRef(0);

  // section 切换通知
  useEffect(() => {
    if (onSectionChange && sectionIndex !== lastNotifiedSectionRef.current) {
      lastNotifiedSectionRef.current = sectionIndex;
      onSectionChange(sectionIndex);
    }
  }, [sectionIndex, onSectionChange]);

  // 每帧更新相机、闪光
  useFrame(() => {
    const totalProgress = progressRef.current;
    const rawDragOffset = dragOffsetRef.current;  // 原始拖动偏移（0 ~ -12）

    // === 平滑插值胶片偏移 ===
    // dragOffset 由鼠标拖动直接更新，这里用 lerp 平滑到目标值
    // lerp 系数 0.12：适中的平滑度，拖动后有惯性感
    const target = rawDragOffset;
    filmXSmoothedRef.current += (target - filmXSmoothedRef.current) * 0.12;
    const smoothed = filmXSmoothedRef.current;

    // === 根据 dragOffset 计算 sectionIndex ===
    // dragOffset = 0 → sectionIndex = 0
    // dragOffset = -4 → sectionIndex = 1
    // dragOffset = -8 → sectionIndex = 2
    // dragOffset = -12 → sectionIndex = 3
    // 用 Math.round 让偏移超过半帧时切换
    const newSectionIndex = Math.max(0, Math.min(3, Math.round(-smoothed / 4)));
    if (newSectionIndex !== sectionIndex) {
      setSectionIndex(newSectionIndex);
    }

    // === 计算闪光强度（切换过程中短暂触发，到达 section 中心时归零）===
    // section i 的中心位置：dragOffset = -i*4（即 0, -4, -8, -12 对应 section 0~3）
    // section i → section i+1 切换的过渡中点：dragOffset = -(i+0.5)*4 = -2, -6, -10
    //
    // 触发逻辑：
    //  - dragOffset 在 section 中心（-i*4）时，距离最近中点 2.0 → flash = 0（静止时不闪光）
    //  - dragOffset 在过渡中点（-(i+0.5)*4）时 → flash = 1（峰值，掩盖切换）
    //  - dragOffset 在中间过渡区时 → flash 平滑从 0 → 1 → 0
    //
    // 注意：之前用 -(i+1)*4（即 -4/-8/-12）作为触发点，正好是 section 1/2/3 的
    //       中心位置，导致切换到这些 section 后 flash 一直是 1，文字永远消失、屏幕过亮
    let flash = 0;
    for (let i = 0; i < 3; i++) {
      const midPoint = -(i + 0.5) * 4; // i=0: -2, i=1: -6, i=2: -10
      const distToMid = Math.abs(smoothed - midPoint);
      if (distToMid < 2.0) {
        const f = 1 - smoothstep(0, 2.0, distToMid);
        flash = Math.max(flash, f);
      }
    }
    transitionFlashRef.current = flash;

    // === 相机推进（z 轴，由 scrollProgress 控制）===
    // 整个 progress 0~1 对应相机从远景 z=7 推进到 z=0.2
    const cameraT = Math.pow(Math.max(0, Math.min(1, totalProgress)), 1.6);

    // 鼠标视差（仅在非闪光 + 远景时生效）
    const mouseTarget = mouseRef.current;
    const mouseSmoothed = mouseSmoothedRef.current;
    mouseSmoothed.x += (mouseTarget.x - mouseSmoothed.x) * 0.05;
    mouseSmoothed.y += (mouseTarget.y - mouseSmoothed.y) * 0.05;
    const parallaxStrength = (1 - cameraT) * (1 - flash);

    // 相机位置：
    // - x 跟随平滑后的 dragOffset（相机水平移动看胶片不同位置）
    //   dragOffset = 0 → 相机 x = 0（section 0 中心）
    //   dragOffset = -4 → 相机 x = 4（section 1 中心）
    //   dragOffset = -12 → 相机 x = 12（section 3 中心）
    // - 鼠标视差微调 x/y
    // - z 由 scrollProgress 推进
    const cameraX = -smoothed;  // smoothed 是 dragOffset 的平滑值（负数），取反得正值
    camera.position.x =
      cameraX +
      mouseSmoothed.x * 0.12 * parallaxStrength;
    camera.position.y =
      CAMERA_HOME.y + (CAMERA_END.y - CAMERA_HOME.y) * cameraT +
      mouseSmoothed.y * 0.08 * parallaxStrength;
    camera.position.z = CAMERA_HOME.z + (CAMERA_END.z - CAMERA_HOME.z) * cameraT;

    // 相机看向当前胶片位置（跟随拖动平滑移动）
    camera.lookAt(cameraX, 0, 0);

    // FOV：HOME_FOV（远景）→ END_FOV（推入终，广角拉伸）
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = HOME_FOV + (END_FOV - HOME_FOV) * cameraT;
    cam.updateProjectionMatrix();
  });

  return (
    <>
      {/* 环境光：极暗，让屏幕的 RectAreaLight 主导 */}
      <ambientLight intensity={0.15} color="#404050" />

      {/* 顶部冷色补光 */}
      <directionalLight color="#d4e0ff" intensity={0.4} position={[0, 5, 2]} />

      {/* 胶片条（35mm 电影胶片风格，替代电脑外壳） */}
      <FilmStrip />

      {/* 屏幕显示（含 RectAreaLight） */}
      <ScreenDisplay sectionIndex={sectionIndex} transitionFlashRef={transitionFlashRef} />

      {/* 漂浮尘埃粒子 */}
      <DustParticles count={35} areaSize={5} color="#ffd9a0" />
    </>
  );
}
