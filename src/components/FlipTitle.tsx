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
/** 转入相对转出的滞后比例：1.0 = 同一字母的转出折完才转入，逐字母交接、不叠影 */
const IN_LAG = 1;
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
  /** 逐字母格（空格不建格，其区间自然留白）；空数组表示量取失败 */
  cells: LetterCell[];
}

/**
 * 读一个真 ghost 的行数
 *
 * 功能：用 Range 跑一遍 ghost 内容并按行取矩形，行数 > 1 即真实布局里换行了。
 *
 * 参数：el 真实的隐形 ghost 元素（可为 null）
 *
 * 返回值：行数；量不到时返回 1（按"不换行"处理）
 *
 * 异常：无
 *
 * 注意事项：行数是纯布局量（矩形个数），不受鼠标视差的三维投影影响，可安全用于判定换行。
 *          早先用"文字自然宽 vs 父容器 clientWidth"来判定是错的——那个父容器是被子元素
 *          撑出来的（宽 = h1 的 max-content），于是判定退化成"新标题比旧标题宽吗"，
 *          导致"新标题更宽"的切换被误判成换行 → 动画被跳过、文字直接出现。
 */
function ghostLineCount(el: HTMLElement | null): number {
  if (!el || !el.firstChild) return 1;
  const range = document.createRange();
  range.selectNodeContents(el);
  const count = range.getClientRects().length;
  return count > 0 ? count : 1;
}

/**
 * 比较两份排版量取结果是否一致
 *
 * 功能：逐字母比较总宽与各字母格的字符/位置/宽度，用于避免"量取结果没变也 setState"。
 *
 * 参数：
 *  - a 旧结果（可能为 undefined，表示还没量过）
 *  - b 新结果
 *
 * 返回值：true = 完全一致（渲染用不到任何变化）
 *
 * 异常：无
 *
 * 注意事项：只比较渲染真正用到的字段，浮点直接全等比较即可（同一输入下量取值稳定）。
 */
function sameLayout(a: TextLayout | undefined, b: TextLayout): boolean {
  if (!a || a.w !== b.w || a.cells.length !== b.cells.length) return false;
  for (let i = 0; i < a.cells.length; i++) {
    const x = a.cells[i];
    const y = b.cells[i];
    if (x.ch !== y.ch || x.x !== y.x || x.w !== y.w) return false;
  }
  return true;
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
 *  - 换行与否由调用方用真 ghost 的行数判定（ghostLineCount），这里只负责"逐字母"量取
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
    if (!node || w <= 0) return { w: 0, cells: [] };

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
    if (cells.length === 0) return { w: 0, cells: [] };
    return { w, cells };
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
  /**
   * 排版量取结果的 state：分段文字 → 逐字母格。
   * 必须是 state 而不是 ref：渲染期读 ref 时，一旦清缓存就会出现"层卸载 → 下一拍重挂"，
   * 重挂的字形没有任何 transform（rotationY 0 裸露），而 GSAP 补间还挂在旧节点上，
   * 结果就是新旧文字平铺叠在一起、看不到动画（变宽切换时 h1 变宽必现）。
   */
  const [layouts, setLayouts] = useState<Record<string, TextLayout>>({});
  /** 真实布局里当前标题换行了（真 ghost 行数 > 1）→ 退化为整块一格、不做折叠动画 */
  const [wrapped, setWrapped] = useState(false);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const inLayerRef = useRef<HTMLDivElement>(null);
  const outLayerRef = useRef<HTMLDivElement>(null);
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
    const out = measureTextLayout(el, prev);
    const incoming = measureTextLayout(el, text);
    if (out.cells.length === 0 || incoming.cells.length === 0) {
      // 逐字母量取不可用（极端布局/字体未就绪）→ 直接切换文字，不做折叠
      setOutText(null);
      setSteady(text);
      return;
    }
    setOutText(prev);
    setSteady(text);
    setFlipToken((t) => t + 1);
  }, [text]);

  // 排版量取：把当前渲染到的每段文字量成 state 交给渲染用。
  // 不在渲染期读 ref、也不"清空重填"，避免翻转中途层被卸载重挂（见 layouts 的注释）。
  useLayoutEffect(() => {
    const el = h1Ref.current;
    if (!el) return;
    const next: Record<string, TextLayout> = { ...layouts };
    let changed = false;
    [steady, outText].forEach((t) => {
      if (!t) return;
      const measured = measureTextLayout(el, t);
      if (!sameLayout(layouts[t], measured)) {
        next[t] = measured;
        changed = true;
      }
    });
    // 真·换行判定：读真 ghost 的行数（用宽度比较会把"新标题更宽"误判成换行）
    const ghosts = el.querySelectorAll<HTMLElement>('.flip-ghost');
    const wrappedNow = ghostLineCount(ghosts[1] ?? null) > 1;
    if (wrappedNow !== wrapped) setWrapped(wrappedNow);
    if (changed) setLayouts(next);
  }, [steady, outText, version, layouts, wrapped]);

  // 字体就绪 / 视口尺寸变化 → 重新量取（字号是 7vw，换行阈值也随视口变）。
  // 特意不观察 h1 自身：它的宽度变化是"ghost 取 max(旧,新)"造成的自扰信号，翻转起点必触发一次，
  // 拿它做"清缓存"的触发源正是"直接重叠"的成因。
  useLayoutEffect(() => {
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      setVersion((v) => v + 1);
    };
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => schedule()).catch(() => undefined);
    }
    window.addEventListener('resize', schedule);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', schedule);
    };
  }, []);

  // 折叠动画：在层 DOM 提交后、首次绘制前启动（转入层先立成 -90°，避免闪出新文字）
  useLayoutEffect(() => {
    if (!flipToken) return;
    const dir = directionRef.current;
    // 真 ghost 行数 > 1 = 真实布局里换行了 → 折叠模型（单行逐字母格）不成立，
    // 直接退化为"文字当场出现"：清掉转出层，转入层按整块一格渲染（排版与换行保持一致）
    const ghosts = h1Ref.current?.querySelectorAll<HTMLElement>('.flip-ghost');
    if (ghostLineCount(ghosts?.[0] ?? null) > 1 || ghostLineCount(ghosts?.[1] ?? null) > 1) {
      setWrapped(true);
      setOutText(null);
      return;
    }
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

  const inLayout = layouts[steady];
  const outLayout = outText ? layouts[outText] : undefined;

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
        {inLayout && inLayout.cells.length > 0 && (
          <div
            ref={inLayerRef}
            className="flip-layer"
            style={
              wrapped
                ? { left: 0, right: 0 }
                : {
                    left: '50%',
                    width: `${inLayout.w}px`,
                    marginLeft: `${-inLayout.w / 2}px`,
                  }
            }
          >
            {wrapped ? (
              <div className="flip-cell" style={{ left: 0, right: 0 }}>
                <div className="flip-glyph" style={{ whiteSpace: 'normal' }}>
                  {steady}
                </div>
              </div>
            ) : (
              inLayout.cells.map((c, i) => (
                <div
                  className="flip-cell"
                  key={i}
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
        {!wrapped && outText && outLayout && outLayout.cells.length > 0 && (
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
