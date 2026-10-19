import * as THREE from 'three/webgpu';
import { HERO_ENV } from './heroConfig';

/** 灯架条目（HERO_ENV.lights 的单项形状） */
interface RigLight {
  form: string;
  color: string;
  intensity: number;
  position: readonly number[];
  rotation?: readonly number[];
  scale: readonly number[];
}

/**
 * 生成单个灯架发光体（原件 `nm` 组件 = drei 的 Lightformer）
 *
 * 功能：把一个 (form, color, intensity, position, scale, rotation) 描述变成一块不受光的
 *      自发光网格 —— 它不照亮场景，只在被 PMREM 烘进环境贴图后成为反射里的一道亮斑。
 *
 * 参数：
 *  - def {RigLight} 灯位描述（直接来自 HERO_ENV.lights）
 *  - rigScale {number} 整体亮度系数（原件 F = 0.4 × lightsIntensity）
 *
 * 返回值：THREE.Mesh 已摆好位置的发光体
 *
 * 异常：无
 *
 * 注意事项：
 *  - 颜色按原件做法乘上强度（`color * intensity`），强度远大于 1 时靠 HDR 写进 HalfFloat 环境贴图
 *  - rect/circle/ring 三种形态分别用 Plane/Circle/Ring 几何；ring 取 (0.7, 1.0) 的空心比例
 *  - 只设 colorNode，不设 emissive —— 这些网格不参与光照计算，纯粹是「被反射的光」
 */
function createLightformer(def: RigLight, rigScale: number): THREE.Mesh {
  let geometry: THREE.BufferGeometry;
  if (def.form === 'ring') {
    geometry = new THREE.RingGeometry(0.7, 1.0, 64);
  } else if (def.form === 'circle') {
    geometry = new THREE.CircleGeometry(0.5, 64);
  } else {
    geometry = new THREE.PlaneGeometry(1, 1);
  }

  const material = new THREE.MeshBasicNodeMaterial();
  const c = new THREE.Color(def.color).multiplyScalar(def.intensity * rigScale);
  material.colorNode = c as unknown as THREE.Node;
  material.side = THREE.DoubleSide;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(def.position[0], def.position[1], def.position[2]);
  if (def.rotation) mesh.rotation.set(def.rotation[0], def.rotation[1], def.rotation[2]);
  mesh.scale.set(def.scale[0], def.scale[1], def.scale[2]);

  // 原件里带 target 的 ring 会朝向原点；统一对有 target 的条目做 lookAt
  const withTarget = def as RigLight & { target?: readonly number[] };
  if (withTarget.target) {
    mesh.lookAt(withTarget.target[0], withTarget.target[1], withTarget.target[2]);
  }
  return mesh;
}

/**
 * 构建环境灯架并烘出环境贴图（原件 `pA` + `<Environment background={false} blur={0.8}>`）
 *
 * 功能：把 HERO_ENV.lights 描述的一圈发光体摆进一个临时场景，用 PMREMGenerator.fromScene
 *      烘成预过滤环境贴图，赋给 `scene.environment`。金属/塑料上的细长高光条就是这些灯被反射的结果。
 *
 * 参数：
 *  - renderer {THREE.WebGPURenderer} 已 init 的渲染器（PMREM 需要它来建渲染目标）
 *  - scene {THREE.Scene} 目标场景，烘好后直接写它的 environment
 *
 * 返回值：{ dispose } —— dispose 释放临时场景的几何/材质与环境贴图
 *
 * 异常：PMREM 在 WebGPU 后端偶发不可用时，本函数内部吞掉异常并返回 null 环境，
 *      调用方仍能正常渲染（只是材质反射会变暗），不会让整页崩掉。
 *
 * 注意事项：
 *  - 原件 `background={false}` → 环境不参与背景，只作为反射/环境光来源
 *  - `resolution={1024}` 用 HERO_ENV.resolution；`blur={0.8}` 用 HERO_ENV.blur 作为 fromScene 的 sigma
 *  - 灯架整体乘 HERO_ENV.rigScale（原件 F = 0.4 × lightsIntensity，首页 lightsIntensity = 1）
 */
export function createHeroEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene) {
  const rigScene = new THREE.Scene();
  const meshes: THREE.Mesh[] = [];

  for (const def of HERO_ENV.lights) {
    const mesh = createLightformer(def as unknown as RigLight, HERO_ENV.rigScale);
    meshes.push(mesh);
    rigScene.add(mesh);
  }

  let envTexture: THREE.Texture | null = null;
  let pmrem: THREE.PMREMGenerator | null = null;
  try {
    pmrem = new THREE.PMREMGenerator(renderer);
    // samples 与 sigma 近似线性：sigma 0.8→390、0.1→49，上限是 20，故选 0.04
    const rt = pmrem.fromScene(rigScene, 0.04);
    envTexture = rt.texture;
    scene.environment = envTexture;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[heroLightRig] PMREM 环境贴图生成失败，退回无环境贴图渲染：', err);
  }

  /**
   * 释放灯架临时场景与环境贴图
   *
   * 功能：dispose 掉灯架网格的几何/材质、PMREM 生成器与烘出的环境贴图
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   * 注意事项：调用后 scene.environment 会指向已释放的贴图，需由调用方自行清空
   */
  const dispose = () => {
    for (const m of meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    rigScene.clear();
    if (envTexture) envTexture.dispose();
    // @types/three 对 three/webgpu 的 PMREMGenerator 未声明 dispose，运行时存在，故走结构化断言
    (pmrem as unknown as { dispose?: () => void } | null)?.dispose?.();
    scene.environment = null;
  };

  return { dispose };
}
