import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

/**
 * FlipTitle —— shader.se #selected-work 项目标题「旋转棱柱翻牌」的 DOM 复刻
 *
 * 反编译结论(bundle m7/mj/mz):
 *  - 标题贴在长条盒侧面,沿长度 24 段各持独立弹簧角度(= −π/2·index)
 *  - 切换时 mj() 发梯度弹簧:stiffness 120→30 递减、damping 7→13 递增
 *    (阻尼比≈0.32 欠阻尼)→ 前段快而晃、后段慢半拍,波浪式扭转
 *  - 附带 sin(time) 呼吸波(±0.06)
 *
 * DOM 结构(对齐原版"整条分段",而非逐字符):
 *  h1 (grid 叠层, perspective)
 *   ├ ghost ×2(新旧文字,同格叠放 → 撑出 max 宽高,隐形)
 *   └ stage(同格覆盖)
 *      └ slice ×8(overflow hidden 的竖向条带,各占 1/8 宽)
 *         └ rot(preserve-3d,绕 Y 翻转的旋转体)
 *            ├ face 正(整条旧文字,宽=容器,左移 -i/8)
 *            └ face 背(rotateY 180°,整条新文字)
 *  每个条带显示完整文字的对应水平切片 → 任意时刻排版都是正确的;
 *  settle 只换隐形 ghost,不再有"等一会才恢复正常样式"的问题。
 */

const SLICES = 8;

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

const MAX_DURATION = 1.05;

export function FlipTitle({ text, className, direction = 1 }: FlipTitleProps) {
  const [displayed, setDisplayed] = useState(text);
  const [incoming, setIncoming] = useState<string | null>(null);
  const rotsRef = useRef<HTMLDivElement[]>([]);
  const prevTextRef = useRef(text);
  const settlingRef = useRef<string | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);

  const startWobble = () => {
    const rots = rotsRef.current.filter(Boolean);
    rots.forEach((rot, i) => {
      gsap.fromTo(
        rot,
        { rotationY: 0 },
        { rotationY: 0.8, duration: 1.6, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: i * 0.07 }
      );
    });
  };

  // 翻牌落位：换正面文字 + 旋转归零 + 重启呼吸波
  const settle = (finalText: string) => {
    if (settlingRef.current === null) return;
    settlingRef.current = null;
    prevTextRef.current = finalText;
    setDisplayed(finalText);
    setIncoming(null);
    requestAnimationFrame(() => {
      const rots = rotsRef.current.filter(Boolean);
      gsap.killTweensOf(rots);
      gsap.set(rots, { rotationY: 0 });
      startWobble();
    });
  };

  // 切换:启动翻牌
  useEffect(() => {
    if (text === prevTextRef.current || text === settlingRef.current) return;
    settlingRef.current = text;
    setIncoming(text);
    const t = window.setTimeout(() => {
      if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
      const rots = rotsRef.current.filter(Boolean);
      gsap.killTweensOf(rots);
      const n = Math.max(1, rots.length - 1);
      rots.forEach((rot, i) => {
        const { duration, ease } = colTiming(i / n);
        gsap.fromTo(
          rot,
          { rotationY: 0 },
          { rotationY: 180 * direction, duration, ease, overwrite: true }
        );
      });
      fallbackTimerRef.current = window.setTimeout(() => settle(text), MAX_DURATION * 1000 + 600);
    }, 30);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, direction]);

  // 首次挂载的呼吸波
  useEffect(() => {
    if (settlingRef.current !== null) return;
    startWobble();
    return () => {
      gsap.killTweensOf(rotsRef.current.filter(Boolean));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载清理
  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
      gsap.killTweensOf(rotsRef.current.filter(Boolean));
    };
  }, []);

  const front = displayed;
  const back = incoming ?? displayed;

  return (
    <h1 className={`${className ?? ''} flip-title`}>
      {/* 隐形 ghost:同格叠放撑出 max(旧,新) 的宽高,保证翻牌中排版正确 */}
      <span className="flip-ghost" aria-hidden="true">{front}</span>
      <span className="flip-ghost" aria-hidden="true">{back}</span>
      <div className="flip-stage" aria-live="polite">
        {Array.from({ length: SLICES }).map((_, i) => (
          <div className="flip-slice" key={i}>
            <div
              className="flip-rot"
              ref={(el) => {
                if (el) rotsRef.current[i] = el;
              }}
            >
              <div
                className="flip-face"
                style={{ left: `${-i * 100}%`, width: `${SLICES * 100}%` }}
              >
                {front}
              </div>
              <div
                className="flip-face flip-face-back"
                style={{ left: `${-i * 100}%`, width: `${SLICES * 100}%` }}
              >
                {back}
              </div>
            </div>
          </div>
        ))}
      </div>
    </h1>
  );
}
