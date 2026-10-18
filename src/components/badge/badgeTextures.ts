/**
 * 程序化贴图工厂（对齐站点 ei / ti / ft 三段实现）
 *
 * 站点没有任何位图素材做凹凸/磨损——全部是运行时用 2D canvas 画出来的：
 *  - 塑料 / 织物凹凸贴图（256²，固定种子 LCG 保证每次生成一致）
 *  - 磨损贴花（1024×1536：950 个尘埃椭圆 + 28 道发丝划痕，留透明底当叠加层）
 *  - 印刷画面（PNG → 求 alpha 包围盒 → 裁边 → 白底 → 按 cover 语义适配卡面比例）
 *
 * 注意事项：
 *  - 所有随机数都用 LCG（`s = s*1664525 + 1013904223 >>> 0`）而不是 Math.random，
 *    这样刷新页面得到的颗粒/划痕完全一样，观感稳定、也便于比对
 *  - 站点在 `ei` 里把 wrapS/wrapT 误写成了外层 canvas 变量（minify 后遗留的 bug），
 *    这里恢复为本意的 RepeatWrapping（否则织物的 4×30 重复实际上不生效）
 */

import * as THREE from 'three';

/** 贴合卡面的平面宽高（与卡面 PlaneGeometry 一致，用于 cover 裁切比例） */
export const ARTWORK_PLANE_WIDTH = 2.39;
/** 贴合卡面的平面高（与卡面 PlaneGeometry 一致） */
export const ARTWORK_PLANE_HEIGHT = 3.505;

/**
 * 创建线性同余伪随机数生成器
 *
 * 功能：复刻站点的 LCG（乘 1664525 加 1013904223，取无符号 32 位后归一化）。
 *
 * 参数：
 *  - seed {number} 初始种子（站点塑料用 23、磨损用 617）
 *
 * 返回值：{() => number} 每次调用返回 [0, 1) 的伪随机数
 * 异常：无
 *
 * 注意事项：返回值是闭包的，同一实例可重复取数
 */
function createLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 创建塑料 / 织物凹凸贴图
 *
 * 功能：256×256 灰度噪声贴图：
 *  - plastic：均匀噪声（180 + rand*50）+ 45 道随机方向发丝刮痕
 *  - fabric ：沿 X/Y 的正弦棋盘编织纹（110 + 50*sin*sin + rand*25）
 *  织物贴图带 repeat 4×30（织带 UV 是 0~1，需要靠重复铺满整条带子）
 *
 * 参数：
 *  - kind {'plastic' | 'fabric'} 贴图种类
 *
 * 返回值：{THREE.CanvasTexture} 可直接作为 bumpMap 使用
 * 异常：若浏览器不支持 2D canvas 上下文会抛出 TypeError
 *
 * 注意事项：
 *  - 贴图不设 colorSpace（作为 bumpMap 时是数据贴图，保持线性即可）
 *  - 塑料贴图被金属件与 PBR 印刷面共用（bumpScale 略有不同）
 */
export function createNoiseBumpTexture(kind: 'plastic' | 'fabric'): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new TypeError('badge: 无法获取 2D canvas 上下文（凹凸贴图）');

  const image = ctx.createImageData(size, size);
  const rand = createLcg(23);
  for (let p = 0; p < image.data.length; p += 4) {
    const x = (p / 4) % size;
    const y = Math.floor(p / 1024);
    const value =
      kind === 'fabric'
        ? 110 +
          50 * Math.sin(x * (Math.PI / 2)) * Math.sin(y * (Math.PI / 2)) +
          rand() * 25
        : 180 + rand() * 50;
    image.data[p] = value;
    image.data[p + 1] = value;
    image.data[p + 2] = value;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  if (kind === 'plastic') {
    ctx.strokeStyle = 'rgba(80,80,80,.14)';
    ctx.lineWidth = 0.4;
    for (let i = 0; i < 45; i++) {
      const x = rand() * size;
      const y = rand() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rand() * 40, y + rand() * 5);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'fabric' ? 4 : 1, kind === 'fabric' ? 30 : 1);
  return texture;
}

/**
 * 创建磨损 / 灰尘贴花贴图
 *
 * 功能：1024×1536 透明底贴图，模拟卡套用久了之后的脏迹：
 *  - 950 个随机椭圆尘埃点：靠近边缘（离边 60px 内）或落在印刷头带（y 165~244）时保留，
 *    中间大片区域只保留 9% 的点 → 视觉上"边角积灰、中间干净"
 *  - 28 道沿左右两侧的发丝划痕
 *
 * 参数：无
 * 返回值：{THREE.CanvasTexture} 作为透明叠加层（材质配 transparent + opacity 驱动）
 * 异常：若浏览器不支持 2D canvas 上下文会抛出 TypeError
 *
 * 注意事项：
 *  - colorSpace 取 SRGBColorSpace（站点这里用的是 `srgb` 常量），
 *    因为它是可见的"颜色叠加"而不只是数据
 *  - 不透明度由 material.wear 每帧驱动，贴图本身不参与调参
 */
export function createWearTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1536;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new TypeError('badge: 无法获取 2D canvas 上下文（磨损贴图）');
  const rand = createLcg(617);

  for (let i = 0; i < 950; i++) {
    const x = rand() * 1024;
    const y = rand() * 1536;
    const nearEdge = Math.min(x, 1024 - x, y, 1536 - y) <= 60;
    const inHeaderBand = y > 165 && y < 244;
    if (!nearEdge && !inHeaderBand && rand() > 0.09) continue;

    const radius = 0.3 + rand() * 2.1;
    ctx.fillStyle = `rgba(${rand() > 0.55 ? '70,66,53' : '255,255,246'},${0.12 + rand() * 0.38})`;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * (0.45 + rand()), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 28; i++) {
    const x = rand() > 0.5 ? 25 + rand() * 45 : 954 + rand() * 40;
    const y = 250 + rand() * 1220;
    ctx.strokeStyle = `rgba(240,242,230,${0.1 + rand() * 0.2})`;
    ctx.lineWidth = 0.35 + rand() * 0.55;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + rand() * 5, y + 12, x + rand() * 7, y + 15 + rand() * 38);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 生成自有工牌画面（替代站点里作者本人的 badge PNG）
 *
 * 功能：在 canvas 上画一张"打印卡面"：
 *  - 四周留透明边（这样后面的 alpha 包围盒裁边 + cover 适配步骤才有意义）
 *  - 白底印刷区
 *  - 双色叠排姓名（黑衬线 + 蓝色斜体，参考站点的 Sam / Cheng 错位叠排）
 *  - 底部 Currently / Previously 小字信息 + 三枚彩色标签胶囊
 *
 * 参数：
 *  - width  {number} 画布宽，默认 1024
 *  - height {number} 画布高，默认 1400（宽高比刻意比卡面 .682 宽一点，
 *                  以便走 cover 裁切逻辑）
 *
 * 返回值：{HTMLCanvasElement} 印刷画面（可交给 prepareArtworkTexture）
 * 异常：若浏览器不支持 2D canvas 上下文会抛出 TypeError
 *
 * 注意事项：
 *  - 用衬线字体族（Georgia / Times）保证不依赖任何自托管字体资源
 *  - 想换成自己的 PNG 时不必改这里，直接调 scene.setCard(url) 即可
 */
export function createKiraBadgeArtwork(width = 1024, height = 1400): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new TypeError('badge: 无法获取 2D canvas 上下文（工牌画面）');

  const margin = 26;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(margin, margin, width - margin * 2, height - margin * 2);

  const serif = 'Georgia, "Times New Roman", "Songti SC", serif';

  // 姓名：黑衬线 + 蓝色斜体，第二行右下错位（叠排）
  ctx.fillStyle = '#111111';
  ctx.font = `700 168px ${serif}`;
  ctx.fillText('Kira', 78, height * 0.5);
  ctx.fillStyle = '#1226e8';
  ctx.font = `italic 700 168px ${serif}`;
  ctx.fillText('Shader', 176, height * 0.5 + 132);

  // 底部信息区
  ctx.fillStyle = '#111111';
  ctx.font = `600 30px ${serif}`;
  ctx.fillText('Currently', 78, height - 300);
  ctx.font = `400 26px ${serif}`;
  ctx.fillStyle = '#3a3a3a';
  ctx.fillText('Building shader demos & 3D interactions', 78, height - 262);
  ctx.fillText('WebGL · GLSL · Real-time graphics', 78, height - 226);

  ctx.fillStyle = '#111111';
  ctx.font = `600 30px ${serif}`;
  ctx.fillText('Previously', 78, height - 160);

  // 标签胶囊
  const pills: Array<[string, string]> = [
    ['RENDER', '#12321f'],
    ['LAB', '#8c1f1f'],
    ['DEMO', '#3a1f7a'],
  ];
  let pillX = 78;
  const pillY = height - 124;
  for (const [label, color] of pills) {
    ctx.font = `700 22px ${serif}`;
    const textWidth = ctx.measureText(label).width;
    const pillW = textWidth + 34;
    ctx.fillStyle = color;
    const r = 14;
    ctx.beginPath();
    ctx.moveTo(pillX + r, pillY);
    ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + 40, r);
    ctx.arcTo(pillX + pillW, pillY + 40, pillX, pillY + 40, r);
    ctx.arcTo(pillX, pillY + 40, pillX, pillY, r);
    ctx.arcTo(pillX, pillY, pillX + pillW, pillY, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, pillX + 17, pillY + 27);
    pillX += pillW + 12;
  }

  return canvas;
}

/**
 * 读取画面源的像素宽度
 *
 * 功能：canvas 用 .width；HTMLImageElement 优先用 naturalWidth
 *      （站点直接用 .width 也是这个语义，但图片未指定 width 属性时更稳妥的写法是 naturalWidth）。
 *
 * 参数：
 *  - source {CanvasImageSource} 画面源
 *
 * 返回值：{number} 像素宽度
 * 异常：无
 */
function resolveImageWidth(source: CanvasImageSource): number {
  const image = source as HTMLImageElement;
  if (typeof image.naturalWidth === 'number' && image.naturalWidth > 0) return image.naturalWidth;
  return (source as HTMLCanvasElement).width;
}

/**
 * 读取画面源的像素高度
 *
 * 功能：同上，图片优先用 naturalHeight。
 *
 * 参数：
 *  - source {CanvasImageSource} 画面源
 *
 * 返回值：{number} 像素高度
 * 异常：无
 */
function resolveImageHeight(source: CanvasImageSource): number {
  const image = source as HTMLImageElement;
  if (typeof image.naturalHeight === 'number' && image.naturalHeight > 0) return image.naturalHeight;
  return (source as HTMLCanvasElement).height;
}

/**
 * 把任意画面源处理成卡面贴图（复刻站点 ft 的运行时处理）
 *
 * 功能：站点不是直接把 PNG 丢给材质，而是先做四件事：
 *  1. 画到离屏 canvas 并读像素，求 alpha>0 的最小包围盒（裁掉透明边）
 *  2. 重建一张"围盒尺寸"的 canvas，先铺白底再把裁下来的内容画上去
 *     （印刷面必须是白底，否则透明处会透出卡套）
 *  3. 按 cover 语义算 repeat/offset：源宽高比大于卡面宽高比就裁 x，否则裁 y，
 *     offset 取一半让内容居中
 *  4. 设 colorSpace 与各向异性，交给材质
 *
 * 参数：
 *  - source      {CanvasImageSource} 画面源（PNG 图片或 canvas）
 *  - colorSpace  {THREE.ColorSpace} 贴图色彩空间（无光照印刷面用 SRGBColorSpace）
 *  - anisotropy  {number} 各向异性过滤上限（取 renderer.capabilities.getMaxAnisotropy()）
 *
 * 返回值：{THREE.CanvasTexture} 已裁边 + 白底 + cover 适配好的卡面贴图
 * 异常：若无法取得 2D 上下文会抛出 TypeError
 *
 * 注意事项：
 *  - 全图逐像素扫描（1024×1400 ≈ 143 万像素）是同步的，只在初始化时跑一次；
 *    站点也把它放在 setCard 里，属于"一次性代价"
 *  - 若源图完全没有不透明像素，则退化为整图（与站点 `u<c && (...)` 的兜底一致）
 */
export function prepareArtworkTexture(
  source: CanvasImageSource,
  colorSpace: THREE.ColorSpace,
  anisotropy: number
): THREE.CanvasTexture {
  const sourceWidth = resolveImageWidth(source);
  const sourceHeight = resolveImageHeight(source);
  const srcW = sourceWidth;
  const srcH = sourceHeight;
  const probe = document.createElement('canvas');
  probe.width = srcW;
  probe.height = srcH;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  if (!probeCtx) throw new TypeError('badge: 无法获取 2D canvas 上下文（画面裁边）');
  probeCtx.drawImage(source, 0, 0);
  const pixels = probeCtx.getImageData(0, 0, srcW, srcH).data;

  let left = srcW;
  let top = srcH;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      if (pixels[(y * srcW + x) * 4 + 3] > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left) {
    left = 0;
    top = 0;
    right = srcW - 1;
    bottom = srcH - 1;
  }

  const cropW = right - left + 1;
  const cropH = bottom - top + 1;
  const trimmed = document.createElement('canvas');
  trimmed.width = cropW;
  trimmed.height = cropH;
  const trimmedCtx = trimmed.getContext('2d');
  if (!trimmedCtx) throw new TypeError('badge: 无法获取 2D canvas 上下文（画面白底）');
  trimmedCtx.fillStyle = '#ffffff';
  trimmedCtx.fillRect(0, 0, cropW, cropH);
  trimmedCtx.drawImage(source, left, top, cropW, cropH, 0, 0, cropW, cropH);

  const texture = new THREE.CanvasTexture(trimmed);
  const sourceAspect = cropW / cropH;
  const planeAspect = ARTWORK_PLANE_WIDTH / ARTWORK_PLANE_HEIGHT;
  if (sourceAspect > planeAspect) {
    texture.repeat.x = planeAspect / sourceAspect;
  } else {
    texture.repeat.y = sourceAspect / planeAspect;
  }
  texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
  texture.colorSpace = colorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}
