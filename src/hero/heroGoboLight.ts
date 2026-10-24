/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import { HERO_PROJECTOR } from './heroConfig';

/**
 * 带 gobo 投影贴图的聚光灯（three 0.169 WebGPU 没有 SpotLight.map 的正确替代）
 *
 * 背景：原站的屏幕光是**一盏真实的 SpotLight**（`map` = 灯光版视频），把图案调制进
 *      完整 PBR 直接光 —— diffuse×材质反照率（地板光斑贴着材质色）+ specular（键帽
 *      镜面高光）+ NdotL（有明暗面，背面不受光）+ 锥角羽化。r169 的 WebGPURenderer
 *      未实现 spotLightMap（build 里 spotLightMap 出现 0 次），此前用 heroSpill 的
 *      emissiveNode 加法模拟 —— 没有 NdotL、不与材质交互，观感是「整机均匀染色」
 *      而非「光照」，且 background 材质没挂导致地板无光。
 *
 *      本文件照 r169 内置的官方范本 **IESSpotLightNode**（SpotLightNode + 纹理调制）
 *      fork setup()：在 lightColor 上乘 2D gobo 采样。gobo 投影坐标用世界空间解析
 *      投影（与原 heroSpill 同一套数学：光位/朝向/半锥角来自 HERO_PROJECTOR）。
 *
 * 用法：
 *   renderer.nodes.addLight(GoboSpotLightNode, GoboSpotLight);      // 每个renderer一次
 *   const l = new GoboSpotLight(...); l.goboMap = tex;              // 之后当普通 SpotLight 用
 *   scene.add(l);
 *
 * 注意事项：
 *  - gobo 投影原点/朝向写死为 HERO_PROJECTOR（原站灯位常量）——若以后挪灯，
 *    必须同步 HERO_PROJECTOR，否则图案与锥角错位。
 *  - goboMap 每帧被上游（heroScreenLoop）重绘并 needsUpdate，节点只捕获纹理引用，
 *    上传由渲染器按 needsUpdate 自动处理（与屏幕 VideoTexture 同机制）。
 *  - 半径耦合：spotAttenuation 用 light.angle（弧度，原站 20rad 语义 ≈66° 半角），
 *    gobo 投影用 HERO_PROJECTOR.halfAngleDeg（66°）——两者必须一致。
 */
const TSL: any = THREE;

/** 自定义 Light 类：仅为让 renderer.nodes.addLight 有独立映射键，行为与 SpotLight 一致 */
export class GoboSpotLight extends THREE.SpotLight {
  /** gobo 投影贴图（屏幕光图案；替代原站 spotLight.map） */
  goboMap: any = null;
}

// r169 的 SpotLightNode 运行时存在但 d.ts 类型可能缺失 —— 按 mixin 惯例以 any 表达式为基类
const SpotLightNodeCtor = (THREE as any).SpotLightNode;

export class GoboSpotLightNode extends (SpotLightNodeCtor as any) {
  static get type() {
    return 'GoboSpotLightNode';
  }

  setup(builder: any) {
    // ---- 与 SpotLightNode.setup 同构：方向 / 锥角羽化 / 距离衰减 ----
    const lightingModel = builder.context.lightingModel;
    const { colorNode, cutoffDistanceNode, decayExponentNode, light } = this;

    const lVector = TSL.lightViewPosition(light).sub(TSL.positionView);
    const lightDirection = lVector.normalize();
    const angleCos = lightDirection.dot(TSL.lightTargetDirection(light));
    const spotAttenuation = this.getSpotAttenuation(angleCos);

    const lightDistance = lVector.length();
    const lightAttenuation = TSL.getDistanceAttenuation({
      lightDistance,
      cutoffDistance: cutoffDistanceNode,
      decayExponent: decayExponentNode,
    });

    // ---- gobo：世界空间解析投影（原 heroSpill 数学）----
    const [lx, ly, lz] = HERO_PROJECTOR.groupPosition;
    const [tx, ty, tz] = HERO_PROJECTOR.targetLocal;
    const lightPos = TSL.uniform(new THREE.Vector3(lx, ly, lz));
    const fwd = new THREE.Vector3(lx + tx, ly + ty, lz + tz).sub(lightPos.value).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const uFwd = TSL.uniform(fwd.clone());
    const uRight = TSL.uniform(right.clone());
    const uUp = TSL.uniform(up.clone());
    const uTanHalf = TSL.uniform(Math.tan(((HERO_PROJECTOR.halfAngleDeg as number) * Math.PI) / 180));

    const v = TSL.positionWorld.sub(lightPos);
    const depth = TSL.dot(v, uFwd);
    const denom = TSL.max(depth, TSL.float(0.001)).mul(uTanHalf);
    const nx = TSL.dot(v, uRight).div(denom);
    const ny = TSL.dot(v, uUp).div(denom);
    // [-1,1] → [0,1]；纵向翻转让图案方向与屏幕内容一致（原站灯光视频即为翻转版）
    const guv = TSL.vec2(nx.mul(0.5).add(0.5), TSL.oneMinus(ny.mul(0.5).add(0.5)));
    const goboCol = TSL.texture((light as GoboSpotLight).goboMap, guv).rgb;
    // 只照光源前方（depth≤0 的片元锥外/背后）
    const front = TSL.smoothstep(TSL.float(0), TSL.float(0.15), depth);

    // 图案调制进完整直接光：diffuse/specular/NdotL 全部继承 three 的 PBR 管线
    const lightColor = colorNode.mul(spotAttenuation).mul(lightAttenuation).mul(goboCol).mul(front);

    const reflectedLight = builder.context.reflectedLight;
    lightingModel.direct({ lightDirection, lightColor, reflectedLight }, builder.stack, builder);
  }
}
