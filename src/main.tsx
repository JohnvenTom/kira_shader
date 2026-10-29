import { Suspense, lazy, useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { FILM_SECTION_BY_HASH } from './filmSectionMap';
import { MusicBoxDock } from './components/tape/MusicBoxDock';
import './styles.css';

// === 页面级懒加载 ===
// 各页面组件按 hash 路由互斥渲染，改为 React.lazy 按需加载：
// 首页（无 hash）不再静态打包其余页面代码。此前 WorkAboutExperience 及其
// hero/selected-work/about 场景静态 import 了 'three/webgpu' + 'three/tsl'
// （WebGPU 构建），与首页使用的 'three'（WebGL 构建）形成两份完整 three
// 内核同时加载——控制台 "WARNING: Multiple instances of Three.js" 即由此来，
// 内存占用翻倍且加大 GPU 进程压力，受限环境（集显/软件渲染）下易触发
// WebGL 上下文丢失。懒加载后任一时刻只加载一个 three 构建。
const App = lazy(() => import('./App'));
const KiraFilmDemo = lazy(() => import('./KiraFilmDemo'));
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
 * （原 useHashRoute 已并入顶部 useRoute：pathname+hash 双模路由）
 */

/**
 * 应用入口
 *
 * 功能：根据 URL（pathname + hash）决定渲染哪个页面
 *  - /work/<slug>    → experience 的 project 模式（shader.se 详情子页复刻，路径路由）
 *  - 无 hash / 其他未知 hash → App（ComputerScene 版落地页）
 *  - #film           → KiraFilmDemo（多 section 滚动版，起始帧由 sessionStorage 恢复决定）
 *  - #home/#work/#about → KiraFilmDemo（起始帧由锚点映射决定，不再退出胶片页）
 *  - #contact        → WorkAboutExperience 的 Contact 段（电话 3D + 联系页脚）
 *  - #trace          → TraceDetailPage（trace 作品展示页）
 *  - #tape           → TapePage（磁带机整页，hash 后可带查询串，如 #tape?p=1）
 *
 * 参数：无
 * 返回值：无
 * 异常：若 #root 不存在会抛出 TypeError
 *
 * 注意事项：
 *  - 四个导航锚点现在也渲染胶片页：胶片页内的跳帧由 KiraFilmDemo 的 hashchange 监听完成
 *    （组件 key 固定为 'film'，不重新 mount，所以切锚点不会重放白闪入场）
 *  - 路由切换（popstate/hashchange）触发完整重渲染（组件树替换），
 *    适合不同页面间切换；若想保留状态请用路由库
 */
function Root() {
  const { pathname, hash } = useRoute();
  // /work/<slug>：详情页路径路由（原站 Next.js 同构；SPA 内部跳转走 pushState）
  const workSlug = pathname.match(/^\/work\/([\w-]+)\/?$/)?.[1];
  const isTape = hash.split('?')[0] === '#tape';
  const isBadge = hash.split('?')[0] === '#badge';
  // #hero：shader.se 首页（全站 experience 的 hero 段；boot 仅首载播放）
  const isHero = hash.split('?')[0] === '#hero';
  // #selected-work：Selected Work 视口（全站 experience 的 projects 段停驻点）
  const isSelectedWork = hash.split('?')[0] === '#selected-work';
  // #about-us：About Us 页（与线上一致）；#about 作为别名重定向
  const isAboutUs = hash.split('?')[0] === '#about-us';
  // #contact：碎纸终幕之后的电话 3D / 联系页脚段
  const isContact = hash.split('?')[0] === '#contact';
  useEffect(() => {
    if (hash.split('?')[0] === '#about') {
      window.location.replace(`${window.location.pathname}${window.location.search}#about-us`);
    }
  }, [hash]);
  const isFilm =
    hash === '#film' || FILM_SECTION_BY_HASH[hash] !== undefined;
  // 页面本体：互斥
  const page = workSlug || isHero || isSelectedWork || isAboutUs || isContact
      ? // 全站统一 experience：一根全局 0→22.16 的轴、一块画布、一个渲染器，
        // hash 只做模式映射（mode 决定初始轴位），路由间不重挂载（key 恒定）。
        // /work/<slug> 不再挂独立页面：它是同一 experience 的 project 模式（原站子页同构），
        // 这样从胶片点进详情时主画布不卸载，才能做 subPage spring 入场。
        (
          <WorkAboutExperience
            key="work-about"
            mode={workSlug ? 'project' : isHero ? 'hero' : isSelectedWork ? 'work' : isContact ? 'contact' : 'about'}
            projectSlug={workSlug}
          />
        )
      : hash.split('?')[0] === '#about'
        // #about → #about-us 的重定向瞬间：先渲染空页，避免旧胶片页闪一帧
        ? null
    : isTape
    // #tape：磁带机整页（音乐盒角标点进来的完整页）。与 #trace 一样不套 StrictMode：
    // 工厂会把外壳注入挂载点，双挂载会注入两次；dispose 由 TapePage 负责
    ? <TapePage key="tape" />
    : isBadge
      // #badge：3D 工牌独立页（本次移植验证页）。场景自带幂等 dispose，
      // 但要避免 StrictMode 双挂载把 Rapier 世界建两遍，故不套 StrictMode
      ? <BadgePage key="badge" />
      : hash === '#trace'
        ? <TraceDetailPage key="trace" />
        : (
          // key 强制 remount，避免两个 demo 的 useEffect/资源互相污染。
          // 不套 StrictMode：dev 双挂载会让 R3F Canvas 在启动瞬间经历
          // 挂载→卸载(forceContextLoss)→重挂，SwiftShader/受限 GPU 环境
          // 下频繁的上下文创建销毁会连带杀死新上下文（页面加载秒丢
          // WebGL context → 触发 CanvasContextGuard 自动刷新循环）。
          // TapePage/BadgePage 出于同样理由也不走 StrictMode
          isFilm ? (
            <KiraFilmDemo key="film" hashSection={FILM_SECTION_BY_HASH[hash]} />
          ) : (
            <App key="app" />
          )
        );
  return (
    // Suspense：lazy 页面 chunk 加载期间渲染 null。
    // 跨页 hash 切换本就有白闪/转场掩盖，首载的空白窗口由各页 boot 屏接管，
    // 无需骨架屏；各页代码分包后仅当前路由的 chunk 会被拉取
    <Suspense fallback={null}>
      {page}
      {/* 音乐盒角标：全站常驻（#tape 自身除外，那页里它没有意义）。
          放在这里是为了让它跨路由保持在同一个位置、不被卸载 —— 它订阅的是
          tapeAudioStore 这个模块级单例，音频因此不会因路由切换而中断。
          BGM 开屏引导已融合进首页 boot 屏（BIOS 文字行，见 App.tsx），
          其他页面直链的首次交互由 tapeAudio 全局钩子兜底 */}
      {!isTape && !isBadge && !isHero && !isSelectedWork && !isAboutUs && !isContact && !workSlug && <MusicBoxDock />}
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
