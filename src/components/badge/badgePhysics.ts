/**
 * 工牌物理世界（对齐站点 Jr / ne / re 三段实现）
 *
 * 用 Rapier3D 搭一整套"真的会晃动"的吊牌：
 *  - 一张卡（cuboid 1.4×2.22×.105，质量 .72）、爪夹 / 旋环 / 轭三个小刚体，
 *    用 spherical + revolute（带 ±1.15 rad 限位）串成一条可折叠的悬挂链
 *  - 两侧各 12 节胶囊刚体，锚点在 (±2.6, 9.5, -.25)，用 rope 关节串成绳链
 *  - 再叠一层 3 级弹簧网络（隔 1/2/3 节点）当"织带弯曲刚度"
 *  - 三处扭矩耦合 + 轭自回正 + 卡牌非线性抗扭，负责"不疯转、自动回正"的手感
 *
 * 注意事项：
 *  - 调用前必须 `await initRapier()`（wasm 是 base64 内联的，需要显式实例化）
 *  - 织带节刚体刻意**锁死旋转**：视觉织带是另一套网格，物理只需要质心位置，
 *    锁旋转能让求解器稳定得多（站点原样保留了这个技巧）
 *  - `world.timestep = 1/120` + `numSolverIterations = 32` 是站点的取值，
 *    帧循环用累加器按固定步长推进（见 createBadgeScene）
 */

import * as RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { BADGE_REST_Y, type BadgePhysicsConfig } from './badgeConfig';

/**
 * 初始化 Rapier（wasm 实例化）
 *
 * 功能：包装 `RAPIER.init()`；因为模块级只能初始化一次，这里做幂等缓存。
 *
 * 参数：无
 * 返回值：{Promise<void>} 初始化完成
 * 异常：wasm 实例化失败时抛出（例如浏览器禁用了 WebAssembly）
 */
let rapierReady: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

/**
 * 碰撞组位掩码（membership << 16 | filter），数值与站点逐字一致
 *
 * 语义：
 *  - card   成员组 1，可与组 1/2 碰撞（组 1 = 五金、组 2 = 挡板）
 *  - hardware 成员组 8，只与挡板碰撞
 *  - link   成员组 2，可与卡牌与挡板碰撞
 *  - wall   成员组 4，可与组 0/1/3 碰撞
 */
export const COLLISION_GROUP = {
  card: 65542,
  hardware: 524292,
  link: 131077,
  wall: 262155,
} as const;

/** 单侧织带节数 */
const LINKS_PER_STRAP = 12;
/** 锚点→轭的直线距离除以该值得到单节长度 */
const SEGMENT_DIVISOR = 12;
/** 单节刚体质量 */
const LINK_MASS = 0.0125;
/** 单节胶囊半径 */
const LINK_RADIUS = 0.11;
/** 抗扭力矩封顶（N·m） */
const ANTI_TWIST_CLAMP = 18;
/** 弹簧阻尼系数（与节点质量相关） */
const SPRING_DAMPING_K = 1.4;
/** 弹簧参考节点质量 */
const SPRING_NODE_MASS = 0.0125;

/** 织带的物理描述 */
export interface BadgeStrapPhysics {
  /** 固定锚点刚体（不参与模拟，只提供世界位置） */
  anchor: RAPIER.RigidBody;
  /** 锚点世界位置 */
  anchorPosition: { x: number; y: number; z: number };
  /** 12 节绳链刚体（按锚点→轭排列） */
  links: RAPIER.RigidBody[];
  /** 轭上的局部附件点（织带末端绑在这里） */
  attachment: { x: number; y: number; z: number };
  /** 单节长度 */
  segment: number;
  /** 各节胶囊碰撞体（需要按绳方向做相对父体偏移与旋转） */
  segments: RAPIER.Collider[];
}

/** 物理世界句柄 */
export interface BadgePhysicsWorld {
  /** Rapier 世界 */
  world: RAPIER.World;
  /** 卡牌刚体 + 碰撞体 */
  card: { body: RAPIER.RigidBody; collider: RAPIER.Collider };
  /** 挡板碰撞体（阻止吊牌甩到背后） */
  wall: RAPIER.Collider;
  /** 爪夹刚体 */
  clasp: RAPIER.RigidBody;
  /** 旋环刚体 */
  eye: RAPIER.RigidBody;
  /** 轭刚体 */
  yoke: RAPIER.RigidBody;
  /** 两侧织带 */
  straps: BadgeStrapPhysics[];
  /** 卡牌初始高度（复位用） */
  restY: number;
  /**
   * 按当前配置推进参数（每帧调用，内部不 step）
   *
   * 参数：
   *  - physics       {BadgePhysicsConfig} 物理配置
   *  - reducedMotion {boolean} 是否减弱动效（为真时额外加阻尼，让吊牌更"黏"）
   * 返回值：无
   */
  update(physics: BadgePhysicsConfig, reducedMotion: boolean): void;
  /** 把各节胶囊碰撞体对齐到绳的走向（update 内部会先调它） */
  syncJointFrames(): void;
  /** 复位：所有刚体回到初始位置与零速度 */
  reset(): void;
  /** 释放 wasm 内存 */
  free(): void;
}

/** 临时向量（避免逐帧分配） */
const tmpVec = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpDiff = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * 四元数旋转向量（站点 r() 里那段展开的手写旋转）
 *
 * 功能：out = v + 2w(q×v) + 2q×(q×v)，等价于 v.applyQuaternion(q)，
 *      但保持站点的手写展开形式、零临时对象。
 *
 * 参数：
 *  - q   {{x,y,z,w}} 四元数
 *  - v   {{x,y,z}} 待旋转向量
 *  - out {THREE.Vector3} 输出
 *
 * 返回值：{THREE.Vector3} out
 * 异常：无
 */
function rotateByQuat(
  q: { x: number; y: number; z: number; w: number },
  v: { x: number; y: number; z: number },
  out: THREE.Vector3
): THREE.Vector3 {
  const s = 2 * (q.y * v.z - q.z * v.y);
  const c = 2 * (q.z * v.x - q.x * v.z);
  const l = 2 * (q.x * v.y - q.y * v.x);
  return out.set(
    v.x + q.w * s + q.y * l - q.z * c,
    v.y + q.w * c + q.z * s - q.x * l,
    v.z + q.w * l + q.x * c - q.y * s
  );
}

/**
 * 卡牌抗扭力矩曲线（站点 qr 的逐字搬移）
 *
 * 功能：抗扭强度为 0 时直接返回 0；否则
 *      τ = clamp(-k·θ·(1 + p·(|θ|/π)²) - .65·√k·ω, ±18)，其中 θ 是绕 Y 的当前扭角、
 *      ω 是绕 Y 的角速度。小角度近似线性回正，大角度被 (|θ|/π)² 急剧放大。
 *
 * 参数：
 *  - angle       {number} 当前扭角（弧度）
 *  - angularVel  {number} 绕 Y 角速度（rad/s）
 *  - strength    {number} 抗扭强度 antiTwist
 *  - progression {number} 非线性放大系数 twistProgression
 *
 * 返回值：{number} 要施加的力矩（N·m）
 * 异常：无
 */
function antiTwistTorque(angle: number, angularVel: number, strength: number, progression: number): number {
  if (strength === 0) return 0;
  const restorative = -strength * angle * (1 + progression * Math.pow(Math.abs(angle) / Math.PI, 2));
  return Math.max(
    -ANTI_TWIST_CLAMP,
    Math.min(ANTI_TWIST_CLAMP, restorative - 0.65 * Math.sqrt(strength) * angularVel)
  );
}

/**
 * 创建工牌物理世界
 *
 * 功能：建世界、建全部刚体与关节、装配两侧绳链与弹簧网络，返回可逐帧推进的句柄。
 *
 * 参数：
 *  - config {BadgePhysicsConfig} 物理配置（质量 / 阻尼 / 刚度 / 抗扭等）
 *
 * 返回值：{BadgePhysicsWorld} 物理世界句柄
 * 异常：
 *  - 若未先 await initRapier()，Rapier 会抛出 wasm 未初始化的错误
 *
 * 注意事项：
 *  - 关节数量较多（每侧 12 个 rope + 约 30 个 spring），初始化有一定开销，
 *    站点把它放在空闲回调里做，这里也由页面负责"空闲再建"
 */
export function createBadgePhysics(config: BadgePhysicsConfig): BadgePhysicsWorld {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  world.numSolverIterations = 32;

  /** 复位基准：所有能动的刚体 + 它们的初始位置 */
  const initialStates: Array<{ body: RAPIER.RigidBody; position: { x: number; y: number; z: number } }> = [];

  // 挡板：一面 50×50 的静态墙，避免吊牌被甩到背后
  const wall = world.createCollider(
    RAPIER.ColliderDesc.cuboid(50, 50, 0.2)
      .setTranslation(0, 0, -1.2)
      .setCollisionGroups(COLLISION_GROUP.wall)
      .setFriction(0.4)
  );

  /**
   * 建一个动态刚体 + 立方体碰撞体
   *
   * 参数：
   *  - position      {{x,y,z}} 初始位置
   *  - half         {[number,number,number]} 半长宽高
   *  - mass         {number} 质量
   *  - linearDamping{number} 线性阻尼，默认 .5
   *  - groups       {number} 碰撞组
   * 返回值：{ body: RAPIER.RigidBody; collider: RAPIER.Collider }
   */
  const makeBody = (
    position: { x: number; y: number; z: number },
    half: [number, number, number],
    mass: number,
    linearDamping = 0.5,
    groups: number = COLLISION_GROUP.hardware
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(linearDamping)
        .setAngularDamping(0.6)
        .setCcdEnabled(true)
        .setCanSleep(false)
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2])
        .setMass(mass)
        .setCollisionGroups(groups)
        .setFriction(0.45)
        .setRestitution(0),
      body
    );
    initialStates.push({ body, position });
    return { body, collider };
  };

  // —— 卡牌 + 五金三件套 ——
  const card = makeBody({ x: 0, y: BADGE_REST_Y, z: 0 }, [1.4, 2.22, 0.105], config.mass, 0.5, COLLISION_GROUP.card);
  const clasp = makeBody({ x: 0, y: 2.35, z: 0.03 }, [0.21, 0.33, 0.13], 0.09).body;
  const eye = makeBody({ x: 0, y: 2.79, z: 0.03 }, [0.22, 0.21, 0.09], 0.055).body;
  const yoke = makeBody({ x: 0, y: 3.08, z: 0.03 }, [0.1, 0.22, 0.08], 0.045, 0.5, COLLISION_GROUP.link).body;

  // 卡 ↔ 爪夹：球铰
  world.createImpulseJoint(
    RAPIER.JointData.spherical({ x: 0, y: 2.025, z: 0.03 }, { x: 0, y: -0.175, z: 0 }),
    card.body,
    clasp,
    true
  );
  // 爪夹 ↔ 旋环：绕 Y 的转轴
  world.createImpulseJoint(
    RAPIER.JointData.revolute({ x: 0, y: 0.26, z: 0 }, { x: 0, y: -0.18, z: 0 }, { x: 0, y: 1, z: 0 }),
    clasp,
    eye,
    true
  );
  // 旋环 ↔ 轭：绕 X 的转轴 + ±1.15 rad 限位
  const foldJoint = world.createImpulseJoint(
    RAPIER.JointData.revolute({ x: 0, y: 0.13, z: 0 }, { x: 0, y: -0.16, z: 0 }, { x: 1, y: 0, z: 0 }),
    eye,
    yoke,
    true
  );
  // setLimits 只声明在单位关节（RevoluteImpulseJoint）上，这里按类型收窄后调用
  (foldJoint as RAPIER.RevoluteImpulseJoint).setLimits(-1.15, 1.15);

  // —— 两侧织带：锚点 → 12 节绳链 → 轭 ——
  const straps: BadgeStrapPhysics[] = [];
  for (const side of [-1, 1]) {
    const anchorPosition = { x: side * 2.6, y: 9.5, z: -0.25 };
    const attachment = { x: 0, y: 0.04, z: side * 0.061 };
    const top = { x: attachment.x + side * 0.015, y: 3.08 + attachment.y, z: 0.03 };
    const dx = top.x - anchorPosition.x;
    const dy = top.y - anchorPosition.y;
    const dz = top.z - anchorPosition.z;
    const segment = Math.hypot(dx, dy, dz) / SEGMENT_DIVISOR;

    const anchor = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(anchorPosition.x, anchorPosition.y, anchorPosition.z)
    );

    const links: RAPIER.RigidBody[] = [];
    const segments: RAPIER.Collider[] = [];
    for (let i = 1; i <= LINKS_PER_STRAP; i++) {
      const link = makeBody(
        {
          x: anchorPosition.x + (dx * i) / SEGMENT_DIVISOR,
          y: anchorPosition.y + (dy * i) / SEGMENT_DIVISOR,
          z: anchorPosition.z + (dz * i) / SEGMENT_DIVISOR,
        },
        [0.025, 0.025, 0.018],
        LINK_MASS,
        1.6,
        COLLISION_GROUP.link
      );
      // 锁定旋转：只需要质心位置，避免绳节自旋导致求解器抖动
      link.body.setEnabledRotations(false, false, false, false);
      link.collider.setShape(new RAPIER.Capsule(segment / 2, LINK_RADIUS));
      segments.push(link.collider);
      world.createImpulseJoint(
        RAPIER.JointData.rope(segment, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
        links[links.length - 1] ?? anchor,
        link.body,
        true
      );
      links.push(link.body);
    }
    // 末端绳节 → 轭：球铰
    world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { ...attachment }),
      links[links.length - 1],
      yoke,
      true
    );
    straps.push({ anchor, anchorPosition, links, attachment, segment, segments });
  }

  // —— 织带弯曲刚度：3 级弹簧网络（隔 1 / 2 / 3 节各一根）——
  const springs: RAPIER.ImpulseJoint[] = [];
  let appliedStiffness = -1;

  /**
   * 把各节胶囊碰撞体对齐到绳的走向
   *
   * 功能：每节胶囊的"父体"是前一节（或锚点），这里把碰撞体相对父体偏移半段并旋转到
   *      指向父体，让胶囊正好铺满两节关节之间的空隙（旋转锁死时碰撞体必须自己带朝向）。
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   */
  const syncJointFrames = (): void => {
    for (const strap of straps) {
      strap.links.forEach((link, index) => {
        const current = link.translation();
        const parent = (index ? strap.links[index - 1] : strap.anchor).translation();
        tmpVec.set(parent.x - current.x, parent.y - current.y, parent.z - current.z);
        strap.segments[index].setTranslationWrtParent({ x: tmpVec.x / 2, y: tmpVec.y / 2, z: tmpVec.z / 2 });
        if (tmpVec.lengthSq() > 1e-10) {
          tmpQuat.setFromUnitVectors(UP, tmpVec.normalize());
          strap.segments[index].setRotationWrtParent({
            x: tmpQuat.x,
            y: tmpQuat.y,
            z: tmpQuat.z,
            w: tmpQuat.w,
          });
        }
      });
    }
  };
  syncJointFrames();

  /**
   * 施加一对绕指定轴的扭矩耦合
   *
   * 功能：取 B 体旋转后的轴作为世界轴，按两体相对角速度在该轴上的投影施加一对等反扭矩
   *      （× 惯性权重 × 1-exp(-damping·10·dt) 做限幅），实现"带阻尼的铰链转动"。
   *
   * 参数：
   *  - bodyA   {RAPIER.RigidBody} 甲体
   *  - bodyB   {RAPIER.RigidBody} 乙体
   *  - axis    {{x,y,z}} 局部轴（会被 B 的旋转带到世界空间）
   *  - damping {number} 阻尼系数
   *  - inertia {number} 惯性权重
   *
   * 返回值：无
   * 异常：无
   */
  const applySwivelCoupling = (
    bodyA: RAPIER.RigidBody,
    bodyB: RAPIER.RigidBody,
    axis: { x: number; y: number; z: number },
    damping: number,
    inertia: number
  ): void => {
    rotateByQuat(bodyB.rotation(), axis, tmpAxis);
    const av = bodyA.angvel();
    const bv = bodyB.angvel();
    tmpDiff.set(av.x - bv.x, av.y - bv.y, av.z - bv.z);
    const strength = -tmpDiff.dot(tmpAxis) * inertia * (1 - Math.exp(-damping * 10 * world.timestep));
    bodyA.applyTorqueImpulse({ x: tmpAxis.x * strength, y: tmpAxis.y * strength, z: tmpAxis.z * strength }, true);
    bodyB.applyTorqueImpulse({ x: -tmpAxis.x * strength, y: -tmpAxis.y * strength, z: -tmpAxis.z * strength }, true);
  };

  let appliedMass = config.mass;

  /**
   * 按当前配置推进物理参数（不含 step）
   *
   * 功能：
   *  1. 同步绳节碰撞体朝向
   *  2. 写重力 / 阻尼（reducedMotion 时额外加阻尼）
   *  3. 质量变化时重算卡牌质量属性
   *  4. 刚度变化时重建 3 级弹簧网络
   *  5. 施加三处扭矩耦合（爪夹↔旋环绕 Y、旋环↔轭绕 X）
   *  6. 轭自回正（让夹子始终与带子对齐）
   *  7. 卡牌抗扭（非线性回正 + 角速度阻尼，±18 封顶）
   *
   * 参数：
   *  - physics       {BadgePhysicsConfig} 配置
   *  - reducedMotion {boolean} 是否减弱动效
   *
   * 返回值：无
   * 异常：无
   */
  const update = (physics: BadgePhysicsConfig, reducedMotion: boolean): void => {
    syncJointFrames();
    world.gravity.y = -physics.gravity;

    card.body.setLinearDamping(physics.damping + (reducedMotion ? 2 : 0));
    card.body.setAngularDamping(physics.damping + 0.2 + (reducedMotion ? 2 : 0));

    if (appliedMass !== physics.mass) {
      appliedMass = physics.mass;
      card.collider.setMass(appliedMass);
      card.body.recomputeMassPropertiesFromColliders();
    }

    if (appliedStiffness !== physics.strapStiffness) {
      appliedStiffness = physics.strapStiffness;
      springs.forEach((joint) => world.removeImpulseJoint(joint, true));
      springs.length = 0;
      for (const strap of straps) {
        const chain: RAPIER.RigidBody[] = [strap.anchor, ...strap.links];
        for (const span of [1, 2, 3]) {
          for (let i = span; i < chain.length; i++) {
            // 相邻节最硬（.6）、隔两节最硬（1）、隔三节最软（.45）
            const stiffness = appliedStiffness * (span === 1 ? 0.6 : span === 2 ? 1 : 0.45);
            const damping = SPRING_DAMPING_K * Math.sqrt(stiffness * SPRING_NODE_MASS);
            springs.push(
              world.createImpulseJoint(
                RAPIER.JointData.spring(
                  strap.segment * span,
                  stiffness,
                  damping,
                  { x: 0, y: 0, z: 0 },
                  { x: 0, y: 0, z: 0 }
                ),
                chain[i - span],
                chain[i],
                true
              )
            );
          }
        }
      }
    }

    applySwivelCoupling(clasp, eye, { x: 0, y: 1, z: 0 }, physics.swivelDamping, 369e-6);
    applySwivelCoupling(eye, yoke, { x: 1, y: 0, z: 0 }, 0.08 + physics.swivelDamping * 0.4, 199e-6);

    // 轭自回正：一阶回正 + 角速度阻尼（c=.001、f=.12），让夹子不会歪着挂
    const yokeRotation = yoke.rotation();
    const yokeRoll = Math.atan2(
      2 * (yokeRotation.x * yokeRotation.z + yokeRotation.w * yokeRotation.y),
      1 - 2 * (yokeRotation.x * yokeRotation.x + yokeRotation.y * yokeRotation.y)
    );
    const c = 0.001;
    const f = 0.12;
    const dt = world.timestep;
    const restoreImpulse =
      -(2 * yokeRoll + f * yoke.angvel().y) * dt / (1 + (f * dt) / c + (2 * dt * dt) / c);
    yoke.applyTorqueImpulse({ x: 0, y: restoreImpulse, z: 0 }, true);

    // 卡牌抗扭
    const cardRotation = card.body.rotation();
    const twistAngle = Math.atan2(
      2 * (cardRotation.x * cardRotation.z + cardRotation.w * cardRotation.y),
      1 - 2 * (cardRotation.x * cardRotation.x + cardRotation.y * cardRotation.y)
    );
    card.body.applyTorqueImpulse(
      {
        x: 0,
        y: antiTwistTorque(twistAngle, card.body.angvel().y, physics.antiTwist, physics.twistProgression) * dt,
        z: 0,
      },
      true
    );
  };

  /**
   * 复位全部刚体
   *
   * 功能：位置/朝向/速度/受力全部恢复初始值，并重新对齐绳节碰撞体。
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   */
  const reset = (): void => {
    for (const { body, position } of initialStates) {
      body.setTranslation(position, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.resetForces(true);
      body.resetTorques(true);
    }
    syncJointFrames();
  };

  update(config, false);

  return {
    world,
    card,
    wall,
    clasp,
    eye,
    yoke,
    straps,
    restY: BADGE_REST_Y,
    update,
    syncJointFrames,
    reset,
    free: () => world.free(),
  };
}
