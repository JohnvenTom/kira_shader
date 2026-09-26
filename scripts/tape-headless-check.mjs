/**
 * tape-headless-check.mjs —— 用 headless Chrome + CDP 验证磁带机 / 音乐盒角标
 *
 * 功能：
 *   1. 以 headless 模式启动一个独立 Chrome（临时 profile，不干扰你正在用的窗口），
 *      并放行自动播放策略（--autoplay-policy=no-user-gesture-required），
 *      这样脚本里的合成点击也能让音频真正出声
 *   2. 打开指定 URL，等待 --expect 指定的选择器出现（默认 #tape-root.ready）
 *   3. 做一次诊断采样（磁带页与角标都采，缺失的记为 null）：
 *      加载步进、WebGL 上下文是否丢失、主循环是否在跑、画布像素、角标状态与进度
 *   4. 执行 --do 给出的步骤序列（见下），最后截一张图存到 screenshots/
 *
 * 参数（命令行，均可选）：
 *   --url=<地址>      默认 http://localhost:5173/#tape
 *   --out=<png 路径>  默认 screenshots/tape-check.png
 *   --wait=<秒>       ready 的最长等待，默认 150（软件渲染下 boot 很慢）
 *   --port=<端口>     CDP 调试端口，默认 9333
 *   --expect=<选择器> 就绪判据，默认 #tape-root.ready（验证角标时传 .music-dock）
 *   --do=<步骤>       逗号分隔的步骤序列，支持：
 *                       probe            采样一次并打印（含 1.2s 计时采样，用于判断主循环在跑）
 *                       snap             轻量快照（不做等待）：路由 / 过渡类 / transform / 伪元素 / 加载屏，
 *                                        用来抓展开与收闭动画的中段
 *                       click:<选择器>    真实 CDP 鼠标点击（可信输入，会授予用户手势）
 *                       hash:<#值>        改 location.hash（路由跳转）
 *                       key:<按键>        派发 keydown（空格写"空格"）
 *                       drag:<dx>x<dy>    真实鼠标拖动（可信输入），并报告按下时是否有 dragging 态
 *                       wheel:<deltaY>    真实滚轮（可信输入），用来验证推拉镜头
 *                       wait:<秒>         等待
 *                       reload            重新加载当前页（等 --expect 重新出现），用于验证跨刷新的记忆
 *                       ready:<选择器>    等该选择器出现（最多 120s）
 *                       shot:<路径>       单独截一张图
 *
 * 返回值：无（退出码 0 = 就绪判据满足并拿到截图，1 = 超时或出错）
 *
 * 异常：Chrome 未找到、CDP 连不上、等待超时都会打印错误并以退出码 1 结束
 *
 * 注意事项：
 *  - headless 下走 SwiftShader 软件渲染，boot 明显慢于真实 GPU；这是"能不能跑通"的验证，
 *    不是性能结论
 *  - 必须用 CDP 而不是 `chrome --screenshot`：后者不等 WebGL 出帧，拍到的只是加载屏
 *    （原项目 tools/page-shot.mjs 的注释里记了同一个坑）
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HERE = dirname(fileURLToPath(import.meta.url));

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const URL_TARGET = arg('url', 'http://localhost:5173/#tape');
const OUT = resolve(HERE, '..', arg('out', 'screenshots/tape-check.png'));
const WAIT_S = Number(arg('wait', '150'));
const PORT = Number(arg('port', '9333'));
const EXPECT = arg('expect', '#tape-root.ready');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等待 CDP 的页面目标出现，返回其 webSocketDebuggerUrl */
async function waitTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  throw new Error('CDP 目标未出现');
}

/** 极简 CDP 客户端：send(method, params) → 返回结果 */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  return {
    ready,
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
    }),
    close: () => ws.close(),
  };
}

/** 在页面里求值，返回解析后的值 */
async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面求值异常：' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
  return r.result.value;
}

/** 真实鼠标点击（CDP 可信输入：合成 click 不算用户手势，音频会被自动播放策略拦住） */
async function realClick(cdp, selector) {
  const box = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) return 'miss';
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  return 'ok';
}

/** 页面内的诊断探针：磁带页与音乐盒角标都采（缺失的记为 null） */
const PROBE = `(async () => {
  const root = document.querySelector('#tape-root');
  const c = root?.querySelector('canvas#gl');
  const gl = c ? (c.getContext('webgl2') || c.getContext('webgl')) : null;
  const dock = document.querySelector('.music-dock');
  const clockA = document.querySelector('#clock')?.textContent ?? '';
  const dockTimeA = document.querySelector('.music-dock-time')?.textContent ?? '';
  await new Promise((r) => setTimeout(r, 1200));
  const clockB = document.querySelector('#clock')?.textContent ?? '';
  const dockTimeB = document.querySelector('.music-dock-time')?.textContent ?? '';
  const pix = await new Promise((res) => requestAnimationFrame(() => {
    if (!gl || gl.isContextLost()) return res(null);
    const px = new Uint8Array(4);
    const pts = [[c.width >> 1, c.height >> 1], [Math.floor(c.width * 0.32), Math.floor(c.height * 0.5)]];
    res(pts.map(([x, y]) => { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px).join(','); }));
  }));
  return JSON.stringify({
    hash: location.hash,
    tape: root ? {
      ready: !!root.classList.contains('ready'),
      classes: root.className,
      theme: root.getAttribute('data-theme') ?? '',
      step: document.querySelector('#llbl')?.textContent ?? '',
      pct: document.querySelector('#lpct')?.textContent ?? '',
      clockTicking: clockA !== clockB,
      nowSub: document.querySelector('#now-sub')?.textContent ?? '',
      counter: document.querySelector('#tc')?.textContent ?? '',
      total: document.querySelector('#td')?.textContent ?? '',
      audioInRoot: !!root.querySelector('audio'),
      backBtn: !!document.querySelector('#btn-back'),
      uiHidden: (() => { const el = root.querySelector('.ui'); return el ? getComputedStyle(el).display === 'none' : null; })(),
      records: document.querySelectorAll('#ref-list li').length,
      canvas: c ? { w: c.width, h: c.height, lost: gl ? gl.isContextLost() : 'no-handle' } : null,
      pixels: pix,
    } : null,
    dock: dock ? {
      classes: dock.className,
      title: document.querySelector('.music-dock-title')?.textContent ?? '',
      credits: document.querySelector('.music-dock-credits')?.textContent ?? '',
      time: dockTimeA,
      timeTicking: dockTimeA !== dockTimeB,
      toggleDisabled: !!document.querySelector('.music-dock-toggle')?.disabled,
      progress: (() => { const i = document.querySelector('.music-dock-prog i'); const m = i && getComputedStyle(i).transform.match(/matrix\\(([-\\d.]+)/); return m ? Number(m[1]).toFixed(3) : null; })(),
    } : null,
  });
})()`;

/** 轻量快照：专门用来抓过渡动画的中段（不带任何等待） */
const SNAP = `(() => {
  const root = document.querySelector('#tape-root');
  const dock = document.querySelector('.music-dock');
  const cs = root ? getComputedStyle(root) : null;
  const before = root ? getComputedStyle(root, '::before') : null;
  const after = root ? getComputedStyle(root, '::after') : null;
  const box = root?.querySelector('.loader-box');
  const m = cs?.transform && cs.transform !== 'none' ? cs.transform.match(/matrix\\(([^)]+)\\)/) : null;
  return JSON.stringify({
    hash: location.hash,
    rootClasses: root ? root.className : null,
    theme: root ? root.getAttribute('data-theme') : null,
    transform: cs ? cs.transform : null,
    scale: m ? Number(m[1].split(',')[0]).toFixed(4) : (cs ? 'none' : null),
    chip: before ? before.backgroundColor : null,
    hair: after ? after.opacity : null,
    loaderBox: box ? getComputedStyle(box).opacity : null,
    loader: root?.querySelector('.loader') ? getComputedStyle(root.querySelector('.loader')).opacity : null,
    dockClasses: dock ? dock.className : null,
    /* 诊断用：headless 下 CSS 的 prefers-reduced-motion 与 matchMedia 可能不一致，
       两条都报出来，免得把"动画被媒体查询关掉"误读成"代码没生效" */
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    boxAnim: box ? getComputedStyle(box).animationName : null,
    /* 诊断用：过渡本身是否成立（变量解析失败会让整条 transition 失效、动画变成瞬移） */
    tProp: cs ? cs.transitionProperty : null,
    tDur: cs ? cs.transitionDuration : null,
    ttExpand: cs ? cs.getPropertyValue('--tt-expand').trim() : null,
    easeVar: cs ? cs.getPropertyValue('--ease').trim() : null,
    /* 决定性诊断：CSS 过渡/动画在动画引擎里的真实状态。
       为空 = 引擎里没有在跑的动画（环境不推进动画），有但 playState=finished = 已瞬移到位 */
    anims: document.getAnimations().slice(0, 8).map((a) => ({
      type: a.constructor.name,
      prop: a.transitionProperty || a.animationName || '',
      state: a.playState,
      t: Math.round(Number(a.currentTime) || 0),
      dur: a.effect?.getTiming?.().duration ?? null,
    })),
  });
})()`;

/* ============================== 执行 ==================================== */
const profile = mkdtempSync(join(tmpdir(), 'tape-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1600,900',
  '--hide-scrollbars',
  '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  '--no-default-browser-check',
  URL_TARGET,
], { stdio: 'ignore' });

const shots = [];
let exitCode = 1;
try {
  const wsUrl = await waitTarget();
  const cdp = connect(wsUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  /* headless Chrome 默认会把 CSS 的 prefers-reduced-motion 报成 reduce（而这套动画就是靠
     媒体查询和 matchMedia 双开关控制的），所以显式模拟成 no-preference，让动画真的跑起来。
     要专门验证"减少动效"这条降级路径时传 --motion=reduce。 */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: arg('motion', 'no-preference') }],
  });

  /** 截图（同时记进清单） */
  const shot = async (path) => {
    const p = resolve(HERE, '..', path);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(p, Buffer.from(r.data, 'base64'));
    shots.push(p);
    console.log('截图：', p);
  };

  const t0 = Date.now();
  let ready = false;
  while ((Date.now() - t0) / 1000 < WAIT_S) {
    await sleep(3000);
    ready = await evaluate(cdp, `!!document.querySelector(${JSON.stringify(EXPECT)})`);
    const label = await evaluate(cdp, `document.querySelector('#llbl')?.textContent ?? document.querySelector('.music-dock-title')?.textContent ?? ''`);
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ready=${ready} (${label})`);
    if (ready) break;
  }
  if (!ready) throw new Error(`等待就绪超时：${EXPECT}`);
  console.log('诊断：', JSON.stringify(JSON.parse(await evaluate(cdp, PROBE)), null, 2));

  /* 步骤序列 */
  for (const step of arg('do', '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const [op, ...rest] = step.split(':');
    const val = rest.join(':');
    if (op === 'probe') {
      console.log('采样：', await evaluate(cdp, PROBE));
    } else if (op === 'snap') {
      console.log('快照：', await evaluate(cdp, SNAP));
    } else if (op === 'click') {
      console.log(`点击 ${val} →`, await realClick(cdp, val));
      await sleep(60);            // 只等一个最短的反应时间；要抓动画中段请在 --do 里跟 snap/wait
    } else if (op === 'hash') {
      await evaluate(cdp, `location.hash = ${JSON.stringify(val)}`);
      console.log('跳转 →', val);
      await sleep(1200);
    } else if (op === 'key') {
      const key = val === '空格' ? ' ' : val;
      await evaluate(cdp, `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);
      console.log('按键', val);
      await sleep(900);
    } else if (op === 'wait') {
      await sleep(Number(val) * 1000);
    } else if (op === 'drag') {
      const [dx, dy] = val.split('x').map(Number);
      const c = await evaluate(cdp, `(() => {
        const el = document.querySelector('#tape-root canvas#gl');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      if (!c) throw new Error('拖动失败：找不到 #tape-root canvas#gl');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(60);
      const during = await evaluate(cdp, `document.querySelector('#tape-root').classList.contains('dragging')`);
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', button: 'left', buttons: 1,
          x: Math.round(c.x + (dx * i) / steps), y: Math.round(c.y + (dy * i) / steps),
        });
        await sleep(40);
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(c.x + dx), y: Math.round(c.y + dy), button: 'left', buttons: 0, clickCount: 1 });
      const after = await evaluate(cdp, `document.querySelector('#tape-root').className`);
      console.log(`拖动 (${dx},${dy}) → 按下时 dragging=${during}，松开后 classes="${after}"`);
      await sleep(900);
    } else if (op === 'wheel') {
      const dy = Number(val);
      const c = await evaluate(cdp, `(() => {
        const el = document.querySelector('#tape-root canvas#gl');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      if (!c) throw new Error('滚轮失败：找不到 #tape-root canvas#gl');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: dy });
      console.log('滚轮', dy);
      await sleep(900);
    } else if (op === 'reload') {
      await cdp.send('Page.reload', {});
      const t = Date.now();
      let ok = false;
      while (Date.now() - t < 90000) {
        await sleep(2000);
        ok = await evaluate(cdp, `!!document.querySelector(${JSON.stringify(EXPECT)})`);
        if (ok) break;
      }
      console.log('重新加载 →', ok ? 'OK' : '超时');
      if (!ok) throw new Error('reload 后等待就绪超时');
    } else if (op === 'ready') {
      const t = Date.now();
      let ok = false;
      while (Date.now() - t < 120000) {
        ok = await evaluate(cdp, `!!document.querySelector(${JSON.stringify(val)})`);
        if (ok) break;
        await sleep(3000);
      }
      console.log(`等待 ${val} → ${ok ? 'OK' : '超时'}`);
      if (!ok) throw new Error(`步骤 ready 超时：${val}`);
    } else if (op === 'shot') {
      await shot(val);
    } else {
      throw new Error('未知步骤：' + step);
    }
  }

  await shot(OUT.replace(/^.*screenshots[\\/]/, 'screenshots/'));
  exitCode = 0;
  cdp.close();
} catch (e) {
  console.error('验证失败：', e.message);
} finally {
  chrome.kill();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 临时目录清不掉不影响结果 */ }
}

process.exit(exitCode);