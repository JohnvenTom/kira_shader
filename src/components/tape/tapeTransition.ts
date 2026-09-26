/**
 * tapeTransition —— 音乐盒角标 ↔ 磁带机整页 的展开 / 收闭过渡（模块级协调者）
 *
 * 功能：
 *  - 记住"来源矩形"：角标被点开时量下它自己那条 bar 的矩形（视口坐标）。
 *    展开时这块矩形就是面板的起点；收闭时它是整页缩回去的落点 —— 同一个矩形，进出一致。
 *  - 收闭握手：页头的 BACK TO SITE 只发"用户要走"的信号（tapeApp 的 onExit），
 *    由这里的 requestClose() 转给整页注册的实现（先播关灯 + 收缩动画），
 *    动画落地后才由 finishClose() 真正改 hash 换路由 —— 顺序不能反，
 *    因为 hash 一变整页就被卸载，没有东西可缩了。
 *  - 统一时间常量：JS（设置 transform / 排定时器）与 CSS（用自定义属性读）共用同一组数字，
 *    避免两边各写一套而对不上。
 *
 * 参数：无（模块级单例）
 *
 * 返回值：导出 tapeTransition 单例与 TIMING / Rect / reduceMotion
 *
 * 异常：sessionStorage 被禁用时静默降级（来源页退回默认胶片页）
 *
 * 注意事项：
 *  - 浏览器后退键不走这里：hash 先变、整页先卸载，物理上没有可缩的页面了（已知限制）
 *  - 深链直接打开 #tape 时没有来源矩形：展开不播（直接淡入），收闭仍朝右下角角标位收
 *  - 所有动画都走 CSS transform / transition（合成器线程）：磁带页 boot 期间主线程在编着色器，
 *    动画也不会因此卡顿 —— 这是"流畅"的关键，别把这些改成 JS 逐帧
 */

/** 视口坐标下的矩形 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 时间常量（毫秒）—— JS 与 CSS 共用：JS 写成 CSS 变量，CSS 用 var() 读 */
export const TIMING = {
  /** 角标点开后，图标淡出 + 放大的时长，之后才切路由 */
  dockHandoff: 90,
  /** 面板在自己矩形上由深色芯片过到纸色 */
  panelRecolor: 200,
  /** 面板从角标矩形展开到全屏 */
  panelExpand: 460,
  /** 内容（加载屏 / 终端 UI）淡入时长 */
  contentIn: 320,
  /** 内容淡入相对"展开开始"的延迟 */
  contentDelay: 150,
  /** 收闭第一步：换灯曲线被压到的时长（整套房间一起暗） */
  dimTheme: 420,
  /** 关灯后等多久开始收缩 */
  closeDelay: 180,
  /** 整页缩回角标矩形 */
  shrink: 380,
} as const;

/** 是否要求减少动效（为真则整套过渡退化成瞬时） */
export function reduceMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 深链打开、又没量过角标时，收闭落点的兜底尺寸（角标 bar 的实测尺寸，见 rememberOrigin） */
const FALLBACK_SIZE = { w: 81, h: 39 };
/** 角标在 CSS 里的右下留白（musicBox.css: right/bottom 26px），兜底落点按它算 */
const DOCK_GAP = 26;
/** 来源页的存储键：与 tapeApp 里那条兜底路径共用（见 port-cassette.mjs 的「返回站内绑定」） */
const FROM_KEY = 'ohmtape.from';

/** 角标点开时量下的矩形（本次会话内有效；刷新即失，深链走兜底） */
let originRect: Rect | null = null;
/** 量到过的角标尺寸（用于深链收闭时的兜底落点） */
let dockSize: { w: number; h: number } | null = null;
/** 来源页 hash（收闭落地后回到这里） */
let fromHash = '';
/** 整页注册的收闭实现 */
let closeHandler: (() => void) | null = null;
/** 收闭是否正在进行（防重复触发） */
let closing = false;
/** 刚完成一次收闭（角标挂载时消费，用来播回弹） */
let landed = false;

/**
 * 记住角标的位置与尺寸
 *
 * 功能：量取角标 bar 的视口矩形，作为展开起点与收闭落点；同时记下来源页 hash
 *
 * 参数：
 *  - el {HTMLElement} 角标本体（.music-dock-bar）
 * 返回值：无
 * 异常：无
 */
export function rememberOrigin(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  originRect = { x: r.left, y: r.top, w: r.width, h: r.height };
  dockSize = { w: r.width, h: r.height };
  fromHash = window.location.hash && window.location.hash !== '#tape' ? window.location.hash : '#film';
  try { sessionStorage.setItem(FROM_KEY, fromHash); } catch { /* 存储不可用：内存里那份还在 */ }
  closing = false;
}

/** 取出并清空来源矩形（整页挂载时消费一次，避免下次误用旧的起点） */
export function consumeOrigin(): Rect | null {
  const r = originRect;
  originRect = null;
  return r;
}

/**
 * 收闭的落点矩形
 *
 * 功能：有量过的来源矩形就用它（角标点进来的情况，落点与起点完全一致）；
 *      深链直接打开时按角标在 CSS 里的位置（右下 26px）与实测/兜底尺寸算
 *
 * 参数：无
 * 返回值：{Rect} 视口坐标下的落点
 * 异常：无
 */
export function landingRect(): Rect {
  const w = dockSize?.w ?? FALLBACK_SIZE.w;
  const h = dockSize?.h ?? FALLBACK_SIZE.h;
  return {
    x: window.innerWidth - DOCK_GAP - w,
    y: window.innerHeight - DOCK_GAP - h,
    w,
    h,
  };
}

/** 来源页 hash（没有记录时回胶片页） */
export function exitHash(): string {
  if (fromHash) return fromHash;
  try {
    const saved = sessionStorage.getItem(FROM_KEY);
    if (saved && saved !== '#tape') return saved;
  } catch { /* 存储不可用 */ }
  return '#film';
}

/**
 * 整页注册"我来实现收闭动画"
 *
 * 功能：磁带机挂载时把自己的收闭实现交进来；卸载时交回 null
 *
 * 参数：
 *  - fn {(() => void) | null} 收闭实现（内部应播完动画后调用 finishClose）
 * 返回值：无
 * 异常：无
 */
export function onCloseRequest(fn: (() => void) | null): void {
  closeHandler = fn;
}

/**
 * 请求收闭（页头的 BACK TO SITE 走这里）
 *
 * 功能：转给整页注册的实现先播动画；没有实现（例如整页还没挂好）就直接换路由
 *
 * 参数：无
 * 返回值：无
 * 异常：无
 */
export function requestClose(): void {
  if (closing) return;
  if (closeHandler) closeHandler();
  else finishClose();
}

/** 收闭落地：真正换路由
 *
 * 功能：把 hash 换成来源页（兜底胶片页）。到这一步动画已经播完，整页可以安全卸载了；
 *      同时放一个"刚落地"的标记，让角标挂载时播一下回弹
 *
 * 参数：无
 * 返回值：无
 * 异常：无
 */
export function finishClose(): void {
  closing = false;
  landed = true;
  const target = exitHash();
  if (window.location.hash !== target) window.location.hash = target;
}

/** 标记收闭开始（整页在用；防止重复触发） */
export function markClosing(): boolean {
  if (closing) return false;
  closing = true;
  return true;
}

/** 取用"刚落地"标记（角标挂载时消费一次，用来播一次回弹） */
export function consumeLanded(): boolean {
  const v = landed;
  landed = false;
  return v;
}