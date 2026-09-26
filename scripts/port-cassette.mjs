/**
 * port-cassette.mjs —— 把 OHM TAPE（原项目）搬进本项目的搬运脚本
 *
 * 功能：
 *   1. 拷贝原项目 12 个纯 three 模块到 src/components/tape/（保持 ESM，仅前置来源横幅；
 *      controls.js / audio.js 各打一个最小补丁，用于把监听交给外部注册表、释放音频上下文）
 *   2. 由原项目 index.html 的 <body> 抽取档案终端外壳（去掉 <script>/<noscript>/<audio>），
 *      生成 tapeShell.js（模板字符串），由工厂在挂载时注入 root
 *   3. 把原项目 main.js（单页装配脚本）机械改写为 tapeApp.js：
 *        - 包成 createTapeApp({ root, audioEl, query }) 工厂
 *        - document.body / documentElement → root（状态类与 data-theme 落在挂载点上）
 *        - 查询作用域收敛到 root
 *        - URL 参数从 location.search 改为调用方传入的 hash 查询
 *        - window 级监听、setTimeout、主循环 rAF 全部登记，供 dispose 回收
 *        - 默认曲目路径改到站点资源目录
 *   4. 把原项目 styles.css 作用域化生成 tape.css：
 *        - :root / html / body → #tape-root（CSS 变量与正文样式收敛到挂载点）
 *        - body.X → #tape-root.X（状态类随 body → root 的迁移）
 *        - [data-theme=...] → #tape-root[data-theme=...]
 *        - 其余选择器统一加 `#tape-root ` 前缀；@media/@container 内递归，@keyframes 原样保留
 *
 * 参数：无（源/目标路径写在下面的常量里）
 * 返回值：无（脚本跑完打印每个产物的字节数与改写计数）
 * 异常：源文件缺失时抛错退出（readFileSync 默认行为）
 *
 * 注意事项：
 *  - 这是**一次性搬运**工具，但设计成可重跑：重跑会覆盖 src/components/tape/ 下由本脚本
 *    生成的文件（tapeApp.js / tapeShell.js / tape.css / 12 个模块）。若要改这些文件的行为，
 *    请改本脚本里的改写规则或补丁，不要只改产物，否则下次重跑会丢。
 *  - 原项目为单页应用，没有卸载路径；工厂头尾（监听注册表 / dispose）是本脚本新增的。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC_DIR = 'E:/GIthub_Project/github/cassette';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'tape');

/** CSS 注释（用于把规则前的注释从选择器前导文本里摘出来） */
const COMMENT_RE = /\/\*[\s\S]*?\*\//g;

const BANNER = (name) =>
  `/* 搬运自 OHM TAPE 原项目 cassette/src/${name}（保持原样，仅见 scripts/port-cassette.mjs 的补丁）*/\n`;

/** 需要原样搬运的纯 three 模块（main.js 单独走改写流程） */
const MODULES = [
  'anim.js',
  'ao.js',
  'audio.js',
  'cassette.js',
  'controls.js',
  'env.js',
  'floor.js',
  'lights.js',
  'post.js',
  'probe.js',
  'tags.js',
  'textures.js',
];

/**
 * 给 controls.js 打补丁：把它的监听交给外部注册表
 *
 * 功能：Orbit 在构造时接收 opt.on（与工厂里的 on() 同一个函数），
 *      把 canvas 级与 window 级监听全部登记进去，卸载时由工厂统一摘除。
 *      原项目是单页应用，没有卸载路径，所以这里必须补。
 *
 * 参数：
 *  - code {string} controls.js 源码
 * 返回值：{string} 打过补丁的源码
 */
function patchControls(code) {
  let s = code;
  s = s.replace('    this._ptrs = new Map();', '    this.on = opt.on;            // 外部监听注册表（卸载时统一摘除）\n    this._ptrs = new Map();');
  s = s.replace(/\bd\.addEventListener\(/g, 'this.on?.(d, ');
  s = s.replace(/(?<![\w.$])addEventListener\(/g, 'this.on?.(window, ');
  return s;
}

/**
 * 给 audio.js 打补丁：补一个 dispose（关闭 AudioContext）
 *
 * 功能：磁带底噪用的是独立 AudioContext；浏览器对同时存在的上下文数量有限制，
 *      路由反复进出必须能把它关掉，否则上下文会耗尽。
 *
 * 参数：
 *  - code {string} audio.js 源码
 * 返回值：{string} 打过补丁的源码
 */
function patchAudio(code) {
  const tail = '    src.start(t); src.stop(t + 0.36);\n  }\n}\n';
  const add = '    src.start(t); src.stop(t + 0.36);\n  }\n\n'
    + '  /** 释放音频上下文（原项目为单页，无需；本移植在页面卸载时调用） */\n'
    + '  dispose() {\n'
    + '    try { this.stop(); } catch { /* noop */ }\n'
    + '    try { this.ctx?.close?.(); } catch { /* noop */ }\n'
    + '    this.ctx = null;\n'
    + '    this.on = false;\n'
    + '  }\n'
    + '}\n';
  if (!code.includes(tail)) throw new Error('audio.js 结构与预期不符，dispose 补丁未打上');
  return code.replace(tail, add);
}

/**
 * 由 index.html 抽取档案终端外壳
 *
 * 功能：取 <body> 内容，去掉 <script src="dist/app.js">、<noscript> 兜底与 <audio> 标签
 *      （音频元素改由工厂创建／注入，这样才能跨路由续播），转义为模板字符串。
 *
 * 参数：
 *  - html {string} index.html 源码
 * 返回值：{string} tapeShell.js 文件内容
 */
function buildShell(html) {
  const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
  const shell = body
    .replace(/\s*<script src="dist\/app\.js"><\/script>/, '')
    .replace(/\s*<noscript>[\s\S]*?<\/noscript>/, '')
    .replace(/\s*<audio id="tape-audio"[^>]*><\/audio>/, '')
    /* 页头新增一格「返回站内」：原项目是单页，没有"离开"这件事，
       本移植在站内是一个路由，所以给 masthead 末尾补一个返回入口（沿用 .tb 的样式）。
       进入前的页面由音乐盒角标写在 sessionStorage（ohmtape.from），没有就回胶片页 */
    .replace(
      /(\s*<button class="tb ui-hit" id="btn-reinit">REINITIALIZE<\/button>)/,
      '$1\n      <i class="vr" aria-hidden="true"></i>\n'
      + '      <button class="tb ui-hit" id="btn-back" title="返回站内（回到进入前那一页）">\n'
      + '        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.6 3.4 5 8l4.6 4.6"/><path d="M13.6 8H5.4"/></svg>\n'
      + '        BACK TO SITE\n'
      + '      </button>',
    )
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .trim();
  return `/* 由 scripts/port-cassette.mjs 从原项目 index.html 的 <body> 生成（档案终端外壳）*/\n`
    + 'const SHELL = `\n' + shell + '\n`;\n\nexport default SHELL;\n';
}

/**
 * 把 main.js 改写为 tapeApp.js（工厂）
 *
 * 功能：见文件头「功能 3」。所有改写都是精确字符串替换，替换不到就抛错，
 *      避免上游改版后静默漂移。
 *
 * 参数：
 *  - code {string} main.js 源码
 * 返回值：{string} tapeApp.js 文件内容
 */
function portMain(code) {
  let s = code;
  const hits = {};
  const rep = (name, re, to) => {
    const before = s;
    s = s.replace(re, to);
    if (s === before) throw new Error(`改写未命中：${name}`);
    hits[name] = (hits[name] || 0) + 1;
  };

  // 1) 去掉原入口收尾（改由工厂尾部启动）
  rep('boot 收尾', /\nboot\(\)\.catch\(\(e\) => showError\(e\?\.stack \|\| e\)\);\s*$/, '\n');

  // 2) DOM 作用域：状态类与主题属性落在挂载点上，而不是 document.body/html
  s = s.replace(/document\.body\./g, 'root.'); hits['body→root'] = 1;
  if (s.includes('document.documentElement')) {
    s = s.replace(/document\.documentElement\.dataset\.theme/g, 'root.dataset.theme');
    hits['html→root'] = 1;
  }

  // 3) 查询作用域收敛到 root
  rep('$ 助手', /const \$ = \(s\) => document\.querySelector\(s\);/, 'const $ = (s) => root.querySelector(s);');
  s = s.replace(/document\.querySelectorAll\(/g, 'root.querySelectorAll(');
  s = s.replace(/document\.querySelector\(/g, 'root.querySelector(');

  // 4) URL 参数：由调用方从 hash 查询里解析后传入
  rep('URL 参数', /const Q = new URLSearchParams\(location\.search\);/, 'const Q = query;');

  // 5) 需要跨挂载回收的监听与定时器：走注册表
  s = s.replace(/(?<![\w.$])addEventListener\(/g, 'on(window, ');
  s = s.replace(/\baudioEl\.addEventListener\(/g, 'on(audioEl, ');
  s = s.replace(/(?<![\w.])setTimeout\(/g, 'later(');

  // 6) 主循环句柄（供 dispose 取消）
  rep('主循环 rAF', /requestAnimationFrame\(loop\);/, 'raf = requestAnimationFrame(loop);');
  rep('主循环守卫', /function loop\(\) \{\n  const now = performance\.now\(\);/,
    'function loop() {\n  if (disposed) return;\n  const now = performance.now();');

  // 7) 默认曲目：改到站点资源目录，元信息换成中性占位（文件缺失时走「仅走带动画」降级路径）
  rep('默认曲目元信息',
    /  title: 'Sacred Play Secret Place',\n  artist: 'Matryoshka',\n  album: 'Laideronnette',\n/,
    "  /* 换成真曲子时改这三行（标题会写到标签的手写体上）：\n"
    + '     现在挂的是仓库里的占位合成音，所以不沿用原项目那首商业曲的名字 */\n'
    + "  title: 'Demo Tone',\n"
    + "  artist: '',\n"
    + "  album: '',\n");
  rep('默认曲目路径', /src: 'assets\/sacred-play-secret-place\.mp3',/, "src: '/asset/audio/ohm-tape-default.mp3',");

  // 8) 音频元素：外部注入（跨页续播单例）或本地创建
  rep('音频元素', /const audioEl = \$\('#tape-audio'\);/,
    'const audioEl = injectedAudio || (() => {\n'
    + "  /* 跨页续播时由调用方注入同一个元素；否则本地建一个（src 指向站点默认曲目）*/\n"
    + "  const a = document.createElement('audio');\n"
    + "  a.id = 'tape-audio';\n"
    + "  a.preload = 'auto';\n"
    + '  a.src = TRACK_DEFAULT.src;\n'
    + '  return a;\n'
    + '})();\n'
    + '/* 刻意不把音频元素挂进 root（原项目写在 HTML 里）：\n'
    + '   媒体元素不挂在文档里照样播放（HTML 规范只说"引用被移除"不影响播放），而挂上去就意味着\n'
    + '   它的存在要跟着 root 的 DOM 生命周期走 —— 卸载时 dispose() 会清空 root，那是一次\n'
    + '   我们既不需要、也控制不了的状态变化。跨页共享的元素，让它留在 DOM 之外最省心。 */');

  /* 9) 把监听注册表交给轨道控制器
     controls.js 的补丁把所有 canvas/window 级监听改成了 this.on?.(...)，漏传这一项不会报错，
     但拖拽旋转 / 滚轮推拉 / 双指捏合 / 双击复位会全部静默失效（`?.` 把错误吞了）。 */
  rep('轨道控制器监听注册表',
    /  auto: false,\n  reduce,\n  onInteract: \(dragging\) => \{/,
    '  auto: false,\n'
    + '  /* 监听注册表（见文件头「工厂化」说明）：controls.js 的补丁把所有 canvas/window 级\n'
    + '     监听交给它，卸载时统一摘除。漏传这一项不会报错，但拖拽/滚轮/捏合/双击会全部失效。 */\n'
    + '  on,\n'
    + '  reduce,\n'
    + '  onInteract: (dragging) => {');

  /* 10) 走带跟随共享音频元素
     音频元素是跨页共享的（右下角音乐盒角标也用它），所以"机器在不在走"必须以元素为准：
     角标在别的页面按了播放/暂停，进到本页（或在本页）时走带要跟上，不能各走各的。
     只加在主循环已有的两个分支里，判定都在同一帧完成，不需要额外事件。 */
  rep('走带跟随：元素在放',
    /  \} else if \(audioOk\(\) && !audioEl\.paused && !audioEl\.ended\) \{\n    cas\.st\.driven = true;/,
    '  } else if (audioOk() && !audioEl.paused && !audioEl.ended) {\n'
    + '    /* 元素正在放而机器没在走（多半是音乐盒角标那边按的播放）：把走带与图标接上 */\n'
    + '    if (!cas.st.playing) togglePlay(true);\n'
    + '    cas.st.driven = true;');
  rep('走带跟随：元素停了',
    /  \} else \{\n    \/\/ paused, blocked by autoplay policy, or no audio at all → simulate locally\n    cas\.st\.driven = false;/,
    '  } else {\n'
    + '    // paused, blocked by autoplay policy, or no audio at all → simulate locally\n'
    + '    cas.st.driven = false;\n'
    + '    /* 元素被停在页面外（角标暂停）：机器一起收住。没装带时的降级模式不受影响，\n'
    + '       那种情况 audioOk() 为假，机器照旧自己空转 */\n'
    + "    if (cas.st.playing && audioOk() && audioEl.paused && mode === 'idle') togglePlay(false);");

  /* 11) 把当前曲目播报给页面外
     setNowChip() 是曲目显示信息唯一的更新点（开机与换带后都会走），在这里广播一个事件，
     右下角音乐盒角标就能跟着显示曲名，而工厂完全不需要知道角标的存在 */
  rep('曲目播报事件',
    /  \$\('#now-sub'\)\.textContent = audioFailed \? '音频加载失败 · 仅走带动画' : \(credits \|\| '未知曲目'\);\n\}/,
    "  $('#now-sub').textContent = audioFailed ? '音频加载失败 · 仅走带动画' : (credits || '未知曲目');\n"
    + '  /* 播报给页面外（音乐盒角标）：ADD MUSIC 换带后角标也跟着变 */\n'
    + "  window.dispatchEvent(new CustomEvent('ohmtape:track', {\n"
    + '    detail: { title: TRACK.title, artist: TRACK.artist, album: TRACK.album, failed: audioFailed },\n'
    + '  }));\n'
    + '}');

  /* 13) 退场第一步：把灯光过渡压缩并可调速
     收闭动画（页面缩回角标）只有 380ms，而房间换灯的时钟是 1.6s。把这条时钟本身压短，
     整套房间（灯位/曝光/后期/地面/背景都在同一条 themeQ 曲线上）仍然同步地一起暗 ——
     比另叠一层黑色遮罩有内容，也是"先关灯、再收进芯片"这条因果的来源。 */
  rep('主题时钟可调速',
    /const THEME_DUR = 1\.6;/,
    'let THEME_DUR = 1.6;                  // 收闭时由 beginExit() 临时压短：同一条曲线走快些');

  /* 14) 退场入口与 onExit 参数都在下面 HEAD / FOOT 两个常量里（它们是我们新写的头尾，
     不在 main.js 正文里）：HEAD 里加 onExit 形参，FOOT 里加 beginExit 并扩展返回值 */

  /* 15) 绑定页头新增的「返回站内」
     原项目没有这个按钮（单页应用不需要"离开"），绑定在这里补。
     按钮本身不改路由，只把"用户要走"这件事交给调用方（onExit）——
     因为离开前要先把收闭动画播完，路由得等动画落地才换。
     没有 onExit（例如直接嵌进别的宿主）时退回原逻辑：按来源页跳转，兜底胶片页。
     Esc 不进这里，保持原项目"逐层收"的语义。 */
  rep('返回站内绑定',
    /^\$\('#btn-reinit'\)\.addEventListener\('click', reinit\);$/m,
    "  $('#btn-reinit').addEventListener('click', reinit);\n"
    + "  $('#btn-back').addEventListener('click', () => {\n"
    + '    audio.tick();\n'
    + '    if (onExit) { onExit(); return; }\n'
    + "    let from = '';\n"
    + "    try { from = sessionStorage.getItem('ohmtape.from') || ''; } catch { /* 存储不可用：走兜底 */ }\n"
    + "    window.location.hash = from && from !== '#tape' ? from : '#film';\n"
    + '  });');

  console.log('  改写计数：', JSON.stringify(hits));
  /* import 必须留在模块顶层：把它们从改写后的正文里摘出来交给 head() */
  const m = s.match(/^(?:import[^\n]*\n)+/);
  if (!m) throw new Error('main.js 顶部未找到 import 块');
  s = s.slice(m[0].length);
  return head(m[0]) + s + FOOT;
}

/** 工厂头（import 块插在横幅与工厂注释之间） */
const head = (imports) => `/* 由 scripts/port-cassette.mjs 从 OHM TAPE 原项目 cassette/src/main.js 生成（装配层）*/
import SHELL from './tapeShell.js';
${imports}
/**
 * createTapeApp —— 磁带机整页的装配工厂（原项目 main.js 的工厂化版本）
 *
 * 功能：把档案终端外壳注入 root，装配渲染器／环境／磁带模型／后期链与全部交互，
 *      并跑起原项目的主循环。返回值只有一个 dispose —— 卸载时回收主循环、
 *      window 级监听、定时器、音频上下文与渲染器。
 *
 * 参数：
 *  - root         {HTMLElement}    挂载点（#tape-root），外壳与 3D 画布都在它里面
 *  - audioEl      {HTMLAudioElement | null} 可选的共享音频元素（跨路由续播用）；
 *                                   不传则本地创建一个指向站点默认曲目的元素
 *  - query        {URLSearchParams}  hash 查询参数（原项目的 ?v=&x=&f=&t=&p=&r= 等）
 *  - onExit       {(() => void) | null} 页头「BACK TO SITE」被按下时的回调；
 *                                   由调用方负责"先播收闭动画、再换路由"，不传则按钮自己跳转
 *
 * 返回值：{ { dispose: () => void, beginExit: (dur?: number) => void } }
 *  - dispose    卸载：停主循环、摘监听、关音频上下文与渲染器
 *  - beginExit  退场第一步：把换灯时钟压到 dur 秒（默认 0.42）并切暗房，整套房间一起暗
 *
 * 异常：root 缺失时抛 Error；WebGL 不可用时在原项目逻辑里写入提示并抛出（见下）
 *
 * 注意事项：
 *  - 原项目是单页应用，没有任何卸载路径；本文件的状态类（playing/muted/rewinding 等）
 *    与主题属性都落在 root 上，由 tape.css 的 #tape-root 前缀选择器接住
 *  - 未做类型化：这是纯 JS 搬运件，TS 侧仅通过 allowJs 参与编译；
 *    下面这行 JSDoc 是给 TS 看的唯一类型信息（否则 root 会被推断掉）
 *
 * @param {{ root: HTMLElement, audioEl?: HTMLAudioElement | null, query?: URLSearchParams, onExit?: (() => void) | null }} [options]
 * @returns {{ dispose: () => void, beginExit: (dur?: number) => void }}
 */
export function createTapeApp({ root, audioEl: injectedAudio = null, query = new URLSearchParams(), onExit = null } = {}) {
  if (!root) throw new Error('createTapeApp: 缺少 root 挂载点');
  root.innerHTML = SHELL;

  /* ---- 跨挂载回收用的注册表（原项目没有，这里新增）---- */
  const bag = [];
  const timers = new Set();
  const on = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); bag.push([target, type, fn, opt]); return fn; };
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const prevTitle = document.title;
  let raf = 0;
  let disposed = false;

`;

/** 工厂尾：启动、卸载 */
const FOOT = `
  boot().catch((e) => showError(e && e.stack ? e.stack : e));

  /**
   * 卸载磁带机
   *
   * 功能：取消主循环、摘除全部登记的监听与定时器、释放音频上下文与渲染器、
   *      还原页面标题并清空挂载点。路由离开 #tape 时由 React 侧调用。
   *
   * 参数：无
   * 返回值：无
   * 异常：无（内部各步都做了 try 保护，卸载不应影响路由切换）
   */
  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    for (const [t, ty, fn, opt] of bag) t.removeEventListener(ty, fn, opt);
    bag.length = 0;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    try { audio.dispose(); } catch { /* noop */ }
    try { renderer.dispose(); renderer.forceContextLoss?.(); } catch { /* noop */ }
    document.title = prevTitle;
    root.innerHTML = '';
  }

  /**
   * 开始退场：先关灯
   *
   * 功能：把"房间换灯"的时钟压到指定秒数并切到暗房（灯位、曝光、后期、地面、背景
   *      都挂在同一条 themeQ 曲线上，所以整套房间一起暗），作为收闭动画的第一步；
   *      页面本身的收缩由调用方接着做。
   *
   * 参数：
   *  - dur {number} 过渡时长（秒），默认 0.42
   * 返回值：无
   * 异常：无
   *
   * 注意事项：
   *  - 这是单向的：暗房不会被恢复。主题本来就不持久化（themeName 每次挂载回到 studio），
   *    所以下次进页仍是出厂那套影棚灯，不需要"记住要切回来"
   */
  function beginExit(dur = 0.42) {
    THEME_DUR = Math.max(0.05, dur);
    setTheme('noir');
  }

  return { dispose, beginExit };
}
`;

/**
 * 收闭动画的第一步在工厂里留一个口子：把换灯时钟压短并切暗房。
 * 写在 FOOT 里是因为它属于我们新写的尾部，不在原项目 main.js 正文中。
 */

/**
 * CSS 作用域化
 *
 * 功能：给每条规则选择器加 `#tape-root ` 前缀，并把原来打在 html/body 上的东西
 *      （CSS 变量、正文背景、状态类）收敛到挂载点自身。@media/@supports/@container
 *      递归进去处理，@keyframes 内部原样保留。
 *
 * 参数：
 *  - css {string} styles.css 源码
 * 返回值：{string} tape.css 内容
 */
function scopeCss(css) {
  return `/* 由 scripts/port-cassette.mjs 从原项目 styles.css 作用域化生成 —— 请勿手改 */\n`
    + `/* 所有选择器都限定在 #tape-root 内，避免污染站内其他页面 */\n` + scopeRules(css);
}

/**
 * CSS 作用域化的内核（不带文件头，便于 @media 递归复用）
 *
 * 参数：
 *  - css {string} 待处理的 CSS 片段
 * 返回值：{string} 作用域化后的 CSS 片段
 */
function scopeRules(css) {
  let i = 0;
  let out = '';

  /** 单条选择器（已按逗号切分）→ 作用域化后的选择器 */
  const one = (raw) => {
    const s = raw.trim();
    if (!s) return raw;
    if (s === ':root' || s === 'html' || s === 'body') return '#tape-root';
    if (s === '*') return '#tape-root *';
    if (s.startsWith('[data-theme')) return '#tape-root' + s;
    if (s.startsWith('html[')) return '#tape-root' + s.slice('html'.length);
    if (/^body[.:\s]/.test(s)) return '#tape-root' + s.slice('body'.length);
    return '#tape-root ' + s;
  };
  /** 选择器列表 → 逐个作用域化（逗号只在括号外才算分隔） */
  const list = (sel) => {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of sel) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts.map(one).join(', ');
  };

  while (i < css.length) {
    const ch = css[i];
    // 注释原样带走
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2) + 2;
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '}') { out += ch; i++; continue; }

    const brace = css.indexOf('{', i);
    if (brace < 0) { out += css.slice(i); break; }
    const prelude = css.slice(i, brace);
    /* 规则前的注释必须单独输出：它既不属于选择器，也不能被前缀化
       （曾被吞进 prelude，生成出「根选择器 + 注释 + body.muted」这种坏选择器）*/
    const comments = prelude.match(COMMENT_RE) || [];
    const clean = prelude.replace(COMMENT_RE, ' ').trim();
    if (comments.length) out += comments.join('\n') + '\n';

    if (/^@(-webkit-)?keyframes\b/.test(clean)) {
      // 关键帧内部原样保留（内部是 0%/to 这类关键帧选择器，不能加前缀）
      // 找到配对的收尾花括号
      let depth = 0;
      let j = brace;
      for (; j < css.length; j++) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') { depth--; if (depth === 0) break; }
      }
      out += clean + ' ' + css.slice(brace, j + 1);
      i = j + 1;
      continue;
    }

    if (/^@(media|supports|container|layer)\b/.test(clean)) {
      // 条件规则：头部原样，内部递归作用域化
      const innerStart = brace + 1;
      let depth = 1;
      let j = innerStart;
      for (; j < css.length; j++) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') { depth--; if (depth === 0) break; }
      }
      out += clean + '{' + scopeRules(css.slice(innerStart, j)) + '}';
      i = j + 1;
      continue;
    }

    // 普通规则：选择器前缀化，声明块原样
    const end = css.indexOf('}', brace);
    out += list(clean) + css.slice(brace, end + 1);
    i = end + 1;
  }

  return out;
}

/* ============================== 执行 ==================================== */
mkdirSync(OUT_DIR, { recursive: true });

for (const name of MODULES) {
  let code = readFileSync(join(SRC_DIR, 'src', name), 'utf8');
  if (name === 'controls.js') code = patchControls(code);
  if (name === 'audio.js') code = patchAudio(code);
  writeFileSync(join(OUT_DIR, name), BANNER(name) + code);
  console.log(`  ${name}  ${code.length} B`);
}

const html = readFileSync(join(SRC_DIR, 'index.html'), 'utf8');
writeFileSync(join(OUT_DIR, 'tapeShell.js'), buildShell(html));
console.log('  tapeShell.js', buildShell(html).length, 'B');

const app = portMain(readFileSync(join(SRC_DIR, 'src', 'main.js'), 'utf8'));
writeFileSync(join(OUT_DIR, 'tapeApp.js'), app);
console.log('  tapeApp.js', app.length, 'B');

const css = scopeCss(readFileSync(join(SRC_DIR, 'styles.css'), 'utf8'));
writeFileSync(join(OUT_DIR, 'tape.css'), css);
console.log('  tape.css', css.length, 'B');

console.log('搬运完成 →', OUT_DIR);