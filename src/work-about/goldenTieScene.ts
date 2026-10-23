/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * golden-tie 页（反编译自 04kr7kd5riobb.js 的 f8/f5/cQ/pt/pe/cS）：
 *  - 相机 fov 65，z 从 7 推到 -18，背景渐变板随相机保持距离
 *  - tie.glb + 21 段绳子物理（重力 -80、风 5、每帧 4 次约束）
 *  - 握手预烘焙序列帧（屏幕空间）以亮度做 alpha，结束用发光墨迹擦除揭示 Contact
 */

const T = TSL as any;
const DEG = Math.PI / 180;

const SEGMENTS = 21;
const SEGMENT_HEIGHT = 0.15;
const GRAVITY = -80;
const PHYSICS_ACCURACY = 4;

class Point {
  x: number; y: number; z: number;
  px: number; py: number; pz: number;
  vx = 0; vy = 0; vz = 0;
  pinX: number | null = null;
  pinY: number | null = null;
  pinZ: number | null = null;
  pinOx = 0; pinOy = 0; pinOz = 0;
  constraints: Constraint[] = [];

  constructor(x: number, y: number, z: number) {
    this.x = x; this.y = y; this.z = z;
    this.px = x; this.py = y; this.pz = z;
  }
  update(dt: number, gravity: number) {
    this.addForce(0, gravity, 0);
    const dt2 = dt * dt;
    const nx = this.x + (this.x - this.px) * 0.95 + (this.vx / 2) * dt2;
    const ny = this.y + (this.y - this.py) * 0.95 + (this.vy / 2) * dt2;
    const nz = this.z + (this.z - this.pz) * 0.95 + (this.vz / 2) * dt2;
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.x = nx; this.y = ny; this.z = nz;
    this.vx = 0; this.vy = 0; this.vz = 0;
  }
  resolveConstraints() {
    if (this.pinX !== null && this.pinY !== null && this.pinZ !== null) {
      this.x = this.pinX + this.pinOx;
      this.y = this.pinY + this.pinOy;
      this.z = this.pinZ + this.pinOz;
      return;
    }
    for (let i = this.constraints.length - 1; i >= 0; i--) this.constraints[i]?.resolve();
  }
  attach(other: Point, length?: number) {
    const l = length ?? Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
    this.constraints.push(new Constraint(this, other, l));
  }
  addForce(x: number, y: number, z = 0) {
    this.vx += x; this.vy += y; this.vz += z;
    this.vx = Math.trunc(400 * this.vx) / 400;
    this.vy = Math.trunc(400 * this.vy) / 400;
    this.vz = Math.trunc(400 * this.vz) / 400;
  }
  pin(x: number, y: number, z: number) {
    this.pinX = x; this.pinY = y; this.pinZ = z;
  }
}

class Constraint {
  constructor(private p1: Point, private p2: Point, private length: number) {}
  resolve() {
    const dx = this.p1.x - this.p2.x;
    const dy = this.p1.y - this.p2.y;
    const dz = this.p1.z - this.p2.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const k = (this.length - len) / len;
    const ax = dx * k * 0.5;
    const ay = dy * k * 0.5;
    const az = dz * k * 0.5;
    this.p1.x += ax; this.p1.y += ay; this.p1.z += az;
    this.p2.x -= ax; this.p2.y -= ay; this.p2.z -= az;
  }
}

class Rope {
  points: Point[] = [];
  pinned: Point[] = [];
  time = 0;
  private deltas: number[] = [];
  private avgDt = 0;
  constructor() {
    const start = new THREE.Vector3(0, -1, 0);
    for (let n = 0; n <= SEGMENTS; n++) {
      const p = new Point(start.x, start.y + n * SEGMENT_HEIGHT, start.z);
      if (n === SEGMENTS) {
        p.pin(p.x, p.y, p.z);
        this.pinned.push(p);
      }
      this.points.push(p);
    }
    for (let i = 0; i < SEGMENTS; i++) this.points[i].attach(this.points[i + 1], SEGMENT_HEIGHT);
  }
  setPinOffset(x: number, y: number, z: number) {
    for (const p of this.pinned) {
      p.pinOx = x; p.pinOy = y; p.pinOz = z;
    }
  }
  update(dt: number, pinOffset: { x: number; y: number; z: number }) {
    if (dt < 0.02) this.deltas.push(dt);
    if (this.deltas.length > 120) this.deltas.shift();
    this.avgDt = this.deltas.reduce((a, b) => a + b, 0) / Math.max(1, this.deltas.length);
    this.setPinOffset(pinOffset.x, pinOffset.y, pinOffset.z);
    if (dt < 0.02) this.time += dt;
    for (let k = 0; k < PHYSICS_ACCURACY; k++) {
      for (let i = this.points.length - 1; i >= 0; i--) this.points[i].resolveConstraints();
    }
    for (let i = this.points.length - 1; i >= 0; i--) {
      const p = this.points[i];
      p.update(this.avgDt, GRAVITY);
      const t = this.time;
      const f = p;
      p.addForce(
        1 * 5 * Math.sin(4 * t + 0.1 * f.x),
        0.5 * 5 * Math.cos(10.5 * t + 0.1 * f.y),
        0 * 5 * Math.sin(3 * t + 0.1 * f.z)
      );
    }
    return this.points;
  }
  positions() {
    return this.points.map((p) => p);
  }
}

export interface GoldenTieUpdateState {
  /** 相机推进 0..1（原站 o） */
  dolly: number;
  /** 握手序列帧进度 0..1（原站 A） */
  handshake: number;
  /** 墨迹揭示 0..1（原站 transitionProgress） */
  transition: number;
  /** 白闪消退 0..1（原站 flashFadeProgress） */
  flash: number;
  /** 绳结沿 z 的进度 0..1（原站 c） */
  pin: number;
  time: number;
  dt: number;
  mouseX: number;
  mouseY: number;
  contactTexture: THREE.Texture | null;
  contactW: number;
  contactH: number;
}

export interface GoldenTieSceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setSize: (w: number, h: number) => void;
  update: (state: GoldenTieUpdateState) => void;
  dispose: () => void;
}

const SPARKLES: Array<[number, number]> = [
  [0.52, 0.343], [0.522, 0.356], [0.523, 0.368], [0.523, 0.369], [0.526, 0.384],
  [0.529, 0.402], [0.532, 0.425], [0.535, 0.446], [0.535, 0.446], [0.538, 0.465],
  [0.54, 0.478], [0.54, 0.478], [0.54, 0.47], [0.54, 0.47], [0.537, 0.454],
  [0.5335, 0.425], [0.53, 0.397], [0.528, 0.372], [0.528, 0.372], [0.528, 0.352],
  [0.529, 0.346], [0.5315, 0.349], [0.5365, 0.361], [0.536, 0.36], [0.54, 0.374],
  [0.544, 0.388], [0.544, 0.388],
];
const SPARKLE_START = 59;

function sparkleAt(frame: number) {
  if (frame <= SPARKLE_START) return SPARKLES[0];
  const idx = Math.min(SPARKLES.length - 1, frame - SPARKLE_START);
  return SPARKLES[idx];
}

export function createGoldenTieScene(
  renderer: THREE.WebGPURenderer,
  width: number,
  height: number
): GoldenTieSceneHandle {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, Math.max(1, width) / Math.max(1, height), 0.1, 250);
  camera.position.set(0, 0, 7);

  // ---------------------------------------------------------------------------
  // 背景渐变板（随相机保持距离）
  // ---------------------------------------------------------------------------
  const gradientTex = (() => {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.2, '#000000');
    g.addColorStop(0.7, '#222222');
    g.addColorStop(1, '#666666');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const bgMat = new THREE.MeshBasicMaterial({ map: gradientTex, toneMapped: false, depthWrite: false });
  const bgGeo = new THREE.PlaneGeometry(1, 1);
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  bgMesh.renderOrder = -10;
  bgMesh.frustumCulled = false;
  scene.add(bgMesh);

  // ---------------------------------------------------------------------------
  // 绳子物理 + tie.glb
  // ---------------------------------------------------------------------------
  const rope = new Rope();
  const pinSeed = { x: 0.0282, y: -5.4, z: 3 };
  for (let i = 0; i < 50; i++) rope.update(1 / 60, pinSeed);

  const clothArray = Array.from({ length: SEGMENTS }, () => new THREE.Vector3());
  const initial = rope.positions();
  for (let i = 0; i < SEGMENTS; i++) {
    const p = initial[Math.min(i, initial.length - 1)];
    clothArray[i]?.set(p.x, p.y, p.z);
  }
  const top = initial[initial.length - 1];
  const second = initial[initial.length - 2];
  const startTangent = new THREE.Vector3().subVectors(top, second).normalize();
  if (!Number.isFinite(startTangent.x)) startTangent.set(0, 1, 0);

  const clothUniform = T.uniformArray(clothArray, 'vec3');
  const tangentUniform = T.uniform(startTangent);
  const timeUniform = T.uniform(0);
  const opacityUniform = T.uniform(1);

  const tieMaterial = new THREE.MeshPhysicalNodeMaterial();
  tieMaterial.clearcoat = 0.1;
  tieMaterial.metalness = 0.9;
  tieMaterial.roughness = 0.2;
  tieMaterial.transparent = true;
  tieMaterial.side = THREE.DoubleSide;
  {
    const r = T.positionLocal as any;
    const a = T.clamp(r.y.sub(-2.7).div(0.4 - -2.7), 0, 1);
    const seg = T.float(SEGMENTS).sub(2);
    const l = a.mul(seg);
    const uf = T.floor(l);
    const Af = T.min(uf.add(1), seg);
    const c = T.fract(l);
    const d = uf.toInt();
    const h = Af.toInt();
    const g = T.mix(clothUniform.element(d), clothUniform.element(h), c);
    const m = T.max(uf.sub(1), 0).toInt();
    const E = T.min(Af.add(1), seg).toInt();
    const I = clothUniform.element(h).sub(clothUniform.element(m));
    const y = clothUniform.element(E).sub(clothUniform.element(d));
    const C = I.add(y);
    const B = T.select(T.length(C).greaterThan(0.001), T.normalize(C), T.vec3(0, -1, 0));
    const v = T.smoothstep(0.6, 1, a);
    const b = T.normalize(T.mix(B, tangentUniform, v));
    const S = T.vec3(0, 0, 1);
    const x = T.cross(b, S);
    const w = T.select(T.length(x).lessThan(0.001), T.vec3(1, 0, 0), S);
    const Q = T.normalize(T.cross(b, w));
    const R = T.normalize(T.cross(Q, b));
    const Tr = R.mul(r.z).add(Q.mul(r.x));
    const D = g.add(Tr);
    const L = T.normalize(
      Q.mul(T.normalLocal.x).add(b.mul(T.normalLocal.y)).add(R.mul(T.normalLocal.z))
    );
    const M = T.float(0.8);
    const noiseFn = T.Fn(([e]: any[]) => {
      const n1 = T.sin(e.x.mul(2.5).mul(M).add(timeUniform.mul(0.8)))
        .mul(T.cos(e.y.mul(3.2).mul(M).sub(timeUniform.mul(1.1))))
        .mul(T.sin(e.z.mul(1.8).mul(M).add(timeUniform.mul(0.6))));
      const n2 = T.sin(e.x.mul(5.1).mul(M).sub(timeUniform.mul(1.3)))
        .mul(T.sin(e.y.mul(4.7).mul(M).add(timeUniform.mul(0.9))))
        .mul(T.cos(e.z.mul(3.3).mul(M).sub(timeUniform.mul(1.2))));
      const n3 = T.cos(e.x.mul(1.3).mul(M).add(timeUniform.mul(0.5)))
        .mul(T.sin(e.y.mul(6.1).mul(M).sub(timeUniform.mul(0.7))))
        .mul(T.sin(e.z.mul(4.2).mul(M).add(timeUniform.mul(1.5))));
      return n1.mul(0.5).add(n2.mul(0.3)).add(n3.mul(0.2));
    });
    const F = T.positionGeometry as any;
    const nA = noiseFn(F.mul(2.5)).mul(0.6);
    const nB = noiseFn(F.mul(3).add(T.vec3(100, 50, 75))).mul(0.8);
    const N = L.add(
      T.vec3(
        nA.add(T.sin(F.y.mul(4).mul(M).add(timeUniform)).mul(0.2)),
        nB.mul(0.5).add(T.cos(F.x.mul(3).mul(M).sub(timeUniform.mul(1.2))).mul(0.15)),
        nA.add(nB).mul(0.7).add(T.sin(F.z.mul(2).mul(M).add(timeUniform.mul(0.8))).mul(0.1))
      )
    );
    const U = T.normalize(N);
    tieMaterial.positionNode = D;
    tieMaterial.normalNode = U;
    tieMaterial.clearcoatNormalNode = U;
    tieMaterial.colorNode = T.vec3(0.722, 0.525, 0.043);
    tieMaterial.opacityNode = opacityUniform;
  }

  const tieGroup = new THREE.Group();
  tieGroup.position.set(-0.5, 20, -20);
  tieGroup.scale.setScalar(4.5);
  scene.add(tieGroup);

  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  loader.setDRACOLoader(draco);
  let disposed = false;
  let tieMesh: THREE.Mesh | null = null;
  loader.load(
    '/asset/models/tie.glb',
    (gltf) => {
      if (disposed) return;
      const root = gltf.scene;
      let found: THREE.Mesh | null = null;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !found) found = mesh;
      });
      const mesh = found as THREE.Mesh | null;
      if (mesh) {
        tieMesh = mesh;
        mesh.material = tieMaterial;
        mesh.frustumCulled = false;
        tieGroup.add(mesh);
      }
    },
    undefined,
    () => undefined
  );

  // ---------------------------------------------------------------------------
  // 人群（原站 f8：Mux 抽帧视频 tie_crowd.mp4，10 位鼓掌人物 5×2 图集，
  // 每位一个 UV 裁窗 sprite，黑底融入场景背景）+ 标题平面（CanvasTexture）
  // ---------------------------------------------------------------------------
  const CROWD_COLS = 5;
  const CROWD_ROWS = 2;
  const crowdVideo = document.createElement('video');
  crowdVideo.src = '/videos/tie_crowd.mp4';
  crowdVideo.muted = true;
  crowdVideo.loop = true;
  crowdVideo.playsInline = true;
  crowdVideo.preload = 'auto';
  crowdVideo.crossOrigin = 'anonymous';
  const crowdTex = new THREE.VideoTexture(crowdVideo);
  crowdTex.colorSpace = THREE.SRGBColorSpace;
  crowdTex.minFilter = THREE.LinearFilter;
  crowdTex.magFilter = THREE.LinearFilter;
  crowdTex.generateMipmaps = false;
  const crowdPlayPromise = crowdVideo.play().catch(() => undefined);
  void crowdPlayPromise;
  /** 人群整体透明度：握手全屏序列帧出现时人群退场（原站同节拍） */
  const crowdOpacity = T.uniform(1);

  /**
   * 人群站位表（对照原站 tie 段满员帧目测的初排，逐节拍验收时再校）：
   *  - cell [col, row]：图集内人物格位（row 0 = 上行 5 人，row 1 = 下行 5 人）
   *  - x/z：世界坐标（相机 z 7→-18 推进，z 越负越远越先进入画面）
   *  - scale：sprite 高度（世界单位），人物竖条宽 = 高 × 0.5625
   *  - flip：水平镜像（让人物朝向匹配原站站位）
   */
  type CrowdEntry = { cell: [number, number]; x: number; z: number; scale: number; flip?: boolean };
  const CROWD_LAYOUT: CrowdEntry[] = [
    // 左列（由远及近，近排贴画面边缘）。图集人物天然朝右 → 左列面向中央不翻转
    { cell: [3, 0], x: -5.4, z: -30, scale: 6.2 },           // 青套装女（最远小）
    { cell: [1, 0], x: -5.0, z: -18, scale: 8.2 },           // 深蓝套装女
    { cell: [1, 1], x: -4.7, z: -8, scale: 11 },             // 花裙女（中近）
    { cell: [0, 0], x: -5.8, z: -2, scale: 14.5 },           // 灰西装男（最近贴边）
    // 右列：镜像翻转使人物朝左（面向中央领带）
    { cell: [4, 1], x: 5.2, z: -30, scale: 6.2, flip: true }, // 白格套装女（最远小）
    { cell: [2, 0], x: 4.9, z: -17, scale: 8.5, flip: true }, // 深灰西装男
    { cell: [3, 1], x: 4.7, z: -7, scale: 11, flip: true },   // 棕西装男（中近）
    { cell: [2, 1], x: 5.8, z: -1.5, scale: 14.5, flip: true }, // 灰套裙女（最近贴边）
  ];
  const crowdGroup = new THREE.Group();
  scene.add(crowdGroup);
  const crowdPlanes = CROWD_LAYOUT.map((entry) => {
    const [col, row] = entry.cell;
    // 单格 UV 窗口：每格宽 1/5、高 1/2；flip 时水平镜像窗口
    const uWin = 1 / CROWD_COLS;
    const vWin = 1 / CROWD_ROWS;
    const u0 = T.uv().x.mul(uWin);
    const v0 = T.uv().y.mul(vWin);
    const vBase = (CROWD_ROWS - 1 - row) * vWin;
    const uvWin = entry.flip
      ? T.vec2(T.float((col + 1) * uWin).sub(u0), v0.add(vBase))
      : T.vec2(u0.add(col * uWin), v0.add(vBase));
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.toneMapped = false;
    mat.depthWrite = false;
    mat.transparent = true;
    // 黑底融入：亮度即覆盖度，纯黑像素完全透明（视频抠像本就黑底）
    // 加法混合（原站同款）：黑底 rgb≈0 加到背景上不改变背景色，黑底矩形完全
    // 隐形，人物呈"录影带透亮"质感（深色西装微微透出背景正是加法特征）。
    // 底噪压零：H.264 黑底 rgb≈8-15，加法会让整块 plane 微微提亮背景形成
    // "特别黑的方框"的反面——灰蒙框，先减掉底电平再加色
    const texNode = T.texture(crowdTex, uvWin);
    mat.colorNode = T.max(texNode.rgb.sub(0.035), T.float(0)).mul(1.45);
    mat.blending = THREE.AdditiveBlending;
    // 不透明黑底（与原站同款）：视频黑底直接融入场景暗背景，不做亮度抠像——
    // 抠像会把深色西装/裤装削成半透明，人物只剩亮色上身，视觉上"缺半截"。
    // 边缘 alpha 渐隐：黑底矩形的四周平滑衰减，消除黑块与渐变背景板的接缝；
    // opacityNode 整体再乘 crowdOpacity（握手序列帧出现时人群退场，update 驱动）
    const fadeX = T.smoothstep(T.float(0), T.float(0.09), T.uv().x).mul(
      T.smoothstep(T.float(0), T.float(0.09), T.oneMinus(T.uv().x))
    );
    const fadeY = T.smoothstep(T.float(0), T.float(0.07), T.uv().y).mul(
      T.smoothstep(T.float(0), T.float(0.07), T.oneMinus(T.uv().y))
    );
    mat.opacityNode = crowdOpacity.mul(fadeX).mul(fadeY);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    // 单格宽高比 = (1518/5) / (1080/2) ≈ 0.562（人物竖条）
    const aspect = (1518 / CROWD_COLS) / (1080 / CROWD_ROWS);
    mesh.scale.set(entry.scale * aspect, entry.scale, 1);
    mesh.position.set(entry.x, -entry.scale * 0.46, entry.z);
    mesh.renderOrder = 5;
    crowdGroup.add(mesh);
    return mesh;
  });
  crowdTex.needsUpdate = true;

  // 标题不在此实现：tie 文案由 uiCanvas 烘焙层绘制（tieCopy 透明度控制、
  // 字号随 dolly 缩放），见 uiCanvas.ts 的 tie 分支——原站标题位置固定屏幕
  // 上部、仅随相机推进放大，属屏幕空间元素而非场景内平面。

  // ---------------------------------------------------------------------------
  // 握手序列帧 + 墨迹揭示
  // ---------------------------------------------------------------------------
  const fallbackSheet = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  fallbackSheet.needsUpdate = true;
  let sheetNode: any = null;
  let contactTexNode: any = null;

  const hs = {
    offset: T.uniform(new THREE.Vector2(0, 0)),
    grid: T.uniform(new THREE.Vector2(5, 8)),
    resolution: T.uniform(new THREE.Vector2(1, 1)),
    sparkle: T.uniform(new THREE.Vector2(0.5, 0.4)),
    transition: T.uniform(0),
    flash: T.uniform(0),
    time: T.uniform(0),
  };

  const hsMat = new THREE.MeshBasicNodeMaterial();
  hsMat.transparent = true;
  hsMat.depthTest = false;
  hsMat.depthWrite = false;
  hsMat.toneMapped = false;
  {
    const linear = T.Fn(([c]: any[]) => {
      const t = T.float(0.04045);
      const conv = (x: any) =>
        T.mix(
          T.pow(x.add(0.055).div(1.055), 2.4),
          x.div(12.92),
          x.lessThanEqual(t).toFloat()
        );
      return T.vec3(conv(c.x), conv(c.y), conv(c.z));
    });
    const sparkle = T.Fn(([_oUv, texUv, contact]: any[]) => {
      const n = texUv.sub(hs.sparkle).mul(T.vec2(1, 0.5625));
      const l = T.length(n).mul(1.35);
      const c = hs.transition.mul(1.3).sub(l);
      const d = T.step(0, c);
      const h = hs.transition.mul(0.18);
      const g = T.smoothstep(h.negate(), 0, c).mul(T.oneMinus(d));
      const f = T.vec3(1, 0.95, 0.9).mul(g).mul(1.5);
      const out = T.vec4(0, 0, 0, 0).toVar();
      T.If(d.greaterThan(0), () => {
        const col = T.mix(T.vec3(2, 2, 2), contact.rgb, hs.flash);
        out.assign(T.vec4(col, 1));
      }).ElseIf(g.greaterThan(0), () => {
        out.assign(T.vec4(f, g));
      });
      return out;
    });
    void sparkle;

    hsMat.colorNode = T.Fn(() => {
      const e = T.uv();
      const target = T.float(16 / 9);
      const maxW = T.min(hs.resolution.x, T.float(1500).mul(1.5));
      const a = maxW.div(hs.resolution.y);
      const o = T.vec2(0, 0).toVar();
      const l = e.x.sub(0.5).mul(hs.resolution.x.div(maxW)).add(0.5);
      T.If(a.greaterThan(target), () => {
        const t = target.div(a);
        const r = T.float(1).sub(t).mul(0.5);
        o.x.assign(l.sub(r).div(t));
        o.y.assign(e.y);
      }).Else(() => {
        const t = a.div(target);
        const r = T.float(1).sub(t).mul(0.5);
        o.x.assign(l);
        o.y.assign(e.y.sub(r).div(t));
      });
      const sheetUv = T.vec2(T.clamp(o.x, 0, 1), T.clamp(o.y, 0, 1)).div(hs.grid).add(hs.offset);
      sheetNode = T.texture(fallbackSheet, sheetUv);
      const col = sheetNode.toVar();
      T.If(o.x.lessThan(0).or(o.x.greaterThan(1)).or(o.y.lessThan(0)).or(o.y.greaterThan(1)), () => {
        col.assign(T.vec4(0, 0, 0, 0));
      });
      const lum = T.smoothstep(0.05, 0.15, T.length(col.rgb));
      const gx = T.smoothstep(0, 0.4, T.clamp(o.x, 0, 0.4));
      const fx = T.smoothstep(0, 0.4, T.clamp(T.float(1).sub(o.x), 0, 0.4));
      const py = T.smoothstep(0, 0.25, T.clamp(o.y, 0, 0.3));
      const my = T.smoothstep(0, 0.25, T.clamp(T.float(1).sub(o.y), 0, 0.3));
      const alpha = gx.mul(fx).mul(py).mul(my).mul(lum);
      return T.vec4(linear(col.rgb), alpha);
    })();
  }
  const hsGeo = new THREE.PlaneGeometry(1, 1);
  const hsMesh = new THREE.Mesh(hsGeo, hsMat);
  hsMesh.position.set(0, 0, -1);
  hsMesh.renderOrder = 999999;
  hsMesh.frustumCulled = false;
  camera.add(hsMesh);
  scene.add(camera);

  // 握手序列帧加载
  let sheets: THREE.Texture[] = [];
  let totalFrames = 106;
  let sheetCols = 5;
  let sheetRows = 8;
  const framesPerSheet = 40;
  (async () => {
    try {
      const mobile = window.innerWidth < 700;
      const base = mobile ? '/videos/prebaked/handshake_avif_mobile' : '/videos/prebaked/handshake_avif';
      const manifest = await (await fetch(`${base}/handshake.manifest.json`)).json();
      const bitmapLoader = new THREE.ImageBitmapLoader();
      bitmapLoader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
      const bitmaps = await Promise.all(
        manifest.sheets.map((s: { file: string }) => bitmapLoader.loadAsync(`${base}/${s.file}`))
      );
      if (disposed) return;
      totalFrames = manifest.totalFrames;
      sheetCols = manifest.sheetCols;
      sheetRows = manifest.sheetRows;
      sheets = bitmaps.map((bmp) => {
        const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
        tex.flipY = false;
        tex.colorSpace = THREE.NoColorSpace;
        tex.generateMipmaps = false;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        return tex;
      });
      hs.grid.value.set(sheetCols, sheetRows);
      if (sheets[0] && sheetNode) sheetNode.value = sheets[0];
      (hsMat as any).needsUpdate = true;
    } catch {
      // 资源加载失败时保持透明
    }
  })();

  // ---------------------------------------------------------------------------
  // 灯光
  // ---------------------------------------------------------------------------
  try {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#0b0a09');
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
    panel([6.0, 5.4, 4.2], [0, 5, 4], [8, 5]);
    panel([3.0, 2.6, 1.8], [-5, 1, 3], [5, 3]);
    panel([1.6, 2.2, 4.0], [5, -1, 2], [4, 4]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0.04);
    scene.environment = rt.texture;
    scene.environmentIntensity = 1.4;
  } catch {
    // 忽略环境贴图失败
  }
  scene.add(new THREE.AmbientLight(0xffffff, 2));

  // ---------------------------------------------------------------------------
  // 更新
  // ---------------------------------------------------------------------------
  const lookAt = new THREE.Vector3(0, 0, -20);

  const update = (state: GoldenTieUpdateState) => {
    const o = state.dolly;
    camera.position.z = 7 - 25 * o;
    lookAt.set(state.mouseX * 0.125, state.mouseY * 0.125, -20);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();

    const pinZ = 2.5 - 10 * state.pin;
    const pin = {
      x: 0.2 * Math.sin(3 * state.time) + 0.2 * Math.sin(pinZ),
      y: -1.5 - 4 + 0.1 * Math.cos(1.5 * state.time),
      z: pinZ,
    };
    const points = rope.update(Math.min(0.033, Math.max(0.001, state.dt)), pin);
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    if (last && prev) {
      const tangent = new THREE.Vector3(last.x - prev.x, last.y - prev.y, last.z - prev.z).normalize();
      const sm = tangentUniform.value as THREE.Vector3;
      sm.lerp(tangent, 0.02);
      sm.normalize();
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const p = points[Math.min(i, points.length - 1)];
      clothArray[i]?.set(p.x, p.y, p.z);
    }
    clothUniform.array = clothArray;
    timeUniform.value = state.time;
    opacityUniform.value = Math.min(1, Math.max(0, 1 - (o - 0.6) / 0.3));
    // 人群退场：握手序列帧开始推进后快速淡出，避免人群从握手画面的
    // 亮度门控透明区（黑底 → alpha 0）透出来（层级高于握手观感）
    crowdOpacity.value = 1 - Math.min(1, state.handshake * 4);

    // 背景板跟随相机
    const dist = 70 + 60 * o;
    const bgZ = camera.position.z - dist;
    const h = 2 * Math.tan((camera.fov * DEG) / 2) * Math.abs(camera.position.z - bgZ);
    const w = h * camera.aspect;
    bgMesh.position.set(0, 0, bgZ);
    bgMesh.scale.set(1.2 * w, 1.2 * h, 1);

    hs.time.value = state.time;
    hs.transition.value = state.transition;
    hs.flash.value = state.flash;
    const frame = Math.min(
      totalFrames - 1,
      Math.max(0, Math.round(0.8 * state.handshake * (totalFrames - 1)))
    );
    if (sheets.length > 0 && sheetNode) {
      const sheetIndex = Math.min(sheets.length - 1, Math.floor(frame / framesPerSheet));
      sheetNode.value = sheets[sheetIndex];
      const inSheet = frame % framesPerSheet;
      const row = Math.floor(inSheet / sheetCols);
      const col = inSheet % sheetCols;
      hs.offset.value.set(col / sheetCols, (sheetRows - 1 - row) / sheetRows);
    }
    const sp = sparkleAt(frame);
    hs.sparkle.value.set(sp[0], sp[1]);
    if (state.contactTexture && contactTexNode) {
      contactTexNode.value = state.contactTexture;
      hs.resolution.value.set(Math.max(1, state.contactW), Math.max(1, state.contactH));
    }
  };

  const setSize = (w: number, h: number) => {
    camera.aspect = Math.max(1, w) / Math.max(1, h);
    camera.updateProjectionMatrix();
    const visibleH = 2 * Math.tan((camera.fov * DEG) / 2);
    const visibleW = visibleH * camera.aspect;
    hsMesh.scale.set(visibleW * 1.04, visibleH * 1.04, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    hs.resolution.value.set(Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)));
  };
  setSize(width, height);

  const dispose = () => {
    disposed = true;
    tieMaterial.dispose();
    hsMat.dispose();
    hsGeo.dispose();
    bgGeo.dispose();
    bgMat.dispose();
    gradientTex.dispose();
    fallbackSheet.dispose();
    for (const s of sheets) s.dispose();
    scene.environment = null;
    if (tieMesh) tieMesh.geometry.dispose();
    // 人群视频与标题：停播、释放纹理与几何
    crowdVideo.pause();
    crowdVideo.removeAttribute('src');
    crowdVideo.load();
    crowdTex.dispose();
    for (const mesh of crowdPlanes) {
      (mesh.material as THREE.Material).dispose();
      mesh.geometry.dispose();
    }
  };

  return { scene, camera, setSize, update, dispose };
}
