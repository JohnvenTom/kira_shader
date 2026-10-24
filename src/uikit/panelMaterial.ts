/**
 * uikit 面板材质 —— 1:1 对照原站 sV/sW（_bundles/full/04kr7kd5riobb.js:24596-24760）
 * 与 SDF 辅助 sN/sU/sO/sH（24443-24560）。本文件走 uniform 路径（单面板一材质，
 * 数据在 4 个 vec4 uniform + 4 个裁剪平面 uniform），渲染语义与 instanced 路径完全一致。
 *
 * 面板数据布局（16 floats，sL/sM 24347-24440 + 布局代码写 data0/data3.zw）：
 *   [0-3]  边框 insets [top,right,bottom,left] px（外圈盒与内缩盒之间的环=边框带）
 *   [4-7]  backgroundColor rgba（线性）
 *   [8]    圆角打包：4 角 base-50 数字 ×0.01，单位=高度百分比，序 [BL,BR,TR,TL]（sk 24416）
 *   [9-12] borderColor rgb + alpha（alpha 落在 data3.x）
 *   [13]   borderBend
 *   [14,15] 面板尺寸 px [width, height]（布局每帧写）
 *
 * 渲染语义：外圈圆角盒为边框域——环内（insets 盒之外）不透明度贡献边框 alpha、
 * 颜色向 borderColor 混合；insets 盒内为背景域（bgColor×bgOpacity）。
 * sM 无 borderWidth/padding/size setter——borderWidth 只进 yoga（撑内缩量），
 * 边框视觉粗细=data0 insets，视觉透明度=borderColor 的 alpha（data3.x）。
 */
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';

/** sN（04kr:24443）：min(xy, zw) 再取 min 分量 */
const sN = /*@__PURE__*/ T.Fn(([e]: [any]) => {
  const t = T.min(e.xy, e.zw);
  return T.min(t.x, t.y);
});

/** sU（04kr:24451）：max(xy, zw) 再取 max 分量（withNormal 路径使用；保留避免漂移） */
const sU = /*@__PURE__*/ T.Fn(([e]: [any]) => {
  const t = T.max(e.xy, e.zw);
  return T.max(t.x, t.y);
});
void sU;

/** sO（04kr:24458）：角落圆弧 SDF → vec2(面内距离, 角弧距离) */
const sO = /*@__PURE__*/ T.Fn(([e, t, r, i]: [any, any, any, any]) => {
  const n = T.vec2(e, e);
  const a = n.sub(i);
  const s = T.abs(a.sub(r));
  const o = s.x.add(s.y);
  const l = T.select(o.greaterThan(0), s.div(o), T.vec2(0.5, 0.5));
  const u = e.sub(t.sub(n).length());
  const A = T.dot(l, a).sub(r.sub(a).length());
  return T.vec2(u, A);
});

/** sH（04kr:24479）：圆角盒双 SDF → vec2(外圈距离, 内缩圈距离)，uv 空间，radius 单位=高度分数 */
const sH = /*@__PURE__*/ T.Fn(([e, t, r, i]: [any, any, any, any]) => {
  const n = T.vec2(e.x, T.float(1).sub(e.y));
  const a = T.vec4(n.y, T.float(1).sub(n.x).mul(t), T.float(1).sub(n.y), n.x.mul(t));
  const s = a.sub(r);
  const o = T.vec2(sN(a), sN(s)).toVar('distanceResult');
  const corner0 = a.w.lessThan(i.x).and(a.x.lessThan(i.x));
  T.If(corner0, () => {
    o.assign(sO(i.x, T.vec2(a.w, a.x), T.vec2(s.w, s.x), T.vec2(r.w, r.x)));
  });
  const corner1 = a.y.lessThan(i.y).and(a.x.lessThan(i.y));
  T.If(corner0.not().and(corner1), () => {
    o.assign(sO(i.y, T.vec2(a.y, a.x), T.vec2(s.y, s.x), T.vec2(r.y, r.x)));
  });
  const corner2 = a.y.lessThan(i.z).and(a.z.lessThan(i.z));
  T.If(corner0.not().and(corner1.not()).and(corner2), () => {
    o.assign(sO(i.z, T.vec2(a.y, a.z), T.vec2(s.y, s.z), T.vec2(r.z, r.z)));
  });
  const corner3 = a.z.lessThan(i.w).and(a.w.lessThan(i.w));
  T.If(corner0.not().and(corner1.not()).and(corner2.not()).and(corner3), () => {
    o.assign(sO(i.w, T.vec2(a.z, a.w), T.vec2(s.z, s.w), T.vec2(r.w, r.w)));
  });
  return o;
});

/** 默认关闭的裁剪平面（04kr:24647）：dot(pos,(-1,0,0))+1e7 恒正 */
const DISABLED_PLANE = new THREE.Vector4(-1, 0, 0, 1e7);

export interface PanelMaterialUniforms {
  data0: THREE.Vector4;
  data1: THREE.Vector4;
  data2: THREE.Vector4;
  data3: THREE.Vector4;
  clip: THREE.Vector4[];
  /** TSL TextureNode（运行时换 .value 切换贴图，04kr:24708 panelMapNode 同款） */
  mapTexture: { value: THREE.Texture };
  mapEnabled: { value: number };
}

export interface PanelMaterialResult {
  material: THREE.MeshBasicNodeMaterial;
  uniforms: PanelMaterialUniforms;
}

/**
 * sW（04kr:24685）：面板 MeshBasicNodeMaterial。
 * withMap：材质支持背景贴图（dashed_frame.svg 等），由 mapTexture uniform 控制。
 */
export function createPanelMaterial(_opts?: { withMap?: boolean }): PanelMaterialResult {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.side = THREE.FrontSide;
  mat.clipShadows = true;
  mat.transparent = true;
  mat.toneMapped = false;
  mat.shadowSide = THREE.FrontSide;

  // ---- uniform 数据（sV 非实例化路径，04kr:24632-24660） ----
  const data0 = T.uniform(new THREE.Vector4());
  const data1 = T.uniform(new THREE.Vector4());
  const data2 = T.uniform(new THREE.Vector4());
  const data3 = T.uniform(new THREE.Vector4());
  const clipUniforms = [
    T.uniform(DISABLED_PLANE.clone()),
    T.uniform(DISABLED_PLANE.clone()),
    T.uniform(DISABLED_PLANE.clone()),
    T.uniform(DISABLED_PLANE.clone()),
  ];

  const posWorld = T.positionWorld;
  const cd = [
    T.dot(posWorld, clipUniforms[0].xyz).add(clipUniforms[0].w),
    T.dot(posWorld, clipUniforms[1].xyz).add(clipUniforms[1].w),
    T.dot(posWorld, clipUniforms[2].xyz).add(clipUniforms[2].w),
    T.dot(posWorld, clipUniforms[3].xyz).add(clipUniforms[3].w),
  ];
  const clipChain = cd.map((d) => {
    const w = T.fwidth(d).mul(0.5);
    return T.smoothstep(w.negate(), w, d);
  });
  let clipOpacity: any = clipChain[0];
  for (let i = 1; i < clipChain.length; i++) clipOpacity = clipOpacity.mul(clipChain[i]);

  // ---- 颜色/不透明度（04kr:24695-24760） ----
  // mapColor/mapOpacity（withMap）：mapEnabled=0 时直通白/1
  // 贴图走 TSL TextureNode（.value 运行时切换，原站 panelMapNode 同款）
  const mapTexNode = T.texture(makeWhiteTexture());
  const mapEnabled = T.uniform(0);
  const mapColor = T.mix(T.vec3(1, 1, 1), mapTexNode.rgb, mapEnabled);
  const mapOpacity = T.mix(T.float(1), mapTexNode.a, mapEnabled);

  const I = mapColor; // 背景×贴图色（此处 color 属性恒白，合并进 mapColor）
  const y = mapOpacity; // 贴图不透明度

  const C = data2; // x=radius 包, yzw=borderColor
  const radiusPacked = C.x;
  const B = T.vec4(
    T.mod(T.floor(radiusPacked.div(125000)), 50),
    T.mod(T.floor(radiusPacked.div(2500)), 50),
    T.mod(T.floor(radiusPacked.div(50)), 50),
    T.mod(T.floor(radiusPacked), 50),
  ).mul(0.01);
  const bgColor = data1.xyz;
  const bgOpacity = data1.w;
  const borderColor = C.yzw;
  const borderAlpha = data3.x; // borderColor rgba 第 4 分量（sP 写 t+12）
  const borderBend = data3.y; // withNormal 路径专用；本材质保留 uniform 不消费
  const sizeWH = data3.zw;
  const aspect = sizeWH.x.div(sizeWH.y);
  const insetNorm = data0.div(T.vec4(sizeWH.y, sizeWH.y, sizeWH.y, sizeWH.y));

  const D = sH(T.uv(), aspect, insetNorm, B);
  const L = T.fwidth(D);
  const M = T.smoothstep(L.x.negate(), L.x, D.x); // 外圈覆盖
  const k = T.smoothstep(L.y.negate(), L.y, D.y); // 内缩圈覆盖
  const F = T.float(1).sub(T.step(0.1, M.sub(k)).mul(T.float(1).sub(k)));

  const _ = y.mul(bgOpacity); // 背景不透明度 = mapOpacity * bgOpacity
  const P = T.min(T.float(1), borderAlpha.add(_));
  const opacityNode = clipOpacity.mul(M).mul(T.mix(P, _, F));

  const U = I.mul(bgColor); // 背景色
  const O = borderAlpha.div(T.max(P, T.float(0.001)));
  const colorNode = T.mix(T.mix(U, borderColor, O), U, F);

  mat.colorNode = colorNode;
  mat.opacityNode = opacityNode;
  mat.alphaTestNode = T.float(0.01);
  void borderBend;

  return {
    material: mat,
    uniforms: {
      data0: data0.value,
      data1: data1.value,
      data2: data2.value,
      data3: data3.value,
      clip: clipUniforms.map((u) => u.value),
      mapTexture: mapTexNode,
      mapEnabled,
    },
  };
}

/** 1×1 白色兜底贴图（sQ，04kr:24327） */
export function makeWhiteTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

// ---- CPU 侧数据打包（sP/sk 语义） ----

const _tmpColor = new THREE.Color();
const RGBA_RE = /rgba\((\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\)/;

/** sP（04kr:24431）：写颜色 [r,g,b,a×opacity]，'transparent' → 全 0 */
export function packColor(arr: Float32Array, offset: number, color: THREE.ColorRepresentation | 'transparent', opacity: number): void {
  if (color === 'transparent') {
    arr.fill(0, offset, offset + 4);
    return;
  }
  if (typeof color === 'string') {
    const m = color.match(RGBA_RE);
    if (m) {
      for (let i = 0; i < 3; i++) arr[offset + i] = parseFloat(m[i + 1]) / 255;
      arr[offset + 3] = parseFloat(m[4]) * opacity;
      return;
    }
  }
  if (typeof color === 'number') _tmpColor.setHex(color);
  else _tmpColor.set(color as string);
  // Color.set 把 sRGB 十六进制转 linear（three 默认 ColorManagement）——原站 ev.Color.set 同语义
  arr[offset] = _tmpColor.r;
  arr[offset + 1] = _tmpColor.g;
  arr[offset + 2] = _tmpColor.b;
  arr[offset + 3] = opacity;
}

/** sk（04kr:24416）：圆角按 base-50 数字打包进 radius float；radiusPx/heightPx×100 → 0..49 */
export function packRadiusDigit(arr: Float32Array, offset: number, digitIndex: number, radiusPx: number, heightPx: number): void {
  const digit = heightPx === 0 ? 0 : Math.min(49, Math.max(0, Math.ceil((radiusPx / heightPx) * 100)));
  const scale = 50 ** digitIndex;
  const cur = arr[offset];
  const oldDigit = Math.floor(cur / scale) % 50;
  arr[offset] = cur + (digit - oldDigit) * scale;
}
