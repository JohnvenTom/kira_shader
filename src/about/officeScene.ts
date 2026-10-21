/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * About Us 的办公室场景（原件 office 页：`pO` 组件 + `pF` 灯架）
 *
 * 反编译来源（生产包字符偏移）：
 *  - 相机配置（`nZ({pageType:"office"})`）：1,165,046 附近
 *    fov 50 / near .1 / far 500 / basePosition [0,3.1,5] / baseRotation [-.5,0,0]
 *  - 逐帧（imperative handle）：`i = remap(office 页滚动进度)`
 *    `rotation.x = -.6 + .025·mouseY`；`rotation.y = (0.5 - mouseX)·.025`；
 *    `position.z = -4·i + 4.5`（相机随滚动推入）
 *  - 实例网格：6 行 × 7 列 = 42 个 desks（`/models/deskbox.glb`），
 *    `pos = ((t-2)·180+140, 0, (r-5)·140+630+70+30)`、
 *    `rotY = random π`、`scaleY = 1 + (r+t)·.04`；
 *    group: scale .02 / position [9,0,-1] / rotation [0,π+.5,0]
 *  - 灯光：ambient 1；spotLight(1, angle .2, penumbra 1.2, decay .001) at [0,4.5,4] → target [0,-.6,0]；
 *    灯架 `pF`：7 个发光盒（白/绿/蓝）+ 点光（intensity 100 / distance 28 / decay 2）
 *  - 标题：uikit「About Us」fontSize 100 / light，白色 y≈1.502、黑色 y≈1.5，x 轴 -.4rad
 *
 * 与原件一致：所有贴图都取自 GLB 内嵌资源；材质按 MeshStandardNodeMaterial 重建。
 */
export interface AboutOfficeHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setSize: (width: number, height: number) => void;
  /** scrollProgress：office 段 0..1（0=页首远景，1=推入） */
  update: (
    dt: number,
    time: number,
    state: { scrollProgress: number; mouseX: number; mouseY: number; touch?: boolean }
  ) => void;
  dispose: () => void;
}

const GRID_COLS = 7;
const GRID_ROWS = 6;

export function createAboutOfficeScene(width: number, height: number): AboutOfficeHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0b0b');

  const camera = new THREE.PerspectiveCamera(50, width / Math.max(1, height), 0.1, 500);
  camera.position.set(0, 3.1, 5);
  camera.rotation.set(-0.5, 0, 0);

  // ---------- 灯光（原件 ambient + spot + pF 灯架） ----------
  scene.add(new THREE.AmbientLight(0xffffff, 1));

  const spot = new THREE.SpotLight(0xffffff, 1, 0, 0.2, 1.2, 0.001);
  spot.position.set(0, 4.5, 4);
  spot.target.position.set(0, -0.6, 0);
  scene.add(spot, spot.target);

  /** 灯架（原件 `pF`）：发光盒 + 点光，白/绿/蓝三色 */
  const RIG: Array<{
    pos: [number, number, number];
    scale: [number, number, number];
    color: number;
    intensity: number;
    point?: boolean;
  }> = [
    { pos: [-14, 10, 8], scale: [0.1, 2.5, 2.5], color: 0xfffff0, intensity: 32 },
    { pos: [-14, 14, -4], scale: [0.1, 2.5, 2.5], color: 0x00ff0a, intensity: 48, point: true },
    { pos: [14, 12, 0], scale: [0.1, 5, 5], color: 0xfffff0, intensity: 9.2, point: true },
    { pos: [0, 9, 14], scale: [5, 5, 0.1], color: 0x0000ff, intensity: 6.4, point: true },
    { pos: [7, 8, -14], scale: [2.5, 2.5, 0.1], color: 0xfffff0, intensity: 32, point: true },
    { pos: [-7, 16, -14], scale: [2.5, 2.5, 0.1], color: 0xfffff0, intensity: 32, point: true },
    { pos: [0, 20, 0], scale: [0.1, 0.1, 0.1], color: 0xfffff0, intensity: 0.4, point: true },
    { pos: [0, 15, 0], scale: [10, 1, 10], color: 0xfffff0, intensity: 6, point: true },
  ];
  const rigMeshes: THREE.Mesh[] = [];
  const rigGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const def of RIG) {
    // 原件用自定义发光盒当面积光；这里用 MeshBasicMaterial 盒 + 点光近似
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).multiplyScalar(1) });
    const box = new THREE.Mesh(rigGeo, mat);
    box.position.set(...def.pos);
    box.scale.set(...def.scale);
    scene.add(box);
    rigMeshes.push(box);
    if (def.point) {
      const pl = new THREE.PointLight(def.color, 100, 28, 2);
      pl.position.set(...def.pos);
      scene.add(pl);
    }
  }

  // ---------- desks 实例（/models/deskbox.glb） ----------
  const group = new THREE.Group();
  group.scale.setScalar(0.02);
  group.position.set(9, 0, -1);
  group.rotation.set(0, Math.PI + 0.5, 0);
  scene.add(group);

  let disposed = false;
  const instanced: THREE.InstancedMesh[] = [];

  const loader = new GLTFLoader();
  // deskbox.glb 用 Draco 压缩；解码器已本地化到 public/draco（取自 three 发行包）
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  loader.setDRACOLoader(draco);
  loader.load('/models/deskbox.glb', (gltf) => {
    if (disposed) return;
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const dummy = new THREE.Object3D();
    const matrices: THREE.Matrix4[] = [];
    let idx = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let t = 0; t < GRID_COLS; t++) {
        idx++;
        dummy.scale.set(1, 1 + (r + t) * 0.04, 1);
        dummy.position.set((t - 2) * 180 + 140, 0, (r - 5) * 140 + 630 + 70 + 30);
        dummy.rotation.set(0, Math.random() > 0.5 ? Math.PI : 0, 0);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }
    }
    for (const src of meshes) {
      const mat = src.material as THREE.MeshStandardMaterial;
      const cloned = new THREE.MeshStandardMaterial({
        color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
        map: mat.map ?? null,
        normalMap: mat.normalMap ?? null,
        normalScale: mat.normalScale ? mat.normalScale.clone() : undefined,
        roughness: 0.4,
        metalness: mat.metalness ?? 0,
      });
      const im = new THREE.InstancedMesh(src.geometry, cloned, matrices.length);
      matrices.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
      instanced.push(im);
    }
  });

  const setSize = (w: number, h: number) => {
    camera.aspect = Math.max(1, w) / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  setSize(width, height);

  const update: AboutOfficeHandle['update'] = (_dt, _time, state) => {
    const i = Math.max(0, Math.min(1, state.scrollProgress));
    const touch = state.touch ?? false;
    camera.rotation.x = -0.6 + 0.025 * state.mouseY;
    camera.rotation.y = touch ? 0 : (0.5 - state.mouseX) * 0.025;
    camera.position.z = -4 * i + 4.5;
  };

  const dispose = () => {
    disposed = true;
    for (const im of instanced) {
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      group.remove(im);
    }
    instanced.length = 0;
    for (const m of rigMeshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    rigGeo.dispose();
  };

  return { scene, camera, setSize, update, dispose };
}
