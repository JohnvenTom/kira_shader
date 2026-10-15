import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';

/**
 * FlipTitle —— 项目标题「逐字母翻牌」（shader.se #selected-work 风格的 DOM 复刻）
 *
 * 结构（每个字母一张翻转卡，新旧文字各占一层）：
 *  h1（grid 叠层 + perspective）
 *   ├ ghost ×2（旧/新文字，同格叠放 → 撑出 max 宽高，隐形，作为尺寸基准）
 *   └ stage（同格覆盖，定位上下文）
 *      ├ layer「转入层」（当前文字，常驻）：逐 .flip-cell，每格一张 .flip-glyph 卡
 *      └ layer「转出层」（翻牌期间临时挂载的旧文字）：同样逐字母
 *
 * 为什么是两层、而不是一层里两面各拿一份文字：
 *  一层结构里两面的"窗口"是同一套（切在旧文字的字母空隙上），于是新文字的字形必然被
 *  这些缝口从中间切开；翻牌中途各条角度不同，切开的两半跟着不同角度歪 → 看起来"字母碎了、
 *  凑不齐"，直到 settle 才瞬间拼回。改成两层后，每层的切格都贴自己文字的字母，
 *  任何字形都不会被切，长度不同也不会错位，也不再需要 settle 那一下"瞬间归零"。
 *
 * 动画：每层每个字母格各自绕自身中心的 Y 轴旋转
 *  - 转出层：0 → -90°（加速离开，power2.in）
 *  - 转入层：-90° → 0°（弹性落位，back.out）
 *  时长沿字母序号做梯度（左快右慢）+ 相邻字母错峰 → 仍是波浪式翻牌。
 *
 * 兜底：文字比容器还宽（真实布局会换行）时不做折叠动画，直接切换文字并保持换行排版。
 */

/** 每个字母格的左右余量(px)：保证字形（含抗锯齿/overshoot）完整落在格内不被裁 */
const CELL_PAD = 2;
/** 折叠梯度：最左字母时长 → 最右字母时长(s) */
const FOLD_MIN = 0.42;
const FOLD_MAX = 0.86;
/** 相邻字母起始错峰(s) */
const STAGGER = 0.045;
/** 转入相对转出的滞后比例（转出走完这么多才开始转入） */
const IN_LAG = 0.85;
/** 静止呼吸波：幅度(deg) 与单程时长(s) */
const WOBBLE_AMP = 0.8;
const WOBBLE_DUR = 1.6;
/** 呼吸波的相邻字母错峰(s) */
const WOBBLE_STAGGER = 0.07;

/** 一个字母格：文字局部坐标下的字形位置与宽度（advance 盒） */
interface LetterCell {
  ch: string;
  x: number;
  w: number;
}

/** 一段文字的排版信息 */
interface TextLayout {
  /** 文字自然宽(px) */
  w: number;
  /** 逐字母格（空格不建格，其区间自然留白） */
  cells: LetterCell[];
  /** 真实布局里这段文字会换行 → 退化为"整块一格 + 不做折叠动画" */
  wrap: boolean;
}

interface FlipTitleProps {
  text: string;
  className?: string;
  /** 切换方向(±1)，控制绕 Y 旋转的正负 */
  direction?: number;
}

/**
 * 量取一段文字的逐字母排版
 *
 * 功能：在离屏克隆（无 3D 祖先、超宽容器 + 强制单行）里按字符量取 advance 盒，
 *      得到"文字自然宽 + 逐字母格"；再比对真实父容器的内容宽，判断真实布局是否会换行。
 *
 * 参数：
 *  - liveH1 真实标题元素（.film-title），用于取字体上下文与父容器可用宽
 *  - text   要量取的文字（新旧文字都可量，不必先挂到真实 DOM 上）
 *
 * 返回值：{ w, cells, wrap }；wrap=true 表示真实布局会换行（调用方走退化路径）
 *
 * 异常：无（离屏克隆在 finally 中一定移除）
 *
 * 注意事项：
 *  - 真实 h1 处在鼠标视差的三维投影下，其 rect 是投影后坐标，不能直接用来定位；
 *    故克隆一个同 class 的离屏 h1（visibility:hidden）在布局坐标里量，坐标以克隆左缘为原点
 *  - 克隆容器给 max-content（而不是固定超宽）：克隆里的 ghost 是单列 auto 网格项，
 *    会被拉到容器宽度上，容器一宽 ghost 的宽度也跟着变，换行判定就会误判
 *  - 克隆里强制单行：真实渲染也是单行（.flip-glyph 为 nowrap），逐字符盒子永远单行有效
 *  - 换行判定用"父容器 clientWidth"（真实可用宽，布局值），而不是 h1 自己的宽：
 *    h1 的宽是被文字撑出来的，文字更宽时它自己也会跟着变宽，判断不出换行
 *  - 字体未就绪时量到的是回退字体的度量，调用方在 fonts.ready / 尺寸变化时会作废缓存重量
 */
function measureTextLayout(liveH1: HTMLElement, text: string): TextLayout {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
  // 容器用 max-content：克隆里的 ghost 是单列 auto 网格项，会被拉到容器宽度上。
  // 之前给固定超宽（99999px）会让 ghost 宽度也变成 99999，换行判定永远成立 → 全程走退化路径。
  host.style.width = 'max-content';
  const clone = document.createElement('h1');
  clone.className = liveH1.className;
  const ghost = document.createElement('span');
  ghost.className = 'flip-ghost';
  ghost.textContent = text;
  ghost.style.whiteSpace = 'nowrap';
  clone.appendChild(ghost);
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    const node = ghost.firstChild;
    const naturalW = parseFloat(getComputedStyle(ghost).width);
    const w = Number.isFinite(naturalW) && naturalW > 0 ? naturalW : 0;
    // 真实可用宽：h1 的父容器内容宽（换行与否取决于它，而不是被文字撑开的 h1）
    const avail = liveH1.parentElement ? liveH1.parentElement.clientWidth : 0;
    if (!node || w <= 0 || (avail > 0 && w > avail + 1)) {
      return { w: 0, cells: [], wrap: true };
    }

    const originX = clone.getBoundingClientRect().left;
    const range = document.createRange();
    const cells: LetterCell[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch.trim() === '') continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const b = range.getBoundingClientRect();
      const x = b.left - originX;
      if (!Number.isFinite(x) || !Number.isFinite(b.width) || b.width <= 0) continue;
      cells.push({ ch, x, w: b.width });
    }
    if (cells.length === 0) return { w: 0, cells: [], wrap: true };
    return { w, cells, wrap: false };
  } finally {
    document.body.removeChild(host);
  }
}

/**
 * FlipTitle 组件
 *
 * 功能：渲染逐字母翻牌标题；切换文字时旧文字逐字母折出、新文字逐字母折入，
 *      静止时对当前文字的每个字母施加轻微呼吸波。
 *
 * 参数：
 *  - text      目标标题文字
 *  - className 外部附加类名（.film-title 提供字体/字号）
 *  - direction 切换方向 ±1
 *
 * 返回值：React.ReactElement（<h1 class="… flip-title">）
 *
 * 异常：无
 *
 * 注意事项：
 *  - 排版量取按文字缓存（cacheRef），字体就绪 / h1 尺寸变化时整体作废重量
 *  - 翻牌期间不重启呼吸波（与折叠补间抢 rotationY）；折叠收尾后清掉转出层并起呼吸波
 *  - 连续快速换文字时，上一轮"转入层"会原地变成新的一轮"转出层"，折叠从当前角度继续
 *    （不会跳回 0），但更早那层若还在转入途中会被卸载 —— 极快速连切时可能看到一次骤停
 */
export function FlipTitle({ text, className, direction = 1 }: FlipTitleProps) {
  const [steady, setSteady] = useState(text);
  const [outText, setOutText] = useState<string | null>(null);
  const [flipToken, setFlipToken] = useState(0);
  const [version, setVersion] = useState(0);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const inLayerRef = useRef<HTMLDivElement>(null);
  const outLayerRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Record<string, TextLayout>>({});
  const steadyRef = useRef(steady);
  const directionRef = useRef(direction);
  const timerRef = useRef<number | null>(null);
  steadyRef.current = steady;
  directionRef.current = direction;

  /** 取某层里的字母卡片（DOM 顺序 = 字母顺序） */
  const glyphsOf = (layer: HTMLDivElement | null): HTMLElement[] =>
    layer ? Array.from(layer.querySelectorAll<HTMLElement>('.flip-glyph')) : [];

  /**
   * 起呼吸波
   *
   * 功能：对给定字母卡施加 rotationY 0 ↔ WOBBLE_AMP 的无限往复（逐字母错峰）。
   * 参数：glyphs 目标字母卡数组
   * 返回值：无
   * 异常：无
   * 注意事项：会先把 rotationY 归零（fromTo），所以只能在"没有折叠补间在跑"时调用。
   */
  const startWobble = (glyphs: HTMLElement[]) => {
    glyphs.forEach((el, i) => {
      gsap.fromTo(
        el,
        { rotationY: 0 },
        {
          rotationY: WOBBLE_AMP,
          duration: WOBBLE_DUR,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
          delay: i * WOBBLE_STAGGER,
        },
      );
    });
  };

  // 换文字：启动逐字母折叠（或退化路径）
  useEffect(() => {
    if (text === steadyRef.current) return;
    const el = h1Ref.current;
    const prev = steadyRef.current;
    if (!el) {
      setSteady(text);
      setOutText(null);
      return;
    }
    const out = cacheRef.current[prev] ?? (cacheRef.current[prev] = measureTextLayout(el, prev));
    const incoming = cacheRef.current[text] ?? (cacheRef.current[text] = measureTextLayout(el, text));
    if (out.wrap || incoming.wrap) {
      // 退化：真实布局会换行（文字比容器宽）→ 直接切换，保持换行排版不做折叠
      setOutText(null);
      setSteady(text);
      setVersion((v) => v + 1);
      return;
    }
    setOutText(prev);
    setSteady(text);
    setVersion((v) => v + 1);
    setFlipToken((t) => t + 1);
  }, [text]);

  // 排版：按需量取当前渲染到的每段文字（层渲染要用它）。
  // 依赖里必须带 version：字体就绪/尺寸变化会清空缓存，只有 version 变化才能触发重建，
  // 否则缓存被清空后再也没人填，层会一直渲染不出来。
  useLayoutEffect(() => {
    const el = h1Ref.current;
    if (!el) return;
    let changed = false;
    [steady, outText].forEach((t) => {
      if (!t) return;
      const had = !!cacheRef.current[t];
      if (had && !cacheRef.current[t].wrap) return;
      cacheRef.current[t] = measureTextLayout(el, t);
      if (!had) changed = true; // 只在"新建缓存"时重渲染一次，避免与清缓存互相触发成死循环
    });
    if (changed) setVersion((v) => v + 1);
  }, [steady, outText, version]);

  // 字体就绪 / 容器尺寸变化 → 作废缓存并重渲染（字号、视口变化都会改变逐字母位置）
  useLayoutEffect(() => {
    const el = h1Ref.current;
    if (!el) return;
    let cancelled = false;
    const invalidate = () => {
      if (cancelled) return;
      cacheRef.current = {};
      setVersion((v) => v + 1);
    };
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => invalidate()).catch(() => undefined);
    }
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => invalidate());
      ro.observe(el);
    }
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, []);

  // 折叠动画：在层 DOM 提交后、首次绘制前启动（转入层先立成 -90°，避免闪出新文字）
  useLayoutEffect(() => {
    if (!flipToken) return;
    const dir = directionRef.current;
    const inGlyphs = glyphsOf(inLayerRef.current);
    const outGlyphs = glyphsOf(outLayerRef.current);
    gsap.killTweensOf([...inGlyphs, ...outGlyphs]);
    gsap.set(inGlyphs, { rotationY: -90 * dir });

    const n = Math.max(1, Math.max(inGlyphs.length, outGlyphs.length) - 1);
    const count = Math.max(inGlyphs.length, outGlyphs.length);
    let maxEnd = 0;
    for (let i = 0; i < count; i++) {
      const t = i / n;
      const dur = FOLD_MIN + (FOLD_MAX - FOLD_MIN) * t;
      const delay = i * STAGGER;
      const outEl = outGlyphs[i];
      const inEl = inGlyphs[i];
      // 转出层：从"当前角度"继续折（连续快速切换时上一轮转入层会原地变成转出层）
      if (outEl) {
        gsap.to(outEl, {
          rotationY: -90 * dir,
          duration: dur,
          delay,
          ease: 'power2.in',
          overwrite: true,
        });
      }
      if (inEl) {
        gsap.fromTo(
          inEl,
          { rotationY: -90 * dir },
          {
            rotationY: 0,
            duration: dur,
            delay: delay + dur * IN_LAG,
            ease: 'back.out(1.4)',
            overwrite: true,
          },
        );
      }
      maxEnd = Math.max(maxEnd, delay + dur * (1 + IN_LAG));
    }

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setOutText(null);
      startWobble(glyphsOf(inLayerRef.current));
    }, (maxEnd + 0.3) * 1000);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipToken]);

  // 静止时（含退化切换、首次挂载）给当前文字的字母起呼吸波
  useLayoutEffect(() => {
    if (flipToken && outText) return; // 折叠进行中：交给折叠收尾
    startWobble(glyphsOf(inLayerRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steady, flipToken, version]);

  // 卸载清理
  useEffect(() => {
    return () => {
      gsap.killTweensOf([
        ...glyphsOf(inLayerRef.current),
        ...glyphsOf(outLayerRef.current),
      ]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inLayout = cacheRef.current[steady];
  const outLayout = outText ? cacheRef.current[outText] : undefined;

  return (
    <h1 ref={h1Ref} className={`${className ?? ''} flip-title`}>
      {/* 隐形 ghost：同格叠放撑出 max(旧, 新) 的宽高，保证翻牌期间尺寸稳定 */}
      <span className="flip-ghost" aria-hidden="true">
        {outText ?? steady}
      </span>
      <span className="flip-ghost" aria-hidden="true">
        {steady}
      </span>
      <div className="flip-stage" aria-live="polite">
        {/* 转入/常驻层：当前文字 */}
        {inLayout && (
          <div
            ref={inLayerRef}
            className="flip-layer"
            style={
              inLayout.wrap
                ? { left: 0, right: 0 }
                : {
                    left: '50%',
                    width: `${inLayout.w}px`,
                    marginLeft: `${-inLayout.w / 2}px`,
                  }
            }
          >
            {inLayout.wrap ? (
              <div className="flip-cell" style={{ left: 0, right: 0 }}>
                <div className="flip-glyph" style={{ whiteSpace: 'normal' }}>
                  {steady}
                </div>
              </div>
            ) : (
              inLayout.cells.map((c, i) => (
                <div
                  className="flip-cell"
                  key={`${i}-${c.x}`}
                  style={{ left: `${c.x - CELL_PAD}px`, width: `${c.w + CELL_PAD * 2}px` }}
                >
                  <div className="flip-glyph" style={{ paddingLeft: `${CELL_PAD}px` }}>
                    {c.ch}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 转出层：翻牌期间临时挂载的旧文字 */}
        {outText && outLayout && !outLayout.wrap && (
          <div
            ref={outLayerRef}
            className="flip-layer"
            style={{
              left: '50%',
              width: `${outLayout.w}px`,
              marginLeft: `${-outLayout.w / 2}px`,
            }}
          >
            {outLayout.cells.map((c, i) => (
              <div
                className="flip-cell"
                key={`${i}-${c.x}`}
                style={{ left: `${c.x - CELL_PAD}px`, width: `${c.w + CELL_PAD * 2}px` }}
              >
                <div className="flip-glyph" style={{ paddingLeft: `${CELL_PAD}px` }}>
                  {c.ch}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </h1>
  );
}
