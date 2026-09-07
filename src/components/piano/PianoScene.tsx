/**
 * PianoScene.tsx —— 纯白三角钢琴 3D 场景（R3F 版）
 *
 * 功能：
 *  - 程序化搭建白色摄影棚环境（PMREM 环境贴图 + 三点布光 + 地面接地阴影）
 *  - 构建钢琴模型并驱动琴键 / 弦槌 / 制音器 / 踏板 / 琴盖动画
 *  - 苹果产品页风格的镜头运动：滚动进度驱动相机沿球坐标关键帧
 *    弧线运镜（远景剪影 → 侧面滑过 → 升高俯视琴弦 → 贴近琴键 → 演奏位），
 *    琴盖与键盘盖随镜头推进自动开启
 *  - 镜头旅程结束后进入自由交互：轨道相机拖动 / 点击琴键弹奏 / 滑奏 /
 *    电脑键盘弹奏 / 踏板 / 演示曲《致爱丽丝》
 *  - 通过 apiRef 向外层 UI 暴露命令式接口（视角切换/琴盖/键盘盖/自动旋转/
 *    半音键对比/演示曲/重置/音量/混响/踏板）
 *
 * 参数：见 PianoSceneProps
 * 返回值：React.ReactElement
 * 异常：无
 *
 * 注意事项：
 *  - 相机路径在球坐标（theta/phi/radius/target）空间插值，与自由轨道控制器
 *    共用同一套坐标系，镜头旅程结束时可无缝交接给用户控制
 *  - 旅程期间（progress < 1）琴盖/键盘盖由滚动进度驱动，覆盖用户手动状态
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { buildPiano, NOTE_NAMES, type PianoModel } from './pianoModel';
import { PianoAudio } from './pianoAudio';
import { createOrbit, type OrbitController } from './pianoOrbit';

/** 视角预设（与原项目一致的六个机位） */
export const PIANO_VIEWS: Record<string, { theta: number; phi: number; radius: number; target: THREE.Vector3 }> = {
  front: { theta: 0.0, phi: 1.00, radius: 3.95, target: new THREE.Vector3(0, 0.88, -0.62) },
  player: { theta: 0.0, phi: 0.72, radius: 1.62, target: new THREE.Vector3(0, 0.76, -0.12) },
  top: { theta: 0.22, phi: 0.21, radius: 5.00, target: new THREE.Vector3(0, 0.80, -1.18) },
  side: { theta: 1.45, phi: 0.96, radius: 4.05, target: new THREE.Vector3(0, 0.88, -0.85) },
  tail: { theta: 3.05, phi: 0.90, radius: 3.85, target: new THREE.Vector3(0, 0.92, -1.15) },
  detail: { theta: 0.50, phi: 0.80, radius: 1.10, target: new THREE.Vector3(-0.08, 0.76, -0.16) },
};

/**
 * 苹果风镜头旅程关键帧（球坐标 + FOV）
 *
 * 功能：定义 5 个运镜节点，滚动进度 0→1 依次经过：
 *   K0 低角度远景剪影（琴盖合上）→ K1 侧面弧线滑过 →
 *   K2 升高俯视琴弦（琴盖开启）→ K3 下降贴近琴键（键盘盖开启）→
 *   K4 演奏位（与 PIANO_VIEWS.player 一致）
 */
const CAM_KEYS = [
  { t: 0.0,  theta: 2.75, phi: 1.26, radius: 5.4, target: new THREE.Vector3(0, 0.92, -0.90), fov: 33 },
  { t: 0.24, theta: 1.50, phi: 1.02, radius: 3.9, target: new THREE.Vector3(0, 0.88, -0.85), fov: 35 },
  { t: 0.50, theta: 0.60, phi: 0.34, radius: 5.0, target: new THREE.Vector3(0, 0.78, -1.05), fov: 40 },
  { t: 0.76, theta: 0.35, phi: 1.06, radius: 2.4, target: new THREE.Vector3(0, 0.76, -0.32), fov: 33 },
  { t: 1.0,  theta: 0.0,  phi: 0.72, radius: 1.62, target: new THREE.Vector3(0, 0.76, -0.12), fov: 38 },
];

/** UI 快照（按钮文案与开关状态，供外层面板渲染） */
export interface PianoUiSnapshot {
  lidLabel: string;
  fallLabel: string;
  rotateLabel: string;
  contrastLabel: string;
  demoPlaying: boolean;
}

/** 命令式 API（外层 UI 调用） */
export interface PianoApi {
  setView(name: keyof typeof PIANO_VIEWS): void;
  cycleLid(): void;
  toggleFallboard(): void;
  toggleRotate(): void;
  toggleContrast(): void;
  toggleDemo(): void;
  reset(): void;
  setVolume(v: number): void;
  setReverb(v: number): void;
  pedalDown(idx: number): void;
  pedalUp(idx: number): void;
  /** 轨道相机是否已拉到最远（用于详情页"缩放到最远后继续上滑退出"判断） */
  isZoomedOut(): boolean;
}

export interface PianoSceneProps {
  /** 镜头旅程滚动进度（0~1，ref 每帧读取） */
  scrollProgressRef: React.MutableRefObject<number>;
  /** 详情页是否打开（打开时才响应电脑键盘） */
  detailOpen: boolean;
  /** 命令式 API 写入目标（mount 时填充） */
  apiRef: React.MutableRefObject<PianoApi | null>;
  /** UI 状态变化回调（按钮文案等） */
  onUiStateChange?: (s: PianoUiSnapshot) => void;
  /** 交互模式变化回调（镜头旅程结束 = true，面板淡入） */
  onInteractiveChange?: (v: boolean) => void;
  /** 音符显示元素（弹奏时更新文字与透明度） */
  noteElRef: React.RefObject<HTMLDivElement>;
  /** FPS/三角面统计元素 */
  statElRef: React.RefObject<HTMLDivElement>;
  /** 操作提示元素（首次弹奏后淡出） */
  hintElRef: React.RefObject<HTMLDivElement>;
  /** toast 提示元素（八度切换等） */
  toastElRef: React.RefObject<HTMLDivElement>;
}

/** 白键最大按压角（弧度） */
const MAX_KEY_ANGLE = 0.0465;
/** 弦槌击弦上扬角 */
const HAMMER_STRIKE = 0.44;
/** 琴盖全开角度（弧度，约 46°） */
const LID_FULL = 0.80;

/* ---------------- 电脑键盘 → 半音偏移映射（与原项目一致） ---------------- */
const KEYMAP: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7,
  KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19,
  Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
};

/* ---------------- 演示曲《致爱丽丝》数据（与原项目一致） ---------------- */
const NOTE_BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 音名（如 'E5'）转 midi 音符号 */
function nm(s: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(s);
  if (!m) return 60;
  let v = NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return v + (parseInt(m[3], 10) + 1) * 12;
}
/** midi 音符号转音名（如 'A4'） */
function noteName(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

const THEME: [string, number][] = [
  ['E5', 1], ['D#5', 1], ['E5', 1], ['D#5', 1], ['E5', 1], ['B4', 1], ['D5', 1], ['C5', 1],
  ['A4', 3], ['C4', 1], ['E4', 1], ['A4', 1],
  ['B4', 3], ['E4', 1], ['G#4', 1], ['B4', 1],
  ['C5', 3], ['E4', 1],
];
const CODA: [string, number][] = [
  ['E5', 1], ['D#5', 1], ['E5', 1], ['D#5', 1], ['E5', 1], ['B4', 1], ['D5', 1], ['C5', 1],
  ['A4', 3], ['C4', 1], ['E4', 1], ['A4', 1],
  ['B4', 3], ['E4', 1], ['C5', 1], ['B4', 1],
  ['A4', 6],
];
const BASS_BLOCK: [string | null, number][] = [
  [null, 8], ['A2', 1], ['E3', 1], ['A3', 1], [null, 3],
  ['E2', 1], ['E3', 1], ['G#3', 1], [null, 3],
  ['A2', 1], ['E3', 1], ['A3', 1], [null, 1],
];
const UNIT = 0.188;

/** 演示曲事件 */
interface DemoEvent {
  t: number;
  type: 'on' | 'off' | 'pedal';
  midi?: number;
  vel?: number;
  on?: boolean;
}

/**
 * 构建演示曲事件序列（旋律 + 低音 + 结尾和弦 + 踏板）
 *
 * 参数：无
 * 返回值：{{events: DemoEvent[], duration: number}} 排序后的事件表与总时长
 */
function buildDemo(): { events: DemoEvent[]; duration: number } {
  const ev: DemoEvent[] = [];
  const mel = THEME.concat(CODA);
  let t = 0;
  mel.forEach((n) => {
    const midi = nm(n[0]);
    const dur = n[1] * UNIT;
    ev.push({ t, type: 'on', midi, vel: 0.62 + Math.random() * 0.16 });
    ev.push({ t: t + dur * 0.94, type: 'off', midi });
    t += dur;
  });
  const total = t;
  t = 0;
  const bass = BASS_BLOCK.concat(BASS_BLOCK);
  bass.forEach((n) => {
    const dur = n[1] * UNIT;
    if (n[0]) {
      const midi = nm(n[0]);
      ev.push({ t, type: 'on', midi, vel: 0.42 + Math.random() * 0.1 });
      ev.push({ t: t + dur * 2.4, type: 'off', midi });
    }
    t += dur;
  });
  // 结尾的 A 小三和弦
  ['A2', 'E3', 'A3'].forEach((n, i) => {
    const tt = total - UNIT * 6 + i * UNIT;
    ev.push({ t: tt, type: 'on', midi: nm(n), vel: 0.44 });
    ev.push({ t: tt + UNIT * 6, type: 'off', midi: nm(n) });
  });
  // 踏板：每个左手琶音处踩下
  [[8, 11.6], [14, 17.6], [20, 23.6], [32, 35.6], [38, 41.6], [44, 47.6], [47.5, 54]].forEach((p) => {
    ev.push({ t: p[0] * UNIT, type: 'pedal', on: true });
    ev.push({ t: p[1] * UNIT, type: 'pedal', on: false });
  });
  ev.sort((a, b) => a.t - b.t);
  return { events: ev, duration: total + 2.4 };
}

/** smootherstep 平滑（苹果式缓动，节点处速度为零） */
function smootherstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 普通平滑区间映射 */
function smoothstep01(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * PianoScene - 钢琴 3D 场景组件
 *
 * 参数：见 PianoSceneProps 定义
 * 返回值：React.ReactElement（R3F 场景内容）
 * 异常：无
 */
export function PianoScene({
  scrollProgressRef,
  detailOpen,
  apiRef,
  onUiStateChange,
  onInteractiveChange,
  noteElRef,
  statElRef,
  hintElRef,
  toastElRef,
}: PianoSceneProps) {
  const { camera, gl, scene } = useThree();
  const cam = camera as THREE.PerspectiveCamera;

  /* ---------------- 内部状态（ref，避免每帧重渲染） ---------------- */
  const stateRef = useRef({
    lid: 0, lidT: 1,            // 0 关 / 1 全开（0.52 半开）
    fall: 1, fallT: 1,          // 键盘盖 0 关 / 1 开
    desk: 1, deskT: 1,
    pedal: [0, 0, 0], pedalT: [0, 0, 0],
    sustain: false,
    contrast: false,
    demo: null as null | { events: DemoEvent[]; duration: number; i: number; t0: number; active: number[] },
    fps: 60, frames: 0, fpsTime: 0,
    interactive: false,
  });
  /* ---------------- 钢琴模型（一次性构建） ---------------- */
  const piano = useMemo(() => buildPiano(), []);

  const keyByMidi = useMemo(() => {
    const m = new Map<number, PianoModel['keys'][number]>();
    piano.keys.forEach((k) => m.set(k.midi, k));
    return m;
  }, [piano]);

  /* ---------------- 轨道控制器 ---------------- */
  const controlsRef = useRef<OrbitController | null>(null);
  useEffect(() => {
    const dom = gl.domElement;
    const controls = createOrbit(cam, dom);
    controls.enabled = false;    // 旅程期间锁定，镜头结束后启用
    controls.setView({ theta: CAM_KEYS[0].theta, phi: CAM_KEYS[0].phi, radius: CAM_KEYS[0].radius, target: CAM_KEYS[0].target }, true);
    controlsRef.current = controls;
    return () => {
      controls.dispose();
      controlsRef.current = null;
    };
  }, [gl, cam]);

  /* ---------------- 环境贴图（白色摄影棚 PMREM） ---------------- */
  useEffect(() => {
    const envScene = new THREE.Scene();
    const panel = (w: number, h: number, color: THREE.Color, pos: [number, number, number], rot?: [number, number, number]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      m.material.color.copy(color);
      m.position.set(pos[0], pos[1], pos[2]);
      if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      envScene.add(m);
      return m;
    };
    const C = (v: number) => new THREE.Color(v, v, v);
    // 房间六面整体压暗，只留顶部与右上柔光箱明亮：
    // 白漆表面才会出现明确的明暗过渡，而不是被均匀白光糊成一片
    panel(30, 30, C(0.20), [0, 0, -12], [0, 0, 0]);
    panel(30, 30, C(0.15), [0, 0, 12], [0, Math.PI, 0]);
    panel(24, 24, C(0.09), [-12, 0, 0], [0, Math.PI / 2, 0]);
    panel(24, 24, C(0.26), [12, 0, 0], [0, -Math.PI / 2, 0]);
    panel(30, 30, C(0.12), [0, -6, 0], [-Math.PI / 2, 0, 0]);
    panel(30, 30, C(0.60), [0, 9, 0], [Math.PI / 2, 0, 0]);
    // 主柔光箱 + 侧光 + 顶部长条灯（HDR 亮度 > 1）
    panel(9, 6, C(5.4), [3.5, 6.2, 2.2], [Math.PI / 2 - 0.35, 0, 0]);
    panel(6, 5, C(1.3), [-7, 3.4, 1.5], [0, Math.PI / 2, 0]);
    panel(14, 1.1, C(3.4), [0, 7.4, -3.2], [Math.PI / 2, 0, 0]);
    panel(3.4, 3.4, C(1.0), [1.0, 1.2, 7.5], [0, Math.PI, 0]);

    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromScene(envScene, 0.025);
    scene.environment = rt.texture;
    pmrem.dispose();
    envScene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) (mesh.material as THREE.Material).dispose();
    });
    return () => {
      rt.texture.dispose();
      scene.environment = null;
    };
  }, [gl, scene]);

  /* ---------------- 渲染器 / 雾 ---------------- */
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 0.95;
    gl.setClearAlpha(0);
    scene.fog = new THREE.Fog(0xe9ecf1, 7.0, 20);
    return () => {
      scene.fog = null;
    };
  }, [gl, scene]);

  /* ---------------- 地面 + 接地阴影 ---------------- */
  const groundGroup = useMemo(() => {
    const group = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xdfe3ea, roughness: 0.44, metalness: 0.0,
      clearcoat: 0.30, clearcoatRoughness: 0.45, envMapIntensity: 0.45,
    });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(16, 72), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    // 接地柔影贴片（让纯白琴体与浅色地面之间有明确的"落地感"）
    const tex = makeContactShadowTexture();
    const add = (x: number, z: number, sx: number, sz: number, op: number) => {
      const blobMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: op, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), blobMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.0015, z);
      m.renderOrder = 1;
      group.add(m);
    };
    add(0.02, -1.02, 3.1, 4.1, 0.60);
    add(0, -0.17, 1.95, 0.95, 0.52);
    add(-0.655, -0.215, 0.52, 0.52, 0.75);
    add(0.655, -0.215, 0.52, 0.52, 0.75);
    add(-0.045, -1.90, 0.52, 0.52, 0.75);
    add(0, -0.12, 0.62, 0.50, 0.45);
    return group;
  }, []);

  /* ---------------- DOM 小工具（音符显示 / toast / 提示淡出） ---------------- */
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hintDoneRef = useRef(false);
  const showNote = (name: string, vel: number) => {
    const el = noteElRef.current;
    if (!el) return;
    el.textContent = name;
    el.style.opacity = String(0.55 + vel * 0.45);
    el.classList.add('pop');
    clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => el.classList.remove('pop'), 140);
  };
  const flashHint = () => {
    if (hintDoneRef.current) return;
    hintDoneRef.current = true;
    const h = hintElRef.current;
    if (h) h.classList.add('fade');
  };
  const toast = (msg: string) => {
    const el = toastElRef.current;
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => el.classList.remove('show'), 1400);
  };

  /* ---------------- 琴键 / 弦槌 / 制音器 ---------------- */
  const pressKey = (midi: number, vel: number, fromUser?: boolean) => {
    const k = keyByMidi.get(midi);
    if (!k) return;
    k.target = 1;
    k.held = true;
    const h = piano.hammers.info[midi - 21];
    if (h) { h.t = 0; h.active = true; h.power = Math.max(0.35, Math.min(1, vel)); }
    PianoAudio.noteOn(midi, vel);
    showNote(k.name, vel);
    if (fromUser) flashHint();
  };
  const releaseKey = (midi: number) => {
    const k = keyByMidi.get(midi);
    if (!k) return;
    k.target = 0;
    k.held = false;
    PianoAudio.noteOff(midi);
  };

  /* ---------------- 开合动作 ---------------- */
  const IDENT_Q = new THREE.Quaternion();
  const ONE_V = new THREE.Vector3(1, 1, 1);
  const applyLid = (v: number, instant?: boolean) => {
    stateRef.current.lidT = v;
    if (instant) stateRef.current.lid = v;
  };
  const applyFallboard = (v: number, instant?: boolean) => {
    stateRef.current.fallT = v; stateRef.current.deskT = v;
    if (instant) { stateRef.current.fall = v; stateRef.current.desk = v; }
  };

  /**
   * 每帧更新琴盖 / 键盘盖 / 谱架 / 支撑杆
   *
   * 参数：
   *  - dt {number} 帧间隔（秒）
   */
  const updateOpenables = (dt: number) => {
    const st = stateRef.current;
    const k = 1 - Math.exp(-3.2 * dt);
    st.lid += (st.lidT - st.lid) * k;
    st.fall += (st.fallT - st.fall) * k;
    st.desk += (st.deskT - st.desk) * k;

    const p = piano.parts;
    const lidAngle = st.lid * LID_FULL;
    p.lid.rotation.z = lidAngle;
    // 前折：琴盖开启前先翻折到主盖背上
    const fold = Math.min(1, st.lid / 0.42);
    p.frontLid.rotation.x = -Math.PI * fold;

    // 键盘盖（两折）与谱架
    p.fallboard.rotation.x = -Math.PI * st.fall;
    p.fallboardFold.rotation.x = Math.PI * st.fall;
    p.desk.rotation.x = 1.40 - 1.72 * st.desk;

    // 支撑杆：在侧板插座与琴盖内侧之间求解位置
    const st2 = p.stick;
    if (st.lid > 0.08) {
      st2.group.visible = true;
      const a = p.stickAnchorCase.clone();
      const b = p.lid.localToWorld(p.stickAnchorLid.clone());
      st2.rod.matrixAutoUpdate = false;
      st2.foot.matrixAutoUpdate = false;
      piano.cylBetween(st2.rod.matrix, a, b, 1);
      st2.foot.matrix.compose(a, IDENT_Q, ONE_V);
    } else {
      st2.group.visible = false;
    }
  };

  /**
   * 每帧更新琴键 / 弦槌 / 制音器 / 踏板动画
   *
   * 参数：
   *  - dt {number} 帧间隔（秒）
   */
  const updateKeys = (dt: number) => {
    const st = stateRef.current;
    const kk = 1 - Math.exp(-26 * dt);
    const ku = 1 - Math.exp(-15 * dt);
    piano.keys.forEach((k) => {
      const t = k.target;
      k.angle += (t - k.angle) * (t > k.angle ? kk : ku);
      k.mesh.rotation.x = k.angle * MAX_KEY_ANGLE;
    });

    // 弦槌：击弦上扬 + 回落
    let dirty = false;
    const info = piano.hammers.info;
    for (let i = 0; i < info.length; i++) {
      const h = info[i];
      if (!h.active) {
        if (h.angle > 0.0002) { h.angle *= Math.exp(-14 * dt); dirty = true; }
        else if (h.angle !== 0) { h.angle = 0; dirty = true; }
        continue;
      }
      h.t += dt;
      const rise = 0.062, fall = 0.11;
      if (h.t < rise) h.angle = HAMMER_STRIKE * h.power * Math.sin((h.t / rise) * Math.PI / 2);
      else {
        const u = (h.t - rise) / fall;
        h.angle = HAMMER_STRIKE * h.power * Math.max(0, Math.cos(Math.min(1, u) * Math.PI / 2));
        if (h.t > rise + fall) { h.active = false; h.angle = 0; }
      }
      dirty = true;
    }
    if (dirty) piano.hammers.write();

    // 制音器：按键或延音踏板时抬起
    let dDirty = false;
    const dinfo = piano.dampers.info;
    for (let i = 0; i < dinfo.length; i++) {
      const d = dinfo[i];
      const key = keyByMidi.get(21 + i);
      const want = (st.sustain || (key && key.held)) ? 0.017 : 0;
      if (Math.abs(d.lift - want) > 0.00005) {
        d.lift += (want - d.lift) * (1 - Math.exp(-18 * dt));
        dDirty = true;
      }
    }
    if (dDirty) piano.dampers.write();

    // 踏板
    const pk = 1 - Math.exp(-18 * dt);
    piano.parts.pedals.forEach((p, i) => {
      st.pedal[i] += (st.pedalT[i] - st.pedal[i]) * pk;
      p.pivot.rotation.x = -0.085 * st.pedal[i];
    });
  };

  /* ---------------- 演示曲 ---------------- */
  const startDemo = () => {
    stopDemo();
    PianoAudio.init();
    const d = buildDemo();
    stateRef.current.demo = { ...d, i: 0, t0: performance.now() / 1000, active: [] };
    if (stateRef.current.fallT < 1) applyFallboard(1);
    if (stateRef.current.lidT < 0.5) applyLid(1);
    notifyUi();
  };
  const stopDemo = () => {
    const d = stateRef.current.demo;
    if (!d) return;
    d.active.forEach((m) => releaseKey(m));
    stateRef.current.demo = null;
    setSustain(false);
    notifyUi();
  };
  const updateDemo = () => {
    const d = stateRef.current.demo;
    if (!d) return;
    const now = performance.now() / 1000 - d.t0;
    while (d.i < d.events.length && d.events[d.i].t <= now) {
      const e = d.events[d.i++];
      if (e.type === 'on' && e.midi !== undefined) { pressKey(e.midi, e.vel ?? 0.8); d.active.push(e.midi); }
      else if (e.type === 'off' && e.midi !== undefined) {
        releaseKey(e.midi);
        const idx = d.active.indexOf(e.midi);
        if (idx >= 0) d.active.splice(idx, 1);
      } else if (e.type === 'pedal') setSustain(!!e.on);
    }
    if (now > d.duration) { stopDemo(); }
  };

  /* ---------------- 踏板 / 延音 ---------------- */
  const setSustain = (on: boolean) => {
    stateRef.current.sustain = on;
    stateRef.current.pedalT[2] = on ? 1 : 0;
    PianoAudio.setSustain(on);
  };

  /* ---------------- UI 状态通知 ---------------- */
  const notifyUi = () => {
    const st = stateRef.current;
    onUiStateChange?.({
      lidLabel: st.lidT > 0.75 ? '琴盖：全开' : st.lidT > 0.1 ? '琴盖：半开' : '琴盖：关闭',
      fallLabel: st.fallT > 0.5 ? '键盘盖：打开' : '键盘盖：合上',
      rotateLabel: controlsRef.current?.autoRotate ? '自动旋转：开' : '自动旋转：关',
      contrastLabel: st.contrast ? '半音键：浅灰' : '半音键：纯白',
      demoPlaying: !!st.demo,
    });
  };

  /* ---------------- 命令式 API（供外层 UI 调用） ---------------- */
  useEffect(() => {
    const api: PianoApi = {
      setView(name) {
        controlsRef.current?.setView(PIANO_VIEWS[name]);
      },
      cycleLid() {
        const st = stateRef.current;
        const next = st.lidT > 0.75 ? 0.52 : st.lidT > 0.1 ? 0 : 1;
        applyLid(next);
        notifyUi();
      },
      toggleFallboard() {
        const st = stateRef.current;
        applyFallboard(st.fallT > 0.5 ? 0 : 1);
        notifyUi();
      },
      toggleRotate() {
        const c = controlsRef.current;
        if (c) c.autoRotate = !c.autoRotate;
        notifyUi();
      },
      toggleContrast() {
        const st = stateRef.current;
        st.contrast = !st.contrast;
        const M = piano.materials;
        piano.keys.forEach((k) => {
          if (!k.white) k.mesh.material = st.contrast ? M.blackKeyContrast : M.blackKey;
        });
        notifyUi();
      },
      toggleDemo() {
        if (stateRef.current.demo) stopDemo(); else startDemo();
      },
      reset() {
        controlsRef.current?.setView(PIANO_VIEWS.front);
        if (controlsRef.current) controlsRef.current.autoRotate = false;
        PianoAudio.panic();
        piano.keys.forEach((k) => { k.target = 0; k.held = false; });
        stopDemo();
        setSustain(false);
        notifyUi();
      },
      setVolume(v) { PianoAudio.setVolume(v); },
      setReverb(v) { PianoAudio.setReverb(v); },
      pedalDown(idx) {
        PianoAudio.init();
        stateRef.current.pedalT[idx] = 1;
        if (idx === 2) setSustain(true);
        if (idx === 0) PianoAudio.setSoft(true);
      },
      pedalUp(idx) {
        stateRef.current.pedalT[idx] = 0;
        if (idx === 2) setSustain(false);
        if (idx === 0) PianoAudio.setSoft(false);
      },
      isZoomedOut() {
        const c = controlsRef.current;
        return !!c && c.getState().radius >= c.maxRadius - 0.06;
      },
    };
    apiRef.current = api;
    notifyUi();
    return () => { apiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piano]);

  /* ---------------- 详情页打开/关闭 ---------------- */
  const detailOpenRef = useRef(detailOpen);
  detailOpenRef.current = detailOpen;
  useEffect(() => {
    if (!detailOpen) {
      // 关闭详情页：收束全部声音与动画状态
      PianoAudio.panic();
      stopDemo();
      setSustain(false);
      stateRef.current.pedalT = [0, 0, 0];
      piano.keys.forEach((k) => { k.target = 0; k.held = false; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailOpen]);

  /* ---------------- 指针交互：点击琴键 / 滑奏 ---------------- */
  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const pointerNDC = new THREE.Vector2();
    let activePointerKey: number | null = null;

    const hitKey = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointerNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, cam);
      const hits = raycaster.intersectObjects(piano.keysGroup.children, false);
      if (!hits.length) return null;
      return { midi: hits[0].object.userData.midi as number };
    };

    const onPointerDown = (e: PointerEvent) => {
      PianoAudio.init();
      if (!stateRef.current.interactive) return;
      const hit = hitKey(e);
      if (hit) {
        e.stopPropagation();
        const c = controlsRef.current;
        if (c) c.enabled = false;
        activePointerKey = hit.midi;
        pressKey(hit.midi, 0.72 + Math.random() * 0.2, true);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (activePointerKey === null) return;
      const hit = hitKey(e);
      if (hit && hit.midi !== activePointerKey) {
        releaseKey(activePointerKey);
        activePointerKey = hit.midi;
        pressKey(hit.midi, 0.62 + Math.random() * 0.18);
      }
    };
    const onPointerUp = () => {
      if (activePointerKey !== null) { releaseKey(activePointerKey); activePointerKey = null; }
      const c = controlsRef.current;
      if (c && stateRef.current.interactive) c.enabled = true;
    };

    gl.domElement.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      gl.domElement.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, cam, piano]);

  /* ---------------- 电脑键盘交互 ---------------- */
  useEffect(() => {
    let baseMidi = 48;
    const down = new Set<number>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (!detailOpenRef.current) return;
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setSustain(true);
        stateRef.current.pedalT[2] = 1;
        return;
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        baseMidi = Math.max(21, baseMidi - 12);
        toast('八度 −  (基准 ' + noteName(baseMidi) + ')');
        return;
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        baseMidi = Math.min(84, baseMidi + 12);
        toast('八度 +  (基准 ' + noteName(baseMidi) + ')');
        return;
      }
      const off = KEYMAP[e.code];
      if (off === undefined) return;
      const midi = baseMidi + off;
      if (midi < 21 || midi > 108 || down.has(midi)) return;
      down.add(midi);
      PianoAudio.init();
      pressKey(midi, 0.8, true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!detailOpenRef.current) return;
      if (e.code === 'Space') {
        setSustain(false);
        stateRef.current.pedalT[2] = 0;
        return;
      }
      const off = KEYMAP[e.code];
      if (off === undefined) return;
      const midi = baseMidi + off;
      if (!down.has(midi)) return;
      down.delete(midi);
      releaseKey(midi);
    };
    const onBlur = () => {
      down.forEach((m) => releaseKey(m));
      down.clear();
      setSustain(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 模型卸载时释放资源 ---------------- */
  useEffect(() => {
    return () => {
      piano.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
    };
  }, [piano]);

  /* ---------------- 主循环：镜头旅程 + 动画 ---------------- */
  const camTmp = useMemo(() => ({
    target: new THREE.Vector3(),
  }), []);
  const interactiveNotifiedRef = useRef(false);

  useFrame((_, delta) => {
    const st = stateRef.current;
    const dt = Math.min(0.05, delta);
    const progress = Math.max(0, Math.min(1, scrollProgressRef.current));

    updateDemo();
    updateOpenables(dt);
    updateKeys(dt);

    // === 苹果式镜头旅程 / 自由交互的分界 ===
    const interactive = progress >= 0.995;
    if (interactive !== st.interactive) {
      st.interactive = interactive;
      if (interactive) {
        // 旅程结束：把当前插值相机状态无缝交给轨道控制器
        const c = controlsRef.current;
        if (c) {
          const last = CAM_KEYS[CAM_KEYS.length - 1];
          c.setView({ theta: last.theta, phi: last.phi, radius: last.radius, target: last.target }, true);
          c.enabled = true;
        }
      } else {
        const c = controlsRef.current;
        if (c) c.enabled = false;
      }
      if (interactive !== interactiveNotifiedRef.current || !interactive) {
        interactiveNotifiedRef.current = interactive;
        onInteractiveChange?.(interactive);
      }
    }

    if (!interactive) {
      // 旅程期间：琴盖 / 键盘盖由滚动进度驱动（覆盖手动状态）
      applyLid(smoothstep01(0.30, 0.58, progress));
      applyFallboard(smoothstep01(0.62, 0.86, progress));

      // 在关键帧之间做 smootherstep 插值（球坐标 + FOV）
      let i0 = 0;
      for (let i = 0; i < CAM_KEYS.length - 1; i++) {
        if (progress >= CAM_KEYS[i].t && progress <= CAM_KEYS[i + 1].t) { i0 = i; break; }
        if (progress > CAM_KEYS[CAM_KEYS.length - 1].t) { i0 = CAM_KEYS.length - 2; break; }
        i0 = i; // progress 小于首帧时保持 0
      }
      const k0 = CAM_KEYS[i0];
      const k1 = CAM_KEYS[i0 + 1] ?? k0;
      const seg = (progress - k0.t) / Math.max(1e-6, k1.t - k0.t);
      const u = smootherstep(seg);

      const theta = k0.theta + (k1.theta - k0.theta) * u;
      const phi = k0.phi + (k1.phi - k0.phi) * u;
      const radius = k0.radius + (k1.radius - k0.radius) * u;
      const fov = k0.fov + (k1.fov - k0.fov) * u;
      camTmp.target.lerpVectors(k0.target, k1.target, u);

      const sp = Math.sin(phi), cp = Math.cos(phi);
      cam.position.set(
        camTmp.target.x + radius * sp * Math.sin(theta),
        camTmp.target.y + radius * cp,
        camTmp.target.z + radius * sp * Math.cos(theta)
      );
      cam.lookAt(camTmp.target);
      cam.fov = fov;
      cam.updateProjectionMatrix();
    } else {
      // 交互模式：轨道控制器驱动（含自动旋转）
      controlsRef.current?.update(dt);
    }

    // === FPS / 三角面 / 发声数统计（0.5s 更新一次） ===
    st.frames++;
    st.fpsTime += dt;
    if (st.fpsTime > 0.5) {
      st.fps = Math.round(st.frames / st.fpsTime);
      st.frames = 0; st.fpsTime = 0;
      const el = statElRef.current;
      if (el) {
        el.textContent = st.fps + ' FPS · 三角面 ' +
          (gl.info.render.triangles / 1000).toFixed(0) + 'k · 发声 ' + PianoAudio.activeVoices;
      }
    }
  });

  /* ---------------- 灯光与场景对象 ---------------- */
  return (
    <>
      {/* 钢琴 + 地面 */}
      <primitive object={piano.root} />
      <primitive object={groundGroup} />

      {/* 半球环境光 */}
      <hemisphereLight args={[0xffffff, 0xb4bcc9, 0.30]} />

      {/* 主光（投影） */}
      <directionalLight
        castShadow
        intensity={3.10}
        color={0xffffff}
        position={[2.15, 4.75, 1.55]}
        target-position={[0, 0.72, -0.75]}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00035}
        shadow-normalBias={0.012}
        shadow-radius={2.2}
        shadow-camera-left={-2.0}
        shadow-camera-right={2.0}
        shadow-camera-top={2.4}
        shadow-camera-bottom={-2.4}
        shadow-camera-near={0.6}
        shadow-camera-far={9.5}
      />

      {/* 补光 + 轮廓光 */}
      <directionalLight intensity={0.34} color={0xeef3ff} position={[-3.2, 2.2, -1.4]} />
      <directionalLight intensity={0.42} color={0xffffff} position={[-0.6, 1.4, -4.2]} />
    </>
  );
}

/**
 * 生成接地柔影纹理（径向 alpha）
 *
 * 参数：无
 * 返回值：{THREE.CanvasTexture} 柔影纹理
 */
function makeContactShadowTexture(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(s / 2, s / 2, s * 0.04, s / 2, s / 2, s * 0.5);
  g.addColorStop(0.0, 'rgba(120,126,138,0.55)');
  g.addColorStop(0.42, 'rgba(120,126,138,0.26)');
  g.addColorStop(0.78, 'rgba(120,126,138,0.06)');
  g.addColorStop(1.0, 'rgba(120,126,138,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
