/**
 * 工牌几何装配（对齐站点 ni 内部的全部建模代码）
 *
 * 一件一件对应的清单（尺寸与站点逐字一致）：
 *  - 卡套外轮廓：圆角矩形 2.72×4.36（圆角 .19），挖 2 个 r=.104 圆孔 + 1 个 .66×.13 腰形孔
 *  - 胶套前壳：外轮廓 Extrude（depth .008 + 斜角），z=.045
 *  - 胶套背面：同轮廓 ShapeGeometry，翻转 180°，z=.005
 *  - 磨损贴花：2.52×3.87 平面，z=.061（胶膜外表面）
 *  - 三道筋线：外圈 / 内圈 / 腰形孔包边（TubeGeometry 闭合环）
 *  - 两个圆孔金属环：TorusGeometry(.109,.013)
 *  - 顶部 4 道车线 + 19 颗微珠（焊接/防滑点）
 *  - 印刷卡：RoundedBoxGeometry(2.4,3.52,.025) + 正反面平面
 *  - 五金：爪夹（clasp）/ 旋环（eye）/ 轭（yoke）三件套 + 穿过轭的短织带
 *  - 接地：100×100 ShadowMaterial 背板（z=-1）
 *
 * 注意事项：
 *  - 所有部件都挂在「卡组 anchor」下（五金三件套与织带除外，它们由各自刚体驱动，
 *    直接挂场景）
 *  - renderOrder（2/3/4）是站点写死的，用来固定半透明层的前后绘制顺序
 *  - 想换自己的工牌画面无需改本文件：scene.setCard(图片) 会替换印刷面贴图
 */

import * as THREE from 'three';
// RoundedBoxGeometry 不在 three 主入口，需从 examples/jsm 引入（@types/three 有对应声明）
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BadgeConfig } from './badgeConfig';
import {
  createThinVinylMaterial,
  type BadgeFilmUniforms,
} from './badgeMaterials';
import {
  BadgeStrapRibbon,
} from './badgeStrap';
import {
  prepareArtworkTexture,
  createNoiseBumpTexture,
  createWearTexture,
  ARTWORK_PLANE_WIDTH,
  ARTWORK_PLANE_HEIGHT,
} from './badgeTextures';

/** 装配结果：所有需要被外部引用的对象 */
export interface BadgeAssembly {
  /** 卡组（卡套 + 印刷卡 + 全部外观件），由物理刚体驱动 */
  anchor: THREE.Group;
  /** 射线命中目标（印刷卡的圆角板） */
  cardSlab: THREE.Mesh;
  /** 爪夹组（独立刚体） */
  clasp: THREE.Group;
  /** 旋环组（独立刚体） */
  eye: THREE.Group;
  /** 轭组（独立刚体） */
  yoke: THREE.Group;
  /** 两条织带网格（世界坐标，直接挂场景） */
  straps: BadgeStrapRibbon[];
  /** 接地阴影背板 */
  ground: THREE.Mesh;
  /** 印刷面材质（换卡时改 map） */
  artworkMaterial: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  /** 印刷面网格 */
  artworkPlane: THREE.Mesh;
  /** 需要每帧回写的材质引用 */
  refs: {
    /** 胶膜材质（前壳 / 背面），需回写 roughness 与 envMapIntensity */
    film: THREE.MeshPhysicalMaterial;
    /** 硬件胶片材质（筋线 / 圆环 / 车线），需回写 envMapIntensity */
    hardware: THREE.MeshPhysicalMaterial;
    /** 金属件材质，需回写 roughness */
    metal: THREE.MeshStandardMaterial;
    /** 织带材质，需回写 color */
    strap: THREE.MeshStandardMaterial;
    /** 磨损贴花材质，需回写 opacity */
    wearOverlay: THREE.MeshBasicMaterial;
    /** 接地阴影材质，需回写 opacity */
    ground: THREE.ShadowMaterial;
  };
  /** 统一销毁用的材质 / 贴图清单 */
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

/**
 * 生成圆角矩形 Shape（站点 $r 的逐字搬移）
 *
 * 功能：以原点为中心构造宽 w、高 h、圆角半径 r 的圆角矩形轮廓。
 *
 * 参数：
 *  - w {number} 宽
 *  - h {number} 高（竖直方向高度加法与原实现一致）
 *  - r {number} 圆角半径
 *
 * 返回值：{THREE.Shape} 轮廓（可继续 push holes 当挖孔模板）
 * 异常：无
 */
function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/**
 * 在父节点上创建网格（站点 Re 的逐字搬移）
 *
 * 功能：new Mesh(geometry, material) → 设位置 → add 到父节点并返回。
 *
 * 参数：
 *  - geometry {THREE.BufferGeometry} 几何
 *  - material {THREE.Material} 材质
 *  - parent   {THREE.Object3D} 父节点
 *  - x / y / z {number} 局部位置，默认 0
 *
 * 返回值：{THREE.Mesh} 新建的网格
 * 异常：无
 */
function addMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parent: THREE.Object3D,
  x = 0,
  y = 0,
  z = 0
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/**
 * 建一条"沿圆角矩形走一圈"的闭合筋线
 *
 * 功能：把圆角矩形按 24 段采样成闭合 CatmullRomCurve3，套 TubeGeometry；
 *      每个采样点的 z 加一点正弦抖动（避免线条过于机械），
 *      再给路径点整体赋 z 值（r 参数即站点里的"z 平面"）。
 *
 * 参数：
 *  - w / h / corner {number} 轮廓宽 / 高 / 圆角半径
 *  - z              {number} 筋线所在平面深度
 *  - tubeRadius     {number} 管的半径
 *  - material       {THREE.Material} 材质
 *  - yOffset        {number} 轮廓整体上移量（腰形孔包边用 1.88）
 *  - parent         {THREE.Object3D} 父节点
 *
 * 返回值：{THREE.Mesh} 筋线网格
 * 异常：无
 */
function addOutlineRibbon(
  w: number,
  h: number,
  corner: number,
  z: number,
  tubeRadius: number,
  material: THREE.Material,
  yOffset: number,
  parent: THREE.Object3D
): THREE.Mesh {
  const points = roundedRect(w, h, corner)
    .getPoints(24)
    .map((p) => new THREE.Vector3(p.x, p.y + yOffset, z));
  // 闭合轮廓的收尾点与首点重合，去掉它交给 CatmullRomCurve3 闭环
  if (points[0].distanceTo(points[points.length - 1]) < 1e-4) points.pop();
  points.forEach((p, i) => {
    p.z += 0.002 * Math.sin(i * 1.7) + 0.0015 * Math.sin(i * 0.47);
  });
  const curve = new THREE.CatmullRomCurve3(points, true);
  return addMesh(new THREE.TubeGeometry(curve, 220, tubeRadius, 10, true), material, parent);
}

/**
 * 构建五金三件套（站点 Zr 的逐字搬移）
 *
 * 功能：用贝塞尔曲线 + Extrude / Tube / Box 拼出：
 *  - clasp（爪夹）：带斜角的外壳轮廓、弹簧臂、弹簧片、铰链轴、两颗压铆点
 *  - eye（旋环）：上下两块基座、中间一个椭圆环
 *  - yoke（轭）：D 形环 + 穿过它的短织带（64 段，用织带网格类现场生成）+ 12 颗防滑齿
 *
 * 参数：
 *  - metalMaterial  {THREE.Material} 金属材质
 *  - strapMaterial  {THREE.Material} 织物材质
 *
 * 返回值：{ clasp: THREE.Group; eye: THREE.Group; yoke: THREE.Group }
 * 异常：无
 *
 * 注意事项：
 *  - 短织带只在初始化时 update 一次（update(curve, up, 1)），之后形状是静态的
 *  - 短织带**只挂在 yoke 组里**，绝不能登记到"长织带数组"里：
 *    长织带由 createBadgeScene 统一 scene.add（它们的顶点是世界坐标），
 *    一旦短织带也被 add 到场景根，three 会把它从 yoke 组里摘出来，
 *    结果一条深色织带留在世界原点附近（工牌正中间会出现一块黑斑）
 */
function buildHardware(
  metalMaterial: THREE.Material,
  strapMaterial: THREE.Material
): { clasp: THREE.Group; eye: THREE.Group; yoke: THREE.Group } {
  const clasp = new THREE.Group();
  const eye = new THREE.Group();
  const yoke = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI / 2;
  clasp.add(inner);

  const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

  /** 在指定父节点上放一个网格（五金件统一 castShadow） */
  const put = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D,
    pos = v3()
  ) => {
    const mesh = addMesh(geometry, material, parent);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    return mesh;
  };

  /** 在两点之间拉一根方棒（沿 Y→方向 的朝向修正） */
  const bar = (
    from: THREE.Vector3,
    to: THREE.Vector3,
    thickness: number,
    parent: THREE.Object3D = inner
  ) => {
    const dir = to.clone().sub(from);
    const mesh = put(
      new THREE.BoxGeometry(thickness, thickness, dir.length(), 20),
      metalMaterial,
      parent,
      from.clone().add(to).multiplyScalar(0.5)
    );
    mesh.quaternion.setFromUnitVectors(v3(0, 1, 0), dir.normalize());
    return mesh;
  };

  /** 用一串点拉一根管 */
  const tube = (
    points: THREE.Vector3[],
    radius: number,
    parent: THREE.Object3D = inner
  ) => put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, radius, 12, false), metalMaterial, parent);

  // —— 爪夹外壳：侧面轮廓 + 斜角挤出 ——
  const outline = new THREE.Shape();
  outline.moveTo(-0.052, 0.245);
  outline.lineTo(0.052, 0.245);
  outline.bezierCurveTo(0.062, 0.17, 0.075, 0.06, 0.105, -0.09);
  outline.quadraticCurveTo(0.075, -0.08, 0.04, -0.035);
  outline.quadraticCurveTo(-0.025, 0.045, -0.11, 0.018);
  outline.quadraticCurveTo(-0.07, 0.11, -0.052, 0.245);
  const shell = new THREE.ExtrudeGeometry(outline, {
    depth: 0.047,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.012,
    bevelThickness: 0.012,
    curveSegments: 20,
  });
  shell.translate(0, 0, -0.0235);
  put(shell, metalMaterial, inner);

  // —— 弹簧臂（两段贝塞尔） ——
  const springArm = new THREE.CurvePath<THREE.Vector3>();
  springArm.add(new THREE.CubicBezierCurve3(v3(0.075, 0.015), v3(0.14, -0.1), v3(0.13, -0.3), v3(0, -0.32)));
  springArm.add(new THREE.CubicBezierCurve3(v3(0, -0.32), v3(-0.15, -0.34), v3(-0.19, -0.2), v3(-0.15, -0.1)));
  put(new THREE.TubeGeometry(springArm, 80, 0.025, 16, false), metalMaterial, inner);

  // —— 弹簧片 ——
  const tongue = new THREE.Group();
  inner.add(tongue);
  const tongueCurve = new THREE.CubicBezierCurve3(
    v3(-0.03, 0.069),
    v3(-0.09, 0.075),
    v3(-0.13, -0.05),
    v3(-0.15, -0.1)
  );
  put(new THREE.TubeGeometry(tongueCurve, 40, 0.024, 16, false), metalMaterial, tongue).scale.z = 0.75;
  tube(
    [v3(0.073, 0.07, -0.01), v3(0.178, 0.015, -0.01), v3(0.182, -0.027, -0.01), v3(0.13, -0.047, -0.01)],
    0.011
  );

  // —— 铰链轴 + 两颗压铆点 ——
  const hinge = put(new THREE.BoxGeometry(0.028, 0.028, 0.075, 24), metalMaterial, inner, v3(-0.03, 0.069, 0));
  hinge.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) {
    put(new THREE.TorusGeometry(0.022, 0.0038, 8, 24), metalMaterial, inner, v3(-0.03, 0.069, side * 0.04));
    put(new THREE.SphereGeometry(0.012, 16, 10), metalMaterial, inner, v3(-0.03, 0.069, side * 0.04)).scale.z = 0.25;
  }

  // —— 爪夹与旋环的连接杆 ——
  bar(v3(0, 0.225, 0), v3(0, 0.285, 0), 0.042, clasp);

  // —— 旋环（eye） ——
  put(new THREE.BoxGeometry(0.069, 0.058, 0.085, 32), metalMaterial, eye, v3(0, -0.146, 0));
  put(new THREE.BoxGeometry(0.084, 0.084, 0.019, 32), metalMaterial, eye, v3(0, -0.115, 0));
  const eyeRing = new THREE.CatmullRomCurve3(
    [
      v3(-0.115, 0.13),
      v3(-0.125, 0.04),
      v3(-0.115, -0.07),
      v3(0, -0.1),
      v3(0.115, -0.07),
      v3(0.125, 0.04),
      v3(0.115, 0.13),
    ],
    false
  );
  put(new THREE.TubeGeometry(eyeRing, 80, 0.027, 12, false), metalMaterial, eye);
  bar(v3(-0.115, 0.13), v3(0.115, 0.13), 0.027, eye);

  // —— 轭（yoke）：D 形环 + 穿过的短织带 + 防滑齿 ——
  const gripMaterial = new THREE.MeshStandardMaterial({ color: '#777d68', roughness: 1 });
  const yokePath = new THREE.CatmullRomCurve3(
    [
      v3(0, 0.04, 0.061),
      v3(0, -0.06, 0.061),
      v3(0, -0.16, 0.061),
      v3(0, -0.22, 0),
      v3(0, -0.16, -0.061),
      v3(0, -0.06, -0.061),
      v3(0, 0.04, -0.061),
    ],
    false
  );
  const yokeLoop = new BadgeStrapRibbon(strapMaterial, 64, 0.085);
  yokeLoop.update(yokePath, v3(1, 0, 0), 1);
  yoke.add(yokeLoop.mesh);

  for (const side of [-1, 1]) {
    for (const offset of [-0.04, 0]) {
      for (let n = 0; n < 6; n++) {
        put(
          new THREE.BoxGeometry(0.01, 0.003, 0.002),
          gripMaterial,
          yoke,
          v3(-0.06 + n * 0.024, offset, side * 0.073)
        );
      }
    }
  }

  return { clasp, eye, yoke };
}

/**
 * 构建整块工牌
 *
 * 功能：创建卡组（胶套 + 印刷卡 + 筋线/圆环/车线/微珠）、五金三件套、两条织带网格、
 *      接地阴影背板，并把需要逐帧回写的材质引用集中返回。
 *
 * 参数：
 *  - renderer      {THREE.WebGLRenderer} 用于取各向异性上限
 *  - config        {BadgeConfig} 初始配置（材质/灯光相关项会被写入材质）
 *  - filmUniforms  {BadgeFilmUniforms} 胶膜共享 uniform
 *  - artwork       {CanvasImageSource} 印刷画面源（canvas 或图片）
 *
 * 返回值：{BadgeAssembly} 装配结果
 * 异常：若无法创建 2D canvas 上下文（生成程序化贴图）会抛出 TypeError
 *
 * 注意事项：
 *  - 站点把五金三件套与织带直接挂场景（它们的顶点是物理驱动的世界坐标），
 *    卡组 anchor 才由物理刚体整体驱动；不要把它们塞进 anchor
 *  - 所有程序化贴图都在这里生成（塑料 bump / 织物 bump / 磨损 / 印刷面）
 */
export function createBadgeAssembly(
  renderer: THREE.WebGLRenderer,
  config: BadgeConfig,
  filmUniforms: BadgeFilmUniforms,
  artwork: CanvasImageSource
): BadgeAssembly {
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const track = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const plasticBump = createNoiseBumpTexture('plastic');
  const fabricBump = createNoiseBumpTexture('fabric');
  const wearTexture = createWearTexture();
  textures.push(plasticBump, fabricBump, wearTexture);

  // —— 材质 ——
  const filmMaterial = track(createThinVinylMaterial(config.material.roughness, false, filmUniforms));
  filmMaterial.envMapIntensity = config.lighting.reflections;

  const hardwareFilm = track(createThinVinylMaterial(0.018, true, filmUniforms));
  hardwareFilm.color.set('#858c88');
  hardwareFilm.envMapIntensity = config.lighting.reflections;

  const metalMaterial = track(
    new THREE.MeshStandardMaterial({
      color: '#d5d9d6',
      metalness: 1,
      roughness: config.material.metalRoughness,
      bumpMap: plasticBump,
      bumpScale: 12e-5,
    })
  );

  const cardMaterial = track(new THREE.MeshStandardMaterial({ color: '#efebdf', roughness: 0.88 }));
  const backPrintMaterial = track(new THREE.MeshStandardMaterial({ color: '#eeeadf', roughness: 0.9 }));
  const ridgeMaterial = track(
    new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.015,
      transmission: 1,
      thickness: 0.008,
      ior: 1.1,
    })
  );
  const strapMaterial = track(
    new THREE.MeshStandardMaterial({
      color: config.material.strapColor,
      roughness: 0.9,
      bumpMap: fabricBump,
      bumpScale: 0.003,
    })
  );
  const wearOverlayMaterial = track(
    new THREE.MeshBasicMaterial({
      map: wearTexture,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
  );
  const groundMaterial = track(new THREE.ShadowMaterial({ opacity: config.lighting.shadow }));

  // 印刷面：无光照（原图色彩 1:1，不过 tone mapping）或 PBR（带塑料凹凸）
  const unlit = config.material.unlitArtwork === true;
  const artworkTexture = prepareArtworkTexture(artwork, THREE.SRGBColorSpace, maxAnisotropy);
  textures.push(artworkTexture);
  const artworkMaterial: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial = unlit
    ? track(new THREE.MeshBasicMaterial({ map: artworkTexture, toneMapped: false }))
    : track(
        new THREE.MeshStandardMaterial({
          map: artworkTexture,
          roughness: 0.84,
          metalness: 0,
          bumpMap: plasticBump,
          bumpScale: 15e-5,
        })
      );

  // —— 卡组 ——
  const anchor = new THREE.Group();

  // 卡套外轮廓 + 三个开孔
  const sleeveShape = roundedRect(2.72, 4.36, 0.19);
  for (const cx of [-0.88, 0.88]) {
    const hole = new THREE.Path();
    hole.absarc(cx, 1.89, 0.104, 0, Math.PI * 2, true);
    sleeveShape.holes.push(hole);
  }
  const slotShape = roundedRect(0.66, 0.13, 0.064);
  const slotHole = new THREE.Path();
  slotShape
    .getPoints(16)
    .reverse()
    .forEach((p, i) => {
      if (i === 0) slotHole.moveTo(p.x, p.y + 1.88);
      else slotHole.lineTo(p.x, p.y + 1.88);
    });
  sleeveShape.holes.push(slotHole);

  // 胶套前壳（挤出 + 斜角）
  const frontShell = addMesh(
    new THREE.ExtrudeGeometry(sleeveShape, {
      depth: 0.008,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.005,
      bevelThickness: 0.004,
      curveSegments: 16,
    }),
    filmMaterial,
    anchor,
    0,
    0,
    0.045
  );
  frontShell.renderOrder = 3;

  // 胶套背面（同轮廓平面，翻转面向背面）
  const backFace = addMesh(new THREE.ShapeGeometry(sleeveShape, 16), filmMaterial, anchor, 0, 0, 0.005);
  backFace.rotation.y = Math.PI;
  backFace.renderOrder = 2;

  // 磨损贴花（在胶膜外表面）
  const wearOverlay = addMesh(new THREE.PlaneGeometry(2.52, 3.87), wearOverlayMaterial, anchor, 0, -0.12, 0.061);
  wearOverlay.renderOrder = 4;

  // 筋线三道
  addOutlineRibbon(2.72, 4.36, 0.19, 0.032, 0.012, hardwareFilm, 0, anchor);
  addOutlineRibbon(2.58, 4.2, 0.15, 0.05, 0.007, hardwareFilm, 0, anchor);
  addOutlineRibbon(0.66, 0.13, 0.064, 0.053, 0.006, hardwareFilm, 1.88, anchor);

  // 两个圆孔金属环
  for (const cx of [-0.88, 0.88]) {
    addMesh(new THREE.TorusGeometry(0.109, 0.013, 8, 40), hardwareFilm, anchor, cx, 1.89, 0.053);
  }

  // 顶部 4 道车线
  for (let row = 0; row < 4; row++) {
    const points = Array.from({ length: 38 }, (_, n) =>
      new THREE.Vector3(
        -1.275 + (n / 37) * 2.55,
        1.55 + row * 0.032 + 0.002 * Math.sin(n * 0.81 + row),
        0.056 + 0.002 * Math.sin(n * 0.69 + row * 2)
      )
    );
    addMesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 90, 0.01 + row * 8e-4, 8, false),
      hardwareFilm,
      anchor
    );
  }

  // 19 颗微珠（胶套顶部的焊接点/防滑点）
  for (let i = 0; i < 19; i++) {
    const x = Math.sin(i * 47.31) * 1.17;
    const y = 1.565 + (0.5 + 0.5 * Math.sin(i * 29.9)) * 0.083;
    const bead = addMesh(new THREE.SphereGeometry(0.004 + (i % 5) * 0.0017, 10, 6), ridgeMaterial, anchor, x, y, 0.065);
    bead.scale.set(1.8, 0.65, 0.4);
  }

  // 印刷卡（圆角板）+ 正反面平面
  const cardSlab = addMesh(
    new RoundedBoxGeometry(2.4, 3.52, 0.025, 3, 0.019),
    cardMaterial,
    anchor,
    0,
    -0.3,
    0.025
  );
  cardSlab.castShadow = true;

  const artworkPlane = addMesh(
    new THREE.PlaneGeometry(ARTWORK_PLANE_WIDTH, ARTWORK_PLANE_HEIGHT),
    artworkMaterial,
    anchor,
    0,
    -0.3,
    0.04
  );
  const backPrint = addMesh(
    new THREE.PlaneGeometry(ARTWORK_PLANE_WIDTH, ARTWORK_PLANE_HEIGHT),
    backPrintMaterial,
    anchor,
    0,
    -0.3,
    0.009
  );
  backPrint.rotation.y = Math.PI;

  // —— 五金与织带 ——
  // 两条长织带（80 段）：顶点是世界坐标，由 createBadgeScene 直接挂到场景根；
  // 五金件里穿过轭的短织带则留在 yoke 组内（见 buildHardware 的注意事项）
  const strapRibbons: BadgeStrapRibbon[] = [
    new BadgeStrapRibbon(strapMaterial, 80, 0.085),
    new BadgeStrapRibbon(strapMaterial, 80, 0.085),
  ];
  const hardware = buildHardware(metalMaterial, strapMaterial);

  // —— 接地阴影背板 ——
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), groundMaterial);
  ground.position.z = -1;
  ground.receiveShadow = true;

  return {
    anchor,
    cardSlab,
    clasp: hardware.clasp,
    eye: hardware.eye,
    yoke: hardware.yoke,
    straps: strapRibbons,
    ground,
    artworkMaterial,
    artworkPlane,
    refs: {
      film: filmMaterial,
      hardware: hardwareFilm,
      metal: metalMaterial,
      strap: strapMaterial,
      wearOverlay: wearOverlayMaterial,
      ground: groundMaterial,
    },
    materials,
    textures,
  };
}
