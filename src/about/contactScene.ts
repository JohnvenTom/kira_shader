/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * Contact 场景（原件 contact 段：`phones.glb` 里的三台电话 + 摄影棚弧幕）
 *
 * 模型自带背景壳与电话本体，节点坐标已经按原件镜头摆好：
 *   电话组世界包围盒约 x[-12.4, 14.3] / y[-5, 11.4] / z[-3, 24.6]
 *   背景壳是反向大房间（x ±64.5 / y -0.1..77 / z -65..37）
 * 相机位于 z≈33、y≈9（壳体正面在 z≈35，出壳会被前壁挡黑），
 * 朝电话组中心略上方看，让 Hello 留出画面上方空间。
 *
 * 复刻要点：
 *  - 原件把 phones.glb 整体渲染，背景壳提供暗房底色；再补一块加法柔光板
 *  - 三点光：右上前暖主光 + 左中冷补光 + 后方暖轮廓光
 *  - 滚动时相机缓慢推近，鼠标做轻微视差
 */
export interface AboutContactHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** GLB 加载完成（或失败）后 resolve */
  ready: Promise<void>;
  setSize: (width: number, height: number) => void;
  /**
   * @param progress contact 段整体进度 0..1（驱动极轻微推近）
   * @param enter    入场进度 0..1（0.35 屏内从高处落到最终机位）
   */
  update: (
    dt: number,
    time: number,
    state: { progress: number; enter: number; mouseX: number; mouseY: number; touch?: boolean }
  ) => void;
  dispose: () => void;
}

const BASE = {
  x: 0.2,
  lookX: 0.2,
  lookY: 4.8,
  lookZ: 10.8,
  // 背景壳正面在 z≈35 附近：相机必须留在壳内，否则会被前壁整块挡住
  farY: 10.4,
  farZ: 34.6,
  nearY: 8.8,
  nearZ: 33.4,
};

export function createAboutContactScene(width: number, height: number): AboutContactHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#040405');

  const camera = new THREE.PerspectiveCamera(54, Math.max(1, width) / Math.max(1, height), 0.1, 400);
  camera.position.set(BASE.x, BASE.nearY, BASE.nearZ);
  const look = new THREE.Vector3(BASE.lookX, BASE.lookY, BASE.lookZ);
  camera.lookAt(look);

  // ---------- 灯光 ----------
  scene.add(new THREE.AmbientLight(0xd8dae4, 0.8));

  const key = new THREE.DirectionalLight(0xfff5e8, 2.6);
  key.position.set(10, 15, 22);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xa8baff, 0.95);
  fill.position.set(-12, 4, 18);
  scene.add(fill);

  const rim = new THREE.PointLight(0xff9a78, 150, 60, 2);
  rim.position.set(-2, 5, -4);
  scene.add(rim);

  const bounce = new THREE.DirectionalLight(0xffeedd, 0.55);
  bounce.position.set(-4, 1, 30);
  scene.add(bounce);

  // ---------- 背景柔光 ----------
  // 模型自带壳体的远墙几乎全黑；补一块加法混合的柔光板，托住电话的轮廓
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 512;
  glowCanvas.height = 512;
  const gctx = glowCanvas.getContext('2d')!;
  const grad = gctx.createRadialGradient(256, 278, 10, 256, 256, 258);
  grad.addColorStop(0, 'rgba(210, 200, 182, 0.32)');
  grad.addColorStop(0.42, 'rgba(150, 142, 130, 0.14)');
  grad.addColorStop(1, 'rgba(80, 78, 74, 0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 512, 512);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const glowGeo = new THREE.PlaneGeometry(76, 46);
  const glowMat = new THREE.MeshBasicNodeMaterial();
  glowMat.map = glowTex;
  glowMat.transparent = true;
  glowMat.depthWrite = false;
  glowMat.toneMapped = false;
  glowMat.blending = THREE.AdditiveBlending;
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(1.2, 9.5, -16);
  scene.add(glow);

  // ---------- 模型 ----------
  const modelRoot = new THREE.Group();
  scene.add(modelRoot);

  const loader = new GLTFLoader();
  // phones.glb 与 deskbox.glb 一样是 Draco 压缩，解码器用本地 public/draco
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  loader.setDRACOLoader(draco);
  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  let disposed = false;

  const loadedMaterials = new Set<THREE.Material>();
  const loadedTextures = new Set<THREE.Texture>();

  loader.load(
    '/asset/models/phones.glb',
    (gltf) => {
      if (disposed) {
        resolveReady();
        return;
      }
      gltf.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const raw of mats) {
          const mat = raw as THREE.MeshStandardMaterial;
          if (!mat) continue;
          loadedMaterials.add(mat);
          const anyMat = mat as any;
          if (anyMat.map) loadedTextures.add(anyMat.map);
          if (anyMat.normalMap) loadedTextures.add(anyMat.normalMap);
          // 摄影棚壳从内部观看：必须双面，否则整块背景被背面剔除
          if (mesh.name === 'background' || obj.name === 'background') {
            mat.side = THREE.DoubleSide;
            mesh.frustumCulled = false;
          }
          mat.envMapIntensity = 0.7;
        }
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      });
      // 把摄影棚壳留在原地，只把电话组绕自身中心转 180°：
      // 原模型电话面板朝 -z，而镜头在 +z；不转的话只能看到话筒背面
      const root = gltf.scene;
      const background = root.getObjectByName('background');
      if (background) {
        root.remove(background);
        scene.add(background);
      }
      const pivot = new THREE.Group();
      pivot.position.set(0.9, 3.25, 10.8);
      pivot.rotation.y = Math.PI;
      root.position.set(-0.9, -3.25, -10.8);
      pivot.add(root);
      modelRoot.add(pivot);
      resolveReady();
    },
    undefined,
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[Contact] phones.glb 加载失败：', err);
      resolveReady();
    }
  );

  function resolveReady() {
    if (readyResolve) {
      readyResolve();
      readyResolve = null;
    }
  }

  const setSize = (w: number, h: number) => {
    const aspect = Math.max(1, w) / Math.max(1, h);
    camera.aspect = aspect;
    // 竖屏把 FOV 放宽一点，让三台电话都留在画面里
    camera.fov = aspect < 0.72 ? 70 : aspect < 1.05 ? 60 : 54;
    camera.updateProjectionMatrix();
  };
  setSize(width, height);

  const smoothMouse = { x: 0, y: 0 };
  const update: AboutContactHandle['update'] = (dt, time, state) => {
    const p = Math.max(0, Math.min(1, state.progress));
    const enter = Math.max(0, Math.min(1, state.enter));
    const touch = state.touch ?? false;

    const targetX = touch ? 0 : state.mouseX;
    const targetY = touch ? 0 : state.mouseY;
    const ease = 1 - Math.exp(-4.5 * Math.min(0.05, dt));
    smoothMouse.x += (targetX - smoothMouse.x) * ease;
    smoothMouse.y += (targetY - smoothMouse.y) * ease;

    // 入场：从高处远景落到电话通高的机位；之后随 contact 段推进极轻推近
    const e = enter * enter * (3 - 2 * enter);
    const baseY = BASE.farY + (BASE.nearY - BASE.farY) * e;
    const baseZ = BASE.farZ + (BASE.nearZ - BASE.farZ) * e;
    const drift = Math.sin(time * 0.24) * 0.06;
    camera.position.set(
      BASE.x + smoothMouse.x * 0.55,
      baseY - smoothMouse.y * 0.25 + drift,
      baseZ - p * 0.9
    );
    look.set(
      BASE.lookX + smoothMouse.x * 0.18,
      BASE.lookY - smoothMouse.y * 0.12 + drift * 0.4,
      BASE.lookZ
    );
    camera.lookAt(look);
  };

  const dispose = () => {
    disposed = true;
    resolveReady();
    glowGeo.dispose();
    glowMat.dispose();
    glowTex.dispose();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry?.dispose();
    });
    for (const mat of loadedMaterials) mat.dispose();
    for (const tex of loadedTextures) tex.dispose();
    loadedMaterials.clear();
    loadedTextures.clear();
    scene.remove(modelRoot);
  };

  return { scene, camera, ready, setSize, update, dispose };
}
