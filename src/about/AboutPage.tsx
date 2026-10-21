/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { createAboutOfficeScene } from './officeScene';
import { createHeroCompose } from '../hero/heroCompose';
import { HERO_TIMELINE } from '../hero/heroConfig';

/**
 * About Us 页（#about-us）
 *
 * 第一阶段：办公室 3D 场景 + 合成链（与原件 office 段同源的运动：
 * 相机随 office 段滚动进度推入）。长页 DOM、导航切色与连续转场在后续步骤接入。
 */
export default function AboutPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const cleanups: Array<() => void> = [];
    const host = hostRef.current;
    if (!host) return;
    const mouse = { x: 0, y: 0 };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      scrollRef.current = Math.max(0, Math.min(1, scrollRef.current + e.deltaY / (window.innerHeight * 4)));
    };
    const onMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = 1 - (e.clientY / window.innerHeight) * 2;
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onMouseMove);

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

      const office = createAboutOfficeScene(host.clientWidth, host.clientHeight);
      cleanups.push(office.dispose);

      let compose: ReturnType<typeof createHeroCompose> | null = null;
      try {
        compose = createHeroCompose(host.clientWidth, host.clientHeight);
        cleanups.push(compose.dispose);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[About] 合成管线创建失败，退化为直渲：', err);
      }

      const onResize = () => {
        renderer.setSize(host.clientWidth, host.clientHeight);
        office.setSize(host.clientWidth, host.clientHeight);
        compose?.setSize(host.clientWidth, host.clientHeight);
      };
      window.addEventListener('resize', onResize);
      cleanups.push(() => window.removeEventListener('resize', onResize));
      cleanups.push(() => {
        window.removeEventListener('wheel', onWheel);
        window.removeEventListener('mousemove', onMouseMove);
      });

      (window as unknown as { __aboutProbe?: unknown }).__aboutProbe = {
        renderer,
        office,
        compose,
        scroll: () => scrollRef.current,
      };

      const clock = new THREE.Clock();
      const render = async () => {
        if (disposed) return;
        try {
          const dt = Math.min(clock.getDelta(), 0.05);
          const time = clock.elapsedTime;
          office.update(dt, time, {
            scrollProgress: scrollRef.current,
            mouseX: mouse.x,
            mouseY: mouse.y,
            touch: 'ontouchstart' in window,
          });
          if (compose) {
            await compose.render(renderer, office.scene, office.camera, {
              time,
              dt,
              portrait: window.innerHeight > window.innerWidth,
              loadingActive: false,
              loadingMix: 0,
              pageScroll: HERO_TIMELINE.total,
            });
          } else {
            renderer.setRenderTarget(null);
            await (renderer as any).renderAsync(office.scene, office.camera);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[About] 渲染循环抛错：', err);
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
      console.error('[About] 初始化失败：', err);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      const probe = (window as unknown as { __aboutProbe?: { renderer?: any } }).__aboutProbe;
      probe?.renderer?.dispose?.();
      delete (window as unknown as { __aboutProbe?: unknown }).__aboutProbe;
      for (const fn of cleanups) fn();
      const canvas = host.querySelector('canvas');
      if (canvas) canvas.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#0b0b0b', touchAction: 'none' }}
    />
  );
}
