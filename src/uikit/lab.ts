/**
 * uikit 实验室页 —— M3 渲染层目检样张。
 * 内容：MSDF 大字号（Hello 200px medium）、正文 24px、黑底面板、圆角边框卡、
 *       overflow 裁剪、footer 图片。浏览器打开 /uikitlab.html 截图目检。
 */
import * as THREE from 'three/webgpu';
import { loadFont } from './font.ts';
import { UIElement } from './element.ts';
import { UIKitRenderer } from './renderer.ts';
import { createTextMeasurer } from './text.ts';

async function main(): Promise<void> {
  const W = 1440;
  const H = 900;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  await renderer.init();
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 100);
  camera.position.set(0, 0, 10);

  // 字体
  const [regular, medium, bold] = await Promise.all([
    loadFont('/fonts/stix_regular.json'),
    loadFont('/fonts/stix_medium.json'),
    loadFont('/fonts/stix_bold.json'),
  ]);

  // ---- 布局树 ----
  const root = UIElement.container({ flexDirection: 'column', width: W, height: H });

  // 大字号 MSDF（对照原站 Hello）
  const hello = UIElement.text('“Hello”', { font: medium, fontSize: 200, textAlign: 'center' });
  root.add(hello);

  // 黑底面板 + intro 正文
  const blackBox = UIElement.container({ backgroundColor: 'black', width: 620, flexDirection: 'column', alignItems: 'center', paddingY: 40 });
  const intro = UIElement.text(
    "Contact us about your digital project idea or general enquires. Let's interface, call us today!",
    { font: regular, fontSize: 24, textAlign: 'center', lineHeight: '120%' },
    { maxWidth: 480 },
  );
  blackBox.add(intro);
  const introWrap = UIElement.container({ flexDirection: 'column', alignItems: 'center' });
  introWrap.add(blackBox);
  root.add(introWrap);

  // 圆角边框卡（CEO 卡样式：border 2 white + radius 4 + dashed 贴图）
  const card = UIElement.container({
    backgroundColor: 'rgba(20, 20, 20, 1)',
    borderColor: '#f0f0f0',
    borderWidth: 2,
    borderRadius: 12,
    width: 640,
    height: 180,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    map: '/textures/dashed_frame.svg',
  });
  const simon = UIElement.image(200, 1, { width: 180, height: 180, marginLeft: 8, map: '/textures/simon_calling.webp' }, '/textures/simon_calling.webp');
  simon.style.height = 180;
  const cardTextCol = UIElement.container({ flexDirection: 'column' });
  cardTextCol.add(
    UIElement.text('New business', { font: bold, fontSize: 32 }),
    UIElement.text('Reach out today to our CEO for new business enquiries at ceo@shader.se', { font: regular, fontSize: 24, lineHeight: '120%' }),
  );
  card.add(simon, cardTextCol);
  const cardWrap = UIElement.container({ flexDirection: 'column', alignItems: 'center' });
  cardWrap.add(card);
  root.add(cardWrap);

  // overflow 裁剪演示：窄矮容器 + 两行长文本（第二行应完全被裁掉）
  const clipBox = UIElement.container({ overflow: 'hidden', width: 300, height: 26, backgroundColor: 'rgba(180, 40, 40, 0.4)' });
  clipBox.add(UIElement.text('CLIPPED TEXT OVERFLOWS HERE 0123456789', { font: bold, fontSize: 24 }));
  const clipWrap = UIElement.container({ flexDirection: 'column', alignItems: 'center' });
  clipWrap.add(clipBox);
  root.add(clipWrap);

  // footer 图片组
  const footer = UIElement.container({ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 48, backgroundColor: 'black', paddingY: 24 });
  footer.add(
    UIElement.image(160, 285 / 429, { map: '/textures/footer_certificate.png' }, '/textures/footer_certificate.png'),
    UIElement.image(256, 288 / 1032, { map: '/textures/copyright_footer.png' }, '/textures/copyright_footer.png'),
    UIElement.image(160, 156 / 406, { map: '/textures/a11y.png' }, '/textures/a11y.png'),
  );
  root.add(footer);

  // ---- 测量 + 渲染镜像 ----
  root.applyViewport(W);
  // 树里混入了带 measurer 的节点：根无 measure，直接布局
  root.calculateLayout(W, H);

  const uikit = new UIKitRenderer({ pixelSize: 1, color: '#f0f0f0' });
  uikit.mount(root);
  uikit.update();
  scene.add(uikit.rootObject);

  function frame(): void {
    uikit.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();
  // 调试句柄（CDP eval 用）
  (window as any).__lab = { root, uikit, renderer, scene, camera, W, H };
  void createTextMeasurer; // 保留引用（供调试）
}

main().catch((e) => {
  document.title = `LAB ERROR: ${e}`;
  console.error(e);
});
