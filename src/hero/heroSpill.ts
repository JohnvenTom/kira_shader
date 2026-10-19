/* eslint-disable @typescript-eslint/no-explicit-any */
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';
import { HERO_PROJECTOR } from './heroConfig';

/**
 * TSL 命名空间置为 any（与 heroCompose.ts 同一取舍：避免逐算子泛型标注淹没可读性）
 */
const T = TSL as any;

/** 溅射工厂句柄 */
export interface HeroSpillFactory {
  /** 构建一份**全新的**溅射节点（每次调用都建新节点图，不跨材质共享实例） */
  makeNode: () => unknown;
  /** 可调 uniform（强度 / 半锥角正切 / penumbra，运行时可直接写 .value 调参） */
  uniforms: { uStrength: any; uTanHalf: any; uPenumbra: any };
}

/**
 * 创建解析式屏幕光溅射工厂
 *
 * 背景：原件用一盏带 gobo 的聚光灯（`<spotLight map={reelLightTexture} …>`）把屏幕的光
 *      按图案投到机身上。但 **three 0.169 的 WebGPURenderer 没有实现 `SpotLight.map`**
 *      （已核实 `build/three.webgpu.js` 中 `spotLightMap` 出现 0 次），这条路在本版本走不通。
 *      故改为解析式投影：在材质上按「光源投影空间」算 UV、采样 gobo、乘锥角/前后遮蔽，
 *      作为**加法项（emissiveNode）**叠加 —— 加法项不受基材 albedo/metalness 影响，
 *      因此在 metalness 0.83 的机壳与纯黑 albedo 的键盘上同样可见。
 *
 * 参数：
 *  - gobo {THREE.Texture} 投影图案（本页为循环片派生的光纹理，与屏幕内容同源）
 *
 * 返回值：HeroSpillFactory
 *
 * 异常：无（本函数只构建节点图，不做渲染，不会抛错）
 *
 * 注意事项：
 *  - **必须为每个材质各调一次 makeNode()**：`positionWorld` 这类节点依赖材质上下文
 *    （modelWorldMatrix 等），把同一个节点实例挂到多个材质的 emissiveNode 上有绑错矩阵的风险。
 *    上一版就是共享了单一实例，这也是本轮「整机不可见」的头号嫌疑。
 *  - 光源位置/朝向/半锥角/penumbra 取自 HERO_PROJECTOR（原件实测值）；
 *    只有 spillStrength 是自定系数（见 heroConfig 里的标注）。
 *  - 锥角外的片元不裁剪，只把掩码置 0 —— 避免在节点材质里写分支。
 */
export function createHeroSpillFactory(gobo: THREE.Texture): HeroSpillFactory {
  const [lx, ly, lz] = HERO_PROJECTOR.groupPosition;
  const [tx, ty, tz] = HERO_PROJECTOR.targetLocal;
  // 目标点是相对灯所在 group 的局部坐标 → 世界坐标 = groupPosition + targetLocal
  const targetWorld = new THREE.Vector3(lx + tx, ly + ty, lz + tz);
  const lightPos = new THREE.Vector3(lx, ly, lz);

  // 光源正交基：forward 指向目标；right / up 由 world up 推出
  const fwd = targetWorld.clone().sub(lightPos).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

  // uniform 只建一份：uniform 是纯数据绑定，跨材质共享是安全的（与节点图不同）
  // 注意：gobo **不**包成 uniform —— TSL 的 `texture()` 要求第一参是 `.isTexture === true` 的真贴图，
  //      普通 uniform 的 isTexture 为 undefined，会抛 "TextureNode: Need a three.js texture."
  const uLightPos = T.uniform(lightPos.clone());
  const uFwd = T.uniform(fwd.clone());
  const uRight = T.uniform(right.clone());
  const uUp = T.uniform(up.clone());
  const uTanHalf = T.uniform(Math.tan((HERO_PROJECTOR.halfAngleDeg * Math.PI) / 180));
  const uPenumbra = T.uniform(HERO_PROJECTOR.penumbra);
  const uStrength = T.uniform(HERO_PROJECTOR.spillStrength);

  /**
   * 构建一份新的溅射节点图
   *
   * 功能：用 world 位置做投影，得到「屏幕光按图案洒到该片元上」的加法颜色
   *
   * 参数：无
   *
   * 返回值：TSL 节点（vec3），可直接挂到 MeshStandardNodeMaterial.emissiveNode
   *
   * 异常：无
   *
   * 注意事项：每次调用都重新取 `T.positionWorld` 并重建整条表达式，
   *          因此不同材质拿到的是各自独立的节点图，不存在跨材质共享实例的问题
   */
  const makeNode = () => {
    const p = T.positionWorld;
    const v = p.sub(uLightPos);
    const depth = T.dot(v, uFwd);
    const px = T.dot(v, uRight);
    const py = T.dot(v, uUp);

    // 投影截面上的归一化半径（depth × tanHalf 即该深度处锥半径）
    const denom = T.max(depth, T.float(0.001)).mul(uTanHalf);
    const nx = px.div(denom);
    const ny = py.div(denom);
    const rad = T.length(T.vec2(nx, ny));

    // 锥角掩码（penumbra 羽化）+ 只照光源前方
    const mask = T.float(1).sub(T.smoothstep(T.float(1).sub(uPenumbra), T.float(1), rad));
    const front = T.smoothstep(T.float(0), T.float(0.15), depth);

    // gobo 采样：[-1,1] → [0,1]；纵向翻转让图案方向与屏幕内容一致
    const guv = T.vec2(nx.mul(0.5).add(0.5), T.oneMinus(ny.mul(0.5).add(0.5)));
    const goboCol = T.texture(gobo, guv).rgb;

    return goboCol.mul(mask).mul(front).mul(uStrength);
  };

  return { makeNode, uniforms: { uStrength, uTanHalf, uPenumbra } };
}
