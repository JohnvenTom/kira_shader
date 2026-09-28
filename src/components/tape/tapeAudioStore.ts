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
  /** 音量（0~1；磁带页滚轮与音乐盒角标滚轮共用） */
  volume: number;
  /** 音频是否可用（元数据已就绪；false 表示未装带或加载失败） */
  ready: boolean;
  /** 是否加载失败（文件缺失/无法解码） */
  failed: boolean;
}

/** 歌单里的一条曲目（ADD MUSIC 追加进来；blob 地址随会话失效） */
export interface PlaylistTrack {
  title: string;
  artist: string;
  album: string;
  src: string;
}

/* ============================================================
   默认歌单：public/asset/audio/bgm/ 下的 50 首。
   元数据由文件名解析（第一个短横线前=作者，其后=歌名，剔出结尾 ID 数字、
   下划线转空格；浏览器重复下载的 " (1)" 后缀也剥掉）——由一次性脚本生成，
   加新曲子时把文件放进 bgm 目录后重跑或手改这个数组。第一首 positive
   是"打开网页自动播"的那首。
   ============================================================ */
const PLAYLIST: PlaylistTrack[] = [
  { artist: "JAMBACK", title: "positive", album: "", src: "/asset/audio/bgm/JAMBACK - positive.mp3" },
  { artist: "comastudio", title: "abstract-design universe", album: "", src: "/asset/audio/bgm/comastudio-abstract-design_universe-40978.mp3" },
  { artist: "comastudio", title: "abstract-epic-technology-electronica star", album: "", src: "/asset/audio/bgm/comastudio-abstract-epic-technology-electronica_star-197960.mp3" },
  { artist: "comastudio", title: "abstract-slideshow planet", album: "", src: "/asset/audio/bgm/comastudio-abstract-slideshow_planet-121486.mp3" },
  { artist: "comastudio", title: "abstract-trap-vibe orbital", album: "", src: "/asset/audio/bgm/comastudio-abstract-trap-vibe_orbital-303651.mp3" },
  { artist: "comastudio", title: "action-trap-sport-beat constellation", album: "", src: "/asset/audio/bgm/comastudio-action-trap-sport-beat_constellation-148536.mp3" },
  { artist: "comastudio", title: "ambient-chill-beat observatory", album: "", src: "/asset/audio/bgm/comastudio-ambient-chill-beat_observatory-49962.mp3" },
  { artist: "comastudio", title: "chill-beat-abstract-vlog fulfillment", album: "", src: "/asset/audio/bgm/comastudio-chill-beat-abstract-vlog_fulfillment-84177.mp3" },
  { artist: "comastudio", title: "chill-modern-abstract revelation", album: "", src: "/asset/audio/bgm/comastudio-chill-modern-abstract_revelation-162594.mp3" },
  { artist: "comastudio", title: "chill-timelapse-tech-vlog influence", album: "", src: "/asset/audio/bgm/comastudio-chill-timelapse-tech-vlog_influence-84179.mp3" },
  { artist: "comastudio", title: "dark-abstract-beat encouragement", album: "", src: "/asset/audio/bgm/comastudio-dark-abstract-beat_encouragement-40982.mp3" },
  { artist: "comastudio", title: "deep-abstract-ambient purpose", album: "", src: "/asset/audio/bgm/comastudio-deep-abstract-ambient_purpose-165044.mp3" },
  { artist: "comastudio", title: "deep-chilled-ambience-electronica faith", album: "", src: "/asset/audio/bgm/comastudio-deep-chilled-ambience-electronica_faith-303653.mp3" },
  { artist: "comastudio", title: "deep-fashion-chill-out adaptability", album: "", src: "/asset/audio/bgm/comastudio-deep-fashion-chill-out_adaptability-122639.mp3" },
  { artist: "comastudio", title: "dreamy-chill-beat flowerings", album: "", src: "/asset/audio/bgm/comastudio-dreamy-chill-beat_flowerings-40983.mp3" },
  { artist: "comastudio", title: "epic-hybrid-rock-trailer cultivation", album: "", src: "/asset/audio/bgm/comastudio-epic-hybrid-rock-trailer_cultivation-158531.mp3" },
  { artist: "comastudio", title: "epic-powerful-sport-big-beat balance", album: "", src: "/asset/audio/bgm/comastudio-epic-powerful-sport-big-beat_balance-128013.mp3" },
  { artist: "comastudio", title: "fashion-abstract-beat powered", album: "", src: "/asset/audio/bgm/comastudio-fashion-abstract-beat_powered-95422.mp3" },
  { artist: "comastudio", title: "fashion-inspire-relaxing-music schooner", album: "", src: "/asset/audio/bgm/comastudio-fashion-inspire-relaxing-music_schooner-165046.mp3" },
  { artist: "comastudio", title: "for-food anchor", album: "", src: "/asset/audio/bgm/comastudio-for-food_anchor-99185.mp3" },
  { artist: "comastudio", title: "future-bass-background lifelong-learning", album: "", src: "/asset/audio/bgm/comastudio-future-bass-background_lifelong-learning-199984.mp3" },
  { artist: "comastudio", title: "gloomy-background empathy", album: "", src: "/asset/audio/bgm/comastudio-gloomy-background_empathy-303656.mp3" },
  { artist: "comastudio", title: "honey", album: "", src: "/asset/audio/bgm/comastudio-honey-123561.mp3" },
  { artist: "comastudio", title: "inspired-ambient-technology observation", album: "", src: "/asset/audio/bgm/comastudio-inspired-ambient-technology_observation-49969.mp3" },
  { artist: "comastudio", title: "inspiring-abstract-ambient trust", album: "", src: "/asset/audio/bgm/comastudio-inspiring-abstract-ambient_trust-142820.mp3" },
  { artist: "comastudio", title: "jump", album: "", src: "/asset/audio/bgm/comastudio-jump-117029.mp3" },
  { artist: "comastudio", title: "lo-fi-chill infinite", album: "", src: "/asset/audio/bgm/comastudio-lo-fi-chill_infinite-166238.mp3" },
  { artist: "comastudio", title: "lo-fi-chill-time flabby", album: "", src: "/asset/audio/bgm/comastudio-lo-fi-chill-time_flabby-137262.mp3" },
  { artist: "comastudio", title: "motion-abstract-beat buried", album: "", src: "/asset/audio/bgm/comastudio-motion-abstract-beat_buried-182691.mp3" },
  { artist: "comastudio", title: "on-trip-hop ocean", album: "", src: "/asset/audio/bgm/comastudio-on-trip-hop_ocean-194598.mp3" },
  { artist: "comastudio", title: "organic-relax-lo-fi", album: "", src: "/asset/audio/bgm/comastudio-organic-relax-lo-fi-137261.mp3" },
  { artist: "comastudio", title: "promo-fashion-chill glacier", album: "", src: "/asset/audio/bgm/comastudio-promo-fashion-chill_glacier-158536.mp3" },
  { artist: "comastudio", title: "smooth dew", album: "", src: "/asset/audio/bgm/comastudio-smooth_dew-108786.mp3" },
  { artist: "comastudio", title: "soft-beat mist", album: "", src: "/asset/audio/bgm/comastudio-soft-beat_mist-115017.mp3" },
  { artist: "comastudio", title: "soft-lofi-beat vintage", album: "", src: "/asset/audio/bgm/comastudio-soft-lofi-beat_vintage-95425 (1).mp3" },
  { artist: "comastudio", title: "soul", album: "", src: "/asset/audio/bgm/comastudio-soul-106805.mp3" },
  { artist: "comastudio", title: "sport-fashion-rock sleek", album: "", src: "/asset/audio/bgm/comastudio-sport-fashion-rock_sleek-95426.mp3" },
  { artist: "comastudio", title: "sport-rock-fashion-trailer urban", album: "", src: "/asset/audio/bgm/comastudio-sport-rock-fashion-trailer_urban-131258.mp3" },
  { artist: "comastudio", title: "stylish-fashion-beat traditional", album: "", src: "/asset/audio/bgm/comastudio-stylish-fashion-beat_traditional-125855.mp3" },
  { artist: "comastudio", title: "techno-sport understated", album: "", src: "/asset/audio/bgm/comastudio-techno-sport_understated-125858.mp3" },
  { artist: "comastudio", title: "technological-ambient-downtempo creative", album: "", src: "/asset/audio/bgm/comastudio-technological-ambient-downtempo_creative-95427.mp3" },
  { artist: "comastudio", title: "temper", album: "", src: "/asset/audio/bgm/comastudio-temper-111377.mp3" },
  { artist: "comastudio", title: "that-funk sculpture", album: "", src: "/asset/audio/bgm/comastudio-that-funk_sculpture-125857.mp3" },
  { artist: "comastudio", title: "the-abstract-beats carving", album: "", src: "/asset/audio/bgm/comastudio-the-abstract-beats_carving-95428.mp3" },
  { artist: "comastudio", title: "the-upbeat-chill-beat constructing", album: "", src: "/asset/audio/bgm/comastudio-the-upbeat-chill-beat_constructing-121494.mp3" },
  { artist: "comastudio", title: "thought", album: "", src: "/asset/audio/bgm/comastudio-thought-106806.mp3" },
  { artist: "comastudio", title: "trap-beat materializing", album: "", src: "/asset/audio/bgm/comastudio-trap-beat_materializing-99191.mp3" },
  { artist: "comastudio", title: "trap-it manifestation", album: "", src: "/asset/audio/bgm/comastudio-trap-it_manifestation-303650.mp3" },
  { artist: "comastudio", title: "travel draft", album: "", src: "/asset/audio/bgm/comastudio-travel_draft-122070.mp3" },
  { artist: "comastudio", title: "wheedling", album: "", src: "/asset/audio/bgm/comastudio-wheedling-106807.mp3" },
];
/** 打开网页自动播放的第一首 */
const FIRST_TRACK = PLAYLIST[0];
/** 整页的默认音量（原项目 setVolume(0.10)），保证角标先播时音量一致 */
const DEFAULT_VOLUME = 0.10;
/** 音量记忆键：角标滚轮与磁带页滚轮共用一档，谁调了都记住 */
const VOLUME_KEY = 'ohmtape.volume';
/** 播放状态记忆键（设置记忆用的是 ohmtape.prefs，两者互不干扰） */
const PLAY_KEY = 'ohmtape.play';

/** 读记忆音量（0~1；读不到/非法退回默认 0.10） */
function readSavedVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** 单例的音频元素：全站共用，路由切换不销毁 */
const element: HTMLAudioElement = new Audio();
element.preload = 'auto';
element.volume = readSavedVolume();
element.src = FIRST_TRACK.src;
/* 双保险第一重：页面一打开就尝试无手势播放——部分浏览器/场景允许（有过交互记录、
   非严格策略），被自动播放策略拦下时静默失败，第二重在下面的 onFirstGesture：
   用户第一次点击/按键/触摸时立即起播。注意这里不用 play()（它会把 userTouched
   置真，导致第一重被拦后第二重也被跳过）。 */
void element.play().catch(() => undefined);

/** 当前状态（每次变化后重建一份并通知订阅者） */
let state: TapeAudioState = {
  playing: false,
  time: 0,
  duration: 0,
  title: FIRST_TRACK.title,
  artist: FIRST_TRACK.artist,
  album: FIRST_TRACK.album,
  volume: element.volume,
  ready: false,
  failed: false,
};
const listeners = new Set<(s: TapeAudioState) => void>();
/** 用户是否亲手按过播放/暂停：按过就不再让"自动续播"抢方向盘 */
let userTouched = false;

/** 读取记忆的播放状态（读不到或没值就是 null；src 用来判断"记忆的是不是当前这首"） */
function readSaved(): { playing: boolean; time: number; src: string } | null {
  try {
    const raw = localStorage.getItem(PLAY_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { playing?: unknown; time?: unknown; src?: unknown };
    return {
      playing: !!o.playing,
      time: Number(o.time) || 0,
      src: typeof o.src === 'string' ? o.src : '',
    };
  } catch {
    return null;
  }
}

/** 写入记忆的播放状态（存储被禁用时静默跳过；src 记当前曲目，续播只认同一首） */
function writeSaved(): void {
  try {
    localStorage.setItem(PLAY_KEY, JSON.stringify({
      playing: state.playing && !state.failed,
      time: state.time,
      src: currentTrack().src,
    }));
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

/* ---- 歌单：磁带页 ADD MUSIC 追加，音乐盒角标左右拖在歌单里循环切 ----
   单例持有歌单是架构决定：dock 只在磁带页之外渲染（main.tsx !isTape），
   所以"dock 切歌"与"磁带页换带动画"永远不会同时发生——
   页面开着时音频由 applyTrack 驱动（addPlaylistTrack 只登记不碰元素），
   页面关着时 dock 的 next/prev 直接驱动共享元素。 */

/** 运行时歌单：默认歌单的副本起步；ADD MUSIC 追加进来的 blob 曲目随会话失效，
    不持久化（音频文件无法进 localStorage），刷新后回到默认歌单 */
const playlist: PlaylistTrack[] = [...PLAYLIST];
let plIndex = 0;

/** 歌单当前曲目 */
function currentTrack(): PlaylistTrack {
  return playlist[plIndex];
}

/** 把歌单第 i 首装进共享元素并播报（保持播放态：切歌不打断"正在听"） */
function switchTo(i: number): void {
  plIndex = ((i % playlist.length) + playlist.length) % playlist.length;
  const t = currentTrack();
  const wasPlaying = !element.paused && !element.ended;
  element.src = t.src;
  state = { ...state, title: t.title, artist: t.artist, album: t.album, time: 0, duration: 0, ready: false, failed: false };
  emit();
  if (wasPlaying) void play();
}

/** 下一首（循环）；歌单不足两首时返回 false（dock 用它提示"只有一首"） */
function next(): boolean {
  if (playlist.length < 2) return false;
  switchTo(plIndex + 1);
  return true;
}

/** 上一首（循环）；歌单不足两首时返回 false */
function prev(): boolean {
  if (playlist.length < 2) return false;
  switchTo(plIndex - 1);
  return true;
}

/** ADD MUSIC 追加曲目：登记进歌单并把"当前带"指向它（音频由磁带页的 applyTrack 驱动） */
function addPlaylistTrack(t: PlaylistTrack): void {
  playlist.push(t);
  plIndex = playlist.length - 1;
  state = { ...state, title: t.title, artist: t.artist, album: t.album };
  emit();
}

/** 点选曲目：切到歌单第 i 首并立即播放（播放列表面板点选即播） */
function playIndex(i: number): void {
  switchTo(i);
  void play();
}

/**
 * 设音量（0~1）：磁带页滚轮与音乐盒角标滚轮共用，写元素 + 记忆 + 广播
 *
 * 参数：
 *  - v {number} 目标音量（越界自动收敛到 0~1）
 * 返回值：void
 * 异常：无（localStorage 不可用时只是不记忆）
 */
function setVolume(v: number): void {
  const vol = Math.min(1, Math.max(0, v));
  element.volume = vol;
  state = { ...state, volume: vol };
  try { localStorage.setItem(VOLUME_KEY, String(vol)); } catch { /* 存储不可用 */ }
  emit();
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
 * 双保险第二重：用户第一次交互时确保音乐响起
 *
 * 功能：页面打开时的无手势自动播（第一重）被浏览器策略拦下的话，挂在这里的
 *      pointerdown/keydown/touchstart 兜底——用户第一次任意交互立即起播。
 *      两种情形：
 *        - 上次在听的就是当前这首（src 相同）：续到记忆的进度
 *        - 否则（含首访）：从歌单第一首（positive）开头起播
 *      用户若在 0ms 定时器前已亲手操作过播放（userTouched），不插手。
 *
 * 参数：无
 * 返回值：无
 * 异常：无
 */
function onFirstGesture(): void {
  window.setTimeout(() => {
    if (userTouched) return;                 // 用户已亲手操作过播放：不抢方向盘
    if (!element.paused) return;             // 第一重已经响了
    if (state.failed) return;                // 未装带/加载失败：无从播起
    const saved = readSaved();
    if (saved && saved.playing && saved.src === element.src
        && saved.time > 0 && saved.time < (element.duration || Infinity)) {
      try { element.currentTime = saved.time; } catch { /* 元数据未就绪：从头放 */ }
    }
    void element.play().catch(() => undefined);
  }, 0);
}
window.addEventListener('pointerdown', onFirstGesture, { once: true, capture: true });
window.addEventListener('keydown', onFirstGesture, { once: true, capture: true });
window.addEventListener('touchstart', onFirstGesture, { once: true, capture: true });

/**
 * 标记"用户明确拒绝自动播放"（引导页的暂不播放按钮用）
 *
 * 功能：置 userTouched——首次交互钩子（onFirstGesture）看到它就不再自动起播，
 *      用户明确说不要，就不替他打开。此后想听音乐走正常入口（音乐盒播放钮）。
 *
 * 参数：无
 * 返回值：void
 * 异常：无
 */
function suppressAutoplay(): void {
  userTouched = true;
}

/** 导出的单例 */
export const tapeAudio = {
  /** 共享的音频元素：交给磁带机整页使用（工厂的 audioEl 注入位） */
  element,
  get state(): TapeAudioState { return state; },
  /** 歌单当前曲目（磁带页开机对齐标签文字用） */
  get current(): PlaylistTrack { return currentTrack(); },
  /** 歌单快照（播放列表面板渲染用；addPlaylistTrack 后引用内容已更新） */
  get list(): readonly PlaylistTrack[] { return playlist; },
  /** 当前曲目在歌单里的序号 */
  get index(): number { return plIndex; },
  /** 歌单曲目数（dock 判断"只有一首"用） */
  get playlistLength(): number { return playlist.length; },
  subscribe,
  play,
  pause,
  toggle,
  next,
  prev,
  playIndex,
  addPlaylistTrack,
  setVolume,
  suppressAutoplay,
};