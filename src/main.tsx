import { Suspense, lazy, useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { MusicBoxDock } from './components/tape/MusicBoxDock';
import './styles.css';

// === 页面级懒加载 ===
// 各页面按 URL 互斥渲染，React.lazy 保证任一时刻只加载一份 three 构建
// （WebGPU experience 与独立页各自按需拉取）。
const TraceDetailPage = lazy(() => import('./components/trace/TraceDetailPage'));
const TapePage = lazy(() => import('./components/tape/TapePage').then((m) => ({ default: m.TapePage })));
const BadgePage = lazy(() => import('./components/badge/BadgePage'));
const WorkAboutExperience = lazy(() => import('./work-about/WorkAboutExperience'));

/**
 * 统一路由状态（pathname + hash）
 *
 * 原站是 Next.js 路径路由 + hash 混搭（/ 与 /work/<slug> 为路径，
 * #selected-work 为首页 experience 锚点）。本站对齐同一语义：
 *  - 路径 /work/<slug> → 全站 experience 的 project 模式（详情子页；原站同构，一块画布）
 *  - hash 路由维持既有页面映射不变
 * popstate（pushState 内部导航 + 浏览器前进后退）与 hashchange 都会更新。
 */
function useRoute() {
  const [route, setRoute] = useState(() => ({
    pathname: window.location.pathname,
    hash: window.location.hash,
  }));

  useEffect(() => {
    const update = () => setRoute({ pathname: window.location.pathname, hash: window.location.hash });
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
    };
  }, []);

  return route;
}

/**
 * 应用入口
 *
 * 功能：根据 URL（pathname + hash）决定渲染哪个页面
 *  - /work/<slug>                          → experience project 模式（详情子页）
 *  - #hero/#selected-work/#about-us/#contact → experience 对应模式（hash 只决定初始轴位/主题）
 *  - #tape                                 → TapePage（磁带机整页，hash 后可带查询串）
 *  - #badge                                → BadgePage（3D 工牌独立页）
 *  - #trace                                → TraceDetailPage（trace 作品展示页）
 *  - 其余（含 /、旧 #film/#home/#work/#about 与未知 hash）→ experience hero
 *
 * 注意事项：
 *  - experience 内部不重挂载：key 恒定为 'work-about'，hash 只改 mode
 *  - 旧锚点不做兼容重定向，统一按未知 hash 落到 hero
 */
function Root() {
  const { pathname, hash } = useRoute();
  // /work/<slug>：详情页路径路由（原站 Next.js 同构；SPA 内部跳转走 pushState）
  const workSlug = pathname.match(/^\/work\/([\w-]+)\/?$/)?.[1];
  const baseHash = hash.split('?')[0];
  const isTape = baseHash === '#tape';
  const isBadge = baseHash === '#badge';
  // 全站统一 experience：一根全局 0→22.16 的轴、一块画布、一个渲染器
  const isExperience =
    Boolean(workSlug) ||
    baseHash === '#hero' ||
    baseHash === '#selected-work' ||
    baseHash === '#about-us' ||
    baseHash === '#contact';
  const mode: 'hero' | 'work' | 'about' | 'contact' | 'project' = workSlug
    ? 'project'
    : baseHash === '#selected-work'
      ? 'work'
      : baseHash === '#about-us'
        ? 'about'
        : baseHash === '#contact'
          ? 'contact'
          : 'hero';
  // 页面本体：互斥
  const page = isExperience ? (
    <WorkAboutExperience key="work-about" mode={mode} projectSlug={workSlug} />
  ) : isTape ? (
    // #tape：磁带机整页（音乐盒角标点进来的完整页）。不套 StrictMode：
    // 工厂会把外壳注入挂载点，双挂载会注入两次；dispose 由 TapePage 负责
    <TapePage key="tape" />
  ) : isBadge ? (
    // #badge：3D 工牌独立页。场景自带幂等 dispose，但要避免 StrictMode
    // 双挂载把 Rapier 世界建两遍，故不套 StrictMode
    <BadgePage key="badge" />
  ) : baseHash === '#trace' ? (
    <TraceDetailPage key="trace" />
  ) : (
    // 旧锚点 / 未知 hash：不重定向，直接落 hero（key 与 experience 分支一致，不重挂载）
    <WorkAboutExperience key="work-about" mode="hero" />
  );
  return (
    // Suspense：lazy 页面 chunk 加载期间渲染 null，首载空白由各页 boot 屏接管
    <Suspense fallback={null}>
      {page}
      {/* 音乐盒角标：仅在独立页（#trace）常驻；experience 页没有入口 */}
      {!isExperience && !isTape && !isBadge && baseHash === '#trace' && <MusicBoxDock />}
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
