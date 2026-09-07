/**
 * pianoOrbit.ts —— 轻量轨道相机控制器（阻尼 / 缩放 / 平移 / 触摸 / 自动旋转）
 *
 * 功能：
 *  - 提供带阻尼的球坐标轨道相机控制（theta 方位角 / phi 极角 / radius 半径 / target 注视点）
 *  - 支持拖动旋转、滚轮/双指缩放、Shift+拖动平移、自动旋转
 *  - 移植自独立钢琴项目的 orbit.js（全局脚本版），改为 ES Module
 *
 * 参数：通过 createOrbit(camera, dom) 创建实例
 * 返回值：无（导出工厂函数）
 * 异常：无（setPointerCapture 失败时静默忽略）
 *
 * 注意事项：
 *  - update(dt) 需每帧调用，负责阻尼插值并写入相机位姿
 *  - enabled=false 时暂停所有输入响应（用于镜头动画期间锁定相机）
 */
import * as THREE from 'three';

/** 视角预设（球坐标 + 注视点） */
export interface OrbitView {
  theta: number;
  phi: number;
  radius: number;
  target: THREE.Vector3;
}

/** 轨道控制器实例接口 */
export interface OrbitController {
  enabled: boolean;
  autoRotate: boolean;
  autoRotateSpeed: number;
  minPhi: number;
  maxPhi: number;
  minRadius: number;
  maxRadius: number;
  damping: number;
  panSpeed: number;
  target: THREE.Vector3;
  update(dt: number): void;
  setView(v: Partial<OrbitView>, instant?: boolean): void;
  getState(): OrbitView;
  dispose(): void;
}

/**
 * 创建轨道相机控制器
 *
 * 参数：
 *  - camera {THREE.PerspectiveCamera} 受控相机
 *  - dom    {HTMLElement}             接收输入事件的元素（通常为 canvas）
 *
 * 返回值：{OrbitController} 控制器实例
 *
 * 注意事项：
 *  - pointermove/up 挂在 window 上（拖出元素后仍可继续旋转）
 *  - wheel 事件 preventDefault，仅当 enabled 时响应
 */
export function createOrbit(camera: THREE.PerspectiveCamera, dom: HTMLElement): OrbitController {
  // 方法（update/setView/getState/dispose）在下方补充赋值，先以断言建立完整类型
  const api = {
    enabled: true,
    autoRotate: false,
    autoRotateSpeed: 0.055,
    minPhi: 0.10,
    maxPhi: 1.50,
    minRadius: 0.85,
    maxRadius: 7.5,
    damping: 7.5,
    panSpeed: 1.0,
  } as OrbitController;

  const target = new THREE.Vector3(0, 0.78, -0.55);
  const targetD = target.clone();
  let theta = 0.62, phi = 1.06, radius = 3.35;
  let thetaD = theta, phiD = phi, radiusD = radius;

  let dragging = 0;           // 0 无 / 1 旋转 / 2 平移
  let lastX = 0, lastY = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;

  const tmp = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

  const onDown = (e: PointerEvent) => {
    if (!api.enabled) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragging = (e.button === 2 || e.shiftKey || e.ctrlKey) ? 2 : 1;
      lastX = e.clientX; lastY = e.clientY;
    } else if (pointers.size === 2) {
      const p = Array.from(pointers.values());
      pinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      dragging = 2;
    }
    if (dom.setPointerCapture) { try { dom.setPointerCapture(e.pointerId); } catch { /* noop */ } }
  };

  const onMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const w = dom.clientWidth || 1, h = dom.clientHeight || 1;

    if (pointers.size === 2) {
      const p = Array.from(pointers.values());
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (pinchDist > 0) radiusD = clamp(radiusD * (pinchDist / Math.max(1, d)), api.minRadius, api.maxRadius);
      pinchDist = d;
      return;
    }
    if (!dragging || !api.enabled) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;

    if (dragging === 1) {
      thetaD -= (dx / w) * Math.PI * 2.0;
      phiD = clamp(phiD - (dy / h) * Math.PI * 1.1, api.minPhi, api.maxPhi);
    } else {
      // 沿相机平面平移
      camera.getWorldDirection(tmp);
      right.crossVectors(camera.up, tmp).normalize();
      up.crossVectors(tmp, right).normalize();
      const k = radius * 0.0016 * api.panSpeed;
      targetD.addScaledVector(right, dx * k);
      targetD.addScaledVector(up, -dy * k);
      targetD.y = clamp(targetD.y, 0.05, 2.2);
    }
  };

  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragging = 0;
    else if (pointers.size === 1) {
      const p = Array.from(pointers.values())[0];
      lastX = p.x; lastY = p.y; dragging = 1; pinchDist = 0;
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (!api.enabled) return;
    e.preventDefault();
    const s = Math.exp((e.deltaY > 0 ? 1 : -1) * Math.min(0.28, Math.abs(e.deltaY) / 420 + 0.06));
    radiusD = clamp(radiusD * s, api.minRadius, api.maxRadius);
  };

  dom.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', (e) => e.preventDefault());

  api.update = function (dt: number) {
    if (api.autoRotate && !dragging) thetaD += api.autoRotateSpeed * dt;
    const k = 1 - Math.exp(-api.damping * Math.min(0.1, dt));
    theta += (thetaD - theta) * k;
    phi += (phiD - phi) * k;
    radius += (radiusD - radius) * k;
    target.lerp(targetD, k);

    const sp = Math.sin(phi), cp = Math.cos(phi);
    camera.position.set(
      target.x + radius * sp * Math.sin(theta),
      target.y + radius * cp,
      target.z + radius * sp * Math.cos(theta)
    );
    camera.lookAt(target);
  };

  api.setView = function (v: Partial<OrbitView>, instant?: boolean) {
    if (v.theta !== undefined) thetaD = v.theta;
    if (v.phi !== undefined) phiD = clamp(v.phi, api.minPhi, api.maxPhi);
    if (v.radius !== undefined) radiusD = clamp(v.radius, api.minRadius, api.maxRadius);
    if (v.target) targetD.copy(v.target);
    if (instant) { theta = thetaD; phi = phiD; radius = radiusD; target.copy(targetD); }
  };

  api.getState = function (): OrbitView {
    return { theta, phi, radius, target: target.clone() };
  };
  api.target = target;
  api.dispose = function () {
    dom.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    dom.removeEventListener('wheel', onWheel);
  };

  return api;
}
