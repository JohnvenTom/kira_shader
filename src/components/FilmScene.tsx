import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
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

  // 主 canvas（CanvasTexture 源）
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024;
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
   * 在 canvas 上绘制指定 section 的内容
   *
   * 功能：
   *  - 清空 canvas
   *  - 绘制径向渐变背景（用 accentColor）
   *  - 绘制网格线（增强复古 CRT 感）
   *  - 绘制大标题、副标题、描述
   *  - 绘制装饰圆点和扫描线
   *
   * 参数：
   *  - section {SectionContent} 要绘制的内容
   *  - idx     {number} section 索引（用于角标显示）
   *
   * 返回值：无
   */
  const drawSection = (section: SectionContent, idx: number) => {
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;

    // 1. 背景：深色径向渐变
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 1.5);
    bgGrad.addColorStop(0, '#1a1a1f');
    bgGrad.addColorStop(1, '#050507');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. 网格线（淡色 CRT 风）
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const gridSize = 64;
    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 3. 径向光晕（accentColor）
    const accentRgb = hexToRgb(section.accentColor);
    const glowGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2.5);
    glowGrad.addColorStop(0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0.35)`);
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h);

    // 4. 装饰圆环（左上角）
    ctx.strokeStyle = section.accentColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(120, 120, 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(120, 120, 80, 0, Math.PI * 2);
    ctx.stroke();

    // 5. 文字（标题/副标题/描述）已移到 <Html> 组件渲染（见 ScreenText）
    //    原因：CanvasTexture 文字在相机推近后会模糊/锯齿，DOM 文字更清晰且可用
    //    CSS 灵活排版。这里只保留装饰元素（光晕、网格、扫描线、角标）。

    // 6. 角标：section 编号 — 老式 CRT 字体，放大显示
    ctx.fillStyle = 'rgba(252,249,243,0.5)';
    ctx.font = '40px "VT323", "Share Tech Mono", "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`0${idx + 1} / 04`, 40, h - 40);

    // 7. 角标：右上角时间戳 — 同款老式字体
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toISOString().slice(0, 10), w - 40, h - 40);

    // 8. 扫描线（复古 CRT 感）
    // 间距从 3px 加大到 8px、不透明度从 0.15 降到 0.06：
    // 之前 256 条密集暗线 + 色散垂直 RGB 偏移 → 推近时裂成彩色条纹（"裂纹"感）
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let y = 0; y < h; y += 8) {
      ctx.fillRect(0, y, w, 1);
    }

    // 通知 CanvasTexture 更新
    texture.needsUpdate = true;
  };

  // sectionIndex 变化时重绘
  useEffect(() => {
    drawSection(SECTIONS[sectionIndex], sectionIndex);
  }, [sectionIndex]);

  // 首次挂载：等老式字体（VT323）加载完成后再绘制，避免 canvas 用 fallback 字体
  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      if (!cancelled) drawSection(SECTIONS[sectionIndex], sectionIndex);
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(draw);
    } else {
      // 不支持 document.fonts 时延迟 500ms 重绘
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
      {/* RectAreaLight 面光源：与屏幕同位置，让屏幕照亮周围几何体 */}
      <rectAreaLight
        ref={rectLightRef}
        position={[0, 0, 0]}
        rotation={[0, 0, 0]}
        width={4}
        height={3}
        color={SECTIONS[sectionIndex].accentColor}
        intensity={8}
      />
      {/* 屏幕平面 */}
      <mesh ref={meshRef} position={[0, 0, 0]} rotation={[0, 0, 0]}>
        <planeGeometry args={[4, 3]} />
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
      {/* 屏幕内容（Html 投影到屏幕平面）：
          - SELECTED WORK section（idx=1）→ 项目轮播 WorkCarousel
          - 其他 section → 文字 ScreenText */}
      {sectionIndex === 1 ? (
        <WorkCarousel transitionFlashRef={transitionFlashRef} />
      ) : (
        <ScreenText sectionIndex={sectionIndex} transitionFlashRef={transitionFlashRef} />
      )}
    </>
  );
}

/**
 * 屏幕外框（复古 CRT 显示器简化版）
 *
 * 功能：在屏幕周围绘制深色边框，让屏幕看起来嵌在显示器里
 *
 * 参数：无
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：用 BoxGeometry 简化，不做精细建模
 */
function ScreenFrame() {
  const frameMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#1a1a1f', roughness: 0.7, metalness: 0.3 }),
    []
  );
  const baseMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0e0e12', roughness: 0.8, metalness: 0.2 }),
    []
  );
  const backMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0a0a0e', roughness: 0.9, metalness: 0.1 }),
    []
  );

  return (
    <group>
      {/* 外框：4 条边 */}
      <mesh position={[0, 1.6, -0.05]} material={frameMat}>
        <boxGeometry args={[4.4, 0.25, 0.15]} />
      </mesh>
      <mesh position={[0, -1.6, -0.05]} material={frameMat}>
        <boxGeometry args={[4.4, 0.25, 0.15]} />
      </mesh>
      <mesh position={[-2.1, 0, -0.05]} material={frameMat}>
        <boxGeometry args={[0.25, 3.4, 0.15]} />
      </mesh>
      <mesh position={[2.1, 0, -0.05]} material={frameMat}>
        <boxGeometry args={[0.25, 3.4, 0.15]} />
      </mesh>
      {/* 底座 */}
      <mesh position={[0, -2.0, -0.3]} material={baseMat}>
        <boxGeometry args={[1.2, 0.3, 0.6]} />
      </mesh>
      <mesh position={[0, -2.3, -0.3]} material={baseMat}>
        <boxGeometry args={[2.0, 0.15, 0.8]} />
      </mesh>
      {/* 背板 */}
      <mesh position={[0, 0, -0.18]} material={backMat}>
        <boxGeometry args={[4.4, 3.4, 0.1]} />
      </mesh>
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
  /** 滚动进度 0~1，驱动相机推入与 section 切换 */
  scrollProgress: number;
  /** 鼠标归一化坐标 ref（-1~1），驱动相机视差旋转 */
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  /** 当前 section 索引变化回调（通知外层更新文字 UI） */
  onSectionChange?: (index: number) => void;
}

/**
 * 3D 场景组件（多 section 版）
 *
 * 功能：
 *  - 渲染程序化屏幕（CanvasTexture）+ 外框 + 粒子
 *  - 根据滚动进度切换 section 内容
 *  - 滚动到段末（接近屏幕最近处）时触发闪光过渡
 *  - 相机沿屏幕法线推进：远景 → 穿过屏幕 → 重置（被闪光掩盖）
 *
 * 参数：
 *  - scrollProgress: number，0~1
 *  - mouseRef: 鼠标 ref
 *  - onSectionChange: section 切换回调
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 总进度 0~1 分成 4 段，每段 0.25
 *  - 每段内部：[0, 0.15] 闪光淡出，[0.15, 0.85] 正常显示+推进，[0.85, 1.0] 闪光+切换
 *  - sectionIndex 在段切换瞬间更新（被闪光掩盖）
 *  - 相机推入用 lerp + 缓动，闪光用 smoothstep
 */
export function FilmScene({ scrollProgress, mouseRef, onSectionChange }: FilmSceneProps) {
  const { camera } = useThree();
  const progressRef = useRef(scrollProgress);
  progressRef.current = scrollProgress;

  // 鼠标视差平滑值
  const mouseSmoothedRef = useRef({ x: 0, y: 0 });

  // 当前 section 索引（state，触发 ScreenDisplay 重绘 + onSectionChange 回调）
  const [sectionIndex, setSectionIndex] = useState(0);
  // 上一次触发的 section 索引（避免重复回调）
  const lastNotifiedSectionRef = useRef(0);

  // 切换闪光强度 [0, 1]（驱动屏幕过曝 + 相机重置掩盖）
  // 用 ref 不触发 React 重渲染，每帧由 ScreenDisplay 的 useFrame 读取
  const transitionFlashRef = useRef(0);

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

    // === section 切换：直接跟随 floor(progress * 4) ===
    // 4 段，切换边界在 progress = 0.25/0.5/0.75
    const totalSegment = totalProgress * 4;
    const segIndex = Math.min(3, Math.floor(totalSegment));
    if (sectionIndex !== segIndex) {
      setSectionIndex(segIndex);
    }

    // === 计算闪光强度（在 section 切换边界短暂触发）===
    // 边界位置 = (segIndex + 1) / 4，即 0.25/0.5/0.75
    // 在边界 ±0.04 范围内触发闪光，峰值在边界中心
    // 第一段开头（progress < 0.04）不闪光（首次进入）
    let flash = 0;
    if (segIndex < 3) {
      const boundary = (segIndex + 1) / 4;
      const distToBoundary = Math.abs(totalProgress - boundary);
      if (distToBoundary < 0.04) {
        flash = 1 - smoothstep(0, 0.04, distToBoundary);
      }
    }
    transitionFlashRef.current = flash;

    // === 相机连续推进（不再每段重置）===
    // 整个 progress 0~1 对应相机从远景 z=7 连续推进到 z=0.2（屏幕前很近）
    // 缓动 pow(t, 1.6)：前期慢（远景欣赏），后期加速（扎进屏幕感）
    // 相机路径不再分段重置，保持连续性
    const cameraT = Math.pow(Math.max(0, Math.min(1, totalProgress)), 1.6);

    // 鼠标视差（仅在非闪光 + 远景时生效，推近后视差衰减）
    // 幅度压到极小（0.12/0.08），避免相机旋转导致屏幕投影面积波动 → bloom 辉光区域波动 → 闪烁
    const target = mouseRef.current;
    const smoothed = mouseSmoothedRef.current;
    smoothed.x += (target.x - smoothed.x) * 0.05;
    smoothed.y += (target.y - smoothed.y) * 0.05;
    const parallaxStrength = (1 - cameraT) * (1 - flash);

    // 相机位置：从远景 lerp 到推入终点（连续推进，不分段）
    camera.position.x =
      CAMERA_HOME.x + (CAMERA_END.x - CAMERA_HOME.x) * cameraT + smoothed.x * 0.12 * parallaxStrength;
    camera.position.y =
      CAMERA_HOME.y + (CAMERA_END.y - CAMERA_HOME.y) * cameraT + smoothed.y * 0.08 * parallaxStrength;
    camera.position.z = CAMERA_HOME.z + (CAMERA_END.z - CAMERA_HOME.z) * cameraT;

    // 相机始终看向屏幕中心
    camera.lookAt(0, 0, 0);

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

      {/* 屏幕外框（CRT 显示器简化版） */}
      <ScreenFrame />

      {/* 屏幕显示（含 RectAreaLight） */}
      <ScreenDisplay sectionIndex={sectionIndex} transitionFlashRef={transitionFlashRef} />

      {/* 漂浮尘埃粒子 */}
      <DustParticles count={35} areaSize={5} color="#ffd9a0" />
    </>
  );
}
