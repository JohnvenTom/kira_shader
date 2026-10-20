/**
 * hero 屏幕的「循环片」—— 原件真实影片（已本地化）+ 逐帧派生光纹理
 *
 * 背景：原件屏幕内容是一条 Mux HLS 流（`pm`），另有一条从属视频 `pE` 专门驱动屏幕光溢出
 *      与投射灯 gobo。本页已把原件那条主片（640×480 / 12.94s / fMP4）本地化为
 *      `/asset/hero/showreel_loop.mp4` —— 屏幕内容就是原件那条片本身。
 *
 * 为什么必须换掉此前的程序化版本：旧版是自制「信号画面」（能量带 + 波形 + 扫描线 +
 *      按秒分档的水平故障切片），那些故障切片会以每秒一次的节奏闪现，观感上与原件
 *      （一条连续播放的影片）完全不符 —— 实测唯一的强闪烁源就在屏幕区域。
 *
 * 光纹理：原件由从属视频承担；本页没有第二条视频，改为**从同一条影片的当前帧派生**
 *      （同帧 → 模糊 + 提亮 + 提饱和 → 低分辨率光画布），机制上仍是「主从同源」，
 *      下游（屏幕材质、投射灯 map、背景光溢出）无需改动。
 */
import * as THREE from 'three/webgpu';

/** 影片路径（原件 `pm` 本地化：640×480，12.94 秒，fMP4 拼接而成） */
const VIDEO_URL = '/asset/hero/showreel_loop.mp4';
/** 光纹理尺寸（作为 gobo / 光溢出源，低分辨率足够且省上传带宽） */
const LIGHT_W = 128;
const LIGHT_H = 96;

/** 循环片句柄 */
export interface HeroScreenLoop {
  /** 屏幕内容纹理（原件主片，VideoTexture，给屏幕材质采样） */
  contentTexture: THREE.Texture;
  /** 光纹理（由当前影片帧派生；给投射灯 map 与背景光溢出采样） */
  lightTexture: THREE.Texture;
  /** 每帧调用：若影片出现新帧则重派生光纹理（内容纹理由 VideoTexture 自行上传） */
  update: () => void;
  /** 释放视频元素与两张纹理 */
  dispose: () => void;
}

/**
 * 创建屏幕循环片（原件主片 + 同帧派生光）
 *
 * 功能：建一个隐藏的 `<video>`（静音循环 + 免交互自动播放）承载原件那条影片，用
 *      VideoTexture 作为屏幕内容；再建一张低分辨率光画布，每帧把影片当前帧压进去
 *      做模糊 + 提亮 + 提饱和，作为 gobo / 光溢出源。
 *
 * 参数：无（影片路径与光画布尺寸为模块常量）
 *
 * 返回值：HeroScreenLoop
 *
 * 异常：浏览器不支持 2D canvas 上下文时抛 Error（正常环境不会）
 *
 * 注意事项：
 *  - 视频元素必须挂进 DOM（不可见、不拦截事件）—— 未挂载的 video 在部分浏览器下自动
 *    播放会被拒；被拒时静默停在首帧，不影响其余效果
 *  - 两张纹理都设 SRGBColorSpace / LinearFilter / 不生成 mipmap，与原件 VideoTexture 一致
 *  - 光只在新帧到达时重派生，省掉空转的 2D 绘制
 */
export function createHeroScreenLoop(): HeroScreenLoop {
  // ---------- 主片：原件同一条 Mux 影片（已本地化） ----------
  const video = document.createElement('video');
  video.src = VIDEO_URL;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:-10px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);
  const playResult = video.play();
  if (playResult && typeof playResult.catch === 'function') {
    // 自动播放被策略拒绝时不让整页挂掉：画面停在首帧
    playResult.catch(() => { /* 静默 */ });
  }

  const contentTexture = new THREE.VideoTexture(video);
  contentTexture.colorSpace = THREE.SRGBColorSpace;
  contentTexture.minFilter = THREE.LinearFilter;
  contentTexture.magFilter = THREE.LinearFilter;
  contentTexture.generateMipmaps = false;

  // ---------- 光：从同一帧派生 ----------
  const lightCanvas = document.createElement('canvas');
  lightCanvas.width = LIGHT_W;
  lightCanvas.height = LIGHT_H;
  const lightCtx = lightCanvas.getContext('2d');
  if (!lightCtx) throw new Error('无法获取 2D canvas 上下文');
  const lightTexture = new THREE.Texture(lightCanvas);
  lightTexture.colorSpace = THREE.SRGBColorSpace;
  lightTexture.minFilter = THREE.LinearFilter;
  lightTexture.magFilter = THREE.LinearFilter;
  lightTexture.generateMipmaps = false;

  /** 上一帧的影片时间，用于判断是否有新帧 */
  let lastFrameTime = -1;

  /**
   * 每帧更新
   *
   * 功能：影片出现新帧时把该帧压进光画布（模糊 + 提亮 + 提饱和）并标记光纹理更新；
   *      内容纹理由 VideoTexture 自行上传，无需手动标记
   *
   * 参数：无
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：影片未就绪（readyState < 2）时直接跳过，避免对空帧做无意义的 2D 绘制
   */
  const update = () => {
    if (video.readyState < 2 || video.videoWidth === 0) return;
    if (video.currentTime === lastFrameTime) return;
    lastFrameTime = video.currentTime;
    drawLightFrom(video, lightCtx, video.videoWidth, video.videoHeight, LIGHT_W, LIGHT_H);
    lightTexture.needsUpdate = true;
  };

  /** 释放视频元素与两张纹理 */
  const dispose = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (video.parentNode) video.parentNode.removeChild(video);
    // 两张纹理各自包一层保护：three 0.169 的 WebGPU 后端在纹理**从未上传过 GPU** 时
    // （挂载后首帧之前就被卸载、或 HMR 重新挂载）会走进 undefined 的 `destroy` 并抛
    // `Cannot read properties of undefined (reading 'destroy')`，把整个组件带崩。
    // 释放失败不该升级成页面崩溃。
    try { contentTexture.dispose(); } catch { /* 见上：后端未持有该纹理数据 */ }
    try { lightTexture.dispose(); } catch { /* 见上：后端未持有该纹理数据 */ }
  };

  return { contentTexture, lightTexture, update, dispose };
}

/**
 * 从影片当前帧派生光纹理
 *
 * 功能：把影片帧压进光画布，并做模糊 + 提亮 + 提饱和，得到「屏幕发出的光」这一路信号
 *      （原件里由从属视频 `pE` 承担，本页改为同帧派生）
 *
 * 参数：
 *  - src  {CanvasImageSource} 影片元素（或任何可绘制源）
 *  - dstCtx {CanvasRenderingContext2D} 光画布上下文
 *  - sw / sh {number} 源尺寸（像素）
 *  - dw / dh {number} 目标尺寸
 *
 * 返回值：无
 *
 * 异常：无（影片未就绪时由调用方拦掉，不在此处判断）
 *
 * 注意事项：与内容同一帧派生（主从同源）；两次叠加绘制（第二次用 lighter）模拟屏幕光的过曝核心
 */
function drawLightFrom(
  src: CanvasImageSource,
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
  dstCtx.drawImage(src, 0, 0, sw, sh, 0, 0, dw, dh);
  dstCtx.globalCompositeOperation = 'lighter';
  dstCtx.filter = 'blur(4px) saturate(180%) brightness(1.2)';
  dstCtx.drawImage(src, 0, 0, sw, sh, 0, 0, dw, dh);
  dstCtx.filter = 'none';
  dstCtx.globalCompositeOperation = 'source-over';
}
