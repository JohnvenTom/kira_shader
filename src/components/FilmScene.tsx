import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
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

    // 5. 大标题（自动换行，避免长标题超出屏幕宽度）
    // 之前固定 96px 单行，"CREATIVE STUDIO" 接近 1024 宽度上限，
    // 相机推近后视场变窄 → 标题被截断或挤到第二行错位
    // 改为：先测单行宽度，超 maxWidth 则按空格拆成多行居中绘制
    ctx.fillStyle = '#fcf9f3';
    ctx.font = 'bold 84px "STIX Two Text", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const titleFontSize = 84;
    const titleLineHeight = titleFontSize * 1.1;
    const titleMaxWidth = w * 0.85;  // 最大宽度 = 屏幕 85%
    const words = section.title.split(' ');
    const lines = [];
    let currentLine = words[0] || '';
    for (let i = 1; i < words.length; i++) {
      const testLine = currentLine + ' ' + words[i];
      if (ctx.measureText(testLine).width > titleMaxWidth) {
        lines.push(currentLine);
        currentLine = words[i];
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
    const totalTitleHeight = lines.length * titleLineHeight;
    const titleStartY = h / 2 - 60 - totalTitleHeight / 2 + titleLineHeight / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, w / 2, titleStartY + i * titleLineHeight);
    });

    // 6. 副标题（accentColor）
    ctx.fillStyle = section.accentColor;
    ctx.font = '300 36px "Cormorant Garamond", serif';
    ctx.fillText(section.subtitle, w / 2, h / 2 + 30);

    // 7. 描述（淡灰）
    ctx.fillStyle = 'rgba(252,249,243,0.6)';
    ctx.font = '20px ui-monospace, monospace';
    ctx.fillText(section.description, w / 2, h / 2 + 100);

    // 8. 角标：section 编号
    ctx.fillStyle = 'rgba(252,249,243,0.5)';
    ctx.font = '20px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`0${idx + 1} / 04`, 40, h - 40);

    // 9. 角标：右上角时间戳
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toISOString().slice(0, 10), w - 40, h - 40);

    // 10. 扫描线（复古 CRT 感）
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
const CAMERA_END = { x: 0, y: 0, z: -0.3 };  // 负值 = 穿过屏幕到背面
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

    // 计算当前段索引和段内进度
    const totalSegment = totalProgress * 4;
    const segIndex = Math.min(3, Math.floor(totalSegment));
    const segmentProgress = totalSegment - segIndex;

    // === section 切换：直接跟随 segIndex ===
    // segIndex 在 progress 越过 0.25 边界时跳变：
    //  - 边界前（段 N 末尾）：segmentProgress≈1.0，闪光≈1（峰值，掩盖切换）
    //  - 边界后（段 N+1 开头）：segmentProgress≈0，segIndex>0 → 闪光≈1（段开头淡出期）
    // 两侧闪光都接近峰值，切换瞬间被完全掩盖，用户感知不到
    // 反向滚动同理：segIndex 回退时，段末闪光掩盖切换
    if (sectionIndex !== segIndex) {
      setSectionIndex(segIndex);
    }

    // === 计算闪光强度 ===
    // 闪光只在 section 切换瞬间极短触发，精确跟随滚动位置（不用 lerp，避免延迟导致闪烁）
    // 段末 [0.93, 0.985] 快速上升 → 切换瞬间（1.0）达峰值
    // 段开头 [0, 0.07] 快速淡出（除了第一段开头）
    let flash = 0;
    if (segmentProgress > 0.93) {
      flash = Math.max(flash, smoothstep(0.93, 0.985, segmentProgress));
    }
    if (segmentProgress < 0.07 && segIndex > 0) {
      flash = Math.max(flash, 1 - smoothstep(0, 0.07, segmentProgress));
    }
    // 第一段开头不闪光（首次进入）
    if (segIndex === 0 && segmentProgress < 0.07) {
      flash = 0;
    }
    transitionFlashRef.current = flash;

    // === 计算相机位置 ===
    // 段内进度到相机 t 的映射：
    //  [0, 0.07]    → 相机从背面回到远景（被闪光掩盖）
    //  [0.07, 0.93] → 远景 → 推进到屏幕
    //  [0.93, 1.0]  → 已穿过屏幕，停在背面
    let cameraT = 0;
    if (segmentProgress >= 0.07 && segmentProgress <= 0.93) {
      cameraT = (segmentProgress - 0.07) / 0.86;
      // 缓动：pow(t, 1.6) 让前期慢、后期加速，"扎进屏幕"感
      cameraT = Math.pow(cameraT, 1.6);
    } else if (segmentProgress > 0.93) {
      cameraT = 1;
    } else if (segmentProgress < 0.07 && segIndex > 0) {
      // 段开头：从背面回到远景，t 从 1 → 0
      cameraT = 1 - segmentProgress / 0.07;
    }

    // 鼠标视差（仅在非闪光 + 非推入终时生效）
    // 幅度压到极小（0.12/0.08），避免相机旋转导致屏幕投影面积波动 → bloom 辉光区域波动 → 闪烁
    const target = mouseRef.current;
    const smoothed = mouseSmoothedRef.current;
    smoothed.x += (target.x - smoothed.x) * 0.05;
    smoothed.y += (target.y - smoothed.y) * 0.05;
    const parallaxStrength = (1 - cameraT) * (1 - transitionFlashRef.current);

    // 相机位置：从远景 lerp 到推入终点
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
