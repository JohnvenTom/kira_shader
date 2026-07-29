import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, useGLTF, useTexture } from '@react-three/drei';
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

  // 每个 section group 的 ref（用于每帧更新旋转，平滑跟随 sectionIndex）
  // 用 ref 数组避免 React 重渲染，直接在 useFrame 中操作 group.rotation
  const sectionGroupRefs = useRef<(THREE.Group | null)[]>([]);

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

  // 首次挂载绘制所有 section
  // 关键：立即绘制一次（用 fallback 字体），字体加载后再绘制一次
  // 之前只依赖 document.fonts.ready，若 VT323 字体加载慢/失败，
  // drawAllSections 永不执行，canvas 空白 → 日期/文字看不见
  useEffect(() => {
    let cancelled = false;
    // 立即绘制一次（用 fallback 字体，背景/图形元素不受影响）
    drawAllSections();
    console.log('[ScreenDisplay] drawAllSections executed immediately');
    // 字体加载完成后再绘制一次（让 VT323 字体生效）
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) {
          drawAllSections();
          console.log('[ScreenDisplay] drawAllSections re-executed after fonts ready');
        }
      }).catch((err: unknown) => {
        console.warn('[ScreenDisplay] fonts.ready rejected', err);
      });
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

  // 屏幕平面不应用弯曲 shader：屏幕需要保持平直，确保内容（含日期/文字）清晰可见
  // 之前应用了 applyCurvedShader，导致屏幕在远离当前 section 的区域弯曲很大，
  // 跑到 dirt mesh 后面，被 dirt 遮挡（屏幕日期/文字看不见）
  // 胶片边缘/基底/左右延伸保留弯曲，屏幕平直，视觉上胶片卷曲但画面帧清晰

  // 每帧：根据 transitionFlash 调整 emissive 强度（闪光掩盖切换）
  //        + 平滑更新每个 section group 的 rotateY（模拟胶片弯曲卷曲）
  useFrame((_, delta) => {
    if (!matRef.current) return;
    const flash = transitionFlashRef.current;
    // 基础 emissive 0.9 + 闪光时拉到 4.0
    matRef.current.emissiveIntensity = 0.9 + flash * 4.0;
    if (flash > 0.001) {
      matRef.current.emissive.lerpColors(accentColorObj, whiteColor, flash);
    } else {
      matRef.current.emissive.copy(accentColorObj);
    }

    // RectAreaLight 同步
    if (rectLightRef.current) {
      rectLightRef.current.intensity = 4 + flash * 20;
      if (flash > 0.001) {
        rectLightRef.current.color.lerpColors(accentColorObj, whiteColor, flash);
      } else {
        rectLightRef.current.color.copy(accentColorObj);
      }
    }

    // 平滑更新每个 section group 的旋转（模拟胶片弯曲）
    // 当前 section：rotateY=0（正面朝相机）
    // 左侧 section（i < sectionIndex）：rotateY > 0（向右旋转）
    // 右侧 section（i > sectionIndex）：rotateY < 0（向左旋转）
    // 距离越远旋转越大，模拟胶片卷曲效果
    const lerpFactor = Math.min(delta * 4, 1);  // 帧率无关 lerp
    sectionGroupRefs.current.forEach((grp, i) => {
      if (!grp) return;
      const offset = i - sectionIndex;  // -3 ~ +3
      // 旋转角度：每偏移 1 单位旋转 0.25 rad（约 14°）
      // 两侧 section 旋转明显，模拟胶片弯曲卷曲
      const targetRotateY = offset * 0.25;
      // 远离的 section 稍微后退（z 负方向），增强深度感
      const targetZ = -Math.abs(offset) * 0.2;
      // lerp 平滑过渡（切换 section 时旋转有缓动）
      grp.rotation.y += (targetRotateY - grp.rotation.y) * lerpFactor;
      grp.position.z += (targetZ - grp.position.z) * lerpFactor;
    });
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
          当前 sectionIndex 的实例完全可见，其他实例透明度降低（侧边预览）
          每个 section 的 group 加 rotateY 旋转模拟弯曲：
            - 当前 section（i === sectionIndex）：旋转 0（正面朝向相机）
            - 左侧 section：rotateY 正值（向右旋转，远离相机）
            - 右侧 section：rotateY 负值（向左旋转，远离相机）
            - 距离越远，旋转角度越大（模拟胶片卷曲）
          旋转量由 useFrame 平滑过渡（lerp 到目标值），避免 section 切换突变 */}
      {SECTIONS.map((_, i) => (
        <group
          key={i}
          ref={(el) => { sectionGroupRefs.current[i] = el; }}
          position={[i * 4, 0, 0]}
        >
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
 * 动态弯曲共享 uniforms
 *
 * 功能：所有胶片 mesh 共享这套 uniform，由 useFrame 在每帧
 *      根据 sectionIndex 平滑更新 uActiveCenterX，实现弯曲随 section 切换
 *
 * 字段：
 *  - uActiveCenterX  当前 section 中心的 world x（section 0=0, 1=4, 2=8, 3=12）
 *  - uCurvatureNear  当前 section 区域的弯曲强度（小 → 接近平直）
 *  - uCurvatureFar   远离 section 区域的弯曲强度（大 → 明显卷曲）
 *  - uFalloff        弯曲过渡距离（near → far 的 smoothstep 范围）
 *
 * 注意事项：
 *  - 用模块级单例，确保 FilmStrip 中所有材质共享同一份
 *  - useFrame 中 lerp 更新 uActiveCenterX，避免 section 切换时弯曲突变
 *  - 屏幕平面（ScreenDisplay）不使用这套 uniform，保持平直确保内容清晰
 */
const curvedUniforms = {
  uActiveCenterX: { value: 0 },
  uCurvatureNear: { value: -0.002 },   // 当前 section：轻微弯曲（保持可读）
  uCurvatureFar: { value: -0.04 },      // 远离 section：非常夸张的卷曲
  uFalloff: { value: 3.0 },              // 3 单位内从 near 过渡到 far（过渡更快）
};

/**
 * dirt mesh 专用 uniforms（弯曲量受限）
 *
 * 功能：左右延伸（dirt）mesh 用这套 uniform，弯曲强度比胶片边缘小，
 *      确保 dirt 弯曲后 z 永远在屏幕（z=0）之后，不会遮挡屏幕内容
 *
 * 设计原理：
 *  - 屏幕在 worldX=[-2,14]，右延伸在 worldX=[12,14]，重叠区域 dx=12~14
 *  - 胶片边缘弯曲：z = -0.04 × 14² = -7.84（远离相机）
 *  - dirt 弯曲需 < 0（向后退），且 |z| < 0.08（mesh 初始 z）确保不跑到屏幕前
 *  - 用 uCurvatureFar=-0.005：z = -0.005 × 14² = -0.98，加 mesh z=-0.08 = -1.06
 *    仍在屏幕 z=0 之后，但弯曲量足够看出卷曲效果
 */
const dirtCurvedUniforms = {
  uActiveCenterX: curvedUniforms.uActiveCenterX,  // 共享 active center
  uCurvatureNear: { value: -0.0005 },  // 当前 section：几乎平直
  uCurvatureFar: { value: -0.006 },     // 远离 section：轻微卷曲（受限）
  uFalloff: { value: 3.0 },
};

/**
 * 给 MeshStandardMaterial 注入动态弯曲 vertex shader
 *
 * 功能：在 vertex shader 的 project_vertex 之前，根据顶点 world x 与
 *      uActiveCenterX 的距离，用 smoothstep 混合 near/far 弯曲强度，
 *      应用二次曲线 z 偏移（z = cur * dx²），实现：
 *       - 当前 section 区域弯曲小（接近平直，正面观察清晰）
 *       - 远离 section 区域弯曲大（侧边卷曲，视觉上有"胶片感"）
 *
 * 参数：
 *  - mat        要注入 shader 的 MeshStandardMaterial
 *  - uniforms   使用的 uniforms 对象（默认 curvedUniforms，dirt 用 dirtCurvedUniforms）
 *
 * 返回值：无（直接修改 mat.onBeforeCompile）
 *
 * 异常：无
 *
 * 注意事项：
 *  - 必须在 material 首次编译前调用（onBeforeCompile 只在首次编译生效）
 *  - 用 modelMatrix 算 world x，自动包含 group/mesh 的位移
 *  - 只修改 transformed.z，不影响 UV/normal（normal 由原 shader 计算）
 *  - dirt mesh 用 dirtCurvedUniforms（弯曲受限），避免跑到屏幕前遮挡内容
 */
function applyCurvedShader(
  mat: THREE.MeshStandardMaterial,
  uniforms: typeof curvedUniforms = curvedUniforms
) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uActiveCenterX = uniforms.uActiveCenterX;
    shader.uniforms.uCurvatureNear = uniforms.uCurvatureNear;
    shader.uniforms.uCurvatureFar = uniforms.uCurvatureFar;
    shader.uniforms.uFalloff = uniforms.uFalloff;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uActiveCenterX;
         uniform float uCurvatureNear;
         uniform float uCurvatureFar;
         uniform float uFalloff;`
      )
      .replace(
        '#include <project_vertex>',
        `// 动态弯曲：在投影前给 transformed.z 加二次曲线偏移
         // 用 modelMatrix 算顶点 world x（已包含 group/mesh 位移）
         vec4 wpos_curved = modelMatrix * vec4(transformed, 1.0);
         float dx = wpos_curved.x - uActiveCenterX;
         float dist = abs(dx);
         // 距离 active center 越远，弯曲强度越大（near → far 平滑过渡）
         float mixFactor = smoothstep(0.0, uFalloff, dist);
         float cur = mix(uCurvatureNear, uCurvatureFar, mixFactor);
         // 二次曲线弯曲：curvature<0 → 中间凸向相机，两端凹向远处（微笑形）
         float dz = cur * dx * dx;
         transformed.z += dz;
         #include <project_vertex>`
      );
  };
}

/**
 * 创建带轻微弯曲的 PlaneGeometry（模拟胶片自然弧度）
 *
 * 功能：在标准 PlaneGeometry 基础上，沿 X 轴方向给 Z 加二次曲线弯曲
 *      （z = curvature × (groupLocalX)²），让胶片整体呈微笑形弧度
 *      中间凸（向相机），两端凹（远离相机），模拟胶片在放映机里自然卷曲
 *
 * 参数：
 *  - width      宽度（局部 plane 宽）
 *  - height     高度（局部 plane 高）
 *  - segX       X 方向细分段数（≥16 才平滑）
 *  - segY       Y 方向细分段数
 *  - curvature  弯曲强度（<0 中间凸向相机、两端远离相机；>0 反向）
 *  - xOffset    该 mesh 在 group 局部坐标系中的 x 偏移（用于让多段 mesh
 *               的弯曲在 world 坐标系中连续，不会在拼接处出现折线）
 *
 * 返回值：THREE.PlaneGeometry 弯曲后的几何体
 *
 * 异常：无
 *
 * 注意事项：
 *  - 弯曲后顶点 Z 重新计算，必须调用 computeVertexNormals 重算法线
 *  - xOffset 是关键：上下边缘/左右延伸/分隔线等不同位置的 mesh，
 *    各自的局部 x=0 对应 group 中的不同 worldX，弯曲公式必须用 worldX
 *    才能让所有 mesh 的弯曲在世界坐标系中连续
 *  - 弯曲强度建议 |curvature| ≤ 0.008，过大导致 Html 文字投影错位
 */
function makeCurvedGeometry(
  width: number,
  height: number,
  segX: number,
  segY: number,
  curvature: number,
  xOffset: number = 0
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width, height, segX, segY);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const localX = pos.getX(i);
    // worldX = mesh 局部 x + mesh 在 group 中的 x 偏移
    const worldX = localX + xOffset;
    // 二次曲线弯曲：z = curvature × worldX²
    // curvature < 0：worldX=0 处 z=0（中间），|worldX| 大处 z 负（远离相机）
    // → 中间凸向相机，两端凹向远处（微笑形）
    const z = curvature * worldX * worldX;
    pos.setZ(i, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
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
 *  - 所有胶片 mesh 沿 X 轴轻微弯曲（微笑形），模拟胶片自然卷曲
 *
 * 参数：无
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 胶片总尺寸 20×4.2（宽×高），屏幕 16×3 在中间作为画面帧
 *  - 上下边缘各 0.6 高，带齿孔（黑色圆角矩形 + 内阴影 + 白描边）
 *  - 左右延伸各 2 宽，纯胶片色 + 划痕
 *  - CanvasTexture 2048×256 绘制上下边缘的齿孔/编码/DX 条码/时间码
 *  - dirt 作为 map 叠加污渍颜色，grunge 作为 roughnessMap 模拟磨损
 *  - 动态弯曲：通过 applyCurvedShader 注入 vertex shader，弯曲随
 *    activeSectionX 变化（当前 section 平直，远离 section 卷曲）
 *
 * 参数：
 *  - activeSectionX  当前 section 中心的 world x（section i → i*4）
 *
 * 返回值：React.ReactElement
 */
function FilmStrip({ activeSectionX }: { activeSectionX: number }) {
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
  // canvas 高 512：留足中间信息区空间，避免时间码/帧编号被下排齿孔遮挡
  // 布局：上齿孔 [40, 130] | 信息区 [140, 370] | 下齿孔 [380, 470]
  const edgeCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 512;
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
   * 绘制胶片边缘（齿孔 + DX 条码 + 时间码 + 划痕 + 污渍 + 颗粒）
   *
   * 功能：
   *  - 深褐色胶片片基背景（带颗粒纹理）
   *  - 上下两排齿孔：纯黑填充 + 径向内阴影（模拟穿孔深度）+ 浅褐描边（边缘高光）
   *  - DX 光敏条形码（黑白条纹，35mm 胶片特征）
   *  - 胶片型号水印（KODAK / FUJI / ILFORD / AGFA）
   *  - 帧编号 + 时间码 + ASA/ISO 标识
   *  - 随机划痕、污渍、磨损斑、边缘暗化
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 齿孔颜色用纯黑 #000000 + 内阴影渐变（中心黑，边缘淡褐色）
   *    之前用 #050300 与背景 #2a1a0e 对比度太低，几乎看不见
   *  - 加浅褐色描边 #5a3a1a 模拟穿孔边缘的反光高光，增强立体感
   *  - 中间信息区分 4 段（对应 4 个 section），每段一组完整胶片信息
   */
  const drawFilmEdge = () => {
    const ctx = edgeCanvas.getContext('2d')!;
    const w = edgeCanvas.width;
    const h = edgeCanvas.height;

    // 1. 背景：深褐色胶片片基（垂直渐变）
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#1a1008');
    bgGrad.addColorStop(0.5, '#2a1a0e');
    bgGrad.addColorStop(1, '#1a1008');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 1b. 胶片颗粒纹理（增加质感，5000 个随机暗点）
    for (let i = 0; i < 5000; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const alpha = Math.random() * 0.18;
      ctx.fillStyle = `rgba(80, 50, 30, ${alpha})`;
      ctx.fillRect(x, y, 1, 1);
    }

    // 2. 齿孔：上下两排，纯黑 + 内阴影 + 浅褐描边
    //    齿孔尺寸 90×90，间距 120，每排约 17 个
    //    canvas 高 512，齿孔位置调整：
    //      上排 y=40~130（上方留 40px 边距）
    //      下排 y=382~472（下方留 40px 边距）
    //      中间 [130, 382] 共 252px 留给信息区，避免齿孔遮挡文字
    const holeW = 90;
    const holeH = 90;
    const holeGap = 120;
    const holeYTop = 40;
    const holeYBottom = h - holeH - 40;  // 512 - 90 - 40 = 382

    /**
     * 绘制单个齿孔（带内阴影和描边）
     *
     * 参数：
     *  - x, y    齿孔左上角坐标
     *  - w, h    齿孔尺寸
     *
     * 注意事项：齿孔分三层绘制
     *  1. 浅褐色描边（穿孔边缘反光）
     *  2. 纯黑填充（孔洞本身）
     *  3. 径向渐变内阴影（中心更深，边缘略浅，模拟穿孔井深）
     */
    const drawHole = (x: number, y: number, hw: number, hh: number) => {
      // 描边：浅褐色，模拟穿孔边缘磨损反光
      ctx.strokeStyle = 'rgba(140, 90, 50, 0.85)';
      ctx.lineWidth = 2.5;
      roundRect(ctx, x - 2, y - 2, hw + 4, hh + 4, 12);
      ctx.stroke();
      // 黑色填充
      ctx.fillStyle = '#000000';
      roundRect(ctx, x, y, hw, hh, 10);
      ctx.fill();
      // 内阴影：径向渐变，中心纯黑，边缘略浅（模拟穿孔井的深度）
      const cx = x + hw / 2;
      const cy = y + hh / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, hw / 1.4);
      grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
      grad.addColorStop(0.75, 'rgba(0, 0, 0, 1)');
      grad.addColorStop(1, 'rgba(60, 40, 20, 0.5)');
      ctx.fillStyle = grad;
      roundRect(ctx, x, y, hw, hh, 10);
      ctx.fill();
    };

    for (let x = 40; x < w - holeW; x += holeGap) {
      drawHole(x, holeYTop, holeW, holeH);
      drawHole(x, holeYBottom, holeW, holeH);
    }

    // 3. 中间信息区：分 4 段，每段一组完整胶片信息
    //    infoY = 256（canvas 中心），位于上下齿孔之间的空白区 [130, 382]
    //    信息内容：型号(y-60) / DX码(y-30) / 帧编号+时间码(y+10) / ASA/ISO(y+40) / 胶片码(y+70)
    //    所有内容 y 范围 [196, 326]，完全在空白区内，不被齿孔遮挡
    const segCount = 4;
    const segW = w / segCount;
    const infoY = h / 2;  // 256
    const films = [
      'KODAK GOLD 200-24',
      'FUJI SUPERIA 400',
      'ILFORD HP5 PLUS',
      'AGFA VISTA 400',
    ];
    const filmCodes = ['5020 024', 'FU 400 24', 'IP5 400 24', 'AV 400 024'];

    for (let s = 0; s < segCount; s++) {
      const x0 = s * segW;
      const cx = x0 + segW / 2;

      // 3a. 胶片型号（黄色，等宽字体）
      //     y = infoY - 60 = 196（空白区上边界）
      ctx.fillStyle = 'rgba(255, 210, 130, 0.85)';
      ctx.font = 'bold 22px "VT323", "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(films[s], cx, infoY - 60);

      // 3b. DX 光敏条形码（黑白条纹，模拟 35mm 胶片的 DX 码）
      //     y = infoY - 30 = 226
      const bcH = 12;
      const bcW = 100;
      const bcX = cx - bcW / 2;
      const bcY = infoY - bcH / 2 - 30;
      // 白色背景
      ctx.fillStyle = '#f0e8d8';
      ctx.fillRect(bcX - 2, bcY - 2, bcW + 4, bcH + 4);
      // 黑色条纹（伪随机但确定性的图案）
      let curX = bcX;
      const rng = (seed: number) => {
        const x = Math.sin(seed * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      };
      for (let b = 0; b < 18; b++) {
        const barW = 2 + rng(s * 100 + b) * 4;
        if (rng(s * 200 + b) > 0.45) {
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(curX, bcY, barW, bcH);
        }
        curX += barW + 1;
        if (curX > bcX + bcW) break;
      }

      // 3c. 帧编号（左下角）
      //     y = infoY + 10 = 266
      ctx.fillStyle = 'rgba(255, 190, 110, 0.7)';
      ctx.font = '18px "VT323", monospace';
      ctx.textAlign = 'left';
      const frameNum = String(s * 24 + 1).padStart(4, '0');
      ctx.fillText(`#${frameNum}`, x0 + 22, infoY + 10);

      // 3d. 时间码（右下角，SMPTE 格式 HH:MM:SS:FF）
      ctx.textAlign = 'right';
      const tc = `00:00:${String(s * 12).padStart(2, '0')}:24`;
      ctx.fillText(tc, x0 + segW - 22, infoY + 10);

      // 3e. ASA/ISO 标识（再下一行）
      //     y = infoY + 40 = 296
      ctx.fillStyle = 'rgba(255, 220, 180, 0.55)';
      ctx.font = '14px "VT323", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('ASA 200', x0 + 22, infoY + 40);
      ctx.textAlign = 'right';
      ctx.fillText('ISO 200/24°', x0 + segW - 22, infoY + 40);

      // 3f. 胶片编码（最下方，深色小字）
      //     y = infoY + 70 = 326（空白区下边界）
      ctx.fillStyle = 'rgba(255, 180, 100, 0.45)';
      ctx.font = '12px "VT323", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(filmCodes[s], cx, infoY + 70);
    }

    // 3g. dirt 污渍效果（在中间信息区叠加污渍纹理）
    //     之前 dirt 只在左右延伸 mesh 上，但左右延伸在视野外看不到
    //     这里在 edgeCanvas 中间区域绘制污渍，让 dirt 效果在齿孔之间可见
    //     污渍分布：深褐色斑点 + 浅色磨损 + 油渍痕迹
    ctx.save();
    // 限制污渍只在中间信息区 [140, 370]（y 范围，避开齿孔）
    ctx.beginPath();
    ctx.rect(0, 140, w, 230);
    ctx.clip();
    // 深褐色斑点（污渍主体）
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * w;
      const y = 140 + Math.random() * 230;
      const r = 2 + Math.random() * 8;
      const alpha = 0.1 + Math.random() * 0.3;
      ctx.fillStyle = `rgba(40, 25, 10, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 浅色磨损斑（胶片基底老化发白）
    for (let i = 0; i < 80; i++) {
      const x = Math.random() * w;
      const y = 140 + Math.random() * 230;
      const r = 3 + Math.random() * 12;
      const alpha = 0.05 + Math.random() * 0.15;
      ctx.fillStyle = `rgba(200, 170, 120, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 油渍痕迹（横向条状）
    for (let i = 0; i < 15; i++) {
      const x = Math.random() * w;
      const y = 140 + Math.random() * 230;
      const w2 = 30 + Math.random() * 80;
      const h2 = 2 + Math.random() * 6;
      const alpha = 0.08 + Math.random() * 0.12;
      ctx.fillStyle = `rgba(30, 20, 10, ${alpha})`;
      ctx.fillRect(x, y, w2, h2);
    }
    ctx.restore();

    // 4. 划痕（随机细线，多一些增加真实感）
    ctx.strokeStyle = 'rgba(255, 220, 180, 0.2)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 35; i++) {
      ctx.beginPath();
      const x = Math.random() * w;
      const y1 = Math.random() * h;
      const y2 = y1 + (Math.random() - 0.5) * 60;
      ctx.moveTo(x, y1);
      ctx.lineTo(x + (Math.random() - 0.5) * 30, y2);
      ctx.stroke();
    }
    // 长划痕（横贯胶片的纵向划痕，胶片老化的典型特征）
    ctx.strokeStyle = 'rgba(255, 200, 150, 0.12)';
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const x = Math.random() * w;
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (Math.random() - 0.5) * 8, h);
      ctx.stroke();
    }

    // 5. 污渍（随机深色斑点，模拟指纹/灰尘）
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 2 + Math.random() * 8;
      ctx.fillStyle = `rgba(0, 0, 0, ${0.1 + Math.random() * 0.3})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 浅色磨损斑（胶片基底老化发白）
    for (let i = 0; i < 25; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 1 + Math.random() * 3;
      ctx.fillStyle = `rgba(255, 220, 180, ${0.05 + Math.random() * 0.1})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. 边缘暗化（上下边缘加深，模拟胶片边缘的磨损暗化）
    const edgeGrad = ctx.createLinearGradient(0, 0, 0, h);
    edgeGrad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    edgeGrad.addColorStop(0.12, 'rgba(0, 0, 0, 0)');
    edgeGrad.addColorStop(0.88, 'rgba(0, 0, 0, 0)');
    edgeGrad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = edgeGrad;
    ctx.fillRect(0, 0, w, h);

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
  // 关键修复：立即绘制一次（不依赖字体加载），字体加载后再绘制一次
  // 之前只依赖 document.fonts.ready，若 VT323 字体加载慢或失败，Promise
  // 不 resolve，drawFilmEdge 永远不执行，canvas 一直空白 → 齿孔看不到
  useEffect(() => {
    // 立即绘制一次（用 fallback 字体，齿孔和图形元素不受影响）
    drawFilmEdge();
    console.log('[FilmStrip] drawFilmEdge executed immediately, edgeCanvas size:',
      edgeCanvas.width, 'x', edgeCanvas.height);
    // 字体加载完成后再绘制一次（让 VT323 字体生效于胶片编码文字）
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        drawFilmEdge();
        console.log('[FilmStrip] drawFilmEdge re-executed after fonts ready');
      }).catch((err: unknown) => {
        console.warn('[FilmStrip] fonts.ready rejected, using fallback fonts', err);
      });
    }
  }, [edgeCanvas]);

  // 胶片基底材质：深褐色 + dirt 污渍 + grunge 粗糙度
  // DoubleSide：弯曲后从背面也能看到（防止从某个视角看到穿透）
  // applyCurvedShader：注入动态弯曲 vertex shader（弯曲随 activeSectionX 变化）
  const filmBaseMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: '#2a1a0e',
      map: dirtMap,
      roughnessMap: grungeMap,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    applyCurvedShader(m);
    return m;
  }, [dirtMap, grungeMap]);

  // 胶片边缘材质：带齿孔的 CanvasTexture
  // DoubleSide：上下边缘从背面看也要正确显示
  // emissiveIntensity 提到 5：让齿孔区域背景发光，齿孔（纯黑）对比明显
  // emissive 用更暖的琥珀色 #6a3a00：背景偏暖橙，与齿孔纯黑对比更鲜明
  // applyCurvedShader：注入动态弯曲（与基底同步弯曲）
  const filmEdgeMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: edgeTexture,
      color: '#5a3a22',
      roughnessMap: grungeMap,
      roughness: 0.95,
      metalness: 0.05,
      emissive: '#6a3a00',
      emissiveMap: edgeTexture,
      emissiveIntensity: 5,
      side: THREE.DoubleSide,
    });
    applyCurvedShader(m);
    return m;
  }, [edgeTexture, grungeMap]);

  // useFrame：平滑更新弯曲中心到当前 section
  // lerp 系数 0.08：切换时有缓动过渡，避免弯曲突变
  useFrame((_, delta) => {
    curvedUniforms.uActiveCenterX.value = THREE.MathUtils.lerp(
      curvedUniforms.uActiveCenterX.value,
      activeSectionX,
      Math.min(delta * 3, 1)  // 帧率无关 lerp，速度 3
    );
  });

  // 左延伸独立材质：UV offset 让 dirt 与基底连续
  // 基底 mesh 宽 20，UV [0,1] 对应 worldX [-10,10]，dirt repeat=3 → UV 范围 [0,3]
  // 左延伸在 worldX [-10,-6]（基底左边缘部分），对应基底 UV [0, 0.2]（×3 → [0, 0.6]）
  // 但左延伸是独立 mesh，UV 从 [0,1] 开始，需要 offset=-2 让 dirt 纹理对齐基底左边缘
  // 简化：repeat=3，sideW=2 占总宽 20 的 10%，UV 应占 0.1×3=0.3 范围
  //        左延伸 UV offset = -0.3（让 dirt 接着基底左边缘继续）
  // 注意：dirtMap/grungeMap 是共享纹理，必须用独立材质实例才能有独立 offset
  const leftExtMat = useMemo(() => {
    const dirt = dirtMap.clone();
    dirt.needsUpdate = true;
    dirt.wrapS = THREE.RepeatWrapping;
    dirt.wrapT = THREE.RepeatWrapping;
    dirt.repeat.set(0.3, 1);    // sideW=2 占总宽 10%，repeat 缩放
    dirt.offset.set(-0.3, 0);    // 让 dirt 接着基底左边缘继续
    dirt.colorSpace = THREE.SRGBColorSpace;

    const grunge = grungeMap.clone();
    grunge.needsUpdate = true;
    grunge.wrapS = THREE.RepeatWrapping;
    grunge.wrapT = THREE.RepeatWrapping;
    grunge.repeat.set(0.3, 1);
    grunge.offset.set(-0.3, 0);

    const m = new THREE.MeshStandardMaterial({
      color: '#2a1a0e',
      map: dirt,
      roughnessMap: grunge,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    // 用 dirtCurvedUniforms：弯曲量受限，确保 dirt 永远在屏幕之后
    applyCurvedShader(m, dirtCurvedUniforms);
    return m;
  }, [dirtMap, grungeMap]);

  // 右延伸独立材质：UV offset 让 dirt 与基底连续
  // 右延伸在 worldX [6,10]（基底右边缘部分），UV offset = 3（接着基底右边缘继续）
  const rightExtMat = useMemo(() => {
    const dirt = dirtMap.clone();
    dirt.needsUpdate = true;
    dirt.wrapS = THREE.RepeatWrapping;
    dirt.wrapT = THREE.RepeatWrapping;
    dirt.repeat.set(0.3, 1);
    dirt.offset.set(3.0, 0);    // 接着基底右边缘继续
    dirt.colorSpace = THREE.SRGBColorSpace;

    const grunge = grungeMap.clone();
    grunge.needsUpdate = true;
    grunge.wrapS = THREE.RepeatWrapping;
    grunge.wrapT = THREE.RepeatWrapping;
    grunge.repeat.set(0.3, 1);
    grunge.offset.set(3.0, 0);

    const m = new THREE.MeshStandardMaterial({
      color: '#2a1a0e',
      map: dirt,
      roughnessMap: grunge,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    // 用 dirtCurvedUniforms：弯曲量受限，确保 dirt 永远在屏幕之后
    applyCurvedShader(m, dirtCurvedUniforms);
    return m;
  }, [dirtMap, grungeMap]);

  // 胶片尺寸：宽 20，高 4.6（屏幕 16×3 在中间，上下边缘各 0.8 高）
  // 屏幕宽 16 = 4 个 section × 每个 4 宽
  // edgeH 从 0.6 增到 0.8：让齿孔在 world 中更显眼
  //   之前 edgeH=0.6，齿孔 55px 仅占 0.13 world 高，视角 0.5° 看不见
  //   现在 edgeH=0.8，齿孔 90px 占 0.225 world 高，视角 1.8° 明显可见
  const FILM_W = 20;
  const FILM_H = 4.6;
  const SCREEN_W = 16;
  const SCREEN_H = 3;
  const edgeH = (FILM_H - SCREEN_H) / 2;  // 上下边缘各 0.8 高
  const sideW = (FILM_W - SCREEN_W) / 2;  // 左右延伸各 2 宽

  // 几何体静态弯曲：设为 0（平直），弯曲完全由 applyCurvedShader 在
  // vertex shader 中动态控制（当前 section 平直，远离 section 卷曲）
  // 如果非 0，会和 shader 弯曲叠加，导致弯曲过度
  const CURVATURE = 0;

  // 左右延伸 mesh 在 group 中的 x 偏移
  // 左延伸位置 x = -SCREEN_W/2 - sideW/2 = -8 - 1 = -9
  // 右延伸位置 x = 9
  const LEFT_EXT_X = -SCREEN_W / 2 - sideW / 2;
  const RIGHT_EXT_X = SCREEN_W / 2 + sideW / 2;

  // 各 mesh 的弯曲几何体（每个 mesh 独立几何体，不能共享）
  // xOffset 关键：让每段 mesh 在 group worldX 坐标系中弯曲连续
  // 基底/上下边缘居中（xOffset=0），左右延伸 xOffset=±9，分隔线 xOffset=各自 x 位置
  const baseGeo = useMemo(
    () => makeCurvedGeometry(FILM_W, FILM_H, 32, 4, CURVATURE, 0),
    [FILM_W, FILM_H, CURVATURE]
  );
  const topEdgeGeo = useMemo(
    () => makeCurvedGeometry(FILM_W, edgeH, 32, 2, CURVATURE, 0),
    [FILM_W, edgeH, CURVATURE]
  );
  const bottomEdgeGeo = useMemo(
    () => makeCurvedGeometry(FILM_W, edgeH, 32, 2, CURVATURE, 0),
    [FILM_W, edgeH, CURVATURE]
  );
  // 左右延伸几何体：高度用 FILM_H 而非 SCREEN_H
  // 之前用 SCREEN_H=3，左右延伸只覆盖 y[-1.5,1.5]，上下各 0.8 单位
  // 被上下边缘 mesh（齿孔）遮挡，导致 dirt 看起来被截断
  // 现在用 FILM_H=4.6，完全覆盖基底高度，dirt 完整可见
  const leftExtGeo = useMemo(
    () => makeCurvedGeometry(sideW, FILM_H, 8, 4, CURVATURE, LEFT_EXT_X),
    [sideW, FILM_H, CURVATURE, LEFT_EXT_X]
  );
  const rightExtGeo = useMemo(
    () => makeCurvedGeometry(sideW, FILM_H, 8, 4, CURVATURE, RIGHT_EXT_X),
    [sideW, FILM_H, CURVATURE, RIGHT_EXT_X]
  );
  // 4 条帧分隔线，xOffset 各自不同
  const dividerGeos = useMemo(
    () =>
      [-4, 0, 4, 8].map((x) =>
        makeCurvedGeometry(0.04, SCREEN_H, 2, 4, CURVATURE, x)
      ),
    [SCREEN_H, CURVATURE]
  );

  // 卸载时释放几何体内存
  useEffect(() => {
    return () => {
      baseGeo.dispose();
      topEdgeGeo.dispose();
      bottomEdgeGeo.dispose();
      leftExtGeo.dispose();
      rightExtGeo.dispose();
      dividerGeos.forEach((g) => g.dispose());
    };
  }, [baseGeo, topEdgeGeo, bottomEdgeGeo, leftExtGeo, rightExtGeo, dividerGeos]);

  // 胶片整体偏移 x=6：让 section 0 中心在原点（相机初始看向 0,0,0）
  // 屏幕从 -2 到 14，中心 6；胶片从 -4 到 16，中心 6
  return (
    <group position={[6, 0, 0]}>
      {/* 胶片基底（整体背板）：深褐色，带 dirt 污渍，弯曲
          原本是 boxGeometry（有厚度），改成弯曲 planeGeometry 失去厚度
          但基底被前面 mesh 遮挡看不到，影响小，换来弯曲效果值得 */}
      <mesh position={[0, 0, -0.15]} material={filmBaseMat}>
        <primitive object={baseGeo} attach="geometry" />
      </mesh>

      {/* 上边缘：齿孔 + 编码（CanvasTexture），弯曲
          z=0.05 前移到屏幕(0)之前，确保齿孔+编码永远在最前可见
          （上下边缘宽 20 覆盖整个 x，与左右延伸在两侧 y 区域重叠，
           需前移避免被 dirt 遮挡；y=[1.5,2.3] 不与屏幕 y=[-1.5,1.5] 重叠） */}
      <mesh position={[0, SCREEN_H / 2 + edgeH / 2, 0.05]} material={filmEdgeMat}>
        <primitive object={topEdgeGeo} attach="geometry" />
      </mesh>

      {/* 下边缘：齿孔 + 编码（CanvasTexture），弯曲
          z=0.05 与上边缘同步，前移到最前 */}
      <mesh position={[0, -SCREEN_H / 2 - edgeH / 2, 0.05]} material={filmEdgeMat}>
        <primitive object={bottomEdgeGeo} attach="geometry" />
      </mesh>

      {/* 左延伸：纯胶片色 + dirt，弯曲（xOffset=-9 让弯曲在 worldX 连续）
          z=-0.08 在齿孔(0.05)之后，dirt 不会遮挡齿孔+编码
          高度用 FILM_H=4.6 完整覆盖基底，dirt 不被截断
          用 leftExtMat 独立材质：UV offset 让 dirt 与基底连续（不独立平铺） */}
      <mesh position={[LEFT_EXT_X, 0, -0.08]} material={leftExtMat}>
        <primitive object={leftExtGeo} attach="geometry" />
      </mesh>

      {/* 右延伸：纯胶片色 + dirt，弯曲（xOffset=9）
          z=-0.08 在齿孔之后
          用 rightExtMat 独立材质：UV offset 让 dirt 与基底连续 */}
      <mesh position={[RIGHT_EXT_X, 0, -0.08]} material={rightExtMat}>
        <primitive object={rightExtGeo} attach="geometry" />
      </mesh>

      {/* 帧分隔线：每个 section 之间的竖线，标识胶片画面帧边界
          section i 和 i+1 之间在 x = i*4 - SCREEN_W/2 + 4 = i*4 - 4
          即 x = -4, 0, 4, 8（相对 group 中心）
          每条分隔线用对应 xOffset 的弯曲几何体，弯曲与胶片一致 */}
      {[-4, 0, 4, 8].map((x, i) => (
        <mesh key={i} position={[x, 0, -0.02]}>
          <primitive object={dividerGeos[i]} attach="geometry" />
          <meshBasicMaterial color="#050300" side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 烟雾缭绕层（程序化体积烟雾）
 *
 * 功能：在场景中生成多个半透明烟雾 plane，用柔光纹理 + 缓慢自转 + 上下漂浮
 *      模拟体积烟雾缭绕效果。烟雾不跟随相机旋转（固定朝向），并随 progress
 *      整体淡入淡出，避免在相机高位时遮挡 Hello 文字。
 *
 * 参数：
 *  - count       烟雾 plane 数量
 *  - areaSize    烟雾扩散范围（x/z 平面）
 *  - areaHeight  烟雾高度范围（y）
 *  - color       烟雾颜色
 *  - progressRef 当前 contact 滚动进度 ref（控制烟雾整体淡入淡出）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 使用 plane mesh 而非 sprite，避免跟随相机旋转
 *  - 每个烟雾 plane 独立 material 实例，独立控制 opacity
 *  - depthWrite=false 避免烟雾遮挡后面的电话
 *  - NormalBlending（非 Additive）让烟雾有真实遮挡感（半透明）
 */
function SmokeLayer({
  count = 8,
  areaSize = 10,
  areaHeight = 8,
  color = '#3a2a1a',
  progressRef,
}: {
  count?: number;
  areaSize?: number;
  areaHeight?: number;
  color?: string;
  progressRef: React.MutableRefObject<number>;
}) {
  const meshesRef = useRef<THREE.Mesh[]>([]);

  // 程序化烟雾纹理：柔光团状，中心浓边缘淡
  // 加大多个不规则白点叠加，让烟雾团形状更自然
  const texture = useMemo(() => {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    // 基础径向渐变：中心浓，边缘淡
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    grad.addColorStop(0.8, 'rgba(255,255,255,0.1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    // 叠加多个不规则白点，让烟雾团形状更自然（非完美圆形）
    for (let i = 0; i < 6; i++) {
      const px = size / 2 + (Math.random() - 0.5) * size * 0.4;
      const py = size / 2 + (Math.random() - 0.5) * size * 0.4;
      const r = size * (0.15 + Math.random() * 0.2);
      const g2 = ctx.createRadialGradient(px, py, 0, px, py, r);
      g2.addColorStop(0, 'rgba(255,255,255,0.4)');
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, size, size);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  // 烟雾 plane 初始参数
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      // 位置：在场景中随机分布
      x: (Math.random() - 0.5) * areaSize,
      y: (Math.random() - 0.5) * areaHeight,
      z: (Math.random() - 0.5) * areaSize,
      // 缓慢移动参数
      driftSpeed: 0.05 + Math.random() * 0.08,
      rotationSpeed: (Math.random() - 0.5) * 0.1,
      phase: Math.random() * Math.PI * 2,
      // 烟雾团大小：差异较大，有近有远
      scale: 2.5 + Math.random() * 4.5,
      // 基础不透明度：每个 plane 独立
      baseOpacity: 0.3 + Math.random() * 0.4,
      // 初始旋转角度
      rotZ: Math.random() * Math.PI * 2,
    }));
  }, [count, areaSize, areaHeight]);

  // 共享 geometry，每粒子独立 material
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const materials = useMemo(() => {
    return Array.from({ length: count }, () => {
      return new THREE.MeshBasicMaterial({
        map: texture,
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        // AdditiveBlending：在深色背景上叠加发光感，烟雾明显可见
        // （NormalBlending 在深色背景上几乎看不到半透明物）
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    });
  }, [texture, color, count]);

  // 每帧：缓慢漂浮 + 自转 + 随 progress 整体淡入淡出
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const p = progressRef.current;
    // 烟雾在 progress=0.1~0.7 区间最浓，两端淡化
    // progress<0.1 时几乎不可见（避免遮挡 Hello）
    // progress>0.7 逐渐淡化（避免遮挡电话细节）
    let visibility = 1;
    if (p < 0.1) visibility = p / 0.1;
    else if (p > 0.7) visibility = Math.max(0, 1 - (p - 0.7) / 0.3);

    for (let i = 0; i < particles.length; i++) {
      const sp = particles[i];
      const m = meshesRef.current[i];
      if (!m) continue;
      // 缓慢漂浮：y 上下波动 + x 轻微漂移
      m.position.x = sp.x + Math.sin(t * sp.driftSpeed + sp.phase) * 0.6;
      m.position.y =
        sp.y + Math.sin(t * sp.driftSpeed * 0.8 + sp.phase * 1.3) * 0.8;
      m.position.z = sp.z;
      // 缓慢自转
      m.rotation.z = sp.rotZ + t * sp.rotationSpeed;
      // opacity 随 visibility 调整
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = sp.baseOpacity * visibility;
    }
  });

  return (
    <group>
      {particles.map((p, i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) meshesRef.current[i] = el;
          }}
          geometry={geometry}
          material={materials[i]}
          // 固定朝向 +z，不跟随相机旋转
          rotation={[0, 0, p.rotZ]}
          scale={[p.scale, p.scale, 1]}
        />
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
  // 用 mesh ref 替代 sprite ref（mesh 朝向固定，不跟随相机旋转）
  const meshesRef = useRef<THREE.Mesh[]>([]);

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

  // 共享 plane geometry（所有粒子用同一个圆形 plane）
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  // 每个粒子独立 material 实例（独立控制 opacity，避免互相覆盖）
  const materials = useMemo(() => {
    return Array.from({ length: count }, () => {
      return new THREE.MeshBasicMaterial({
        map: texture,
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    });
  }, [texture, color, count]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const m = meshesRef.current[i];
      if (!m) continue;
      m.position.x = p.x + Math.sin(t * p.speed + p.phase) * p.amp;
      m.position.y = p.y + Math.cos(t * p.speed * 0.7 + p.phase) * p.amp;
      m.position.z = p.z + Math.sin(t * p.speed * 0.9 + p.phase * 1.3) * p.amp;
      const mat = m.material as THREE.MeshBasicMaterial;
      const flicker = 0.5 + 0.5 * Math.sin(t * p.flickerSpeed + p.phase);
      mat.opacity = 0.7 * flicker;
    }
  });

  return (
    <group>
      {particles.map((p, i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) meshesRef.current[i] = el;
          }}
          geometry={geometry}
          material={materials[i]}
          // plane 朝向 +z（固定，不跟随相机旋转）
          // 相机从高处下降时粒子保持竖直，不会翻转
          rotation={[0, 0, 0]}
          scale={[0.2 * p.scale, 0.2 * p.scale, 1]}
        />
      ))}
    </group>
  );
}

/**
 * PhoneModel - 复古电话 3D 模型组件（静态）
 *
 * 功能：加载 phones.glb 模型，按传入的 position/rotation 静态摆放，
 *      不做自转动画。三角排列时各电话朝向不同，营造戏剧感。
 *      模型组整体的鼠标视差旋转由父级 ContactScene 控制。
 *
 * 参数：
 *  - position  模型位置 [x, y, z]
 *  - rotation  模型初始旋转 [x, y, z]（固定不变）
 *  - scale     缩放（默认 1）
 *
 * 返回值：React.ReactElement
 *
 * 异常：useGLTF 加载失败时由 Suspense 边界处理
 *
 * 注意事项：
 *  - useGLTF 必须在 <Suspense> 内部使用
 *  - 用 scene.clone(true) 避免多个 PhoneModel 共享同一场景图（否则位置/旋转互相干扰）
 *  - traverse 设置 castShadow/receiveShadow 让模型参与阴影
 *  - toneMapped=false 让贴图颜色保持鲜艳，呼应 shader.se 的暖色调
 *  - 不使用 useFrame，模型保持静态（仅父级 group 的视差旋转影响整体）
 */
function PhoneModel({
  position,
  rotation,
  scale = 1,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  scale?: number;
}) {
  const { scene } = useGLTF('/asset/models/phones.glb');
  // 克隆场景图：多个 PhoneModel 实例独立位置/旋转
  const cloned = useMemo(() => scene.clone(true), [scene]);

  // 遍历设置阴影和材质（让模型更立体）
  useMemo(() => {
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // 让金属/塑料材质更鲜艳
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          if (m && (m as THREE.MeshStandardMaterial).toneMapped !== undefined) {
            (m as THREE.MeshStandardMaterial).toneMapped = false;
          }
        });
      }
    });
  }, [cloned]);

  return (
    <primitive
      object={cloned}
      position={position}
      rotation={rotation}
      scale={scale}
    />
  );
}

// 预加载电话模型，避免首次进入 contact 详情页时卡顿
useGLTF.preload('/asset/models/phones.glb');

/**
 * ContactScene - shader.se/#contact 风格 3D 场景
 *
 * 功能：复刻 shader.se/#contact 页面的 3D 效果：
 *  - 电话模型静态摆放，焦点电话在 z=1.0
 *  - 相机随 contactScrollProgress 从高处俯视下降到电话机水平：
 *      progress=0：相机在高处 (y=8)，lookAt 在电话机上方 (y=6) → 看不见电话机
 *      progress=1：相机降到电话机水平 (y=2.2)，lookAt 落到电话机 (y=0.1) → 正面看电话机
 *  - 三点布光（key 暖色主光 + fill 冷色补光 + rim 轮廓光）
 *  - 漂浮尘埃粒子营造氛围
 *  - 鼠标视差：模型组轻微跟随鼠标旋转（相机由 progress 控制，不受鼠标影响）
 *
 * 参数：
 *  - mouseRef                鼠标归一化坐标 ref（-1~1），驱动模型组视差旋转
 *  - contactScrollProgress   contact 详情页内部滚动进度 0~1（驱动相机下降）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - PhoneModel 在 <Suspense> 内部（模型未加载完时显示 null）
 *  - 相机 y 和 lookAt y 都由 progress 线性插值，让镜头"从天上降到地面"
 *  - 相机 z 保持 8 不变（不前后移动，只上下移动 + 视线下移）
 *  - 阴影由 Canvas 的 shadows 属性开启
 */
export function ContactScene({
  mouseRef,
  contactScrollProgress,
}: {
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  contactScrollProgress: React.MutableRefObject<number>;
}) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const mouseSmoothed = useRef({ x: 0, y: 0 });

  // 焦点电话位置（中间，最靠近相机）
  const focusPos = useMemo<[number, number, number]>(() => [0, 0.1, 1.0], []);

  // 相机动画参数：起点（高处俯视看不到电话）→ 终点（电话机水平正面看）
  // progress=0：相机在 y=18 高处，lookAt y=9（视线指向电话上方）
  //   - 视线方向 (0, -9, -7)，电话方向 (0, -17.9, -7)
  //   - 角度差：atan(17.9/7) - atan(9/7) ≈ 68.6° - 52.1° = 16.5°
  //   - 加上 FOV/2=15°（FOV=30 时），电话在画面下方边缘外，看不到
  // progress=1：相机降到 y=1.5，lookAt y=2.0，正面看电话机
  //   - lookAt 从 0.1 抬到 2.0，视线落在电话中部，避免看电话底部太矮
  const CAMERA_START_Y = 18.0;  // 起点高度（高处俯视）
  const CAMERA_END_Y = 1.5;     // 终点高度（贴近电话机水平）
  const LOOKAT_START_Y = 9.0;   // 视线起点：指向电话上方远处（电话在画面外）
  const LOOKAT_END_Y = 2.0;     // 视线终点：抬高到电话中部（原 0.1 太矮）
  const CAMERA_Z = 8;          // 相机 z 固定

  // FOV 动画参数：随 progress 从 30° 增大到 60°
  // - progress=0：FOV=30°（窄视野），看不到电话（电话在画面下方边缘外）
  // - progress=1：FOV=60°（宽视野），电话在画面中较大
  // - FOV 增大让"镜头从远处拉近"的视觉冲击更强（透视变形增加）
  const FOV_START = 30;
  const FOV_END = 60;

  // 相机当前位置（用于 lerp 平滑，避免滚轮离散变化直接反映到相机）
  // 初始化为起点，每帧向目标位置 lerp，制造惯性感
  const camPosRef = useRef(new THREE.Vector3(0, CAMERA_START_Y, CAMERA_Z));
  const lookPosRef = useRef(new THREE.Vector3(0, LOOKAT_START_Y, focusPos[2]));
  // FOV 当前值（用于 lerp 平滑）
  const fovRef = useRef(FOV_START);

  // 每帧：根据 contactScrollProgress 计算目标位置，用 lerp 平滑追随
  //        + 鼠标视差让模型组轻微旋转
  useFrame(() => {
    const p = contactScrollProgress.current;
    // 用 smootherstep（Ken Perlin）替代 smoothstep，过渡更丝滑
    // smootherstep: t = p^3 * (p * (p * 6 - 15) + 10)
    const t = p * p * p * (p * (p * 6 - 15) + 10);

    // 计算目标位置（离散，跟随滚轮）
    const targetCamY = CAMERA_START_Y + (CAMERA_END_Y - CAMERA_START_Y) * t;
    const targetLookY = LOOKAT_START_Y + (LOOKAT_END_Y - LOOKAT_START_Y) * t;
    // 目标 FOV
    const targetFov = FOV_START + (FOV_END - FOV_START) * t;

    // lerp 平滑：当前 → 目标，系数 0.15 让相机有惯性追随感
    // 系数越小越丝滑但延迟越大，0.15 平衡跟手度与平滑度（约 150ms 到达目标）
    const LERP_FACTOR = 0.15;
    camPosRef.current.y += (targetCamY - camPosRef.current.y) * LERP_FACTOR;
    lookPosRef.current.y += (targetLookY - lookPosRef.current.y) * LERP_FACTOR;
    fovRef.current += (targetFov - fovRef.current) * LERP_FACTOR;

    camera.position.copy(camPosRef.current);
    camera.lookAt(lookPosRef.current);
    // 更新 FOV（perspectiveCamera 的 fov 改变后必须调用 updateProjectionMatrix）
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fovRef.current;
      camera.updateProjectionMatrix();
    }

    // 鼠标视差让模型组轻微旋转（相机由 progress 控制，不受鼠标影响）
    if (groupRef.current) {
      const target = mouseRef.current;
      mouseSmoothed.current.x += (target.x - mouseSmoothed.current.x) * 0.05;
      mouseSmoothed.current.y += (target.y - mouseSmoothed.current.y) * 0.05;
      // 视差旋转幅度：±0.18 rad（约 ±10°）
      groupRef.current.rotation.y = mouseSmoothed.current.x * 0.18;
      groupRef.current.rotation.x = mouseSmoothed.current.y * -0.08;
    }
  });

  return (
    <>
      {/* 环境光：提升亮度，避免画面太暗看不见模型 */}
      <ambientLight intensity={0.55} color="#605570" />

      {/* Key light：右上前方暖色主光，照亮电话顶部和右侧
          不开 castShadow：contact 场景相机跨度大（y=18→1.5），
          默认阴影相机范围（±5）无法覆盖，会产生方形阴影截断 */}
      <directionalLight position={[4, 5, 4]} intensity={4.0} color="#ffe5b4" />

      {/* Fill light：左侧冷色补光，照亮阴影区域，降低对比度 */}
      <directionalLight position={[-4, 2, 3]} intensity={1.6} color="#88aaff" />

      {/* Rim light：后下方暖色轮廓光，让电话边缘有金色描边 */}
      <directionalLight position={[0, -2, -5]} intensity={2.0} color="#ff8866" />

      {/* 模型组（鼠标视差作用对象） */}
      <group ref={groupRef}>
        <Suspense fallback={null}>
          {/* 电话模型（静态）：
              - phones.glb 本身可能已包含多个电话，只渲染 1 个实例避免重复
              - 焦点位置（z=1.0，相机 lookAt 目标）
              - rotation y=PI 让模型正面朝向相机（默认正面朝 -z，相机在 +z）
              整体随鼠标视差轻微旋转（由 groupRef 控制） */}
          <PhoneModel
            position={focusPos}
            rotation={[0, Math.PI, 0]}
            scale={1}
          />
        </Suspense>
      </group>

      {/* 烟雾缭绕层：缓慢漂浮的半透明烟雾团，营造电影感氛围
          - 烟雾分布在相机视野内：x/z 范围 ±3.5，y 范围约 -1~7
            覆盖相机从高处俯视到平视的整个视野
          - progress<0.1 时几乎不可见（避免遮挡 Hello）
          - progress 0.1~0.7 区间最浓
          - progress>0.7 逐渐淡化（避免遮挡电话细节） */}
      <SmokeLayer
        count={12}
        areaSize={7}
        areaHeight={8}
        color="#8a6a45"
        progressRef={contactScrollProgress}
      />
    </>
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

      {/* 胶片条（35mm 电影胶片风格，替代电脑外壳）
          activeSectionX：当前 section 中心 world x（section i → i*4）
          传给 FilmStrip 让弯曲中心随 section 切换平滑移动 */}
      <FilmStrip activeSectionX={sectionIndex * 4} />

      {/* 屏幕显示（含 RectAreaLight） */}
      <ScreenDisplay sectionIndex={sectionIndex} transitionFlashRef={transitionFlashRef} />

      {/* 漂浮尘埃粒子 */}
      <DustParticles count={35} areaSize={5} color="#ffd9a0" />
    </>
  );
}
