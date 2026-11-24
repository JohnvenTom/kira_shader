/**
 * 星星转场场景实验室 —— createStarTransitionScene / createGoldenTieRevealScene
 * （共用 starArray.ts cx 工厂）单独渲染目检。
 * 打开 /starlab.html?progress=0.35[&mode=reveal] 截图。window.__starlab 调试句柄。
 * （RT 路径实验已移除：WebGPU+SwiftShader 的 renderAsync-to-RT 不画内容已实证，
 *   星星走画布 overlay——见 starTransitionScene.ts 注释。）
 */
import * as THREE from 'three/webgpu';
import { createStarTransitionScene } from '../work-about/starTransitionScene';
import { createGoldenTieRevealScene } from '../work-about/goldenTieRevealScene';

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const W = +(q.get('w') ?? 900);
  const H = +(q.get('h') ?? 700);
  const progress = +(q.get('progress') ?? 0.35);
  const mode = q.get('mode') ?? 'transition';

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  await renderer.init();
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);

  const reveal =
    mode === 'reveal' ? createGoldenTieRevealScene(renderer, W, H) : null;
  const star = reveal ? null : createStarTransitionScene(renderer);
  star?.setSize(W, H);
  reveal?.setSize(W, H);

  function frame(): void {
    if (star) {
      star.update({ progress, nextSceneTexture: null, cssW: W });
      void star.render(renderer, true);
    } else if (reveal) {
      reveal.setSize(W, H);
      reveal.setNextTexture(null, W, H);
      reveal.update({ text: 0.6, cards: progress, time: 1, mouseX: 0, mouseY: 0 });
      renderer.setClearColor(new THREE.Color(0, 0, 0), 1);
      renderer.setRenderTarget(null);
      void (renderer as any).renderAsync(reveal.scene, reveal.camera);
    }
    requestAnimationFrame(frame);
  }
  void frame();
  (window as any).__starlab = { star, reveal, renderer, W, H, progress };
}

main().catch((e) => {
  document.title = `STARLAB ERROR: ${e?.stack ?? e}`;
  console.error(e);
});
