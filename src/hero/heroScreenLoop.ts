/**
 * hero 屏幕的「循环片」—— 程序化生成，主从同源
 *
 * 背景：原件的屏幕内容是一条 Mux 视频流，另有一条「从属视频」逐帧对时（差 > 0.15s 就
 *      `currentTime` 对齐），专门驱动屏幕的光溢出与投射灯 gobo。
 *      本机既无 ffmpeg 也无本地视频资产，因此改为**自制程序化循环**：
 *      同一动画状态同时派生两条纹理 —— 内容纹理（给屏幕）与光纹理（给 gobo / 光溢出），
 *      机制上与「主 + 从属」一致，只是内容不再来自视频文件。
 *      后续若要换成真视频：把 contentTexture / lightTexture 换成 VideoTexture 即可，
 *      下游（屏幕材质、投射灯 map、背景光溢出）无需改动。
 *
 * 动画设计（6 秒无缝循环，所有运动取整周期，保证首尾帧接得上）：
 *  - 深底 + 三条横向漂移的能量带
 *  - 一条正弦波形（模拟信号/音频可视化）
 *  - 细密扫描线
 *  - 偶发水平故障块（按循环时间分档出现，不是每帧随机，避免闪烁感）
 *  - 上下极窄黑边（letterbox，让画面读起来像「在显示器里放片」）
 */
import * as THREE from 'three/webgpu';

/** 内容纹理宽度（宽高比 4:3，与原件 `reelTextureAspect 1026×770 ≈ 1.332` 接近） */
const CONTENT_W = 768;
/** 内容纹理高度 */
const CONTENT_H = 576;
/** 光纹理尺寸（作为 gobo / 光溢出源，低分辨率足够且省上传带宽） */
const LIGHT_W = 128;
const LIGHT_H = 96;
/** 循环周期（秒） */
const LOOP_SECONDS = 6;

/** 循环片句柄 */
export interface HeroScreenLoop {
  /** 屏幕内容纹理（给屏幕材质采样） */
  contentTexture: THREE.Texture;
  /** 光纹理（给投射灯 map 与背景光溢出采样） */
  lightTexture: THREE.Texture;
  /** 每帧重绘两张画布（t 为秒） */
  update: (t: number) => void;
  /** 释放两张 canvas 纹理 */
  dispose: () => void;
}

/**
 * 创建屏幕循环片（程序化，主从同源）
 *
 * 功能：建两张 canvas 与对应的 CanvasTexture；内容画布画彩色能量带 + 波形 + 扫描线 +
 *      故障块，光画布画同一状态的压缩提亮版本。返回 update(t) 供每帧重绘。
 *
 * 参数：无（尺寸与周期为模块常量）
 *
 * 返回值：HeroScreenLoop
 *
 * 异常：浏览器不支持 2D canvas 上下文时抛 Error（正常环境不会）
 *
 * 注意事项：
 *  - 两张纹理都设为 SRGBColorSpace / LinearFilter / 不生成 mipmap，与原件 VideoTexture 的设置一致
 *  - 内容与光从同一个 phase 派生，因此始终同步 —— 这就是「主从同源」
 *  - 每帧重绘并上传两张纹理，与原件的双视频解码同量级；内容尺寸刻意控制在 768×576
 */
export function createHeroScreenLoop(): HeroScreenLoop {
  const contentCanvas = document.createElement('canvas');
  contentCanvas.width = CONTENT_W;
  contentCanvas.height = CONTENT_H;
  const contentCtx = contentCanvas.getContext('2d', { willReadFrequently: true });
  if (!contentCtx) throw new Error('无法获取 2D canvas 上下文');

  const lightCanvas = document.createElement('canvas');
  lightCanvas.width = LIGHT_W;
  lightCanvas.height = LIGHT_H;
  const lightCtx = lightCanvas.getContext('2d');
  if (!lightCtx) throw new Error('无法获取 2D canvas 上下文');

  const contentTexture = new THREE.Texture(contentCanvas);
  contentTexture.colorSpace = THREE.SRGBColorSpace;
  contentTexture.minFilter = THREE.LinearFilter;
  contentTexture.magFilter = THREE.LinearFilter;
  contentTexture.generateMipmaps = false;

  const lightTexture = new THREE.Texture(lightCanvas);
  lightTexture.colorSpace = THREE.SRGBColorSpace;
  lightTexture.minFilter = THREE.LinearFilter;
  lightTexture.magFilter = THREE.LinearFilter;
  lightTexture.generateMipmaps = false;

  /**
   * 每帧重绘
   *
   * 功能：按循环时间重绘内容与光两张画布，并标记纹理需要更新
   *
   * 参数：
   *  - t {number} 当前时间（秒）；内部按 LOOP_SECONDS 取模以保证无缝回环
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：内容与光都从同一个 phase 派生，二者永远同步
   */
  const update = (t: number) => {
    const loop = ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
    const phase = loop / LOOP_SECONDS;
    drawContent(contentCtx, CONTENT_W, CONTENT_H, phase);
    drawLightFrom(contentCtx, lightCtx, CONTENT_W, CONTENT_H, LIGHT_W, LIGHT_H);
    contentTexture.needsUpdate = true;
    lightTexture.needsUpdate = true;
  };

  /** 释放两张 canvas 纹理 */
  const dispose = () => {
    contentTexture.dispose();
    lightTexture.dispose();
  };

  return { contentTexture, lightTexture, update, dispose };
}

/**
 * 绘制内容帧
 *
 * 功能：在内容画布上画出一帧「像信号画面」的内容
 *
 * 参数：
 *  - ctx {CanvasRenderingContext2D} 内容画布上下文
 *  - w / h {number} 画布尺寸
 *  - phase {number} 归一化循环相位 0~1
 *
 * 返回值：无
 *
 * 异常：无
 *
 * 注意事项：所有运动都以 phase 的整周期正弦表达，保证 phase=0 与 phase=1 完全一致
 */
function drawContent(ctx: CanvasRenderingContext2D, w: number, h: number, phase: number): void {
  const TAU = Math.PI * 2;

  // 1. 深底（略偏冷，与场景暗部同调）
  ctx.fillStyle = '#06070a';
  ctx.fillRect(0, 0, w, h);

  // 2. 三条横向漂移的能量带
  const bands = [
    { y: 0.3, amp: 0.05, color: 'rgba(255,120,60,0.55)', speed: 1 },
    { y: 0.52, amp: 0.07, color: 'rgba(80,190,255,0.5)', speed: 2 },
    { y: 0.72, amp: 0.04, color: 'rgba(120,255,170,0.42)', speed: 3 },
  ];
  for (const b of bands) {
    const y = b.y * h + Math.sin(phase * TAU * b.speed) * b.amp * h;
    const grad = ctx.createLinearGradient(0, y - h * 0.05, 0, y + h * 0.05);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, b.color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - h * 0.05, w, h * 0.1);
  }

  // 3. 正弦波形（信号可视化），两端收窄
  ctx.strokeStyle = 'rgba(235,245,255,0.85)';
  ctx.lineWidth = Math.max(1, h / 220);
  ctx.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const nx = x / w;
    const env = Math.sin(nx * Math.PI);
    const y =
      h * 0.5 +
      Math.sin(nx * TAU * 3 + phase * TAU) * h * 0.09 * env +
      Math.sin(nx * TAU * 11 + phase * TAU * 2) * h * 0.025 * env;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 4. 细密扫描线
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

  // 5. 偶发水平故障块：按相位分档（不逐帧随机，避免噪闪）
  const glitchPhase = Math.floor(phase * LOOP_SECONDS) % 6;
  if (glitchPhase === 2 || glitchPhase === 5) {
    const rnd = (seed: number) => Math.abs((Math.sin(seed * 12.9898) * 43758.5453) % 1);
    for (let i = 0; i < 3; i++) {
      const seed = glitchPhase * 10 + i;
      const gy = Math.floor(rnd(seed) * (h - 12));
      const gh = 2 + Math.floor(rnd(seed + 1) * 8);
      const dx = Math.floor((rnd(seed + 2) - 0.5) * w * 0.06);
      const seg = ctx.getImageData(0, gy, w, gh);
      ctx.putImageData(seg, dx, gy);
    }
  }

  // 6. 上下窄黑边
  ctx.fillStyle = '#000';
  const bar = Math.round(h * 0.02);
  ctx.fillRect(0, 0, w, bar);
  ctx.fillRect(0, h - bar, w, bar);
}

/**
 * 从内容画布派生光纹理
 *
 * 功能：把内容画布压缩重绘到光画布，并做模糊 + 提亮 + 提饱和，
 *      得到「屏幕发出的光」这一路信号（原件里由从属视频承担）
 *
 * 参数：
 *  - srcCtx {CanvasRenderingContext2D} 内容画布上下文
 *  - dstCtx {CanvasRenderingContext2D} 光画布上下文
 *  - sw / sh {number} 源尺寸
 *  - dw / dh {number} 目标尺寸
 *
 * 返回值：无
 *
 * 异常：无
 *
 * 注意事项：与内容同一帧派生（主从同源）；两次叠加绘制（第二次用 lighter）模拟屏幕光的过曝核心
 */
function drawLightFrom(
  srcCtx: CanvasRenderingContext2D,
  dstCtx: CanvasRenderingContext2D,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): void {
  dstCtx.setTransform(1, 0, 0, 1, 0, 0);
  dstCtx.globalCompositeOperation = 'source-over';
  dstCtx.filter = 'blur(2px) saturate(160%) brightness(1.5)';
  dstCtx.clearRect(0, 0, dw, dh);
  dstCtx.drawImage(srcCtx.canvas, 0, 0, sw, sh, 0, 0, dw, dh);
  dstCtx.globalCompositeOperation = 'lighter';
  dstCtx.filter = 'blur(4px) saturate(180%) brightness(1.2)';
  dstCtx.drawImage(srcCtx.canvas, 0, 0, sw, sh, 0, 0, dw, dh);
  dstCtx.filter = 'none';
  dstCtx.globalCompositeOperation = 'source-over';
}
