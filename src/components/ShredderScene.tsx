import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

/**
 * 粉碎机模型组件 — 加载 shredder.glb 并按粉碎进度升起
 *
 * 功能：
 *  - 加载 shredder.glb 3D 模型
 *  - 根据 shredProgress（0~1）从屏幕下方升起到目标位置
 *  - 升起时带有轻微的震动和倾斜，模拟重型机械运转
 *  - 模型整体受光照影响（金属质感）
 *
 * 参数：
 *  - shredProgress — 粉碎进度 ref（0~1，0=未升起，1=完全升起）
 *
 * 返回值：React.ReactElement
 *
 * 异常：useGLTF 加载失败时由 Suspense 边界处理
 *
 * 注意事项：
 *  - useGLTF 必须在 <Suspense> 内部使用
 *  - 模型通过 traverse 设置 castShadow/receiveShadow 和材质属性
 *  - 升起路径：从屏幕底部（y=-3）升到 y=0（屏幕中部偏下）
 *  - 震动：用 sin(time*高频) 产生微小位移，模拟机械震动
 */
function ShredderModel({
  shredProgress,
}: {
  shredProgress: React.MutableRefObject<number>;
}) {
  const { scene } = useGLTF('/asset/models/shredder.glb');
  const { size } = useThree();
  // 克隆场景图，避免共享状态
  const cloned = useMemo(() => scene.clone(true), [scene]);

  // 遍历设置材质（让模型更立体、金属感更强）
  // 注意：取消 castShadow/receiveShadow，避免碎纸机自身阴影遮挡摄像机视线
  useMemo(() => {
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const stdMat = m as THREE.MeshStandardMaterial;
            // toneMapped=true 让 Three.js 自动色调映射，避免高光过曝和奇怪反射
            stdMat.toneMapped = true;
            // 适度增强金属感（不过高，避免反射异常）
            stdMat.metalness = Math.min(0.9, stdMat.metalness + 0.2);
            stdMat.roughness = Math.max(0.35, stdMat.roughness - 0.05);
          }
        });
      }
    });
  }, [cloned]);

  // 根据浏览器宽度自适应模型大小
  // 基准宽度 1920px → scale=1.0，宽度越小模型越小，宽度越大模型越大
  // 限制范围 [0.5, 2.0] 避免极端值
  const adaptiveScale = useMemo(() => {
    const baseWidth = 1920;
    const ratio = size.width / baseWidth;
    const scale = Math.max(0.5, Math.min(2.0, ratio));
    return scale;
  }, [size.width]);

  const groupRef = useRef<THREE.Group | null>(null);
  // 当前 Y 位置（lerp 插值后的平滑值）
  // 粉碎进度是离散 wheel 事件累积，直接用会让模型移动生硬卡顿
  // 用 lerp 每帧向目标值趋近，产生惯性阻尼的顺滑滑动
  const smoothYRef = useRef(-6);

  // 每帧更新位置：根据 shredProgress 垂直升起 + lerp 阻尼 + 震动
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const p = shredProgress.current; // 0~1

    // 升起路径：y 从屏幕底部下方（-6）完全穿过屏幕顶部移出（8.0）
    // 用 smoothstep 让升起先慢后快再慢，更自然
    // 相机 z=14, fov=45，屏幕顶部世界 Y ≈ 5.8，移到 8.0 完全离开画面
    const eased = p * p * (3 - 2 * p); // smoothstep
    const targetY = -6 + eased * 14.0; // -6 → 8.0

    // lerp 阻尼：每帧把当前 Y 向目标 Y 趋近（因子 0.06 ≈ 16 帧达到 60%）
    // 因子越小越柔顺（延迟越大），越大越紧（越接近原始离散）
    // 用 0.06 比纸张的 0.12 更柔顺，因为粉碎机更重，惯性更大
    // snap 阈值设为 10（总位移 14 的 70%），只有真正的外部重置（进入详情页）
    // 才会触发 snap，正常 wheel 跳变（约 1.4）完全走 lerp 阻尼
    if (Math.abs(smoothYRef.current - targetY) > 10.0) {
      smoothYRef.current = targetY;
    } else {
      smoothYRef.current = THREE.MathUtils.lerp(smoothYRef.current, targetY, 0.06);
      if (Math.abs(smoothYRef.current - targetY) < 0.005) {
        smoothYRef.current = targetY;
      }
    }
    group.position.y = smoothYRef.current;

    // 保持垂直，不倾斜（用户要求粉碎机工作时不要歪着）

    // 震动：粉碎阶段（p>0）时机械震动，频率高、幅度小
    const shakeAmp = p * 0.012; // 最大幅度 0.012
    const shakeFreq = 30;
    group.position.x = Math.sin(clock.getElapsedTime() * shakeFreq) * shakeAmp;
    group.position.z = Math.cos(clock.getElapsedTime() * shakeFreq * 1.3) * shakeAmp;
    // 保持 rotation 为 0，完全垂直
    group.rotation.set(0, 0, 0);
  });

  return (
    <group ref={groupRef}>
      {/* 模型原始朝向是朝上（+Y），旋转 90° 绕 X 轴让朝上变成朝向相机（+Z） */}
      <primitive object={cloned} scale={adaptiveScale} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}

/**
 * 粉碎粒子系统 — 纸屑从粉碎机位置喷出
 *
 * 功能：
 *  - 在粉碎机顶部位置生成大量小纸屑粒子
 *  - 粒子有随机初始速度（向上/向两侧扩散）
 *  - 受重力影响下落
 *  - 粒子是细长的矩形碎片（用 Points + 自定义 shader 模拟）
 *  - 粒子数量随粉碎进度增加
 *
 * 参数：
 *  - shredProgress — 粉碎进度 ref（0~1）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 使用 BufferGeometry + Points 渲染，性能优于多个 Mesh
 *  - 粒子位置在 useFrame 中 CPU 端更新（粒子数 <500 可接受）
 *  - 纸屑颜色从纸张色（米黄）到深棕随机，呼应做旧纸张
 */
function ShredParticles({
  shredProgress,
}: {
  shredProgress: React.MutableRefObject<number>;
}) {
  // 粒子数量增大（800），让粉末更密集明显
  const MAX_PARTICLES = 800;

  // 粒子数据：位置、速度、颜色、生命周期
  const particles = useMemo(() => {
    return {
      positions: new Float32Array(MAX_PARTICLES * 3),
      velocities: new Float32Array(MAX_PARTICLES * 3),
      colors: new Float32Array(MAX_PARTICLES * 3),
      life: new Float32Array(MAX_PARTICLES),
      active: new Uint8Array(MAX_PARTICLES),
    };
  }, []);

  // 创建几何和材质
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(particles.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(particles.colors, 3));
    return geo;
  }, [particles]);

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      // 粒子尺寸放大（相机 z=14 拉得远，需要更大的粒子）
      size: 0.18,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
  }, []);

  // 粒子发射累加器
  const emitAccumRef = useRef(0);
  const pointsRef = useRef<THREE.Points | null>(null);
  // 调试计数器（每 30 帧打印一次粒子状态）
  const debugFrameRef = useRef(0);

  // 每帧更新粒子
  useFrame((_, delta) => {
    const p = shredProgress.current;
    const dt = Math.min(delta, 0.05); // 限制最大步长，避免长帧穿透

    // === 调试：每 30 帧打印一次粒子状态 ===
    debugFrameRef.current++;
    if (debugFrameRef.current % 30 === 0) {
      let activeCount = 0;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (particles.active[i] === 1) activeCount++;
      }
      // eslint-disable-next-line no-console
      console.log('[ShredParticles] shredProgress=', p.toFixed(3), 'active=', activeCount, '/', MAX_PARTICLES, 'emitAccum=', emitAccumRef.current.toFixed(2));
    }

    // 粉碎机顶部位置（与 ShredderModel 升起位置同步）
    const eased = p * p * (3 - 2 * p);
    const shredderY = -6 + eased * 14.0;
    const emitY = shredderY + 1.2; // 粒子从粉碎机入口喷出
    const emitX = 0;
    const emitZ = 0;

    // 发射速率：随粉碎进度增加（提高到 600/秒，让粉末更密集）
    const emitRate = p * 600;
    emitAccumRef.current += emitRate * dt;

    // 发射新粒子
    while (emitAccumRef.current >= 1) {
      emitAccumRef.current -= 1;
      // 找一个非活跃的粒子槽位
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (particles.active[i] === 0) {
          particles.active[i] = 1;
          particles.life[i] = 2.0 + Math.random() * 1.5; // 2.0~3.5 秒生命（更长，让粉末飘更久）

          // 初始位置（粉碎机入口附近，带随机偏移）
          // X 扩散范围扩大到 ±4（更宽的粉末带）
          particles.positions[i * 3] = emitX + (Math.random() - 0.5) * 8.0;
          particles.positions[i * 3 + 1] = emitY + Math.random() * 0.8;
          particles.positions[i * 3 + 2] = emitZ + (Math.random() - 0.5) * 2.0;

          // 初始速度：向上喷出 + 向两侧扩散（速度放大）
          // X 速度扩大到 ±6（更宽的扩散）
          particles.velocities[i * 3] = (Math.random() - 0.5) * 8.0;
          // 向上速度提高到 3~8（喷得更高）
          particles.velocities[i * 3 + 1] = 3 + Math.random() * 5;
          particles.velocities[i * 3 + 2] = (Math.random() - 0.5) * 3.0;

          // 颜色：从纸张色（米黄）到深棕随机，呼应做旧纸张
          const colorMix = Math.random();
          particles.colors[i * 3] = 0.85 - colorMix * 0.5; // R
          particles.colors[i * 3 + 1] = 0.78 - colorMix * 0.5; // G
          particles.colors[i * 3 + 2] = 0.55 - colorMix * 0.4; // B
          break;
        }
      }
    }

    // 更新活跃粒子
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (particles.active[i] === 0) {
        // 非活跃粒子隐藏到远处
        particles.positions[i * 3 + 1] = -9999;
        continue;
      }

      // 重力（减弱到 4，让粉末飘得更久更慢）
      particles.velocities[i * 3 + 1] -= 4 * dt;

      // 空气阻力（速度衰减，X/Z 更强让粉末悬浮感更强）
      particles.velocities[i * 3] *= 0.96;
      particles.velocities[i * 3 + 2] *= 0.96;

      // 更新位置
      particles.positions[i * 3] += particles.velocities[i * 3] * dt;
      particles.positions[i * 3 + 1] += particles.velocities[i * 3 + 1] * dt;
      particles.positions[i * 3 + 2] += particles.velocities[i * 3 + 2] * dt;

      // 生命衰减
      particles.life[i] -= dt;
      if (particles.life[i] <= 0) {
        particles.active[i] = 0;
      }
    }

    // 标记 position 属性需要更新
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  });

  // frustumCulled=false：粒子位置每帧 CPU 更新，但 boundingSphere 不会自动重算，
  // Three.js 可能基于过时的 boundingSphere 错误剔除粒子，强制关闭视锥剔除
  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}

/**
 * ShredderScene — 粉碎机场景（叠加在纸张上层）
 *
 * 功能：
 *  - 渲染粉碎机 3D 模型（shredder.glb）
 *  - 渲染粉碎粒子（纸屑）
 *  - 透视相机 + 光照（让 3D 模型有立体感）
 *  - 根据 shredProgress（0~1）驱动粉碎机升起和粒子发射
 *
 * 参数：
 *  - shredProgress — 粉碎进度 ref（0~1，0=未升起，1=完全升起）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - 这个 Canvas 透明背景，叠加在纸张 Canvas 上层
 *  - 相机为透视相机，z=6，fov=45
 *  - 光照：环境光 + 方向光 + 点光源（粉碎机入口处冷光）
 */
export function ShredderScene({
  shredProgress,
}: {
  shredProgress: React.MutableRefObject<number>;
}) {
  return (
    <>
      {/* 环境光：整体基础照明，不过亮 */}
      <ambientLight intensity={0.6} />

      {/* 主方向光：从上方斜照，产生立体感 */}
      <directionalLight position={[3, 8, 5]} intensity={1.5} />

      {/* 补光：从侧面照亮粉碎机金属质感 */}
      <directionalLight position={[-5, 2, 3]} intensity={0.8} color="#aabbff" />

      {/* 正面补光：从摄像机方向补光，消除阴影 */}
      <directionalLight position={[0, 2, 8]} intensity={1.0} color="#ffffff" />

      {/* 点光源：粉碎机入口处冷色光，模拟机械内部光源 */}
      <pointLight
        position={[0, -0.5, 1.5]}
        intensity={1.8}
        distance={4}
        color="#6688ff"
      />

      {/* 粉碎机模型 */}
      <ShredderModel shredProgress={shredProgress} />

      {/* 粉碎粒子 */}
      <ShredParticles shredProgress={shredProgress} />
    </>
  );
}

// 预加载模型，首次进入时无卡顿
useGLTF.preload('/asset/models/shredder.glb');

/**
 * ShredderSceneSync — 粉碎机场景同步组件
 *
 * 功能：
 *  - 每帧从 paperScrollProgress（0~SHRED_MAX=1.4）派生粉碎进度（0~1）
 *  - 写入 shredProgressRef，供 ShredderModel 和 ShredParticles 使用
 *  - 渲染 ShredderScene（粉碎机模型 + 粒子 + 光照）
 *
 * 参数：
 *  - paperScrollProgress — 原始滚动进度 ref（0~1.4，超过 1 进入粉碎阶段）
 *  - shredProgressRef    — 派生的粉碎进度 ref（0~1）
 *
 * 返回值：React.ReactElement
 *
 * 注意事项：
 *  - SHRED_MAX 必须与 KiraFilmDemo.tsx 中的值一致（1.4）
 *  - 用 useFrame 每帧更新，保证粉碎进度实时跟随滚轮
 */
export function ShredderSceneSync({
  paperScrollProgress,
  shredProgressRef,
}: {
  paperScrollProgress: React.MutableRefObject<number>;
  shredProgressRef: React.MutableRefObject<number>;
}) {
  useFrame(() => {
    // 从 paperScrollProgress（0~1.4）派生粉碎进度（0~1）
    // 超过 1.0 的部分除以 0.4 映射到 0~1
    const raw = paperScrollProgress.current;
    shredProgressRef.current = Math.max(0, Math.min(1, (raw - 1.0) / 0.4));
  });

  return <ShredderScene shredProgress={shredProgressRef} />;
}
