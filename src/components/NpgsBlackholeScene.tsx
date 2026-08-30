import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { NPGS_FRAG, NPGS_VERT } from '../blackholeNpgs/npgsEntry';

/**
 * NpgsBlackholeScene - 由 NPGS(物理级 Kerr-Newman)shader 渲染的黑洞场景
 *
 * 功能：
 *  - 全屏四边形 + 自定义 fragment shader（NPGS_FRAG，GLSL ES 3.00）
 *  - 每帧把 Three.js 相机矩阵换算为 shader 需要的 uniform：
 *      iInverseCamRot            世界系旋转（把相机系向量转到世界/黑洞系）
 *      iBlackHoleRelativePosRs   黑洞在相机系下的位置
 *      iBlackHoleRelativeDiskNormal/Tangen 盘法线/切线的相机系表示
 *  - 自动慢速环绕（auto 模式）或鼠标控制视角（orbit 模式，带阻尼）
 *
 * 参数：
 *  - mouseRef       鼠标像素坐标 ref（orbit 模式驱动视角偏移）
 *  - zoomProgressRef 滚动缩放进度 ref（0~1，拉远视角）
 *  - modeRef         当前视角模式 ref（'auto' | 'orbit'）
 *  - onModeChange    模式切换回调
 *  - skybox          背景立方体贴图（用于天空盒采样）
 *
 * 返回值：React.ReactElement（R3F 全屏 quad，需放入 <Canvas>）
 *
 * 异常：无
 *
 * 注意事项：
 *  - 该 shader 为每像素多步 RK4 质点积分，负载极高，
 *    建议 Canvas dpr 设 0.5 左右，否则帧率难以保证
 *  - iTime 每帧增长用于驱动吸积盘旋转与抖动抗锯齿
 *  - 吸积盘参数以 Rs(史瓦西半径)为单位的相对量传入
 */
interface NpgsBlackholeSceneProps {
  mouseRef?: React.MutableRefObject<{ x: number; y: number }>;
  zoomProgressRef?: React.MutableRefObject<number>;
  modeRef?: React.MutableRefObject<'auto' | 'orbit'>;
  onModeChange?: (mode: 'auto' | 'orbit') => void;
  skybox: THREE.CubeTexture;
}

export function NpgsBlackholeScene({
  mouseRef,
  zoomProgressRef,
  modeRef,
  onModeChange,
  skybox,
}: NpgsBlackholeSceneProps) {
  const { gl, camera } = useThree();

  // 世界系临时矩阵（复用对象避免每帧分配）
  const worldRot = useMemo(() => new THREE.Matrix4(), []);
  const tmpVec3 = useMemo(() => new THREE.Vector3(), []);
  const tmpVec3B = useMemo(() => new THREE.Vector3(), []);
  const bhWorldPos = useMemo(() => new THREE.Vector3(0, 0, 0), []);

  // 视角阻尼
  const orbitTheta = useRef(0); // 水平角
  const orbitPhi = useRef(0.12); // 俯仰角（轻微俯视，看到盘面）
  const autoRotateSpeed = 0.06;

  // 模式监听：orbit 模式下鼠标移动更新参考
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      if (!mouseRef) return;
      const w = el.width || 1;
      const h = el.height || 1;
      // 归一化到 [-0.5, 0.5]，并乘阻尼系数
      const nx = (e.clientX / w - 0.5) * 2.4;
      const ny = (e.clientY / h - 0.5) * 1.8;
      mouseRef.current.x = nx;
      mouseRef.current.y = ny;
    };
    // 左键点击切换视角模式（auto ↔ orbit）
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !modeRef) return;
      const next = modeRef.current === 'orbit' ? 'auto' : 'orbit';
      modeRef.current = next;
      onModeChange?.(next);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('mousedown', onDown);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('mousedown', onDown);
    };
  }, [gl, mouseRef, modeRef, onModeChange]);

  // material uniforms：仅包含 shader 实际用到的，其余在 useFrame 更新
  const material = useMemo(() => {
    const emptyTex = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      THREE.RGBAFormat
    );
    emptyTex.needsUpdate = true;

    const uniforms: Record<string, { value: unknown }> = {
      iResolution: { value: [1, 1] },
      iFovRadians: { value: (60 * Math.PI) / 180 },
      iTime: { value: 0 },
      iGameTime: { value: 0 },
      iTimeDelta: { value: 0.016 },
      iTimeRate: { value: 1.0 },
      // 相机
      iInverseCamRot: { value: new THREE.Matrix4() },
      iBlackHoleRelativePosRs: { value: new THREE.Vector4() },
      iBlackHoleRelativeDiskNormal: { value: new THREE.Vector4(0, 1, 0, 0) },
      iBlackHoleRelativeDiskTangen: { value: new THREE.Vector4(1, 0, 0, 0) },
      iCameraVelocity: { value: new THREE.Vector4(0, 0, 0, 0) },
      ie1_up: { value: new THREE.Vector4(1, 0, 0, 0) },
      ie2_up: { value: new THREE.Vector4(0, 1, 0, 0) },
      ie3_up: { value: new THREE.Vector4(0, 0, 1, 0) },
      iU_up: { value: new THREE.Vector4(0, 0, 0, 1) },
      // 观者与坐标系
      iCamDataCoordisOutgoing: { value: 1 },
      iDEBUG: { value: 0 },
      iPrepass: { value: 0 },
      iWhitehole: { value: 0 },
      iInWhichUniverse: { value: 0 },
      iGrid: { value: 0 },
      iEnableHeatHaze: { value: 0 },
      iEnableShadowCulling: { value: 1 },
      iObserverMode: { value: 0 },
      iPolarization: { value: 0 },
      iUseImageDisk: { value: 0 },
      iQuality: { value: 1.0 },
      iUniverseSign: { value: 1.0 },
      iBlackHoleTime: { value: 0 },
      // 天体物理参数
      iBlackHoleMassSol: { value: 4.6e6 },
      iSpin: { value: 0.6 },
      iQ: { value: 0.0 },
      iMu: { value: 1.0 },
      iAccretionRate: { value: 0.05 },
      iBackShiftMax: { value: 1.25 },
      iDensestarsurfaceR: { value: 0 },
      iDensestarBlackbodyIntensityExponent: { value: 0 },
      iDensestarRedShiftColorExponent: { value: 0 },
      iDensestarRedShiftIntensityExponent: { value: 0 },
      iDensestarBrightmut: { value: 0 },
      // 吸积盘几何（单位 Rs）
      iInterRadiusRs: { value: 3.0 },
      iOuterRadiusRs: { value: 24.0 },
      iThinRs: { value: 0.3 },
      iHopper: { value: 0.0 },
      // 吸积盘亮度/颜色
      iBrightmut: { value: 1.0 },
      iDarkmut: { value: 1.0 },
      iReddening: { value: 0.0 },
      iSaturation: { value: 1.0 },
      iBlackbodyIntensityExponent: { value: 1.2 },
      iRedShiftColorExponent: { value: 0.9 },
      iRedShiftIntensityExponent: { value: 2.6 },
      iImageRotationSpeed: { value: 0.0 },
      iPolarizationAngle: { value: 0.0 },
      iHeatHaze: { value: 0.0 },
      iBackgroundBrightmut: { value: 1.0 },
      iPhotonRingBoost: { value: 0.0 },
      iPhotonRingColorTempBoost: { value: 0.0 },
      iBoostRot: { value: 0.0 },
      // 喷流
      iJetRedShiftIntensityExponent: { value: 0.0 },
      iJetBrightmut: { value: 0.0 },
      iJetSaturation: { value: 0.0 },
      iJetShiftMax: { value: 0.0 },
      iBlendWeight: { value: 1.0 },
      // 纹理
      iHistoryTex: { value: emptyTex },
      iBackground0: { value: skybox },
      iAntiground0: { value: skybox },
      iBackground1: { value: skybox },
      iAntiground1: { value: skybox },
      iBackground2: { value: skybox },
      iAntiground2: { value: skybox },
      iImageTexture: { value: emptyTex },
    };

    // RawShaderMaterial：Three.js 不注入 #version/attribute 前缀，需要 shader 自带完整声明
    const mat = new THREE.RawShaderMaterial({
      vertexShader: NPGS_VERT,
      fragmentShader: NPGS_FRAG,
      uniforms,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
    });
    return mat;
  }, [skybox]);

  // 每帧更新 uniform：时间、相机矩阵、视角环绕
  useFrame((state, delta) => {
    const u = material.uniforms;
    const t = state.clock.elapsedTime;
    u.iTime.value = t;
    u.iBlackHoleTime.value = t;
    u.iTimeDelta.value = delta;

    // 视角模式：auto 缓慢环绕；orbit 用鼠标偏移（带低通阻尼）
    const mode = modeRef?.current ?? 'auto';
    let theta: number;
    let phi: number;
    if (mode === 'auto') {
      theta = t * autoRotateSpeed;
      // 缓慢的俯仰摆动，展示盘面
      phi = 0.12 + 0.08 * Math.sin(t * 0.11);
    } else {
      const targetTheta = (mouseRef?.current.x ?? 0) * 0.8;
      const targetPhi = 0.12 + (mouseRef?.current.y ?? 0) * -0.35;
      // 低通滤波：阻尼系数 0.05，太跟手会发飘，太慢会发木
      orbitTheta.current += (targetTheta - orbitTheta.current) * 0.05;
      orbitPhi.current += (targetPhi - orbitPhi.current) * 0.05;
      theta = orbitTheta.current;
      phi = orbitPhi.current;
    }

    // 视角半径（单位 Rs）：滚轮向下 zoomProgress 增大 → 拉远
    const zoom = Math.max(0, Math.min(1, zoomProgressRef?.current ?? 0));
    const radius = 42.0 + 90.0 * zoom; // 42~132 Rs

    // 相机位置（围绕黑洞原点环绕）
    camera.position.set(
      radius * Math.cos(phi) * Math.cos(theta),
      radius * Math.sin(phi),
      radius * Math.cos(phi) * Math.sin(theta)
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    // === 换算 shader uniform ===
    // 1. 世界系旋转 = camera.matrixWorld 的旋转部分
    worldRot.makeRotationFromQuaternion(camera.quaternion);

    // 2. 黑洞在相机系位置 = worldPos(0,0,0) 经相机矩阵逆变换
    tmpVec3.copy(bhWorldPos).applyMatrix4(camera.matrixWorldInverse);
    (u.iBlackHoleRelativePosRs.value as THREE.Vector4).set(
      tmpVec3.x,
      tmpVec3.y,
      tmpVec3.z,
      1.0
    );

    // 3. 盘法线/切线：shader 内会再乘 iInverseCamRot 转回世界系，
    //    因此这里应传相机系表示 = 世界系 (0,1,0)/(1,0,0) 经 matrixWorldInverse 旋转
    tmpVec3B.set(0, 1, 0).applyMatrix4(camera.matrixWorldInverse);
    (u.iBlackHoleRelativeDiskNormal.value as THREE.Vector4).set(
      tmpVec3B.x,
      tmpVec3B.y,
      tmpVec3B.z,
      0.0
    );
    tmpVec3B.set(1, 0, 0).applyMatrix4(camera.matrixWorldInverse);
    (u.iBlackHoleRelativeDiskTangen.value as THREE.Vector4).set(
      tmpVec3B.x,
      tmpVec3B.y,
      tmpVec3B.z,
      0.0
    );

    // 4. iInverseCamRot = 相机世界旋转矩阵
    (u.iInverseCamRot.value as THREE.Matrix4).copy(worldRot);

    // 5. 分辨率（使用实际渲染缓冲大小）
    (u.iResolution.value as number[])[0] = gl.domElement.width;
    (u.iResolution.value as number[])[1] = gl.domElement.height;
  });

  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}