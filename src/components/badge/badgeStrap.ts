/**
 * 织带（挂绳）网格：把物理绳链的位置"蒙"成一条可扭转的扁平带子
 *
 * 站点的做法不是渲染物理胶囊，而是另建一套 (80+1)×13 的网格：
 *  - 采样一条穿过各节刚体质心的 CatmullRomCurve3
 *  - 用**平行传输（parallel transport）**建立沿线的参考系（不会像 Frenet 那样在直线段突跳）
 *  - 把织带的"正面朝向"折算成一个扭转角，用**半角折叠**处理正反面对称，
 *    再做指数平滑（避免翻转时瞬间弹跳）
 *  - 扭转沿长度用 smoothstep 分配：固定端 0 → 轭端满
 *  - 截面是椭圆（半宽 .085 / 半厚 .012），所以它看起来是"织带"而不是"绳子"
 *
 * 注意事项：
 *  - 每个采样点在生成前会过一次 clampFn（卡片体积排斥），保证织带不会穿进卡里
 *  - 单帧内所有中间量都复用成员向量，不产生临时对象（60fps 下零 GC）
 */

import * as THREE from 'three';

/** 织带横截面径向分段数（0..12 共 13 个顶点） */
const RADIAL_SEGMENTS = 12;

/** 织带体积排斥回调：入参是采样点，返回是否被改动过 */
export type StrapClampFn = (point: THREE.Vector3) => boolean;

/**
 * 织带网格
 *
 * 功能：持有一份 (links+1)×13 的 BufferGeometry，暴露 update() 由帧循环每帧刷新顶点。
 */
export class BadgeStrapRibbon {
  /** 可直接加进场景的网格（castShadow、关闭视锥剔除） */
  readonly mesh: THREE.Mesh;

  /** 沿长度方向的采样站数（分段数） */
  private readonly links: number;

  /** 织带半宽（椭圆长半轴） */
  private readonly halfWidth: number;

  /** 织带半厚（椭圆短半轴） */
  private readonly halfThickness = 0.012;

  /** 顶点位置缓冲（原地写入后置 needsUpdate） */
  private readonly positions: Float32Array;

  /** 顶点法线缓冲 */
  private readonly normals: Float32Array;

  /** 位置属性（与 this.positions 共享同一块 TypedArray） */
  private readonly positionAttribute: THREE.BufferAttribute;

  /** 法线属性（与 this.normals 共享同一块 TypedArray） */
  private readonly normalAttribute: THREE.BufferAttribute;

  /** 各站的曲线中心点 */
  private readonly stations: THREE.Vector3[];

  /** 各站的切线 */
  private readonly tangents: THREE.Vector3[];

  /** 平行传输得到的参考系（垂直于切线） */
  private readonly frames: THREE.Vector3[];

  /** 平滑后的织带扭转角（弧度） */
  private twist = 0;

  // —— 复用临时量（避免逐帧分配）——
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpCross = new THREE.Vector3();

  /**
   * 构造织带网格
   *
   * 参数：
   *  - material {THREE.Material} 织带材质（织物 bump + 深色）
   *  - links    {number} 沿长度的采样段数，默认 80
   *  - halfWidth{number} 半宽，默认 0.085
   *
   * 异常：无
   *
   * 注意事项：
   *  - 索引是固定的（生成一次），之后每帧只更新 position/normal
   *  - frustumCulled=false：网格包围盒每帧在变，剔除会导致偶发整条带子消失
   */
  constructor(material: THREE.Material, links = 80, halfWidth = 0.085) {
    this.links = links;
    this.halfWidth = halfWidth;

    const stations = links + 1;
    this.positions = new Float32Array(stations * (RADIAL_SEGMENTS + 1) * 3);
    this.normals = new Float32Array(stations * (RADIAL_SEGMENTS + 1) * 3);
    const uvs = new Float32Array(stations * (RADIAL_SEGMENTS + 1) * 2);
    const indices: number[] = [];

    for (let i = 0; i <= links; i++) {
      for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
        const index = i * (RADIAL_SEGMENTS + 1) + j;
        uvs[index * 2] = j / RADIAL_SEGMENTS;
        uvs[index * 2 + 1] = i / links;
        if (i < links && j < RADIAL_SEGMENTS) {
          indices.push(index, index + 1, index + RADIAL_SEGMENTS + 1);
          indices.push(index + 1, index + RADIAL_SEGMENTS + 2, index + RADIAL_SEGMENTS + 1);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    // 注意：不能用 Float32BufferAttribute！three 0.169 的实现是 `new Float32Array(array)`，
    // 会把传入的数组**拷贝**一份，导致每帧写入 this.positions 完全传不到 GPU。
    // 参考站点用的是老版本 three（当时不拷贝），移植时必须改用 BufferAttribute 才能保持语义。
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.normalAttribute = new THREE.BufferAttribute(this.normals, 3);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.normalAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('normal', this.normalAttribute);
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;

    this.stations = Array.from({ length: stations }, () => new THREE.Vector3());
    this.tangents = Array.from({ length: stations }, () => new THREE.Vector3());
    this.frames = Array.from({ length: stations }, () => new THREE.Vector3());
  }

  /**
   * 刷新织带顶点
   *
   * 功能：按当前物理绳链位置重建整条带子（每帧调用一次）。
   *
   * 参数：
   *  - curve   {THREE.Curve<THREE.Vector3>} 穿过各节刚体质心（+ 两端附件点）的曲线
   *  - up      {THREE.Vector3} 织带"正面"朝向参考（来自轭的 X 轴世界方向）
   *  - dt      {number} 帧间隔（秒），用于扭转角平滑
   *  - clampFn {StrapClampFn} 可选的采样点修正（卡片体积排斥），返回是否改过点
   *
   * 返回值：无
   * 异常：无
   *
   * 注意事项：
   *  - 采样点被 clampFn 改过之后必须重算切线（否则参考系会歪）
   *  - 扭转角平滑系数固定 14/s（约 70ms 收敛），过小会"翻面拖沓"，过大等于没平滑
   */
  update(
    curve: THREE.Curve<THREE.Vector3>,
    up: THREE.Vector3,
    dt: number,
    clampFn?: StrapClampFn
  ): void {
    const { links, stations, tangents, frames } = this;

    for (let i = 0; i <= links; i++) {
      const t = i / links;
      curve.getPoint(t, stations[i]);
      curve.getTangent(t, tangents[i]).normalize();
    }

    if (clampFn) {
      let changed = false;
      for (let i = 0; i <= links; i++) {
        changed = clampFn(stations[i]) || changed;
      }
      if (changed) {
        for (let i = 0; i <= links; i++) {
          tangents[i]
            .copy(stations[Math.min(links, i + 1)])
            .sub(stations[Math.max(0, i - 1)])
            .normalize();
        }
      }
    }

    // 平行传输：首站把世界 X 轴投影到垂直于切线的平面，之后逐站用最小弧旋转传递
    frames[0].set(1, 0, 0).addScaledVector(tangents[0], -tangents[0].x).normalize();
    for (let i = 1; i <= links; i++) {
      this.tmpQuat.setFromUnitVectors(tangents[i - 1], tangents[i]);
      frames[i].copy(frames[i - 1]).applyQuaternion(this.tmpQuat);
      frames[i].addScaledVector(tangents[i], -frames[i].dot(tangents[i])).normalize();
    }

    // 扭转角：末站参考系 与 传入的 up 之间的夹角（绕切线）
    const ref = this.tmpA.copy(up).addScaledVector(tangents[links], -up.dot(tangents[links])).normalize();
    const angle = Math.atan2(
      this.tmpCross.crossVectors(frames[links], ref).dot(tangents[links]),
      frames[links].dot(ref)
    );
    // 半角折叠：织带正反面等价，把角度折到 (-π/2, π/2]，避免翻转时弹跳
    const folded = 0.5 * Math.atan2(Math.sin(2 * angle), Math.cos(2 * angle));
    this.twist += (folded - this.twist) * (1 - Math.exp(-14 * dt));

    const positions = this.positions;
    const normals = this.normals;
    let vertexOffset = 0;
    let normalOffset = 0;

    for (let i = 0; i <= links; i++) {
      // 扭转沿长度分配：固定端不扭，越靠近轭扭得越多（smoothstep 过渡）
      const twistAt = this.twist * THREE.MathUtils.smoothstep(i / links, 0, 1);
      const across = this.tmpA.copy(frames[i]).applyAxisAngle(tangents[i], twistAt);
      const normal = this.tmpB.crossVectors(across, tangents[i]).normalize();

      for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
        const a = (j / RADIAL_SEGMENTS) * Math.PI * 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);

        this.tmpC
          .copy(stations[i])
          .addScaledVector(across, cos * this.halfWidth)
          .addScaledVector(normal, sin * this.halfThickness);
        positions[vertexOffset++] = this.tmpC.x;
        positions[vertexOffset++] = this.tmpC.y;
        positions[vertexOffset++] = this.tmpC.z;

        // 椭圆截面法线：两个主轴的缩放互为倒数后再归一化
        this.tmpC
          .copy(across)
          .multiplyScalar(cos / this.halfWidth)
          .addScaledVector(normal, sin / this.halfThickness)
          .normalize();
        normals[normalOffset++] = this.tmpC.x;
        normals[normalOffset++] = this.tmpC.y;
        normals[normalOffset++] = this.tmpC.z;
      }
    }

    this.positionAttribute.needsUpdate = true;
    this.normalAttribute.needsUpdate = true;
  }

  /**
   * 读取当前平滑扭转角
   *
   * 功能：调试/外部联动用（站点也暴露了 getTwist）。
   *
   * 参数：无
   * 返回值：{number} 扭转角（弧度）
   * 异常：无
   */
  getTwist(): number {
    return this.twist;
  }

  /**
   * 重置扭转角与几何
   *
   * 功能：恢复出厂状态时调用（配合物理 reset），把扭转角清零避免残留姿态。
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   */
  reset(): void {
    this.twist = 0;
  }
}
