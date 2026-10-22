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
    sim: { scene: THREE.Scene; camera: THREE.OrthographicCamera; mesh: THREE.Mesh };
    integrate: THREE.MeshBasicNodeMaterial[];
    constrain: THREE.MeshBasicNodeMaterial[];
  };
}

const CAMERA_Z = 5;
const FOV = 65;
const STRIP_VERTICES_Y = 64;
const DEG = Math.PI / 180;
/**
 * three 的 NodeMaterial 会把输出钳到 max(color, 0)（force unsigned floats），
 * 而布条位置需要负坐标（纸面/布条会垂到 0 以下）。所有模拟纹理里存 pos + BIAS，
 * 采样时再减掉，模拟数学与原站完全一致且不会被钳制破坏。
 */
const SIM_BIAS = 4;
const SIM_BIAS_VEC = () => T.vec3(SIM_BIAS, SIM_BIAS, SIM_BIAS);

function stripCountFor(width: number) {
  return width > 1200 ? 96 : width > 900 ? 64 : width > 600 ? 32 : 24;
}

function createFullscreenQuad() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const geometry = new THREE.PlaneGeometry(2, 2);
  // 原站模拟用 QuadMesh（uv.y 在屏幕顶部为 0）。WebGPU 采样 render target 时
  // v=0 对应纹理顶行，PlaneGeometry 的 uv 是反的，不翻转会让每次 pass 都把布条镜像一次。
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uvAttr.count; i++) uvAttr.setY(i, 1 - uvAttr.getY(i));
  uvAttr.needsUpdate = true;
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
  // 原件在碎纸段纸张是钉住的（内容进度被 clamp），碎纸机从纸面里穿过去
  // ---------------------------------------------------------------------------
  const paperUniforms = {
    visibleH: T.uniform(visibleDesignH),
    sheetH: T.uniform(sheetH),
    slotUvY: T.uniform(0),
  };
  const paperMat = new THREE.MeshBasicNodeMaterial();
  {
    const build = T.Fn(() => {
    const uv = T.uv();
    const designY = T.float(1).sub(uv.y).mul(paperUniforms.visibleH);
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
  /** 原件 runner 里的 g：跟随 progress，每帧最多移动 2·dt */
  let simFollow = 0;
  let lastMouseX = 0.5;
  let lastMouseY = 0.5;
  let mouseInfluence = 0;
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
      /** 终幕进度 0..1（原件的 exitProgress / AS） */
      exit: T.uniform(0),
      /** 一屏可见高度 / CTA 纸张总高 */
      sheetScale: T.uniform(1),
      slotY: T.uniform(0),
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
      const curr = T.texture(tex, uv).xyz.sub(SIM_BIAS_VEC());
      const prev = T.texture(prevTex, uv).xyz.sub(SIM_BIAS_VEC());
      // 以下常量/公式与原站 integrate 着色器逐项一致
      const vel = curr.sub(prev).mul(0.99999);

      const tw = u.time.mul(0.2);
      const wobble = T.vec3(
        fbm2(uv.mul(5).add(T.vec2(tw, 0))).sub(0.5).mul(5).mul(0.4),
        fbm2(uv.mul(5).add(T.vec2(0, tw.add(10)))).sub(0.5).mul(0.5).mul(0.4),
        fbm2(uv.mul(5).add(T.vec2(tw.add(20), tw.add(30)))).sub(0.5).mul(5).mul(0.4)
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
      const accel = T.float(5).mul(u.deltaFactor);
      let next = curr.add(vel).add(force.mul(u.timestep).mul(u.timestep).mul(accel));

      const rest = restPos(uv, u.numStrips).add(T.vec3(0, u.positionOffsetY, 0));
      // 原件按纹理 uv.y 判断固定区（不是加了 offset 的静息 y）
      const pin = T.smoothstep(u.topConstraint.sub(u.uTexelSizeY.mul(5)), u.topConstraint, uv.y);
      next = T.mix(next, rest, pin);
      return T.vec4(next.add(SIM_BIAS_VEC()), 1);
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
      const p = T.texture(tex, uv).xyz.sub(SIM_BIAS_VEC()).toVar();
      const up = T.texture(tex, uv.add(T.vec2(0, u.uTexelSizeY))).xyz.sub(SIM_BIAS_VEC());
      const down = T.texture(tex, uv.sub(T.vec2(0, u.uTexelSizeY))).xyz.sub(SIM_BIAS_VEC());
      const left = T.texture(tex, uv.sub(T.vec2(u.texelSizeX, 0))).xyz.sub(SIM_BIAS_VEC());
      const right = T.texture(tex, uv.add(T.vec2(u.texelSizeX, 0))).xyz.sub(SIM_BIAS_VEC());

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
      return T.vec4(p.add(SIM_BIAS_VEC()), 1);
    });
    mat.colorNode = build();
    return mat;
  }

  function buildStripMaterial(posTex: THREE.Texture) {
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.side = THREE.DoubleSide;
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.toneMapped = false;
    const vWorld = T.varying(T.vec3(0), 'stripWorld');
    const vPageUv = T.varying(T.vec2(0), 'stripPageUv');
    const vNormal = T.varying(T.vec3(0, 0, 1), 'stripNormal');

    const buildPosition = T.Fn(() => {
      const s = stripUniforms;
      const uv = T.uv();
      const inst = T.attribute('instanceStripIndex', 'float');
      const frac = inst.div(s.stripCount);
      vPageUv.assign(T.vec2(uv.x.div(s.stripCount).add(frac), uv.y));
      const sx = frac.add(uv.x.mul(2).add(0.5).mul(s.texelSizeX));
      const pos = T.texture(posTex, T.vec2(sx, uv.y)).xyz.sub(SIM_BIAS_VEC());

      // 原件法线：取布条基列与其右邻列、上下邻行做 cross
      const upY = T.clamp(uv.y.add(s.texelSizeY), 0, 1);
      const downY = T.clamp(uv.y.sub(s.texelSizeY), 0, 1);
      const pUp = T.texture(posTex, T.vec2(frac, upY)).xyz.sub(SIM_BIAS_VEC());
      const pDown = T.texture(posTex, T.vec2(frac, downY)).xyz.sub(SIM_BIAS_VEC());
      const pLeft = T.texture(posTex, T.vec2(frac, uv.y)).xyz.sub(SIM_BIAS_VEC());
      const pRight = T.texture(posTex, T.vec2(frac.add(s.texelSizeX), uv.y)).xyz.sub(SIM_BIAS_VEC());
      const nrm = T.normalize(T.cross(pRight.sub(pLeft), pUp.sub(pDown))).toVar();
      T.If(
        uv.y.lessThanEqual(0).or(uv.y.greaterThanEqual(1)).or(T.length(pUp.sub(pDown)).lessThan(1e-4)),
        () => {
          nrm.assign(T.vec3(0, 0, 1));
        }
      );
      vNormal.assign(nrm);

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
      // 内容以世界坐标冻结在布条上：与上方静止纸页在 slot 处严格衔接
      const restV = uv.y.add(s.exit).div(T.float(1).sub(s.texelSizeY));
      const texV = T.float(1).sub(T.float(1).sub(restV).mul(s.sheetScale));
      const col = T.texture(ctaTexture, T.vec2(vPageUv.x, T.clamp(texV, 0, 1))).rgb.toVar();
      col.assign(T.mix(col.mul(T.abs(vNormal.z)), col, 0.25));
      const edge = T.clamp(T.min(vPageUv.x.mul(7), T.float(1).sub(vPageUv.x).mul(7)), 0, 1);
      const shaded = T.mix(col, T.mix(T.vec3(0), col, edge), 0.6);
      T.If(vWorld.y.greaterThan(s.slotY), () => {
        T.Discard();
      });
      return T.vec4(shaded, 1);
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
    simFollow = 0;

    restMat = new THREE.MeshBasicNodeMaterial();
    restMat.toneMapped = false;
    restMat.depthTest = false;
    restMat.depthWrite = false;
    restMat.colorNode = T.vec4(
      restPos(T.uv(), simUniforms.numStrips)
        .add(T.vec3(0, simUniforms.positionOffsetY, 0))
        .add(SIM_BIAS_VEC()),
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
    stripUniforms.sheetScale.value = visibleDesignH / sheetH;

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
    // 原站用帧间隔（>2s 时回退到 .016）；低帧率下过高 dt 会让约束迭代失稳，这里按 60fps 上限
    const dt = Math.max(1e-4, Math.min(1 / 60, state.dt || 1 / 60));
    const m = 1 / dt / 120;
    const u = simUniforms;
    const E = Math.min(1, Math.max(0, state.shred));
    const progress = E * 4;
    u.timestep.value = (1 / m) * 0.016;
    u.deltaFactor.value = m;
    u.time.value = state.time;
    u.extraOffset.value = Math.min(1, Math.max(0, progress - 1));
    u.numStrips.value = stripCount;
    u.texelSizeX.value = 1 / (3 * stripCount);
    u.uTexelSizeY.value = 1 / STRIP_VERTICES_Y;
    u.restDistanceX.value = 1 / (2 * stripCount);
    u.restDistanceY.value = 1 / (STRIP_VERTICES_Y - 1);

    // 鼠标速度 → 影响系数（原站每帧平滑：快速移动 .1，静止 .02）
    // 模拟 quad 的 uv.y 顶部为 0（同原站 QuadMesh），鼠标 y 也要按同方向归一化
    const mx = state.mouseX * 0.5 + 0.5;
    const my = 0.5 - state.mouseY * 0.5;
    const speed = Math.hypot(mx - lastMouseX, my - lastMouseY) / Math.max(1e-5, dt);
    const active = speed > 0.05;
    mouseInfluence += ((active ? 1 : 0) - mouseInfluence) * (active ? 0.1 : 0.02);
    lastMouseX = mx;
    lastMouseY = my;
    u.mouseInfluence.value = mouseInfluence;
    u.mousePositionX.value = mx;
    u.mousePositionY.value = my - E;

    let cur = simCurrent;
    if (!simInitialized) {
      // 初始化：offset 为 0，用静息位置铺满三张纹理（原件 s ? 3 次 rest pass）
      simFollow = progress;
      u.positionOffsetY.value = 0;
      u.topConstraint.value = 0;
      for (let i = 0; i < 3; i++) {
        const target = (cur + 1) % 3;
        quad.mesh.material = restMat;
        rendererIn.setRenderTarget(simTargets[target]);
        rendererIn.render(simScene, simCamera);
        cur = target;
      }
      simCurrent = cur;
      simInitialized = true;
    } else {
      // 原件：g 每帧最多移动 2·dt，topConstraint = min(g − offset, .95)
      const d = progress - simFollow;
      simFollow += Math.sign(d) * Math.min(Math.abs(d), 2 * dt);
      simFollow = Math.min(simFollow, 2);
      u.positionOffsetY.value = E;
      u.topConstraint.value = Math.min(simFollow - E, 0.95);

      const passes = Math.min((1 / m) * 6 + 1, 12);
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
    stripUniforms.sheetScale.value = visibleDesignH / sheetH;
    const nextCount = stripCountFor(w);
    if (nextCount !== stripCount) {
      stripCount = nextCount;
      buildSimulation();
    }
  }

  const reset = () => {
    simInitialized = false;
    simCurrent = 0;
    simFollow = 0;
    for (const mesh of stripMeshes) mesh.visible = false;
  };

  const update: ShredderSceneHandle['update'] = async (rendererIn, state) => {
    const E = Math.min(1, Math.max(0, state.shred));
    const mp = E * 4;
    const slotY = mp * vh - 0.5 * vh;
    // 纸张在碎纸段是钉住的；bar 从下往上穿过纸面
    paperUniforms.slotUvY.value = slotY / vh + 0.5;
    stripUniforms.exit.value = E;
    stripUniforms.slotY.value = slotY;

    // slot 越过屏幕上沿后，整张纸都已被切掉
    paperMesh.visible = paperUniforms.slotUvY.value < 1;
    paperMesh.scale.set(vw, vh, 1);

    if (modelReady) {
      const modelScale = (window.innerWidth < 600 ? 0.5 : 0.19) * (vw / 6.5);
      const root = modelGroup.children[0];
      if (root) {
        root.scale.setScalar(modelScale);
        root.position.set(0, slotY, 0);
        root.rotation.set(Math.PI / 2, 0, 0);
      }
      if (cogs) cogs.rotation.x = -mp * Math.PI * 3;
      modelGroup.visible = true;
    }

    await runSimulation(rendererIn, state);
    stripGroup.visible = true;
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
    get integrate() {
      return integrateMats;
    },
    get constrain() {
      return constraintMats;
    },
    sim: { scene: simScene, camera: simCamera, mesh: quad.mesh },
  };

  return { scene, camera, setSize, reset, update, dispose, debug };
}
