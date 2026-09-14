import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

/**
 * WebGL 上下文守卫（CanvasContextGuard）
 *
 * 功能：三层防护，解决 demo 间 hash 切换（App ↔ KiraFilmDemo）与详情页
 * 开关导致的 WebGL 渲染停摆问题（典型症状：主页 → #film → 滚轮返回主页
 * 后电脑模型不显示、画面停在异常状态）：
 *  1. 名额释放：卸载时主动调用 forceContextLoss() 立即释放 WebGL 上下文
 *     名额。Chrome 对同页活跃 WebGL 上下文有数量上限（约 16 个），
 *     旧 Canvas 若只删 DOM 不丢上下文，名额靠 GC 延迟回收，反复切换会
 *     触顶，浏览器强制丢弃"最老的上下文"。
 *  2. 被动丢失恢复：非卸载路径的丢失（GPU 重置 / 浏览器强制回收）时
 *     preventDefault 保留恢复机会，并在上下文中断恢复后刷新页面重建
 *     全部渲染资源（three.js 无法完整重建已失效的 GPU 纹理与 Shader
 *     Program，直接刷新是最可靠的恢复手段）。
 *  3. 轮询兜底：Windows/ANGLE 上 GPU 进程崩溃（TDR/显存耗尽）时
 *     webglcontextlost 事件可能根本不派发，context 静默死亡（控制台
 *     只会留下 forceContextLoss 时的 "context already lost" 警告）。
 *     因此每 1s 轮询一次 isContextLost()，发现上下文已死立即刷新，
 *     保障任何情况下页面都能自动恢复，而非永久黑屏。
 *
 * 参数：无（内部通过 useThree 获取 R3F 渲染器）
 *
 * 返回值：null（不渲染任何 DOM，纯逻辑组件）
 *
 * 异常：无
 *
 * 注意事项：
 *  - 必须放在 R3F <Canvas> 内部使用
 *  - 卸载路径（cleanup）与被动丢失路径通过 unmountingRef 区分：
 *    卸载时主动丢上下文不能 preventDefault，否则浏览器会尝试恢复而不是释放
 *  - R3F v8 卸载 Canvas 时约 500ms 后自身还会补一次 forceContextLoss，
 *    与这里的主动释放叠加只会产生一条 "context already lost" 控制台
 *    警告，属于无害噪音
 *  - StrictMode 开发模式下的第一轮挂载/卸载同样受益：
 *    那轮 Canvas 的上下文也会被立即释放，不再泄漏名额
 */
export function CanvasContextGuard() {
  const { gl } = useThree();
  const unmountingRef = useRef(false);

  useEffect(() => {
    const canvas = gl.domElement;
    // 底层 GL 上下文：轮询 isContextLost() 用（GPU 进程崩溃时无事件可监听）
    const ctx = gl.getContext() as WebGLRenderingContext | WebGL2RenderingContext | null;

    // 上下文丢失：卸载主动丢 → 放行默认行为（真正释放）；
    // 被动丢（GPU 重置/浏览器强制回收）→ preventDefault 保留恢复机会
    const onLost = (e: Event) => {
      if (unmountingRef.current) return;
      e.preventDefault();
      console.warn('[CanvasContextGuard] WebGL 上下文丢失，等待浏览器恢复');
    };

    // 上下文恢复：刷新页面，让所有 GPU 资源（纹理/Shader/RT）从零重建
    const onRestored = () => {
      console.warn('[CanvasContextGuard] WebGL 上下文已恢复，刷新页面重建渲染资源');
      if (!unmountingRef.current) window.location.reload();
    };

    // 轮询兜底：GPU 进程崩溃时 webglcontextlost 事件可能不派发，
    // 只能靠周期检查 isContextLost() 发现死者 → 刷新重建
    const timer = window.setInterval(() => {
      if (ctx && typeof ctx.isContextLost === 'function' && ctx.isContextLost()) {
        console.warn('[CanvasContextGuard] 检测到 WebGL 上下文已丢失（轮询兜底），刷新页面');
        window.location.reload();
      }
    }, 1000);

    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);

    return () => {
      // 先打标记再丢上下文：本次 lost 事件属于"主动卸载释放"，不 preventDefault
      unmountingRef.current = true;
      window.clearInterval(timer);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      // 立即释放上下文名额，避免 demo 反复切换累积 WebGL 上下文触顶
      gl.forceContextLoss();
    };
  }, [gl]);

  return null;
}