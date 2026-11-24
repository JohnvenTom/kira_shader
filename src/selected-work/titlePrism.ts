/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { SELECTED_PROJECTS, wrapIndex } from './data';
import { createTitleTextureSet, type TitleTextureSet } from './titleTextures';

/**
 * 旋转棱柱标题（线上 `m7` 的 TSL 复刻）
 *
 * 结构：一根沿屏幕横向摆放的四棱柱（BoxGeometry(面高, 棱柱长, 面高) 绕 z 转 90°），
 * 每个侧面贴一张项目标题横条；24 个分段各有自己的旋转角，用弹簧依次转向
 * `-90° × 选中序号`，形成沿长度方向传播的扭转波。只有当前朝向相机的面
 * （槽位 = 选中序号 mod 4）不透明度为 1，其余为 0。
 *
 * 顶点位移与 UV 重映射逐行照线上实现：
 *  - 顶点：绕长轴旋转 p（相邻分段 smootherstep 插值）+ 两组正弦波位移
 *  - UV：四个侧面各取贴图的 1/4 区间，shader 用 `floor(uv.x*4)` 选面、取样
 *  - 颜色：`alpha = texture.a * faceOpacity`，透明材质，字外区域直接透出场景
 */
const T = TSL as any;
const MAX_SEGMENTS = 24;
const CYLINDER_ROT = Math.PI / 2;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function buildPrismGeometry(textWidth: number, textHeight: number, segments: number) {
  const geometry = new THREE.BoxGeometry(textHeight, textWidth, textHeight, 1, 4 * segments, 1);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const index = geometry.index;
  if (!index || !normal || !uv) return { geometry, segments };

  // 去掉顶/底两个盖子（法线 |y| > .9），只留四个侧面
  const src = index.array as ArrayLike<number>;
  const kept: number[] = [];
  for (let i = 0; i < src.length; i += 3) {
    const a = src[i];
    const b = src[i + 1];
    const c = src[i + 2];
    if (a === undefined || b === undefined || c === undefined) continue;
    if (Math.abs(normal.getY(a)) <= 0.9) kept.push(a, b, c);
  }
  geometry.setIndex(kept);

  // 每个侧面映射到贴图的 1/4 横向区间：+z→0, +x→.25, -z→.5, -x→.75
  for (let i = 0; i < position.count; i++) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    if (Math.abs(ny) > 0.9) continue;
    let offset = 0;
    if (nz > 0.5) offset = 0;
    else if (nx > 0.5) offset = 0.25;
    else if (nz < -0.5) offset = 0.5;
    else if (nx < -0.5) offset = 0.75;
    uv.setX(i, uv.getX(i) * 0.25 + offset);
  }
  uv.needsUpdate = true;
  return { geometry, segments };
}

export interface TitlePrismHandle {
  mesh: THREE.Mesh;
  /** 视口变化：重建几何与标题贴图，更新 uniform */
  setSize: (cssWidth: number, cssHeight: number) => void;
  /** 选中项目（可为任意整数；>1 的变化直接跳转，不做连环旋转） */
  select: (index: number, immediate?: boolean) => void;
  update: (dt: number, time: number) => void;
  /** 当前棱柱使用的面宽高比（标题贴图已按此排版） */
  faceAspect: () => number;
  dispose: () => void;
}

export function createTitlePrism(initialIndex = 0): TitlePrismHandle {
  const textures: TitleTextureSet = createTitleTextureSet();

  const uTime = T.uniform(0);
  const uWidth = T.uniform(1);
  const uHeight = T.uniform(1);
  const uSegments = T.uniform(MAX_SEGMENTS);
  const uRot: any[] = Array.from({ length: MAX_SEGMENTS }, () => T.uniform(0));
  const uEnterExit: any[] = Array.from({ length: MAX_SEGMENTS }, () => T.uniform(0));
  const uOpacity: any[] = Array.from({ length: 4 }, () => T.uniform(0));
  const uIsFocused = T.uniform(0);
  const uHover = T.uniform(0);

  const material = new THREE.MeshBasicNodeMaterial();
  material.toneMapped = true;
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.FrontSide;

  // ---------- 顶点：逐段扭转 + 波浪 ----------
  material.positionNode = T.Fn(() => {
    const e = T.positionLocal.toVar();
    const r = T.oneMinus(e.y.add(uWidth.mul(0.5)).div(uWidth));
    const i = r.mul(uSegments.toFloat());
    const n = uSegments.sub(1);
    const a = T.clamp(T.floor(i), 0, n).toInt();
    const s = T.clamp(a.toFloat().add(1), 0, n).toInt();
    const o = T.fract(i);
    const l = T.clamp(o, 0, 1);
    const u = l.mul(l).mul(l).mul(l.mul(l.mul(6).sub(15)).add(10));

    const rotA = T.float(0).toVar();
    const rotB = T.float(0).toVar();
    const exitA = T.float(0).toVar();
    const exitB = T.float(0).toVar();
    for (let k = 0; k < MAX_SEGMENTS; k++) {
      rotA.assign(T.select(a.equal(k), uRot[k], rotA));
      rotB.assign(T.select(s.equal(k), uRot[k], rotB));
      exitA.assign(T.select(a.equal(k), uEnterExit[k], exitA));
      exitB.assign(T.select(s.equal(k), uEnterExit[k], exitB));
    }
    const p = T.mix(rotA.add(exitA), rotB.add(exitB), u);
    const cosP = T.cos(p);
    const sinP = T.sin(p);
    const x1 = e.x.mul(cosP).add(e.z.mul(sinP));
    const z1 = e.x.mul(sinP).negate().add(e.z.mul(cosP));
    const waveZ = T.sin(r.mul(10).add(uTime.mul(4))).mul(0.06);
    const waveY = T.sin(r.mul(8).add(uTime.mul(3))).mul(0.03);
    return T.vec3(x1, e.y.add(waveY), z1.add(waveZ));
  })();

  // ---------- 片元：四张贴图 + 面不透明度 ----------
  material.colorNode = T.Fn(() => {
    const uv = T.uv();
    // 原创是 R3F 离屏 FBO 贴图；本实现用 Canvas2D（flipY），U 轴需取反以对齐朝向
    const face = T.clamp(T.floor(uv.x.mul(4)), 0, 3).toInt();
    const sampleUv = T.vec2(T.oneMinus(uv.y), T.fract(uv.x.mul(4)));

    const s0 = T.texture(textures.textures[0], sampleUv);
    const s1 = T.texture(textures.textures[1], sampleUv);
    const s2 = T.texture(textures.textures[2], sampleUv);
    const s3 = T.texture(textures.textures[3], sampleUv);
    const rgba = T.select(
      face.equal(0),
      s0,
      T.select(face.equal(1), s1, T.select(face.equal(2), s2, s3))
    );
    const opacity = T.select(
      face.equal(0),
      uOpacity[0],
      T.select(face.equal(1), uOpacity[1], T.select(face.equal(2), uOpacity[2], uOpacity[3]))
    );

    // 焦点/悬停描边（原版用圆角矩形 SDF；这里保留同一条公式，平时 I=0 不显示）
    const s = uWidth.div(uHeight);
    const o = T.vec2(T.oneMinus(uv.y), T.fract(uv.x.mul(4)));
    const A = o.sub(T.vec2(0.5, T.float(0.5).add(0.08))).mul(T.vec2(s, 1));
    const c = T.vec2(s.mul(T.float(0.5).sub(0.1)), T.float(0.5).sub(0.1));
    const cInner = T.vec2(c.x.sub(0.007), c.y.sub(0.007));
    const sd = (p: any, half: any, radius: any) => {
      const q = T.abs(p).sub(half).add(radius);
      return T.min(T.max(q.x, q.y), 0).add(T.length(T.max(q, T.vec2(0)))).sub(radius);
    };
    const borderOuter = T.float(1).sub(T.smoothstep(0, 0.005, sd(A, c, 0.08)));
    const borderInner = T.smoothstep(0, 0.005, sd(A, cInner, T.max(0.073, 0.001)));
    const focusBorder = borderOuter.mul(borderInner).mul(uIsFocused);

    const alpha = rgba.a.mul(opacity);
    const boosted = alpha.mul(1).add(alpha.mul(uHover).mul(0.6));
    const finalAlpha = T.max(boosted, focusBorder);
    const color = T.mix(rgba.rgb, T.vec3(1), focusBorder);
    return T.vec4(color, finalAlpha);
  })();

  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  // 原始变换 [0.05, 0, π/2]：几何长轴是本地 Y，转到屏幕横向并带轻微俯仰
  mesh.rotation.set(0.05, 0, CYLINDER_ROT);

  const rot = new Array<number>(MAX_SEGMENTS).fill(0);
  const vel = new Array<number>(MAX_SEGMENTS).fill(0);
  const stiff = new Array<number>(MAX_SEGMENTS).fill(90);
  const damp = new Array<number>(MAX_SEGMENTS).fill(14);
  const opacityNow = [0, 0, 0, 0];
  const opacityTarget = [0, 0, 0, 0];
  let targetRot = 0;
  let currentIndex = initialIndex;
  let segmentCount = MAX_SEGMENTS;
  let faceAspect = 1;

  const applySlots = () => {
    const base = wrapIndex(currentIndex, 4);
    for (let k = 0; k < 4; k++) {
      const slot = wrapIndex(base - 1 + k, 4);
      const projectIndex = wrapIndex(currentIndex - 1 + k, SELECTED_PROJECTS.length);
      textures.setProject(slot, projectIndex);
    }
    for (let slot = 0; slot < 4; slot++) opacityTarget[slot] = slot === base ? 1 : 0;
  };

  const configureSprings = (direction: 1 | -1) => {
    // 线上 mj：桌面端 stiffness 30→120（正向），damping 13→7；反向镜像
    const n = Math.max(2, segmentCount);
    const kStart = direction === 1 ? 30 : 120;
    const kEnd = direction === 1 ? 120 : 30;
    const cStart = direction === 1 ? 13 : 7;
    const cEnd = direction === 1 ? 7 : 13;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      stiff[i] = kStart + (kEnd - kStart) * t;
      damp[i] = cStart + (cEnd - cStart) * t;
    }
  };

  const setSize = (width: number, height: number) => {
    const segments = Math.min(Math.max(1, Math.round(width / 40)), MAX_SEGMENTS);
    const textWidth =
      2 * Math.tan((65 * Math.PI) / 180 / 2) * 12.5 * (width / Math.max(1, height)) * Math.min(1400 / Math.max(1, width), 1);
    const textHeight = (0.6 * Math.min(width / 1000, 1) + 0.4) * 5;
    faceAspect = textWidth / textHeight;

    const next = buildPrismGeometry(textWidth, textHeight, segments);
    mesh.geometry.dispose();
    mesh.geometry = next.geometry;
    segmentCount = segments;
    uWidth.value = textWidth;
    uHeight.value = textHeight;
    uSegments.value = segments;
    // 面序号每段的角度：当前选择对应的目标角度
    targetRot = (-Math.PI / 2) * currentIndex;
    mesh.position.set(0, 4 - (1 - height / 1000), -3);
    textures.setSize(width, height, faceAspect);
  };

  const select = (index: number, immediate = false) => {
    if (index === currentIndex && !immediate) return;
    const direction: 1 | -1 = index >= currentIndex ? 1 : -1;
    currentIndex = index;
    targetRot = (-Math.PI / 2) * index;
    configureSprings(direction);
    applySlots();
    if (immediate) {
      for (let i = 0; i < MAX_SEGMENTS; i++) {
        rot[i] = targetRot;
        vel[i] = 0;
      }
      for (let slot = 0; slot < 4; slot++) opacityNow[slot] = opacityTarget[slot];
    }
  };

  const update = (dt: number, time: number) => {
    const dts = clamp(dt, 0.001, 0.05);
    uTime.value = time;
    for (let i = 0; i < segmentCount; i++) {
      vel[i] += (stiff[i] * (targetRot - rot[i]) - damp[i] * vel[i]) * dts;
      rot[i] += vel[i] * dts;
      uRot[i].value = rot[i];
      uEnterExit[i].value = 0;
    }
    const k = 1 - Math.exp(-8 * dts);
    for (let slot = 0; slot < 4; slot++) {
      opacityNow[slot] += (opacityTarget[slot] - opacityNow[slot]) * k;
      uOpacity[slot].value = opacityNow[slot];
    }
  };

  // 初始选中的角度（进入页面时棱柱已经摆好）
  targetRot = (-Math.PI / 2) * initialIndex;
  for (let i = 0; i < MAX_SEGMENTS; i++) rot[i] = targetRot;
  applySlots();
  for (let slot = 0; slot < 4; slot++) opacityNow[slot] = opacityTarget[slot];
  for (let slot = 0; slot < 4; slot++) uOpacity[slot].value = opacityNow[slot];
  for (let i = 0; i < MAX_SEGMENTS; i++) uRot[i].value = rot[i];
  uIsFocused.value = 0;
  uHover.value = 0;

  // 字体/箭头异步就绪后重绘标题
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    (document as any).fonts.ready.then(() => textures.redraw()).catch(() => {});
  }

  return {
    mesh,
    setSize,
    select,
    update,
    faceAspect: () => faceAspect,
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      textures.dispose();
    },
  };
}
