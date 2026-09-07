/**
 * pianoAudio.ts —— 纯 WebAudio 合成的三角钢琴音源
 *
 * 功能：
 *  - 加法合成（基频 + 6 个泛音，含微失谐）+ 击弦噪声 + 卷积混响
 *  - 延音/弱音踏板、音量/混响调节、声部限制、panic 全音收束
 *  - 移植自独立钢琴项目的 audio.js（全局脚本版），改为 ES Module 单例
 *
 * 参数：无（导出单例对象）
 * 返回值：无
 * 异常：无（AudioContext 不可用时 init 返回 null，各接口静默降级）
 *
 * 注意事项：
 *  - 浏览器要求用户手势后才能出声：首次 noteOn 前应先调用 init()
 *  - 卷积混响的脉冲响应为程序化生成的噪声衰减曲线
 */

let ctx: AudioContext | null = null;
let master: GainNode;
let comp: DynamicsCompressorNode;
let dry: GainNode;
let wet: GainNode;
let conv: ConvolverNode;
let ready = false;
let volume = 0.85;
let sustain = false;
let soft = false;
const voices = new Map<number, Voice>();   // midi -> voice
const holding = new Set<number>();         // 手指按住的键

/** 单个发声部（一个音符的全部振荡器与增益链） */
interface Voice {
  midi: number;
  gain: GainNode;
  oscs: OscillatorNode[];
  start: number;
  decay: number;
  dead: boolean;
}

/** 泛音表：谐波倍率 / 幅度 / 衰减系数 */
const PARTIALS = [
  { h: 1.000, a: 1.00, d: 1.00 },
  { h: 2.002, a: 0.44, d: 0.62 },
  { h: 3.004, a: 0.22, d: 0.42 },
  { h: 4.008, a: 0.12, d: 0.30 },
  { h: 5.014, a: 0.07, d: 0.22 },
  { h: 6.022, a: 0.04, d: 0.16 },
  { h: 8.04,  a: 0.02, d: 0.10 },
];

/**
 * midi 音符号转频率（Hz）
 *
 * 参数：
 *  - midi {number} MIDI 音符号（21~108）
 *
 * 返回值：{number} 频率
 */
export function freq(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }

/**
 * 程序化生成混响脉冲响应（噪声指数衰减 + 早期反射）
 *
 * 参数：
 *  - seconds {number} IR 时长（秒）
 *  - decay   {number} 衰减指数
 *
 * 返回值：{AudioBuffer} 立体声脉冲响应
 */
function makeIR(seconds: number, decay: number): AudioBuffer {
  const rate = ctx!.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx!.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
    // 少量早期反射，让空间感更像琴房
    [0.011, 0.019, 0.031, 0.047, 0.062].forEach((tt, k) => {
      const idx = Math.floor(tt * rate) + (ch ? 37 : 0);
      if (idx < len) d[idx] += (k % 2 ? -1 : 1) * (0.42 - k * 0.06);
    });
  }
  return buf;
}

/**
 * 初始化音频上下文（幂等，可重复调用）
 *
 * 功能：创建 AudioContext 及主链路（master → compressor → destination）、
 *       干湿两路（dry/wet + convolver）
 *
 * 参数：无
 * 返回值：{AudioContext | null} 音频上下文（不可用时为 null）
 */
function init(): AudioContext | null {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = volume;

  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 26;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.004;
  comp.release.value = 0.30;

  conv = ctx.createConvolver();
  conv.buffer = makeIR(2.6, 2.4);

  dry = ctx.createGain(); dry.gain.value = 0.82;
  wet = ctx.createGain(); wet.gain.value = 0.26;

  dry.connect(master);
  wet.connect(conv); conv.connect(master);
  master.connect(comp);
  comp.connect(ctx.destination);
  ready = true;
  return ctx;
}

/**
 * 把发声节点接入干湿两路
 *
 * 参数：
 *  - node {AudioNode} 要接入的节点
 */
function connectVoice(node: AudioNode) {
  node.connect(dry);
  node.connect(wet);
}

/**
 * 停止一个发声部（指数收束 + 停止所有振荡器）
 *
 * 参数：
 *  - v    {Voice}      发声部
 *  - when {number}     停止时刻（默认当前）
 *  - fast {boolean}    是否快速收束（重复按同键时）
 */
function stopVoice(v: Voice, when?: number, fast?: boolean) {
  const t = when === undefined ? ctx!.currentTime : when;
  const rel = fast ? 0.02 : 0.16;
  try {
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0.0001, t, rel / 3);
  } catch { /* noop */ }
  v.oscs.forEach((o) => { try { o.stop(t + rel + 0.06); } catch { /* noop */ } });
  v.dead = true;
}

/**
 * 触发一个音符（加法合成 + 击弦噪声）
 *
 * 参数：
 *  - midi {number} MIDI 音符号（21~108）
 *  - vel  {number} 力度 0~1（影响音量、亮度、击弦噪声）
 *
 * 返回值：{Voice | undefined} 发声部（上下文不可用时 undefined）
 */
function noteOn(midi: number, vel?: number): Voice | undefined {
  if (!init()) return;
  vel = Math.max(0.05, Math.min(1, vel === undefined ? 0.8 : vel));
  if (soft) vel *= 0.65;
  const t = ctx!.currentTime;
  const old = voices.get(midi);
  if (old && !old.dead) stopVoice(old, t, true);

  const f = freq(midi);
  const i = midi - 21;

  const gain = ctx!.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(vel * 0.28, t + 0.005);

  const lp = ctx!.createBiquadFilter();
  lp.type = 'lowpass';
  const bright = soft ? 8 : 13;
  lp.frequency.setValueAtTime(Math.min(17000, f * bright + 900), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(320, f * 3.2), t + 1.4);
  lp.Q.value = 0.55;

  // 部分旧环境无 createStereoPanner，存在性判断后再创建声像节点
  const pan = typeof ctx!.createStereoPanner === 'function' ? ctx!.createStereoPanner() : null;
  if (pan) pan.pan.value = Math.max(-0.62, Math.min(0.62, ((midi - 62) / 46) * 0.6));

  gain.connect(lp);
  if (pan) { lp.connect(pan); connectVoice(pan); } else connectVoice(lp);

  // 整体衰减时长：低音绵长、高音短促
  const decay = 13.5 * Math.pow(0.5, i / 26) + 0.5;
  const oscs: OscillatorNode[] = [];
  PARTIALS.forEach((p, k) => {
    const hf = f * p.h;
    if (hf > 17500) return;
    const o = ctx!.createOscillator();
    o.type = k === 0 ? 'triangle' : 'sine';
    o.frequency.value = hf;
    o.detune.value = (Math.random() - 0.5) * 3.5;
    const pg = ctx!.createGain();
    const amp = p.a * (k === 0 ? 0.85 : 1) * (0.55 + vel * 0.6);
    pg.gain.setValueAtTime(0.0001, t);
    pg.gain.linearRampToValueAtTime(amp, t + 0.006 + k * 0.002);
    pg.gain.exponentialRampToValueAtTime(0.0002, t + Math.max(0.22, decay * p.d));
    o.connect(pg); pg.connect(gain);
    o.start(t);
    o.stop(t + decay + 0.4);
    oscs.push(o);
  });

  // 击弦瞬态噪声
  const nLen = 0.055;
  const nb = ctx!.createBuffer(1, Math.max(64, Math.floor(ctx!.sampleRate * nLen)), ctx!.sampleRate);
  const nd = nb.getChannelData(0);
  for (let s = 0; s < nd.length; s++) {
    nd[s] = (Math.random() * 2 - 1) * Math.pow(1 - s / nd.length, 3.2);
  }
  const ns = ctx!.createBufferSource();
  ns.buffer = nb;
  const nf = ctx!.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = Math.min(9000, f * 5.5);
  nf.Q.value = 0.9;
  const ng = ctx!.createGain();
  ng.gain.value = 0.045 * vel * (1 + (108 - midi) / 160);
  ns.connect(nf); nf.connect(ng); ng.connect(gain);
  ns.start(t);

  const voice: Voice = { midi, gain, oscs, start: t, decay, dead: false };
  voices.set(midi, voice);
  holding.add(midi);

  // 声部限制
  if (voices.size > 26) {
    let oldest: Voice | null = null;
    voices.forEach((v) => {
      if (v.dead) return;
      if (!oldest || v.start < oldest.start) oldest = v;
    });
    const o = oldest as Voice | null;
    if (o && o.midi !== midi) { stopVoice(o); voices.delete(o.midi); }
  }
  return voice;
}

/**
 * 释放一个音符（延音踏板按下时改为自然衰减）
 *
 * 参数：
 *  - midi {number} MIDI 音符号
 */
function noteOff(midi: number) {
  holding.delete(midi);
  if (!ctx) return;
  const v = voices.get(midi);
  if (!v || v.dead) return;
  if (sustain) return;               // 延音踏板按下：让它继续自然衰减
  stopVoice(v);
  voices.delete(midi);
}

/**
 * 设置延音踏板
 *
 * 参数：
 *  - on {boolean} 是否踩下
 */
function setSustain(on: boolean) {
  sustain = !!on;
  if (!ctx) return;
  if (!sustain) {
    // 抬起踏板：所有未按住的音收束
    voices.forEach((v, midi) => {
      if (!holding.has(midi) && !v.dead) { stopVoice(v); voices.delete(midi); }
    });
  }
}

/**
 * 设置弱音踏板
 *
 * 参数：
 *  - on {boolean} 是否踩下
 */
function setSoft(on: boolean) { soft = !!on; }

/**
 * 紧急收束所有声音（重置按钮用）
 */
function panic() {
  if (!ctx) return;
  voices.forEach((v) => stopVoice(v, ctx!.currentTime, true));
  voices.clear();
  holding.clear();
}

/**
 * 设置主音量
 *
 * 参数：
 *  - v {number} 0~1.4
 */
function setVolume(v: number) {
  volume = Math.max(0, Math.min(1.4, v));
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
}

/**
 * 设置混响湿度
 *
 * 参数：
 *  - v {number} 0~0.85
 */
function setReverb(v: number) {
  if (!wet || !ctx) return;
  wet.gain.setTargetAtTime(Math.max(0, Math.min(0.85, v)), ctx.currentTime, 0.03);
  dry.gain.setTargetAtTime(0.95 - Math.min(0.5, v * 0.6), ctx.currentTime, 0.03);
}

/** 导出的音频引擎单例 */
export const PianoAudio = {
  init, noteOn, noteOff, setSustain, setSoft, setVolume, setReverb, panic, freq,
  get isReady() { return ready; },
  get context() { return ctx; },
  get activeVoices() { return voices.size; },
};
