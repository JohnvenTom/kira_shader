import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

/**
 * CameraDebuggerProps 接口定义
 *
 * 功能：定义相机调试器的 props
 */
interface CameraDebuggerProps {
  /** 模型 setup ref，包含 scaledSize 和 distance，用于把绝对坐标换算为相对倍数 */
  setupRef: React.MutableRefObject<{
    scaledSize: THREE.Vector3;
    distance: number;
  } | null>;
  /** 初始相机位置 [x, y, z]（世界坐标），由 CAMERA_CONFIG 的 yaw/pitch/distance 算出 */
  initialCameraPos?: [number, number, number];
  /** 看向点 X 世界坐标（OrbitControls target.x 的初始值） */
  lookAtX?: number;
  /** 看向点 Y 世界坐标（OrbitControls target.y 的初始值） */
  lookAtY?: number;
  /** 看向点 Z 世界坐标（OrbitControls target.z 的初始值） */
  lookAtZ?: number;
  /** 相机视野（°），用于初始化 FOV 滑块 */
  fov?: number;
  /** 是否显示调试信息面板（默认 true）。设为 false 时仅保留受限的 OrbitControls，不渲染 UI */
  showPanel?: boolean;
}

/**
 * 相机调试器组件
 *
 * 功能：
 *  - 启用 OrbitControls，允许鼠标自由旋转、平移、缩放相机
 *  - 支持 WASD 键盘移动、Space 上升、Shift 下降（FPS 风格自由飞行）
 *  - 添加 FOV 滑块，实时调整透视相机的视野
 *  - 实时显示相机的位置 (x, y, z)、欧拉角 (pitch/yaw)、FOV
 *  - 把当前相机参数反向换算为 CAMERA_CONFIG 格式
 *  - 提供"复制配置"按钮，一键复制到剪贴板
 *  - 提供"重置视角"按钮
 *
 * 参数：
 *  - setupRef  {MutableRefObject} 模型 setup ref（含 scaledSize 和 distance）
 *  - lookAtY   {number}           看向点 Y（默认 0）
 *
 * 返回值：React.ReactElement（OrbitControls 控件 + 外部 DOM 浮层）
 *
 * 异常：无
 *
 * 注意事项：
 *  - OrbitControls 会接管相机控制权，外部的 useFrame 相机控制必须禁用
 *  - 键盘移动时相机与 OrbitControls.target 同步平移，避免视角被拉回
 *  - HTML 浮层通过 useEffect 手动挂载到 document.body，绕过 R3F 的命名空间限制
 *  - 每帧更新信息面板，但 DOM 更新节流到 ~10fps 避免性能问题
 */
export function CameraDebugger({
  setupRef,
  initialCameraPos,
  lookAtX = 0,
  lookAtY = 0,
  lookAtZ = 0,
  fov = 50,
  showPanel = true,
}: CameraDebuggerProps) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  // 当前相机信息（用于复制功能）
  const infoRef = useRef({
    x: 0,
    y: 0,
    z: 0,
    yawDeg: 0,
    pitchDeg: 0,
    fov: 50,
    distance: 1,
    height: 0,
    lookAtXMul: 0,
    lookAtYMul: 0,
    lookAtZMul: 0,
  });
  const frameCounter = useRef(0);

  // 键盘按键状态（true=按下）
  // W/S 前后、A/D 左右、Space 上升、Shift 下降
  const keysRef = useRef<Record<string, boolean>>({});

  // 鼠标归一化位置 [-1, 1]（用于视差效果）
  // x 右正、y 上正
  const mouseRef = useRef({ x: 0, y: 0 });

  // DOM 元素引用（手动创建并挂载到 body）
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const valueElsRef = useRef<{
    x?: HTMLSpanElement;
    y?: HTMLSpanElement;
    z?: HTMLSpanElement;
    yaw?: HTMLSpanElement;
    pitch?: HTMLSpanElement;
    fov?: HTMLSpanElement;
    yawCfg?: HTMLSpanElement;
    pitchCfg?: HTMLSpanElement;
    heightCfg?: HTMLSpanElement;
    distCfg?: HTMLSpanElement;
    lookAtXCfg?: HTMLSpanElement;
    lookAtYCfg?: HTMLSpanElement;
    lookAtZCfg?: HTMLSpanElement;
    fovCfg?: HTMLSpanElement;
    fovInput?: HTMLInputElement;
    copyBtn?: HTMLButtonElement;
  }>({});

  /**
   * 计算 OrbitControls 受限模式的边界（仅 showPanel=false 时使用）
   *
   * 功能：基于初始相机位置与 target，反算球坐标（azimuth/polar/distance），
   *      并围绕初始视角设置一个旋转/缩放窗口，避免相机偏离展示视角过远
   *
   * 参数：无（读取 props 与 setupRef）
   * 返回值：{ minAzimuth, maxAzimuth, minPolar, maxPolar, minDistance, maxDistance }
   *
   * 注意事项：
   *  - 水平旋转窗口 ±12°，垂直旋转窗口 ±8°
   *  - 距离允许 0.85~1.15 倍初始距离（缩放被禁用时仍可作为安全边界）
   *  - polar 角限制在 (0.1, π-0.1) 避免翻到正上方/正下方
   */
  const limits = useMemo(() => {
    const baseDistance = setupRef.current?.distance ?? 8;
    const camX = initialCameraPos?.[0] ?? lookAtX;
    const camY = initialCameraPos?.[1] ?? lookAtY;
    const camZ = initialCameraPos?.[2] ?? (lookAtZ + baseDistance);

    // 相机到 target 的方向向量
    const dx = camX - lookAtX;
    const dy = camY - lookAtY;
    const dz = camZ - lookAtZ;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // OrbitControls 球坐标：azimuth 从 +Z 起算，polar 从 +Y 起算
    const azimuth = Math.atan2(dx, dz);
    const polar = Math.atan2(horizontalDist, dy);

    // 旋转窗口：水平 ±12°、垂直 ±8°（更小的展示视角晃动）
    const azimuthWindow = (12 * Math.PI) / 180;
    const polarWindow = (8 * Math.PI) / 180;

    return {
      minAzimuth: azimuth - azimuthWindow,
      maxAzimuth: azimuth + azimuthWindow,
      minPolar: Math.max(0.1, polar - polarWindow),
      maxPolar: Math.min(Math.PI - 0.1, polar + polarWindow),
      minDistance: dist * 0.85,
      maxDistance: dist * 1.15,
    };
    // setupRef 是 ref，引用稳定；limits 主要依赖 initialCameraPos 与 target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCameraPos, lookAtX, lookAtY, lookAtZ]);

  /**
   * 创建 HTML 浮层并挂载到 document.body
   *
   * 功能：在组件挂载时创建独立的 DOM 元素，避免 R3F Canvas 命名空间冲突
   *
   * 参数：无
   * 返回值：无
   *
   * 异常：无
   */
  useEffect(() => {
    // 初始化相机位置：优先使用 initialCameraPos（按 CAMERA_CONFIG 的 yaw/pitch/distance 算出）
    // 否则从 target 沿 +Z 后退 baseDistance 作为默认
    const baseDistance = setupRef.current?.distance ?? 8;
    if (initialCameraPos) {
      camera.position.set(initialCameraPos[0], initialCameraPos[1], initialCameraPos[2]);
    } else {
      camera.position.set(lookAtX, lookAtY, lookAtZ + baseDistance);
    }
    camera.lookAt(lookAtX, lookAtY, lookAtZ);
    // 应用 FOV 配置（与 CAMERA_CONFIG 保持一致）
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = fov;
    cam.updateProjectionMatrix();

    // 启用调试模式：让 Canvas 接收鼠标事件、滚动容器透传事件
    // 解决 .canvas-wrapper { pointer-events: none } 导致 OrbitControls 收不到事件的问题
    document.body.classList.add('camera-debug-mode');

    // 鼠标移动事件：记录归一化坐标 [-1, 1]，用于视差效果
    // 注意：此处两种模式都绑定，视差仅在 showPanel=false 时生效
    const handleMouseMove = (e: MouseEvent) => {
      // 以视口中心为原点，归一化到 [-1, 1]
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('mousemove', handleMouseMove);

    // 隐藏面板模式：仅初始化相机 + OrbitControls + 视差，不创建 UI 浮层与键盘监听
    if (!showPanel) return;

    // 键盘事件处理：按下/松开时更新 keysRef
    // 注意：OrbitControls 默认不处理键盘，所以这里自行实现
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框中的按键（如 FOV 滑块获得焦点时）
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      keysRef.current[e.code] = true;
      // 阻止空格触发页面滚动
      if (e.code === 'Space') e.preventDefault();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    // 失焦时清空所有按键状态（避免切窗后相机继续移动）
    const handleBlur = () => {
      keysRef.current = {};
    };
    window.addEventListener('blur', handleBlur);

    // 创建容器
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      width: 320px;
      background: rgba(10, 10, 10, 0.92);
      color: #fcf9f3;
      padding: 16px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.15);
      font-family: ui-monospace, "Cascadia Code", "Courier New", monospace;
      font-size: 11px;
      z-index: 9999;
      pointer-events: auto;
      backdrop-filter: blur(12px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      line-height: 1.5;
    `;
    // 阻止滚轮事件传到 Canvas
    overlay.addEventListener('wheel', (e) => e.stopPropagation());

    // 构建 HTML 内容
    overlay.innerHTML = `
      <div style="font-size:13px;font-weight:700;color:#60a5fa;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;align-items:center;">
        <span>🎥 Camera Debugger</span>
        <span style="font-size:9px;color:#4ade80;">● LIVE</span>
      </div>

      <div style="margin-bottom:8px;color:#ffffff60;font-size:10px;">── POSITION（世界坐标） ──</div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">X</span><span data-k="x" style="color:#fcf9f3;font-weight:600;">0.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">Y</span><span data-k="y" style="color:#fcf9f3;font-weight:600;">0.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">Z</span><span data-k="z" style="color:#fcf9f3;font-weight:600;">0.000</span></div>

      <div style="margin-top:12px;margin-bottom:8px;color:#ffffff60;font-size:10px;">── ROTATION（°） ──</div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">Yaw (水平)</span><span data-k="yaw" style="color:#60a5fa;font-weight:600;">0.00°</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">Pitch (俯仰)</span><span data-k="pitch" style="color:#a3e635;font-weight:600;">0.00°</span></div>

      <div style="margin-top:12px;margin-bottom:4px;color:#ffffff60;font-size:10px;">── FOV (视野) ──</div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:#ffffff80;">FOV</span><span data-k="fov" style="color:#fbbf24;font-weight:600;">50°</span></div>
      <input type="range" min="10" max="120" step="1" value="${fov}" data-k="fovInput" style="width:100%;margin:8px 0;accent-color:#3b82f6;" />

      <div style="margin-top:12px;margin-bottom:8px;color:#ffffff60;font-size:10px;">── CAMERA_CONFIG（反算） ──</div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">yawDeg</span><span data-k="yawCfg" style="color:#fcf9f3;font-weight:600;">0.00</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">pitchDeg</span><span data-k="pitchCfg" style="color:#fcf9f3;font-weight:600;">0.00</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">height</span><span data-k="heightCfg" style="color:#fcf9f3;font-weight:600;">0.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">distance</span><span data-k="distCfg" style="color:#fcf9f3;font-weight:600;">1.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">lookAtX</span><span data-k="lookAtXCfg" style="color:#fcf9f3;font-weight:600;">0.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">lookAtY</span><span data-k="lookAtYCfg" style="color:#fcf9f3;font-weight:600;">0.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,0.05);"><span style="color:#ffffff80;">lookAtZ</span><span data-k="lookAtZCfg" style="color:#fcf9f3;font-weight:600;">0.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0;"><span style="color:#ffffff80;">fov</span><span data-k="fovCfg" style="color:#fbbf24;font-weight:600;">50</span></div>

      <div style="margin-top:14px;display:flex;gap:8px;">
        <button data-k="copyBtn" style="flex:1;background:rgba(59,130,246,0.2);color:#60a5fa;border:1px solid rgba(59,130,246,0.4);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-family:inherit;">📋 复制配置</button>
        <button data-k="resetBtn" style="flex:1;background:rgba(239,68,68,0.2);color:#f87171;border:1px solid rgba(239,68,68,0.4);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-family:inherit;">↺ 重置</button>
      </div>

      <div style="margin-top:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);font-size:9px;color:#ffffff40;line-height:1.6;">
        <div style="margin-bottom:4px;color:#ffffff60;">── 鼠标 ──</div>
        <div>🖱️ 左键拖：旋转视角</div>
        <div>🖱️ 右键拖：平移</div>
        <div>🖱️ 滚轮：缩放</div>
        <div style="margin-top:6px;margin-bottom:4px;color:#ffffff60;">── 键盘 ──</div>
        <div>⌨️ W/A/S/D：前后左右移动</div>
        <div>⌨️ Space：上升</div>
        <div>⌨️ Shift：下降</div>
        <div style="margin-top:6px;">📐 拖好视角后点"复制配置"</div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlayRef.current = overlay;

    // 缓存所有需要更新的 DOM 元素引用（避免每帧 querySelector）
    // 注意：valueElsRef.current 初始为 {}，Object.keys 会返回空数组
    // 所以这里显式列出所有需要查询的 key
    const keysToQuery = [
      'x', 'y', 'z',
      'yaw', 'pitch', 'fov',
      'yawCfg', 'pitchCfg', 'heightCfg', 'distCfg',
      'lookAtXCfg', 'lookAtYCfg', 'lookAtZCfg', 'fovCfg',
      'fovInput', 'copyBtn',
    ];
    const els = valueElsRef.current;
    keysToQuery.forEach((k) => {
      const el = overlay.querySelector(`[data-k="${k}"]`);
      if (el) {
        // @ts-ignore - 动态赋值
        els[k] = el;
      }
    });

    // FOV 滑块事件
    els.fovInput?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      (camera as THREE.PerspectiveCamera).fov = v;
      camera.updateProjectionMatrix();
      if (els.fov) els.fov.textContent = `${v.toFixed(0)}°`;
    });

    // 复制按钮事件
    els.copyBtn?.addEventListener('click', async () => {
      const info = infoRef.current;
      const configText = `const CAMERA_CONFIG = {
  yawDeg: ${info.yawDeg.toFixed(2)},      // 水平角（°）
  pitchDeg: ${info.pitchDeg.toFixed(2)},    // 俯仰角（°）
  height: ${info.height.toFixed(3)},         // 相机高度（scaledSize.y 倍数）
  distance: ${info.distance.toFixed(3)},        // 距离倍数
  lookAtX: ${info.lookAtXMul.toFixed(3)},        // 看向点 X 倍数（scaledSize.x 倍数）
  lookAtY: ${info.lookAtYMul.toFixed(3)},       // 看向点 Y 倍数（scaledSize.y 倍数）
  lookAtZ: ${info.lookAtZMul.toFixed(3)},        // 看向点 Z 倍数（scaledSize.z 倍数）
  fov: ${info.fov.toFixed(0)},              // 相机视野（°）
};`;
      try {
        await navigator.clipboard.writeText(configText);
        if (els.copyBtn) {
          const orig = els.copyBtn.textContent;
          els.copyBtn.textContent = '✓ 已复制';
          els.copyBtn.style.background = 'rgba(74,222,128,0.25)';
          els.copyBtn.style.color = '#4ade80';
          els.copyBtn.style.borderColor = 'rgba(74,222,128,0.5)';
          setTimeout(() => {
            if (els.copyBtn) {
              els.copyBtn.textContent = orig;
              els.copyBtn.style.background = 'rgba(59,130,246,0.2)';
              els.copyBtn.style.color = '#60a5fa';
              els.copyBtn.style.borderColor = 'rgba(59,130,246,0.4)';
            }
          }, 1500);
        }
      } catch {
        if (els.copyBtn) els.copyBtn.textContent = '✗ 失败';
      }
    });

    // 重置按钮事件：还原到 CAMERA_CONFIG 配置的初始状态
    overlay.querySelector('[data-k="resetBtn"]')?.addEventListener('click', () => {
      const baseDistance = setupRef.current?.distance ?? 10;
      if (initialCameraPos) {
        camera.position.set(initialCameraPos[0], initialCameraPos[1], initialCameraPos[2]);
      } else {
        camera.position.set(lookAtX, lookAtY, lookAtZ + baseDistance);
      }
      camera.lookAt(lookAtX, lookAtY, lookAtZ);
      (camera as THREE.PerspectiveCamera).fov = fov;
      camera.updateProjectionMatrix();
      if (els.fovInput) (els.fovInput as HTMLInputElement).value = String(fov);
      if (els.fov) els.fov.textContent = `${fov}°`;
      controlsRef.current?.target.set(lookAtX, lookAtY, lookAtZ);
      controlsRef.current?.update();
    });

    // 清理：组件卸载时移除 DOM、调试模式类与事件监听
    return () => {
      document.body.classList.remove('camera-debug-mode');
      window.removeEventListener('mousemove', handleMouseMove);
      if (!showPanel) return;
      document.body.removeChild(overlay);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      overlayRef.current = null;
      valueElsRef.current = {};
    };
  }, [camera, initialCameraPos, lookAtX, lookAtY, lookAtZ, fov, showPanel]);

  /**
   * 每帧更新：
   *  1. 处理键盘 WASD/Space/Shift 移动相机（每帧执行，不节流）
   *  2. 从相机状态反向计算 CAMERA_CONFIG 参数并写入 DOM（节流到 ~10fps）
   *
   * 参数：无
   * 返回值：无
   *
   * 注意事项：
   *  - 键盘移动放在节流之前，避免移动卡顿
   *  - yaw=0 时相机在 +Z 方向；通过 atan2(x, z) 计算水平角
   *  - pitch 通过 atan2(dy, horizontalDist) 计算
   */
  useFrame(() => {
    // 隐藏面板模式：仅执行鼠标视差效果
    // 思路：让 OrbitControls.target 微微跟随鼠标位置偏移
    //       相机随 target 同步平移，产生镜头跟随鼠标的视差感
    if (!showPanel) {
      const controls = controlsRef.current;
      if (!controls) return;
      const mouse = mouseRef.current;
      // 视差幅度：取模型最小尺寸的 0.3%（减小摆动幅度，避免模型飞出画面）
      const scaledSize = setupRef.current?.scaledSize;
      const factor = scaledSize
        ? Math.min(scaledSize.x, scaledSize.y, scaledSize.z) * 0.003
        : 0.02;
      // X 方向取反：让"鼠标向左 → 镜头向左转"，符合直觉跟随
      const targetX = lookAtX - mouse.x * factor;
      const targetY = lookAtY + mouse.y * factor;
      // lerp 平滑过渡（系数 0.05 ≈ 慢速跟随）
      controls.target.x += (targetX - controls.target.x) * 0.05;
      controls.target.y += (targetY - controls.target.y) * 0.05;
      controls.update();
      return;
    }

    // 1. 键盘移动相机（每帧执行，避免节流卡顿）
    // 思路：基于相机朝向计算 forward/right 向量，相机与 target 同步平移
    //       否则 OrbitControls 会把相机拉回原 target 位置
    const keys = keysRef.current;
    const anyKey = keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD']
      || keys['Space'] || keys['ShiftLeft'] || keys['ShiftRight'];
    if (anyKey && controlsRef.current) {
      // 移动速度（单位/帧），按 60fps 估算每帧位移
      const speed = 0.08;

      // 计算相机水平前方向量（去除 Y 分量并归一化）
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();

      // 右向量 = forward × up
      const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();

      const move = new THREE.Vector3();
      if (keys['KeyW']) move.add(dir);
      if (keys['KeyS']) move.sub(dir);
      if (keys['KeyD']) move.add(right);
      if (keys['KeyA']) move.sub(right);
      if (keys['Space']) move.y += 1;
      if (keys['ShiftLeft'] || keys['ShiftRight']) move.y -= 1;

      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed);
        // 相机和 target 一起平移，保持视角不变形
        camera.position.add(move);
        controlsRef.current.target.add(move);
      }
    }

    // 2. 节流的 DOM 信息更新
    frameCounter.current += 1;
    if (frameCounter.current % 6 !== 0) return;
    if (!overlayRef.current) return;

    const target = controlsRef.current?.target ?? { x: lookAtX, y: lookAtY, z: lookAtZ };
    const dx = camera.position.x - target.x;
    const dy = camera.position.y - target.y;
    const dz = camera.position.z - target.z;

    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const totalDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 水平角 yaw
    const yawDeg = (Math.atan2(dx, dz) * 180) / Math.PI;
    // 俯仰角 pitch
    const pitchDeg = (Math.atan2(dy, horizontalDist) * 180) / Math.PI;

    // 反算 CAMERA_CONFIG 格式
    const setup = setupRef.current;
    const scaledSize = setup?.scaledSize;
    const baseDistance = setup?.distance ?? 1;
    const distanceMul = baseDistance > 0 ? totalDist / baseDistance : 1;
    const heightMul = scaledSize && scaledSize.y > 0 ? camera.position.y / scaledSize.y : 0;
    const lookAtXMul = scaledSize && scaledSize.x > 0 ? target.x / scaledSize.x : 0;
    const lookAtYMul = scaledSize && scaledSize.y > 0 ? target.y / scaledSize.y : 0;
    const lookAtZMul = scaledSize && scaledSize.z > 0 ? target.z / scaledSize.z : 0;

    // 保存到 ref（供复制按钮使用）
    infoRef.current = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      yawDeg,
      pitchDeg,
      fov: (camera as THREE.PerspectiveCamera).fov,
      distance: distanceMul,
      height: heightMul,
      lookAtXMul,
      lookAtYMul,
      lookAtZMul,
    };

    // 更新 DOM（直接写入 textContent，避免 React 重渲染）
    const els = valueElsRef.current;
    if (els.x) els.x.textContent = camera.position.x.toFixed(3);
    if (els.y) els.y.textContent = camera.position.y.toFixed(3);
    if (els.z) els.z.textContent = camera.position.z.toFixed(3);
    if (els.yaw) els.yaw.textContent = `${yawDeg.toFixed(2)}°`;
    if (els.pitch) els.pitch.textContent = `${pitchDeg.toFixed(2)}°`;
    if (els.fov) els.fov.textContent = `${(camera as THREE.PerspectiveCamera).fov.toFixed(0)}°`;
    if (els.yawCfg) els.yawCfg.textContent = yawDeg.toFixed(2);
    if (els.pitchCfg) els.pitchCfg.textContent = pitchDeg.toFixed(2);
    if (els.heightCfg) els.heightCfg.textContent = heightMul.toFixed(3);
    if (els.distCfg) els.distCfg.textContent = distanceMul.toFixed(3);
    if (els.lookAtXCfg) els.lookAtXCfg.textContent = lookAtXMul.toFixed(3);
    if (els.lookAtYCfg) els.lookAtYCfg.textContent = lookAtYMul.toFixed(3);
    if (els.lookAtZCfg) els.lookAtZCfg.textContent = lookAtZMul.toFixed(3);
    if (els.fovCfg) els.fovCfg.textContent = (camera as THREE.PerspectiveCamera).fov.toFixed(0);
  });

  return (
    <>
      {/* OrbitControls：接管相机控制（必须在 Canvas 内）
       *  - showPanel=true（调试模式）：自由旋转、平移、缩放
       *  - showPanel=false（展示模式）：禁用平移与缩放，旋转限制在初始视角附近的小窗口内
       */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan={showPanel}
        enableZoom={showPanel}
        enableRotate={true}
        target={[lookAtX, lookAtY, lookAtZ]}
        minDistance={showPanel ? 0.5 : limits.minDistance}
        maxDistance={showPanel ? 500 : limits.maxDistance}
        minPolarAngle={showPanel ? 0 : limits.minPolar}
        maxPolarAngle={showPanel ? Math.PI : limits.maxPolar}
        minAzimuthAngle={showPanel ? -Infinity : limits.minAzimuth}
        maxAzimuthAngle={showPanel ? Infinity : limits.maxAzimuth}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: showPanel ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE,
          RIGHT: showPanel ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
        }}
      />
      {/* HTML 浮层通过 useEffect 手动挂到 document.body，不在此处渲染 */}
    </>
  );
}
