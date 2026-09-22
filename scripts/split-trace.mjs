/**
 * 一次性资源拆分脚本：trace-animated.html → SVG 主体 / 动画 CSS / 静态缩略图源
 *
 * 功能：
 *  - 从 E:/GIthub_Project/trace-animated.html 中提取：
 *    1. <svg> 主体（44 组草稿线 + 30 组成品画）→ public/asset/trace/trace-body.svg
 *    2. 动画 <style> 规则 → src/components/trace/traceAnimCss.ts（TS 常量，供组件注入）
 *    3. 去掉自动播放脚本的静态版 → public/asset/trace/trace-thumb.html（供截图生成缩略图）
 *  - 所有类名加 trace- 前缀，避免与全站 styles.css 冲突
 *
 * 参数：无（源文件路径硬编码）
 * 返回值：无
 * 异常：源文件不存在或行号偏移出错时抛 Error
 *
 * 注意事项：
 *  - 依赖源文件固定结构：style 在 7~42 行，svg 在 47~11986 行（1-based）
 *  - 替换顺序敏感：长词（.pgfade-m）必须先于短词（.pg）替换
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = 'E:/GIthub_Project/trace-animated.html';

const html = readFileSync(SRC, 'utf8');
const lines = html.split('\n');

// style 文本：1-based 行 8~42（0-based 7~41），剔除全局 reset 与 body 布局行（避免污染全站）
const styleLines = lines.slice(7, 42).filter((_, i) => i !== 0 && i !== 1);
const css = styleLines.join('\n').replace(/<\/?style>/g, '').trim();

// svg 主体：1-based 行 47~11986（0-based 46~11985）
const svg = lines.slice(46, 11986).join('\n');

/**
 * 顺序替换表（先长后短，避免子串误伤）
 */
const REPLS = [
  [/\.pgfade-m/g, '.trace-pgfade-m'],
  [/\.wipe-r/g, '.trace-wipe-r'],
  [/\.wipe-l/g, '.trace-wipe-l'],
  [/\.wipe-d/g, '.trace-wipe-d'],
  [/\.dab/g, '.trace-dab'],
  [/\.pg/g, '.trace-pg'],
  [/\.playing/g, '.trace-playing'],
  [/\.skb/g, '.trace-skb'],
  [/\.skst/g, '.trace-skst'],
  [/\.sketch/g, '.trace-sketch'],
  [/#art/g, '#trace-art'],
  [/\.frame/g, '.trace-frame'],
  [/\.stage/g, '.trace-stage'],
  [/\.bar/g, '.trace-bar'],
  [/\.tools/g, '.trace-tools'],
  [/button\{/g, '.trace-root button{'],
];

/** SVG class/id 替换（与 CSS 前缀保持一致）
 *  注意顺序：先替换 class="pg wipe-x" 类组合值（原文是组合类名），
 *  再处理独立类名与 id/href，避免残留未前缀的 wipe-l 等组合类 */
const SVG_REPLS = [
  [/class="pg wipe-r"/g, 'class="trace-pg trace-wipe-r"'],
  [/class="pg wipe-l"/g, 'class="trace-pg trace-wipe-l"'],
  [/class="pg wipe-d"/g, 'class="trace-pg trace-wipe-d"'],
  [/class="pg dab"/g, 'class="trace-pg trace-dab"'],
  [/class="pg"/g, 'class="trace-pg"'],
  [/class="wipe-r"/g, 'class="trace-wipe-r"'],
  [/class="wipe-l"/g, 'class="trace-wipe-l"'],
  [/class="wipe-d"/g, 'class="trace-wipe-d"'],
  [/class="dab"/g, 'class="trace-dab"'],
  [/class="skst"/g, 'class="trace-skst"'],
  [/class="skb"/g, 'class="trace-skb"'],
  [/class="sketch"/g, 'class="trace-sketch"'],
  [/href="#art"/g, 'href="#trace-art"'],
  [/id="art"/g, 'id="trace-art"'],
];

const apply = (text, repls) => repls.reduce((t, [re, to]) => t.replace(re, to), text);

const scopedCss = apply(css, REPLS);
const scopedSvg = apply(svg, SVG_REPLS);

// 写 SVG 主体
mkdirSync(`${ROOT}/public/asset/trace`, { recursive: true });
mkdirSync(`${ROOT}/src/components/trace`, { recursive: true });
writeFileSync(`${ROOT}/public/asset/trace/trace-body.svg`, scopedSvg, 'utf8');

// 写 CSS 常量 TS（模板字符串注入用；String.raw 风格，避免转义）
writeFileSync(
  `${ROOT}/src/components/trace/traceAnimCss.ts`,
  `/**
 * trace 动画 CSS（提取自 trace-animated.html，类名已前缀化）
 *
 * 功能：原作品的完整 CSS 动画时间轴（14.65s）：
 *   - 草稿线 stroke-dashoffset 描绘（.trace-skb path，44 组递延）
 *   - 草稿容器淡出 / 成品参考层淡入（.trace-skst / .trace-sketch）
 *   - 成品 30 分段 clip-path 揭示（.trace-pg：wipe-l/r/d + dab）
 * 组件挂载 .trace-playing 后由 WAAPI 统一接管 currentTime 实现滚动驱动。
 */
export const TRACE_ANIM_CSS = ${JSON.stringify(scopedCss)};
`,
  'utf8'
);

// 写静态缩略图源（去掉自动播放脚本 → 静态状态即完整成品画）
const thumbHtml = `${lines.slice(0, 7).join('\n')}\n${lines.slice(7, 42).join('\n')}\n${lines
  .slice(43, 11990)
  .join('\n')}\n</main>\n</body>\n</html>\n`;
writeFileSync(`${ROOT}/public/asset/trace/trace-thumb.html`, thumbHtml, 'utf8');

console.log('OK: svg bytes =', scopedSvg.length, ', css bytes =', scopedCss.length);