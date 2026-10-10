/**
 * boot 流程控制器（挂在 Canvas 内、场景组件之前）
 *
 * 功能：
 *  - 资产加载阶段结束后执行 GPU 预热：先 renderer.compile 预编译全部材质，
 *    再连续渲染若干帧直到帧时间稳定——吃掉首次交互的着色器编译/纹理上传卡顿
 *    （shader.se 用"假滚动预扫描"预热整站页面；本站是单场景，预热的等价形式
 *    就是"编译 + 稳帧"，目标相同：显现后零卡顿）
 *  - 每帧 tickBoot 推进状态机（进度条阻尼显示值、500ms 静置、显现弹簧）
 *
 * 预热完成条件（满足其一）：
 *  - 渲染满 24 帧（约 0.4s@60fps，覆盖首帧编译与纹理上传）
 *  - 至少 8 帧且当前帧间隔 < 8ms（快机器提前毕业）
 *  - 超时 3s（慢机器兜底，不把用户卡在进度条上）
 *
 * 注意：不渲染任何对象；useFrame 不设正 priority（不接管渲染），
 *      放在 Canvas 子列表首位保证先于相机/场景的 useFrame 执行。
 */
import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { bootStore, markBootAudioOn, markBootWarmupDone, resetBoot, setBootWarmupProgress, tickBoot } from '../boot/bootStore';
import { tapeAudio } from './tape/tapeAudioStore';

/** 预热帧数目标 */
const WARMUP_FRAMES = 24;
/** 提前毕业：最少帧数 + 单帧间隔阈值（秒） */
const WARMUP_MIN_FRAMES = 8;
const WARMUP_FAST_FRAME = 0.008;
/** 预热超时（毫秒） */
const WARMUP_TIMEOUT_MS = 3000;

export function BootController() {
  const { gl, scene, camera } = useThree();
  const warmupRef = useRef({ compiled: false, frames: 0, startedAt: 0 });

  // 挂载即重置 boot 状态机：从胶片页等路由返回首页时重放整段 boot 编排
  // （盖住模型/屏幕重建的空窗，并让标题门重新走一遍）。本组件是 Canvas
  // 的第一个子元素，effect 先于兄弟场景组件执行，重置不会误清已完成的
  // 缓存资产登记
  useEffect(() => {
    resetBoot();
    // 竞态修补：resetBoot 清掉 audioOn，但音乐可能已经在响（浏览器放行了
    // 无手势自动播放——App 挂载时订阅同步来的置位发生在本 reset 之前，
    // 会被误杀）。reset 后按音频实际状态补一次置位，让 boot 屏直接显示
    // "AUDIO: ON" 而非误导用户再点一次的提示行
    if (tapeAudio.state.playing) markBootAudioOn();
  }, []);

  useFrame((_state, delta) => {
    // === GPU 预热阶段 ===
    if (bootStore.phase === 'warmup') {
      const w = warmupRef.current;
      if (!w.compiled) {
        w.compiled = true;
        w.startedAt = performance.now();
        try {
          // 预编译场景全部材质（Draco 模型 + 后处理外的场景材质）
          gl.compile(scene, camera);
        } catch (e) {
          // 预编译失败不阻塞流程——后续渲染仍会即时编译
          console.warn('[BootController] gl.compile 预热失败:', e);
        }
      }
      w.frames++;
      setBootWarmupProgress(Math.min(1, w.frames / WARMUP_FRAMES));
      const fastOk = w.frames >= WARMUP_MIN_FRAMES && delta < WARMUP_FAST_FRAME;
      const timeout = performance.now() - w.startedAt > WARMUP_TIMEOUT_MS;
      if (w.frames >= WARMUP_FRAMES || fastOk || timeout) {
        setBootWarmupProgress(1);
        markBootWarmupDone();
      }
    }

    // === 状态机：阻尼显示值 + 静置 + 弹簧 ===
    tickBoot(delta);
  });

  return null;
}
