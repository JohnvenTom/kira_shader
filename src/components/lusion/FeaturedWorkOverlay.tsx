/**
 * FeaturedWorkOverlay - film 页第 0 帧（CREATIVE STUDIO）的 Featured Work 卡片墙
 *
 * 架构（移植 lusion.co Featured Work，规格见 .lusion_analysis/lusion-card-effect.ts）：
 *  - 全屏覆盖层（z-55，高于滚轮捕获层 z-50，低于 NavBar/详情页 z-60）
 *  - 双层：底部固定 R3F canvas（pointer-events:none，渲染 6 张 DOM 同步 WebGL 卡片）
 *          + 顶部原生滚动 DOM 层（透明占位矩形接收 hover，页头 hero + 文字动效）
 *  - 滚动边界移交：滚到底继续下滚 → onAdvance（胶片滑向第 1 帧）；
 *                  顶部上滚 → onRetreat（注入负能量，保留"穿回首页"语义）
 *  - 触屏降级：pointer:coarse 时不挂 WebGL，占位内直接显示 <img>
 *
 * 接线方（KiraFilmDemo）：
 *  - active = sectionIndex === 0 && !detailOpen
 *  - onAdvance：写 dragOffsetRef=-4 + 惯性归零（镜像 hash 跳帧）
 *  - onRetreat：转发 injectScroll(dy, now)
 */
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LusionCard } from './LusionCard';

/* ---------- 项目数据（lusion 首页 Featured Work，资源已本地化） ---------- */
interface ProjectDef {
  id: string;
  title: string;
  category: string;
  colorBg: string;
}

const PROJECTS: ProjectDef[] = [
  { id: 'oryzo_ai', title: 'Oryzo AI', category: 'concept • web • design • development • 3d • animation', colorBg: '#0e0f0c' },
  { id: 'atlas_motion', title: 'Atlas Motion', category: 'concept • web • design • development • 3d • animation', colorBg: '#0c0d10' },
  { id: 'devin_ai', title: 'Devin AI', category: 'web • design • development • 3d', colorBg: '#101013' },
  { id: 'of_the_oak', title: 'Of The Oak', category: 'web • design • development • 3d • animation', colorBg: '#0d100d' },
  { id: 'everswap', title: 'Everswap', category: 'concept • web • design • development • 3d • animation', colorBg: '#0e0c10' },
  { id: 'synthetic_human', title: 'Synthetic Human', category: 'concept • web • design • development • 3d • animation', colorBg: '#100f0e' },
];

const TEX_ROOT = '/asset/textures/projects';
const BLUE_NOISE_URL = '/asset/textures/lusion/LDR_RGB1_0.png';
const BLUE_NOISE_SIZE = 128;

/* 触摸拖拽的边界判定累积阈值（px） */
const TOUCH_ADVANCE_DELTA = 40;

export interface FeaturedWorkOverlayProps {
  active: boolean;
  /** 滚到底继续下滚 → 胶片滑向第 1 帧 */
  onAdvance: () => void;
  /** 顶部继续上滚 → 注入负能量（保留穿回首页语义），dy 为向下正像素位移 */
  onRetreat: (dy: number) => void;
}

export default function FeaturedWorkOverlay({
  active,
  onAdvance,
  onRetreat,
}: FeaturedWorkOverlayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const mainRefs = useRef<(HTMLDivElement | null)[]>([]);
  const line1Refs = useRef<(HTMLDivElement | null)[]>([]);
  const line2Refs = useRef<(HTMLDivElement | null)[]>([]);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mouseRef = useRef({ x: -1e4, y: -1e4 });

  /* 触屏降级（一次性判定） */
  const [isCoarse, setIsCoarse] = useState(false);
  useEffect(() => {
    setIsCoarse(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  /* canvas 挂载门控：active 时挂载，失活延迟卸载（等淡出走完） */
  const [canvasMounted, setCanvasMounted] = useState(false);
  useEffect(() => {
    if (active) {
      setCanvasMounted(true);
      return;
    }
    const t = setTimeout(() => setCanvasMounted(false), 750);
    return () => clearTimeout(t);
  }, [active]);

  /* 鼠标跟踪（client 坐标 = canvas 视口坐标） */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    mouseRef.current.x = e.clientX;
    mouseRef.current.y = e.clientY;
  }, []);

  /* ---------- 滚动边界移交 ---------- */
  const advanceLockRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 2;
      const atTop = el.scrollTop <= 0;
      if (atBottom && e.deltaY > 0) {
        e.preventDefault();
        // 锁 1.2s：触摸板惯性会连续触发，只放行一次
        const now = performance.now();
        if (now - advanceLockRef.current > 1200) {
          advanceLockRef.current = now;
          onAdvance();
        }
      } else if (atTop && e.deltaY < 0) {
        e.preventDefault();
        onRetreat(e.deltaY); // 透传原始 delta（负值 → 负能量）
      }
    };

    /* 触摸：顶/底边界滑动时的移交（累计位移判定，避免误触） */
    let lastY = 0;
    let bottomAcc = 0;
    let topAcc = 0;
    const onTouchStart = (e: TouchEvent) => {
      lastY = e.touches[0].clientY;
      bottomAcc = 0;
      topAcc = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      const dy = lastY - y; // 上滑为正
      lastY = y;
      const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 2;
      const atTop = el.scrollTop <= 0;
      if (atBottom && dy > 0) {
        bottomAcc += dy;
        if (bottomAcc > TOUCH_ADVANCE_DELTA) {
          bottomAcc = 0;
          const now = performance.now();
          if (now - advanceLockRef.current > 1200) {
            advanceLockRef.current = now;
            onAdvance();
          }
        }
      } else if (atTop && dy < 0) {
        topAcc += -dy;
        if (topAcc > TOUCH_ADVANCE_DELTA) {
          topAcc = 0;
          onRetreat(-Math.abs(dy)); // 负能量方向
        }
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [onAdvance, onRetreat]);

  /* 卡片实例容器（由 LusionScene 填充，事件回调按 index 转发） */
  const cardsRef = useRef<LusionCard[]>([]);

  const hoverHandlers = (i: number) => ({
    onMouseEnter: () => cardsRef.current[i]?.onHoverEnter(),
    onMouseLeave: () => cardsRef.current[i]?.onHoverLeave(),
  });
  const itemHandlers = (i: number) => ({
    onMouseEnter: () => cardsRef.current[i]?.onItemEnter(),
    onMouseLeave: () => cardsRef.current[i]?.onItemLeave(),
  });

  return (
    <div
      className={`lusion-overlay ${active ? 'visible' : ''}`}
      onMouseMove={isCoarse ? undefined : handleMouseMove}
    >
      {/* 底层：固定 R3F canvas（DOM 同步 WebGL 卡片） */}
      {!isCoarse && canvasMounted && (
        <div className="lusion-canvas">
          <Canvas
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            orthographic
            dpr={[1, 2]}
            camera={{ position: [0, 0, 1], near: -1000, far: 1000 }}
            onCreated={({ gl }) => gl.setClearAlpha(0)}
          >
            <Suspense fallback={null}>
              <LusionScene
                mainRefs={mainRefs}
                line1Refs={line1Refs}
                line2Refs={line2Refs}
                mouseRef={mouseRef}
                cardsRef={cardsRef}
              />
            </Suspense>
          </Canvas>
        </div>
      )}

      {/* 上层：原生滚动 DOM（页头 hero + 卡片占位 + 文字动效） */}
      <div ref={scrollRef} className="lusion-scroll">
        {/* 页头 hero（保留 CREATIVE STUDIO，压缩排版） */}
        <header className="lusion-hero">
          <div className="lusion-hero-index">01 / 06</div>
          <h1 className="lusion-hero-title">CREATIVE STUDIO</h1>
          <p className="lusion-hero-subtitle">Plugged into the Future</p>
          <p className="lusion-hero-desc">
            Interactive 3D and AI solutions for the web.
          </p>
          {/* 右侧空白区的平衡文案（lusion 式 disclaimer 排布） */}
          <div className="lusion-hero-side">
            <span className="lusion-hero-side-label">Featured Work</span>
            <p className="lusion-hero-side-text">
              A selection of immersive digital experiences — concept, design,
              development, 3D and animation, crafted for ambitious brands and
              forward-thinking teams.
            </p>
          </div>
        </header>

        {/* 卡片列表：交错双列 */}
        <div className="lusion-list">
          {PROJECTS.map((p, i) => (
            <div
              key={p.id}
              ref={(el) => { itemRefs.current[i] = el; }}
              className="lusion-item"
              {...(isCoarse ? {} : itemHandlers(i))}
            >
              <div
                ref={(el) => { mainRefs.current[i] = el; }}
                className="lusion-item-main"
                {...(isCoarse ? {} : hoverHandlers(i))}
              >
                {isCoarse && (
                  <img
                    src={`${TEX_ROOT}/${p.id}/home.webp`}
                    alt={p.title}
                    draggable={false}
                  />
                )}
              </div>
              <div
                ref={(el) => { line1Refs.current[i] = el; }}
                className="lusion-item-line-1"
              >
                {p.category}
              </div>
              <div className="lusion-item-line-2">
                <div
                  ref={(el) => { line2Refs.current[i] = el; }}
                  className="lusion-item-line-2-inner"
                >
                  {isCoarse ? p.title.toUpperCase() : ''}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 底部收尾 */}
        <footer className="lusion-footer">
          <span>Scroll to continue</span>
        </footer>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* 场景侧：纹理加载 + 相机管理 + 6 张卡片实例的每帧驱动                    */
/* ==================================================================== */

interface LusionSceneProps {
  mainRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  line1Refs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  line2Refs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  cardsRef: React.MutableRefObject<LusionCard[]>;
}

function LusionScene({
  mainRefs,
  line1Refs,
  line2Refs,
  mouseRef,
  cardsRef,
}: LusionSceneProps) {
  const { camera, gl, scene } = useThree();
  const size = useThree((s) => s.size);

  /* ---------- 纹理加载 ---------- */
  const colorUrls = useMemo(
    () => PROJECTS.map((p) => `${TEX_ROOT}/${p.id}/home.webp`),
    [],
  );
  const depthUrls = useMemo(
    () => PROJECTS.map((p) => `${TEX_ROOT}/${p.id}/home_depth.webp`),
    [],
  );
  const colorTextures = useLoader(THREE.TextureLoader, colorUrls);
  const depthTextures = useLoader(THREE.TextureLoader, depthUrls);
  const blueNoiseTexture = useLoader(THREE.TextureLoader, BLUE_NOISE_URL);

  /* 纹理配置（颜色 sRGB+mipmap；深度/噪声 Linear 无 mip） */
  useEffect(() => {
    colorTextures.forEach((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = 4;
      t.needsUpdate = true;
    });
    depthTextures.forEach((t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
    });
    blueNoiseTexture.colorSpace = THREE.NoColorSpace;
    blueNoiseTexture.minFilter = THREE.NearestFilter;
    blueNoiseTexture.magFilter = THREE.NearestFilter;
    blueNoiseTexture.generateMipmaps = false;
    blueNoiseTexture.wrapS = THREE.RepeatWrapping;
    blueNoiseTexture.wrapT = THREE.RepeatWrapping;
    blueNoiseTexture.needsUpdate = true;
  }, [colorTextures, depthTextures, blueNoiseTexture]);

  /* ---------- 共享 uniforms（时间 + 蓝噪声） ---------- */
  const shared = useMemo(
    () => ({
      timeUniform: { value: 0 },
      blueNoiseUniforms: {
        u_blueNoiseTexture: { value: blueNoiseTexture },
        u_blueNoiseTexelSize: {
          value: new THREE.Vector2(1 / BLUE_NOISE_SIZE, 1 / BLUE_NOISE_SIZE),
        },
        u_blueNoiseCoordOffset: { value: new THREE.Vector2() },
      },
    }),
    [blueNoiseTexture],
  );

  /* ---------- 相机：屏幕像素坐标系（y 向下）正交 ---------- */
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    cam.left = 0;
    cam.right = size.width;
    cam.top = 0;
    cam.bottom = -size.height;
    cam.updateProjectionMatrix();
  }, [camera, size]);

  /* ---------- 卡片实例（DOM 就绪后构建一次） ---------- */
  useEffect(() => {
    const cards: LusionCard[] = PROJECTS.filter(
      (_, i) => mainRefs.current[i] && line1Refs.current[i] && line2Refs.current[i],
    ).map((p) => {
      // filter 后索引可能错位，重取真实 index
      const idx = PROJECTS.indexOf(p);
      return new LusionCard({
        id: p.id,
        index: idx,
        domMain: mainRefs.current[idx]!,
        domFooterLine1: line1Refs.current[idx]!,
        domFooterLine2: line2Refs.current[idx]!,
        category: p.category,
        title: p.title,
        colorTexture: colorTextures[idx],
        depthTexture: depthTextures[idx],
        textureWidth: (colorTextures[idx].image as HTMLImageElement).width || 1200,
        textureHeight: (colorTextures[idx].image as HTMLImageElement).height || 900,
        colorBg: p.colorBg,
        blueNoiseUniforms: shared.blueNoiseUniforms,
        timeUniform: shared.timeUniform,
        viewportWidth: size.width,
      });
    });
    cardsRef.current = cards;
    cards.forEach((c) => scene.add(c.mesh));
    // 调试钩子：浏览器控制台可直读卡片状态机（window.__lusionCards）
    (window as unknown as Record<string, unknown>).__lusionCards = cards;

    const resolution = gl.getDrawingBufferSize(new THREE.Vector2());
    cards.forEach((c) => c.setViewport(size.width, resolution));

    return () => {
      cards.forEach((c) => {
        scene.remove(c.mesh);
        c.dispose();
      });
      cardsRef.current = [];
      delete (window as unknown as Record<string, unknown>).__lusionCards;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorTextures, depthTextures, shared, gl, scene]);

  /* 分辨率变化时刷新 u_resolution */
  useEffect(() => {
    const resolution = gl.getDrawingBufferSize(new THREE.Vector2());
    cardsRef.current.forEach((c) => c.setViewport(size.width, resolution));
  }, [gl, size, cardsRef]);

  /* ---------- 每帧驱动 ---------- */
  useFrame((_, delta) => {
    // dt 上限：后台标签页回来时的大 dt 会让弹簧爆冲
    const dt = Math.min(delta, 1 / 30);
    shared.timeUniform.value += dt;
    // 蓝噪声每帧随机平铺偏移（时间噪声化）
    shared.blueNoiseUniforms.u_blueNoiseCoordOffset.value.set(
      Math.random(),
      Math.random(),
    );
    for (const card of cardsRef.current) {
      card.update(dt, mouseRef.current, shared.timeUniform.value);
    }
  });

  return null;
}
