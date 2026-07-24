import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import KiraFilmDemo from './KiraFilmDemo';
import './styles.css';

/**
 * 根据 URL hash 选择渲染的根组件
 *
 * 功能：
 *  - 默认（无 hash 或 #home）：渲染 App（原 ComputerScene 单 section 版本）
 *  - #film：渲染 KiraFilmDemo（多 section 滚动 + 无缝切换版）
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
 *  - 无 hash / #home → App（ComputerScene 版）
 *  - #film           → KiraFilmDemo（多 section 滚动版）
 *
 * 参数：无
 * 返回值：无
 * 异常：若 #root 不存在会抛出 TypeError
 *
 * 注意事项：hash 切换会触发完整重渲染（组件树替换），
 *          适合不同 demo 间切换；若想保留状态请用路由库
 */
function Root() {
  const hash = useHashRoute();
  const isFilm = hash === '#film';
  // key 强制 remount，避免两个 demo 的 useEffect/资源互相污染
  return <React.StrictMode>{isFilm ? <KiraFilmDemo key="film" /> : <App key="app" />}</React.StrictMode>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
