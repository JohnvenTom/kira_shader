/**
 * SecondOrderDynamics - 二阶动力学弹簧（移植自 lusion.co，T3ssel8R 风格）
 *
 * 功能：
 *  - 用二阶微分方程平滑追踪目标值：x'' = (目标 + k3·目标速度 - x - k1·x') / k2
 *  - 半隐式欧拉积分：先更新速度再更新位置（无条件稳定的基础）
 *  - 数值稳定化：对 k1/k2 做半隐式欧拉的稳定域修正（robust 版本），
 *    大步长下不振荡爆炸；欠阻尼(ζ<1)时保留真实的过冲和回荡手感
 *
 * 参数：
 *  - initialValue  初始值（number 或 THREE.Vector2/3 等带 clone/setScalar 的向量）
 *  - f             频率 Hz，响应速度（越大跟得越紧）
 *  - z             阻尼 ζ：<1 欠阻尼（会荡），=1 临界，>1 过阻尼
 *  - r             初始响应：>1 进入时先过冲，<1 先迟滞（"预期感"）
 *
 * lusion 原版参数（Featured Work 卡片）：
 *  - 焦点/视差相机  f=1,   ζ=0.6, r=2   （欠阻尼，跟手且会荡）
 *  - 缩放           f=2.2, ζ=0.7, r=3   （进入瞬间明显过冲）
 */
export class SecondOrderDynamics {
  private target0: number;
  target: number;
  private prevTarget: number;
  value: number;
  private valueVel = 0;

  private k1: number;
  private k2: number;
  private k3: number;

  private w: number;
  private z: number;
  private d: number;

  private k1Stable = 0;
  private k2Stable = 0;

  constructor(initialValue: number, f = 1.5, z = 0.8, r = 2) {
    this.target0 = initialValue;
    this.target = initialValue;
    this.prevTarget = initialValue;
    this.value = initialValue;

    const wn = Math.PI * 2 * f;
    this.w = wn;
    this.z = z;
    this.d = this.w * Math.sqrt(Math.abs(z * z - 1));
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / (wn * wn);
    this.k3 = (r * z) / wn;
  }

  reset(value: number = this.target0): void {
    this.valueVel = 0;
    this.prevTarget = value;
    this.target = value;
    this.value = value;
  }

  /** 每帧推进（dt 秒）。目标速度用相邻帧目标差分近似 */
  update(dt: number): void {
    if (dt <= 0) return;
    const targetVel = (this.target - this.prevTarget) / dt;
    this.prevTarget = this.target;
    this.computeStableCoefficients(dt);

    // 半隐式欧拉（robust 稳定域修正后）
    this.valueVel +=
      (this.target + this.k3 * targetVel - this.value - this.k1Stable * this.valueVel) *
      (dt / this.k2Stable);
    this.value += this.valueVel * dt;
  }

  /**
   * 稳定系数：半隐式欧拉在大步长下的稳定域修正
   * （当 w·dt < ζ 时直接用原系数；否则按指数衰减解析解构造等价系数）
   */
  private computeStableCoefficients(dt: number): void {
    if (this.w * dt < this.z) {
      this.k1Stable = this.k1;
      this.k2Stable = Math.max(this.k2, (1.1 * dt * dt) / 4 + (dt * this.k1) / 2);
    } else {
      const t1 = Math.exp(-this.z * this.w * dt);
      const t2 =
        2 * t1 * (this.z <= 1 ? Math.cos(dt * this.d) : Math.cosh(dt * this.d));
      const t3 = t1 * t1;
      const c = dt / (1 + t3 - t2);
      this.k1Stable = (1 - t3) * c;
      this.k2Stable = dt * c;
    }
  }
}

/**
 * VectorSecondOrderDynamics - 向量版二阶动力学（对 x/y/z 各挂一个标量弹簧）
 *
 * 用途：卡片焦点 u_focusPos（xy=视差相机位置，z=焦平面深度）需要三轴
 * 独立弹簧参数一致地追踪，直接组合三个标量弹簧并暴露 target/value 读写器。
 */
export class VectorSecondOrderDynamics {
  readonly target = { x: 0, y: 0, z: 0 };
  readonly value = { x: 0, y: 0, z: 0 };
  private springs: SecondOrderDynamics[];

  constructor(initial: { x: number; y: number; z: number }, f = 1, z = 0.6, r = 2) {
    this.springs = [
      new SecondOrderDynamics(initial.x, f, z, r),
      new SecondOrderDynamics(initial.y, f, z, r),
      new SecondOrderDynamics(initial.z, f, z, r),
    ];
    this.syncFromSprings();
  }

  set(x: number, y: number, z: number): void {
    this.springs[0].target = x;
    this.springs[1].target = y;
    this.springs[2].target = z;
  }

  update(dt: number): void {
    for (const s of this.springs) s.update(dt);
    this.syncFromSprings();
  }

  private syncFromSprings(): void {
    this.target.x = this.springs[0].target;
    this.target.y = this.springs[1].target;
    this.target.z = this.springs[2].target;
    this.value.x = this.springs[0].value;
    this.value.y = this.springs[1].value;
    this.value.z = this.springs[2].value;
  }
}
