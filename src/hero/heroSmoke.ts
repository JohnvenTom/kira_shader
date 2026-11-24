import * as THREE from 'three/webgpu';
import { texture, uv, uniform } from 'three/tsl';
import { HERO_SMOKE } from './heroConfig';

/**
 * 前景烟层（原件 `cC` 组件的等价实现）
 *
 * 功能：按 HERO_SMOKE 配置生成 count 片朝随机朝向的平面，每片贴 smoke.webp，
 *      用不受光的 MeshBasicNodeMaterial 以 0.04 的极低不透明度叠加，构成「薄雾」。
 *      对外暴露 update(dt) 用于每帧按 rotationSpeed 自转（原件只转不移）。
 *
 * 参数：
 *  - map {THREE.Texture} 已加载好的 smoke 贴图（调用方负责加载与色彩空间设置）
 *
 * 返回值：{ group, update, dispose }
 *  - group  {THREE.Group} 可直接 add 到场景的容器（位置用 HERO_SMOKE.groupPosition）
 *  - update { (dt: number) => void } 每帧调用，按 rotationSpeed 累加每片的自转
 *  - dispose { () => void } 释放几何与材质
 *
 * 异常：无
 *
 * 注意事项：
 *  - 原件用 MeshBasicMaterial（不受光）——这是关键：烟不能被灯光染色，否则会变成实体物件
 *  - depthWrite=false 防止互相遮挡写入深度缓冲导致穿模；polygonOffset 防止与机身 z-fighting
 *  - 原件只做自转、不做位移，所以这里不引入任何漂移，避免和原件的「氤氲感」不一致
 *  - 片数少（30）时逐片 mesh 的开销可接受，与原件的实现一致，不做实例化改写
 */
export function createHeroSmoke(map: THREE.Texture) {
  const { count, planeSize, opacity, rotationSpeed, minBounds, maxBounds } = HERO_SMOKE;

  const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  // polygonOffset 推后一点，避免与机身共面时的深度冲突（原件同款参数）
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;
  // colorNode 直接取贴图（含 alpha），opacityNode 叠 0.04 的基础浓度
  material.colorNode = texture(map, uv());
  material.opacityNode = uniform(opacity);

  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const rotations: THREE.Euler[] = [];

  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      minBounds[0] + Math.random() * (maxBounds[0] - minBounds[0]),
      minBounds[1] + Math.random() * (maxBounds[1] - minBounds[1]),
      minBounds[2] + Math.random() * (maxBounds[2] - minBounds[2])
    );
    // 原件在 enableRotation 分支里给每片一个随机初始朝向（各轴 ±对应分量）
    const rot = new THREE.Euler(
      (Math.random() * 2 - 1) * rotationSpeed[0],
      (Math.random() * 2 - 1) * rotationSpeed[1],
      (Math.random() * 2 - 1) * rotationSpeed[2]
    );
    mesh.rotation.copy(rot);
    rotations.push(rot);
    meshes.push(mesh);
    group.add(mesh);
  }

  group.position.set(...HERO_SMOKE.groupPosition);

  /**
   * 每帧自转
   *
   * 功能：把每片的自转角按 rotationSpeed × dt 累加（原件 `t.rotation.x += r * e` 同款）
   *
   * 参数：
   *  - dt {number} 距上一帧的秒数
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：只累加自转，不改变 position —— 原件没有位移漂移
   */
  const update = (dt: number) => {
    for (let i = 0; i < meshes.length; i++) {
      const r = rotations[i];
      meshes[i].rotation.set(
        r.x + rotationSpeed[0] * dt,
        r.y + rotationSpeed[1] * dt,
        r.z + rotationSpeed[2] * dt
      );
    }
  };

  /** 释放几何与材质（贴图由调用方统一管理） */
  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };

  return { group, update, dispose };
}
