/**
 * mux HLS 视频加载（原站 fq 加载器等价物，04kr:62262-62280）
 *
 * hls.js 把 `https://stream.mux.com/{id}.m3u8?max_resolution={档位}` 接到离屏
 * <video> 上（autoplay:false, muted:true, loop:true），包成 VideoTexture。
 * 原站档位：reducedMemory→480p / width<700→720p / 其余 1080p（MEDIA_CARD.maxResolution）。
 */
import * as THREE from 'three/webgpu';
import Hls from 'hls.js';

export interface MuxVideoHandle {
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  /** 实测宽比（videoWidth/videoHeight；元数据就绪后解析） */
  aspect: Promise<number>;
  /** 首帧就绪（readyState ≥ 2 / loadeddata）——挂 VideoTexture 前必须等到它：
   *  空帧视频纹理会让 object bindGroup 校验失效，整条渲染指令被 WebGPU 静默丢弃 */
  ready: Promise<void>;
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
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  const aspect = new Promise<number>((resolve) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) resolve(video.videoWidth / video.videoHeight);
    else video.addEventListener('loadeddata', () => resolve(video.videoWidth / video.videoHeight), { once: true });
  });
  const ready = new Promise<void>((resolve) => {
    if (video.readyState >= 2) resolve();
    else video.addEventListener('loadeddata', () => resolve(), { once: true });
  });
  return {
    video,
    texture,
    aspect,
    ready,
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
