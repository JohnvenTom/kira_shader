/**
 * TapePage —— 磁带机整页（`#tape` 路由）
 *
 * 功能：
 *  - 提供磁带机的挂载点 #tape-root（固定全屏，覆盖整个视口），并在挂载时调用
 *    createTapeApp() 装配 OHM TAPE 的档案终端与 3D 场景，卸载时调用 dispose()
 *  - 解析 hash 查询参数（形如 `#tape?v=front&p=1&r=03`）交给工厂，
 *    对应原项目的 ?v=&x=&f=&t=&p=&r=&ui=&intro=&fps= 等深链参数
 *
 * 参数：无（无 props：整页由 hash 路由挂载）
 *
 * 返回值：React.ReactElement —— 一个固定全屏的挂载点 div
 *
 * 异常：无（工厂内部异常的展示沿用原项目逻辑：写进加载屏的提示行）
 *
 * 注意事项：
 *  - 挂载/卸载必须成对：工厂持有 WebGL 上下文、音频上下文、window 级监听与主循环，
 *    路由离开时不 dispose 会留下一条永远在跑的主循环
 *  - 该路由在 main.tsx 里不套 StrictMode（与 #trace 一致），避免开发态双挂载
 *    在同一个 root 上注入两次外壳
 *  - 样式由 tape.css 提供（已作用域化到 #tape-root），不影响站内其他页面
 */
import { useEffect, useRef } from 'react';
import { createTapeApp } from './tapeApp.js';
import { tapeAudio } from './tapeAudioStore';
import './tape.css';

/**
 * 解析 hash 里的查询参数
 *
 * 功能：把 `#tape?v=front&p=1` 里的 `?` 之后部分解析为 URLSearchParams；
 *      没有查询串时返回空参数集（此时原项目会播放片头，与 ?intro 缺省一致）
 *
 * 参数：无
 * 返回值：{URLSearchParams} 查询参数
 * 异常：无
 */
function hashQuery(): URLSearchParams {
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  return new URLSearchParams(at >= 0 ? hash.slice(at + 1) : '');
}

export function TapePage() {
  // 挂载点：工厂会把档案终端外壳与画布注入到这个元素内部
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // 音频元素用全站单例：角标在别的页面按过播放，进到本页时走带会直接对齐当前进度
    const app = createTapeApp({ root, audioEl: tapeAudio.element, query: hashQuery() });
    // 卸载：先停工厂（取消主循环、摘监听、释放音频上下文与渲染器），再清空挂载点
    return () => app.dispose();
  }, []);

  return <div id="tape-root" ref={rootRef} style={{ position: 'fixed', inset: 0 }} />;
}