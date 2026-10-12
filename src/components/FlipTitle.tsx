import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

/**
 * FlipTitle —— shader.se #selected-work 项目标题的「旋转棱柱翻牌」复刻
 *
 * 反编译结论(bundle m7/mj/mz):
 *  - 标题贴在长条盒侧面,沿长度分 24 楼,每楼独立弹簧角度 = −π/2·index
 *  - 切换时 mj() 给各段发梯度弹簧:stiffness 120→30 线性递减、
 *    damping 7→13 递增(阻尼比 ≈0.32,欠阻尼,可见多次晃动)
 *    → 前面的段又快又弹,后面的慢半拍,整条波浪式扭转
 *  - 几何附带 sin(time) 呼吸波(±0.06)
 *
 * DOM 等效:标题按字符分列,每列双面(正=旧字,背=新字)绕 Y 轴翻转
 * 180°(过 90° 时换面),列间用梯度时长 + elastic 缓动(≈欠阻尼弹簧)
 * 复现波浪扭转;驻留时叠加 ±0.8° 的微呼吸波。
 *
 * 竞态防护(StrictMode 双挂载 / 快速连续切换):
 *  - 翻牌前 killTweensOf 清掉一切进行中的 tween
 *  - 进行中再次换文:以最新文本为准重启翻牌
 *  - onComplete 只在最后一列,另加兜底超时强制落位
 */

interface FlipTitleProps {
  text: string;
  className?: string;
  /** 切换方向(±1),控制旋转方向 */
  direction?: number;
}

/** 弹性参数:index 0(最左)快而晃 → 1(最右)慢而稳,对齐原版梯度 */
function colTiming(t: number) {
  return {
    duration: 0.5 + 0.55 * t,
    ease: t < 0.5 ? 'elastic.out(1, 0.5)' : 'elastic.out(0.9, 0.62)',
  };
}

const MAX_COL_DURATION = 1.05; // colTiming 最长时长(兜底超时用)

export function FlipTitle({ text, className, direction = 1 }: FlipTitleProps) {
  const [displayed, setDisplayed] = useState(text);
  const [incoming, setIncoming] = useState<string | null>(null);
  const colsRef = useRef<HTMLSpanElement[]>([]);
  const prevTextRef = useRef(text);
  const settlingRef = useRef<string | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);

  // 翻牌落位：换正面文字 + 旋转归零 + 重启呼吸波
  const settle = (finalText: string) => {
    if (settlingRef.current === null) return;
    settlingRef.current = null;
    prevTextRef.current = finalText;
    setDisplayed(finalText);
    setIncoming(null);
    const cols = colsRef.current.filter(Boolean);
    requestAnimationFrame(() => {
      // 先杀干净残留 tween 再归零（否则弹性尾巴会把列重新转走）
      gsap.killTweensOf(cols);
      gsap.set(cols, { rotationY: 0 });
      // 呼吸波(±0.8°,列相位错开;fromTo 强制从 0 起,避免从 180 起跳)
      cols.forEach((col, i) => {
        gsap.fromTo(
          col,
          { rotationY: 0 },
          { rotationY: 0.8, duration: 1.6, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: i * 0.07 }
        );
      });
    });
  };

  // 切换:启动翻牌
  useEffect(() => {
    if (text === prevTextRef.current || text === settlingRef.current) return;
    settlingRef.current = text;
    setIncoming(text);
    // 等 back face 渲染出新字后再翻转
    const t = window.setTimeout(() => {
      if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
      const cols = colsRef.current.filter(Boolean);
      // 清掉一切进行中的翻转/呼吸 tween(防双挂载/快速连续切换的竞态)
      gsap.killTweensOf(cols);
      const n = Math.max(1, cols.length - 1);
      cols.forEach((col, i) => {
        const { duration, ease } = colTiming(i / n);
        gsap.fromTo(
          col,
          { rotationY: 0 },
          { rotationY: 180 * direction, duration, ease, overwrite: true }
        );
      });
      // 兜底:最长时长 +0.6s 后强制落位(onComplete 丢失也不卡死)
      fallbackTimerRef.current = window.setTimeout(() => settle(text), MAX_COL_DURATION * 1000 + 600);
    }, 30);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, direction]);

  // 首次挂载的呼吸波
  useEffect(() => {
    if (settlingRef.current !== null) return;
    const cols = colsRef.current.filter(Boolean);
    const tweens = cols.map((col, i) =>
      gsap.fromTo(
        col,
        { rotationY: 0 },
        { rotationY: 0.8, duration: 1.6, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: i * 0.07 }
      )
    );
    return () => tweens.forEach((w) => w.kill());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载清理
  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
      gsap.killTweensOf(colsRef.current.filter(Boolean));
    };
  }, []);

  const chars = Array.from(displayed);
  const inChars = incoming ? Array.from(incoming) : null;

  return (
    <h1 className={`${className ?? ''} flip-title`} style={{ perspective: '1100px' }}>
      {chars.map((ch, i) => {
        const back = inChars ? (inChars[i] ?? '') : '';
        return (
          <span
            key={i}
            className="flip-col"
            ref={(el) => {
              if (el) colsRef.current[i] = el;
            }}
          >
            <span className="flip-face flip-front">{ch === ' ' ? '\u00A0' : ch}</span>
            <span className="flip-face flip-back" aria-hidden="true">
              {back === ' ' ? '\u00A0' : back}
            </span>
          </span>
        );
      })}
    </h1>
  );
}
