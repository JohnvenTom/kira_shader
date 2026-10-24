/**
 * MSDF 文字材质 —— 1:1 对照原站 oI（_bundles/full/04kr7kd5riobb.js:25516-25566）。
 * extends MeshBasicNodeMaterial；transparent / depthWrite false / toneMapped false。
 *
 * 管线：instanceUVOffset.xy + uv()*zw 采样图集 → median3 MSDF 距离 → (d-0.5)*distanceRange
 *   → screenPx = clamp(len(fwidth(uv*pagePx))*0.5, 0, distanceRange*0.5)
 *   → alpha = smoothstep(-screenPx, screenPx, dist)
 *   → opacity = renderSolid>0.5 ? 1 : pow(alpha, 1/1.3)
 *
 * 4 平面裁剪：原站用 4 个 vec4 attribute（instanceClipping0..3，世界平面方程）。
 * 本移植改为单 vec4 轴对齐矩形 instanceClipRect=(topY,rightX,bottomY,leftX)——
 * three r169 WebGPU 对同一 InterleavedBuffer 偏移 ≥12 的属性视图读取错位（实测 2026-10-24），
 * 且 WebGPU vertex buffer 槽上限 8；矩形展开成 4 平面距离后与原站 smoothstep 连乘在
 * 轴对齐情形数学等价（uikit 裁剪无旋转，contact 全轴对齐）。
 */
import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';

export interface MsdfMaterialOptions {
  /** MSDF 图集纹理（flipY=false） */
  page: THREE.Texture;
  /** 图集像素宽（BMFont common.scaleW） */
  pageWidth: number;
  /** 图集像素高（BMFont common.scaleH） */
  pageHeight: number;
  /** MSDF distanceRange（本站 4） */
  distanceRange: number;
}

export function createMsdfMaterial(opts: MsdfMaterialOptions): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });

  const uvOffset = T.attribute('instanceUVOffset', 'vec4');
  const rgba = T.attribute('instanceRGBA', 'vec4');
  const clipRect = T.attribute('instanceClipRect', 'vec4');
  const renderSolid = T.attribute('instanceRenderSolid', 'float');

  // 采样坐标（04kr:25534）：offset.xy + uv()*offset.zw
  const l = uvOffset.xy.add(T.uv().mul(uvOffset.zw));

  // 4 平面裁剪（等价 04kr:25535-25552 的 a8 轴对齐展开）
  // clipRect = (topY, rightX, bottomY, leftX)；关闭 = (+1e7,+1e7,-1e7,-1e7)
  const posWorld = T.positionWorld;
  const d0 = clipRect.x.sub(posWorld.y); // top:    -y + topY
  const d1 = clipRect.y.sub(posWorld.x); // right:  -x + rightX
  const d2 = posWorld.y.sub(clipRect.z); // bottom:  y - bottomY
  const d3 = posWorld.x.sub(clipRect.w); // left:    x - leftX
  const w0 = T.fwidth(d0).mul(0.5);
  const w1 = T.fwidth(d1).mul(0.5);
  const w2 = T.fwidth(d2).mul(0.5);
  const w3 = T.fwidth(d3).mul(0.5);
  const clip4 = T.smoothstep(w0.negate(), w0, d0)
    .mul(T.smoothstep(w1.negate(), w1, d1))
    .mul(T.smoothstep(w2.negate(), w2, d2))
    .mul(T.smoothstep(w3.negate(), w3, d3));

  // MSDF median3（04kr:25554-25557）：max(min(r,g), min(max(r,g), b))
  const msdf = T.texture(opts.page, l).rgb;
  const dist = T.max(T.min(msdf.r, msdf.g), T.min(T.max(msdf.r, msdf.g), msdf.b))
    .sub(0.5)
    .mul(opts.distanceRange);

  // 屏幕像素级筛选宽度（04kr:25558）：clamp(len(fwidth(uv*pagePx))*0.5, 0, dr/2)
  const pagePx = T.vec2(opts.pageWidth, opts.pageHeight);
  const screenPx = T.clamp(T.length(T.fwidth(l.mul(pagePx))).mul(0.5), 0, opts.distanceRange * 0.5);
  const alpha = T.smoothstep(screenPx.negate(), screenPx, dist);

  // 锐化 1.3（04kr:25561-25564）：renderSolid 直通
  const sharpened = T.select(renderSolid.greaterThan(0.5), T.float(1), T.pow(alpha, T.float(1).div(1.3)));

  mat.colorNode = rgba.xyz;
  mat.opacityNode = rgba.w.mul(clip4).mul(sharpened);
  mat.alphaTestNode = T.float(0.001);
  return mat;
}
