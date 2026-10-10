import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { parseGIF, decompressFrames, type GifFrame } from 'gifuct-js';
import { CameraDebugger } from './CameraDebugger';
import { bootStore, registerBootAsset } from '../boot/bootStore';
import { BOOT_COMMON_GLSL, bootLineMetaUniform, getBootTextures } from '../boot/bootShader';

/**
 * 初始化 RectAreaLight 所需的着色器 uniform
 *
 * 功能：RectAreaLight 必须在首次渲染前调用 init()，否则光照计算会用默认 uniform，
 *      导致屏幕面光源无法照亮周围物体（物体表面一片黑）。
 *
 * 注意事项：全局只需调用一次，放模块顶层确保在组件渲染前执行。
 */
RectAreaLightUniformsLib.init();

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
 *  - emissiveIntensity：自发光强度，越大越亮
 *  - rectLight*：RectAreaLight 面光源参数，让屏幕真正照亮周围环境
 *    颜色不是固定值，而是每帧从当前 GIF 帧的 ImageData 实时采样平均颜色，
 *    这样红色 GIF 照红光、蓝色 GIF 照蓝光，真实反映屏幕内容
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
  emissiveIntensity: 1.3,  // 自发光强度
  // RectAreaLight 面光源：让屏幕真实照亮电脑外壳/烟雾等周围物体
  // 颜色每帧从 GIF 当前帧的 ImageData 采样平均 RGB，强度按平均亮度缩放
  rectLightIntensity: 10.0,      // 基础强度（cd），实际 = 基础强度 × (0.4 + 0.6 × 亮度)
  rectLightSampleStep: 4,       // 颜色采样步长（每 N 个像素采一个，平衡精度与性能）
};

/**
 * 屏幕故障/CRT 效果配置（ScreenDisplay 的 ShaderMaterial 使用）
 *
 * 功能：集中控制屏幕 GIF 显示层的 glitch 与 CRT 复古效果参数
 *
 * 分组说明：
 *  - Glitch（间歇故障）：
 *    - baseSplit       常态 RGB 色散底噪（UV 偏移），极轻，让屏幕"活着"
 *    - burst*          低强度小抽：每 0.8~1.5s 发作一次、持续 0.05~0.12s（一闪而过），
 *                      峰值包络 0.35~0.65（1 = 切 GIF 大故障的强度）
 *    - tear*           行撕裂：24 条候选行里每次只随机激活少数几行（平静期 2~3 行、
 *                      峰值最多 ~5 行），激活位置每 ~60ms 重掷，在屏幕上游走
 *    - switchDuration  切 GIF 时的大故障时长：把画面切换藏进故障里当转场
 *  - CRT（常态复古质感）：
 *    - scanCount/Strength  扫描线：屏幕空间细密暗线，跟随玻璃而非内容
 *    - vignetteStrength    边缘暗角：CRT 四周变暗
 *    - flickerStrength     亮度微闪：双频正弦低频呼吸
 *    - barrelAmount        桶形弯曲：采样坐标向中心收拢（只内收不出界），
 *                          内容呈现在外凸玻璃上的观感
 */
const SCREEN_FX_CONFIG = {
  // --- Glitch：常态底噪 + 每秒级低强度发作 + 切 GIF 大故障 ---
  baseSplit: 0.0012,          // 常态 RGB 色散（UV 偏移）
  burstMinInterval: 0.8,      // 小抽最小间隔（秒）
  burstMaxInterval: 1.5,      // 小抽最大间隔（秒）
  burstMinDuration: 0.05,     // 单次小抽最短时长（秒）
  burstMaxDuration: 0.12,     // 单次小抽最长时长（秒）
  burstPeakMin: 0.35,         // 小抽峰值包络下限（0~1）
  burstPeakMax: 0.65,         // 小抽峰值包络上限
  glitchMaxDisp: 0.012,       // 发作峰值时的最大行撕裂位移（UV）
  glitchMaxSplit: 0.008,      // 发作峰值时的最大 RGB 分离增量
  tearBands: 24,              // 行撕裂候选行数（同时只激活其中少数几行）
  tearActiveCalm: 0.07,       // 低包络期的激活比例（≈24 行中的 1~2 行）
  tearActivePeak: 0.2,        // 峰值包络的激活比例（≈24 行中的 4~5 行）
  switchDuration: 0.35,       // 切 GIF 大故障时长（秒）
  // --- CRT ---
  scanCount: 64,              // 扫描线对数
  scanStrength: 0.15,         // 扫描线强度（暗线压低幅度）
  vignetteStrength: 0.35,     // 边缘暗角强度
  flickerStrength: 0.035,     // 亮度微闪幅度
  barrelAmount: 0.32,         // 桶形弯曲（角部最大收拢比例 ≈ 该值 × 0.5）
};

/**
 * 调试模式开关
 *
 * 功能：开启后启用 OrbitControls 自由视角 + 信息面板 + FOV 滑块
 *       关闭后使用 CAMERA_CONFIG 静态参数控制相机
 *
 * 注意事项：发布前请设为 false
 */
const DEBUG = false;

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
 *  - parallaxYawDeg   鼠标视差水平旋转幅度（°）。鼠标移到屏幕左右边缘时相机绕 target 旋转的角度
 *  - parallaxPitchDeg 鼠标视差俯仰旋转幅度（°）。鼠标移到屏幕上下边缘时相机绕 target 旋转的角度
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
  parallaxYawDeg: 3.0,   // 鼠标视差水平幅度（°），鼠标到边缘时绕 target 旋转 ±3°
  parallaxPitchDeg: 2.0, // 鼠标视差俯仰幅度（°），鼠标到边缘时绕 target 旋转 ±2°
};

/**
 * 入场动画配置
 *
 * 功能：加载完成后相机从"屏幕特写位置"动画过渡到"默认相机位置"
 *      模拟 shader.se 首屏那种"从屏幕特写缓缓拉远到全景"的入场感
 *
 * 字段说明：
 *  - START_CAMERA_DISTANCE  起始相机距屏幕中心的距离（世界单位）
 *  - START_FOV              起始相机视野（°），小于默认 fov 让屏幕显得更大
 *  - DURATION               动画持续时间（秒）
 */
const INTRO_CONFIG = {
  START_CAMERA_DISTANCE: 0.6,  // 起始相机距屏幕的距离（沿屏幕法线往前推）
  START_FOV: 25,               // 起始 FOV（比默认 41° 小，让屏幕特写显得更大）
  DURATION: 3.0,               // 入场动画持续时间（秒）
};

/**
 * 滚动驱动相机推入配置
 *
 * 功能：用户向下滚动时，相机从"默认全景位置"沿屏幕法线方向推进，
 *      最终穿过屏幕到达屏幕背面（"推进到屏幕里面"），呈现潜入屏幕内部的电影感
 *
 * 字段说明：
 *  - END_CAMERA_OFFSET   滚动到底时相机相对屏幕中心的偏移（沿法线方向，单位世界单位）
 *                        负值 = 沿法线反方向 = 穿过屏幕到背面
 *                        -0.25 表示相机停在屏幕后方 0.25 单位，屏幕 GIF 充满视野
 *  - END_FOV             滚动到底时的 FOV（°），比默认大，营造广角潜入的拉伸感
 *  - EASE_POWER          缓动指数：>1 = 前期慢后期快（推入加速），<1 = 前期快后期慢
 */
const SCROLL_PUSH_CONFIG = {
  END_CAMERA_OFFSET: -0.25,  // 终点相机 = 屏幕中心 + 法线 × (-0.25) = 屏幕背面 0.25 单位处
  END_FOV: 55,               // 终点 FOV 55°（默认 41°），广角拉伸增强潜入感
  EASE_POWER: 1.6,           // 缓动指数：1.6 让推入前期稍慢、后期加速，像"扎进去"
};

/** 屏幕法线方向（已归一化）
 * 来源：SCREEN_CONFIG 注释 "法线(-0.6,0,0.8)"，length = sqrt(0.36+0.64) = 1.0
 */
const SCREEN_NORMAL = { x: -0.6, y: 0, z: 0.8 };

/** 屏幕中心世界坐标（供 App 初始化 DOF 焦点、避免首帧焦距从错误值收敛） */
export const SCREEN_CENTER = new THREE.Vector3(
  SCREEN_CONFIG.posX,
  SCREEN_CONFIG.posY,
  SCREEN_CONFIG.posZ
);

/** 模型缓存：跨 hash 路由往返复用同一份 Group（useGLTF 缓存的行为等价物） */
const modelCache = new Map<string, THREE.Group>();
/** in-flight 加载共享：StrictMode 双挂载/快速重挂载不触发二次下载 */
let modelInflight: Promise<THREE.Group> | null = null;
/** 字节进度出口：xhr 回调 → 当前挂载的 boot 资产句柄 */
let modelProgressSink: ((p: number) => void) | null = null;

/**
 * 加载 computer.glb（Draco），带字节级进度出口
 *
 * 功能：手动驱动 GLTFLoader（不再走 useGLTF/suspense），换取 xhr.onProgress
 *      字节进度——boot 进度条前半段的真实信号源；结果与 in-flight promise
 *      均模块级缓存，重挂载零成本
 */
function loadModelScene(): Promise<THREE.Group> {
  const cached = modelCache.get(MODEL_URL);
  if (cached) return Promise.resolve(cached);
  if (!modelInflight) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_DECODER_PATH);
    loader.setDRACOLoader(draco);
    modelInflight = new Promise<THREE.Group>((resolve, reject) => {
      loader.load(
        MODEL_URL,
        (gltf) => {
          modelCache.set(MODEL_URL, gltf.scene);
          resolve(gltf.scene);
        },
        (xhr) => {
          if (xhr.total > 0) modelProgressSink?.(Math.min(1, xhr.loaded / xhr.total));
        },
        reject
      );
    });
  }
  return modelInflight;
}

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
      driftSpeed: 0.12 + Math.random() * 0.2,
      // 飘动幅度（压小，让烟雾"原地氤氲"而不是大范围漂移）
      driftAmp: 0.12 + Math.random() * 0.22,
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

/**
 * 自发光尘埃粒子（Points 批渲染 + 自定义着色器）
 *
 * 功能：单次绘制调用渲染全部尘埃。每颗粒子的运动/生灭/汇聚全部在顶点着色器内
 *      由（种子属性, 时间, 滚动进度）计算——位置是状态的纯函数，滚动回退时
 *      粒子会自然逆向散开，不存在"聚过去回不来"的穿帮。
 *
 * 观感设计（对应视觉诊断的三个短板）：
 *  - 幂律分布：pow(seed, 2.6) 决定尺寸——少数亮大颗 + 多数暗细尘，自然的尘埃层次
 *  - 双频漂移：每轴两个不可通约频率的正弦叠加，消除单频正弦的"荡秋千"循环感
 *  - 生灭循环：每颗粒子按 5~11s 的独立生命周期淡入→亮→淡出（透明度包络），
 *    粒子永远在轮替，没有"永远在场的同一批"
 *
 * 场景联动（"活粒子"的两条通道）：
 *  - 屏幕色温：粒子颜色实时混入屏幕 GIF 采样色（与 RectAreaLight/焦散灯同一数据源），
 *    红屏时尘埃泛红——尘埃属于这个场景，而不是贴上去的贴片
 *  - 滚动汇聚：滚动推进时粒子向屏幕中心收拢、亮度抬升，穿屏前一刻尘埃
 *    密集汇聚在屏幕前（无旋转，纯收拢——旋转版实测读感偏"搅拌"已移除）
 *
 * 可访问性：prefers-reduced-motion 时冻结自治运动（漂移/生灭/闪烁），
 *          仅保留滚动驱动的汇聚（用户主动输入，非自主动画）
 */
const GLOW_VERT = /* glsl */ `
  uniform float uWarp;        // 加速变形时间（滚动越快流速越快，JS 侧累积避免跳变）
  uniform float uScroll;      // 平滑滚动进度 0~1
  uniform float uScale;       // 点尺寸换算系数（视口高 × DPR × 投影系数）
  uniform float uSize;        // 基础粒子尺寸（世界单位）
  uniform float uOpacity;     // 峰值不透明度
  uniform vec3 uBaseColor;    // 基础暖色
  uniform vec3 uScreenColor;  // 屏幕 GIF 采样色（场景联动）
  uniform vec3 uSwirlCenter;  // 汇聚中心（屏幕中心，本粒子系局部坐标）
  attribute vec4 aRand;       // 种子：x 尺寸幂律 y 冷暖混色 z 相位 w 生命周期
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float rSize = aRand.x, rMix = aRand.y, rPhase = aRand.z, rLife = aRand.w;

    // --- 双频漂移（两组不可通约频率，循环感消除） ---
    float f1 = 0.8 + rPhase * 0.5;
    float f2 = 1.1 + rLife * 0.7;
    float ph = rPhase * 6.2831;
    vec3 drift = vec3(
      sin(uWarp * 0.55 * f1 + ph) + 0.5 * sin(uWarp * 1.7 * f2 + ph * 1.7),
      sin(uWarp * 0.42 * f2 + ph * 1.3) + 0.5 * sin(uWarp * 1.3 * f1 + ph * 2.1),
      cos(uWarp * 0.48 * f1 + ph * 0.7) + 0.5 * cos(uWarp * 1.5 * f2 + ph * 1.1)
    ) * 0.11;
    vec3 pos = position + drift;

    // --- 滚动汇聚：推进时向屏幕中心收缩（无旋转，纯收拢） ---
    // 位置是 (seed, time, scroll) 的纯函数——回滚自然逆向散开
    float conv = smoothstep(0.06, 0.95, uScroll);
    if (conv > 0.001) {
      pos = uSwirlCenter + (pos - uSwirlCenter) * (1.0 - conv * 0.88);
    }

    // --- 生灭循环：5~11s 独立生命周期，两端 18% 区间淡入淡出 ---
    float lifetime = 5.0 + rLife * 6.0;
    float life = fract(uWarp / lifetime + rPhase);
    float env = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.82, 1.0, life));

    // --- 闪烁（低频呼吸，与生灭包络相乘）与汇聚亮度抬升 ---
    float flicker = 0.72 + 0.28 * sin(uWarp * (1.4 + rMix * 1.8) + ph * 2.7);
    vAlpha = env * flicker * uOpacity * (1.0 + conv * 0.9);

    // --- 颜色：基础暖金 → 冷白微混（层次），再混入屏幕采样色（场景联动） ---
    vec3 cool = vec3(0.78, 0.83, 0.92);
    vColor = mix(uBaseColor, cool, rMix * 0.55);
    vColor = mix(vColor, uScreenColor, 0.35);

    // --- 尺寸：幂律分布 + 生命中期微胀 + 吞噬微增，透视衰减 ---
    float sizeRand = 0.35 + pow(rSize, 2.6) * 1.9;
    float size = uSize * sizeRand * (0.85 + env * 0.3) * (1.0 + conv * 0.35);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = max(1.0, size * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const GLOW_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // 亮核 + 光晕双层衰减（钢琴页微尘同款形态：锐利亮核 + 柔和弥散）
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(0.42, 0.0, d);
    float halo = pow(max(0.0, 1.0 - d), 2.6);
    float a = (core * 0.9 + halo * 0.5) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * (0.8 + core * 0.55), a);
    #include <colorspace_fragment>
  }
`;

interface GlowParticlesProps {
  /** 粒子数量（Points 批渲染，几百颗也是一次绘制调用） */
  count?: number;
  /** 粒子在 XYZ 上的扩散范围（世界单位） */
  areaSize?: number;
  /** 单个粒子基础尺寸（世界单位，实际按幂律 0.35~2.25 倍分布） */
  particleSize?: number;
  /** 基础暖色（建议暖金，配合场景暖光） */
  color?: string;
  /** 生命周期内的峰值不透明度 */
  opacity?: number;
  /** 屏幕采样色输出（ScreenDisplay 每帧写入），粒子色温联动用 */
  screenColorRef?: React.MutableRefObject<THREE.Color>;
  /** 平滑滚动进度（0~1），吞噬联动的输入 */
  scrollRef?: React.MutableRefObject<number>;
}

function GlowParticles({
  count = 220,
  areaSize = 2.4,
  particleSize = 0.14,
  color = '#ffd9a0',
  opacity = 0.95,
  screenColorRef,
  scrollRef,
}: GlowParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  // 加速变形时间：JS 侧累积（dt × (1 + 滚动×2.4)），滚动加速平滑无跳变
  const warpRef = useRef(0);
  // prefers-reduced-motion：冻结自治运动（漂移/生灭/闪烁），只留滚动汇聚
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []
  );

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uWarp: { value: 0 },
        uScroll: { value: 0 },
        uScale: { value: 600 },
        uSize: { value: particleSize },
        uBaseColor: { value: new THREE.Color(color) },
        uScreenColor: { value: new THREE.Color('#ffffff') },
        uSwirlCenter: { value: new THREE.Vector3() },
        uOpacity: { value: opacity },
      },
    });
  }, []);   // 故意空依赖：uniform 每帧直写，不随 props 重建（与场景其他组件同策略）

  // 静态几何：初始盒内位置 + 每颗粒子的 4 维随机种子，一次性生成
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const rands = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * areaSize;
      positions[i * 3 + 1] = (Math.random() - 0.5) * areaSize * 0.8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * areaSize;
      rands[i * 4] = Math.random();
      rands[i * 4 + 1] = Math.random();
      rands[i * 4 + 2] = Math.random();
      rands[i * 4 + 3] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rands, 4));
    return geo;
  }, [count, areaSize]);

  // 卸载时释放 GPU 资源
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  const swirlWorld = useMemo(() => new THREE.Vector3(), []);
  const selfWorld = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const u = material.uniforms;
    const scroll = scrollRef?.current ?? 0;
    // 变形时间：滚动越深流速越快（吞噬的"卷入加速"感）；减少动效时冻结自治运动
    warpRef.current += reducedMotion ? 0 : Math.min(dt, 0.05) * (1 + scroll * 2.4);
    u.uWarp.value = warpRef.current;
    u.uScroll.value = scroll;
    // 点尺寸换算：视口高 × DPR × 0.5（透视除法前的标准换算）
    u.uScale.value = state.size.height * state.viewport.dpr * 0.5;
    // 屏幕采样色联动（同一数据源照亮着环境）
    if (screenColorRef) u.uScreenColor.value.copy(screenColorRef.current);
    // 汇聚中心 = 屏幕中心（世界）换算到粒子系局部（粒子系挂在电脑中心）
    if (pointsRef.current) {
      pointsRef.current.getWorldPosition(selfWorld);
      swirlWorld.copy(SCREEN_CENTER).sub(selfWorld);
      u.uSwirlCenter.value.copy(swirlWorld);
    }
  });

  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
  );
}

/**
 * 程序化焦散纹理（Worley F2-F1 边缘光，平铺无缝）
 *
 * 功能：在内存中生成一张 256×256 的水纹焦散贴图——每个纹素算 Worley 噪声的
 *      F2-F1（第二近/最近特征点距离差），差值越小越靠近 cell 边界，
 *      边界处提亮成细亮线，就是"光穿过波动介质投下的网纹"的经典近似。
 *
 * 返回值：THREE.CanvasTexture（RepeatWrapping，可直接当 SpotLight.map 用）
 *
 * 注意事项：
 *  - 特征点距离按 3×3 环绕计算（dx=min(dx,1-dx)），纹理四边无缝平铺
 *  - 只生成一次（useMemo 缓存）；两盏焦散灯各自 clone 出独立纹理实例，
 *    这样 UV offset 漂移互不干扰（共享同一实例会让两盏灯纹路同步滑动）
 */
function createCausticsCanvas(): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  // 24 个特征点：足够密出细网纹，又不会让 256² 的逐像素计算明显卡顿
  const PTS = 24;
  const px = new Float32Array(PTS);
  const py = new Float32Array(PTS);
  for (let i = 0; i < PTS; i++) {
    px[i] = Math.random();
    py[i] = Math.random();
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let f1 = 8.0;
      let f2 = 8.0;
      for (let i = 0; i < PTS; i++) {
        let dx = Math.abs(u - px[i]);
        dx = Math.min(dx, 1 - dx); // X 环绕
        let dy = Math.abs(v - py[i]);
        dy = Math.min(dy, 1 - dy); // Y 环绕
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
      // F2-F1 小 = 靠近两个 cell 的交界 → 提亮成焦散亮线
      const edge = Math.max(0, 1 - (f2 - f1) * 6.5);
      const b = Math.min(1, Math.pow(edge, 3.2));
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.round(b * 255);
      img.data[idx + 1] = Math.round(b * 255);
      img.data[idx + 2] = Math.round(b * 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 由焦散 canvas 建一张可平铺的 SpotLight gobo 纹理 */
function createCausticsTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // gobo 在光照线性空间里做乘法，不做 sRGB 转换
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

interface ComputerSceneProps {
  /** 滚动进度 0~1，驱动相机与模型动画 */
  scrollProgress: number;
  /** 鼠标归一化坐标 ref（-1~1），驱动相机绕 target 做小角度视差旋转 */
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  /** DOF 焦点目标（本组件每帧写入：鼠标指向表面的代理命中点），供 PostProcessing 读 */
  focusRef?: React.MutableRefObject<THREE.Vector3>;
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
 *  - yawDeg       {number} 可选，覆盖 CAMERA_CONFIG.yawDeg（用于鼠标视差偏移）
 *  - pitchDeg     {number} 可选，覆盖 CAMERA_CONFIG.pitchDeg（用于鼠标视差偏移）
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
 *  - yawDeg/pitchDeg 不传时用 CAMERA_CONFIG 默认值，传入时用于叠加鼠标视差
 */
function computeCameraPosition(
  baseDistance: number,
  scaledSize: THREE.Vector3,
  targetX: number,
  targetZ: number,
  yawDeg?: number,
  pitchDeg?: number
): { x: number; y: number; z: number } {
  const yawRad = ((yawDeg ?? CAMERA_CONFIG.yawDeg) * Math.PI) / 180;
  const pitchRad = ((pitchDeg ?? CAMERA_CONFIG.pitchDeg) * Math.PI) / 180;
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
 * 带进度回调的 ArrayBuffer 下载（Content-Length 流式计数）
 *
 * 功能：fetch 流式读取，按已读字节/总字节回调 0~1；无 Content-Length 或
 *      无流式 body 时直接读完并回调 1——boot 进度条的真实信号源之一
 */
async function fetchArrayBufferTracked(
  url: string,
  onProgress?: (p: number) => void
): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  const total = Number(resp.headers.get('content-length') || 0);
  if (!resp.body || total <= 0) {
    onProgress?.(1);
    return resp.arrayBuffer();
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded / total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
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
 *  - onProgress {(p:number)=>void} 可选下载进度回调（0~1，喂 boot 进度条）
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
async function loadGif(url: string, onProgress?: (p: number) => void): Promise<GifAsset> {
  const buffer = await fetchArrayBufferTracked(url, onProgress);
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

/** 屏幕显示顶点着色器：标准 pass-through，仅传递 UV */
const SCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 屏幕显示片段着色器：GIF 内容 + Glitch + CRT 复古效果
 *
 * 处理顺序（后一步叠在前一步之上）：
 *  1. 桶形弯曲：采样坐标向中心收拢（只内收不外扩，永不越界采样），
 *     内容呈现在外凸玻璃上的观感；弯曲作用于"内容"层
 *  2. 行撕裂：屏幕空间分 24 条候选行，同一时刻只随机激活少数几行
 *     （低包络 ~2 行 / 峰值 ~5 行），激活位置每 ~60ms 重掷一次，
 *     撕裂带在屏幕上游走而不是整屏错位；撕裂/噪点带属于"玻璃"层，
 *     用原始 vUv 计算
 *  3. RGB 色散：常态极轻底噪 + 发作时按包络平方增强（R 左移 / B 右移）
 *  4. 噪点带：发作时随机 1 行闪现静态噪声，位置同样随 tick 跳变
 *  5. 扫描线：屏幕空间正弦暗线（跟随玻璃而非内容，穿屏特写时随屏幕自然放大）
 *  6. 微闪 + 增益：JS 侧双频正弦传入的带符号闪量 × 亮度增益（对齐原 emissiveIntensity）
 *  7. 边缘暗角：径向 smoothstep 压暗四周
 *
 * uniforms 与 JS 侧的对应（ScreenDisplay 的 useFrame 每帧驱动）：
 *  - uGlitch  发作包络 0~1（小抽 0.35~0.65 / 切 GIF 到 1），JS 侧调度
 *  - uSeed    每次发作更换，让撕裂带位置跳变、不重复
 *  - uFlicker 带符号微闪量（JS 双频正弦 × 强度），reduced-motion 时为 0
 */
const SCREEN_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uGlitch;
  uniform float uSeed;
  uniform float uBrightness;
  uniform float uFlicker;
  uniform float uScanCount;
  uniform float uScanStrength;
  uniform float uVignette;
  uniform float uBarrel;
  uniform float uBaseSplit;
  uniform float uMaxDisp;
  uniform float uMaxSplit;
  uniform float uTearBands;
  uniform float uTearActiveCalm;
  uniform float uTearActivePeak;
  // === boot 屏内容（加载期显示器同步显示 boot 画面，显现期切回 GIF） ===
  uniform sampler2D uBootFont;
  uniform sampler2D uBootTest;
  uniform vec2 uBootTextSize;
  uniform float uBootGlyphCount;
  uniform vec4 uLineMeta[4];
  uniform float uBootMix;
  uniform float uBootProgress;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

${BOOT_COMMON_GLSL}

  void main() {
    // 1. 桶形弯曲：坐标向中心收拢（角部 r2≈0.5，收拢比例 = uBarrel × r2）
    vec2 c = vUv - 0.5;
    float r2 = dot(c, c);
    vec2 suv = vUv - c * (uBarrel * r2);

    // 2. 行撕裂：候选行按哈希阈值激活——阈值随包络从 calm 升到 peak，
    //    同一时刻只有少数几行错位；tick 每 ~62ms 步进一次并参与哈希，
    //    让激活的行在发作期间不断跳到新位置（"信号干扰游走"而非固定错位）
    float env = uGlitch;
    if (env > 0.001) {
      float tick = floor(uTime * 16.0);
      float bandId = floor(vUv.y * uTearBands);
      float activeFrac = mix(uTearActiveCalm, uTearActivePeak, env);
      float sel = hash(vec2(bandId, uSeed + tick));
      if (sel > 1.0 - activeFrac) {
        float amp = hash(vec2(bandId + 31.7, uSeed + tick));
        float disp = (amp - 0.5) * 2.0 * uMaxDisp * env;
        if (amp > 0.85) disp *= 2.2;  // 偶发"热行"位移加倍
        suv.x += disp;
      }
    }

    // 3. RGB 色散：常态底噪 + 发作增强（平方让平静期几乎无感）
    float split = uBaseSplit + env * env * uMaxSplit;
    float r = texture2D(uMap, suv + vec2(split, 0.0)).r;
    float g = texture2D(uMap, suv).g;
    float b = texture2D(uMap, suv - vec2(split, 0.0)).b;
    float a = texture2D(uMap, suv).a;
    vec3 color = vec3(r, g, b);

    // 4. 噪点带：发作时平均只有 1 行闪现静态噪声（40 行 × 2.5% 阈值）
    if (env > 0.001 && hash(vec2(floor(vUv.y * 40.0), uSeed + floor(uTime * 16.0) + 7.0)) > 0.975) {
      float n = hash(vUv * 271.0 + uSeed + floor(uTime * 24.0));
      color = mix(color, vec3(n), env * 0.55);
    }

    // 5. 扫描线：屏幕空间暗线（玻璃层）
    float scan = 0.5 + 0.5 * sin(vUv.y * uScanCount * 6.28318);
    color *= 1.0 - uScanStrength * scan;

    // 6. 微闪 + 增益
    color *= uBrightness * (1.0 + uFlicker);

    // 7. 边缘暗角
    color *= 1.0 - uVignette * smoothstep(0.36, 0.72, length(c));

    // 8. boot 屏内容混合：uBootMix=1 时显示器显示 boot 画面（BIOS 蓝 + 进度条），
    //    随显现弹簧 smoothstep(0.05~0.55) 切回 GIF；虚拟分辨率 720x550
    //    （网格 1.8 宽高比 contain 进显示器 1.31 宽高比，上下留蓝边）
    {
      vec3 bootCol = bootContent(vUv, vec2(720.0, 550.0), uBootProgress);
      color = mix(color, bootCol * uBrightness, uBootMix);
    }

    gl_FragColor = vec4(color, a);
    #include <colorspace_fragment>
  }
`;

/**
 * 屏幕显示组件
 *
 * 功能：
 *  - 用 gifuct-js 解析 4 个 GIF 文件，预合成每一帧的 ImageData
 *  - 用 canvas 中转：每帧按 elapsed time 计算当前帧索引，putImageData 到 canvas
 *  - 用 CanvasTexture 作为自发光纹理（原 emissiveMap，现 ShaderMaterial 的 uMap），
 *    让屏幕"自发光"（不受场景光照压暗）
 *  - 自定义 ShaderMaterial 在 GPU 上叠加 glitch 与 CRT 效果：常态轻 RGB 色散
 *    + 每秒级低强度撕裂小抽 + 切 GIF 大故障转场；扫描线/暗角/微闪/桶形弯曲
 *    常驻。时间包络在 useFrame 驱动，空间图案在片段着色器计算，
 *    参数集中在 SCREEN_FX_CONFIG；reduced-motion 时冻结自治动效
 *  - 当前 GIF 播完一轮后自动切换到下一个，循环播放全部 4 个 GIF
 *  - 附加 RectAreaLight 面光源，让屏幕真正照亮电脑外壳/烟雾等周围环境
 *    （emissive 只让屏幕自己亮，不发光照别人；RectAreaLight 才是真实光源）
 *    面光源颜色每帧从当前 GIF 帧的 ImageData 实时采样平均 RGB，强度按亮度缩放，
 *    这样屏幕显示什么颜色，环境就被什么颜色照亮（红 GIF 照红光、蓝 GIF 照蓝光）
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
function ScreenDisplay({
  colorRef,
}: {
  /** 可选输出：每帧把 GIF 当前帧采样出的平均色写进去（焦散灯跟随用） */
  colorRef?: React.MutableRefObject<THREE.Color>;
}) {
  // GIF 加载完成标志：所有 GIF 解析完才渲染 mesh
  const [ready, setReady] = useState(false);
  const meshRef = useRef<THREE.Mesh>(null);
  // Glitch 状态机：JS 侧只算时间包络（发作/间隔/种子），空间图案在着色器里
  const glitchRef = useRef({
    nextBurstAt: 0,   // 下一次小抽时刻（秒）
    burstStart: -1,   // 当前小抽起点（-1 = 无）
    burstDur: 0.2,    // 当前小抽时长（秒）
    burstPeak: 0.5,   // 当前小抽峰值（0~1）
    switchStart: -1,  // 切 GIF 大故障起点（-1 = 无）
    seed: 0,          // 撕裂带种子（每次发作更换）
  });
  // prefers-reduced-motion：冻结自治动效（glitch 发作/微闪），静态 CRT 质感保留
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []
  );
  // RectAreaLight 引用：让屏幕真正照亮周围环境（emissive 只让屏幕自己亮，不发光照别人）
  const rectLightRef = useRef<THREE.RectAreaLight>(null);
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

  // 异步加载并解析所有 GIF（每个 GIF 作为独立资产登记进 boot 进度条）
  useEffect(() => {
    let cancelled = false;
    const textures: THREE.CanvasTexture[] = [];
    const canvases: HTMLCanvasElement[] = [];
    const assets: GifAsset[] = [];
    // 4 个 GIF 合计权重 0.3（模型 0.62 / 烟雾 0.08）
    const gifAssets = SCREEN_GIF_URLS.map((_, i) => registerBootAsset(`screen-gif-${i}`, 0.075));

    // 公用 patch canvas（尺寸会按当前 GIF 动态调整）
    const patchCanvas = document.createElement('canvas');
    patchCanvasRef.current = patchCanvas;

    Promise.all(
      SCREEN_GIF_URLS.map(async (url, i) => {
        const asset = await loadGif(url, (p) => gifAssets[i].setProgress(p));
        gifAssets[i].markDone();
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
        // 失败也放行 boot：单资产失败不应把进度条卡死在 loading 阶段
        gifAssets.forEach((a) => a.markDone());
      });

    return () => {
      cancelled = true;
      textures.forEach((t) => t.dispose());
    };
  }, []);

  // 屏幕 ShaderMaterial：GIF 显示 + glitch/CRT 效果（GPU 实时）
  // ready 翻转时（全部 GIF 解析完）构建一次；后续切 GIF 只改 uMap uniform 引用，
  // 不重建材质。uniform 每帧由下方 useFrame 直写，与场景其他组件同策略
  const fxMaterial = useMemo(() => {
    if (!ready) return null;
    const bootTex = getBootTextures();
    return new THREE.ShaderMaterial({
      vertexShader: SCREEN_VERT,
      fragmentShader: SCREEN_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: texturesRef.current[0] },
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uSeed: { value: 0 },
        // 亮度增益对齐原 emissiveIntensity，保证换材质后屏幕亮度/辉光不变
        uBrightness: { value: SCREEN_CONFIG.emissiveIntensity },
        uFlicker: { value: 0 },
        uScanCount: { value: SCREEN_FX_CONFIG.scanCount },
        uScanStrength: { value: SCREEN_FX_CONFIG.scanStrength },
        uVignette: { value: SCREEN_FX_CONFIG.vignetteStrength },
        uBarrel: { value: SCREEN_FX_CONFIG.barrelAmount },
        uBaseSplit: { value: SCREEN_FX_CONFIG.baseSplit },
        uMaxDisp: { value: SCREEN_FX_CONFIG.glitchMaxDisp },
        uMaxSplit: { value: SCREEN_FX_CONFIG.glitchMaxSplit },
        uTearBands: { value: SCREEN_FX_CONFIG.tearBands },
        uTearActiveCalm: { value: SCREEN_FX_CONFIG.tearActiveCalm },
        uTearActivePeak: { value: SCREEN_FX_CONFIG.tearActivePeak },
        // boot 内容：与 BootPass 共享同一批字体/文本纹理实例
        uBootFont: { value: bootTex.uBootFont.value },
        uBootTest: { value: bootTex.uBootTest.value },
        uBootTextSize: { value: bootTex.uBootTextSize.value.clone() },
        uBootGlyphCount: { value: bootTex.uBootGlyphCount.value },
        uLineMeta: { value: bootLineMetaUniform() },
        uBootMix: { value: 1 },
        uBootProgress: { value: 0 },
      },
    });
  }, [ready]);

  // 卸载时释放材质
  useEffect(() => () => fxMaterial?.dispose(), [fxMaterial]);

  // 每帧：按 elapsed time 计算当前 GIF 的当前帧，putImageData + drawImage 到主 canvas
  useFrame((state) => {
    const assets = assetsRef.current;
    const canvases = canvasesRef.current;
    const textures = texturesRef.current;
    const patchCanvas = patchCanvasRef.current;
    if (assets.length === 0 || !patchCanvas) return;

    const t = state.clock.elapsedTime;
    const currentAsset = assets[idxRef.current];

    // 播完一轮后自动切换到下一个 GIF（不依赖固定秒数）
    if (currentAsset && (t - gifStartRef.current) * 1000 >= currentAsset.totalDurationMs) {
      gifStartRef.current = t;
      idxRef.current = (idxRef.current + 1) % assets.length;
      const tex = textures[idxRef.current];
      if (fxMaterial && tex) {
        // 纹理切换藏进大故障转场：换图被故障爆发遮盖，观感是"信号中断后换了台"
        fxMaterial.uniforms.uMap.value = tex;
        glitchRef.current.switchStart = t;
        glitchRef.current.seed = Math.random() * 100.0;
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

    // 从当前 GIF 帧的 ImageData 实时采样平均颜色，让屏幕光颜色 = GIF 实际显示颜色
    // 红色 GIF 照红光、蓝色 GIF 照蓝光，真实反映屏幕内容
    // 强度按平均亮度缩放：暗帧光照弱（但不完全黑，保底 0.4），亮帧光照强
    if (rectLightRef.current) {
      const frameData = asset.frames[frameIdx].imageData.data;
      const step = SCREEN_CONFIG.rectLightSampleStep * 4; // 步长（像素数 × 4 通道）
      let r = 0, g = 0, b = 0, count = 0;
      for (let p = 0; p < frameData.length; p += step) {
        const a = frameData[p + 3];
        if (a < 10) continue; // 跳过透明像素
        r += frameData[p];
        g += frameData[p + 1];
        b += frameData[p + 2];
        count++;
      }
      if (count > 0) {
        r /= count;
        g /= count;
        b /= count;
        // 人眼亮度公式：0.299R + 0.587G + 0.114B
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        // boot 期混入 BIOS 蓝：显示器显示什么颜色，环境就被什么颜色照亮——
        // 加载期屏幕是蓝屏，面光/焦散灯/粒子色温同步泛蓝（与着色器 uBootMix 同源）
        const bootMix = THREE.MathUtils.smoothstep(1 - bootStore.spring, 0.05, 0.55);
        const mixR = (r / 255) * (1 - bootMix);
        const mixG = (g / 255) * (1 - bootMix);
        const mixB = (b / 255) * (1 - bootMix) + bootMix;
        const mixLum = luminance * (1 - bootMix) + 0.5 * bootMix;
        rectLightRef.current.color.setRGB(mixR, mixG, mixB);
        // 强度 = 基础强度 × (0.4 + 0.6 × 亮度)，保证暗帧也有最低光照
        rectLightRef.current.intensity =
          SCREEN_CONFIG.rectLightIntensity * (0.4 + 0.6 * mixLum);
        // 屏幕焦散灯跟随同一份采样色（红 GIF 投红纹、蓝 GIF 投蓝纹）
        if (colorRef) colorRef.current.setRGB(mixR, mixG, mixB);
      }
    }

    // === Glitch/CRT 驱动：JS 侧只算时间包络，空间图案全部在着色器 ===
    if (fxMaterial) {
      const g = glitchRef.current;
      const u = fxMaterial.uniforms;

      // 间歇小抽：到点触发一次（reduced-motion 不调度，画面保持干净）
      if (!reducedMotion && t >= g.nextBurstAt) {
        g.burstStart = t;
        g.burstDur = SCREEN_FX_CONFIG.burstMinDuration +
          Math.random() * (SCREEN_FX_CONFIG.burstMaxDuration - SCREEN_FX_CONFIG.burstMinDuration);
        g.burstPeak = SCREEN_FX_CONFIG.burstPeakMin +
          Math.random() * (SCREEN_FX_CONFIG.burstPeakMax - SCREEN_FX_CONFIG.burstPeakMin);
        g.seed = Math.random() * 100.0;
        g.nextBurstAt = t + SCREEN_FX_CONFIG.burstMinInterval +
          Math.random() * (SCREEN_FX_CONFIG.burstMaxInterval - SCREEN_FX_CONFIG.burstMinInterval);
      }

      // 包络合成：小抽 = 正弦（缓起缓落）；切 GIF 大故障 = sin^0.4（快起慢落，
      // 确保换纹理那一帧已被故障盖住）；两者同时发作时取最大值
      let env = 0.0;
      if (g.burstStart >= 0) {
        const p = (t - g.burstStart) / g.burstDur;
        if (p >= 0 && p <= 1) env = Math.sin(p * Math.PI) * g.burstPeak;
      }
      if (g.switchStart >= 0) {
        const p = (t - g.switchStart) / SCREEN_FX_CONFIG.switchDuration;
        if (p >= 0 && p <= 1) {
          env = Math.max(env, Math.pow(Math.sin(p * Math.PI), 0.4));
        } else if (p > 1) {
          g.switchStart = -1;
        }
      }

      // 微闪：双频不可通约正弦，消除规律呼吸感
      const flicker = reducedMotion
        ? 0
        : (Math.sin(t * 11.0) * 0.6 + Math.sin(t * 6.3 + 1.7) * 0.4) *
          SCREEN_FX_CONFIG.flickerStrength;

      u.uTime.value = t;
      u.uGlitch.value = reducedMotion ? 0 : env;
      u.uSeed.value = g.seed;
      u.uFlicker.value = flicker;

      // boot 屏内容：加载期显示器显示 boot 画面，显现弹簧前半程切回 GIF
      // （smoothstep(0.05, 0.55, 1-s)，与 shader.se 显示器内容切换同曲线）
      u.uBootMix.value = THREE.MathUtils.smoothstep(1 - bootStore.spring, 0.05, 0.55);
      u.uBootProgress.value = bootStore.displayProgress;
    }
  });

  // GIF 未加载完时不渲染 mesh（fxMaterial 与 ready 同步构建，此处必非空）
  if (!ready || !fxMaterial || texturesRef.current.length === 0) return null;

  return (
    <>
      {/* RectAreaLight 面光源：与屏幕同位置/同旋转/同尺寸，
          让屏幕真正照亮电脑外壳与周围烟雾（emissive 只让屏幕自己亮，不发光照别人）。
          颜色每帧由 useFrame 从 GIF 当前帧采样平均 RGB 写入，此处 color 仅为初始值 */}
      <rectAreaLight
        ref={rectLightRef}
        position={[SCREEN_CONFIG.posX, SCREEN_CONFIG.posY, SCREEN_CONFIG.posZ]}
        rotation={[SCREEN_CONFIG.rotX, SCREEN_CONFIG.rotY, SCREEN_CONFIG.rotZ]}
        width={SCREEN_CONFIG.width}
        height={SCREEN_CONFIG.height}
        color="#ffffff"
        intensity={SCREEN_CONFIG.rectLightIntensity}
      />
      <mesh
        ref={meshRef}
        position={[SCREEN_CONFIG.posX, SCREEN_CONFIG.posY, SCREEN_CONFIG.posZ]}
        rotation={[SCREEN_CONFIG.rotX, SCREEN_CONFIG.rotY, SCREEN_CONFIG.rotZ]}
      >
        <planeGeometry args={[SCREEN_CONFIG.width, SCREEN_CONFIG.height]} />
        <primitive object={fxMaterial} attach="material" />
      </mesh>
    </>
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
export function ComputerScene({ scrollProgress, mouseRef, focusRef }: ComputerSceneProps) {
  // 使用 ref 保存最新的滚动进度，避免每帧触发 React 重渲染
  const progressRef = useRef(scrollProgress);
  progressRef.current = scrollProgress;

  // 鼠标视差平滑值：每帧 lerp 向 mouseRef 靠近，避免相机紧贴鼠标产生生硬感
  // 初始为 {0,0}（屏幕中心），后续会逐渐追随真实鼠标位置
  const mouseSmoothedRef = useRef({ x: 0, y: 0 });

  // 滚动进度平滑值：每帧 lerp 向 props 的 scrollProgress 靠近，
  // 避免滚轮离散跳动让相机产生顿挫感（lerp 系数 0.1 → 轻微惯性）
  const scrollSmoothedRef = useRef(0);

  // 屏幕当前帧平均色（ScreenDisplay 每帧写入，屏幕焦散灯每帧读取跟随）
  const screenColorRef = useRef(new THREE.Color('#ffffff'));

  // 焦散 gobo 纹理：同一张 canvas 出两份实例（useMemo 保证只建一次），
  // 两盏灯的 UV 漂移互不干扰
  const causticsTex = useMemo(() => {
    const canvas = createCausticsCanvas();
    return {
      screen: createCausticsTexture(canvas),
      top: createCausticsTexture(canvas),
    };
  }, []);

  // 焦散灯引用（位置/目标点由 setup 后的 effect 摆放；颜色每帧跟随）
  const screenCausticRef = useRef<THREE.SpotLight>(null);
  const screenCausticTargetRef = useRef<THREE.Object3D>(null);
  const topCausticRef = useRef<THREE.SpotLight>(null);
  const topCausticTargetRef = useRef<THREE.Object3D>(null);

  // DOF 焦点代理（setup 后构建）：屏幕平面精确命中 + 模型包围球兜底
  const proxyRef = useRef<{
    plane: THREE.Plane;
    sphere: THREE.Sphere;
    center: THREE.Vector3;
    screenR2: number;
  } | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerNdcRef = useRef(new THREE.Vector2());
  const focusHitRef = useRef(new THREE.Vector3());

  const { camera, gl, scene } = useThree();

  // 把 setup 暴露到 ref，供 CameraDebugger 读取模型尺寸与基础距离
  const setupRef = useRef<{ scaledSize: THREE.Vector3; distance: number } | null>(null);

  // 烟雾纹理：useTexture 同步加载，sRGB 保证颜色正确
  // （作为 boot 资产登记：解析完成即 markDone——PNG 体量小，粗粒度可接受）
  const smokeTexture = useTexture(SMOKE_TEXTURE_URL);
  useEffect(() => {
    if (smokeTexture) {
      smokeTexture.colorSpace = THREE.SRGBColorSpace;
      // 烟雾边缘柔和，关闭 mip 偏移避免闪烁
      smokeTexture.minFilter = THREE.LinearFilter;
    }
  }, [smokeTexture]);
  const smokeAssetRef = useRef<ReturnType<typeof registerBootAsset> | null>(null);
  if (!smokeAssetRef.current) smokeAssetRef.current = registerBootAsset('smoke', 0.08);
  useEffect(() => {
    if (smokeTexture) smokeAssetRef.current?.markDone();
  }, [smokeTexture]);

  // 前后两层烟雾的 group 引用：位置由下方 useFrame 动态更新
  // 前层 = 镜头与电脑之间（靠近相机）；后层 = 电脑背向相机一侧
  const frontSmokeRef = useRef<THREE.Group>(null);
  const backSmokeRef = useRef<THREE.Group>(null);
  // 自发光粒子 group 引用：位置由 useFrame 跟随电脑中心
  const glowParticlesRef = useRef<THREE.Group>(null);

  // 电脑正上方的聚光灯引用：位置由 useFrame 微微随机晃动
  const spotLightRef = useRef<THREE.SpotLight>(null);
  const spotTargetRef = useRef<THREE.Object3D>(null);

  // 加载模型：手动 GLTFLoader（字节进度喂 boot 进度条），模块级缓存跨挂载复用
  const [modelScene, setModelScene] = useState<THREE.Group | null>(() =>
    modelCache.get(MODEL_URL) ?? null
  );
  useEffect(() => {
    const asset = registerBootAsset('model-glb', 0.62);
    if (modelScene) {
      asset.markDone();
      return;
    }
    modelProgressSink = (p) => asset.setProgress(p);
    let alive = true;
    loadModelScene()
      .then((scene) => {
        if (!alive) return;
        asset.markDone();
        setModelScene(scene);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[ComputerScene] 模型加载失败:', err);
        // 失败也放行 boot，避免进度条卡死
        asset.markDone();
      });
    return () => {
      alive = false;
      modelProgressSink = null;
    };
  }, [modelScene]);

  // 计算包围盒、缩放、相机距离 —— 仅在模型加载后执行一次
  const setup = useMemo(() => {
    if (!modelScene) return null;

    // === 幂等保护：先归一化共享模型对象的自身变换 ===
    // modelScene 来自 useGLTF 缓存（跨 demo 切换复用的同一对象），
    // 上一次挂载可能已对它应用过 scale/position 偏移。若带着旧缩放
    // 直接算包围盒，会得到"已缩放后的尺寸"（≈12），再算出的 scale≈1、
    // 位移≈0，模型被打回原始 135 单位巨物，相机（按正确距离摆放）
    // 陷在模型内部 → 表现为"返回主页后电脑模型不显示"。
    // 因此每次先归一到恒等变换并刷新世界矩阵，保证包围盒始终基于
    // 文件原始几何计算，重复执行结果一致（StrictMode 双挂载安全）
    modelScene.scale.setScalar(1);
    modelScene.position.set(0, 0, 0);
    modelScene.updateMatrixWorld(true);

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

    // === DOF 焦点代理（钢琴页"轻量代理求交"同款思路）===
    // 全模型 raycast 每帧太重（Draco 网格数万三角形），改用两个解析代理：
    //  - 屏幕平面：ray ∩ plane 精确解，命中半径内直接当焦点（点屏幕→屏幕清晰）
    //  - 包围球：屏幕未命中时取射线上最接近球心的点（≈机身平均深度）
    const screenCenterW = new THREE.Vector3(
      SCREEN_CONFIG.posX,
      SCREEN_CONFIG.posY,
      SCREEN_CONFIG.posZ
    );
    const plane = new THREE.Plane();
    plane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(SCREEN_NORMAL.x, SCREEN_NORMAL.y, SCREEN_NORMAL.z).normalize(),
      screenCenterW
    );
    const sphere = new THREE.Box3().setFromObject(modelScene).getBoundingSphere(new THREE.Sphere());
    proxyRef.current = {
      plane,
      sphere,
      center: screenCenterW,
      // 命中半径：屏幕对角线的一半再放宽 20%，容许"点到屏幕边框附近也算屏幕"
      screenR2: Math.pow(
        Math.hypot(SCREEN_CONFIG.width, SCREEN_CONFIG.height) * 0.5 * 1.2,
        2
      ),
    };

    return { scaledSize, distance };
  }, [modelScene, camera]);

  // 模型加载完成后设置环境贴图与入场起始相机
  // 依赖数组只放真正的"模型相关"依赖：modelScene/setup/gl/scene/camera
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

    // 设置初始相机位置 = 屏幕特写位置（入场动画的起点）
    // 相机贴近屏幕中心，沿屏幕法线往前推 INTRO_CONFIG.START_CAMERA_DISTANCE
    // boot 显现弹簧启动前相机停在此特写位（introEase=0），
    // 弹簧驱动 useFrame 把相机拉远到默认位置
    const startPosX = SCREEN_CONFIG.posX + SCREEN_NORMAL.x * INTRO_CONFIG.START_CAMERA_DISTANCE;
    const startPosY = SCREEN_CONFIG.posY;
    const startPosZ = SCREEN_CONFIG.posZ + SCREEN_NORMAL.z * INTRO_CONFIG.START_CAMERA_DISTANCE;
    camera.position.set(startPosX, startPosY, startPosZ);
    // 起始 lookAt = 屏幕中心，让相机正对屏幕
    camera.lookAt(SCREEN_CONFIG.posX, SCREEN_CONFIG.posY, SCREEN_CONFIG.posZ);

    // 应用起始 FOV（比默认小，让屏幕特写显得更大）
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = INTRO_CONFIG.START_FOV;
    cam.updateProjectionMatrix();
  }, [modelScene, setup, gl, scene, camera]);

  // 关联聚光灯与其目标点：spotLight.target 默认指向场景原点的新 Object3D，
  // 必须手动替换为 spotTargetRef 指向的 object3D，光锥才会朝向 useFrame 里设置的目标
  useEffect(() => {
    if (spotLightRef.current && spotTargetRef.current) {
      spotLightRef.current.target = spotTargetRef.current;
    }
    // 两盏焦散灯同理：目标点必须挂进场景并指给灯，gobo 投射方向才正确
    if (screenCausticRef.current && screenCausticTargetRef.current) {
      screenCausticRef.current.target = screenCausticTargetRef.current;
    }
    if (topCausticRef.current && topCausticTargetRef.current) {
      topCausticRef.current.target = topCausticTargetRef.current;
    }
    // 卸载时释放 gobo 纹理（两份实例来自同一张 canvas，canvas 本体交 GC）
    return () => {
      causticsTex.screen.dispose();
      causticsTex.top.dispose();
    };
  }, [causticsTex]);

  // 每帧更新：非 DEBUG 模式下按 CAMERA_CONFIG 固定相机 + 鼠标视差微旋转
  // DEBUG 模式下让 OrbitControls 接管
  //
  // 两阶段完全独立，互不干扰：
  //   阶段 1（入场，只播一次）：boot 显现弹簧驱动 introEase 0→1，
  //                            相机从屏幕特写 → 默认位置；收敛后永不再动
  //   阶段 2（滚动推入）：弹簧收敛后才激活，相机从默认位置 → 屏幕背面
  //                      由 scrollProgress 驱动，可来回滚动
  useFrame((_state, _delta) => {
    if (!setup) return;
    // DEBUG 模式：跳过固定相机控制，让 OrbitControls 自由操作
    if (DEBUG) return;

    const { distance, scaledSize } = setup;

    // 计算 target 世界坐标（默认相机看向的点）
    const targetX = scaledSize.x * CAMERA_CONFIG.lookAtX;
    const targetYWorld = scaledSize.y * CAMERA_CONFIG.lookAtY;
    const targetZ = scaledSize.z * CAMERA_CONFIG.lookAtZ;

    // === 入场进度：由 boot 显现弹簧单源驱动（只播一次）===
    // 弹簧前 20% 相机保持屏幕特写（弹簧蓄力），随后 pow1.4 ease-out 拉远到全景。
    // 曲线逆向自 shader.se：introEase = clamp((spring - 0.2) / 0.8) ^ 1.4
    const introT = THREE.MathUtils.clamp((bootStore.spring - 0.2) / 0.8, 0, 1);
    const introEase = Math.pow(introT, 1.4);

    // === 滚动推入进度（仅显现收敛后激活）===
    // 入场期间 scrollSmoothed 强制为 0，相机只走入场路径；
    // 收敛后 scrollSmoothed lerp 追赶真实 scrollProgress，相机走推入路径——
    // 滚动推入完全独立于入场，滚回顶部也只退到默认位置，不会重播入场动画
    if (bootStore.springDone) {
      scrollSmoothedRef.current += (scrollProgress - scrollSmoothedRef.current) * 0.1;
    } else {
      scrollSmoothedRef.current = 0;
    }
    const scrollT = scrollSmoothedRef.current;
    // 缓动：pow(scrollT, EASE_POWER) 让推入前期稍慢、后期加速，"扎进屏幕"的加速感
    const scrollEase = Math.pow(Math.max(0, Math.min(1, scrollT)), SCROLL_PUSH_CONFIG.EASE_POWER);

    // 鼠标视差：读取归一化坐标（-1~1），叠加到 yaw/pitch 上做小角度旋转
    // 入场期间视差强度 = introEase；推入期间视差被 (1 - scrollEase) 衰减，
    //                    深入屏幕后视差归零（屏幕充满视野，视差无意义且会穿模）
    const target = mouseRef.current;
    const smoothed = mouseSmoothedRef.current;
    smoothed.x += (target.x - smoothed.x) * 0.08;
    smoothed.y += (target.y - smoothed.y) * 0.08;
    const parallaxStrength = introEase * (1 - scrollEase);
    const yawDeg = CAMERA_CONFIG.yawDeg - smoothed.x * CAMERA_CONFIG.parallaxYawDeg * parallaxStrength;
    const pitchDeg = CAMERA_CONFIG.pitchDeg + smoothed.y * CAMERA_CONFIG.parallaxPitchDeg * parallaxStrength;

    // === 入场阶段：从屏幕特写 lerp 到默认相机位置（introEase 0→1）===
    // 默认相机位置（含当前视差偏移）= 入场终点
    const homePos = computeCameraPosition(distance, scaledSize, targetX, targetZ, yawDeg, pitchDeg);
    // 屏幕特写起点：屏幕中心 + 沿屏幕法线往前推
    const introStartX = SCREEN_CONFIG.posX + SCREEN_NORMAL.x * INTRO_CONFIG.START_CAMERA_DISTANCE;
    const introStartY = SCREEN_CONFIG.posY;
    const introStartZ = SCREEN_CONFIG.posZ + SCREEN_NORMAL.z * INTRO_CONFIG.START_CAMERA_DISTANCE;
    // 入场插值结果：introEase=0 时在屏幕特写，=1 时在默认位置
    const introPosX = introStartX + (homePos.x - introStartX) * introEase;
    const introPosY = introStartY + (homePos.y - introStartY) * introEase;
    const introPosZ = introStartZ + (homePos.z - introStartZ) * introEase;

    // === 滚动推入阶段：从默认位置 lerp 到屏幕背面（scrollEase 0→1）===
    // 推入终点：屏幕中心 + 法线 × END_CAMERA_OFFSET（负值=穿过屏幕到背面）
    const pushEndX = SCREEN_CONFIG.posX + SCREEN_NORMAL.x * SCROLL_PUSH_CONFIG.END_CAMERA_OFFSET;
    const pushEndY = SCREEN_CONFIG.posY;
    const pushEndZ = SCREEN_CONFIG.posZ + SCREEN_NORMAL.z * SCROLL_PUSH_CONFIG.END_CAMERA_OFFSET;

    camera.position.x = introPosX + (pushEndX - introPosX) * scrollEase;
    camera.position.y = introPosY + (pushEndY - introPosY) * scrollEase;
    camera.position.z = introPosZ + (pushEndZ - introPosZ) * scrollEase;

    // lookAt：入场从屏幕中心 → 默认 target；推入从默认位置 → 屏幕中心
    const lookAtIntroX = SCREEN_CONFIG.posX + (targetX - SCREEN_CONFIG.posX) * introEase;
    const lookAtIntroY = SCREEN_CONFIG.posY + (targetYWorld - SCREEN_CONFIG.posY) * introEase;
    const lookAtIntroZ = SCREEN_CONFIG.posZ + (targetZ - SCREEN_CONFIG.posZ) * introEase;
    const lookAtX = lookAtIntroX + (SCREEN_CONFIG.posX - lookAtIntroX) * scrollEase;
    const lookAtY = lookAtIntroY + (SCREEN_CONFIG.posY - lookAtIntroY) * scrollEase;
    const lookAtZ = lookAtIntroZ + (SCREEN_CONFIG.posZ - lookAtIntroZ) * scrollEase;
    camera.lookAt(lookAtX, lookAtY, lookAtZ);

    // FOV：25°（入场起）→ 41°（默认，入场终）→ 55°（推入终，广角拉伸）
    const fovIntro = INTRO_CONFIG.START_FOV + (CAMERA_CONFIG.fov - INTRO_CONFIG.START_FOV) * introEase;
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = fovIntro + (SCROLL_PUSH_CONFIG.END_FOV - fovIntro) * scrollEase;
    cam.updateProjectionMatrix();

    // 模型不旋转（保持静止，让用户能看清电脑细节）

    // === DOF 焦点：每帧轻量代理求交，实时跟手 ===
    // 屏幕平面精确命中（点屏幕→焦平面落在屏幕）；未命中屏幕取射线上最接近
    // 模型包围球球心的点（≈机身平均深度）。鼠标 NDC 的 Y 轴与 Raycaster 约定
    // 相反（App 里底=+1），取反后使用
    if (focusRef && proxyRef.current) {
      pointerNdcRef.current.set(mouseRef.current.x, -mouseRef.current.y);
      camera.updateMatrixWorld();
      raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
      const ray = raycasterRef.current.ray;
      const proxy = proxyRef.current;
      const planeHit = ray.intersectPlane(proxy.plane, focusHitRef.current);
      if (planeHit && planeHit.distanceToSquared(proxy.center) <= proxy.screenR2) {
        focusRef.current.copy(planeHit);
      } else {
        // 射线上最接近球心的参数 t（球心-原点 在射线方向上的投影）
        focusHitRef.current.copy(proxy.sphere.center).sub(ray.origin);
        const t = Math.max(focusHitRef.current.dot(ray.direction), 0.1);
        focusRef.current.copy(ray.origin).addScaledVector(ray.direction, t);
      }
    }
  });

  // 每帧更新两层烟雾位置 + 聚光灯晃动 + 焦散灯
  // 独立于上方 useFrame，确保 DEBUG 模式（OrbitControls 接管）下也能正确跟随
  useFrame((state, delta) => {
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

    // 前层：相机前方一点（镜头与电脑之间，靠近电脑一侧，让烟雾明显挡在电脑前）
    const frontDist = Math.min(dirLen * 0.55, 1.6);
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

    // 自发光粒子：直接放在电脑中心（target 位置），粒子自身在小范围内涌动
    // 让发光尘埃环绕在电脑周围，营造氛围
    if (glowParticlesRef.current) {
      glowParticlesRef.current.position.set(targetX, targetY, targetZ);
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

    // === 焦散灯：摆位 + gobo UV 慢速漂移 + 屏幕灯跟色 ===
    // 屏幕灯贴着屏幕中心沿法线外移一点，投向机身前下方——
    // "屏幕的光在机身上泛起涟漪"，颜色每帧跟 GIF 采样色
    if (screenCausticRef.current) {
      screenCausticRef.current.position.set(
        SCREEN_CONFIG.posX + SCREEN_NORMAL.x * 0.12,
        SCREEN_CONFIG.posY,
        SCREEN_CONFIG.posZ + SCREEN_NORMAL.z * 0.12
      );
    }
    if (screenCausticTargetRef.current) {
      screenCausticTargetRef.current.position.set(
        targetX + SCREEN_NORMAL.x * scaledSize.z * 0.09,
        targetY - scaledSize.y * 0.18,
        targetZ + SCREEN_NORMAL.z * scaledSize.z * 0.09
      );
      screenCausticTargetRef.current.updateMatrixWorld();
    }
    if (screenCausticRef.current) {
      screenCausticRef.current.color.copy(screenColorRef.current);
    }
    // 顶部灯悬在机身前上方（压低、前移——几何上保证屏幕中心落在光锥之外
    // 约 40°，否则 gobo 水纹会织在屏幕上污染 GIF 主体），暖白水纹从上往下织
    if (topCausticRef.current) {
      topCausticRef.current.position.set(
        targetX + scaledSize.x * 0.06,
        targetY + scaledSize.y * 0.38,
        targetZ + scaledSize.z * 0.40
      );
    }
    if (topCausticTargetRef.current) {
      topCausticTargetRef.current.position.set(
        targetX,
        targetY - scaledSize.y * 0.16,
        targetZ + scaledSize.z * 0.02
      );
      topCausticTargetRef.current.updateMatrixWorld();
    }
    // gobo UV 漂移：两盏灯速率不同，纹路不会同步滑动
    causticsTex.screen.offset.x += delta * 0.021;
    causticsTex.screen.offset.y += delta * 0.013;
    causticsTex.top.offset.x -= delta * 0.009;
    causticsTex.top.offset.y += delta * 0.016;
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
      {/* 主光源：电脑正上方聚光灯，位置与目标点由 useFrame 微微随机晃动 */}
      <spotLight
        ref={spotLightRef}
        color="#fff4e0"
        intensity={0}
        distance={50}
        angle={0.55}
        penumbra={0.5}
        decay={1.4}
        castShadow
      />
      {/* 聚光灯目标点（必须挂到场景里才会生效） */}
      <object3D ref={spotTargetRef} />

      {/* 屏幕焦散灯：从屏幕中心向外投水纹 gobo，颜色每帧跟随 GIF 采样色
          （红 GIF 投红纹、蓝 GIF 投蓝纹——与"屏幕照亮环境"同一套设计语言）。
          电影级微妙档：强度压低，只让机身泛起若隐若现的光纹 */}
      <spotLight
        ref={screenCausticRef}
        color="#ffffff"
        intensity={1.7}
        distance={30}
        angle={0.75}
        penumbra={0.55}
        decay={1.25}
        map={causticsTex.screen}
      />
      <object3D ref={screenCausticTargetRef} />

      {/* 顶部焦散灯：暖白水纹从上方织在机身朝相机的一面（与主聚光灯同色温） */}
      <spotLight
        ref={topCausticRef}
        color="#fff2dc"
        intensity={0.95}
        distance={40}
        angle={0.62}
        penumbra={0.65}
        decay={1.3}
        map={causticsTex.top}
      />
      <object3D ref={topCausticTargetRef} />

      {/* 补光：电脑正上方的柔和顶光（directionalLight 平行光，均匀照亮整体）
          低强度 + 冷白色，与主聚光灯的暖白形成色温对比，避免画面过暗 */}
      <directionalLight
        color="#d4e0ff"
        intensity={3}
        position={[0, 10, 0]}
      />

      {/* 模型本体（手动加载，就绪前不挂载） */}
      {modelScene && <primitive object={modelScene} />}

      {/* 电脑屏幕：显示 GIF 动画，自发光效果；世界坐标定位。
          colorRef 输出每帧 GIF 采样色，供屏幕焦散灯跟随 */}
      <ScreenDisplay colorRef={screenColorRef} />

      {/* 飘动烟雾：前层（镜头与电脑之间，靠近相机）*/}
      <group ref={frontSmokeRef}>
        <SmokeLayer
          texture={smokeTexture}
          count={32}
          areaSize={2.0}
          spriteSize={2.4}
          opacity={0.68}
          color="#9aa4ba"
          brightness={1.8}
        />
      </group>

      {/* 飘动烟雾：后层（电脑背向相机一侧，不进入电脑内部避免穿模）*/}
      <group ref={backSmokeRef}>
        <SmokeLayer
          texture={smokeTexture}
          count={24}
          areaSize={4.0}
          spriteSize={2.3}
          opacity={0.38}
          color="#6a7088"
          brightness={1.2}
        />
      </group>

      {/* 自发光尘埃（Points 批渲染着色器粒子）：幂律分布 + 双频漂移 + 生灭循环，
          联动屏幕采样色（红屏泛红）与平滑滚动（推进时向屏幕收拢） */}
      <group ref={glowParticlesRef}>
        <GlowParticles
          count={220}
          areaSize={2.4}
          particleSize={0.14}
          color="#ffd9a0"
          opacity={0.95}
          screenColorRef={screenColorRef}
          scrollRef={scrollSmoothedRef}
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
