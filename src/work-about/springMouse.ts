/**
 * 原站 useSpringMouse 的等效实现（_bundles/full/04kr7kd5riobb.js 540-596）：
 *
 *   mouseX01/mouseY01 = clientX/w, 1 − clientY/h（0..1，y 上正）
 *   spring 阻尼：framer animate(mv, target, { stiffness: 60, damping: 30, restDelta })
 *   getMouseOffset() = (1 − x − 0.5, 1 − y − 0.5) = 0.5 − mouse01   （±0.5）
 *
 * 所有场景的鼠标相机视差统一吃这一份阻尼（原站 hero 0.3 / projects 0.2 /
 * contact 0.25 / golden-tie lookAt 0.25 / reveal lookAt 0.5 / office rot 0.025
 * 的消费系数各不相同，但阻尼器只有这一个）。
 *
 * spring(60, 30) 是重度过阻尼二阶系统（ζ≈1.94）：快极点 τ≈36ms + 慢极点 τ≈465ms，
 * 5% 收敛约 1.2-1.4s —— 视差是"慢黏漂移"，不是即跟即停。
 *
 * 本工具直接跟踪 **offset 语义**（±0.5）：调用方传 target = (−0.5·NDC.x, −0.5·NDC.y)
 * （touch 设备传 (0,0)，对应原站 isTouchDevice 时 offset 恒 0）。
 */

export interface SpringMouse {
  /** 阻尼后的 offset 值（±0.5 量级） */
  readonly px: number;
  readonly py: number;
  /** 推进一帧。dt 会被 clamp 并子步积分保证数值稳定 */
  update(dt: number, targetX: number, targetY: number): void;
}

export function createSpringMouse(stiffness = 60, damping = 30): SpringMouse {
  let px = 0;
  let py = 0;
  let vx = 0;
  let vy = 0;
  return {
    get px() {
      return px;
    },
    get py() {
      return py;
    },
    update(dt, targetX, targetY) {
      // 半隐式欧拉 + 子步：ωn=√60≈7.7 rad/s，h=1/240 远小于稳定域
      const d = Math.min(0.05, Math.max(1e-4, dt));
      const steps = Math.max(1, Math.ceil(d / (1 / 240)));
      const h = d / steps;
      for (let i = 0; i < steps; i++) {
        vx += (stiffness * (targetX - px) - damping * vx) * h;
        vy += (stiffness * (targetY - py) - damping * vy) * h;
        px += vx * h;
        py += vy * h;
      }
    },
  };
}

/** NDC（-1..1，y 上正）→ offset 语义（±0.5，即原站 getMouseOffset() 的目标值） */
export const ndcToOffsetTarget = (ndcX: number, ndcY: number): [number, number] => [-ndcX * 0.5, -ndcY * 0.5];

/** 便捷：NDC 输入 + touch 直零的常见组合 */
export function updateSpringFromNdc(spring: SpringMouse, dt: number, ndcX: number, ndcY: number, touch?: boolean): void {
  if (touch) {
    spring.update(dt, 0, 0);
    return;
  }
  const [tx, ty] = ndcToOffsetTarget(ndcX, ndcY);
  spring.update(dt, tx, ty);
}
