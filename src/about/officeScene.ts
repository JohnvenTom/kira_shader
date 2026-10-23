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

  /** 灯架（原件 `pF`）：矩形面光（发光盒）+ 点光，白/绿/蓝三色 */
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
  const rigLights: THREE.PointLight[] = [];
  for (const def of RIG) {
    // 原件 n5 发光盒在本构建的 WebGPU 下无 RectAreaLight（LTC 缺失），
    // 用高衰减点光近似主光，再用一盏宽点光补亮桌面
    const pl = new THREE.PointLight(def.color, def.point ? 100 : def.intensity * 2.2, 28, 2);
    pl.position.set(...def.pos);
    scene.add(pl);
    rigLights.push(pl);
  }

  // ---------- desks 实例（/models/deskbox.glb） ----------
  const group = new THREE.Group();
  group.scale.setScalar(0.02);
  group.position.set(9, 0, -1);
  group.rotation.set(0, Math.PI + 0.5, 0);
  scene.add(group);

  // ---------- About Us 标题（原件 uikit 文本的 Canvas 复刻） ----------
  // 原件：白色 [−0.01, 1.502, 0.001] / 黑色 [0, 1.5, 0]，绕 X −0.4rad，fontSize 100（light）
  const makeTitleTexture = (color: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '300 210px "STIX Two Text", "Times New Roman", serif';
    ctx.fillText('About Us', canvas.width / 2, canvas.height / 2 + 6);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  };
  const titleGeo = new THREE.PlaneGeometry(5.0, 1.56);
  const makeTitle = (color: string, pos: [number, number, number]) => {
    const tex = makeTitleTexture(color);
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.map = tex as any;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.toneMapped = false;
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(titleGeo, mat);
    mesh.position.set(...pos);
    mesh.rotation.set(-0.4, 0, 0);
    mesh.renderOrder = 10;
    scene.add(mesh);
    return { mesh, mat, tex };
  };
  const titleWhite = makeTitle('#ffffff', [-0.01, 1.502, 0.001]);
  const titleBlack = makeTitle('#111111', [0, 1.5, 0]);
  titleBlack.mesh.visible = false;

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
    // 原站 office 场景在 fade 阶段（office 页首之前）也会被渲染，progress 可为负
    const i = Math.max(-0.25, Math.min(1, state.scrollProgress));
    const touch = state.touch ?? false;
    camera.rotation.x = -0.6 + 0.025 * state.mouseY;
    camera.rotation.y = touch ? 0 : (0.5 - state.mouseX) * 0.025;
    camera.position.z = -4 * i + 4.5;
  };

  const dispose = () => {
    disposed = true;
    titleGeo.dispose();
    for (const t of [titleWhite, titleBlack]) {
      t.mat.dispose();
      t.tex.dispose();
      scene.remove(t.mesh);
    }
    for (const im of instanced) {
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      group.remove(im);
    }
    instanced.length = 0;
    for (const m of rigLights) {
      scene.remove(m);
      m.dispose();
    }
  };

  return { scene, camera, setSize, update, dispose };
}
