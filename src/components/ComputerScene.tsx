import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { parseGIF, decompressFrames, type GifFrame } from 'gifuct-js';
import { CameraDebugger } from './CameraDebugger';

// 模型与 Draco 解码器路径（通过 Vite 中间件映射到父级 asset 目录）
const MODEL_URL = '/asset/models/computer.glb';
const DRACO_DECODER_PATH = '/asset/vendor/draco/';
// 烟雾纹理路径（用于镜头前/电脑后两层飘动烟雾）
const SMOKE_TEXTURE_URL = '/asset/textures/smoke.png';

// 4 个屏幕 GIF 资源（通过 Vite import 引入，打包时自动 hash 命名）
import GIF_1 from '../assets/screen/03137AE1AD5E4C3B6173DBC48AFA0DD9.gif';
import GIF_2 from '../assets/screen/15F76574774483E71291466E72003E0B.gif';
import GIF_3 from '../assets/screen/4FBBD22DB3BA1F9AED692C298BC55602.gif';
import GIF_4 from '../assets/screen/E60E266E36DD9050508BBBF29CE9527D.gif';

/** 屏幕 GIF 列表：按顺序循环切换显示 */
const SCREEN_GIF_URLS = [GIF_1, GIF_2, GIF_3, GIF_4];

/**
 * 屏幕显示配置（世界坐标系）
 *
 * 功能：定义屏幕 plane 在场景世界坐标系中的位置、尺寸、朝向
 *
 * 字段说明：
 *  - posX / posY / posZ：屏幕中心在世界坐标系的位置
 *    （用户用 OrbitControls 把相机探到屏幕表面，从调试面板读出的世界坐标）
 *  - width / height：屏幕 plane 的宽高（世界单位）
 *  - rotY：屏幕朝向（弧度），朝向相机方向；DoubleSide 双面渲染时可忽略
 *  - switchIntervalSec：GIF 切换间隔（秒）
 *  - emissiveIntensity：自发光强度，越大越亮
 */
const SCREEN_CONFIG = {
  // 屏幕中心：来自 computer mesh [2]号平面的世界坐标中心
  // （法线(-0.6,0,0.8) 的斜面，顶点数 104 最多=屏幕区域）
  // 沿法线方向往前推 0.15，让 plane 略离开模型表面，避免 z-fighting
  posX: -0.271 + -0.6 * 0.15,   // 
  posY: -1.39,                  // 世界坐标 Y
  posZ: 0.507 + 0.8 * 0.15,      // 
  // 屏幕尺寸：小于面板尺寸(W0.609 H0.512)，留出边框
  width: 0.38,         // 屏幕宽（世界单位）
  height: 0.29,        // 屏幕高（世界单位）
  // 旋转：让 plane 法线对齐面板法线(-0.6,0,0.8)
  // plane 默认法线(0,0,1) 绕 Y 轴旋转到(-0.6,0,0.8)：rotY = atan2(-0.6, 0.8)
  rotX: 0.10,          // ≈ +4.6°，屏幕上沿微微后仰
  rotY: -0.715,       //
  rotZ: 0.05,          // ≈ +2.9°，修正向左歪，上沿往右倾斜
  switchIntervalSec: 6,    // 每 6 秒切换一个 GIF
  emissiveIntensity: 2.5,  // 自发光强度
};

/**
 * 调试模式开关
 *
 * 功能：开启后启用 OrbitControls 自由视角 + 信息面板 + FOV 滑块
 *       关闭后使用 CAMERA_CONFIG 静态参数控制相机
 *
 * 注意事项：发布前请设为 false
 */
const DEBUG = true;

/**
 * 相机空间配置
 *
 * 功能：定义相机的空间位置与摆放角度
 *
 * 字段说明：
 *  - yawDeg   水平偏转角（°）。0° = 正前方；正值顺时针（向右转）；负值逆时针（向左转）
 *  - pitchDeg 俯仰角（°）。0° = 水平平视；正值 = 俯视（从上往下看）；负值 = 仰视（从下往上看）
 *  - height   相机高度（Y 轴，世界坐标）。正值上、负值下；基于模型缩放后的尺寸的倍数
 *  - distance 相机到模型中心的距离。1.0 = 基础距离（刚好能完整看到模型）；<1 贴近；>1 远离
 *  - lookAtX  相机看向的目标 X 位置（世界坐标）。基于模型缩放后尺寸的倍数，用于控制视线水平落点
 *  - lookAtY  相机看向的目标 Y 位置（世界坐标）。基于模型缩放后尺寸的倍数，用于控制视线垂直落点
 *  - lookAtZ  相机看向的目标 Z 位置（世界坐标）。基于模型缩放后尺寸的倍数，用于控制视线水平落点
 *  - fov      相机视野（°）。值越大视野越广（鱼眼），值越小视野越窄（长焦）
 */
const CAMERA_CONFIG = {
  yawDeg: 165.45,      // 水平角（°）
  pitchDeg: 4.56,      // 俯仰角（°）
  height: -0.400,      // 相机高度（scaledSize.y 倍数）
  distance: 0.039,     // 距离倍数
  lookAtX: 0.000,      // 看向点 X 倍数（scaledSize.x 倍数）
  lookAtY: -0.411,     // 看向点 Y 倍数（scaledSize.y 倍数）
  lookAtZ: 0.000,      // 看向点 Z 倍数（scaledSize.z 倍数）
  fov: 41,             // 相机视野（°）
};

/**
 * 预配置 Draco 解码器路径
 * 功能：在模块加载时设置 useGLTF 的 Draco 解码器位置
 * 注意：必须在组件渲染前执行；drei 的 useGLTF 内置 Draco 支持，仅需提供 wasm 路径
 */
useGLTF.setDecoderPath(DRACO_DECODER_PATH);

interface SmokeLayerProps {
  /** 烟雾纹理（带 alpha 通道） */
  texture: THREE.Texture;
  /** 烟雾粒子数量 */
  count?: number;
  /** 烟雾在 XZ 平面上的扩散范围（世界单位） */
  areaSize?: number;
  /** 单个烟雾 sprite 的基础尺寸（世界单位） */
  spriteSize?: number;
  /** 基础不透明度（0~1），实际还会随时间呼吸 */
  opacity?: number;
  /** 烟雾颜色（建议偏冷暗色，与暗场景融合） */
  color?: string;
  /** 整体亮度缩放（用于前后层差异化） */
  brightness?: number;
}

/**
 * 飘动烟雾层
 *
 * 功能：在自身 group 原点处生成一组始终朝向相机的烟雾 sprite，
 *      通过正弦扰动让每个粒子缓慢飘动，并做透明度呼吸。
 *
 * 参数：见 SmokeLayerProps
 *
 * 返回值：React.ReactElement（一个包含若干 <sprite> 的 <group>）
 *
 * 异常：无
 *
 * 注意事项：
 *  - 使用 Sprite 保证始终朝向相机，不会被相机绕到背后
 *  - depthWrite=false 避免烟雾互相遮挡写入深度缓冲导致穿模
 *  - 采用 AdditiveBlending，在暗场景里呈现微弱发光感
 *  - 烟雾本身的 group 位置由父组件（ComputerScene）在 useFrame 中动态更新
 */
function SmokeLayer({
  texture,
  count = 9,
  areaSize = 3,
  spriteSize = 3,
  opacity = 0.45,
  color = '#9aa3b8',
  brightness = 1,
}: SmokeLayerProps) {
  // 缓存每个粒子的初始参数，避免每帧重新随机
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      offsetX: (Math.random() - 0.5) * areaSize,
      // Y 偏移整体上抬（0.3~0.9），避免贴图下沿触地暴露相交线
      offsetY: 0.2 + Math.random() * 0.6,
      offsetZ: (Math.random() - 0.5) * areaSize,
      // 飘动频率（越大飘得越快）
      driftSpeed: 0.15 + Math.random() * 0.25,
      // 飘动幅度
      driftAmp: 0.3 + Math.random() * 0.5,
      // 透明度呼吸相位
      opacityPhase: Math.random() * Math.PI * 2,
      opacitySpeed: 0.4 + Math.random() * 0.5,
      // 个体缩放（缩小，避免贴图过大触地）
      scale: 0.3 + Math.random() * 0.5,
    }));
  }, [count, areaSize]);

  // 收集 sprite 实例引用，供 useFrame 更新
  const spritesRef = useRef<THREE.Sprite[]>([]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const sprite = spritesRef.current[i];
      if (!sprite) continue;
      const t = time * p.driftSpeed;
      // 位置飘动：双频正弦叠加，避免循环感
      // Y 方向飘动幅度压小（0.2 倍），避免飘动后下沿触地
      sprite.position.x = p.offsetX + Math.sin(t + p.opacityPhase) * p.driftAmp;
      sprite.position.y = p.offsetY + Math.sin(t * 0.8 + p.opacityPhase * 1.3) * p.driftAmp * 0.2;
      sprite.position.z = p.offsetZ + Math.cos(t * 0.9 + p.opacityPhase) * p.driftAmp;
      // 透明度呼吸
      const breath = 0.55 + 0.45 * Math.sin(time * p.opacitySpeed + p.opacityPhase);
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.opacity = opacity * breath * brightness;
      // 不旋转贴图：保持固定朝向，避免与模型边缘产生穿模感
    }
  });

  return (
    <group>
      {particles.map((p, i) => (
        <sprite
          key={i}
          ref={(el) => {
            if (el) spritesRef.current[i] = el;
          }}
          scale={[spriteSize * p.scale, spriteSize * p.scale, 1]}
        >
          <spriteMaterial
            map={texture}
            transparent
            opacity={opacity}
            color={color}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}

interface ComputerSceneProps {
  /** 滚动进度 0~1，驱动相机与模型动画 */
  scrollProgress: number;
  /** 模型加载完成回调 */
  onLoaded: () => void;
}

/**
 * 根据相机配置计算 3D 空间位置
 *
 * 功能：把水平角 yaw、俯仰角 pitch、高度 height、距离 distance
 *      转换为 Three.js 中的 (x, y, z) 世界坐标
 *      相机位置 = target 位置 + 球坐标偏移
 *
 * 参数：
 *  - baseDistance {number} 基础距离（来自包围盒+FOV 计算）
 *  - scaledSize   {THREE.Vector3} 模型缩放后的尺寸
 *  - targetX      {number} 看向点 X 世界坐标
 *  - targetZ      {number} 看向点 Z 世界坐标
 *
 * 返回值：{ x, y, z } 相机的世界坐标
 *
 * 异常：无
 *
 * 注意事项：
 *  - yaw=0、pitch=0 时相机位于 target 的 +Z 方向（正对模型）
 *  - height 字段以 scaledSize.y 的倍数计算，便于按模型尺寸调整
 *  - pitch 正值俯视、负值仰视，单位为度（°）
 *  - 相机位置相对 target 偏移，这样 PAN 后还原视角才正确
 */
function computeCameraPosition(
  baseDistance: number,
  scaledSize: THREE.Vector3,
  targetX: number,
  targetZ: number
): { x: number; y: number; z: number } {
  const yawRad = (CAMERA_CONFIG.yawDeg * Math.PI) / 180;
  const pitchRad = (CAMERA_CONFIG.pitchDeg * Math.PI) / 180;
  const dist = baseDistance * CAMERA_CONFIG.distance;
  const yOffset = scaledSize.y * CAMERA_CONFIG.height;

  // 水平方向：yaw=0 时在 target 的 +Z 方向；正值顺时针
  const horizontalDist = dist * Math.cos(pitchRad);
  const x = targetX + Math.sin(yawRad) * horizontalDist;
  const z = targetZ + Math.cos(yawRad) * horizontalDist;

  // 俯仰方向：pitch=0 时水平；正值相机在上（俯视）；负值相机在下（仰视）
  const y = yOffset + Math.sin(pitchRad) * dist;

  return { x, y, z };
}

/** 主 canvas 尺寸（CanvasTexture 的固定尺寸，避免切换 GIF 时重建纹理） */
const SCREEN_CANVAS_SIZE = 512;

/**
 * 单个 GIF 解析后的可播放资源
 *
 * 字段说明：
 *  - width / height   GIF 逻辑画布尺寸（所有帧的最大右下角）
 *  - frames           预合成好的整帧 RGBA 列表（已处理 disposal 合成）
 *  - totalDurationMs  所有帧 delay 之和（毫秒），用于循环播放
 */
interface GifAsset {
  width: number;
  height: number;
  frames: { imageData: ImageData; delayMs: number }[];
  totalDurationMs: number;
}

/**
 * 加载并解析 GIF 文件，预合成每一帧
 *
 * 功能：
 *  - fetch 拿到 GIF 二进制 → parseGIF 解析结构 → decompressFrames 解压每帧 patch
 *  - 按 disposalType 在临时 canvas 上逐帧合成，得到每一帧的完整 ImageData
 *  - 返回可直接用于 putImageData 的帧列表 + 总时长
 *
 * 参数：
 *  - url {string} GIF 文件 URL（经 Vite hash 处理后的路径）
 *
 * 返回值：Promise<GifAsset>，包含预合成帧列表
 *
 * 异常：fetch 失败 / parseGIF 抛错 / frames 为空时 reject
 *
 * 注意事项：
 *  - 浏览器对 <img> 加载的 GIF 有惰性解码，移出视口或 opacity:0 时不会推进帧，
 *    所以必须自己解析 GIF 二进制，不能用 img + drawImage 的方式
 *  - disposalType=2 时下一帧绘制前需 clearRect 恢复背景
 *  - disposalType=3 时下一帧绘制前需恢复为前一帧状态（这里用上一帧 ImageData 回填）
 *  - delay=0 的帧按 100ms 处理（浏览器默认行为）
 */
async function loadGif(url: string): Promise<GifAsset> {
  const buffer = await fetch(url).then((r) => r.arrayBuffer());
  const parsed = parseGIF(buffer);
  const rawFrames = decompressFrames(parsed, true);
  if (rawFrames.length === 0) throw new Error(`GIF 无帧数据: ${url}`);

  // GIF 逻辑画布尺寸 = 所有帧 (left+width, top+height) 的最大值
  let gifW = 0;
  let gifH = 0;
  for (const f of rawFrames) {
    gifW = Math.max(gifW, f.dims.left + f.dims.width);
    gifH = Math.max(gifH, f.dims.top + f.dims.height);
  }

  // 临时合成 canvas（GIF 逻辑尺寸）+ 单帧 patch canvas
  const composeCanvas = document.createElement('canvas');
  composeCanvas.width = gifW;
  composeCanvas.height = gifH;
  const composeCtx = composeCanvas.getContext('2d')!;

  const patchCanvas = document.createElement('canvas');
  patchCanvas.width = gifW;
  patchCanvas.height = gifH;
  const patchCtx = patchCanvas.getContext('2d')!;

  const frames: { imageData: ImageData; delayMs: number }[] = [];
  let totalDurationMs = 0;

  for (let i = 0; i < rawFrames.length; i++) {
    const f: GifFrame = rawFrames[i];

    // 把当前帧 patch 写到 patchCanvas 的对应位置
    // patch 是 RGBA Uint8ClampedArray，尺寸 = dims.width × dims.height
    patchCtx.clearRect(0, 0, gifW, gifH);
    const patchImg = patchCtx.createImageData(f.dims.width, f.dims.height);
    patchImg.data.set(f.patch);
    patchCtx.putImageData(patchImg, f.dims.left, f.dims.top);

    // 把 patch 叠加到合成 canvas（drawImage 会做 alpha 混合）
    composeCtx.drawImage(patchCanvas, 0, 0);

    // 保存当前合成结果（注意：getImageData 返回的是副本）
    frames.push({
      imageData: composeCtx.getImageData(0, 0, gifW, gifH),
      delayMs: f.delay > 0 ? f.delay : 100,
    });
    totalDurationMs += f.delay > 0 ? f.delay : 100;

    // 处理 disposal：决定绘制下一帧前如何处理本帧
    if (f.disposalType === 2) {
      // 恢复为背景色（透明）
      composeCtx.clearRect(0, 0, gifW, gifH);
    } else if (f.disposalType === 3 && i > 0) {
      // 恢复为前一帧状态
      composeCtx.putImageData(frames[i - 1].imageData, 0, 0);
    }
    // disposalType 0/1：保留当前帧，下一帧在其上叠加
  }

  return { width: gifW, height: gifH, frames, totalDurationMs };
}

/**
 * 屏幕显示组件
 *
 * 功能：
 *  - 用 gifuct-js 解析 4 个 GIF 文件，预合成每一帧的 ImageData
 *  - 用 canvas 中转：每帧按 elapsed time 计算当前帧索引，putImageData 到 canvas
 *  - 用 CanvasTexture 作为 emissiveMap，让屏幕"自发光"（不受场景光照压暗）
 *  - 定时循环切换 4 个 GIF
 *
 * 参数：无（位置用世界坐标，直接在 SCREEN_CONFIG 里配置）
 *
 * 返回值：React.ReactElement | null（GIF 未加载完时返回 null）
 *
 * 异常：GIF 加载失败时打印 console.error，组件返回 null
 *
 * 注意事项：
 *  - 必须自己解析 GIF 二进制，浏览器对 <img> 的 GIF 惰性解码导致 drawImage 永远是首帧
 *  - 预合成阶段已处理 disposal，播放时只需按帧索引 putImageData
 *  - 主 canvas 固定 512×512，GIF 尺寸不同时用 drawImage 缩放
 *  - mesh 直接放场景根节点，用世界坐标（模型静止，无需 reparent 跟随）
 */
function ScreenDisplay() {
  // GIF 加载完成标志：所有 GIF 解析完才渲染 mesh
  const [ready, setReady] = useState(false);
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  // 当前 GIF 索引（用 ref 避免每帧 setState）
  const idxRef = useRef(0);
  // 当前 GIF 播放起点（秒，用于计算播放进度）
  const gifStartRef = useRef(0);

  // 持久化 GIF 资源列表 + 主 canvas 列表 + CanvasTexture 列表
  const assetsRef = useRef<GifAsset[]>([]);
  const canvasesRef = useRef<HTMLCanvasElement[]>([]);
  const texturesRef = useRef<THREE.CanvasTexture[]>([]);
  // 单帧 patch canvas（GIF 逻辑尺寸），用于 putImageData 后再 drawImage 缩放到主 canvas
  const patchCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 异步加载并解析所有 GIF
  useEffect(() => {
    let cancelled = false;
    const textures: THREE.CanvasTexture[] = [];
    const canvases: HTMLCanvasElement[] = [];
    const assets: GifAsset[] = [];

    // 公用 patch canvas（尺寸会按当前 GIF 动态调整）
    const patchCanvas = document.createElement('canvas');
    patchCanvasRef.current = patchCanvas;

    Promise.all(
      SCREEN_GIF_URLS.map(async (url, i) => {
        const asset = await loadGif(url);
        if (cancelled) return;

        // 每个 GIF 配一个独立主 canvas（固定 512×512，作为 CanvasTexture 源）
        const canvas = document.createElement('canvas');
        canvas.width = SCREEN_CANVAS_SIZE;
        canvas.height = SCREEN_CANVAS_SIZE;
        const ctx = canvas.getContext('2d')!;
        // 首帧立即画上去，避免首屏空白
        patchCanvas.width = asset.width;
        patchCanvas.height = asset.height;
        patchCanvas.getContext('2d')!.putImageData(asset.frames[0].imageData, 0, 0);
        ctx.drawImage(patchCanvas, 0, 0, SCREEN_CANVAS_SIZE, SCREEN_CANVAS_SIZE);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;

        assets[i] = asset;
        canvases[i] = canvas;
        textures[i] = tex;

        // eslint-disable-next-line no-console
        console.log(
          `[ScreenDisplay] GIF[${i}] 解析完成: ${asset.width}x${asset.height}, ` +
            `${asset.frames.length} 帧, 总时长 ${asset.totalDurationMs}ms`
        );
      })
    )
      .then(() => {
        if (cancelled) return;
        assetsRef.current = assets;
        canvasesRef.current = canvases;
        texturesRef.current = textures;
        setReady(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[ScreenDisplay] GIF 加载失败:', err);
      });

    return () => {
      cancelled = true;
      textures.forEach((t) => t.dispose());
    };
  }, []);

  // 每帧：按 elapsed time 计算当前 GIF 的当前帧，putImageData + drawImage 到主 canvas
  useFrame((state) => {
    const assets = assetsRef.current;
    const canvases = canvasesRef.current;
    const textures = texturesRef.current;
    const patchCanvas = patchCanvasRef.current;
    if (assets.length === 0 || !patchCanvas) return;

    const t = state.clock.elapsedTime;

    // 定时切换 GIF
    if (t - gifStartRef.current > SCREEN_CONFIG.switchIntervalSec) {
      gifStartRef.current = t;
      idxRef.current = (idxRef.current + 1) % assets.length;
      const tex = textures[idxRef.current];
      if (matRef.current && tex) {
        matRef.current.map = tex;
        matRef.current.emissiveMap = tex;
        matRef.current.needsUpdate = true;
      }
    }

    const idx = idxRef.current;
    const asset = assets[idx];
    const canvas = canvases[idx];
    const tex = textures[idx];
    if (!asset || !canvas || !tex) return;

    // 计算当前应该播放哪一帧
    const elapsedMs = (t - gifStartRef.current) * 1000;
    const loopMs = asset.totalDurationMs || 1;
    const playMs = elapsedMs % loopMs;

    let acc = 0;
    let frameIdx = 0;
    for (let i = 0; i < asset.frames.length; i++) {
      acc += asset.frames[i].delayMs;
      if (acc > playMs) {
        frameIdx = i;
        break;
      }
      frameIdx = i; // 兜底：playMs 超过总时长时取最后一帧
    }

    // putImageData 不支持缩放，先写到 patchCanvas（GIF 逻辑尺寸），再 drawImage 缩放到主 canvas
    if (patchCanvas.width !== asset.width || patchCanvas.height !== asset.height) {
      patchCanvas.width = asset.width;
      patchCanvas.height = asset.height;
    }
    const patchCtx = patchCanvas.getContext('2d')!;
    patchCtx.putImageData(asset.frames[frameIdx].imageData, 0, 0);

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(patchCanvas, 0, 0, canvas.width, canvas.height);
    tex.needsUpdate = true;
  });

  // GIF 未加载完时不渲染 mesh
  if (!ready || texturesRef.current.length === 0) return null;

  return (
    <mesh
      ref={meshRef}
      position={[SCREEN_CONFIG.posX, SCREEN_CONFIG.posY, SCREEN_CONFIG.posZ]}
      rotation={[SCREEN_CONFIG.rotX, SCREEN_CONFIG.rotY, SCREEN_CONFIG.rotZ]}
    >
      <planeGeometry args={[SCREEN_CONFIG.width, SCREEN_CONFIG.height]} />
      <meshStandardMaterial
        ref={matRef}
        map={texturesRef.current[0]}
        emissive="#ffffff"
        emissiveMap={texturesRef.current[0]}
        emissiveIntensity={SCREEN_CONFIG.emissiveIntensity}
        toneMapped={false}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * 分析模型几何，自动找出屏幕区域
 *
 * 功能：
 *  - 遍历 modelScene 下所有 mesh 的几何，读取顶点位置和法线
 *  - 按法线方向聚类（四舍五入到 0.2 精度），找出每个平面簇
 *  - 对每个平面簇计算包围盒、面积、中心点
 *  - 输出 Top N 候选平面，供人工判断哪个是屏幕
 *  - 同时输出局部→世界坐标的换算公式
 *
 * 参数：
 *  - modelScene: THREE.Group，加载的模型根节点
 *  - scale: number，模型缩放倍数
 *  - center: THREE.Vector3，模型中心点（缩放前局部坐标）
 *
 * 返回值：无（结果打印到 console）
 *
 * 注意事项：
 *  - Draco 解码后的几何在 BufferGeometry.attributes 里，可直接读取
 *  - 屏幕通常是面积较大、法线朝某一方向的矩形平面
 */
function analyzeScreenGeometry(
  modelScene: THREE.Group,
  scale: number,
  center: THREE.Vector3
) {
  // eslint-disable-next-line no-console
  console.log('%c=== 屏幕位置自动分析（按 mesh 分组）===', 'color:#0f;font-weight:bold');

  // 按 mesh 分别分析，避免 background 的大平面淹没 computer 的屏幕
  const meshes: { name: string; mesh: THREE.Mesh }[] = [];
  modelScene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.attributes?.position && mesh.geometry.attributes.normal) {
      meshes.push({ name: mesh.name || '(unnamed)', mesh });
    }
  });

  meshes.forEach(({ name, mesh }) => {
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    const normAttr = geo.attributes.normal;

    // 按法线聚类
    const planes: Record<string, { normal: [number, number, number]; verts: { x: number; y: number; z: number }[] }> = {};
    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const py = posAttr.getY(i);
      const pz = posAttr.getZ(i);
      const nx = Math.round(normAttr.getX(i) * 5) / 5;
      const ny = Math.round(normAttr.getY(i) * 5) / 5;
      const nz = Math.round(normAttr.getZ(i) * 5) / 5;
      const key = `${nx},${ny},${nz}`;
      if (!planes[key]) planes[key] = { normal: [nx, ny, nz], verts: [] };
      planes[key].verts.push({ x: px, y: py, z: pz });
    }

    const planesInfo = Object.values(planes)
      .map((p) => {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        p.verts.forEach((v) => {
          minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
          minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
        });
        const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
        const area = Math.max(w * h, w * d, h * d);
        return {
          normal: p.normal,
          count: p.verts.length,
          w, h, d, area,
          centerX: (minX + maxX) / 2,
          centerY: (minY + maxY) / 2,
          centerZ: (minZ + maxZ) / 2,
        };
      })
      .sort((a, b) => b.area - a.area);

    // eslint-disable-next-line no-console
    console.log(`%c--- mesh: ${name} （顶点 ${posAttr.count}，平面 ${planesInfo.length}）---`, 'color:#ff0');
    planesInfo.slice(0, 5).forEach((p, i) => {
      const worldX = (p.centerX - center.x) * scale;
      const worldY = (p.centerY - center.y) * scale;
      const worldZ = (p.centerZ - center.z) * scale;
      // eslint-disable-next-line no-console
      console.log(
        `  [${i}] 法线(${p.normal[0]},${p.normal[1]},${p.normal[2]}) 顶点:${p.count} 面积:${p.area.toFixed(1)}\n` +
        `      局部 中心(${p.centerX.toFixed(1)},${p.centerY.toFixed(1)},${p.centerZ.toFixed(1)}) W${p.w.toFixed(1)} H${p.h.toFixed(1)} D${p.d.toFixed(1)}\n` +
        `      世界 中心(${worldX.toFixed(3)},${worldY.toFixed(3)},${worldZ.toFixed(3)}) W${(p.w*scale).toFixed(3)} H${(p.h*scale).toFixed(3)}`
      );
    });
  });

  // eslint-disable-next-line no-console
  console.log('%c换算公式: 世界 = (局部 - center) * scale', 'color:#0ff');
  // eslint-disable-next-line no-console
  console.log(`center=(${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)}) scale=${scale.toFixed(4)}`);
}

/**
 * 3D 场景组件
 *
 * 功能：
 *  - 加载 computer.glb（Draco 压缩）模型
 *  - 自动居中并缩放到统一尺寸
 *  - 配置 PMREM 环境贴图与三点光照
 *  - 根据滚动进度驱动相机环绕与模型旋转
 *
 * 参数：
 *  - scrollProgress: number，0~1 滚动进度
 *  - onLoaded: () => void，模型加载完成回调
 *
 * 返回值：React.ReactElement
 *
 * 异常：若模型加载失败会在控制台报错并向上抛出
 *
 * 注意事项：
 *  - Draco 解码器路径在模块顶部已预配置
 *  - 相机距离基于 FOV 与模型包围盒动态计算，避免过大/过小模型显示异常
 *  - 滚动进度通过 useFrame 中读取最新 props 实现，避免重渲染
 */
export function ComputerScene({ scrollProgress, onLoaded }: ComputerSceneProps) {
  // 使用 ref 保存最新的滚动进度，避免每帧触发 React 重渲染
  const progressRef = useRef(scrollProgress);
  progressRef.current = scrollProgress;

  const { camera, gl, scene } = useThree();

  // 把 setup 暴露到 ref，供 CameraDebugger 读取模型尺寸与基础距离
  const setupRef = useRef<{ scaledSize: THREE.Vector3; distance: number } | null>(null);

  // 烟雾纹理：useTexture 同步加载，sRGB 保证颜色正确
  const smokeTexture = useTexture(SMOKE_TEXTURE_URL);
  useEffect(() => {
    if (smokeTexture) {
      smokeTexture.colorSpace = THREE.SRGBColorSpace;
      // 烟雾边缘柔和，关闭 mip 偏移避免闪烁
      smokeTexture.minFilter = THREE.LinearFilter;
    }
  }, [smokeTexture]);

  // 前后两层烟雾的 group 引用：位置由下方 useFrame 动态更新
  // 前层 = 镜头与电脑之间（靠近相机）；后层 = 电脑背向相机一侧
  const frontSmokeRef = useRef<THREE.Group>(null);
  const backSmokeRef = useRef<THREE.Group>(null);

  // 电脑正上方的聚光灯引用：位置由 useFrame 微微随机晃动
  const spotLightRef = useRef<THREE.SpotLight>(null);
  const spotTargetRef = useRef<THREE.Object3D>(null);

  // 加载模型，useGLTF 内部已配置 Draco
  const { scene: modelScene } = useGLTF(MODEL_URL) as unknown as {
    scene: THREE.Group;
  };

  // 计算包围盒、缩放、相机距离 —— 仅在模型加载后执行一次
  const setup = useMemo(() => {
    if (!modelScene) return null;

    // 计算模型包围盒
    const box = new THREE.Box3().setFromObject(modelScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // 统一缩放到目标尺寸（约 12 个单位，让模型填满更多画面）
    const targetSize = 12;
    const scale = targetSize / maxDim;
    modelScene.scale.setScalar(scale);
    // 居中：抵消中心偏移
    modelScene.position.x = -center.x * scale;
    modelScene.position.y = -center.y * scale;
    modelScene.position.z = -center.z * scale;

    // 计算缩放后的尺寸
    const scaledSize = size.clone().multiplyScalar(scale);
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);

    // 基于 FOV 和模型尺寸计算合适的相机距离（乘数小一点让模型更大）
    const distX = (scaledSize.x / 2) / Math.tan(fov / 2) + scaledSize.z / 2;
    const distY = (scaledSize.y / 2) / Math.tan(fov / 2) + scaledSize.x / 2;
    const distZ = (scaledSize.z / 2) / Math.tan(fov / 2) + scaledSize.x / 2;
    const distance = Math.max(distX, distY, distZ) * 0.6;

    // 同步到 ref（供 CameraDebugger 使用）
    setupRef.current = { scaledSize, distance };

    // === 屏幕位置自动分析（调试用）===
    // 遍历 computer 节点的几何，按法线聚类找平面，输出候选屏幕区域
    analyzeScreenGeometry(modelScene, scale, center);

    return { scaledSize, distance };
  }, [modelScene, camera]);

  // 模型加载完成后触发回调并设置环境贴图
  useEffect(() => {
    if (!modelScene || !setup) return;

    // 环境贴图（让金属/玻璃材质有反射）
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();

    // 程序化环境场景：仅保留极暗环境球用于材质反射，不再放置任何光源
    const envScene = new THREE.Scene();
    const envGeo = new THREE.SphereGeometry(50, 32, 32);
    const envMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      color: 0x141418,
    });
    envScene.add(new THREE.Mesh(envGeo, envMat));

    const envTexture = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = envTexture;

    pmrem.dispose();

    // 设置初始相机位置（基于 CAMERA_CONFIG 参数计算）
    // target 的世界坐标（用于相机偏移基准点）
    const targetX = setup.scaledSize.x * CAMERA_CONFIG.lookAtX;
    const targetZ = setup.scaledSize.z * CAMERA_CONFIG.lookAtZ;
    const targetYWorld = setup.scaledSize.y * CAMERA_CONFIG.lookAtY;

    const camPos = computeCameraPosition(setup.distance, setup.scaledSize, targetX, targetZ);
    camera.position.set(camPos.x, camPos.y, camPos.z);
    camera.lookAt(targetX, targetYWorld, targetZ);

    // 应用 FOV 配置（覆盖 Canvas 默认的 fov）
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = CAMERA_CONFIG.fov;
    cam.updateProjectionMatrix();

    // 通知外部已加载
    onLoaded();
  }, [modelScene, setup, gl, scene, camera, onLoaded]);

  // 关联聚光灯与其目标点：spotLight.target 默认指向场景原点的新 Object3D，
  // 必须手动替换为 spotTargetRef 指向的 object3D，光锥才会朝向 useFrame 里设置的目标
  useEffect(() => {
    if (spotLightRef.current && spotTargetRef.current) {
      spotLightRef.current.target = spotTargetRef.current;
    }
  }, []);

  // 每帧更新：非 DEBUG 模式下按 CAMERA_CONFIG 固定相机；DEBUG 模式下让 OrbitControls 接管
  useFrame(() => {
    if (!setup) return;
    // DEBUG 模式：跳过固定相机控制，让 OrbitControls 自由操作
    if (DEBUG) return;

    const { distance, scaledSize } = setup;

    // 计算 target 世界坐标（相机看向的点）
    const targetX = scaledSize.x * CAMERA_CONFIG.lookAtX;
    const targetYWorld = scaledSize.y * CAMERA_CONFIG.lookAtY;
    const targetZ = scaledSize.z * CAMERA_CONFIG.lookAtZ;

    // 计算 3D 空间位置：水平 yaw + 俯仰 pitch → 球坐标转笛卡尔
    const camPos = computeCameraPosition(distance, scaledSize, targetX, targetZ);
    camera.position.set(camPos.x, camPos.y, camPos.z);
    // 看向 target（支持 PAN 后的非原点视角）
    camera.lookAt(targetX, targetYWorld, targetZ);

    // 模型不旋转（保持静止，让用户能看清电脑细节）
  });

  // 每帧更新两层烟雾位置 + 聚光灯晃动
  // 独立于上方 useFrame，确保 DEBUG 模式（OrbitControls 接管）下也能正确跟随
  useFrame((state) => {
    if (!setup) return;
    const { scaledSize } = setup;

    // target 世界坐标（电脑所在位置）
    const targetX = scaledSize.x * CAMERA_CONFIG.lookAtX;
    const targetY = scaledSize.y * CAMERA_CONFIG.lookAtY;
    const targetZ = scaledSize.z * CAMERA_CONFIG.lookAtZ;

    // 相机 → target 的方向向量（归一化）
    const dirX = targetX - camera.position.x;
    const dirY = targetY - camera.position.y;
    const dirZ = targetZ - camera.position.z;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
    const ux = dirX / dirLen;
    const uy = dirY / dirLen;
    const uz = dirZ / dirLen;

    // 前层：相机前方一点（镜头与电脑之间，靠近相机，不进入电脑内部）
    const frontDist = Math.min(dirLen * 0.35, 1.2);
    if (frontSmokeRef.current) {
      frontSmokeRef.current.position.set(
        camera.position.x + ux * frontDist,
        camera.position.y + uy * frontDist,
        camera.position.z + uz * frontDist
      );
    }

    // 后层：电脑背向相机的一侧（沿 -dir 方向偏移，远离电脑本体，避免穿模）
    const backDist = scaledSize.z * 0.5 + 1.8;
    if (backSmokeRef.current) {
      backSmokeRef.current.position.set(
        targetX - ux * backDist,
        targetY - uy * backDist * 0.3,
        targetZ - uz * backDist
      );
    }

    // 聚光灯：位于电脑正上方，微微随机晃动（位置 + 目标点双频正弦扰动）
    // 晃动幅度小（0.25），频率低，模拟吊灯轻微摆动
    const time = state.clock.elapsedTime;
    const wobbleX = Math.sin(time * 0.7) * 0.25 + Math.sin(time * 1.3) * 0.12;
    const wobbleZ = Math.cos(time * 0.6) * 0.25 + Math.cos(time * 1.1) * 0.12;
    // 灯具高度：电脑上方约 1.5 个模型高度
    const lightHeight = targetY + scaledSize.y * 1.5 + 3;
    if (spotLightRef.current) {
      spotLightRef.current.position.set(
        targetX + wobbleX,
        lightHeight,
        targetZ + wobbleZ
      );
    }
    // 目标点也微微偏移，让光锥方向轻微摆动（更自然）
    if (spotTargetRef.current) {
      spotTargetRef.current.position.set(
        targetX + wobbleX * 0.4,
        targetY,
        targetZ + wobbleZ * 0.4
      );
      spotTargetRef.current.updateMatrixWorld();
    }
  });

  if (!modelScene || !setup) return null;

  // DEBUG 模式下计算完整的初始相机状态（与 CAMERA_CONFIG 一致）
  const lookAtXWorld = setup.scaledSize.x * CAMERA_CONFIG.lookAtX;
  const lookAtYWorld = setup.scaledSize.y * CAMERA_CONFIG.lookAtY;
  const lookAtZWorld = setup.scaledSize.z * CAMERA_CONFIG.lookAtZ;
  const initialCamPos = computeCameraPosition(
    setup.distance,
    setup.scaledSize,
    lookAtXWorld,
    lookAtZWorld
  );

  return (
    <>
      {/* 唯一光源：电脑正上方聚光灯，位置与目标点由 useFrame 微微随机晃动 */}
      <spotLight
        ref={spotLightRef}
        color="#fff4e0"
        intensity={5}
        distance={50}
        angle={0.55}
        penumbra={0.5}
        decay={1.4}
        castShadow
      />
      {/* 聚光灯目标点（必须挂到场景里才会生效） */}
      <object3D ref={spotTargetRef} />

      {/* 模型本体 */}
      <primitive object={modelScene} />

      {/* 电脑屏幕：显示 GIF 动画，自发光效果；世界坐标定位 */}
      <ScreenDisplay />

      {/* 飘动烟雾：前层（镜头与电脑之间，靠近相机）*/}
      <group ref={frontSmokeRef}>
        <SmokeLayer
          texture={smokeTexture}
          count={10}
          areaSize={2.8}
          spriteSize={1.6}
          opacity={0.18}
          color="#8a92a8"
          brightness={1}
        />
      </group>

      {/* 飘动烟雾：后层（电脑背向相机一侧，不进入电脑内部避免穿模）*/}
      <group ref={backSmokeRef}>
        <SmokeLayer
          texture={smokeTexture}
          count={12}
          areaSize={4.2}
          spriteSize={2.0}
          opacity={0.14}
          color="#6a7088"
          brightness={0.75}
        />
      </group>

      {/* 相机控制器：DEBUG 模式下启用完全自由的 OrbitControls（旋转+平移+缩放） */}
      {DEBUG && (
        <CameraDebugger
          setupRef={setupRef}
          initialCameraPos={[initialCamPos.x, initialCamPos.y, initialCamPos.z]}
          lookAtX={lookAtXWorld}
          lookAtY={lookAtYWorld}
          lookAtZ={lookAtZWorld}
          fov={CAMERA_CONFIG.fov}
          showPanel
        />
      )}
    </>
  );
}

// 预加载模型，加速首次访问
useGLTF.preload(MODEL_URL);
