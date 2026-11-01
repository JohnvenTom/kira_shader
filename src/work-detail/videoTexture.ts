/**
 * mux HLS 视频加载（原站 fq 加载器等价物，04kr:62262-62280）
 *
 * hls.js 把 `https://stream.mux.com/{id}.m3u8?max_resolution={档位}` 接到离屏
 * <video> 上（autoplay:false, muted:true, loop:true），每帧 drawImage 进 canvas，
 * 用 CanvasTexture 上屏——不经 VideoTexture：r169 的 WebGPU 视频纹理在起播缓冲期
 * （readyState 回落 <2）会产生空纹理视图，object bindGroup 校验失败导致整条渲染
 * 指令被静默丢弃（内容层冻结、只有纸纹颗粒在动的根因，2026-10-31 实证）。
 */
import * as THREE from 'three/webgpu';
import Hls from 'hls.js';

export interface MuxVideoHandle {
  video: HTMLVideoElement;
  /** canvas 位块拷贝纹理（每帧 pump() 拉新帧） */
  texture: THREE.CanvasTexture;
  /** 实测宽比（videoWidth/videoHeight；元数据就绪后解析） */
  aspect: Promise<number>;
  /** 首帧已实际绘制（requestVideoFrameCallback）——挂载纹理前必须等到它 */
  ready: Promise<void>;
  /** 渲染前拉取新帧（可见卡逐帧调用；不可见时跳过） */
  pump: () => void;
  play: () => void;
  pause: () => void;
  dispose: () => void;
}

export function loadMuxVideo(playbackId: string, maxResolution: string): Promise<MuxVideoHandle | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.autoplay = false;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.style.position = 'fixed';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.width = '2px';
    video.style.height = '2px';
    document.body.appendChild(video);

    const cleanupAndFail = () => {
      video.remove();
      resolve(null);
    };

    if (!Hls.isSupported()) {
      // Safari 原生 HLS
      video.src = `https://stream.mux.com/${playbackId}.m3u8?max_resolution=${maxResolution}`;
      video.addEventListener('error', cleanupAndFail, { once: true });
      video.addEventListener('loadedmetadata', () => resolve(finalize(video)), { once: true });
      video.load();
      return;
    }

    const hls = new Hls({ autoStartLoad: true, capLevelToPlayerSize: false });
    (video as any).__hls = hls;
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) {
        hls.destroy();
        cleanupAndFail();
      }
    });
    hls.loadSource(`https://stream.mux.com/${playbackId}.m3u8?max_resolution=${maxResolution}`);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.addEventListener('loadedmetadata', () => resolve(finalize(video)), { once: true });
    });
  });
}

function finalize(video: HTMLVideoElement): MuxVideoHandle {
  // canvas 位块拷贝：初始 2×2（合法绑定），首帧后按视频真实尺寸重建
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const aspect = new Promise<number>((resolve) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) resolve(video.videoWidth / video.videoHeight);
    else video.addEventListener('loadeddata', () => resolve(video.videoWidth / video.videoHeight), { once: true });
  });

  /** 首帧已绘制（WebGPU 绑定前必须等到；loadeddata 只保证解码器有数据，不保证已绘制） */
  const ready = new Promise<void>((resolve) => {
    const done = () => resolve();
    const onFrame = () => {
      if ('requestVideoFrameCallback' in video) (video as any).requestVideoFrameCallback(() => done());
      else done();
    };
    if (video.readyState >= 2) onFrame();
    else video.addEventListener('loadeddata', onFrame, { once: true });
  });

  /** 渲染前拉新帧：drawImage 到 canvas + needsUpdate（WebGPU 逐帧上传） */
  const pump = (): void => {
    if (!ctx) return;
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      texture.needsUpdate = true;
    }
  };

  return {
    video,
    texture,
    aspect,
    ready,
    pump,
    play: () => {
      video.play().catch(() => {});
    },
    pause: () => video.pause(),
    dispose: () => {
      (video as any).__hls?.destroy?.();
      video.removeAttribute('src');
      video.load();
      video.remove();
      texture.dispose();
    },
  };
}
