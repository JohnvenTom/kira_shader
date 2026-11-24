/**
 * SPA 内部导航（/work/<slug> ↔ /#selected-work 等）
 *
 * 用 history.pushState + 手动派发 popstate，让 Root 的路由监听重渲染——
 * 避免整页 reload（原站 Next.js 客户端路由同语义：Close 回胶片页不重播 boot）。
 *
 * boot 门控：原站 boot 只在**硬加载**时播放（真站点击 View project 连拍实证：
 * 客户端路由进详情无 boot，胶片保持 → 内容以 subPageTransition 亮度渐起+相机
 * 飞入打开，04kr p7/p9 的 subPageTransition 机制）。SPA 内部导航置
 * sessionStorage 旗标，详情页读到即跳过 boot；硬加载（直链/刷新）无旗标 →
 * boot 照播。
 */

const SPA_NAV_KEY = 'wd-spa-nav';

/** SPA 内部跳转（不改 hash 的路径跳转也走这里） */
export function navigate(href: string) {
  if (window.location.pathname + window.location.search + window.location.hash === href) return;
  markSpaNav();
  window.history.pushState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** 标记本次为 SPA 内部导航（下一次详情页挂载时跳过 boot） */
export function markSpaNav() {
  try { sessionStorage.setItem(SPA_NAV_KEY, '1'); } catch { /* 隐私模式忽略 */ }
}

/** 读取并清除 SPA 导航旗标（true = 跳过 boot） */
export function consumeSpaNav(): boolean {
  try {
    const v = sessionStorage.getItem(SPA_NAV_KEY) === '1';
    sessionStorage.removeItem(SPA_NAV_KEY);
    return v;
  } catch {
    return false;
  }
}

/** 详情页 Close：回首页 experience 并停在 projects 段（原站实证行为） */
export function navigateBackToProjects() {
  navigate('/#selected-work');
}
