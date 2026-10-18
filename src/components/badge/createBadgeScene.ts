/// <reference types="vite/client" />
/**
 * 3D 工牌场景总装配（对齐站点 ni / createBadgeScene 的主干逻辑）
 *
 * 一次 createBadgeScene() 会依次完成：
 *  1. Rapier wasm 初始化
 *  2. 渲染器 / 相机 / 程序化影棚环境（PMREM）/ 三灯 / 接地阴影背板
 *  3. 工牌几何 + 材质装配（badgeAssembly）与两条织带网格
 *  4. 物理世界（badgePhysics）
 *  5. 指针交互（拖拽 PD 控制器 + 悬停推风 + 边界夹取）
 *  6. 帧循环：固定步长推进物理 → 同步卡组/五金/织带 → 回写配置 → 渲染
 *  7. 生命周期：IntersectionObserver 离屏暂停、visibilitychange 暂停、幂等 dispose
 *
 * 注意事项：
 *  - 帧循环里所有高频数据都走闭包变量与复用向量，不 setState、不分配对象
 *  - 滤镜 / 绘图仪后处理管线（站点的 ?filter 模式）本次未接入，
 *    渲染恒走 renderer.render 直出；见文件末尾说明
 */

import * as THREE from 'three';
import type { BadgeConfig } from './badgeConfig';
import { createFilmUniforms } from './badgeMaterials';
import { createBadgeAssembly, type BadgeAssembly } from './badgeAssembly';
import { createBadgePhysics, initRapier, type BadgePhysicsWorld } from './badgePhysics';
import { BadgeStrapRibbon } from './badgeStrap';
import { createKiraBadgeArtwork, prepareArtworkTexture } from './badgeTextures';

/** 场景状态（会通过 onProgress 回传给页面显示） */
export type BadgeSceneStage = 'loading' | 'live' | 'dragging' | 'paused' | 'error';

/** 场景句柄 */
export interface BadgeSceneHandle {
  /**
   * 销毁场景并释放全部资源
   *
   * 功能：取消帧循环、断开观察器与事件监听、遍历释放几何/材质/贴图、
   *      释放 PMREM 渲染目标与 Rapier wasm 内存、销毁渲染器。幂等。
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   */
  dispose(): void;
  /**
   * 运行时替换工牌画面
   *
   * 参数：
   *  - source {CanvasImageSource | string} 画面源（canvas / 图片，或图片 URL）
   * 返回值：{Promise<void>} 替换完成
   * 异常：URL 加载失败时 reject
   */
  setCard(source: CanvasImageSource | string): Promise<void>;
  /** 复位吊牌到初始姿态 */
  reset(): void;
  /** 轻推一下（让吊牌晃动） */
  nudge(): void;
  /** 暂停 / 恢复物理与交互 */
  setPaused(paused: boolean): void;
}

/** 影棚灯箱参数表：[x, z, 宽, 高, 灰阶亮度, 绕 Y 旋转] */
const STUDIO_BOXES: Array<[number, number, number, number, number, number]> = [
  [-3, 3, 1, 7, 5, 0.55],
  [3, 3, 1.5, 7, 0.015, -0.55],
  [0.8, 4, 0.28, 6, 7, -0.2],
];

/** 拖拽目标点夹取范围 */
const DRAG_CLAMP_X = 4.5;
/** 拖拽目标点纵向夹取范围 */
const DRAG_CLAMP_Y = 3.5;
/** 拖拽目标点向上夹取范围（比向下宽松，允许被拎起来） */
const DRAG_CLAMP_TOP = 5;
/** 卡片体积排斥的半空间（织带不许进入这个盒子） */
const CARD_VOLUME_HALF: [number, number, number] = [1.47, 2.3, 0.18];
/** 织带最小 z（不许穿到背后） */
const STRAP_MIN_Z = -0.88;
/** 卡片体积排斥用的局部坐标临时量 */
const localPoint = new THREE.Vector3();
/** 卡片朝向的逆四元数 */
const inverseCardRotation = new THREE.Quaternion();
/** 半空间轴名（与 CARD_VOLUME_HALF 顺序一致） */
const AXES: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];

/**
 * 创建 3D 工牌场景
 *
 * 功能：在给定 canvas 上建立完整的工牌场景并启动帧循环。
 *
 * 参数：
 *  - canvas     {HTMLCanvasElement} 目标画布（需已有非零尺寸）
 *  - getConfig  {() => BadgeConfig} 每帧读取配置（便于外部热调）
 *  - onProgress {(stage: BadgeSceneStage) => void} 可选状态回调
 *  - artwork    {CanvasImageSource | string} 可选画面源：
 *               - canvas / 图片对象：直接使用
 *               - 字符串：按 URL 加载后再使用
 *               - 不传：使用内置生成的工牌画面
 *
 * 返回值：{Promise<BadgeSceneHandle>} 场景句柄
 * 异常：
 *  - Rapier wasm 初始化失败时 reject（例如浏览器禁用 WebAssembly）
 *  - artwork 是 URL 且加载失败时 reject
 *
 * 注意事项：
 *  - 本函数不会自行等待空闲时间；"空闲再建"由调用方（页面）负责，
 *    这样移动端可以直接决定根本不调用它
 *  - canvas 的 CSS 背景色由本函数按配置写入，初始应保持 transparent
 */
export async function createBadgeScene(
  canvas: HTMLCanvasElement,
  getConfig: () => BadgeConfig,
  onProgress?: (stage: BadgeSceneStage) => void,
  artwork?: CanvasImageSource | string
): Promise<BadgeSceneHandle> {
  const emit = (stage: BadgeSceneStage) => {
    if (onProgress && !disposed) onProgress(stage);
  };

  // —— 1. 物理引擎初始化（wasm 内联，必须显式 init）——
  await initRapier();

  // —— 2. 画面源准备 ——
  let artworkSource: CanvasImageSource;
  if (artwork === undefined) {
    artworkSource = createKiraBadgeArtwork(1024, 1400);
  } else if (typeof artwork === 'string') {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = artwork;
    await image.decode();
    artworkSource = image;
  } else {
    artworkSource = artwork;
  }

  // —— 3. 渲染器 / 相机 ——
  const config = getConfig();
  const unlitArtwork = config.material.unlitArtwork === true;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, unlitArtwork ? 2 : 1.5));
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = config.lighting.exposure;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#efeee7');

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
  camera.position.set(0, 0.8, 13.8);
  camera.lookAt(0, 0.8, 0);

  // —— 4. 程序化影棚环境（PMREM）——
  // 临时场景里放 3 个"自发光灯箱"：MeshBasicMaterial 的灰阶 RGB 可以远超 1.0（HDR），
  // 烤进环境贴图后就得到胶片上那几道长条反光
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  for (const [x, z, w, h, gray, rotY] of STUDIO_BOXES) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.03),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(gray, gray, gray) })
    );
    box.position.set(x, 1, z);
    box.rotation.y = rotY;
    envScene.add(box);
  }
  const envTarget = pmrem.fromScene(envScene, 0.015);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.65;
  envScene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | undefined;
    if (material) material.dispose();
  });
  pmrem.dispose();

  // —— 5. 灯光 ——
  const keyLight = new THREE.DirectionalLight('#fff7e6', 4.5);
  keyLight.position.set(-3, 6, 7);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  Object.assign(keyLight.shadow.camera, { left: -8, right: 8, top: 9, bottom: -7, near: 0.1, far: 25 });
  keyLight.shadow.camera.updateProjectionMatrix();
  keyLight.shadow.bias = -5e-4;
  keyLight.shadow.normalBias = 0.03;
  keyLight.shadow.radius = 5;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight('#e8f0ff', 0.7);
  fillLight.position.set(5, 2, 4);
  scene.add(fillLight);
  scene.add(new THREE.AmbientLight('#ffffff', 0.35));

  // —— 6. 工牌装配 ——
  const filmUniforms = createFilmUniforms();
  filmUniforms.damage.value = config.material.edgeDamage;
  filmUniforms.clarity.value = config.material.transmission;
  filmUniforms.thickness.value = config.material.thickness;

  const assembly: BadgeAssembly = createBadgeAssembly(renderer, config, filmUniforms, artworkSource);
  scene.add(assembly.anchor, assembly.ground, assembly.clasp, assembly.eye, assembly.yoke);
  const strapRibbons: BadgeStrapRibbon[] = assembly.straps;
  for (const ribbon of strapRibbons) scene.add(ribbon.mesh);

  // —— 7. 物理 ——
  const physics: BadgePhysicsWorld = createBadgePhysics(config.physics);
  /** 五金三件套的"组 → 刚体"绑定（帧循环逐帧同步姿态） */
  const hardwareDrivers: Array<{ group: THREE.Object3D; body: BadgePhysicsWorld['yoke'] }> = [
    { group: assembly.clasp, body: physics.clasp },
    { group: assembly.eye, body: physics.eye },
    { group: assembly.yoke, body: physics.yoke },
  ];

  // —— 8. 交互 ——
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = reducedMotionQuery.matches;
  const onReducedMotionChange = () => {
    reducedMotion = reducedMotionQuery.matches;
  };
  reducedMotionQuery.addEventListener('change', onReducedMotionChange);

  let paused = config.paused;
  let disposed = false;
  let visible = true;
  let frameId = 0;
  let lastFrameAt = 0;
  let accumulator = 0;

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const dragTarget = new THREE.Vector3();
  const planePoint = new THREE.Vector3();
  const prevPlanePoint = new THREE.Vector3();
  const dragLocalPoint = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const impulse = new THREE.Vector3();

  let dragging = false;
  let pointerId: number | null = null;
  let hoveringLastFrame = false;
  let lastMoveAt = 0;

  /** 更新归一化指针坐标 */
  const updatePointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointerNdc, camera);
  };

  /** 射线命中印刷卡（只测印刷卡板，不做递归） */
  const hitCard = () => raycaster.intersectObject(assembly.cardSlab, false)[0];

  /** 结束拖拽（释放指针捕获、恢复光标） */
  const releasePointer = () => {
    dragging = false;
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
    canvas.style.cursor = 'grab';
    emit(paused ? 'paused' : 'live');
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || paused) return;
    updatePointer(event);
    const hit = hitCard();
    if (!hit) return;
    dragging = true;
    pointerId = event.pointerId;
    // setPointerCapture 在指针已经抬起（或自动化派发的合成指针）时会抛 NotFoundError，
    // 这里兜住异常：拖拽本身不依赖捕获，捕获只影响"移出 canvas 仍能继续拖"的体验
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* 忽略：没有活动指针时无法捕获 */
    }
    // 拖拽平面：过命中点、法线朝向相机（跟随视角的竖直平面）
    dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(forward), hit.point);
    raycaster.ray.intersectPlane(dragPlane, dragTarget);
    dragLocalPoint.copy(assembly.anchor.worldToLocal(hit.point.clone()));
    canvas.style.cursor = 'grabbing';
    emit('dragging');
  };

  const onPointerMove = (event: PointerEvent) => {
    if (pointerId !== null && event.pointerId !== pointerId) return;
    updatePointer(event);
    raycaster.ray.intersectPlane(dragPlane, planePoint);

    if (dragging) {
      dragTarget.copy(planePoint);
      dragTarget.x = THREE.MathUtils.clamp(dragTarget.x, -DRAG_CLAMP_X, DRAG_CLAMP_X);
      dragTarget.y = THREE.MathUtils.clamp(dragTarget.y, -DRAG_CLAMP_Y, DRAG_CLAMP_TOP);
      return;
    }

    const hit = hitCard();
    canvas.style.cursor = hit && !paused ? 'grab' : 'default';

    const now = performance.now();
    // 悬停推风：连续两帧都命中卡片时，用指针速度给一个冲量（鼠标划过就能"扇"动吊牌）
    if (hit && hoveringLastFrame && !paused && !reducedMotion && event.pointerType !== 'touch') {
      const dt = Math.max((now - lastMoveAt) / 1000, 0.016);
      const cfg = getConfig();
      const vx = THREE.MathUtils.clamp((planePoint.x - prevPlanePoint.x) / dt, -12, 12);
      const vy = THREE.MathUtils.clamp((planePoint.y - prevPlanePoint.y) / dt, -8, 8);
      impulse.set(vx * 0.008 * cfg.physics.mouseForce, vy * 0.004 * cfg.physics.mouseForce, 0);
      physics.card.body.applyImpulseAtPoint(impulse, hit.point, true);
    }
    prevPlanePoint.copy(planePoint);
    lastMoveAt = now;
    hoveringLastFrame = true;
  };

  const onPointerUp = (event: PointerEvent | null) => {
    if (pointerId !== null && event && event.pointerId !== pointerId) return;
    releasePointer();
  };

  const onPointerLeave = () => {
    hoveringLastFrame = false;
    if (!dragging) canvas.style.cursor = 'default';
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);

  // —— 9. 尺寸与可见性 ——
  /**
   * 依据 canvas 的 CSS 尺寸同步渲染器与相机
   *
   * 功能：站点在窄屏（<700px）用更大 FOV 与更远的相机距离，保证吊牌整体可见。
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   */
  const resize = (): void => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = width < 700 ? 43 : 36;
    camera.position.z = width < 700 ? Math.max(13.8, 6.4 / camera.aspect) : 13.8;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  /**
   * 依据"离屏 / 页面隐藏"启停帧循环
   *
   * 功能：站点用 IntersectionObserver + visibilitychange 双保险：
   *      不可见时 cancelAnimationFrame（完全不占 GPU/CPU），重新可见时恢复。
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   */
  const tickVisibility = (): void => {
    lastFrameAt = 0;
    accumulator = 0;
    if (document.hidden || !visible) {
      cancelAnimationFrame(frameId);
      frameId = 0;
      releasePointer();
    } else if (!frameId && !disposed) {
      frameId = requestAnimationFrame(frame);
    }
  };
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    tickVisibility();
  });
  intersectionObserver.observe(canvas);
  document.addEventListener('visibilitychange', tickVisibility);

  // —— 10. 拖拽 PD 控制器 ——
  const cardRotation = new THREE.Quaternion();
  const grabbedOffsetWorld = new THREE.Vector3();
  const grabbedVelocity = new THREE.Vector3();
  const linearVel = new THREE.Vector3();
  const angularVel = new THREE.Vector3();
  const targetImpulse = new THREE.Vector3();
  const cardWorldPos = new THREE.Vector3();
  const grabbedPointWorld = new THREE.Vector3();

  /**
   * 施加拖拽弹簧-阻尼（PD）控制与步进物理
   *
   * 功能：站点 I(cfg) 的逐字搬移：
   *  1. 更新物理参数（applySwivelCoupling / 抗扭 / 弹簧网络）
   *  2. 若正在拖拽，把"抓取点"投到世界空间，用
   *     等效质量 r = m/(1+|r_local|²/.65)、比例增益 i = grip·r、阻尼 a = 2·√(grip)·r
   *     构造临界阻尼的冲量（clamp 到 110·m），施加到抓取点
   *  3. world.step()
   *
   * 参数：
   *  - cfg {BadgeConfig} 当前配置
   *
   * 返回值：无
   * 异常：无
   *
   * 注意事项：grip=100 时的手感是"跟手但有重量"；把 grip 调小会明显变"黏"
   */
  const substep = (cfg: BadgeConfig): void => {
    physics.update(cfg.physics, reducedMotion);

    if (dragging) {
      cardRotation.copy(assembly.anchor.quaternion);
      grabbedOffsetWorld.copy(dragLocalPoint).applyQuaternion(cardRotation);
      const cardPos = physics.card.body.translation();
      cardWorldPos.set(cardPos.x, cardPos.y, cardPos.z);
      linearVel.copy(physics.card.body.linvel());
      angularVel.copy(physics.card.body.angvel());
      // 抓取点速度 = 线速度 + ω × r
      grabbedVelocity.copy(linearVel).addScaledVector(angularVel.cross(grabbedOffsetWorld), 1);
      grabbedPointWorld.copy(cardWorldPos).add(grabbedOffsetWorld);

      const mass = cfg.physics.mass;
      const effectiveMass = mass / (1 + grabbedOffsetWorld.lengthSq() / 0.65);
      const stiffness = cfg.physics.grip * effectiveMass;
      const damping = 2 * Math.sqrt(cfg.physics.grip) * effectiveMass;
      const denom = 1 + (damping * physics.world.timestep + stiffness * physics.world.timestep ** 2) / effectiveMass;

      targetImpulse
        .copy(dragTarget)
        .sub(grabbedPointWorld)
        .multiplyScalar(stiffness)
        .addScaledVector(grabbedVelocity, -damping);
      targetImpulse.divideScalar(denom);
      targetImpulse.clampLength(0, 110 * mass);
      physics.card.body.applyImpulseAtPoint(
        targetImpulse.multiplyScalar(physics.world.timestep),
        grabbedPointWorld,
        true
      );
    }

    physics.world.step();
  };

  /**
   * 织带采样点的"卡片体积排斥"
   *
   * 功能：站点 Et 的逐字搬移：把点换算到卡片局部空间，若落在
   *      半空间 [1.47, 2.3, .18] 内部，就沿"最接近的那个面"推出去；
   *      另外强制 z ≥ -.88（不许绕到卡片背后）。
   *
   * 参数：
   *  - point {THREE.Vector3} 待修正的织带采样点（原地修改）
   *
   * 返回值：{boolean} 是否发生过修改
   * 异常：无
   */
  const clampStrapToCard = (point: THREE.Vector3): boolean => {
    let changed = false;
    localPoint.copy(point).sub(assembly.anchor.position).applyQuaternion(inverseCardRotation);
    let axis: 'x' | 'y' | 'z' = 'x';
    if (
      Math.abs(localPoint.x) < CARD_VOLUME_HALF[0] &&
      Math.abs(localPoint.y) < CARD_VOLUME_HALF[1] &&
      Math.abs(localPoint.z) < CARD_VOLUME_HALF[2]
    ) {
      let best = 0;
      for (let i = 1; i < 3; i++) {
        if (CARD_VOLUME_HALF[i] - Math.abs(localPoint[AXES[i]]) < CARD_VOLUME_HALF[best] - Math.abs(localPoint[AXES[best]])) {
          best = i;
        }
      }
      axis = AXES[best];
      localPoint[axis] = (Math.sign(localPoint[axis]) || 1) * CARD_VOLUME_HALF[best];
      point.copy(localPoint).applyQuaternion(assembly.anchor.quaternion).add(assembly.anchor.position);
      changed = true;
    }
    if (point.z < STRAP_MIN_Z) {
      point.z = STRAP_MIN_Z;
      changed = true;
    }
    return changed;
  };

  // —— 11. 帧循环 ——
  const ribbonPoints: THREE.Vector3[] = [];
  const strapCurve = new THREE.CatmullRomCurve3(ribbonPoints);
  const strapUp = new THREE.Vector3();

  /**
   * 主帧循环
   *
   * 功能：
   *  1. 检测 paused 变化并切换
   *  2. 固定步长累加器推进物理（1/120 s 一步，单帧最多 .05 s）
   *  3. 把刚体姿态同步到卡组 / 五金三件套，并刷新两条织带顶点
   *  4. 把配置回写到材质 / uniform / 灯光 / 相机 / 背景
   *  5. 渲染
   *
   * 参数：
   *  - now {number} requestAnimationFrame 时间戳
   *
   * 返回值：无
   * 异常：无
   *
   * 注意事项：
   *  - 帧间 dt 上限 .05 s：后台标签页切回来时不会因为超大步长把物理炸掉
   *  - 涂装顺序：先推进物理再做同步，保证画面与物理一致
   */
  function frame(now: number): void {
    frameId = 0;
    if (disposed || document.hidden || !visible) return;
    frameId = requestAnimationFrame(frame);

    const cfg = getConfig();
    if (paused !== cfg.paused) setPaused(cfg.paused);

    const dt = Math.min((now - (lastFrameAt || now)) / 1000, 0.05);
    lastFrameAt = now;

    if (!paused) {
      accumulator += dt;
      while (accumulator >= physics.world.timestep) {
        substep(cfg);
        accumulator -= physics.world.timestep;
      }
    }

    // 卡组
    const cardPos = physics.card.body.translation();
    const cardQuat = physics.card.body.rotation();
    assembly.anchor.position.set(cardPos.x, cardPos.y, cardPos.z);
    assembly.anchor.quaternion.set(cardQuat.x, cardQuat.y, cardQuat.z, cardQuat.w);
    assembly.anchor.updateMatrixWorld(true);

    // 五金三件套
    for (const entry of hardwareDrivers) {
      const position = entry.body.translation();
      const rotation = entry.body.rotation();
      entry.group.position.set(position.x, position.y, position.z);
      entry.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      entry.group.updateMatrixWorld(true);
    }

    // 织带：由锚点 + 各节质心 + 轭上两个附件点组成曲线
    inverseCardRotation.copy(assembly.anchor.quaternion).invert();
    physics.straps.forEach((strap, index) => {
      const ribbon = strapRibbons[index];
      if (!ribbon) return;
      const points = ribbonPoints;
      const linkCount = strap.links.length;
      while (points.length < linkCount + 2) points.push(new THREE.Vector3());
      points[0].copy(strap.anchorPosition);
      strap.links.slice(0, -1).forEach((link, i) => {
        const position = link.translation();
        points[i + 1].set(position.x, position.y, position.z);
      });
      const side = Math.sign(strap.anchorPosition.x);
      points[linkCount].copy(
        assembly.yoke.localToWorld(
          new THREE.Vector3(
            strap.attachment.x + side * 0.025,
            strap.attachment.y + 0.055,
            strap.attachment.z
          )
        )
      );
      points[linkCount + 1].copy(assembly.yoke.localToWorld(new THREE.Vector3().copy(strap.attachment)));
      strapUp.set(1, 0, 0).applyQuaternion(assembly.yoke.quaternion);
      ribbon.update(strapCurve, strapUp, dt, clampStrapToCard);
    });

    // 配置回写
    assembly.refs.wearOverlay.opacity = cfg.material.wear;
    filmUniforms.damage.value = cfg.material.edgeDamage;
    filmUniforms.clarity.value = cfg.material.transmission;
    filmUniforms.thickness.value = cfg.material.thickness;
    filmUniforms.filtered.value = cfg.filters.enabled || cfg.plotter.enabled;
    assembly.refs.film.roughness = cfg.material.roughness;
    assembly.refs.film.envMapIntensity = cfg.lighting.reflections;
    assembly.refs.hardware.envMapIntensity = cfg.lighting.reflections;
    assembly.refs.strap.color.set(cfg.material.strapColor);
    assembly.refs.metal.roughness = cfg.material.metalRoughness;
    assembly.refs.ground.opacity = cfg.lighting.shadow;
    renderer.toneMappingExposure = cfg.lighting.exposure;
    keyLight.intensity = cfg.lighting.keyLight;

    // 相机：绕 target 环绕 + 推拉
    const angle = THREE.MathUtils.degToRad(cfg.view.angle);
    const radius =
      ((canvas.clientWidth < 700 ? Math.max(13.8, 6.4 / camera.aspect) : 13.8) || 13.8) / cfg.view.zoom;
    camera.position.set(Math.sin(angle) * radius, 0.8, Math.cos(angle) * radius);
    camera.lookAt(0, 0.8, 0);

    // 背景
    const background = cfg.background;
    canvas.style.backgroundColor = background.transparent ? 'transparent' : background.color;
    if (background.filterBackground && !background.transparent) {
      scene.background = scene.background instanceof THREE.Color ? scene.background : new THREE.Color();
      (scene.background as THREE.Color).set(background.color);
    } else {
      scene.background = null;
    }

    // 渲染（v1 直出；滤镜/绘图仪管线见文件末尾说明）
    renderer.render(scene, camera);
  }

  /**
   * 暂停 / 恢复
   *
   * 功能：切换暂停状态、释放拖拽、清空累加器，并回传状态。
   *
   * 参数：
   *  - value {boolean} true = 暂停
   * 返回值：无
   * 异常：无
   */
  function setPaused(value: boolean): void {
    paused = value;
    releasePointer();
    lastFrameAt = 0;
    accumulator = 0;
    emit(value ? 'paused' : 'live');
  }

  /**
   * 轻推吊牌
   *
   * 功能：站点 kt 的逐字搬移：在卡面下方一点施加冲量，让吊牌开始摆动。
   *      reduced-motion 时用更小的冲量。
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   */
  function nudge(): void {
    if (paused) return;
    const strength = reducedMotion ? 0.3 : 1.4;
    physics.card.body.applyImpulseAtPoint(
      { x: strength, y: 0, z: 0.1 },
      { x: 0, y: physics.restY - 0.7, z: 0.06 },
      true
    );
  }

  /**
   * 复位到初始姿态
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   */
  function reset(): void {
    releasePointer();
    physics.reset();
    for (const ribbon of strapRibbons) ribbon.reset();
    accumulator = 0;
  }

  // 开场轻推（reduced-motion 时跳过）
  if (!reducedMotion) {
    physics.card.body.applyImpulseAtPoint({ x: 0.4, y: 0, z: 0.04 }, { x: 0, y: physics.restY - 0.7, z: 0 }, true);
  }

  frameId = requestAnimationFrame(frame);
  emit('live');

  // 开发期调试钩子：把场景/物理/织带挂到 window 上，便于在浏览器里量测（生产构建会自动去掉）
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__badge = {
      scene,
      camera,
      renderer,
      physics,
      assembly,
      ribbons: strapRibbons,
      /**
       * 调试用拾取：返回屏幕坐标下命中的对象列表（按距离升序）
       *
       * 参数：clientX / clientY {number} 视口坐标
       * 返回值：{Array} 命中信息（距离 / 几何类型 / 材质类型 / 局部位置）
       */
      pick: (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect();
        pointerNdc.set(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(pointerNdc, camera);
        return raycaster
          .intersectObjects(scene.children, true)
          .slice(0, 4)
          .map((hit) => ({
            distance: Number(hit.distance.toFixed(3)),
            geometry: (hit.object as THREE.Mesh).geometry?.type,
            material: ((hit.object as THREE.Mesh).material as THREE.Material)?.type,
            localPosition: hit.object.position.toArray().map((v) => Number(v.toFixed(3))),
            point: hit.point.toArray().map((v) => Number(v.toFixed(3))),
          }));
      },
      /**
       * 调试用拖拽状态快照
       *
       * 参数：无
       * 返回值：{object} 正在拖拽与否、PD 目标点、抓取点（世界）、卡牌位置与速度
       */
      dragState: () => ({
        dragging,
        pointerId,
        target: dragTarget.toArray().map((v) => Number(v.toFixed(3))),
        grabbedLocal: dragLocalPoint.toArray().map((v) => Number(v.toFixed(3))),
        cardPos: [
          Number(physics.card.body.translation().x.toFixed(3)),
          Number(physics.card.body.translation().y.toFixed(3)),
          Number(physics.card.body.translation().z.toFixed(3)),
        ],
        cardVel: [
          Number(physics.card.body.linvel().x.toFixed(3)),
          Number(physics.card.body.linvel().y.toFixed(3)),
          Number(physics.card.body.linvel().z.toFixed(3)),
        ],
        link0: (() => {
          const p = physics.straps[0].links[0].translation();
          return [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), Number(p.z.toFixed(2))];
        })(),
      }),
    };
  }

  return {
    /**
     * 运行时换卡
     *
     * 功能：生成新贴图（同样走裁边 + 白底 + cover 适配），替换印刷面材质上的 map。
     *
     * 参数：
     *  - source {CanvasImageSource | string} 画面源或 URL
     * 返回值：{Promise<void>}
     * 异常：URL 加载失败时 reject
     */
    async setCard(source: CanvasImageSource | string): Promise<void> {
      let resolved: CanvasImageSource;
      if (typeof source === 'string') {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = source;
        await image.decode();
        resolved = image;
      } else {
        resolved = source;
      }
      const texture = prepareArtworkTexture(resolved, THREE.SRGBColorSpace, renderer.capabilities.getMaxAnisotropy());
      const material = assembly.artworkMaterial as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
      material.map?.dispose();
      material.map = texture;
      material.needsUpdate = true;
    },

    reset,
    nudge,
    setPaused,

    /**
     * 销毁场景
     *
     * 功能：幂等释放全部资源（帧循环 / 观察器 / 事件 / 几何 / 材质 / 贴图 /
     *      PMREM 目标 / Rapier 世界 / 渲染器）。
     *
     * 参数：无
     * 返回值：无
     * 异常：无
     *
     * 注意事项：releasePointer 会调用 emit，销毁期间可能回调到页面，
     *          页面侧应能容忍此时的状态回传（只改 data-state 不做别的）
     */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      frameId = 0;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      reducedMotionQuery.removeEventListener('change', onReducedMotionChange);
      document.removeEventListener('visibilitychange', tickVisibility);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('lostpointercapture', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);

      const geometries = new Set<THREE.BufferGeometry>();
      const materialsToDispose = new Set<THREE.Material>();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material) materialsToDispose.add(mesh.material as THREE.Material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materialsToDispose.forEach((material) => material.dispose());
      assembly.textures.forEach((texture) => texture.dispose());
      keyLight.shadow.dispose();
      envTarget.dispose();
      physics.free();
      renderer.dispose();
    },
  };
}

// —— 未接入部分说明 ——
// 站点在 URL 带 ?filter 时会走一条自建 EffectComposer：
//   1) 场景渲染到离屏 RT
//   2) alpha 校正 Pass（tone mapping 前 rgb /= a、之后 rgb *= a，修正预乘透明）
//   3) 自定义滤镜 Pass（Bayer 抖动量化 + 像素化 + 颗粒 + 暗角 + sepia/monochrome
//      + marker 绘图仪扫描线：整数倍行距、圆形笔尖足迹取最暗色块、颜料密度叠加）
// 本次 v1 未接入该管线：实时模式（默认预设）本身就是 filters/plotter 全关，
// 渲染与线上观感一致，故不影响"是否移植成功"的判断。需要时再补 P4。
