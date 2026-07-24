import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, useLoader } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';
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
 * 屏幕显示配置
 *
 * 功能：定义屏幕 plane 在 computer 节点局部坐标系（= GLB 原始坐标，因 computer 节点无 transform）中的位置、尺寸、朝向
 *
 * 字段说明：
 *  - posX / posY / posZ：屏幕中心在 computer 节点局部坐标系的位置
 *    参考值来自 computer mesh 包围盒 X[-34.7,-8.3] Y[0.06,15.46] Z[-11.36,15.32]
 *  - width / height：屏幕 plane 的宽高（GLB 单位）
 *  - rotX / rotY / rotZ：屏幕朝向（弧度），默认朝 +Z（前面板方向）
 *  - switchIntervalSec：GIF 切换间隔（秒）
 *  - emissiveIntensity：自发光强度，越大越亮
 */
const SCREEN_CONFIG = {
  posX: -21.5,         // X 中点
  posY: 10,            // 上半部分（CRT 区域）
  posZ: 15.0,          // 紧贴前面板（Z 最大 ~15.32）
  width: 14,           // 屏幕宽
  height: 8,           // 屏幕高
  rotX: 0,             // 朝 +Z 无需旋转
  rotY: 0,
  rotZ: 0,
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

interface ScreenDisplayProps {
  /** 屏幕 mesh 要挂载到的父节点（通常为 computer 节点） */
  computerNode: THREE.Object3D | null;
}

/**
 * 屏幕显示组件
 *
 * 功能：
 *  - 加载 4 个 GIF 资源作为屏幕贴图
 *  - 创建一个 plane mesh，通过 reparent 挂到 computer 节点下，跟随电脑变换
 *  - 用 MeshStandardMaterial 的 emissiveMap 让屏幕"自发光"（不受场景光照压暗）
 *  - 每帧设置 texture.needsUpdate=true，让浏览器解码 GIF 当前帧并上传 GPU，实现动画播放
 *  - 定时循环切换 4 个 GIF
 *
 * 参数：见 ScreenDisplayProps
 *
 * 返回值：React.ReactElement（一个 <mesh>，会被 reparent 到 computer 节点）
 *
 * 异常：useLoader 内部 suspense，加载失败会向上抛到 ErrorBoundary
 *
 * 注意事项：
 *  - GIF 在浏览器里加载到 HTMLImageElement 后会自动播放动画帧
 *  - three.js 默认只在 needsUpdate=true 时上传 GPU，所以每帧都要设
 *  - mesh 一开始在 R3F root scene 下，useEffect 里 reparent 到 computer node
 *  - 位置坐标用 GLB 原始坐标（computer 节点无 transform）
 */
function ScreenDisplay({ computerNode }: ScreenDisplayProps) {
  // 加载所有 GIF 作为 THREE.Texture（image 是 HTMLImageElement，浏览器自动播放 GIF）
  const textures = useLoader(THREE.TextureLoader, SCREEN_GIF_URLS);
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  // 当前 GIF 索引（用 ref 避免每帧 setState）
  const idxRef = useRef(0);
  const lastSwitchRef = useRef(0);

  // 设置所有 texture 的颜色空间为 sRGB（GIF 颜色才不会发灰）
  useEffect(() => {
    textures.forEach((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      // 关闭 mipmaps，GIF 动画上传频繁，mipmap 生成开销大
      tex.generateMipmaps = false;
    });
  }, [textures]);

  // 把 plane mesh reparent 到 computer 节点下，让它跟随电脑的变换
  useEffect(() => {
    if (!computerNode || !meshRef.current) return;
    computerNode.add(meshRef.current);
    return () => {
      // 卸载时从 computer 节点移除（R3F 也会处理 dispose）
      if (meshRef.current?.parent === computerNode) {
        computerNode.remove(meshRef.current);
      }
    };
  }, [computerNode]);

  // 每帧：让所有 GIF texture 上传当前帧 + 定时切换 GIF
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // 定时切换 GIF
    if (t - lastSwitchRef.current > SCREEN_CONFIG.switchIntervalSec) {
      lastSwitchRef.current = t;
      idxRef.current = (idxRef.current + 1) % textures.length;
      const tex = textures[idxRef.current];
      if (matRef.current) {
        matRef.current.map = tex;
        matRef.current.emissiveMap = tex;
        matRef.current.needsUpdate = true;
      }
    }
    // 每帧让所有 texture 上传当前 GIF 帧到 GPU（实现动画播放）
    // 只更新当前在用的那个，减少上传开销
    textures[idxRef.current].needsUpdate = true;
  });

  return (
    <mesh
      ref={meshRef}
      position={[SCREEN_CONFIG.posX, SCREEN_CONFIG.posY, SCREEN_CONFIG.posZ]}
      rotation={[SCREEN_CONFIG.rotX, SCREEN_CONFIG.rotY, SCREEN_CONFIG.rotZ]}
    >
      <planeGeometry args={[SCREEN_CONFIG.width, SCREEN_CONFIG.height]} />
      <meshStandardMaterial
        ref={matRef}
        map={textures[0]}
        emissive="#ffffff"
        emissiveMap={textures[0]}
        emissiveIntensity={SCREEN_CONFIG.emissiveIntensity}
        toneMapped={false}
        transparent
      />
    </mesh>
  );
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

  // computer 节点引用：ScreenDisplay 会把屏幕 plane reparent 到这个节点下
  // 初始为 null，模型加载后在 setup 中查找赋值，触发 useState 让 ScreenDisplay 重渲染
  const [computerNode, setComputerNode] = useState<THREE.Object3D | null>(null);

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

    // 查找 computer 节点：ScreenDisplay 会把屏幕 plane 挂到该节点下，跟随电脑变换
    // 模型节点名见 GLB：computer / keyboard / logo / background
    const compNode = modelScene.children.find((c) => c.name === 'computer');
    if (compNode) {
      // setTimeout 确保 setState 不在 useMemo 渲染周期内同步触发
      setTimeout(() => setComputerNode(compNode), 0);
    }

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

      {/* 电脑屏幕：显示 GIF 动画，自发光效果；reparent 到 computer 节点跟随变换 */}
      <ScreenDisplay computerNode={computerNode} />

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
