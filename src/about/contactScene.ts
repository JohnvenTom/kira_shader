/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { loadFont } from '../uikit/font.ts';
import type { ContactFonts } from '../uikit/contactColumn.ts';
import { buildContactContentColumn, buildContactRoot, CONTACT_LENGTH_STATIC, type ContactColumnHandles } from '../uikit/contactColumn.ts';
import { UIKitRenderer } from '../uikit/renderer.ts';
import { createSpringMouse } from '../work-about/springMouse';
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
 *   相机 = (0.25·off.x, 0.25·off.y − p, 5)，lookAt(0, −p, 0)，fov 65 near .1 far 100
 *   off = getMouseOffset() = 0.5 − mouse01 ∈ ±0.5（spring(60,30) 阻尼）
 *   ⇒ NDC 入参换算：camera.xy += (−0.125·NDC.x, −0.125·NDC.y)
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
  phonesGroup.position.set(0.9, 0, -3.5); // 原站 cf 值（bundle 1:1）
  // ★ bundle 38248-38345 结构：cf 与 uk 列同级，都在 y=−VH·d/2+VH/2 的滚动居中组内。
  // 此前挂在 scene 根上 = 比原站高 9.14 世界单位（1.4 屏），话机首帧顶到 Hello 后面
  // 且视角/离场节奏全错（用户报告"地面亮面朝下"+电话段"滚动变短"的共因）。
  uikitRootGroup.add(phonesGroup);

  phonesGroup.add(new THREE.AmbientLight(0xffffff, 2.4));
  const keyPoint = new THREE.PointLight(0xffccdd, 300, 0, 2);
  keyPoint.position.set(0, 5, 0);
  phonesGroup.add(keyPoint);
  // 注意：cf 只有以上两盏灯（bundle 04kr:38166-38173）。2026-10-24 曾误把 reveal 段
  // cS/Lightformer 的 5 盏形状光近似成点光加进 contact（z=8/14 正对近处地面轰击，
  // 造成用户报告的"地面亮面朝下"），已删除。

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
            // r169 WebGPU 渲染器没有 WebGL 版的负行列式 frontFace 自动翻转
            // （r180 已加 determinantAffine<0→"cw"，bundle 0y2r:32904；r169 恒 CCW）。
            // background 节点三轴负 scale（GLB s=(-109.75,-30.34,-30.34)，point reflection
            // 用于从房间内部看内壁）→ 环绕序翻转 → 整壳被背面剔除，地面/墙面全不可见
            // （用户报告"地面着色反了/发光面在下面"的真因）。手动翻转三角形环绕序
            // 等价 r180 行为；法线不翻（与原站着色一致：地面亮度=albedo×ambient×fade）。
            const geo = mesh.geometry;
            let idx = geo.getIndex();
            if (idx == null) {
              const count = geo.getAttribute('position').count;
              const full = new Uint32Array(count);
              for (let i = 0; i < count; i++) full[i] = i;
              idx = new THREE.BufferAttribute(full, 1);
              geo.setIndex(idx);
            }
            const arr = idx.array as unknown as Uint32Array | Uint16Array;
            for (let i = 0; i + 2 < arr.length; i += 3) {
              const t = arr[i];
              arr[i] = arr[i + 2];
              arr[i + 2] = t;
            }
            idx.needsUpdate = true;
            // 着色法线同样要翻：three WebGL/r180 对负行列式对象走 FLIP_SIDED 把
            // 着色法线一并翻转（弧面地板的法线经负 scale 逆转置后朝下，再翻一次
            // 才朝上接受头顶点光——r169 WebGPU 无此逻辑，地面因此照不亮）。
            const nor = geo.getAttribute('normal');
            if (nor) {
              const na = nor.array as Float32Array;
              for (let i = 0; i < na.length; i++) na[i] = -na[i];
              nor.needsUpdate = true;
            }
            // 背景 TSL shader（原站 cf colorNode 1:1）：
            // n = min(bg·(0.5 + dirt(uv×6.5,5).g×1.9), 1)；fade = 1−smoothstep(13,26,dist to (0,0,-24))
            const dirt = new THREE.TextureLoader().load('/textures/contact_dirt.jpg');
            dirt.wrapS = THREE.RepeatWrapping;
            dirt.wrapT = THREE.RepeatWrapping;
            dirt.colorSpace = THREE.SRGBColorSpace;
            const bgMap = mat.map;
            if (bgMap) loadedTextures.add(bgMap);
            // bg 贴图采样 = raw 直采（见 colorNode 内注释）；GLTF 默认
            // LinearMipmapLinear + r169 自动 mip 生成有效——光池边缘柔化正常。
            // 注意：SwiftShader 上下文被反复 reload/实验污染后 mip 内存会损坏，
            // 出现硬边梯形伪影——重启 Chrome 即愈（2026-10-24 实证，勿改代码）。
            const std = new THREE.MeshStandardNodeMaterial();
            std.roughness = 0.7;
            std.metalness = 0.6;
            std.side = THREE.FrontSide;
            std.colorNode = T.Fn(() => {
              const uv = T.uv();
              const dirtG = T.texture(dirt as any, uv.mul(T.vec2(6.5, 5))).g.mul(1.6);
              // ★ bg 贴图采样方向：分块差定量裁决（2026-10-24，原站首帧 8×8 对比）：
              //   raw (u,v)=5.8 最优；v 翻 8.0 / h 翻 7.6 / 双翻 8.0——此前的
              //   "flipY 补偿"理论证伪，r169 与 r180 在此一致，raw 直采正确。
              //   ?dbgBg=v|h|hv 保留供复查。
              const dbgBg = new URLSearchParams(location.search).get('dbgBg');
              const bgUv =
                dbgBg === 'v' ? uv.mul(T.vec2(1, -1)).add(T.vec2(0, 1))
                : dbgBg === 'h' ? uv.mul(T.vec2(-1, 1)).add(T.vec2(1, 0))
                : dbgBg === 'hv' ? uv.mul(T.vec2(-1, -1)).add(T.vec2(1, 1))
                : uv;
              const bg = bgMap ? T.texture(bgMap as any, bgUv).rgb : T.vec3(0.02, 0.02, 0.02);
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
      // 组变换（bundle cf 1:1：scale 1.1 / rot[0.3,π,0] / pos[0,-4,-3] / group y=0.55p−6）。
      // 2026-10-24 曾按首帧目检放大到 1.34/−9.36——但那会把背景壳一起放大，壳的地面
      // 进入 fade<26 近距离亮圈（用户报告"亮面在下面"），且偏离 bundle 数值，已回滚。
      const primitive = new THREE.Group();
      primitive.scale.setScalar(1.1);
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
  /** 鼠标视差阻尼（原站 useSpringMouse spring(60,30)，跟 offset ±0.5） */
  const contactSpring = createSpringMouse();

  const update: AboutContactHandle['update'] = (dt, _time, state) => {
    const d = dLen;

    const end = Math.max(0.001, state.lengthScreens - 1);
    // 原站 n_() 即 clamp（与 nL 同款），p 线性：e=0.05 时 p=5.5 世界 → 首帧 Hello 顶 8% ✓
    const h01 = nL(nM(state.enterScreens, -1.12, end, 0, 1), 0, 1);
    const g = nL(nM(state.enterScreens, -1, end, 0, 1), 0, 1) * (d - 1);

    const p = h01 * VH * (d - 1);

    // 鼠标视差：原站 getMouseOffset() = 0.5 − mouse01 ∈ ±0.5（spring(60,30) 阻尼，
    // touch 恒 0）→ 相机 xy = ±0.125。NDC 入参换算 = −0.125·NDC。
    contactSpring.update(dt, state.touch ? 0 : -state.mouseX * 0.5, state.touch ? 0 : -state.mouseY * 0.5);

    // 相机：(0.25·off.x, 0.25·off.y − p, 5) lookAt(0,−p,0)
    camera.position.set(0.25 * contactSpring.px, 0.25 * contactSpring.py - p, CAM_Z);
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
    phonesGroup.position.y = 0.55 * p - 6;

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
    for (const t of loadedTextures) t.dispose();
    for (const m of loadedMaterials) m.dispose();
    loadedMaterials.clear();
    loadedTextures.clear();
    scene.clear();
  };

  return { scene, camera, ready, setSize, length: () => dLen, update, hitRegions, dispose };
}
