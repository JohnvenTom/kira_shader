/**
 * tapeAudioStore —— 磁带音乐的单例（跨路由续播）
 *
 * 功能：
 *  - 全站唯一持有那个 <audio> 元素：挂在模块作用域，不随路由挂载/卸载，
 *    所以 #film → #tape → #return 的切换不会打断播放，进度也不丢
 *  - 对外提供播放/暂停/订阅与状态快照，供右下角音乐盒角标与磁带机整页共用
 *  - 记忆播放状态（localStorage，键 ohmtape.play）：本次会话离开页面再回来、或刷新后
 *    在"用户第一次交互"时自动接着放（浏览器不允许无手势出声，所以只能挂在那一下手势上）
 *
 * 参数：无（模块单例，无构造参数）
 *
 * 返回值：导出 tapeAudio（单例对象）与 TapeAudioState（状态快照类型）
 *
 * 异常：无。localStorage 被禁用、音频文件缺失（404）都在内部降级：
 *      前者退回默认值，后者把 failed 置真（角标显示"未装带"）
 *
 * 注意事项：
 *  - 默认曲目路径必须与搬运件 tapeApp.js 里的 TRACK_DEFAULT.src 一致：
 *    public/asset/audio/ohm-tape-default.mp3。文件缺失时走原项目"仅走带动画"降级路径
 *  - 只有内置曲目能跨刷新续播：ADD MUSIC 装进来的是本地文件的 blob URL，刷新即失效
 *  - 音量不在这里持久化：磁带机整页有自己的音量开关（默认 0.10，滚轮按 5% 一档调），
 *    它直接写元素，元素是共享的，所以角标与整页天然同音量
 */

/** 状态快照（订阅者拿到的就是这个对象） */
export interface TapeAudioState {
  /** 是否正在播放 */
  playing: boolean;
  /** 当前播放进度（秒） */
  time: number;
  /** 总时长（秒），未知为 0 */
  duration: number;
  /** 曲名 */
  title: string;
  /** 艺人 */
  artist: string;
  /** 专辑 */
  album: string;
  /** 音频是否可用（元数据已就绪；false 表示未装带或加载失败） */
  ready: boolean;
  /** 是否加载失败（文件缺失/无法解码） */
  failed: boolean;
}

/** 默认曲目的信息（与 tapeApp.js 的 TRACK_DEFAULT 对齐；整页开机后会广播覆盖，换成真曲子时两处一起改） */
const DEFAULT_SRC = '/asset/audio/ohm-tape-default.mp3';
const DEFAULT_TITLE = 'Demo Tone';
const DEFAULT_ARTIST = '';
const DEFAULT_ALBUM = '';
/** 整页的默认音量（原项目 setVolume(0.10)），保证角标先播时音量一致 */
const DEFAULT_VOLUME = 0.10;
/** 播放状态记忆键（设置记忆用的是 ohmtape.prefs，两者互不干扰） */
const PLAY_KEY = 'ohmtape.play';

/** 单例的音频元素：全站共用，路由切换不销毁 */
const element: HTMLAudioElement = new Audio();
element.preload = 'auto';
element.volume = DEFAULT_VOLUME;
element.src = DEFAULT_SRC;

/** 当前状态（每次变化后重建一份并通知订阅者） */
let state: TapeAudioState = {
  playing: false,
  time: 0,
  duration: 0,
  title: DEFAULT_TITLE,
  artist: DEFAULT_ARTIST,
  album: DEFAULT_ALBUM,
  ready: false,
  failed: false,
};
const listeners = new Set<(s: TapeAudioState) => void>();
/** 用户是否亲手按过播放/暂停：按过就不再让"自动续播"抢方向盘 */
let userTouched = false;

/** 读取记忆的播放状态（读不到或没值就是 null） */
function readSaved(): { playing: boolean; time: number } | null {
  try {
    const raw = localStorage.getItem(PLAY_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { playing?: unknown; time?: unknown };
    return { playing: !!o.playing, time: Number(o.time) || 0 };
  } catch {
    return null;
  }
}

/** 写入记忆的播放状态（存储被禁用时静默跳过） */
function writeSaved(): void {
  try {
    localStorage.setItem(PLAY_KEY, JSON.stringify({ playing: state.playing && !state.failed, time: state.time }));
  } catch {
    /* 存储不可用：只是这次会话不记忆，不影响播放 */
  }
}

/** 广播状态变化 */
function emit(): void {
  for (const fn of listeners) fn(state);
}

/**
 * 订阅状态变化
 *
 * 功能：订阅后立即收到一次当前快照（便于角标首帧就有内容），之后每次变化都会回调
 *
 * 参数：
 *  - fn {(s: TapeAudioState) => void} 订阅回调
 *
 * 返回值：{() => void} 取消订阅
 * 异常：无
 */
function subscribe(fn: (s: TapeAudioState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

/** 重算快照并广播（时间/时长/播放态/元数据都从这里出） */
function refresh(): void {
  const dur = Number.isFinite(element.duration) ? element.duration : 0;
  state = {
    ...state,
    playing: !element.paused && !element.ended,
    time: element.currentTime || 0,
    duration: dur,
    ready: dur > 0,
  };
  emit();
}

/**
 * 播放（手势内调用才有效）
 *
 * 功能：调用 element.play()，被浏览器策略拦下时静默失败（状态以元素实际为准）
 *
 * 参数：无
 * 返回值：{Promise<void>}
 * 异常：无（play() 的 rejection 已吞掉）
 */
function play(): Promise<void> {
  userTouched = true;
  return element.play().catch(() => undefined);
}

/** 暂停（并把进度记下来，方便下次续播） */
function pause(): void {
  userTouched = true;
  element.pause();
  writeSaved();
}

/** 播放/暂停切换（角标的按钮用它） */
function toggle(): void {
  if (element.paused) play();
  else pause();
}

/* ---- 元素事件：状态、进度、失败都在这里汇入单例 ---- */
element.addEventListener('loadedmetadata', refresh);
element.addEventListener('durationchange', refresh);
element.addEventListener('play', refresh);
element.addEventListener('pause', () => { refresh(); writeSaved(); });
element.addEventListener('ended', () => { refresh(); writeSaved(); });
element.addEventListener('error', () => {
  state = { ...state, failed: true, ready: false };
  emit();
});
/** 进度落盘节流：每 4 秒记一次（timeupdate 太密，写 localStorage 会拖帧） */
let lastSaved = 0;
element.addEventListener('timeupdate', () => {
  const now = element.currentTime;
  state = { ...state, time: now };
  if (Math.abs(now - lastSaved) >= 4) { lastSaved = now; writeSaved(); }
  emit();
});
/** 关页/切后台时补记一次 */
window.addEventListener('pagehide', writeSaved);
document.addEventListener('visibilitychange', () => { if (document.hidden) writeSaved(); });

/* ---- 整页换带后播报曲目：让角标显示的歌名跟着变 ---- */
window.addEventListener('ohmtape:track', (e) => {
  const d = (e as CustomEvent).detail as { title?: string; artist?: string; album?: string; failed?: boolean };
  state = {
    ...state,
    title: d?.title || state.title,
    artist: d?.artist || '',
    album: d?.album || '',
    failed: !!d?.failed || state.failed,
  };
  emit();
});

/**
 * 在"首次用户交互"时自动续播
 *
 * 功能：按记忆里的播放状态接着放（含进度）。浏览器不允许无手势出声，所以只能挂在
 *      本次页面加载的第一次 pointerdown / keydown / touchstart 上；为了不和用户
 *      这一次手势本身的操作打架（比如第一下点的就是角标的播放钮），真正的续播放在
 *      0ms 之后：那时若用户已经亲手动过播放（userTouched）或元素已在播放，就不插手。
 *
 * 参数：无
 * 返回值：无
 * 异常：无
 */
function onFirstGesture(): void {
  window.setTimeout(() => {
    const saved = readSaved();
    if (!saved || !saved.playing || userTouched || state.failed) return;
    if (!element.paused) return;
    if (saved.time > 0 && saved.time < (element.duration || Infinity)) {
      try { element.currentTime = saved.time; } catch { /* 元数据未就绪：从头放 */ }
    }
    void element.play().catch(() => undefined);
  }, 0);
}
window.addEventListener('pointerdown', onFirstGesture, { once: true, capture: true });
window.addEventListener('keydown', onFirstGesture, { once: true, capture: true });
window.addEventListener('touchstart', onFirstGesture, { once: true, capture: true });

/** 导出的单例 */
export const tapeAudio = {
  /** 共享的音频元素：交给磁带机整页使用（工厂的 audioEl 注入位） */
  element,
  get state(): TapeAudioState { return state; },
  subscribe,
  play,
  pause,
  toggle,
};