/**
 * WorkDetailBootOverlay - /work/<slug> 详情页的 BIOS boot 屏
 *
 * 复用首页 boot 的**同一套视觉与状态机**（实证：原站详情页硬导航每次都重播
 * 同款 BIOS boot）：
 *  - 视觉：bootShader.ts 的 BOOT_COMMON_GLSL（纯 GLSL 程序化 BIOS 蓝 + 条纹球 +
 *    5×7 文字 + 21 段进度条 + 终端日志），挂在独立 WebGLRenderer 全屏三角形上
 *    （BootPassShader 带 tDiffuse 混合，这里直接输出 bootContent）。
 *  - 状态机：bootStore 单例（clearBootAssets → resetBoot → 登记视频资产 →
 *    warmup → countdown → reveal 弹簧）。弹簧值驱动 overlay CSS opacity 淡出。
 *
 * 资产：详情页的视频（主 + media 去重）作为 boot 进度源，隐藏 <video preload=auto>
 * 预载，canplaythrough → markDone；单视频失败不阻塞（降级 markDone + warn）。
 *
 * 星星转场（原站 boot 后的金星揭示）：starArray 依赖 three/webgpu 不能进本页，
 * TODO(未取证)：校准阶段 burst 原站入场序列后决定是否 DOM/2D 复刻。
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  BOOT_COMMON_GLSL,
  bootLineMetaUniform,
  getBootTextures,
} from '../boot/bootShader';
import {
  bootStore,
  clearBootAssets,
  markBootAudioOn,
  markBootWarmupDone,
  registerBootAsset,
  resetBoot,
  tickBoot,
} from '../boot/bootStore';
import type { WorkProject } from './data';

interface BootOverlayProps {
  project: WorkProject;
  /** 弹簧收敛、overlay 完全退场后通知父级（解锁滚动等） */
  onDone: () => void;
}

export default function WorkDetailBootOverlay({ project, onDone }: BootOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opacity, setOpacity] = useState(1);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // === boot 状态机：独立页复用单例的正规姿势（见 clearBootAssets 注释） ===
    clearBootAssets();
    resetBoot();

    // === 进度源：缩略图预载（视频由体验内 hls.js 懒加载，见 workDetailExperience） ===
    const ids = [...new Set([project.muxPlaybackId, ...project.projectMedia])];
    const handles = ids.map((id) => registerBootAsset(id, 1 / ids.length));
    ids.forEach((id, i) => {
      const img = new Image();
      img.src = `/work-media/${project.uid}/${id}-thumb.webp`;
      img
        .decode()
        .then(() => { console.error('[wd-boot] thumb done', id.slice(0, 8)); handles[i].markDone(); })
        .catch(() => {
          console.error('[wd-boot] thumb FAILED', id.slice(0, 8));
          handles[i].markDone();
        });
    });

    // === 独立 WebGL：全屏三角形跑 bootContent ===
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    renderer.setPixelRatio(1);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const t = getBootTextures();
    const uniforms = {
      uProgress: { value: 0 },
      uResolution: { value: new THREE.Vector2(canvas.width, canvas.height) },
      uBootTime: { value: 0 },
      uBootFont: { value: t.uBootFont.value },
      uBootTest: { value: t.uBootTest.value },
      uBootTextSize: { value: t.uBootTextSize.value.clone() },
      uBootGlyphCount: { value: t.uBootGlyphCount.value },
      uBootDigitBase: { value: t.uBootDigitBase.value },
      uBootGlyphO: { value: t.uBootGlyphO.value },
      uBootGlyphK: { value: t.uBootGlyphK.value },
      uLineMeta: { value: bootLineMetaUniform() },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uProgress;
        uniform vec2 uResolution;
        uniform float uBootTime;
        uniform sampler2D uBootFont;
        uniform sampler2D uBootTest;
        uniform vec2 uBootTextSize;
        uniform float uBootGlyphCount;
        uniform float uBootDigitBase;
        uniform float uBootGlyphO;
        uniform float uBootGlyphK;
        uniform vec4 uLineMeta[8];
        varying vec2 vUv;
        ${BOOT_COMMON_GLSL}
        void main() {
          gl_FragColor = vec4(bootContent(vUv, uResolution, uProgress), 1.0);
        }
      `,
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    };
    resize();
    window.addEventListener('resize', resize);

    // boot 期间任意点击 = BGM 引导（与首页同款交互）
    const onPointer = () => markBootAudioOn();
    window.addEventListener('pointerdown', onPointer);

    // === 帧循环：tickBoot 驱动状态机，warmup 帧 ~0.5s ===
    let raf = 0;
    let last = performance.now();
    let warmupFrames = 0;
    let doneNotified = false;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tickBoot(dt);
      if ((tick as any).__phase !== bootStore.phase) {
        (tick as any).__phase = bootStore.phase;
        console.error('[wd-boot] phase →', bootStore.phase, 'progress=', Math.round(bootStore.displayProgress));
      }
      if (bootStore.phase === 'warmup') {
        warmupFrames++;
        if (warmupFrames > 30) markBootWarmupDone();
      }
      uniforms.uProgress.value = bootStore.displayProgress;
      uniforms.uBootTime.value += dt;
      if (bootStore.phase === 'reveal' || bootStore.phase === 'done') {
        setOpacity(Math.max(0, 1 - bootStore.spring));
      }
      if (bootStore.phase === 'done' && !doneNotified) {
        doneNotified = true;
        setGone(true);
        onDone();
      }
      renderer.render(scene, camera);
      if (!doneNotified) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointerdown', onPointer);
      material.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.uid]);

  if (gone) return null;
  return (
    <div
      className="wd-boot"
      style={{ opacity }}
      aria-hidden
    >
      <canvas ref={canvasRef} className="wd-boot-canvas" />
    </div>
  );
}
