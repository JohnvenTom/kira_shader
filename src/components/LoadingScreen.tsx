import { useEffect, useRef, useState } from 'react';
import bootScreenUrl from '../assets/textures/boot_screen.png';

/** 进度条格子总数（10 格表示 0~100% 进度） */
const TOTAL_CELLS = 10;

/**
 * 加载屏组件
 *
 * 功能：在 3D 资源加载完成前显示全屏 boot_screen.png 背景图，
 *      并在画面下 1/3 位置展示 10 格进度条（每格代表 10%）。
 *      加载完成后整体淡出。
 *
 * 参数：
 *  - hidden: boolean，true 表示已加载完成，触发淡出
 *
 * 返回值：React.ReactElement
 *
 * 异常：无
 *
 * 注意事项：
 *  - 背景图通过 Vite import 引入，打包时会自动 hash 命名
 *  - 进度采用 RAF 推进，模拟加载；真实场景可替换为 GLTFLoader 的 onLoad 回调
 *  - 进度达到 90% 后停住，等 hidden=true 再瞬间填满 100%，避免提前结束
 */
export function LoadingScreen({ hidden }: { hidden: boolean }) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>(0);

  // 模拟进度推进（真实场景下可替换为 GLTFLoader 的 onLoad 回调）
  useEffect(() => {
    if (hidden) {
      setProgress(100);
      return;
    }
    let p = 0;
    const tick = () => {
      p = Math.min(p + Math.random() * 8, 90);
      setProgress(p);
      if (p < 90) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [hidden]);

  // 当前应点亮的格子数：progress 0~100 → 0~10 格
  // hidden 时直接 10 格全亮，避免最后阶段空格
  const activeCells = hidden
    ? TOTAL_CELLS
    : Math.min(TOTAL_CELLS, Math.floor(progress / 10));

  return (
    <div className={`loading-screen ${hidden ? 'hidden' : ''}`}>
      {/* 全屏背景图（cover 适配，居中） */}
      <img className="loading-bg" src={bootScreenUrl} alt="" />
      {/* 背景遮罩：让进度条区域更聚焦，避免背景抢眼 */}
      <div className="loading-overlay" />

      {/* 10 格进度条：位于画面下 1/3 */}
      <div className="loading-cells">
        {Array.from({ length: TOTAL_CELLS }).map((_, i) => (
          <div
            key={i}
            className={`loading-cell ${i < activeCells ? 'active' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}
