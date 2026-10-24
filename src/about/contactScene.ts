/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { loadFont } from '../uikit/font.ts';
import type { ContactFonts } from '../uikit/contactColumn.ts';
import { buildContactContentColumn, buildContactRoot, CONTACT_LENGTH_STATIC, type ContactColumnHandles } from '../uikit/contactColumn.ts';
import { UIKitRenderer } from '../uikit/renderer.ts';
import type { UIElement } from '../uikit/element.ts';

/**
 * Contact 场景 —— shader.se contact 段 1:1 反编译还原（M4 清盘重写版）
 *
 * == 架构（对照 _bundles/glossary.md §3/§4）==
 *   uikit 列 → UIKitRenderer（M3：MSDF 文字 + SDF 面板 + yoga 布局），z=0 平面
 *   黑幕 f → uk 根 backgroundColor rgba(0,0,0,f)（原站 ref=r，每帧写面板 uniform）
 *   cl 遮罩 → 独立 TSL 网格（uv 渐变 alpha，盖 Good buy 块向下超 50px）
 *   phones/背景壳/灯光/烟雾/星群 → 保留 M0 阶段已 1:1 验证的 3D 部分
 *
 * == 滚动/相机公式（cp 组件 useImperativeHandle 1:1）==
 *   d   = 列内容高 / 视口高（动态测长）
 *   h   = clamp(nM(scroll, start−1.12, end−1), 0, 1)
 *   g   = clamp(nM(scroll, start−1, end−1), 0, 1) · (d−1)      // 列滚动（页）
 *   f   = clamp(nM(g, dHello−(w>640?120:80)/vh, dHello+100/vh), 0, 1)  // 黑幕
 *   p   = h · viewportHeight · (d−1)                            // 世界位移
 *   相机 = (0.25·mx, 0.25·my − p, 5)，lookAt(0, −p, 0)，fov 65 near .1 far 100
 *   phones 组 y = 0.55p − 6（0.55 倍视差）
 *   viewportHeight（世界）= 2·5·tan(32.5°) ≈ 6.371（z=0 平面可视高度）
 */

export interface ContactHitRegion {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AboutContactHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** GLB + uikit 字体加载完成（或失败）后 resolve */
  ready: Promise<void>;
  setSize: (width: number, height: number) => void;
  /** 列内容屏数 d（动态测高；供段长/maxS 计算） */
  length: () => number;
  /**
   * @param enterScreens   scroll − contactStart（屏，可为负：转场提前量）
   * @param lengthScreens  contact 段总长（屏，与 length() 同源）
   */
  update: (
    dt: number,
    time: number,
    state: { enterScreens: number; lengthScreens: number; mouseX: number; mouseY: number; touch?: boolean }
  ) => void;
  /** 链接命中区域（屏幕 CSS 像素），仅段内有效 */
  hitRegions: () => ContactHitRegion[];
  dispose: () => void;
}

// ---------- 原站常量 ----------
const FOV = 65;
const CAM_Z = 5;
const VH = 2 * CAM_Z * Math.tan(((FOV / 2) * Math.PI) / 180); // ≈ 6.371 世界单位
const INK = '#f0f0f0';
/** 原站 nM/nL（04kr:20562-20585）：线性重映射 + clamp，无缓动 */
const nM = (v: number, a: number, b: number, c: number, d: number) => c + ((v - a) / (b - a)) * (d - c);
const nL = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function createAboutContactScene(width: number, height: number): AboutContactHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#040405');

  const camera = new THREE.PerspectiveCamera(FOV, Math.max(1, width) / Math.max(1, height), 0.1, 100);
  camera.position.set(0, 0, CAM_Z);
  camera.lookAt(0, 0, 0);

  // =====================================================================
  // uikit 列（M3 渲染层：MSDF 文字 + SDF 面板）
  // =====================================================================
  const uikitRootGroup = new THREE.Group();
  scene.add(uikitRootGroup);

  let fonts: ContactFonts | null = null;
  let handles: ContactColumnHandles | null = null;
  let ukRoot: UIElement | null = null;
  const uikit = new UIKitRenderer({ pixelSize: 1, color: INK });
  uikitRootGroup.add(uikit.rootObject);

  let dLen = CONTACT_LENGTH_STATIC; // 列屏数（动态收敛，初值取静态注册值）
  let helloAnchor = 2.0; // hello 块底端屏位（黑幕锚点，原站 s.current = helloBlock.height/vh）
  let layoutDirty = true;
  let curVw = Math.max(1, width);
  let curVh = Math.max(1, height);

  const fontsReady = Promise.all([
    loadFont('/fonts/stix_regular.json'),
    loadFont('/fonts/stix_medium.json'),
    loadFont('/fonts/stix_bold.json'),
  ]).then(([regular, medium, bold]) => {
    fonts = { regular, medium, bold };
  });

  /** px→世界换算（原站 uU：pixelSize = viewportWidth/width；z=0 平面 1 世界 = vh/VH 屏幕 px）
   *  → 1 CSS px = VH/vh 世界（1440×900 时 ≈ 0.00708，与 oG 默认 0.01 同量级） */
  const psOf = (_vw: number, vh: number) => VH / Math.max(1, vh);

  /** 布局 + 镜像重建（视口变化/字体就绪时） */
  const rebuildUikit = (vw: number, vh: number) => {
    if (fonts == null) return;
    const prev = handles;
    handles = buildContactContentColumn(fonts, vw, vh);
    // uk 根定高用当前页长（动态值；布局后再修正）
    ukRoot = buildContactRoot(handles, vw, vh, dLen);
    ukRoot.applyViewport(vw);
    ukRoot.calculateLayout(vw, undefined);
    // dLen = 内容列高 / 视口高（uN → setPageLength）
    const contentH = handles.contentCol.getComputedHeight();
    if (contentH > 0) dLen = contentH / vh;
    // 根高随 dLen 修正后重排一次（根定高 = vh·d）
    ukRoot.node.setHeight(vh * dLen);
    ukRoot.calculateLayout(vw, undefined);
    if (prev != null) uikit.dispose();
    uikit.mount(ukRoot);
    uikit.update();
    layoutDirty = false;
  };

  // cl 遮罩（37845-37890）：uF absolute top0 left0 right0 bottom:-50 → 1×1 plane
  // alpha = uv.y<0.2 ? 1 : pow(smoothstep(0,.8,1-uv.y),.6)（底部全黑向上淡出）
  const clMat = new THREE.MeshBasicNodeMaterial();
  clMat.transparent = true;
  clMat.depthTest = false;
  clMat.depthWrite = false;
  clMat.toneMapped = false;
  clMat.colorNode = T.vec3(0, 0, 0) as any;
  clMat.opacityNode = (() => {
    const e = T.pow(T.smoothstep(0, 0.8, T.float(1).sub(T.uv().y)), 0.6);
    return T.mix(T.float(1), e, T.step(0.2, T.uv().y));
  })() as any;
  const clMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), clMat);
  clMesh.renderOrder = 1000;
  clMesh.frustumCulled = false;
  clMesh.visible = false;
  uikitRootGroup.add(clMesh);

  /** cl 遮罩几何/位置（goodbuyHead 矩形：absolute 盖块 + 底部延 50 CSS px） */
  const updateClMask = () => {
    if (handles == null || ukRoot == null) {
      clMesh.visible = false;
      return;
    }
    const r = uikit.getElementWorldRect(handles.goodbuyHead);
    if (r == null || r.h <= 0) {
      clMesh.visible = false;
      return;
    }
    const ext = 50 * psOf(curVw, curVh); // 50 CSS px → 世界
    const h = r.h + ext;
    clMesh.visible = true;
    clMesh.scale.set(r.w, h, 1);
    // 中心 = 块中心 − 延伸/2（世界 y-up：块顶在 cy + h/2）
    clMesh.position.set(r.cx, r.cy - ext / 2, 0);
  };

  // =====================================================================
  // phones（cf 1:1：材质覆盖 + 背景 TSL shader + 组变换）
  // =====================================================================
  const phonesGroup = new THREE.Group();
  phonesGroup.position.set(0.2, -6, -3.5); // x 按原站首帧群中心 50%W 重校（旧 0.9 偏右）
  scene.add(phonesGroup);

  phonesGroup.add(new THREE.AmbientLight(0xffffff, 2.4));
  const keyPoint = new THREE.PointLight(0xffccdd, 300, 0, 2);
  keyPoint.position.set(0, 5, 0);
  phonesGroup.add(keyPoint);
  // cS 形状光（F=.4·lightsIntensity，默认 1）：ring/box 近似为点光
  const addLight = (color: number, intensity: number, dist: number, x: number, y: number, z: number) => {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  };
  addLight(0xf5f0dc, 15 * 0.4, 60, 2, 3, -2); // ring beige [2,3,-2] scale3
  addLight(0xffffff, 80 * 0.4, 60, -14, 10, 8);
  addLight(0xffffff, 80 * 0.4 * 2, 28, -14, 14, -4); // light{100,dist28,decay2}
  addLight(0xffffff, 23 * 0.4 * 2, 28, 14, 12, 0);
  addLight(0xffffff, 16 * 0.4, 60, 0, 9, 14);

  // =====================================================================
  // 烟雾粒子（cC：smoke.webp × 50，opacity .5 白，慢自转 0.1 rad/s）
  // =====================================================================
  const smokeGroup = new THREE.Group();
  scene.add(smokeGroup);
  const smokeTex = new THREE.TextureLoader().load('/textures/smoke.webp');
  smokeTex.colorSpace = THREE.SRGBColorSpace;
  const smokeMats: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 50; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: smokeTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      color: 0xffffff,
    });
    smokeMats.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.position.set((Math.random() * 2 - 1) * 16, Math.random() * 14, -4 - Math.random() * 24);
    const s = 1.5 + Math.random() * 2.5;
    mesh.scale.set(s, s, 1);
    mesh.rotation.z = Math.random() * Math.PI * 2;
    smokeGroup.add(mesh);
  }

  // =====================================================================
  // 黄星群（cb：主星 flat + 7 副星 extrude；原站 contact 段实测无星——整体隐藏，
  // 仅 tie→contact 转场窗口飞过；组件保留以便后续考证）
  // =====================================================================
  const starShape = () => {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 2 : 1;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = r * Math.cos(a);
      const yy = r * Math.sin(a);
      if (i === 0) shape.moveTo(x, yy);
      else shape.lineTo(x, yy);
    }
    shape.closePath();
    return shape;
  };
  const shape = starShape();
  const STAR_YELLOW = new THREE.Color('rgb(255, 255, 80)');

  const starOpacityMain = T.uniform(0);
  const starMainMat = new THREE.MeshBasicNodeMaterial();
  starMainMat.colorNode = T.color(STAR_YELLOW);
  starMainMat.transparent = true;
  starMainMat.opacityNode = starOpacityMain;
  starMainMat.depthTest = false;
  starMainMat.toneMapped = false;
  const starMain = new THREE.Mesh(new THREE.ShapeGeometry(shape), starMainMat);
  starMain.renderOrder = 3;
  starMain.frustumCulled = false;
  scene.add(starMain);

  const starGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.01,
    bevelThickness: 0.01,
  });
  const starExtras: Array<{ mesh: THREE.Mesh; opacity: any }> = [];
  for (let i = 0; i < 7; i++) {
    const opacity = T.uniform(0);
    const mat = new THREE.MeshStandardNodeMaterial();
    mat.metalness = 0.5;
    mat.roughness = 0.05;
    mat.color = STAR_YELLOW;
    mat.transparent = true;
    mat.opacityNode = opacity;
    const mesh = new THREE.Mesh(starGeo, mat);
    mesh.frustumCulled = false;
    starExtras.push({ mesh, opacity });
    scene.add(mesh);
  }

  // =====================================================================
  // phones.glb（cf 1:1：材质名覆盖 + 背景 TSL shader + 变换）
  // =====================================================================
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  loader.setDRACOLoader(draco);
  let readyResolve: (() => void) | null = null;
  const ready = Promise.all([
    new Promise<void>((resolve) => {
      readyResolve = resolve;
    }),
    fontsReady,
  ]).then(() => undefined) as Promise<void>;
  let disposed = false;
  const loadedMaterials = new Set<THREE.Material>();
  const loadedTextures = new Set<THREE.Texture>();

  loader.load(
    // ?v=2：原站 2026-10-15 重新导出过 phones.glb（电话组位置大幅调整），穿透旧缓存
    '/asset/models/phones.glb?v=2',
    (gltf) => {
      if (disposed) {
        resolveReady();
        return;
      }
      const root = gltf.scene;
      // 材质覆盖（原站 t8 语义）。metallic/black 的 metalness 按本地无 envMap 的场景调低：
      // 原站有环境光照时金属件呈亮白反射；本地无 envMap，高金属度会反射成纯黑
      // （s1 基座区发黑的根因）
      const overrides: Record<string, Record<string, unknown>> = {
        green: { map: null, emissive: new THREE.Color('#0f0'), emissiveIntensity: 1 },
        red: { map: null, emissive: new THREE.Color('#f00'), emissiveIntensity: 1 },
        metallic: { roughness: 0.5, metalness: 0.35, color: new THREE.Color('#fff') },
        white: { roughness: 0.5, metalness: 0 },
        black: { roughness: 0.5, metalness: 0.15, color: new THREE.Color('#000') },
        'shader-logo': { roughness: 0, metalness: 0 },
      };
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const apply = (raw: any) => {
          const mat = raw as THREE.MeshStandardMaterial;
          if (!mat) return;
          loadedMaterials.add(mat);
          if (mat.map) loadedTextures.add(mat.map);
          if (mesh.name.toLowerCase().includes('background')) {
            // 背景 TSL shader（原站 cf colorNode 1:1）：
            // n = min(bg·(0.5 + dirt(uv×6.5,5).g×1.9), 1)；fade = 1−smoothstep(13,26,dist to (0,0,-24))
            const dirt = new THREE.TextureLoader().load('/textures/contact_dirt.jpg');
            dirt.wrapS = THREE.RepeatWrapping;
            dirt.wrapT = THREE.RepeatWrapping;
            dirt.colorSpace = THREE.SRGBColorSpace;
            const bgMap = mat.map;
            if (bgMap) loadedTextures.add(bgMap);
            const std = new THREE.MeshStandardNodeMaterial();
            std.roughness = 0.7;
            std.metalness = 0.6;
            std.side = THREE.FrontSide;
            std.colorNode = T.Fn(() => {
              const uv = T.uv();
              const dirtG = T.texture(dirt as any, uv.mul(T.vec2(6.5, 5))).g.mul(1.6);
              const bg = bgMap ? T.texture(bgMap as any, uv).rgb : T.vec3(0.02, 0.02, 0.02);
              const n = T.min(bg.mul(T.float(0.5).add(dirtG.mul(1.9))), T.vec3(1));
              const dist = T.length(T.positionWorld.sub(T.vec3(0, 0, -24))).toVar();
              const fade = T.float(1).sub(T.smoothstep(13, 26, dist));
              return n.mul(fade).toVar();
            })() as any;
            mesh.material = std;
            loadedMaterials.add(std);
            return;
          }
          const ov = overrides[mat.name];
          if (ov) {
            for (const [k, v] of Object.entries(ov)) (mat as any)[k] = v;
          }
          mat.side = THREE.FrontSide;
          mat.needsUpdate = true;
        };
        if (Array.isArray(mesh.material)) mesh.material.forEach(apply);
        else apply(mesh.material);
      });
      // 组变换（原站 cf 1:1，逐值照抄，不做任何再校准）：
      // group [.9,0,-3.5] + primitive scale1.1 rot[.3,π,0] pos[0,-4,-3] + 组 y=0.55p−6
      // 三台话机同组统一变换（phones mesh 11×19×20 一体），滚动时整组 0.55 倍速视差——
      // 此前按话机宽度误判做的 pullByPrefix 分组拉近破坏了这个连贯空间，已废除。
      // 重算验证：话机群世界 z −8.9..−30.7（最近端距相机 13.9），视觉宽 35% 屏 ≈ 原站实测。
      // 组变换（原站 cf 公式 0.55p−6 + primitive 变换）。scale/基准按 2026-10-24 原站 1440×900
      // 首帧实测重校：原站话机群宽 59% 屏、中心 66% 高——本地旧值(1.1/−6)为 47%/35%，
      // scale 1.1→1.38（宽度比 59/47），基准 −6→−8.1（scale 放大后中心随动，迭代目检定值）
      const primitive = new THREE.Group();
      primitive.scale.setScalar(1.34);
      primitive.rotation.set(0.3, Math.PI, 0);
      primitive.position.set(0, -4, -3);
      primitive.add(root);
      phonesGroup.add(primitive);
      resolveReady();
    },
    undefined,
    () => {
      // 加载失败：星空+列文案仍可用，不阻塞页面
      resolveReady();
    },
  );

  function resolveReady() {
    if (readyResolve) {
      readyResolve();
      readyResolve = null;
    }
  }

  // =====================================================================
  // 每帧更新（cp useImperativeHandle 公式 1:1）
  // =====================================================================
  const smoothMouse = { x: 0, y: 0 };

  const update: AboutContactHandle['update'] = (dt, _time, state) => {
    const d = dLen;
    const end = Math.max(0.001, state.lengthScreens - 1);
    // 原站 n_() 即 clamp（与 nL 同款），p 线性：e=0.05 时 p=5.5 世界 → 首帧 Hello 顶 8% ✓
    const h01 = nL(nM(state.enterScreens, -1.12, end, 0, 1), 0, 1);
    const g = nL(nM(state.enterScreens, -1, end, 0, 1), 0, 1) * (d - 1);

    const p = h01 * VH * (d - 1);

    // 鼠标弹簧阻尼（原站 useSpringMouse 近似）
    const targetX = state.touch ? 0 : state.mouseX;
    const targetY = state.touch ? 0 : state.mouseY;
    const ease = 1 - Math.exp(-6 * Math.min(0.05, dt));
    smoothMouse.x += (targetX - smoothMouse.x) * ease;
    smoothMouse.y += (targetY - smoothMouse.y) * ease;

    // 相机：(0.25mx, 0.25my − p, 5) lookAt(0,−p,0)
    camera.position.set(0.25 * smoothMouse.x, 0.25 * smoothMouse.y - p, CAM_Z);
    camera.lookAt(0, -p, 0);

    // 列居中（04kr:38250-38255）：group y = −vh·len·0.5 + 0.5·vh（世界）
    // vh 世界 = VH；列根 g_state 高 = vh·d（buildContactRoot）
    // uikit 根 group 由 rootObject 位置表达：列中心对齐
    //   列根 globalMatrix 中心在世界原点（rc=0），列顶(世界)= +VH·d/2
    //   需要让"视口顶(相机 lookAt −p 处上 VH/2)"对齐列顶 + g·VH（列滚 g 页）
    //   原站把列放进 group y = −vh·d·0.5 + 0.5·vh（世界），相机再移动 −p
    //   等价：rootGroup.y = −VH·d/2 + VH/2（列顶从视口顶开始），相机 y=−p 上移
    uikitRootGroup.position.y = -VH * d * 0.5 + VH * 0.5;

    // phones 组：y = 0.55p − 8.1（基准按原站首帧重校，见 primitive 注释）
    phonesGroup.position.y = 0.55 * p - 9.36;

    // 星星：tie→contact 转场窗口飞过（原站 contact 段内逐屏采样无星——
    // cb 的 progress 对应页转场 t，enterScreens −1.6..−0.5 飞入、−0.5..0 淡出）
    const starP = nL(nM(state.enterScreens, -1.6, -0.5, 0, 1), 0, 1);
    void starP;
    starOpacityMain.value = 0;
    for (const { opacity } of starExtras) opacity.value = 0;

    // 烟雾慢自转（原站 rotation [0,0,.1]/s）
    for (const m of smokeGroup.children) m.rotation.z += 0.1 * dt;

    if (layoutDirty) rebuildUikit(curVw, curVh);
    uikit.update();
    // 黑幕 f 写在 uikit.update() 之后（renderer.updateRecursive 每帧重写 data1，先写会被覆盖）
    const edge = curVw > 640 ? 120 : 80;
    const f = nL(nM(g, helloAnchor - edge / curVh, helloAnchor + 100 / curVh, 0, 1), 0, 1);
    if (ukRoot != null) {
      const u = uikit.getPanelUniforms(ukRoot);
      if (u != null) u.data1.set(0, 0, 0, f);
    }
    updateClMask();
    // hello 锚点 = helloBlock 高 / vh（原站 o 钩子：s.current = (e.height + 0)/A.height）
    if (handles != null) {
      const hb = handles.helloBlock.getComputedHeight();
      if (hb > 0) helloAnchor = hb / curVh;
    }
  };

  // =====================================================================
  // 命中投影（列内元素世界 rect → 屏幕 CSS px）
  // =====================================================================
  const hitRegions = (): ContactHitRegion[] => {
    const out: ContactHitRegion[] = [];
    if (handles == null) return out;
    const pxPerWorld = curVh / VH; // z=0 平面：1 世界单位 = vh/VH 屏幕 px
    const v = new THREE.Vector3();
    for (const [key, el] of handles.links) {
      const r = uikit.getElementWorldRect(el);
      if (r == null) continue;
      // uikitRootGroup.y 偏移（列居中）
      const wy = r.cy + uikitRootGroup.position.y;
      v.set(r.cx, wy, 0).project(camera);
      const sx = (v.x * 0.5 + 0.5) * curVw;
      const sy = (1 - (v.y * 0.5 + 0.5)) * curVh;
      out.push({
        key,
        x: sx - (r.w * pxPerWorld) / 2,
        y: sy - (r.h * pxPerWorld) / 2,
        w: r.w * pxPerWorld,
        h: r.h * pxPerWorld,
      });
    }
    return out;
  };

  const setSize = (w: number, h: number) => {
    curVw = Math.max(1, w);
    curVh = Math.max(1, h);
    camera.aspect = curVw / curVh;
    // 竖屏放宽 fov（原站竖屏话机群完整入画、Hello 无遮挡）
    camera.fov = camera.aspect < 0.72 ? 78 : FOV;
    camera.updateProjectionMatrix();
    uikit.setPixelSize(psOf(curVw, curVh));
    layoutDirty = true;
  };
  setSize(width, height);

  const dispose = () => {
    disposed = true;
    resolveReady();
    uikit.dispose();
    clMat.dispose();
    clMesh.geometry.dispose();
    smokeTex.dispose();
    for (const m of smokeMats) m.dispose();
    starMainMat.dispose();
    starMain.geometry.dispose();
    starGeo.dispose();
    for (const { mesh } of starExtras) (mesh.material as THREE.Material).dispose();
    for (const t of loadedTextures) t.dispose();
    for (const m of loadedMaterials) m.dispose();
    loadedMaterials.clear();
    loadedTextures.clear();
    scene.clear();
  };

  return { scene, camera, ready, setSize, length: () => dLen, update, hitRegions, dispose };
}
