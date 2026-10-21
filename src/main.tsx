import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import KiraFilmDemo, { FILM_SECTION_BY_HASH } from './KiraFilmDemo';
import TraceDetailPage from './components/trace/TraceDetailPage';
import { TapePage } from './components/tape/TapePage';
import { MusicBoxDock } from './components/tape/MusicBoxDock';
import BadgePage from './components/badge/BadgePage';
import HeroOneToOne from './hero/HeroOneToOne';
import WorkAboutExperience from './work-about/WorkAboutExperience';
import './styles.css';

/**
 * 根据 URL hash 选择渲染的根组件
 *
 * 功能：
 *  - 默认（无 hash 或 #home）：渲染 App（原 ComputerScene 单 section 版本）
 *  - #film：渲染 KiraFilmDemo（多 section 滚动 + 无缝切换版）
 *  - #trace：渲染 TraceDetailPage（trace 作品滚动叙事展示页）
 *
 * 参数：无
 *
 * 返回值：React.ReactElement 当前要渲染的根组件
 *
 * 异常：无
 *
 * 注意事项：
 *  - hash 变化时不会自动重渲染，需要监听 hashchange 事件
 *  - 用 useState 触发重渲染，hashchange 回调里 setState 即可
 */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return hash;
}

/**
 * 应用入口
 *
 * 功能：根据 URL hash 决定渲染哪个 demo
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
 *  - hash 切换会触发完整重渲染（组件树替换），
 *    适合不同 demo 间切换；若想保留状态请用路由库
 */
function Root() {
  const hash = useHashRoute();
  const isTape = hash.split('?')[0] === '#tape';
  const isBadge = hash.split('?')[0] === '#badge';
  // #hero：shader.se 首页 1:1 复刻页（three/webgpu + TSL 合成管线）
  const isHero = hash.split('?')[0] === '#hero';
  // #selected-work：Selected Work 视口独立页（也作为 hero 穿越终点的落地页）
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
  const page = isHero
    // #hero：不套 StrictMode —— 它会手动创建 WebGPURenderer 并在 effect 里 await init()，
    // 双挂载会并发建两个设备；资源释放由组件自身的 cleanup 负责
    ? <HeroOneToOne key="hero" />
    : isSelectedWork || isAboutUs || isContact
      // Selected Work / About Us / Contact 共用一个稳定的 experience：渲染器、合成链和
      // 3D 场景跨路由常驻，孔洞转场与碎纸后的 Contact 衔接期间不会重新初始化 WebGPU
      ? (
          <WorkAboutExperience
            key="work-about"
            mode={isSelectedWork ? 'work' : isContact ? 'contact' : 'about'}
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
          // key 强制 remount，避免两个 demo 的 useEffect/资源互相污染
          <React.StrictMode>
            {isFilm ? (
              <KiraFilmDemo key="film" hashSection={FILM_SECTION_BY_HASH[hash]} />
            ) : (
              <App key="app" />
            )}
          </React.StrictMode>
        );
  return (
    <>
      {page}
      {/* 音乐盒角标：全站常驻（#tape 自身除外，那页里它没有意义）。
          放在这里是为了让它跨路由保持在同一个位置、不被卸载 —— 它订阅的是
          tapeAudioStore 这个模块级单例，音频因此不会因路由切换而中断。
          BGM 开屏引导已融合进首页 boot 屏（BIOS 文字行，见 App.tsx），
          其他页面直链的首次交互由 tapeAudio 全局钩子兜底 */}
      {!isTape && !isBadge && !isHero && !isSelectedWork && !isAboutUs && !isContact && <MusicBoxDock />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
