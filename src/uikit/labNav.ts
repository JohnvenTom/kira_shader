/**
 * navbar 专用实验室 —— NavBarKit 组件树单独渲染目检。
 * 打开 /uikitlab-nav.html?w=1600&h=900&dark=1 截图目检。
 * 调试句柄挂在 window.__navlab（root/uikit/regions 导出函数）。
 */
import * as THREE from 'three/webgpu';
import { UIKitRenderer } from './renderer.ts';
import { buildNavBar, loadNavBarFonts, type NavBarKit } from './navBar.ts';

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const W = +(q.get('w') ?? 1600);
  const H = +(q.get('h') ?? 900);
  const dark = q.get('dark') === '1';

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  await renderer.init();
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(dark ? '#e8e4da' : '#171310');
  const camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 100);
  camera.position.set(0, 0, 10);

  const fonts = await loadNavBarFonts();
  let kit: NavBarKit | null = null;
  const uikit = new UIKitRenderer({ pixelSize: 1, color: dark ? '#171310' : '#FDFDF5' });

  const build = () => {
    kit = buildNavBar(fonts, W, H, dark);
    kit.tick(
      {
        menuT: +(q.get('menu') ?? 0),
        activeNav: (q.get('active') ?? '') as never,
        logoHover: +(q.get('logoHover') ?? 0),
        actionHover: +(q.get('actionHover') ?? 0),
        dark,
      },
      0.016,
    );
    kit.root.applyViewport(W);
    uikit.mount(kit.root);
    kit.relayout(W);
    uikit.update();
  };
  build();
  scene.add(uikit.rootObject);

  function frame(): void {
    uikit.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();
  (window as any).__navlab = { get kit() { return kit; }, root: kit!.root, uikit, renderer, W, H };
}

main().catch((e) => {
  document.title = `NAVLAB ERROR: ${e}`;
  console.error(e);
});
