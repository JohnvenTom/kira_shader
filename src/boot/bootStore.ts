/**
 * 开屏 boot 状态机（模块单例，逆向自 shader.se 的加载编排）
 *
 * 功能：集中管理「资产加载 → GPU 预热 → 500ms 静置 → 显现弹簧」四个阶段，
 *      以及进度条的显示值（阻尼 + 单调）和单源弹簧值（驱动相机/合成层/屏幕内容）。
 *
 * 阶段说明（对应 shader.se 的 useLoadingProgressStore + pagesStore 编排）：
 *  - loading   资产下载中。进度条目标 = 加权资产进度 × 50（前半段）
 *  - warmup    资产齐了，渲染 N 帧吃掉首帧着色器编译/纹理上传卡顿。
 *              进度条目标 = 50 + 预热进度 × 50（后半段）
 *  - countdown 预热完成，静置 500ms——让用户看到进度条走满 100%（shader.se 同款节奏）
 *  - reveal    显现弹簧 0→1（stiffness 30 / damping 8，轻微欠阻尼有过冲），
 *              同时驱动：boot 屏 alpha = 1−s、相机拉远、屏幕内容切换、标题（s≥0.9）
 *  - done      弹簧收敛。滚动解锁、UI 门放开
 *
 * 显示值阻尼（进度条丝滑的关键，逆向参数）：
 *  - E += (target − E) × min(1, dt × rate)，rate = 就绪后 12 / 平时 5
 *  - 外套 max(E_prev) 保证单调——进度条永远不回退
 *
 * 注意：本模块不依赖 React；组件在 useFrame 里调 tickBoot，订阅用 subscribeBoot。
 */

export type BootPhase = 'loading' | 'warmup' | 'countdown' | 'reveal' | 'done';

/** 显现弹簧参数（shader.se 原版：damping 8 / stiffness 30，≈0.73 阻尼比，微过冲） */
const SPRING_STIFFNESS = 30;
const SPRING_DAMPING = 8;
/** 预热完成后的静置时长（秒）——进度条满格的展示时间 */
const COUNTDOWN_DELAY = 0.5;
/** 进度条阻尼速率：平时 5、就绪后 12（收尾利落） */
const DAMP_RATE_LOADING = 5;
const DAMP_RATE_READY = 12;

interface AssetEntry {
  weight: number;
  /** 0~1，只升不降 */
  progress: number;
  done: boolean;
}

const assets = new Map<string, AssetEntry>();
const listeners = new Set<() => void>();

const state = {
  phase: 'loading' as BootPhase,
  /** 加权资产进度 0~1 */
  assetProgress: 0,
  /** 预热进度 0~1（帧数推进） */
  warmupProgress: 0,
  /** 进度条显示值 0~100（阻尼 + 单调） */
  displayProgress: 0,
  /** 显现弹簧值 0~1（可轻微过冲到 ~1.02） */
  spring: 0,
  /** 弹簧是否收敛（滚动/UI 门解锁） */
  springDone: false,
  /** 标题门：spring ≥ 0.9（相机基本落位，文字再入场） */
  titleGate: false,
};

/** 内部积分器状态 */
const springVel = { v: 0 };
let countdownElapsed = 0;

function recomputeAssetProgress() {
  let total = 0;
  let acc = 0;
  for (const a of assets.values()) {
    total += a.weight;
    acc += a.weight * a.progress;
  }
  state.assetProgress = total > 0 ? Math.min(1, acc / total) : 0;
}

function allAssetsDone() {
  if (assets.size === 0) return false;
  for (const a of assets.values()) if (!a.done) return false;
  return true;
}

function notify() {
  for (const fn of listeners) fn();
}

/**
 * 登记一个可跟踪进度的资产（权重按体量分配，如 glb 0.62）
 *
 * 返回句柄：setProgress(0~1) 上报进度（内部单调钳制）、markDone() 标记完成
 */
export function registerBootAsset(id: string, weight: number) {
  assets.set(id, { weight, progress: 0, done: false });
  recomputeAssetProgress();
  return {
    setProgress(p: number) {
      const a = assets.get(id);
      if (!a || a.done) return;
      a.progress = Math.max(a.progress, Math.min(1, p));
      recomputeAssetProgress();
    },
    markDone() {
      const a = assets.get(id);
      if (!a || a.done) return;
      a.progress = 1;
      a.done = true;
      recomputeAssetProgress();
      if (state.phase === 'loading' && allAssetsDone()) {
        state.phase = 'warmup';
        notify();
      }
    },
  };
}

/** 预热帧推进（BootController 每帧调用） */
export function setBootWarmupProgress(p: number) {
  state.warmupProgress = Math.min(1, p);
}

/** 预热完成 → 进入 500ms 静置 */
export function markBootWarmupDone() {
  if (state.phase === 'warmup') {
    state.phase = 'countdown';
    countdownElapsed = 0;
    notify();
  }
}

/**
 * 每帧推进状态机（阻尼显示值 + 弹簧积分）
 *
 * 参数：
 *  - delta {number} 帧间隔（秒，建议 clamp 到 0.05 以内）
 */
export function tickBoot(delta: number) {
  const dt = Math.min(0.05, Math.max(delta, 0.0001));

  // === 进度条显示值：阻尼 + 单调 ===
  const target =
    state.phase === 'loading'
      ? state.assetProgress * 50
      : state.phase === 'warmup'
        ? 50 + state.warmupProgress * 50
        : 100;
  const rate = state.phase === 'loading' || state.phase === 'warmup' ? DAMP_RATE_LOADING : DAMP_RATE_READY;
  const w = Math.min(1, dt * rate);
  const next = state.displayProgress + (target - state.displayProgress) * w;
  state.displayProgress = Math.max(state.displayProgress, Math.min(100, next));

  // === countdown：500ms 静置后启动弹簧 ===
  if (state.phase === 'countdown') {
    countdownElapsed += dt;
    if (countdownElapsed >= COUNTDOWN_DELAY) {
      state.phase = 'reveal';
      springVel.v = 0;
      notify();
    }
  }

  // === reveal：弹簧积分（半隐式欧拉，稳定且手感与 motion 一致） ===
  if (state.phase === 'reveal') {
    const x = state.spring;
    const v = springVel.v;
    const a = -SPRING_STIFFNESS * (x - 1) - SPRING_DAMPING * v;
    springVel.v = v + a * dt;
    state.spring = Math.min(1.05, x + springVel.v * dt);
    if (!state.titleGate && state.spring >= 0.9) {
      state.titleGate = true;
      notify();
    }
    if (Math.abs(state.spring - 1) < 0.002 && Math.abs(springVel.v) < 0.004) {
      state.spring = 1;
      state.springDone = true;
      state.phase = 'done';
      notify();
    }
  }
}

/** React 订阅：titleGate / springDone / 阶段变化时触发 */
export function subscribeBoot(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 只读快照（消费方每帧直接读字段，不订阅） */
export const bootStore = state;

/**
 * 当前 boot 是否已解锁滚动/交互
 * （非首页路由不会跑 boot 流程时恒为 true，避免卡死其他页面）
 */
export function bootInteractionUnlocked(): boolean {
  return state.springDone || !assetsRegistered();
}

/** 是否有资产被登记过（区分"首页 boot 流程"与"其他页面"） */
export function assetsRegistered(): boolean {
  return assets.size > 0;
}
