/**
 * LusionMeta - 卡片斜对角空白处的元信息网格（WebGL 层）
 *
 * 职责（与 LusionCard 同一套帧驱动模式）：
 *  1. Canvas 2D 一次性绘制元信息纹理：淡大编号 + 年份 + 短描述
 *  2. 每帧读 DOM 锚点（.lusion-item-meta）的 getBoundingClientRect 摆位
 *  3. 入场滑入：showTime → expoOut，从卡片一侧滑入（方向与奇偶卡错位相反）
 *  4. hover 联动：读取配对 LusionCard.hoverRatio，轻微提亮 + 放大
 *
 * DOM 锚点在指针精细（非触屏）时 visibility:hidden，仅提供布局矩形；
 * 触屏降级时不创建本类，锚点内直接显示文字。
 */
import * as THREE from 'three';

function expoOut(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function saturate(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** 淡大编号 + 年份 + 短描述 → 透明底纹理（白字带 alpha） */
function createMetaTexture(number: string, year: string, desc: string, alignRight: boolean): THREE.CanvasTexture {
  const W = 640;
  const H = 800;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const x = alignRight ? W - 40 : 40;
  ctx.textAlign = alignRight ? 'right' : 'left';
  ctx.textBaseline = 'top';

  // 大号淡编号（杂志页码感）
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.font = '300 220px Georgia, "Times New Roman", serif';
  ctx.fillText(number, x, 20);

  // 年份（等宽小字）
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.font = '500 30px "Courier New", monospace';
  ctx.fillText(year, x, 300);

  // 细分隔线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 356);
  ctx.lineTo(alignRight ? x - 120 : x + 120, 356);
  ctx.stroke();

  // 短描述（衬线斜体，按词换行）
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = 'italic 30px Georgia, "Times New Roman", serif';
  const maxWidth = W - 80;
  const words = desc.split(' ');
  let line = '';
  let y = 396;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += 44;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

const META_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const META_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D u_texture;
uniform float u_alpha;
void main() {
  vec4 c = texture2D(u_texture, vUv);
  if (c.a < 0.01) discard;
  gl_FragColor = vec4(c.rgb, c.a * u_alpha);
}
`;

export interface LusionMetaOptions {
  /** 编号（"01"..."06"） */
  number: string;
  year: string;
  desc: string;
  /** DOM 锚点（.lusion-item-meta，提供布局矩形） */
  domMeta: HTMLElement;
  /** 滑入方向：+1 从左侧滑入（配左侧卡），-1 从右侧滑入（配右侧卡） */
  dir: 1 | -1;
}

export class LusionMeta {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly opts: LusionMetaOptions;
  private showTime = 0;

  constructor(opts: LusionMetaOptions) {
    this.opts = opts;

    const texture = createMetaTexture(opts.number, opts.year, opts.desc, opts.dir === -1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: META_VERT,
      fragmentShader: META_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        u_texture: { value: texture },
        u_alpha: { value: 0 },
      },
    });

    // 居中单位平面：每帧按 DOM 矩形设置 position/scale
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5; // 卡片 renderOrder=10 之下
  }

  /**
   * 每帧推进
   * @param cardHover 配对 LusionCard 的 hoverRatio（0~1）
   * @returns 是否在视口内（false 时复位入场，滚回重播）
   */
  update(dt: number, cardHover: number): boolean {
    const rect = this.opts.domMeta.getBoundingClientRect();
    const inViewport = rect.bottom > -160 && rect.top < window.innerHeight + 160;
    this.mesh.visible = inViewport;
    if (!inViewport) {
      this.showTime = 0;
      return false;
    }

    this.showTime += dt;
    const show = expoOut(saturate(this.showTime / 1.4));
    const hover = saturate(cardHover);

    // 滑入：从卡片一侧移入（错位相反方向），随 hover 轻微向卡片靠拢
    const offX = -this.opts.dir * (1 - show) * 70 + this.opts.dir * hover * 14;
    const cx = rect.left + rect.width / 2 + offX;
    const cy = -(rect.top + rect.height / 2);
    const s = 1 + hover * 0.04;
    this.mesh.position.set(cx, cy, 0);
    this.mesh.scale.set(rect.width * s, rect.height * s, 1);

    this.material.uniforms.u_alpha.value = show * (0.85 + hover * 0.35);

    return true;
  }

  dispose(): void {
    (this.material.uniforms.u_texture.value as THREE.Texture).dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
