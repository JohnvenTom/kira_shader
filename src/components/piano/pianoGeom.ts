/**
 * pianoGeom.ts —— 通用几何 / 纹理工具库（纯白钢琴项目）
 *
 * 功能：
 *  - 提供钢琴程序化建模所需的几何工具：多边形偏移、挤出、棱柱、圆角矩形、
 *    几何合并、车削轮廓等
 *  - 提供程序化纹理生成：接地柔影、云杉音板木纹、琴键粗糙度、品牌贴花
 *  - 移植自独立钢琴项目的 geom.js（全局脚本版），改为 ES Module
 *
 * 参数：无（纯工具函数库）
 * 返回值：无（导出工具函数集合）
 * 异常：无（canvas 不可用时返回 null 纹理，由调用方兜底）
 *
 * 注意事项：
 *  - 仅依赖 three，不依赖任何外部资源（全部程序化生成）
 */
import * as THREE from 'three';

/** 快捷创建 Vector2 */
export const V2 = (x: number, y: number): THREE.Vector2 => new THREE.Vector2(x, y);

/**
 * 计算闭合多边形的有符号面积
 *
 * 功能：通过鞋带公式计算多边形有符号面积，用于判断顶点环绕方向
 *
 * 参数：
 *  - pts {THREE.Vector2[]} 闭合多边形顶点数组
 *
 * 返回值：{number} 有符号面积（>0 表示逆时针 CCW）
 */
export function signedArea(pts: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

/**
 * 将闭合多边形向内偏移 dist（角平分线法 + 斜接限制）
 *
 * 功能：生成琴壳内壁等向内偏移的轮廓，偏移方向根据环绕方向自动确定
 *
 * 参数：
 *  - pts  {THREE.Vector2[]} 原始闭合多边形顶点
 *  - dist {number}          偏移距离（正值向内侧）
 *
 * 返回值：{THREE.Vector2[]} 偏移后的多边形顶点数组
 *
 * 注意事项：
 *  - 用 cosHalf 限制尖角处的过度外扩，避免产生自交
 */
export function offsetPolygon(pts: THREE.Vector2[], dist: number): THREE.Vector2[] {
  const n = pts.length;
  const sign = signedArea(pts) > 0 ? 1 : -1; // CCW 时内法线 = 左法线
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const d1 = p1.clone().sub(p0);
    const d2 = p2.clone().sub(p1);
    if (d1.lengthSq() < 1e-12 || d2.lengthSq() < 1e-12) { out.push(p1.clone()); continue; }
    d1.normalize(); d2.normalize();
    const n1 = V2(-d1.y, d1.x).multiplyScalar(sign);
    const n2 = V2(-d2.y, d2.x).multiplyScalar(sign);
    const bis = n1.clone().add(n2);
    if (bis.lengthSq() < 1e-10) bis.copy(n2);
    bis.normalize();
    const cosHalf = Math.max(0.4, bis.dot(n2)); // 限制尖角处的过度外扩
    out.push(p1.clone().add(bis.multiplyScalar(dist / cosHalf)));
  }
  return out;
}

/**
 * 采样 Shape 轮廓为点数组
 *
 * 参数：
 *  - shape     {THREE.Shape} 要采样的形状
 *  - divisions {number}      采样细分数（默认 64）
 *
 * 返回值：{THREE.Vector2[]} 轮廓点数组
 */
export function samplePoints(shape: THREE.Shape, divisions?: number): THREE.Vector2[] {
  return shape.extractPoints(divisions || 64).shape.map((p) => V2(p.x, p.y));
}

/**
 * 由点数组构建闭合 Shape
 *
 * 参数：
 *  - pts {THREE.Vector2[]} 顶点数组（首尾自动闭合）
 *
 * 返回值：{THREE.Shape} 闭合形状
 */
export function shapeFromPoints(pts: THREE.Vector2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i].x, pts[i].y);
  s.closePath();
  return s;
}

/**
 * 由点数组构建闭合 Path（用作 Shape 的孔洞）
 *
 * 参数：
 *  - pts {THREE.Vector2[]} 顶点数组
 *
 * 返回值：{THREE.Path} 闭合路径
 */
export function pathFromPoints(pts: THREE.Vector2[]): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  p.closePath();
  return p;
}

/**
 * 判断点是否在多边形内（射线法）
 *
 * 参数：
 *  - pts {THREE.Vector2[]} 多边形顶点
 *  - x   {number}          测试点 x
 *  - y   {number}          测试点 y
 *
 * 返回值：{boolean} 点是否在多边形内部
 */
export function pointInPolygon(pts: THREE.Vector2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 挤出选项 */
export interface ExtrudeOpts {
  /** shape.y 映射到 world +z（向下挤出） */
  down?: boolean;
  /** 倒角厚度（默认 0.0035，0 表示无倒角） */
  bevel?: number;
  /** 曲线细分数 */
  curveSegments?: number;
  /** 倒角细分数 */
  bevelSegments?: number;
}

/**
 * 把 2D 形状挤出成竖直的 3D 板件
 *
 * 功能：shape 的 x/y 平面映射到 world x/-z 平面，沿 y 轴挤出高度
 *       down=true 时挤出方向为 -y（shape.y → world +z）
 *
 * 参数：
 *  - shape  {THREE.Shape}   2D 形状
 *  - height {number}        挤出高度
 *  - opts   {ExtrudeOpts}   挤出选项
 *
 * 返回值：{THREE.BufferGeometry} 挤出后的几何体（已旋转到目标朝向）
 */
export function extrude(shape: THREE.Shape, height: number, opts?: ExtrudeOpts): THREE.BufferGeometry {
  const o = opts || {};
  const bev = o.bevel === undefined ? 0.0035 : o.bevel;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    curveSegments: o.curveSegments || 32,
    steps: 1,
    bevelEnabled: bev > 0,
    bevelThickness: bev,
    bevelSize: bev,
    bevelOffset: 0,
    bevelSegments: o.bevelSegments || 2,
  });
  geo.rotateX(o.down ? Math.PI / 2 : -Math.PI / 2);
  return geo;
}

/**
 * 由 8 个角点构成的棱柱（可做锥度/斜面，如黑键、踏板）
 *
 * 参数：
 *  - B0~B3 {THREE.Vector3} 底面四角（后左、后右、前右、前左）
 *  - T0~T3 {THREE.Vector3} 顶面四角（与底面一一对应）
 *
 * 返回值：{THREE.BufferGeometry} 12 三角面的棱柱几何体
 */
export function prism8(
  B0: THREE.Vector3, B1: THREE.Vector3, B2: THREE.Vector3, B3: THREE.Vector3,
  T0: THREE.Vector3, T1: THREE.Vector3, T2: THREE.Vector3, T3: THREE.Vector3
): THREE.BufferGeometry {
  const tri = [
    T0, T3, T2, T0, T2, T1,       // 顶
    B0, B1, B2, B0, B2, B3,       // 底
    B3, B2, T2, B3, T2, T3,       // 前
    B1, B0, T0, B1, T0, T1,       // 后
    B2, B1, T1, B2, T1, T2,       // 右
    B0, B3, T3, B0, T3, T0,       // 左
  ];
  const pos = new Float32Array(tri.length * 3);
  const uv = new Float32Array(tri.length * 2);
  for (let i = 0; i < tri.length; i++) {
    pos[i * 3] = tri[i].x; pos[i * 3 + 1] = tri[i].y; pos[i * 3 + 2] = tri[i].z;
    uv[i * 2] = (i % 3) * 0.5; uv[i * 2 + 1] = Math.floor((i % 6) / 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * 带锥度的方块：底面 w0×d0，顶面 w1×d1
 *
 * 参数：
 *  - w0 {number} 底面宽
 *  - w1 {number} 顶面宽
 *  - d0 {number} 底面深
 *  - d1 {number} 顶面深
 *  - h  {number} 高度
 *
 * 返回值：{THREE.BufferGeometry} 锥形方块几何体
 */
export function taperBox(w0: number, w1: number, d0: number, d1: number, h: number): THREE.BufferGeometry {
  const a = w0 / 2, b = w1 / 2;
  return prism8(
    new THREE.Vector3(-a, 0, 0), new THREE.Vector3(a, 0, 0), new THREE.Vector3(a, 0, d0), new THREE.Vector3(-a, 0, d0),
    new THREE.Vector3(-b, h, 0), new THREE.Vector3(b, h, 0), new THREE.Vector3(b, h, d1), new THREE.Vector3(-b, h, d1)
  );
}

/**
 * 圆角矩形 Shape
 *
 * 参数：
 *  - w {number} 宽
 *  - h {number} 高
 *  - r {number} 圆角半径（自动钳制到最小边的一半）
 *
 * 返回值：{THREE.Shape} 圆角矩形形状
 */
export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, Math.min(w, h) / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  s.closePath();
  return s;
}

/**
 * 简易几何合并（同属性、已烘焙变换的几何体拼接为单个几何体）
 *
 * 参数：
 *  - geos {(THREE.BufferGeometry | null | undefined)[]} 几何体列表
 *
 * 返回值：{THREE.BufferGeometry} 合并后的几何体（position/normal/uv 拼接）
 *
 * 注意事项：
 *  - 输入几何体需已应用各自变换（bake 过 matrix）
 */
export function merge(geos: (THREE.BufferGeometry | null | undefined)[]): THREE.BufferGeometry {
  const list = geos.filter(Boolean).map((g) => (g!.index ? g!.toNonIndexed() : g!));
  if (!list.length) return new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv'];
  const used = names.filter((n) => list.some((g) => g.getAttribute(n)));
  let total = 0;
  list.forEach((g) => (total += g.getAttribute('position').count));
  const out = new THREE.BufferGeometry();
  used.forEach((name) => {
    const size = name === 'uv' ? 2 : 3;
    const arr = new Float32Array(total * size);
    let off = 0;
    list.forEach((g) => {
      const a = g.getAttribute(name);
      const cnt = g.getAttribute('position').count;
      if (a) arr.set(a.array.subarray(0, cnt * size), off);
      off += cnt * size;
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  });
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

/** 变换描述（位置/旋转/缩放） */
export interface XformOpts {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

/**
 * 返回几何体应用变换后的副本
 *
 * 参数：
 *  - geo  {THREE.BufferGeometry} 原几何体
 *  - opts {XformOpts}             变换（pos 平移 / rot 欧拉 / scale 缩放）
 *
 * 返回值：{THREE.BufferGeometry} 变换后的新几何体（原几何体不变）
 */
export function xform(geo: THREE.BufferGeometry, opts: XformOpts = {}): THREE.BufferGeometry {
  const g = geo.clone();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  if (opts.rot) q.setFromEuler(new THREE.Euler(opts.rot[0] || 0, opts.rot[1] || 0, opts.rot[2] || 0));
  m.compose(
    new THREE.Vector3(opts.pos ? opts.pos[0] : 0, opts.pos ? opts.pos[1] : 0, opts.pos ? opts.pos[2] : 0),
    q,
    new THREE.Vector3(opts.scale ? opts.scale[0] : 1, opts.scale ? opts.scale[1] : 1, opts.scale ? opts.scale[2] : 1)
  );
  g.applyMatrix4(m);
  return g;
}

/**
 * 创建 2D 画布并返回 canvas 与 2D 上下文
 *
 * 参数：
 *  - w {number} 画布宽（像素）
 *  - h {number} 画布高（像素）
 *
 * 返回值：{{c: HTMLCanvasElement, x: CanvasRenderingContext2D | null}} 画布与上下文
 */
export function canvas2d(w: number, h: number): { c: HTMLCanvasElement; x: CanvasRenderingContext2D | null } {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, x: c.getContext('2d') };
}

/** 纹理完成选项 */
export interface FinishTexOpts {
  /** 是否按 sRGB 颜色空间处理（默认 true） */
  srgb?: boolean;
  /** 平铺 repeat */
  repeat?: [number, number];
  /** 各向异性过滤强度 */
  aniso?: number;
}

/**
 * 把 canvas 封装为 THREE 纹理
 *
 * 参数：
 *  - c    {HTMLCanvasElement} 画布
 *  - opts {FinishTexOpts}     纹理选项
 *
 * 返回值：{THREE.CanvasTexture} 纹理对象
 */
export function finishTex(c: HTMLCanvasElement, opts: FinishTexOpts = {}): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  tex.anisotropy = opts.aniso ?? 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 生成接地柔影纹理（径向 alpha 渐变）
 *
 * 参数：
 *  - size {number} 纹理尺寸（正方形边长，默认 256）
 *
 * 返回值：{THREE.CanvasTexture} 柔影纹理（Linear 色彩空间）
 */
export function contactShadow(size?: number): THREE.CanvasTexture {
  const s = size || 256;
  const { c, x } = canvas2d(s, s);
  if (!x) return finishTex(c);
  const g = x.createRadialGradient(s / 2, s / 2, s * 0.04, s / 2, s / 2, s * 0.5);
  g.addColorStop(0.0, 'rgba(120,126,138,0.55)');
  g.addColorStop(0.42, 'rgba(120,126,138,0.26)');
  g.addColorStop(0.78, 'rgba(120,126,138,0.06)');
  g.addColorStop(1.0, 'rgba(120,126,138,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return finishTex(c, { srgb: false });
}

/**
 * 生成云杉音板的细腻白木纹纹理（低对比）
 *
 * 参数：无
 * 返回值：{THREE.CanvasTexture} 木纹纹理
 */
export function soundboardGrain(): THREE.CanvasTexture {
  const { c, x } = canvas2d(1024, 256);
  if (!x) return finishTex(c);
  x.fillStyle = '#fbfbfa';
  x.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 190; i++) {
    const y = Math.random() * 256;
    x.strokeStyle = 'rgba(196,190,178,' + (0.05 + Math.random() * 0.13).toFixed(3) + ')';
    x.lineWidth = 0.4 + Math.random() * 1.5;
    x.beginPath();
    x.moveTo(0, y);
    for (let px = 0; px <= 1024; px += 64) {
      x.lineTo(px, y + Math.sin(px * 0.012 + i) * 1.6 + (Math.random() - 0.5) * 0.8);
    }
    x.stroke();
  }
  return finishTex(c, { repeat: [1, 1] });
}

/**
 * 生成象牙白琴键表面的极细纹理（用作 roughnessMap）
 *
 * 参数：无
 * 返回值：{THREE.CanvasTexture} 粗糙度纹理（Linear 色彩空间）
 */
export function keyRoughness(): THREE.CanvasTexture {
  const { c, x } = canvas2d(256, 256);
  if (!x) return finishTex(c);
  x.fillStyle = '#8a8a8a';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 120 + Math.random() * 70 | 0;
    x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.25)';
    x.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6);
  }
  for (let i = 0; i < 60; i++) {
    x.strokeStyle = 'rgba(150,150,150,0.18)';
    x.lineWidth = 0.6;
    x.beginPath();
    x.moveTo(0, Math.random() * 256);
    x.lineTo(256, Math.random() * 256);
    x.stroke();
  }
  return finishTex(c, { srgb: false, repeat: [1, 1] });
}

/**
 * 生成品牌字样贴花纹理（浅灰，低调镶嵌在琴键盖上）
 *
 * 参数：
 *  - text {string} 主品牌名
 *  - sub  {string} 副标语
 *
 * 返回值：{THREE.CanvasTexture} 贴花纹理（带透明通道）
 */
export function brandDecal(text: string, sub: string): THREE.CanvasTexture {
  const { c, x } = canvas2d(1024, 256);
  if (!x) return finishTex(c);
  x.clearRect(0, 0, 1024, 256);
  x.fillStyle = 'rgba(150,154,162,0.92)';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '600 92px "Times New Roman", Georgia, serif';
  if (x.fillText) x.fillText(text || 'AURORA', 512, 108);
  x.font = '300 34px "Helvetica Neue", Arial, sans-serif';
  x.fillStyle = 'rgba(160,164,172,0.8)';
  if (x.fillText) x.fillText(sub || 'H A N D   C R A F T E D   G R A N D', 512, 178);
  return finishTex(c);
}

/**
 * 车削轮廓几何体（琴腿等回转体）
 *
 * 参数：
 *  - profile  {[number, number][]} 轮廓点 [x, y] 数组
 *  - segments {number}             圆周细分数（默认 28）
 *
 * 返回值：{THREE.LatheGeometry} 车削几何体
 */
export function lathe(profile: [number, number][], segments?: number): THREE.LatheGeometry {
  const pts = profile.map((p) => V2(p[0], p[1]));
  return new THREE.LatheGeometry(pts, segments || 28);
}
