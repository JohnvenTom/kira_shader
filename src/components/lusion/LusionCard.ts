/**
 * LusionCard - 单张 Featured Work 卡片的控制器（移植自 lusion ProjectItem）
 *
 * 职责（非 React，由 R3F 帧循环每帧驱动 update(dt)）：
 *  1. 悬停状态机：hoverRatio 线性推进 + 阈值(0/0.2/0.3)随机甩动 + 早期手抖
 *  2. 弹簧：焦点/视差相机(f=1,ζ=0.6,r=2) + 缩放(f=2.2,ζ=0.7,r=3)，全二阶动力学
 *  3. DOF 对焦呼吸：dofRangeOffset 0→-0.5（0.75/s 进，1/s 出），与缩放弹簧错拍
 *  4. 入场：showTime → u_showRatio（内容放大+圆角收敛）+ 侧滑/微旋（mesh 变换）
 *  5. DOM 同步：每帧读 .project-item-main 的 getBoundingClientRect 写 u_domXY/WH
 *  6. 文字动效：分类行乱码解码 + 项目名字母错峰滑入 + 悬停横移（直接写 DOM style）
 */
import * as THREE from 'three';
import { SecondOrderDynamics, VectorSecondOrderDynamics } from './SecondOrderDynamics';
import { LUSION_CARD_VERT, LUSION_CARD_FRAG } from './lusionShaders';

/* ---------- 工具（对应 lusion 的 math.fit / math.saturate / ease） ---------- */

function saturate(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** fit(x, a, b, c, d, ease?)：把 x 从 [a,b] 映射到 [c,d]（可带缓动） */
function fit(
  x: number, a: number, b: number, c: number, d: number,
  easeFn?: (t: number) => number,
): number {
  let t = b - a !== 0 ? (x - a) / (b - a) : 0;
  t = saturate(t);
  if (easeFn) t = easeFn(t);
  return c + (d - c) * t;
}

/** expoOut：lusion 入场缓动（快速冲出后缓收） */
function expoOut(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/** lusionEase：近似原站 ease.lusion 的丝缓动 */
function lusionEase(t: number): number {
  return 1 - Math.pow(1 - t, 3.2);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ---------- 文字动效参数（对应 lusion 常量） ---------- */
const LETTER_PER_SECOND = 40;    // 乱码解码速度
const MAX_RAND_LETTER_COUNT = 5; // 领先的随机字符数
const TEXT_STAGGER = 20;         // 字母入场错峰系数

export interface LusionCardOptions {
  id: string;
  index: number;
  /** 卡片图像占位 DOM（.project-item-main，透明矩形） */
  domMain: HTMLElement;
  /** 分类行 DOM（乱码解码目标） */
  domFooterLine1: HTMLElement;
  /** 项目名容器 DOM（字母滑入目标） */
  domFooterLine2: HTMLElement;
  category: string;
  title: string;
  colorTexture: THREE.Texture;
  depthTexture: THREE.Texture;
  textureWidth: number;
  textureHeight: number;
  colorBg: string;
  /** 蓝噪声共享 uniforms（u_blueNoiseTexture / TexelSize / CoordOffset） */
  blueNoiseUniforms: Record<string, THREE.IUniform>;
  timeUniform: THREE.IUniform;
  viewportWidth: number;
}

export class LusionCard {
  readonly id: string;
  readonly index: number;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  /* 悬停状态 */
  isHover = false;
  hoverRatio = 0;
  private readonly hoverThresholds = [0, 0.2, 0.3];
  private readonly focusZ = 0.5;
  private readonly parallaxStrength = 1;

  /* 弹簧（二阶动力学） */
  private focusPosMotion = new VectorSecondOrderDynamics({ x: 0, y: 0, z: -1 }, 1, 0.6, 2);
  private zoomMotion = new SecondOrderDynamics(0, 2.2, 0.7, 3);

  /* 甩动 */
  private shiftXYTarget = new THREE.Vector2();
  private shiftXY = new THREE.Vector2();

  /* DOF 呼吸 */
  private dofRangeOffsetRatio = 0;

  /* 入场 */
  private showTime = 0;

  /* 文字动效状态 */
  private footerLine1Text: string;
  private footerLine1Time = 0;
  private footerLine2Time = 0;
  private footerLine2HoverRatio = 0;
  private footerLetters: HTMLElement[] = [];
  private isHoverDom = false; // .project-item 整体 hover（控制标题横移）

  /* DOM 矩形缓存 */
  private domX = 0;
  private domY = 0;
  private domW = 0;
  private domH = 0;

  private viewportWidth: number;
  private opts: LusionCardOptions;

  constructor(opts: LusionCardOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.index = opts.index;
    this.viewportWidth = opts.viewportWidth;
    this.footerLine1Text = opts.category;

    this.buildTitle(opts.title);

    // 单位平面平移到 [0,1]²（lusion UfxMesh 同款）：顶点着色器按
    // position.xy × domWH − pivot 摆位，若不 translate 会整体错位半个宽高
    const geometry = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: LUSION_CARD_VERT,
      fragmentShader: LUSION_CARD_FRAG,
      defines: {
        PARALLAX_SAMPLES: 12,
        BLUR_SAMPLES: 6,
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        u_position: { value: new THREE.Vector3() },
        u_quaternion: { value: new THREE.Quaternion() },
        u_scale: { value: new THREE.Vector3(1, 1, 1) },
        u_domXY: { value: new THREE.Vector2() },
        u_domWH: { value: new THREE.Vector2() },
        u_domPivot: { value: new THREE.Vector2() },
        u_texture: { value: opts.colorTexture },
        u_depthTexture: { value: opts.depthTexture },
        u_textureSize: { value: new THREE.Vector2(opts.textureWidth, opts.textureHeight) },
        u_colorBg: { value: new THREE.Color(opts.colorBg) },
        u_showRatio: { value: 0 },
        u_activeRatio: { value: 0 },
        u_shiftXY: { value: this.shiftXY },
        u_focusPos: { value: new THREE.Vector3(0, 0, -1) },
        u_time: opts.timeUniform,
        u_zoomRatio: { value: 0 },
        u_dofRangeOffset: { value: 0 },
        u_saturation: { value: 0 },
        u_brightness: { value: 0 },
        u_borderRatio: { value: 0 },
        u_rippleStrength: { value: 0 },
        u_resolution: { value: new THREE.Vector2(1, 1) },
        u_globalRadius: { value: 22 },
        ...opts.blueNoiseUniforms,
      },
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false; // 顶点在 shader 里摆位，包围盒不适用
    this.mesh.renderOrder = 10;
  }

  /** 项目名 → 逐字母滑入结构（每字母一个 overflow:hidden 列 + 单 span） */
  private buildTitle(title: string): void {
    const inner = this.opts.domFooterLine2;
    inner.style.display = 'flex';
    for (const ch of title.toUpperCase()) {
      const col = document.createElement('span');
      col.className = 'lusion-letter-col';
      if (ch === ' ') {
        col.classList.add('lusion-letter-space');
        inner.appendChild(col);
        continue;
      }
      const span = document.createElement('span');
      span.className = 'lusion-letter';
      span.textContent = ch;
      span.style.transform = 'translate3d(0, 100%, 0)';
      col.appendChild(span);
      inner.appendChild(col);
      this.footerLetters.push(span);
    }
  }

  /* ---------- 事件（由 Overlay 绑定） ---------- */

  onHoverEnter(): void {
    this.isHover = true;
  }

  onHoverLeave(): void {
    this.isHover = false;
  }

  onItemEnter(): void {
    this.isHoverDom = true;
  }

  onItemLeave(): void {
    this.isHoverDom = false;
  }

  /* ---------- 每帧 ---------- */

  /** 视口/分辨率变化时刷新共享量 */
  setViewport(width: number, resolution: THREE.Vector2): void {
    this.viewportWidth = width;
    (this.material.uniforms.u_resolution.value as THREE.Vector2).copy(resolution);
  }

  /**
   * 每帧推进（对应 lusion ProjectItem.update）
   * @returns 卡片是否在视口内（false 时 mesh 隐藏并复位入场，滚回重播）
   */
  update(dt: number, mouse: { x: number; y: number }, time: number): boolean {
    /* DOM 矩形同步（视口像素；原生滚动时 rect 自动跟随） */
    const rect = this.opts.domMain.getBoundingClientRect();
    this.domX = rect.left;
    this.domY = rect.top;
    this.domW = Math.ceil(rect.width);
    this.domH = Math.ceil(rect.height);

    const inViewport = rect.bottom > -120 && rect.top < window.innerHeight + 120;
    this.mesh.visible = inViewport;
    if (!inViewport) {
      this.showTime = 0;
      this.footerLine1Time = 0;
      this.footerLine2Time = 0;
      return false;
    }

    /* ---- 文字动效 ---- */
    this.updateFooterTexts(dt);

    /* ---- 入场 ---- */
    this.showTime += dt;

    /* ---- 悬停状态机 ---- */
    const prev = this.hoverRatio;
    this.hoverRatio = Math.max(0, Math.min(1, this.hoverRatio + (this.isHover ? 1 : -1) * dt));

    // 甩动：越过阈值随机踢一脚（幅度随进度衰减），回落时指数衰减
    if (prev < this.hoverRatio) {
      const i0 = this.findIndexFromThresholds(prev);
      const i1 = this.findIndexFromThresholds(this.hoverRatio);
      if (i1 !== i0) {
        const a = Math.random() - 0.5;
        const b = Math.random() - 0.5;
        const len = Math.hypot(a, b) || 1;
        const mag = fit(this.hoverRatio, 0, 0.6, 1, 0);
        this.shiftXYTarget.set((a / len) * mag, (b / len) * mag);
      }
      if (i1 === this.hoverThresholds.length) this.shiftXYTarget.multiplyScalar(0.5);
    } else {
      this.shiftXYTarget.multiplyScalar(0.95);
    }
    this.shiftXY.lerp(this.shiftXYTarget, 0.2);

    /* ---- 焦点/视差相机目标 ---- */
    if (this.isHover) {
      // 悬停初期手抖（cos20t / sin30t），hoverRatio 0.3 后消失
      const jit = fit(this.hoverRatio, 0, 0.3, 1, 0) * this.domH * 0.75;
      const tx =
        ((mouse.x - this.domX - this.domW * 0.5 + Math.cos(time * 20) * jit) / this.domW) *
        -this.domH * this.parallaxStrength;
      const ty =
        ((mouse.y - this.domY - this.domH * 0.5 - Math.sin(time * 30) * jit) / this.domH) *
        this.domH * this.parallaxStrength;
      this.focusPosMotion.set(tx, ty, this.focusZ);
    } else {
      this.focusPosMotion.set(0, 0, -1); // 焦平面飞回无穷远 → 移出散焦
    }
    this.focusPosMotion.update(dt);

    /* ---- 缩放弹簧 ---- */
    this.zoomMotion.target = this.isHover ? 1 : 0;
    this.zoomMotion.update(dt);

    /* ---- DOF 呼吸（与缩放错拍：0.75/s 进 / 1/s 出）---- */
    this.dofRangeOffsetRatio = saturate(
      this.dofRangeOffsetRatio + (this.isHover ? 0.75 : -1) * dt,
    );

    /* ---- 写 uniforms ---- */
    const u = this.material.uniforms;
    (u.u_domXY.value as THREE.Vector2).set(this.domX, this.domY);
    (u.u_domWH.value as THREE.Vector2).set(this.domW, this.domH);
    (u.u_domPivot.value as THREE.Vector2).set(this.domW * 0.5, this.domH * 0.5);
    (u.u_focusPos.value as THREE.Vector3).set(
      this.focusPosMotion.value.x,
      this.focusPosMotion.value.y,
      this.focusPosMotion.value.z,
    );
    u.u_zoomRatio.value = this.zoomMotion.value;
    u.u_dofRangeOffset.value = mix(0, -0.5, this.dofRangeOffsetRatio);
    u.u_showRatio.value = fit(this.showTime, 0, 1.5, 0, 1, expoOut);

    /* ---- 入场侧滑/微旋（奇偶左右交替，expoOut 2s）---- */
    const c = fit(this.showTime, 0, 2, 0, 1, expoOut);
    (u.u_position.value as THREE.Vector3).set(
      (1 - c) * ((this.index % 2) - 0.5) * -this.viewportWidth * 0.1,
      0,
      0,
    );
    (u.u_quaternion.value as THREE.Quaternion).setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (1 - c) * ((this.index % 2) - 0.5) * 0.1,
    );

    return true;
  }

  /* ---------- 文字动效 ---------- */

  private updateFooterTexts(dt: number): void {
    /* 行1：乱码解码（40 字符/s，领先 5 个随机字符） */
    this.footerLine1Time += dt;
    const text = this.footerLine1Text;
    const settled = Math.min(
      text.length,
      Math.floor(LETTER_PER_SECOND * this.footerLine1Time) - MAX_RAND_LETTER_COUNT,
    );
    const scrambled = Math.min(
      text.length,
      Math.floor(LETTER_PER_SECOND * this.footerLine1Time),
    );
    let out = '';
    for (let i = 0; i < settled; i++) out += text[i];
    for (let i = 0; i < scrambled - settled; i++) {
      out += String.fromCharCode(33 + ~~(Math.random() * 93));
    }
    this.opts.domFooterLine1.textContent = out;

    /* 行2：字母错峰滑入（余弦相位：首尾先动）+ 悬停横移 1.5em */
    this.footerLine2Time += dt * 0.8;
    this.footerLine2HoverRatio = saturate(
      this.footerLine2HoverRatio + (this.isHoverDom ? 1 : -1) * dt * 2.5,
    );
    const n = this.footerLetters.length;
    const shiftX = fit(this.footerLine2HoverRatio, 0, 1, 0, 1.5, lusionEase);
    this.footerLetters.forEach((span, i) => {
      const phase = fit(i, 0, Math.max(n - 1, 1), Math.PI / 2, (3 * Math.PI) / 2);
      const g = saturate(this.footerLine2Time - Math.cos(phase) / TEXT_STAGGER);
      const slide = (1 - g) * 100; // 100% → 0（从下方滑入）
      span.style.transform = `translate3d(${shiftX}em, ${slide}%, 0)`;
    });
  }

  private findIndexFromThresholds(v: number): number {
    for (let i = 0; i < this.hoverThresholds.length; i++) {
      if (v < this.hoverThresholds[i]) return i;
    }
    return this.hoverThresholds.length;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
