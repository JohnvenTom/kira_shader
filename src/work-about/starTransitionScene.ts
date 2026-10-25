/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import { createCxStarArray } from './starArray';

/**
 * P2 跨段导航转场 —— 星星阵列场景（原站 TransitionScene：pb 相机壳 + cx 星星阵列）。
 *
 * 几何/材质/内芯/灯光/运动公式全部来自 starArray.ts 共享工厂（cx 组件 1:1，
 * 与 goldenTieRevealScene 同一份实现）。本文件只负责转场上下文：
 *
 *   pb（60547）：相机 fov50 [0,0,5] near .1 far 100；场景外层 group [0,8,0] 包 cx
 *               （lightsIntensity 1、disableSmoke）；原站每帧渲进独立 fbo。
 *               **转场上下文无背景板**（蓝渐变属于页内段）；WebGPU backend 的
 *               renderAsync-to-RT 在 SwiftShader 下不画内容（2026-10-25 实证），
 *               故走画布 overlay 直渲（autoClear=false 叠在 compose 输出上）。
 *   领头星内芯：cb 只给 3D[0] 喂满进度+真实 nextSceneTexture；宿主须先强渲
 *               目标页 RT（采样未渲染 RT → pipeline invalid 整帧弃），并把
 *               RT 像素尺寸作为 resolution 传入。
 */

export interface StarTransitionHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(opts: {
    progress: number;
    nextSceneTexture: THREE.Texture | null;
    cssW: number;
    /** 内芯采样分辨率 = 目标页 RT 的像素尺寸（screenCoordinate 除数） */
    resW?: number;
    resH?: number;
  }): void;
  /** overlay=true：直渲画布（autoClear=false 保留 compose 已画内容） */
  render(renderer: THREE.WebGPURenderer, overlay?: boolean): Promise<void>;
  setSize(w: number, h: number): void;
  dispose(): void;
}

export function createStarTransitionScene(renderer: THREE.WebGPURenderer): StarTransitionHandle {
  const scene = new THREE.Scene();
  // pb：fov50 [0,0,5]（cx 的壳体在场景内运动，相机不动）
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);

  // pb 外层 group [0,8,0] 包 cx（与 cx 内 lift y=−8 相抵）
  const outer = new THREE.Group();
  outer.position.set(0, 8, 0);
  scene.add(outer);

  const starArray = createCxStarArray(renderer, scene);
  outer.add(starArray.lift);

  return {
    scene,
    camera,
    update(opts) {
      starArray.update(opts.progress, opts.cssW, opts.nextSceneTexture, opts.resW, opts.resH);
    },
    async render(renderer2: THREE.WebGPURenderer, overlay = false): Promise<void> {
      if (!overlay) {
        // RT 路径保留给 WebGL backend / 未来修正（WebGPU+SwiftShader 下 RT 不出内容）
        renderer2.setClearColor(new THREE.Color(0, 0, 0), 0);
        renderer2.setRenderTarget(null);
        await (renderer2 as any).renderAsync(scene, camera);
        renderer2.setRenderTarget(null);
        return;
      }
      // 画布 overlay：autoClear=false 保留 compose 已画内容，星星叠加其上
      const prevClear = renderer2.autoClear;
      renderer2.autoClear = false;
      renderer2.setClearColor(new THREE.Color(0, 0, 0), 0);
      renderer2.setRenderTarget(null);
      await (renderer2 as any).renderAsync(scene, camera);
      renderer2.autoClear = prevClear;
      renderer2.setClearColor(new THREE.Color(0, 0, 0), 1);
    },
    setSize(w, h) {
      camera.aspect = Math.max(1, w) / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    dispose() {
      starArray.dispose();
    },
  };
}
