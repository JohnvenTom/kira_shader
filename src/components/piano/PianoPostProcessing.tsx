import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  PIANO_GRADE_SHADER,
  PIANO_STYLES,
  type PianoStyleName,
} from './pianoGrade';

/** Grade 数值 uniform ↔ 预设字段映射（阻尼渐变循环用） */
const GRADE_UNIFORM_KEYS = {
  uGrain: 'grain',
  uVig: 'vig',
  uCA: 'ca',
  uHal: 'hal',
  uSat: 'sat',
  uSplit: 'split',
  uToon: 'toon',
  uLevels: 'levels',
  uFlat: 'flat',
  uInk: 'ink',
  uInkWidth: 'inkWidth',
  uDof: 'dof',
  uDofMax: 'dofMax',
  uEdge: 'edge',
} as const;

/**
 * 钢琴页风格化后处理（影棚 / 暗房 / 动画）
 *
 * 功能：
 *  - 在 Canvas 内创建 EffectComposer：RenderPass → OutputPass → PianoGrade(renderToScreen)
 *  - 渲染目标带 MSAA + 深度纹理（磁带页同款方案）：三渲二墨线依赖深度，
 *    细琴键依赖 4x MSAA；两个 render target 指向同一张深度纹理，
 *    避免"隔帧深度"造成的边缘闪烁（详见磁带页 post.js 的注释）
 *  - 每帧把 Grade uniforms 与程序化背景色板朝当前风格预设做指数阻尼，
 *    切换风格时整套观感一起渐变（对应磁带页 setTheme 的房间渐变）
 *  - useFrame renderPriority=1 接管 R3F 默认渲染
 *
 * 参数：
 *  - styleName: PianoStyleName，当前风格（变化不触发重建，逐帧阻尼逼近）
 *
 * 返回值：null（纯逻辑组件，不渲染 DOM）
 *
 * 异常：无
 *
 * 注意事项：
 *  - 必须放在 PianoDetailPage 的 Canvas 内部
 *  - 输出为不透明整帧：3D 画面按 alpha 合成到 shader 内的程序化背景上，
 *    因此暗角/颗粒作用于整帧（CSS .piano-backdrop 保留作加载期兜底）
 */
export function PianoPostProcessing({ styleName }: { styleName: PianoStyleName }) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const gradeRef = useRef<ShaderPass | null>(null);
  // 风格名的 ref 版本（帧循环里读取，避免闭包旧值）
  const styleRef = useRef<PianoStyleName>(styleName);
  styleRef.current = styleName;
  // 阻尼用的临时色（避免每帧分配）
  const tmpColor = useMemo(() => new THREE.Color(), []);

  // 创建 EffectComposer + 深度纹理 + 通道链（只在 gl/scene/camera 变化时重建）
  useMemo(() => {
    const dbSize = gl.getDrawingBufferSize(new THREE.Vector2());
    // MSAA + 深度纹理：磁带页同款配置（samples=4 抗锯齿 + resolve 深度直读）
    const depthTexture = new THREE.DepthTexture(dbSize.x, dbSize.y);
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    depthTexture.type = THREE.UnsignedIntType;
    const rt = new THREE.WebGLRenderTarget(dbSize.x, dbSize.y, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      samples: 4,
      depthBuffer: true,
      depthTexture,
      resolveDepthBuffer: true,
    });
    const composer = new EffectComposer(gl, rt);
    // RenderPass 每帧在两个 target 间交替，clone 会带走一张克隆深度纹理 →
    // 隔帧拿到上一帧深度，墨线边缘半频闪烁。两个 target 指向同一张深度即可
    // （磁带页 post.js 有完整注释）
    composer.renderTarget2.depthTexture = depthTexture;
    composer.addPass(new RenderPass(scene, camera));
    // OutputPass：线性 HalfFloat → ACES 色调映射 + sRGB（Grade 在显示空间工作）。
    // 必须禁用其深度写入：rt1/rt2 共享一张深度纹理，全屏 quad 默认会把深度
    // 写成近平面值(0)，Grade 的景深/墨线深度读数会全部失效
    const output = new OutputPass();
    output.material.depthWrite = false;
    output.material.depthTest = false;
    composer.addPass(output);
    const grade = new ShaderPass(PIANO_GRADE_SHADER);
    grade.renderToScreen = true;
    grade.uniforms.tDepth.value = depthTexture;
    composer.addPass(grade);
    composerRef.current = composer;
    gradeRef.current = grade;
    // 注意：styleName 不进依赖 —— 风格切换走逐帧阻尼，不重建管线
  }, [gl, scene, camera]);

  // 尺寸同步：composer 两个 target + 深度纹理一起缩放，texel/aspect 跟随
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.setSize(size.width, size.height);
    const db = gl.getDrawingBufferSize(new THREE.Vector2());
    const u = gradeRef.current?.uniforms;
    if (u) {
      u.uTexel.value.set(1 / db.x, 1 / db.y);
      u.uAspect.value = size.width / size.height;
    }
  }, [size, gl]);

  // 卸载时释放渲染管线资源
  useEffect(() => {
    return () => {
      composerRef.current?.dispose();
      composerRef.current = null;
      gradeRef.current = null;
    };
  }, []);

  // 每帧：uniforms 朝当前风格预设阻尼 → 渲染（renderPriority=1 接管默认渲染）
  useFrame((_, delta) => {
    const composer = composerRef.current;
    const grade = gradeRef.current;
    if (!composer || !grade) return;
    const dt = Math.min(0.05, Math.max(delta, 0.0001));
    const k = 1 - Math.exp(-dt * 5.0);
    const S = PIANO_STYLES[styleRef.current];
    const u = grade.uniforms;

    // 数值型 grade 参数
    for (const [uni, key] of Object.entries(GRADE_UNIFORM_KEYS)) {
      const cur = u[uni].value as number;
      u[uni].value = cur + (S.grade[key] - cur) * k;
    }
    // 背景色板 + 聚光（display space 原始 sRGB 分量）
    u.uBgTop.value.lerp(tmpColor.setRGB(S.bgTop[0], S.bgTop[1], S.bgTop[2]), k);
    u.uBgMid.value.lerp(tmpColor.setRGB(S.bgMid[0], S.bgMid[1], S.bgMid[2]), k);
    u.uBgFloor.value.lerp(tmpColor.setRGB(S.bgFloor[0], S.bgFloor[1], S.bgFloor[2]), k);
    u.uSpotColor.value.lerp(tmpColor.setRGB(S.spotColor[0], S.spotColor[1], S.spotColor[2]), k);
    u.uSpot.value.lerp(tmpVec2.set(S.spotPos[0], S.spotPos[1]), k);
    u.uSpotRadius.value += (S.spotRadius - (u.uSpotRadius.value as number)) * k;
    u.uSpotStrength.value += (S.spotStrength - (u.uSpotStrength.value as number)) * k;

    // 三渲二墨线需要当前帧投影逆矩阵（视空间重建）
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    // 景深焦点：相机到钢琴中心的距离,阻尼逼近形成"焦点呼吸"
    const kf = 1 - Math.exp(-dt * 9.0);
    const focusTarget = camera.position.distanceTo(FOCUS_POINT);
    u.uFocusDist.value += (focusTarget - (u.uFocusDist.value as number)) * kf;
    u.uTime.value += delta;

    // 重置后渲染：info 累计整条链（场景+全屏 quad），PianoScene 的统计
    // 在下一帧读到的就是场景真实三角面数而非最后一个 pass 的 2 个
    gl.info.reset();
    composer.render();
  }, 1);

  return null;
}

// uSpot 阻尼用（模块级临时向量，避免每帧分配）
const tmpVec2 = new THREE.Vector2();
// 景深焦点目标：钢琴中心（世界坐标）
const FOCUS_POINT = new THREE.Vector3(0, 0.9, -0.6);
