/**
 * TapePage —— 磁带机整页（`#tape` 路由）
 *
 * 功能：
 *  - 提供磁带机的挂载点 #tape-root（固定全屏，覆盖整个视口），并在挂载时调用
 *    createTapeApp() 装配 OHM TAPE 的档案终端与 3D 场景，卸载时调用 dispose()
 *  - 解析 hash 查询参数（形如 `#tape?v=front&p=1&r=03`）交给工厂，
 *    对应原项目的 ?v=&x=&f=&t=&p=&r=&ui=&intro=&fps= 等深链参数
 *  - 进出的展开 / 收闭过渡（见 tapeTransition）：
 *      · 展开：挂载首帧前先把整页按"来源矩形"摆好（transform 平移 + 缩放），
 *        面板先在原地由角标的深色芯片色过到纸色，再展开到全屏；加载屏与终端 UI
 *        在展开开始 150ms 后才淡入（避免 20 倍放大初期的"文字尘埃"）
 *      · 收闭：先让房间整套暗到暗房（beginExit 把换灯时钟压到 420ms），180ms 后
 *        整页（含 3D 画布）缩回角标矩形，落地才换路由 —— 顺序不能反，
 *        hash 一变整页就被卸载，没有可缩的东西了
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
 *  - 该路由在 main.tsx 里不套 StrictMode（与 #trace 一致）：工厂会把外壳注入挂载点，
 *    双挂载会注入两次；过渡里的定时器也按"单次挂载"设计
 *  - 变形/过渡全部走 CSS（见 tapeTransition.css）：合成器线程上的动画不受 boot 编着色器
 *    的主线程压力影响；时间常量由 tapeTransition.TIMING 经 CSS 变量下发，两边不会对不上
 *  - prefers-reduced-motion 下整套过渡退化成瞬时（不播动画，直接落位）
 */
import { useEffect, useRef } from 'react';
import { createTapeApp } from './tapeApp.js';
import { tapeAudio } from './tapeAudioStore';
import {
  TIMING,
  consumeOrigin,
  finishClose,
  landingRect,
  markClosing,
  onCloseRequest,
  reduceMotion,
} from './tapeTransition';
import './tape.css';
import './tapeTransition.css';

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

    /* 时间常量下发到 CSS：JS 排定时器、CSS 跑过渡，用的是同一组数字 */
    root.style.setProperty('--tt-recolor', `${TIMING.panelRecolor}ms`);
    root.style.setProperty('--tt-expand', `${TIMING.panelExpand}ms`);
    root.style.setProperty('--tt-content', `${TIMING.contentIn}ms`);
    root.style.setProperty('--tt-content-delay', `${TIMING.contentDelay}ms`);
    root.style.setProperty('--tt-shrink', `${TIMING.shrink}ms`);

    const reduce = reduceMotion();
    const origin = consumeOrigin();
    const timers: number[] = [];
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;

    /**
     * 收闭：先关灯，再整页缩回角标，落地后才换路由
     *
     * 功能：由页头 BACK TO SITE 触发（工厂的 onExit）——先 beginExit 把房间整套暗到暗房，
     *      closeDelay 后把整页 transform 缩到角标矩形，收缩结束再 finishClose() 换路由
     *
     * 参数：无
     * 返回值：无
     * 异常：无（重复触发被 markClosing 挡掉）
     */
    const close = () => {
      if (!markClosing()) return;
      if (reduce) { finishClose(); return; }
      app.beginExit(TIMING.dimTheme / 1000);
      root.classList.add('is-leaving');
      /* 先把当前姿态显式钉成"单位变换列表"：起点与终点是同形状的变换列表，
         插值由规范明确保证（不去依赖 matrix ↔ none 那一对能不能插） */
      root.style.transformOrigin = '0 0';
      root.style.transform = 'translate(0px, 0px) scale(1, 1)';
      timers.push(window.setTimeout(() => {
        const land = landingRect();
        root.style.transform =
          `translate(${land.x}px, ${land.y}px) scale(${land.w / W()}, ${land.h / H()})`;
        timers.push(window.setTimeout(() => finishClose(), TIMING.shrink + 30));
      }, TIMING.closeDelay));
    };

    /* 展开的第一步在挂载首帧之前：先把整页摆到角标矩形上（深色芯片态），
       否则会先闪一帧全屏页面才缩回去 */
    if (origin && !reduce) {
      root.classList.add('is-entering');
      root.style.transformOrigin = '0 0';
      root.style.transform =
        `translate(${origin.x}px, ${origin.y}px) scale(${origin.w / W()}, ${origin.h / H()})`;
    }

    const app = createTapeApp({
      root,
      audioEl: tapeAudio.element,
      query: hashQuery(),
      onExit: close,
    });
    onCloseRequest(close);

    if (origin && !reduce) {
      /* 第二拍：深色过到纸色（panelRecolor，CSS 里跑），随后开始展开 */
      timers.push(window.setTimeout(() => {
        root.classList.add('is-expanding');
        /* 展开到的是"显式单位变换列表"而不是 none：与起点同形状，插值一定成立 */
        root.style.transform = 'translate(0px, 0px) scale(1, 1)';
        timers.push(window.setTimeout(() => {
          /* 展开结束后卸掉过渡态：::before/::after 的深色与发丝线随之消失，
             内容的淡入动画也交还给元素自己的样式（此时都已是终态，不会跳） */
          root.classList.remove('is-entering', 'is-expanding');
          root.style.transform = '';
          root.style.transformOrigin = '';
        }, TIMING.panelExpand + 40));
      }, TIMING.panelRecolor));
    }

    return () => {
      for (const t of timers) window.clearTimeout(t);
      onCloseRequest(null);
      app.dispose();
    };
  }, []);

  /* data-theme 必须一开始就在：原项目把这个属性写在 <html data-theme="studio"> 上，
     面板与加载屏的纸色（var(--paper)）全靠它。搬运时只抽了 <body>，漏掉它就会让
     boot 到 88%（setTheme 那一步）之前的整块底是透明的 —— 展开时看到的就是一片黑。
     默认值与原项目一致：影棚。 */
  return <div id="tape-root" data-theme="studio" ref={rootRef} style={{ position: 'fixed', inset: 0 }} />;
}