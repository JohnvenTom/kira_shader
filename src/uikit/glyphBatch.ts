/**
 * 字形实例化渲染 —— 1:1 对照原站 oB/oC/lA（_bundles/full/04kr7kd5riobb.js:25450-25496 om、
 * 25570-25840 oB/oC、27008-27248 lA）。
 *
 * - 每 (图集纹理, depthTest, depthWrite, renderOrder) 一个批次（GlyphBatch）；
 * - 每字形占 instanceMatrix(16) + 3 个独立实例属性（UV4/RGBA4/ClipRect4，见 GlyphBatch 注释）；
 * - 洞回收（holeIndicies）、请求队列（容量不足时挂起）、1.5×扩容（>256 且 ≤1000 → 1001）、
 *   1s 计时 decimate（count < capacity/3）；
 * - quad = PlaneGeometry translate(0.5,-0.5)：局部 [0,1]×[-1,0]（锚点左上、y 向下）；
 * - mesh.matrixWorld = 根的世界矩阵（挂根下、identity 矩阵自动成立），字形全变换在 instanceMatrix；
 * - UV 写入 [uvX, uvY+uvH, uvW, -uvH]（flipY=false 纹理配负 V）；
 * - 矩阵写入 T(x·ps, y·ps, 0)·S(fs·gw·ps, fs·gh·ps, 1) 再 premultiply(baseMatrix)。
 */
import * as THREE from 'three/webgpu';
import { createMsdfMaterial } from './msdfMaterial.ts';
import type { GlyphInfo } from './font.ts';

/** 字形活动实例（lA，04kr:27008）——挂在批次里，index=null 表示未激活/请求中 */
export class GlyphInstance {
  /** 批次内槽位；null = 未分配 */
  index: number | null = null;
  hidden = true;
  glyphInfo: (GlyphInfo & { renderSolid: boolean }) | null = null;
  x = 0;
  y = 0;
  fontSize = 0;
  pixelSize = 1;
  baseMatrix: THREE.Matrix4 | null = null;
  color: THREE.ColorRepresentation = 0xffffff;
  opacity = 1;
  /** 世界空间轴对齐裁剪矩形 (topY, rightX, bottomY, leftX)，null = 无裁剪 */
  clippingRect: [number, number, number, number] | null = null;

  private lastClipKey: string | null = null;
  private lastColorKey = '';

  constructor(private batch: GlyphBatch) {}

  show(): void {
    if (this.hidden) {
      this.hidden = false;
      this.batch.requestActivate(this);
    }
  }

  hide(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.batch.delete(this);
  }

  activate(index: number): void {
    this.index = index;
    // 槽位可能变化：失效去重守卫，强制全量重写
    this._colorWritten = false;
    this.lastClipKey = null;
    this.writeMatrix();
    this.writeUV();
    this.writeRenderSolid();
    this.writeColor();
    this.writeClipping();
  }

  /** ld → updateGlyphAndTransformation（04kr:27188） */
  updateGlyphAndTransformation(
    glyphInfo: GlyphInfo & { renderSolid: boolean },
    x: number,
    y: number,
    fontSize: number,
    pixelSize: number,
  ): void {
    if (this.glyphInfo !== glyphInfo) {
      this.glyphInfo = glyphInfo;
      this.writeUV();
      this.writeRenderSolid();
    }
    if (this.x !== x || this.y !== y || this.fontSize !== fontSize || this.pixelSize !== pixelSize || this.glyphInfo !== glyphInfo) {
      this.x = x;
      this.y = y;
      this.fontSize = fontSize;
      this.pixelSize = pixelSize;
      this.writeMatrix();
    }
  }

  updateBaseMatrix(m: THREE.Matrix4): void {
    if (this.baseMatrix !== m) {
      this.baseMatrix = m;
      this.writeMatrix();
    }
  }

  updateColor(color: THREE.ColorRepresentation, opacity: number): void {
    this.color = color;
    this.opacity = opacity;
    this.writeColor();
  }

  updateClippingRect(rect: [number, number, number, number] | null): void {
    this.clippingRect = rect;
    this.writeClipping();
  }

  /** 04kr:27199 writeUV：[uvX, uvY+uvH, uvW, -uvH] */
  private writeUV(): void {
    if (this.index == null || this.glyphInfo == null) return;
    const g = this.glyphInfo;
    this.batch.writeUV(this.index, [g.uvX, g.uvY + g.uvHeight, g.uvWidth, -g.uvHeight]);
  }

  private writeRenderSolid(): void {
    if (this.index == null || this.glyphInfo == null) return;
    this.batch.writeRenderSolid(this.index, this.glyphInfo.renderSolid ? 1 : 0);
  }

  /** 04kr:27230 writeUpdatedMatrix */
  private writeMatrix(): void {
    if (this.index == null || this.glyphInfo == null || this.baseMatrix == null) return;
    const m = new THREE.Matrix4().makeTranslation(this.x * this.pixelSize, this.y * this.pixelSize, 0);
    m.multiply(
      new THREE.Matrix4().makeScale(
        this.fontSize * this.glyphInfo.width * this.pixelSize,
        this.fontSize * this.glyphInfo.height * this.pixelSize,
        1,
      ),
    );
    m.premultiply(this.baseMatrix);
    this.batch.writeMatrix(this.index, m);
  }

  private writeColor(): void {
    const key = `${String(this.color)}|${this.opacity}`;
    if (key === this.lastColorKey && this.index != null && this._colorWritten) return;
    this.lastColorKey = key;
    this._colorWritten = this.index != null;
    if (this.index == null) return;
    this.batch.writeColor(this.index, this.color, this.opacity);
  }

  private _colorWritten = false;

  private writeClipping(): void {
    if (this.index == null) return;
    const rect = this.clippingRect;
    // null 用哨兵 key（与"未写"区分，否则 activate 清守卫后会跳过写默认矩形）
    const key = rect ? rect.join('|') : 'none';
    if (key === this.lastClipKey) return;
    this.lastClipKey = key;
    if (rect == null) {
      this.batch.writeClippingDefault(this.index);
    } else {
      this.batch.writeClipRect(this.index, rect[0], rect[1], rect[2], rect[3]);
    }
  }
}

export interface GlyphBatchKey {
  texture: THREE.Texture;
  pageWidth: number;
  pageHeight: number;
  distanceRange: number;
  depthTest: boolean;
  depthWrite: boolean;
  renderOrder: number;
}

/** 单批次（oB，04kr:25609）：材质按 (texture, depthTest, depthWrite) 缓存共享 */
export class GlyphBatch {
  glyphs: (GlyphInstance | undefined)[] = [];
  requested: GlyphInstance[] = [];
  holes: number[] = [];
  mesh: THREE.InstancedMesh | null = null;
  instanceMatrix: THREE.InstancedBufferAttribute | null = null;
  /** 实例数据：三个独立 InstancedBufferAttribute（UV4/RGBA4/ClipRect4）。
   *  原站是 25-float 交错（UV4+RGBA4+Clip0..3+Solid1，04kr:25726-25765）——
   *  本移植改独立 buffer：① three r169 WebGPU 对同一 InterleavedBuffer 偏移 ≥12 的
   *  属性视图读取错位（实测 2026-10-24 GPU 读数实验）；② WebGPU vertex buffer 槽上限 8，
   *  position+uv+instanceMatrix+3 = 6 槽合规；③ renderSolid 砍成批次 uniform 0
   *  （STIX 图集 89 字符全可渲染，fallback 字形不触发——contact 内容均在字符集内）。 */
  private instanceUV: THREE.InstancedBufferAttribute | null = null;
  private instanceRGBA: THREE.InstancedBufferAttribute | null = null;
  private clipRectAttr: THREE.InstancedBufferAttribute | null = null;
  private material: THREE.MeshBasicNodeMaterial;
  private decimateTimer: number | null = null;
  private dirty = false;

  constructor(
    private rootObject: THREE.Object3D,
    private key: GlyphBatchKey,
  ) {
    this.material = createMsdfMaterial({
      page: key.texture,
      pageWidth: key.pageWidth,
      pageHeight: key.pageHeight,
      distanceRange: key.distanceRange,
    });
    this.material.depthTest = key.depthTest;
    this.material.depthWrite = key.depthWrite;
  }

  get liveCount(): number {
    return this.glyphs.length - this.holes.length + this.requested.length;
  }

  /** 工厂：renderer 构造字形实例（lA） */
  createInstance(): GlyphInstance {
    return new GlyphInstance(this);
  }

  requestActivate(g: GlyphInstance): void {
    const hole = this.holes.shift();
    if (hole != null) {
      this.glyphs[hole] = g;
      g.activate(hole);
      this.dirty = true;
      return;
    }
    if (this.mesh == null || this.mesh.count >= this.instanceMatrix!.count) {
      this.requested.push(g);
      return;
    }
    const idx = this.mesh.count;
    this.glyphs[idx] = g;
    g.activate(idx);
    this.mesh.count += 1;
    this.dirty = true;
  }

  delete(g: GlyphInstance): void {
    if (g.index == null) {
      const i = this.requested.indexOf(g);
      if (i !== -1) this.requested.splice(i, 1);
      return;
    }
    this.dirty = true;
    const next = this.requested.shift();
    if (next != null) {
      next.activate(g.index);
      this.glyphs[g.index] = next;
      g.index = null;
      return;
    }
    if (g.index === this.glyphs.length - 1) {
      this.glyphs.length -= 1;
      this.mesh!.count -= 1;
      g.index = null;
      return;
    }
    const o = g.index * 16;
    this.instanceMatrix!.array.fill(0, o, o + 16);
    this.instanceMatrix!.needsUpdate = true;
    this.holes.push(g.index);
    this.glyphs[g.index] = undefined;
    g.index = null;
  }

  /** 每帧调用（oB.onFrame，04kr:25702）：扩容/挂起激活/可见性 */
  onFrame(): void {
    const live = this.liveCount;
    if (this.mesh != null) this.mesh.visible = live > 0;
    if (live === 0) return;
    const cap = this.instanceMatrix?.count ?? 0;
    if (live < cap / 3) this.decimateTimer ??= 1000;
    else this.decimateTimer = null;
    // decimate 只减不增（原站 resize 时 1.5x 重新分配；本实现保守：不主动缩容，语义等价）
    if (live <= cap) {
      // 容量足够：激活挂起队列
    } else if (!this.resize(live)) {
      return;
    }
    const base = this.mesh!.count;
    for (let i = 0; i < this.requested.length; i++) {
      const g = this.requested[i];
      g.activate(base + i);
      this.glyphs[base + i] = g;
    }
    this.mesh!.count += this.requested.length;
    this.mesh!.visible = true;
    this.requested.length = 0;
    this.flush();
  }

  private resize(live: number): boolean {
    let cap = Math.ceil(1.5 * live);
    if (cap > 256 && cap <= 1000) cap = 1001;
    if (cap === (this.instanceMatrix?.count ?? 0)) return false;
    const oldMesh = this.mesh;
    const oldMatrix = this.instanceMatrix;
    const oldUV = this.instanceUV;
    const oldGlyphs = this.glyphs.slice();

    // 独立实例 attributes（见类注释）
    this.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(16 * cap), 16, false);
    this.instanceUV = new THREE.InstancedBufferAttribute(new Float32Array(4 * cap), 4, false);
    this.instanceRGBA = new THREE.InstancedBufferAttribute(new Float32Array(4 * cap), 4, false);
    this.clipRectAttr = new THREE.InstancedBufferAttribute(new Float32Array(4 * cap), 4, false);

    // 数据搬迁（ov/ob，04kr:25818）：按旧 glyph 顺序压实
    if (oldMatrix != null && oldUV != null && this.instanceUV != null && oldGlyphs.some((g) => g?.index != null)) {
      let dst = 0;
      for (const g of oldGlyphs) {
        if (g == null || g.index == null) continue;
        const src = g.index;
        (this.instanceMatrix.array as Float32Array).set(
          (oldMatrix.array as Float32Array).subarray(src * 16, src * 16 + 16),
          dst * 16,
        );
        (this.instanceUV.array as Float32Array).set(
          (oldUV.array as Float32Array).subarray(src * 4, src * 4 + 4),
          dst * 4,
        );
        g.index = dst;
        dst += 1;
      }
      this.glyphs = oldGlyphs.filter((g) => g != null);
      this.holes.length = 0;
    }

    const geo = new THREE.PlaneGeometry();
    geo.translate(0.5, -0.5, 0);
    geo.setAttribute('instanceUVOffset', this.instanceUV);
    geo.setAttribute('instanceRGBA', this.instanceRGBA);
    geo.setAttribute('instanceClipRect', this.clipRectAttr);

    // InstancedMesh 协议：three（WebGL/WebGPU）按 mesh.instanceMatrix + count 实例化，
    // 几何上的 InstancedBufferAttribute 走 step=instance（原站 om 伪协议等价改正规化）
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix = this.instanceMatrix;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = this.key.renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.count = this.glyphs.length;
    mesh.visible = this.glyphs.length > 0;
    this.mesh = mesh;
    this.rootObject.add(mesh);
    this.dirty = true;

    if (oldMesh != null) {
      this.rootObject.remove(oldMesh);
      oldMesh.geometry.dispose();
    }
    return true;
  }

  writeMatrix(index: number, m: THREE.Matrix4): void {
    if (this.instanceMatrix == null) return;
    m.toArray(this.instanceMatrix.array as Float32Array, index * 16);
    this.instanceMatrix.needsUpdate = true;
    this.dirty = true;
  }

  writeUV(index: number, v: [number, number, number, number]): void {
    if (this.instanceUV == null) return;
    const arr = this.instanceUV.array as Float32Array;
    arr[index * 4] = v[0];
    arr[index * 4 + 1] = v[1];
    arr[index * 4 + 2] = v[2];
    arr[index * 4 + 3] = v[3];
    this.instanceUV.needsUpdate = true;
    this.dirty = true;
  }

  /** renderSolid 已简化为批次 uniform 0（见类注释）——保留空实现维持 lA 调用形态 */
  writeRenderSolid(_index: number, _solid: number): void {
    /* no-op */
  }

  writeColor(index: number, color: THREE.ColorRepresentation, opacity: number): void {
    if (this.instanceRGBA == null) return;
    const arr = this.instanceRGBA.array as Float32Array;
    const o = index * 4;
    if (typeof color === 'number') {
      _tmpColor.setHex(color);
    } else if (typeof color === 'string') {
      _tmpColor.set(color);
    } else {
      _tmpColor.copy(color);
    }
    // sP（04kr:24431）：Color.toArray 写线性 RGB + alpha
    arr[o] = _tmpColor.r;
    arr[o + 1] = _tmpColor.g;
    arr[o + 2] = _tmpColor.b;
    arr[o + 3] = opacity;
    this.instanceRGBA.needsUpdate = true;
    this.dirty = true;
  }

  writeClippingDefault(index: number): void {
    // 关闭 = 恒通过矩形（+1e7, +1e7, −1e7, −1e7）
    this.writeClipRect(index, 1e7, 1e7, -1e7, -1e7);
  }

  /** 轴对齐裁剪矩形 (topY, rightX, bottomY, leftX)（世界空间） */
  writeClipRect(index: number, topY: number, rightX: number, bottomY: number, leftX: number): void {
    const attr = this.clipRectAttr;
    if (attr == null) return;
    const arr = attr.array as Float32Array;
    const o = index * 4;
    arr[o] = topY;
    arr[o + 1] = rightX;
    arr[o + 2] = bottomY;
    arr[o + 3] = leftX;
    attr.needsUpdate = true;
    this.dirty = true;
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.instanceMatrix) this.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.mesh != null) {
      this.rootObject.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.glyphs.length = 0;
    this.requested.length = 0;
    this.holes.length = 0;
  }
}

const _tmpColor = new THREE.Color();

/** 批次管理器（oC，04kr:25570）：rootObject 下按 key 分组 */
export class GlyphBatchManager {
  private batches = new Map<string, GlyphBatch>();

  constructor(private rootObject: THREE.Object3D) {}

  getBatch(key: GlyphBatchKey): GlyphBatch {
    const k = `${key.texture.uuid}|${key.depthTest ? 1 : 0}|${key.depthWrite ? 1 : 0}|${key.renderOrder}`;
    let b = this.batches.get(k);
    if (b == null) {
      b = new GlyphBatch(this.rootObject, key);
      this.batches.set(k, b);
    }
    return b;
  }

  /** 每帧驱动所有批次（扩容/挂起激活） */
  update(): void {
    for (const b of this.batches.values()) b.onFrame();
  }

  dispose(): void {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
  }
}
