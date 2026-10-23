import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

// === 自动刷新防死循环守卫（模块级：同一页面的多个 Canvas 实例共享计数） ===
// 背景：WebGL 上下文丢失 → reload → 新页面再次丢失 → 再 reload 会形成
// 无限刷新死循环（受限 GPU 环境 / SwiftShader 软件渲染 / GPU 进程反复
// 崩溃时都会出现），表现为浏览器无限重载、控制台警告刷屏。
// 策略：时间窗口内限制自动刷新次数，超过阈值停止刷新并给出显式报错。
const RELOAD_GUARD_KEY = 'ccg:auto-reload-guard';
const RELOAD_GUARD_WINDOW_MS = 15000; // 统计窗口：从首次刷新起 15s
const RELOAD_GUARD_MAX = 2;           // 窗口内最多自动刷新 2 次

/**
 * 自动刷新额度检查
 *
 * 功能：判定本次"上下文丢失自动刷新"是否放行。sessionStorage 记录
 *      { count, firstAt }，窗口过期自动重置；放行时计数 +1。
 *
 * 返回值：true=允许刷新；false=窗口内额度耗尽，拒绝刷新
 * 异常：sessionStorage 不可用（隐私模式）时返回 true（保持原行为）
 */
function canAutoReload(): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    const now = Date.now();
    let entry: { count: number; firstAt: number } | null =
      raw ? JSON.parse(raw) : null;
    if (!entry || now - entry.firstAt > RELOAD_GUARD_WINDOW_MS) {
      entry = { count: 0, firstAt: now };
    }
    entry.count += 1;
    sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify(entry));
    if (entry.count > RELOAD_GUARD_MAX) {
      console.error(
        `[CanvasContextGuard] ${RELOAD_GUARD_WINDOW_MS / 1000}s 内已因 WebGL 上下文丢失自动刷新 ` +
        `${entry.count - 1} 次，判定为持续丢失（GPU 驱动/显存问题或场景资源超限），` +
        '停止自动刷新以避免死循环。请修复根因后手动刷新页面。'
      );
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

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
 *  4. 防死循环：所有自动刷新（恢复路径 + 轮询兜底）都经 canAutoReload()
 *     额度检查——15s 窗口内最多自动刷新 2 次，超过说明上下文持续丢失
 *     （GPU 驱动/显存问题、软件渲染环境），停止刷新并显式报错，避免
 *     "丢失→刷新→再丢失"无限重载循环。
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
      if (!unmountingRef.current && canAutoReload()) window.location.reload();
    };

    // 轮询兜底：GPU 进程崩溃时 webglcontextlost 事件可能不派发，
    // 只能靠周期检查 isContextLost() 发现死者 → 刷新重建
    const timer = window.setInterval(() => {
      if (ctx && typeof ctx.isContextLost === 'function' && ctx.isContextLost()) {
        console.warn('[CanvasContextGuard] 检测到 WebGL 上下文已丢失（轮询兜底），刷新页面');
        if (canAutoReload()) window.location.reload();
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