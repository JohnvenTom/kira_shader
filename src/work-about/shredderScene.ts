/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { AboutPaperResult } from './paperContent';

/**
 * 碎纸终幕 1:1 复刻（反编译自 shader.se 生产包 04kr7kd5riobb.js，字符偏移 665k..690k）
 *
 * 原件结构：
 *  - 透视相机 fov 65 / position [0,0,5]，场景平面 z=0 的可见高度约 6.37 世界单位
 *  - /models/shredder.glb：rotation.x = π/2；scale = .19·(viewportWidth/6.5)，
 *    窄屏（<600px）scale = .5·(viewportWidth/6.5)；y = progress·viewportHeight − .5·viewportHeight，
 *    cogs.rotation.x = −progress·π·3
 *  - 纸条：stripCount = 96/64/32/24（>1200/>900/>600/其余），每条 64 段，3 张 FloatType
 *    位置纹理乒乓，Verlet 积分 + 距离约束 + 噪声 + 鼠标斥力
 *  - 纸页与纸条都在同一透视相机下按 viewport 世界尺寸铺满屏幕
 *
 * 本文件把这套结构从 React/R3F 移植成 imperative three/webgpu。
 */

const T = TSL as any;

export interface ShredderUpdateState {
  /** 0..1 碎纸进度 */
  shred: number;
  /** 秒 */
  time: number;
  /** 帧间隔（秒） */
  dt: number;
  /** CTA 纸页在屏幕顶部对应的设计像素 */
  ctaTop: number;
  /** -1..1 */
  mouseX: number;
  mouseY: number;
}

export interface ShredderSceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setSize: (width: number, height: number) => void;
  /** 每次进入碎纸段时调用，重置布条模拟 */
  reset: () => void;
  update: (renderer: THREE.WebGPURenderer, state: ShredderUpdateState) => Promise<void>;
  dispose: () => void;
  /** 调试/验收用，页面 probe 可读 */
  debug: {
    targets: THREE.RenderTarget[];
    current: () => number;
    initialized: () => boolean;
    strips: THREE.InstancedMesh[];
    uniforms: any;
  };
}

const CAMERA_Z = 5;
const FOV = 65;
const STRIP_VERTICES_Y = 64;
const DEG = Math.PI / 180;

function stripCountFor(width: number) {
  return width > 1200 ? 96 : width > 900 ? 64 : width > 600 ? 32 : 24;
}

function createFullscreenQuad() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicNodeMaterial());
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { scene, camera, mesh, geometry };
}

function makeFloatTarget(w: number, h: number) {
  const rt = new THREE.RenderTarget(w, h, {
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  rt.texture.generateMipmaps = false;
  return rt;
}

export function createShredderScene(
  renderer: THREE.WebGPURenderer,
  paper: AboutPaperResult,
  width: number,
  height: number
): ShredderSceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#02030a');
  const camera = new THREE.PerspectiveCamera(FOV, Math.max(1, width) / Math.max(1, height), 0.1, 100);
  camera.position.set(0, 0, CAMERA_Z);
  camera.lookAt(0, 0, 0);

  let vh = 2 * CAMERA_Z * Math.tan(FOV * 0.5 * DEG);
  let vw = vh * (width / Math.max(1, height));
  let stripCount = stripCountFor(width);
  let sheetW = paper.ctaSheet.width;
  let sheetH = paper.ctaSheet.height;
  let visibleDesignH = sheetW * (height / Math.max(1, width));

  const ctaTexture = paper.ctaSheet.texture;

  // ---------------------------------------------------------------------------
  // 背景蓝光（沿用之前终幕的色值）
  // ---------------------------------------------------------------------------
  const bgUniforms = {
    aspect: T.uniform(width / Math.max(1, height)),
  };
  const bgMat = new THREE.MeshBasicNodeMaterial();
  {
    const uv = T.uv();
    const p = T.vec2(uv.x.sub(0.5).mul(bgUniforms.aspect), uv.y.sub(0.22));
    const glow = T.smoothstep(1.05, 0.0, T.length(p));
    const blue = T.mix(
      T.vec3(0.0012, 0.0016, 0.006),
      T.vec3(0.016, 0.019, 0.12),
      T.min(glow.mul(glow).mul(glow).mul(1.15), 1)
    );
    const blueTop = T.mix(blue, T.vec3(0.001, 0.0015, 0.006), T.smoothstep(0.55, 1.0, uv.y).mul(0.7));
    const grainHash = T.fract(
      T.sin(T.dot(uv.mul(T.vec2(1920.0, 1080.0)), T.vec2(12.9898, 78.233))).mul(43758.5453)
    );
    const vig = T.smoothstep(1.3, 0.25, T.length(T.vec2(uv.x.sub(0.5).mul(bgUniforms.aspect), uv.y.sub(0.5))));
    bgMat.colorNode = T.vec4(blueTop.add(grainHash.sub(0.5).mul(0.02)).mul(T.mix(0.72, 1.0, vig)), 1);
    bgMat.toneMapped = false;
    bgMat.depthTest = false;
    bgMat.depthWrite = false;
  }
  const bgGeo = new THREE.PlaneGeometry(1, 1);
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  bgMesh.position.z = 0;
  bgMesh.renderOrder = -10;
  bgMesh.frustumCulled = false;
  scene.add(bgMesh);

  // ---------------------------------------------------------------------------
  // 纸页：全屏平面，slot 以下 discard
  // ---------------------------------------------------------------------------
  const paperUniforms = {
    contentTop: T.uniform(0),
    visibleH: T.uniform(visibleDesignH),
    sheetH: T.uniform(sheetH),
    slotUvY: T.uniform(0),
  };
  const paperMat = new THREE.MeshBasicNodeMaterial();
  {
    const build = T.Fn(() => {
    const uv = T.uv();
    const designY = paperUniforms.contentTop.add(T.float(1).sub(uv.y).mul(paperUniforms.visibleH));
    const texV = T.float(1).sub(designY.div(paperUniforms.sheetH));
    const col = T.texture(ctaTexture, T.vec2(uv.x, T.clamp(texV, 0, 1)));
    const slotShade = T.mix(0.62, 1.0, T.smoothstep(paperUniforms.slotUvY, paperUniforms.slotUvY.add(0.09), uv.y));
    T.If(uv.y.lessThan(paperUniforms.slotUvY), () => {
      T.Discard();
    });
    T.If(designY.greaterThan(paperUniforms.sheetH), () => {
      T.Discard();
    });
    const grain = T.fract(
      T.sin(T.dot(uv.mul(T.vec2(1440.0, 1400.0)), T.vec2(12.9898, 78.233))).mul(43758.5453)
    ).sub(0.5).mul(0.02);
    return T.vec4(col.rgb.mul(slotShade).add(grain), 1);
    });
    paperMat.colorNode = build();
    paperMat.toneMapped = false;
    paperMat.depthTest = false;
    paperMat.depthWrite = false;
  }
  const paperGeo = new THREE.PlaneGeometry(1, 1);
  const paperMesh = new THREE.Mesh(paperGeo, paperMat);
  paperMesh.position.z = 0;
  paperMesh.renderOrder = 0;
  paperMesh.frustumCulled = false;
  scene.add(paperMesh);

  // ---------------------------------------------------------------------------
  // 碎纸机模型 shredder.glb
  // ---------------------------------------------------------------------------
  const modelGroup = new THREE.Group();
  scene.add(modelGroup);
  let cogs: THREE.Object3D | null = null;
  let modelReady = false;
  let disposed = false;
  const modelMaterials: THREE.Material[] = [];
  const modelGeometries: THREE.BufferGeometry[] = [];

  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  loader.setDRACOLoader(draco);
  loader.load(
    '/asset/models/shredder.glb',
    (gltf) => {
      if (disposed) return;
      const root = gltf.scene;
      cogs = root.getObjectByName('cogs') ?? null;
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.renderOrder = 10;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        modelGeometries.push(mesh.geometry);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (!mat) return;
        // 原件根据材质名替换：主体 / 两个 logo / cogs
        if (mat.name === 'Material') {
          mat.color.set('#ffffff');
          mat.roughness = 0.05;
          mat.metalness = 0.99;
        } else if (mat.name === 'shader-logo') {
          mat.color.set('#ffffff');
          mat.roughness = 0.05;
          mat.metalness = 1;
          mat.emissive = new THREE.Color('#ffffff');
          mat.emissiveIntensity = 2;
          if (mat.map) mat.emissiveMap = mat.map;
        } else if (mat.name === 'beige-logo') {
          mat.color.set('#ffffff');
          mat.roughness = 0.4;
          mat.metalness = 0;
        }
        mat.envMapIntensity = 1.1;
        modelMaterials.push(mat);
      });
      const cogsMesh = cogs as THREE.Mesh | null;
      if (cogsMesh) {
        const cogMat = new THREE.MeshStandardMaterial({
          roughness: 0.2,
          metalness: 1,
          color: new THREE.Color('#999999'),
        });
        cogMat.envMapIntensity = 1.2;
        cogsMesh.material = cogMat;
        modelMaterials.push(cogMat);
      }
      root.rotation.set(Math.PI / 2, 0, 0);
      modelGroup.add(root);
      modelReady = true;
    },
    undefined,
    (err) => {
      // eslint-disable-next-line no-console
      console.warn('[Shredder] shredder.glb 加载失败：', err);
    }
  );

  // 简易摄影棚环境贴图：原件用 ring/box 面光，这里用 PMREM 生成金属反射
  let envRT: THREE.RenderTarget | null = null;
  const envGeos: THREE.BufferGeometry[] = [];
  const envMats: THREE.Material[] = [];
  try {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#08080b');
    const panel = (
      color: [number, number, number],
      pos: [number, number, number],
      size: [number, number]
    ) => {
      const mat = new THREE.MeshBasicNodeMaterial();
      mat.colorNode = T.vec4(T.vec3(color[0], color[1], color[2]), 1);
      mat.side = THREE.DoubleSide;
      mat.toneMapped = false;
      const geo = new THREE.PlaneGeometry(size[0], size[1]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.lookAt(0, 0, 0);
      envScene.add(mesh);
      envGeos.push(geo);
      envMats.push(mat);
    };
    panel([5.5, 5.2, 4.8], [0, 5, 5], [7, 4]);
    panel([2.2, 1.6, 1.1], [-5, 2, 4], [4, 3]);
    panel([0.7, 0.9, 1.8], [6, -1, 3], [4, 3]);
    panel([1.5, 1.4, 1.2], [0, -4, 2], [6, 3]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    envRT = pmrem.fromScene(envScene, 0.035);
    scene.environment = envRT.texture;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Shredder] 环境贴图生成失败，退回直射光：', err);
  }
  scene.add(new THREE.AmbientLight(0xb8bcc8, 0.35));
  const keyLight = new THREE.DirectionalLight(0xfff4e4, 2.4);
  keyLight.position.set(4, 5, 7);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0xffc89a, 28, 25, 2);
  rimLight.position.set(-4, 2, 3);
  scene.add(rimLight);

  // ---------------------------------------------------------------------------
  // Verlet 布条模拟（原件 Av/Ad）
  // ---------------------------------------------------------------------------
  const quad = createFullscreenQuad();
  const simScene = quad.scene;
  const simCamera = quad.camera;

  let simUniforms = createSimUniforms(stripCount);
  let simTargets: THREE.RenderTarget[] = [];
  let simCurrent = 0;
  let simInitialized = false;
  let simAge = 0;
  let restMat: THREE.MeshBasicNodeMaterial;
  let integrateMats: THREE.MeshBasicNodeMaterial[] = [];
  let constraintMats: THREE.MeshBasicNodeMaterial[] = [];
  let stripGroup = new THREE.Group();
  scene.add(stripGroup);
  let stripMeshes: THREE.InstancedMesh[] = [];
  let stripGeo: THREE.PlaneGeometry | null = null;
  const stripUniforms = createStripUniforms();

  function createStripUniforms() {
    return {
      stripCount: T.uniform(0),
      viewport: T.uniform(new THREE.Vector2(1, 1)),
      texelSizeX: T.uniform(1),
      texelSizeY: T.uniform(1),
      contentTop: T.uniform(0),
      visibleH: T.uniform(visibleDesignH),
      contentSpan: T.uniform(visibleDesignH),
      sheetH: T.uniform(sheetH),
      slotY: T.uniform(0),
      opacity: T.uniform(1),
    };
  }

  function createSimUniforms(count: number) {
    return {
      positionOffsetY: T.uniform(0),
      extraOffset: T.uniform(0),
      timestep: T.uniform(0.016),
      restDistanceX: T.uniform(1 / (2 * count)),
      restDistanceY: T.uniform(1 / (STRIP_VERTICES_Y - 1)),
      stiffness: T.uniform(1.2),
      texelSizeX: T.uniform(1 / (3 * count)),
      uTexelSizeY: T.uniform(1 / STRIP_VERTICES_Y),
      time: T.uniform(0),
      topConstraint: T.uniform(0.95),
      numStrips: T.uniform(count),
      mousePositionX: T.uniform(0),
      mousePositionY: T.uniform(0),
      mouseInfluence: T.uniform(0),
      deltaFactor: T.uniform(1),
    };
  }

  function hash2(p: any) {
    return T.fract(T.sin(T.dot(p, T.vec2(12.9898, 78.233))).mul(43758.5453));
  }

  function noise2(p: any) {
    const f = T.fract(p);
    const i = T.floor(p);
    const w = f.mul(f).mul(T.vec2(3).sub(f.mul(2)));
    const a = hash2(i);
    const b = hash2(i.add(T.vec2(1, 0)));
    const c = hash2(i.add(T.vec2(0, 1)));
    const d = hash2(i.add(T.vec2(1, 1)));
    return T.mix(T.mix(a, b, w.x), T.mix(c, d, w.x), w.y);
  }

  function fbm2(p: any) {
    return noise2(p)
      .mul(0.5)
      .add(noise2(p.mul(2)).mul(0.25))
      .add(noise2(p.mul(4)).mul(0.125));
  }

  function restPos(uv: any, count: any) {
    const strip = T.floor(uv.x.mul(count)).div(count);
    const x = strip.add(uv.x.sub(strip).mul(2)).sub(T.float(0.5).div(count));
    return T.vec3(x, uv.y, 0);
  }

  function relax(p: any, neighbor: any, restDist: any, stiffness: any) {
    const dir = neighbor.sub(p);
    const len = T.length(dir);
    const out = T.vec3(p).toVar();
    T.If(len.greaterThanEqual(restDist), () => {
      out.assign(p.add(dir.div(T.max(len, 1e-6)).mul(len.sub(restDist)).mul(0.5).mul(stiffness)));
    });
    return out;
  }

  function buildIntegrateMat(tex: THREE.Texture, prevTex: THREE.Texture) {
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.toneMapped = false;
    mat.depthTest = false;
    mat.depthWrite = false;
    const build = T.Fn(() => {
      const u = simUniforms;
      const uv = T.uv();
      const curr = T.texture(tex, uv).xyz;
      const prev = T.texture(prevTex, uv).xyz;
      // 原件速度衰减 0.99999；这里加一点阻尼，让垂落的纸条不会横向飞散
      const vel = curr.sub(prev).mul(0.985);

      const tw = u.time.mul(0.2);
      const wobble = T.vec3(
        fbm2(uv.mul(5).add(T.vec2(tw, 0))).sub(0.5).mul(1.2).mul(0.4),
        fbm2(uv.mul(5).add(T.vec2(0, tw.add(10)))).sub(0.5).mul(0.5).mul(0.4),
        fbm2(uv.mul(5).add(T.vec2(tw.add(20), tw.add(30)))).sub(0.5).mul(1.2).mul(0.4)
      );

      const mouse = T.vec2(u.mousePositionX, u.mousePositionY);
      const md = T.length(mouse.sub(uv));
      const mf = T.vec3(0).toVar();
      T.If(md.lessThanEqual(0.2), () => {
        mf.x.assign(mouse.x.sub(uv.x).mul(T.float(0.2).sub(md)).mul(-100));
        mf.y.assign(mouse.y.sub(uv.y).mul(T.float(0.2).sub(md)).mul(-100));
        mf.z.assign(0);
      });
      mf.assign(mf.mul(u.mouseInfluence));

      const flow = fbm2(uv.mul(3).add(T.vec2(u.time.mul(0.1))));
      const f = u.extraOffset.mul(3).mul(T.float(0.6).add(flow.mul(1.4)));
      const force = T.vec3(0, T.float(-1).add(f), 0).add(wobble).add(mf);
      const accel = T.float(2.2).mul(u.deltaFactor);
      let next = curr.add(vel).add(force.mul(u.timestep).mul(u.timestep).mul(accel));

      const rest = restPos(uv, u.numStrips).add(T.vec3(0, u.positionOffsetY, 0));
      const pin = T.smoothstep(u.topConstraint.sub(u.uTexelSizeY.mul(5)), u.topConstraint, rest.y);
      next = T.mix(next, rest, pin);
      return T.vec4(next, 1);
    });
    mat.colorNode = build();
    return mat;
  }

  function buildConstraintMat(tex: THREE.Texture) {
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.toneMapped = false;
    mat.depthTest = false;
    mat.depthWrite = false;
    const build = T.Fn(() => {
      const u = simUniforms;
      const uv = T.uv();
      const p = T.texture(tex, uv).xyz.toVar();
      const up = T.texture(tex, uv.add(T.vec2(0, u.uTexelSizeY))).xyz;
      const down = T.texture(tex, uv.sub(T.vec2(0, u.uTexelSizeY))).xyz;
      const left = T.texture(tex, uv.sub(T.vec2(u.texelSizeX, 0))).xyz;
      const right = T.texture(tex, uv.add(T.vec2(u.texelSizeX, 0))).xyz;

      T.If(uv.y.add(u.uTexelSizeY).lessThanEqual(1), () => {
        p.assign(relax(p, up, u.restDistanceY, u.stiffness));
      });
      T.If(uv.y.sub(u.uTexelSizeY).greaterThanEqual(0), () => {
        p.assign(relax(p, down, u.restDistanceY, u.stiffness));
      });
      const strip = T.floor(uv.x.mul(u.numStrips));
      T.If(
        uv.x.sub(u.texelSizeX).greaterThanEqual(0).and(
          T.floor(uv.x.sub(u.texelSizeX).mul(u.numStrips)).equal(strip)
        ),
        () => {
          p.assign(relax(p, left, u.restDistanceX, u.stiffness));
        }
      );
      T.If(
        uv.x.add(u.texelSizeX).lessThanEqual(1).and(
          T.floor(uv.x.add(u.texelSizeX).mul(u.numStrips)).equal(strip)
        ),
        () => {
          p.assign(relax(p, right, u.restDistanceX, u.stiffness));
        }
      );
      return T.vec4(p, 1);
    });
    mat.colorNode = build();
    return mat;
  }

  function buildStripMaterial(posTex: THREE.Texture) {
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.side = THREE.DoubleSide;
    mat.depthTest = false;
    mat.depthWrite = false;
    const vWorld = T.varying(T.vec3(0), 'stripWorld');
    const vPageUv = T.varying(T.vec2(0), 'stripPageUv');

    const buildPosition = T.Fn(() => {
      const s = stripUniforms;
      const uv = T.uv();
      const inst = T.attribute('instanceStripIndex', 'float');
      const frac = inst.div(s.stripCount);
      vPageUv.assign(T.vec2(uv.x.div(s.stripCount).add(frac), uv.y));
      const sx = frac.add(uv.x.mul(2).add(0.5).mul(s.texelSizeX));
      const pos = T.texture(posTex, T.vec2(sx, uv.y)).xyz;
      const x = pos.x.mul(s.viewport.x).sub(s.viewport.x.mul(0.5));
      const y = pos.y
        .mul(T.float(1).div(T.float(1).sub(s.texelSizeY)))
        .mul(s.viewport.y)
        .sub(s.viewport.y.mul(0.5));
      const world = T.vec3(x, y, pos.z);
      vWorld.assign(world);
      return world;
    });
    mat.positionNode = buildPosition();

    const buildColor = T.Fn(() => {
      const s = stripUniforms;
      const uv = T.uv();
      T.If(vWorld.y.greaterThan(s.slotY), () => {
        T.Discard();
      });
      T.If(s.opacity.lessThan(0.5), () => {
        T.Discard();
      });

      const designY = s.contentTop.add(T.float(1).sub(uv.y).mul(s.contentSpan));
      T.If(designY.greaterThan(s.sheetH), () => {
        T.Discard();
      });
      const texV = T.float(1).sub(designY.div(s.sheetH));
      const col = T.texture(ctaTexture, T.vec2(vPageUv.x, T.clamp(texV, 0, 1))).rgb;
      const edge = T.clamp(T.min(uv.x.mul(7), T.float(1).sub(uv.x).mul(7)), 0, 1);
      const shade = T.mix(0.5, 1, edge);
      const crease = T.sin(uv.y.mul(180.0).add(vPageUv.x.mul(31.0))).mul(0.035).add(0.96);
      const grain = T.fract(
        T.sin(T.dot(vPageUv.mul(T.vec2(1440.0, 1400.0)), T.vec2(12.9898, 78.233))).mul(43758.5453)
      ).sub(0.5).mul(0.03);
      return T.vec4(col.mul(shade).mul(crease).mul(0.93).add(grain), 1);
    });
    mat.colorNode = buildColor();
    return mat;
  }

  function disposeSimulation() {
    for (const rt of simTargets) rt.dispose();
    simTargets = [];
    restMat?.dispose();
    for (const m of integrateMats) m.dispose();
    for (const m of constraintMats) m.dispose();
    const mats = new Set<THREE.Material>();
    for (const mesh of stripMeshes) {
      stripGroup.remove(mesh);
      mats.add(mesh.material as THREE.Material);
    }
    for (const m of mats) m.dispose();
    stripMeshes = [];
    stripGeo?.dispose();
    stripGeo = null;
    scene.remove(stripGroup);
    stripGroup = new THREE.Group();
    scene.add(stripGroup);
  }

  function buildSimulation() {
    disposeSimulation();
    simUniforms = createSimUniforms(stripCount);
    const w = 3 * stripCount;
    simTargets = [makeFloatTarget(w, STRIP_VERTICES_Y), makeFloatTarget(w, STRIP_VERTICES_Y), makeFloatTarget(w, STRIP_VERTICES_Y)];
    simCurrent = 0;
    simInitialized = false;

    restMat = new THREE.MeshBasicNodeMaterial();
    restMat.toneMapped = false;
    restMat.depthTest = false;
    restMat.depthWrite = false;
    restMat.colorNode = T.vec4(
      restPos(T.uv(), simUniforms.numStrips).add(T.vec3(0, simUniforms.positionOffsetY, 0)),
      1
    );

    integrateMats = [
      buildIntegrateMat(simTargets[0].texture, simTargets[2].texture),
      buildIntegrateMat(simTargets[1].texture, simTargets[0].texture),
      buildIntegrateMat(simTargets[2].texture, simTargets[1].texture),
    ];
    constraintMats = [
      buildConstraintMat(simTargets[0].texture),
      buildConstraintMat(simTargets[1].texture),
      buildConstraintMat(simTargets[2].texture),
    ];

    stripUniforms.stripCount.value = stripCount;
    stripUniforms.texelSizeX.value = 1 / (3 * stripCount);
    stripUniforms.texelSizeY.value = 1 / STRIP_VERTICES_Y;
    stripUniforms.viewport.value.set(vw, vh);
    stripUniforms.visibleH.value = visibleDesignH;
    stripUniforms.sheetH.value = sheetH;

    stripGeo = new THREE.PlaneGeometry(1, 1, 2, STRIP_VERTICES_Y);
    const indices = new Float32Array(stripCount);
    for (let i = 0; i < stripCount; i++) indices[i] = i;
    stripGeo.setAttribute('instanceStripIndex', new THREE.InstancedBufferAttribute(indices, 1));
    const identity = new THREE.Matrix4();
    for (let t = 0; t < 3; t++) {
      const mat = buildStripMaterial(simTargets[t].texture);
      const mesh = new THREE.InstancedMesh(stripGeo, mat, stripCount);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.visible = false;
      for (let i = 0; i < stripCount; i++) mesh.setMatrixAt(i, identity);
      mesh.instanceMatrix.needsUpdate = true;
      stripGroup.add(mesh);
      stripMeshes.push(mesh);
    }
  }

  async function runSimulation(rendererIn: THREE.WebGPURenderer, state: ShredderUpdateState) {
    const dt = Math.min(0.05, Math.max(1 / 240, state.dt || 1 / 60));
    const m = 1 / dt / 120;
    const u = simUniforms;
    const progress = Math.min(1, state.shred);
    u.timestep.value = (1 / m) * 0.016;
    u.deltaFactor.value = m;
    u.time.value = state.time;
    // 原件 extraOffset = clamp(progress-1,0,1)；本移植先用较小值保证纸条向下垂落
    u.extraOffset.value = 0.02 + progress * 0.08;
    u.positionOffsetY.value = 0;
    u.topConstraint.value = 0.95;
    u.mousePositionX.value = state.mouseX * 0.5 + 0.5;
    u.mousePositionY.value = state.mouseY * 0.5 + 0.5;
    u.mouseInfluence.value = 0.35;
    u.numStrips.value = stripCount;
    u.texelSizeX.value = 1 / (3 * stripCount);
    u.uTexelSizeY.value = 1 / STRIP_VERTICES_Y;
    u.restDistanceX.value = 1 / (2 * stripCount);
    u.restDistanceY.value = 1 / (STRIP_VERTICES_Y - 1);

    if (!simInitialized) {
      let cur = 0;
      for (let i = 0; i < 3; i++) {
        const target = (cur + 1) % 3;
        quad.mesh.material = restMat;
        rendererIn.setRenderTarget(simTargets[target]);
        rendererIn.render(simScene, simCamera);
        cur = target;
      }
      simCurrent = 0;
      simInitialized = true;
    } else {
      const passes = Math.min(12, Math.max(3, Math.round(1 / m * 6 + 1)));
      let cur = simCurrent;
      let first = true;
      for (let i = 0; i < passes; i++) {
        const target = (cur + 1) % 3;
        quad.mesh.material = first ? integrateMats[cur] : constraintMats[cur];
        first = false;
        rendererIn.setRenderTarget(simTargets[target]);
        rendererIn.render(simScene, simCamera);
        cur = target;
      }
      simCurrent = cur;
    }
    rendererIn.setRenderTarget(null);
    for (let i = 0; i < 3; i++) stripMeshes[i].visible = i === simCurrent;
  }

  buildSimulation();

  // ---------------------------------------------------------------------------
  // 尺寸 / 更新 / 释放
  // ---------------------------------------------------------------------------
  function applySize(w: number, h: number) {
    camera.aspect = Math.max(1, w) / Math.max(1, h);
    camera.updateProjectionMatrix();
    vh = 2 * CAMERA_Z * Math.tan(FOV * 0.5 * DEG);
    vw = vh * (w / Math.max(1, h));
    visibleDesignH = sheetW * (h / Math.max(1, w));
    bgUniforms.aspect.value = w / Math.max(1, h);
    bgMesh.scale.set(vw, vh, 1);
    paperMesh.scale.set(vw, vh, 1);
    paperUniforms.visibleH.value = visibleDesignH;
    stripUniforms.viewport.value.set(vw, vh);
    stripUniforms.visibleH.value = visibleDesignH;
    const nextCount = stripCountFor(w);
    if (nextCount !== stripCount) {
      stripCount = nextCount;
      buildSimulation();
    }
  }

  const reset = () => {
    simInitialized = false;
    simCurrent = 0;
    simAge = 0;
    for (const mesh of stripMeshes) mesh.visible = false;
  };

  const update: ShredderSceneHandle['update'] = async (rendererIn, state) => {
    const mp = Math.max(0, Math.min(4, state.shred * 4));
    const slotY = mp * vh - 0.5 * vh;
    // 用户在终幕停留太久、纸条全部落出画面后，重新生成一批
    simAge += state.dt;
    if (simInitialized && simAge > 3.2 && state.shred < 0.55) {
      reset();
    }
    paperUniforms.contentTop.value = state.ctaTop;
    paperUniforms.slotUvY.value = slotY / vh + 0.5;
    stripUniforms.contentTop.value = state.ctaTop;
    stripUniforms.contentSpan.value =
      Math.max(0, Math.min(1, paperUniforms.slotUvY.value)) * visibleDesignH;
    stripUniforms.slotY.value = slotY;
    stripUniforms.opacity.value = state.shred < 0.8 ? 1 : 0;

    paperMesh.visible = state.shred < 0.52;
    paperMesh.scale.set(vw, vh, 1);

    if (modelReady) {
      const modelScale = (window.innerWidth < 600 ? 0.5 : 0.19) * (vw / 6.5);
      const root = modelGroup.children[0];
      if (root) {
        root.scale.setScalar(modelScale);
        root.position.set(0, state.shred < 0.55 ? slotY : -100, 0);
        root.rotation.set(Math.PI / 2, 0, 0);
      }
      if (cogs) cogs.rotation.x = -mp * Math.PI * 3;
      modelGroup.visible = state.shred < 0.58;
    }

    const stripsAlive = state.shred < 0.8;
    if (stripsAlive) {
      await runSimulation(rendererIn, state);
      stripGroup.visible = true;
    } else {
      stripGroup.visible = false;
    }
  };

  const dispose = () => {
    disposed = true;
    scene.remove(modelGroup);
    for (const g of modelGeometries) g.dispose();
    for (const m of modelMaterials) m.dispose();
    disposeSimulation();
    bgGeo.dispose();
    bgMat.dispose();
    paperGeo.dispose();
    paperMat.dispose();
    quad.geometry.dispose();
    for (const g of envGeos) g.dispose();
    for (const m of envMats) m.dispose();
    envRT?.dispose();
    scene.environment = null;
  };

  applySize(width, height);
  const setSize = (w: number, h: number) => applySize(w, h);

  const debug = {
    get targets() {
      return simTargets;
    },
    current: () => simCurrent,
    initialized: () => simInitialized,
    get strips() {
      return stripMeshes;
    },
    get uniforms() {
      return simUniforms;
    },
  };

  return { scene, camera, setSize, reset, update, dispose, debug };
}
