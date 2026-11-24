/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * cx 星星阵列共享工厂 —— 「Still Not Convinced We're Serious About Business?」页内段
 * （goldenTieRevealScene）与 P2 跨段导航转场（starTransitionScene）共用的组件实现。
 * 原站两个上下文挂的是同一个 cx 组件族，样式/运动/灯光必须只有一份实现。
 *
 * 反编译来源（_bundles/full/04kr7kd5riobb.js）：
 *   cB（38469）：10 角星 Shape —— 半径 t%2==0?2:1，angle=t/10·2π−π/2。
 *   cv（38476）：单颗星。主网格：3D=ExtrudeGeometry(depth .2, bevel 2/.01/.01)+
 *               MeshStandardNodeMaterial（metal .5 rough .05 color rgb(255,255,80)
 *               +opacityNode uniform）。内芯（useInnerStar）：scale .85、z+.13、
 *               ExtrudeGeometry(depth .1 无倒角)，MeshBasicNodeMaterial depthTest=false、
 *               colorNode=texture(nextSceneTexture, screenCoordinate÷resolution).rgb、
 *               opacityNode=uniform。flat 星是红色 opacity 恒 0 的调试残留，且
 *               cb 从不给它 updateHandle（opacity 恒 0 不可见）——两上下文都省略。
 *   cb（38600）：7 颗 3D。progress：3D[i] a=nL(p−0.15i,0,1)；全轨道
 *               x=14cos(1.5πa)·o+0.2、y=6cos(1.5πa)、z=30cos(πa+π/2)、
 *               rotY=rotZ=2πa、rotX=0；o=clamp(width/1920,.4,.75)；
 *               主网格 opacity=nL(nM(a,.05,.3,0,1),0,1)。
 *               领头星 3D[0]：cb 用独立 handle 喂满进度+真实 nextSceneTexture →
 *               z 覆盖 25cos(πp+π/2)、scale.set(n,n,1)（**z 恒 1**，n=nM(p,.96,1,1,2)）、
 *               内芯 opacity=nL(nM(p,.8,.9,0,1),0,1)、内芯纹理换目标页。
 *   cx（38890）：壳体 lift lerp [0,−8,−5]→[0,−8,0]（progress 驱动）+ cardsGroup z=4.3；
 *               ambientLight + cS Lightformer rig（本地校准=PMREM env 面板 1.25
 *               + key/rim/gold 三点光，与 goldenTieReveal 校准值逐位一致）。
 */

const T = TSL as any;

function starShape(): THREE.Shape {
  const shape = new THREE.Shape();
  for (let t = 0; t < 10; t++) {
    const r = t % 2 === 0 ? 2 : 1;
    const i = (t / 10) * Math.PI * 2 - Math.PI / 2;
    const x = r * Math.cos(i);
    const y = r * Math.sin(i);
    if (t === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 原站 nM：把 x 从 [a,b] 映射到 [c,d]（端点外 clamp） */
const nM = (x: number, a: number, b: number, c: number, d: number) =>
  c + (d - c) * clamp01((x - a) / (b - a));

export interface CxStarArray {
  /** cx 壳体 lift：宿主挂进自己的层级（页内 [-0.025,1.6,3.98]×0.2 / 转场 [0,8,0]） */
  lift: THREE.Group;
  /**
   * 推进星星阵列。nextSceneTexture/resolution 只在领头星内芯使用：
   * 纹理必须是**当帧已渲出内容**的 RT（采样未渲染 RT → WebGPU pipeline invalid 整帧弃），
   * resolution = 该 RT 的像素尺寸（screenCoordinate 除数）。
   */
  update(
    progress: number,
    cssW: number,
    nextSceneTexture?: THREE.Texture | null,
    resW?: number,
    resH?: number,
  ): void;
  dispose(): void;
}

export function createCxStarArray(renderer: THREE.WebGPURenderer, scene: THREE.Scene): CxStarArray {
  // ---- 几何（cB shape + cv 主/内芯参数）----
  const shape = starShape();
  const mainGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.01,
    bevelThickness: 0.01,
  });
  const innerGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
  const emptyTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  emptyTex.needsUpdate = true;

  // ---- cx 壳体：lift + cardsGroup(z=4.3) ----
  const lift = new THREE.Group();
  const cardsGroup = new THREE.Group();
  cardsGroup.position.set(0, 0, 4.3);
  lift.add(cardsGroup);

  interface Card {
    group: THREE.Group;
    opacity: { value: number };
    isLeader: boolean;
    innerOpacity?: { value: number };
    innerUniforms?: { texNode: { value: THREE.Texture }; resolution: { value: THREE.Vector2 } };
  }
  const cards: Card[] = [];
  const gold = T.color('rgb(255, 255, 80)');

  for (let i = 0; i < 7; i++) {
    const group = new THREE.Group();
    const opacity = T.uniform(0);
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.metalness = 0.5;
    mat.roughness = 0.05;
    mat.colorNode = gold;
    mat.transparent = true;
    mat.opacityNode = opacity;
    group.add(new THREE.Mesh(mainGeo, mat));

    const card: Card = { group, opacity, isLeader: i === 0 };
    if (i === 0) {
      const innerMat = new THREE.MeshBasicNodeMaterial();
      innerMat.transparent = true;
      innerMat.depthTest = false;
      innerMat.depthWrite = false;
      innerMat.toneMapped = false;
      const resolution = T.uniform(new THREE.Vector2(1, 1));
      const texNode = T.texture(emptyTex, T.screenCoordinate.div(resolution));
      const innerOpacity = T.uniform(0);
      innerMat.colorNode = T.vec4(texNode.rgb, 1);
      innerMat.opacityNode = innerOpacity;
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.scale.setScalar(0.85);
      inner.position.z = 0.13;
      inner.renderOrder = 20;
      group.add(inner);
      card.innerOpacity = innerOpacity;
      card.innerUniforms = { texNode, resolution };
    }
    cardsGroup.add(group);
    cards.push(card);
  }

  // ---- 灯光 rig（cS 的本地校准；两上下文同一 cx → 同一 rig，与 goldenTieReveal 逐位一致）----
  let envRT: THREE.RenderTarget | null = null;
  try {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#0a0908');
    const panel = (color: number[], pos: number[], size: [number, number]) => {
      const mat = new THREE.MeshBasicNodeMaterial();
      mat.colorNode = T.vec4(T.vec3(color[0], color[1], color[2]), 1);
      mat.side = THREE.DoubleSide;
      mat.toneMapped = false;
      const geo = new THREE.PlaneGeometry(size[0], size[1]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.lookAt(0, 0, 0);
      envScene.add(mesh);
    };
    panel([7.5, 6.4, 4.6], [2, 5, 5], [10, 6]);
    panel([4.2, 3.6, 2.4], [-5, 1, 4], [6, 4]);
    panel([2.2, 2.8, 5.2], [5, -1, 3], [5, 5]);
    panel([6.0, 5.4, 4.0], [0, -5, 2], [8, 5]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 1.25;
  } catch {
    // 环境贴图失败时仅靠灯光
  }
  scene.add(new THREE.AmbientLight(0xfff2e6, 0.6));
  const key = new THREE.PointLight(0xfff1d8, 30, 30, 2);
  key.position.set(2, 3, 6);
  scene.add(key);
  const rim = new THREE.PointLight(0xbcd0ff, 22, 30, 2);
  rim.position.set(-3, 1, 4);
  scene.add(rim);
  const goldLight = new THREE.PointLight(0xffd27a, 18, 25, 2);
  goldLight.position.set(0.5, -2, 7);
  scene.add(goldLight);

  // ---- 运动公式（cb + cv index0 覆盖）----
  const liftA = new THREE.Vector3(0, -8, -5);
  const liftB = new THREE.Vector3(0, -8, 0);

  return {
    lift,
    update(progress, cssW, nextSceneTexture, resW, resH) {
      const p = clamp01(progress);
      lift.position.lerpVectors(liftA, liftB, p);
      const o = Math.min(Math.max(cssW / 1920, 0.4), 0.75);

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const a = clamp01(p - 0.15 * i);
        // 全轨道（cb 循环：位置+旋转对所有 3D 星统一设置）
        card.group.position.set(
          14 * Math.cos(a * Math.PI * 1.5) * o + 0.2,
          6 * Math.cos(a * Math.PI * 1.5),
          30 * Math.cos(a * Math.PI + Math.PI * 0.5),
        );
        card.group.rotation.set(0, a * Math.PI * 2, a * Math.PI * 2);
        card.opacity.value = nM(a, 0.05, 0.3, 0, 1);

        if (card.isLeader) {
          // cv index0 覆盖：z=25cos(满进度)、scale.set(n,n,1)、内芯 opacity/纹理
          card.group.position.z = 25 * Math.cos(p * Math.PI + Math.PI * 0.5);
          const n = nM(p, 0.96, 1, 1, 2);
          card.group.scale.set(n, n, 1);
          if (card.innerOpacity) card.innerOpacity.value = nM(p, 0.8, 0.9, 0, 1);
          if (card.innerUniforms) {
            if (nextSceneTexture !== undefined) {
              card.innerUniforms.texNode.value = nextSceneTexture ?? emptyTex;
            }
            if (resW && resH) card.innerUniforms.resolution.value.set(resW, resH);
          }
        }
      }
    },
    dispose() {
      mainGeo.dispose();
      innerGeo.dispose();
      emptyTex.dispose();
      for (const card of cards) {
        const mat = card.group.children[0] as THREE.Mesh;
        (mat.material as THREE.Material).dispose();
      }
      scene.environment = null;
      envRT?.dispose();
    },
  };
}
