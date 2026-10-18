/**
 * 3D 工牌独立页面（对应站点首页 hero 的工牌区块）
 *
 * 复刻站点的加载链路：
 *  1. 先显示静态占位 + 状态文案
 *  2. 等 document.readyState === 'complete'（否则挂一次性 load）
 *  3. 进 requestIdleCallback（兜底 1ms 定时器，超时 1500ms）
 *  4. 空闲里动态 import 场景模块（Vite 会把它和 Rapier 一起切成分包，不拖累首屏）
 *  5. 创建成功后连等两个 rAF 才把 canvas 显示出来（避免第一帧闪烁）
 *  6. 失败则保留占位 + 记录错误
 *  7. 卸载时 dispose（幂等），并处理 StrictMode 双挂载下"场景比卸载晚到"的情况
 *
 * 注意事项：
 *  - 窄屏（≤700px）与站点一致：直接不跑 3D，退化成静态印刷图
 *  - 本页为独立验证页；正式并入站点时可以整段搬走
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  pickBadgeConfigFromUrl,
  type BadgeConfig,
} from './badgeConfig';
import { createKiraBadgeArtwork } from './badgeTextures';
import type { BadgeSceneHandle, BadgeSceneStage } from './createBadgeScene';
import './badgePage.css';

/** 页面阶段（在场景状态之外多一个"窄屏静态"） */
type PageStage = BadgeSceneStage | 'idle' | 'static';

/** 窄屏断点（与站点一致） */
const NARROW_BREAKPOINT = 700;

/**
 * 3D 工牌独立页面组件
 *
 * 功能：承载 canvas、执行懒加载时序、提供少量调试控件（复位 / 轻推 / 暂停 / 视角）。
 *
 * 参数：无
 * 返回值：React.ReactElement
 * 异常：无
 *
 * 注意事项：
 *  - 配置对象放在 ref 里（场景每帧读它），调试控件只改 ref 里的字段，不触发重渲染
 *  - 场景包用 `import()` 动态引入，保证 Rapier（约 2.8MB）不进主包
 */
export default function BadgePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<BadgeSceneHandle | null>(null);
  const configRef = useRef<BadgeConfig>(pickBadgeConfigFromUrl());
  const [stage, setStage] = useState<PageStage>('idle');
  const [ready, setReady] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`).matches);
  const [paused, setPaused] = useState(false);

  // 窄屏静态图：只在需要时才生成（避免桌面端白跑一次 1024×1400 画布绘制）
  const stillSrc = useMemo(() => {
    if (!isNarrow) return '';
    return createKiraBadgeArtwork(1024, 1400).toDataURL('image/png');
  }, [isNarrow]);

  // URL 带 ?filter 时站点会启用滤镜/绘图仪后处理管线，本版尚未接入，明确提示一次
  useEffect(() => {
    if (configRef.current.filters.enabled || configRef.current.plotter.enabled) {
      console.warn(
        '[badge] ?filter 模式的滤镜/绘图仪后处理管线尚未接入（v1 直出渲染）；' +
          '默认（不带参数）模式与线上观感一致。'
      );
    }
  }, []);

  const handleStage = useCallback((next: BadgeSceneStage) => {
    setStage(next);
    if (next === 'paused') setPaused(true);
    if (next === 'live' || next === 'dragging') setPaused(false);
  }, []);

  useEffect(() => {
    const narrowQuery = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`);
    const onNarrowChange = () => setIsNarrow(narrowQuery.matches);
    narrowQuery.addEventListener('change', onNarrowChange);
    return () => narrowQuery.removeEventListener('change', onNarrowChange);
  }, []);

  useEffect(() => {
    // 窄屏降级：不启动 3D（与站点的 matchMedia 判定一致）
    if (isNarrow) {
      setStage('static');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let idleId = 0;
    let rafId = 0;

    const start = () => {
      // requestIdleCallback 兜底：老浏览器退化成 setTimeout(..., 1)
      const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
      idleId = idle(
        () => {
          import('./createBadgeScene')
            .then(({ createBadgeScene }) => createBadgeScene(canvas, () => configRef.current, handleStage))
            .then((handle) => {
              if (cancelled) {
                handle.dispose();
                return;
              }
              handleRef.current = handle;
              // 连等两个 rAF 再显示 canvas：保证已经有画面，切换不闪白
              rafId = requestAnimationFrame(() => {
                rafId = requestAnimationFrame(() => {
                  if (!cancelled) setReady(true);
                });
              });
            })
            .catch((error) => {
              if (cancelled) return;
              setStage('error');
              console.error('Badge could not start:', error);
            });
        },
        { timeout: 1500 }
      );
    };

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener('load', start);
      const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
      if (idleId) cancelIdle(idleId);
      cancelAnimationFrame(rafId);
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [isNarrow, handleStage]);

  return (
    <div className="badge-page">
      {/* 静态占位：3D 就绪后隐藏（站点用一张 webp 做同样的事） */}
      <div className="badge-page-still" hidden={ready || isNarrow}>
        <span className="badge-page-still-text">
          {stage === 'error' ? 'BADGE FAILED TO START — 见控制台' : 'LOADING BADGE…'}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        className="badge-page-canvas"
        hidden={!ready}
        data-state={stage}
        aria-label="Kira Shader 的 3D 工牌，可以拖动"
      />

      {/* 窄屏降级：直接给静态印刷图（站点也是这么做的） */}
      {isNarrow && (
        <div className="badge-page-static">
          {stillSrc && <img src={stillSrc} alt="工牌静态图" />}
          <p>窄屏（≤{NARROW_BREAKPOINT}px）未启用 3D，与参考站点行为一致。</p>
        </div>
      )}

      {/* 调试条：仅用于本次移植验收，正式并入站点时删除 */}
      <div className="badge-page-debug">
        <span className="badge-page-debug-state">
          {isNarrow ? 'static' : stage}
          {ready ? ' · ready' : ''}
        </span>
        <button type="button" onClick={() => handleRef.current?.reset()}>
          复位
        </button>
        <button type="button" onClick={() => handleRef.current?.nudge()}>
          轻推
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !paused;
            setPaused(next);
            handleRef.current?.setPaused(next);
          }}
        >
          {paused ? '恢复' : '暂停'}
        </button>
        <label>
          环绕
          <input
            type="range"
            min={-35}
            max={35}
            step={0.5}
            defaultValue={configRef.current.view.angle}
            onChange={(event) => {
              configRef.current.view.angle = Number(event.target.value);
            }}
          />
        </label>
        <label>
          缩放
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.01}
            defaultValue={configRef.current.view.zoom}
            onChange={(event) => {
              configRef.current.view.zoom = Number(event.target.value);
            }}
          />
        </label>
      </div>
    </div>
  );
}
