import { Suspense, lazy, useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

// 全站唯一入口：lazy 保证 experience（three/webgpu 构建）按需加载
const WorkAboutExperience = lazy(() => import('./work-about/WorkAboutExperience'));

/**
 * 统一路由状态（pathname + hash）
 *
 * 原站是 Next.js 路径路由 + hash 混搭（/ 与 /work/<slug> 为路径，
 * #selected-work 为首页 experience 锚点）。本站对齐同一语义：
 *  - 路径 /work/<slug> → 全站 experience 的 project 模式（详情子页；原站同构，一块画布）
 *  - hash 锚点只决定 experience 的初始模式
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
 * 功能：根据 URL（pathname + hash）决定 experience 的初始模式
 *  - /work/<slug>                          → project（详情子页）
 *  - #hero/#selected-work/#about-us/#contact → hero/work/about/contact
 *  - 其余（含 /、旧 #film/#home/#work/#about 与未知 hash）→ hero
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
  const mode: 'hero' | 'work' | 'about' | 'contact' | 'project' = workSlug
    ? 'project'
    : baseHash === '#selected-work'
      ? 'work'
      : baseHash === '#about-us'
        ? 'about'
        : baseHash === '#contact'
          ? 'contact'
          : 'hero';
  return (
    // Suspense：lazy chunk 加载期间渲染 null，首载空白由 experience 的 boot 屏接管
    <Suspense fallback={null}>
      <WorkAboutExperience key="work-about" mode={mode} projectSlug={workSlug} />
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
