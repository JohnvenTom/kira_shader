/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { createSelectedWorkScene } from './scene';
import { createHeroCompose } from '../hero/heroCompose';
import { HERO_TIMELINE } from '../hero/heroConfig';
import SelectedWorkUI from './SelectedWorkUI';

/** 拖拽/滚轮翻页参数（原件 mh 拖拽层与 FilmReelScene 同值） */
const DRAG_CLAMP_RATIO = 0.2;
const DRAG_SNAP_RATIO = 0.1;
const WHEEL_STEP_RATIO = 0.1;
const WHEEL_LOCK_MS = 700;
/** 纵向滚轮累计超过该比例的视口高度 → 进入 About Us */
const SCROLL_ABOUT_RATIO = 0.5;

/**
 * `#selected-work` 独立页
 *
 * 功能：Selected Work 视口的完整复刻 —— 胶片卷场景 + 旋转棱柱标题，
 *      并复用 hero 的整条合成链（pageScroll = 2 时即为 projects 页效果：
 *      bloom / 调色 / 运动模糊 / 色散 / 桶形畸变 / 噪点）。
 *
 * 交互（全部照线上 bundle）：
 *  - 横向滚轮：累计 0.1·viewportWidth 翻一帧，700ms 锁
 *  - 拖拽：阈值 10px、位移钳制 ±0.2·w，松手超过 0.1·w 翻一帧
 *  - ←/→ 键翻帧
 *  - 纵向向下滚 / 点击底部提示 → About Us
 *
 * 注意：本页不套 StrictMode（main.tsx 里与 #hero 同一处理），
 * 避免 WebGPURenderer 被双挂载创建两次。
 */
export default function SelectedWorkPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(0);
  const apiRef = useRef<{ prev: () => void; next: () => void; about: () => void } | null>(null);

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const cleanups: Array<() => void> = [];
    const host = hostRef.current;
    if (!host) return;

    const go = (hash: string) => {
      if (window.location.hash !== hash) window.location.hash = hash;
    };
    const step = (delta: number) => {
      selectedRef.current += delta;
    };
    apiRef.current = {
      prev: () => step(-1),
      next: () => step(1),
      about: () => go('#about'),
    };

    (async () => {
      const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const renderer = new THREE.WebGPURenderer({ antialias: false, alpha: true, forceWebGL: !hasWebGPU });
      await renderer.init();
      if (disposed) {
        renderer.dispose?.();
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1;
      host.appendChild(renderer.domElement);

      const scene = createSelectedWorkScene(host.clientWidth, host.clientHeight);
      cleanups.push(scene.dispose);

      let compose: ReturnType<typeof createHeroCompose> | null = null;
      try {
        compose = createHeroCompose(host.clientWidth, host.clientHeight);
        cleanups.push(compose.dispose);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[SelectedWork] 合成管线创建失败，退化为直渲：', err);
      }

      // ---------- 输入 ----------
      const mouse = { x: 0, y: 0 };
      let dragPx = 0;
      let wheelAcc = 0;
      let wheelLockUntil = 0;
      let wheelResetTimer: number | null = null;
      let verticalAcc = 0;
      let dragging = false;
      let pending = false;
      let startX = 0;
      let startY = 0;
      let lastD = 0;

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        let dx = e.deltaX;
        let dy = e.deltaY;
        if (e.deltaMode === 1) {
          dx *= 16;
          dy *= 16;
        } else if (e.deltaMode === 2) {
          dx *= host.clientWidth;
          dy *= host.clientHeight;
        }

        if (Math.abs(dx) > Math.abs(dy)) {
          verticalAcc = 0;
          if (dragging || pending) return;
          const now = performance.now();
          if (now < wheelLockUntil) return;
          if (wheelResetTimer !== null) window.clearTimeout(wheelResetTimer);
          wheelResetTimer = window.setTimeout(() => {
            wheelAcc = 0;
          }, 150);
          wheelAcc -= dx;
          const threshold = WHEEL_STEP_RATIO * host.clientWidth;
          if (Math.abs(wheelAcc) > threshold) {
            // 原件 `x.set(x.get() + -Math.sign(acc))`：向右滚（deltaX>0）前进一帧
            step(-Math.sign(wheelAcc));
            wheelAcc = 0;
            wheelLockUntil = now + WHEEL_LOCK_MS;
          }
          return;
        }

        // 纵向：累计一段距离后进入 About Us（与提示文案同一入口）
        if (dy > 0) {
          verticalAcc += dy;
          if (verticalAcc > SCROLL_ABOUT_RATIO * window.innerHeight) {
            verticalAcc = 0;
            go('#about');
          }
        } else {
          verticalAcc = 0;
        }
      };

      const onMouseMove = (e: MouseEvent) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = 1 - (e.clientY / window.innerHeight) * 2;
      };

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement | null)?.closest('[data-sw-ui]')) return;
        verticalAcc = 0;
        pending = true;
        dragging = false;
        startX = e.clientX;
        startY = e.clientY;
        lastD = 0;
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!pending) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
          if (Math.abs(dx) + Math.abs(dy) <= 10) return;
          if (Math.abs(dx) <= Math.abs(dy)) {
            pending = false;
            return;
          }
          dragging = true;
          document.body.style.cursor = 'grabbing';
        }
        const limit = DRAG_CLAMP_RATIO * window.innerWidth;
        lastD = Math.max(-limit, Math.min(limit, dx));
        dragPx = lastD;
      };

      const endDrag = () => {
        pending = false;
        document.body.style.cursor = '';
        if (!dragging) {
          dragPx = 0;
          return;
        }
        dragging = false;
        dragPx = 0;
        if (Math.abs(lastD) > DRAG_SNAP_RATIO * window.innerWidth) {
          step(lastD > 0 ? -1 : 1);
        }
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'ArrowRight') step(1);
      };

      const onResize = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        renderer.setSize(w, h);
        scene.setSize(w, h);
        compose?.setSize(w, h);
      };

      window.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('resize', onResize);
      cleanups.push(() => {
        window.removeEventListener('wheel', onWheel);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', endDrag);
        window.removeEventListener('pointercancel', endDrag);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', onResize);
        document.body.style.cursor = '';
        if (wheelResetTimer !== null) window.clearTimeout(wheelResetTimer);
      });

      // 调试钩子：自动化验证读取选中序号 / 场景对象
      (window as unknown as { __selectedWorkProbe?: unknown }).__selectedWorkProbe = {
        renderer,
        scene,
        compose,
        selectedIndex: () => selectedRef.current,
        dragPx: () => dragPx,
      };

      // ---------- 主循环 ----------
      const clock = new THREE.Clock();
      const render = async () => {
        if (disposed) return;
        try {
          const dt = Math.min(clock.getDelta(), 0.05);
          const time = clock.elapsedTime;
          scene.update(dt, time, {
            mouseX: mouse.x,
            mouseY: mouse.y,
            selectedIndex: selectedRef.current,
            dragPx,
          });
          if (compose) {
            await compose.render(renderer, scene.scene, scene.camera, {
              time,
              dt,
              portrait: window.innerHeight > window.innerWidth,
              loadingActive: false,
              loadingMix: 0,
              pageScroll: HERO_TIMELINE.total,
            });
          } else {
            renderer.setRenderTarget(null);
            await (renderer as any).renderAsync(scene.scene, scene.camera);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[SelectedWork] 渲染循环抛错：', err);
        }
        raf = requestAnimationFrame(() => {
          void render();
        });
      };
      raf = requestAnimationFrame(() => {
        void render();
      });
    })().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[SelectedWork] 初始化失败：', err);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      apiRef.current = null;
      const probe = (window as unknown as { __selectedWorkProbe?: { renderer?: any } }).__selectedWorkProbe;
      probe?.renderer?.dispose?.();
      delete (window as unknown as { __selectedWorkProbe?: unknown }).__selectedWorkProbe;
      for (const fn of cleanups) fn();
      const canvas = host.querySelector('canvas');
      if (canvas) canvas.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: '#101225',
        touchAction: 'none',
      }}
    >
      <SelectedWorkUI
        onPrev={() => apiRef.current?.prev()}
        onNext={() => apiRef.current?.next()}
        onScrollHint={() => apiRef.current?.about()}
      />
    </div>
  );
}
