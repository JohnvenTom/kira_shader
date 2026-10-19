/**
 * 24 片百叶标题幕（原件 `pp` 组件，逐项照抄）
 *
 * 反编译依据：shader.se 生产包 `04kr7kd5riobb.js` 的 `pp`（1,135,489 起）。原件实现：
 *  - 片数 `segments = min(round(viewportWidth / 20), 24)`
 *  - 壳尺寸 `s = 2·tan(fov/2)·cameraDistance·(1/(1+tan(fov/2)))`，幕布横向跨度 `o = s·viewportAspect`
 *  - 几何 `BoxGeometry(s, o, s, 12, segments, 12)`：索引只保留 `|normal.y| < 0.9` 的四个侧面，
 *    并把 UV 重映射成四段（+Z→0 / +X→0.25 / −Z→0.5 / −X→0.75），只有 +Z 面贴标题纹理
 *  - 顶点位移里按局部 Y 求出所在片号，用该片的旋转角把横截面 (x,z) 绕局部 Y 轴旋转
 *    （网格整体再绕 Z 转 90°，于是"绕局部 Y"表现为绕屏幕水平轴翻页 → 百叶）
 *  - 每片一个 spring 从 ±π/2 转到 0：stiffness 由 130→100（宽屏 96→54）按片号线性递减，
 *    damping 由 14→18（宽屏 13.5→18）线性递增；整幕不透明度 tween（show 0.5s / hide 0.2s）
 *  - 单片不透明度 `pow(1 − smoothstep(0,1, angle/(−π/2)), 2)`：转到 0° 才完全显形
 *  - 逐片呼吸 `sin(i·10 + t·4)·0.007`（横向）与 `sin(i·8 + t·3)·0.005`（纵向）
 *  - 网格 `position [0,0,−2]`、`rotation [0,0,π/2]`、`renderOrder 9999`、
 *    材质 `toneMapped=false / depthTest=false / FrontSide / transparent`
 *
 * 注意事项（与原件的已知等价改写，不是偏离）：
 *  - 原件把单片不透明度写成 **varying**（顶点阶段算、片元阶段插值）。这里改为在片元阶段
 *    用插值后的 `positionLocal` 重算同一表达式 —— 因为该式只依赖 positionLocal 的线性插值，
 *    两种写法结果一致，同时省掉一条 varying。
 *  - 原件按 framer-motion 的 spring 积分；这里用等价数值弹簧（1/120s 子步长，够稳）。
 */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { HERO_CAMERA, HERO_SLATS } from './heroConfig';

/** TSL 命名空间置 any（同 heroCompose / HeroOneToOne 的取舍：只用于构建节点图） */
const N = TSL as any;

/**
 * 百叶标题幕：主标题文案（**要换成你自己的文案就改这里**）
 *
 * 注意：原件的标题是**自动折行**的（DOM 里 `maxWidth: 0.6W` 触发 CSS 换行），
 * 所以这里给的是会折成多行的长句占位 —— 文案越长越靠左、折行越多，与原件一致。
 */
export const HERO_SLAT_TITLE = 'KIRA SHADER REAL TIME RENDERING LAB';
/** 百叶标题幕：副标题文案（同上，改这里） */
export const HERO_SLAT_SUBTITLE = 'PERSONAL RENDER LAB';

/** 标题纹理宽度（像素）：原件 `pg` 的渲染目标就是**视口尺寸**，这里取一个等宽高比的虚拟视口 */
const TITLE_TEX_WIDTH = 2048;

/**
 * 标题版面常量
 *
 * 反编译依据：原件 `pg` 把 DOM 文本渲进一张**视口尺寸**的 RT（`nv(L.width*dpr, L.height*dpr)`），
 * 桌面分支（≥1024）的 DOM 数值是：
 *  容器 `padding 24` / `alignItems center` / `justifyContent flex-start`；
 *  标题块 `maxWidth 0.6W` / `marginLeft 0.03W` / `marginTop 100` / `height 50%`（内容块内垂直居中）；
 *  主标题 `fontSize 0.075W` / `lineHeight 字号+10px` / `textAlign left`；副标题行 `row` + `flex-start` + `gap 20`。
 *
 * **为什么这里不直接用原件那组数值**：原件那张视口尺寸的版面会被压进幕布（幕布只占视口的约 68%），
 * 屏上实际几何受"幕布占比 × 版面比例"两层影响；而本页的幕布取样目前是 1:1 落到画面的
 * （回读离屏 RT 实测：版面的 0.23 落在画面 0.23 处），所以直接把原件数值搬过来会偏大偏右。
 * 因此下面这组按**用户视觉参照 + 本页实际几何**标定：
 *  - 电脑机身（含边框）占画面 x ≈ 0.42~0.79，所以文字块必须收在左半区（右缘 ≤ ~0.46）；
 *  - 字号按观感调小（用户反馈原件那档在宽屏上偏大）。
 * 数值都集中在下面，随时可微调。
 */
const TITLE_LAYOUT = {
  /** 容器内边距（CSS px，原件 `padding: 24`） */
  padCss: 24,
  /** 标题块上边距（CSS px，原件 `marginTop: 100`） */
  leadCss: 100,
  /** 标题块总高占画布高的比例（原件 `height: '50%'`，内容在其中垂直居中） */
  blockHeightRatio: 0.5,
  /** 标题文字左缘占画布宽的比例（原件 0.23W；本页收到左半区，见上方说明） */
  textLeftRatio: 0.1,
  /** 文字可用宽度占画布宽的比例（右缘 = 左缘 + 本值 ≤ 0.46，保证不压到右侧电脑） */
  textWidthRatio: 0.36,
  /** 主标题字号占画布宽的比例（原件 0.075；本页按宽屏观感调小） */
  titleSizeRatio: 0.05,
  /** 主标题行高额外量（CSS px，原件 `lineHeight: 字号 + 10 + 'px'`） */
  titleLineExtraCss: 10,
  /** 副标题字号占画布宽的比例（原件取自 `ph` 样式表，未取证；按小字观感取值，可调） */
  subtitleSizeRatio: 0.014,
  /** 主/副标题间距（CSS px，原件副标题行 `gap: 20`） */
  gapCss: 20,
} as const;

/** 单片的弹簧状态（位置=角度，速度=角速度） */
interface SlatSpring {
  x: number;
  v: number;
}

/**
 * 文本按宽度折行（原件是 DOM 的 CSS 自动折行，这里等价实现：按空格贪心装行）
 *
 * 功能：把字符串按最大宽度折成若干行，供 canvas 逐行绘制
 *
 * 参数：
 *  - ctx  {CanvasRenderingContext2D} 已设好字体的上下文
 *  - text {string} 待排文本
 *  - maxW {number} 单行最大宽度（画布像素）
 *
 * 返回值：string[] 折行结果
 *
 * 异常：无
 *
 * 注意事项：调用前必须先把 ctx.font 设为目标字体，否则测量宽度不准
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/**
 * 生成标题纹理（画成 canvas 再包成贴图）
 *
 * 功能：按原件 `pg` 的 DOM 版面（见 TITLE_LAYOUT 注释）把主/副标题画进一张**视口宽高比**的
 *      canvas，作为百叶幕的标题贴图
 *
 * 参数：
 *  - aspect {number} 视口宽高比（幕布与纹理都按此比例）
 *
 * 返回值：THREE.CanvasTexture 标题贴图
 *
 * 异常：无（取不到 2d 上下文时返回空白贴图）
 *
 * 注意事项：
 *  - 贴图 `flipY = false`：幕布的取样坐标是 `(1 − uv.y, 1 − fract(uv.x×4))`，配合这个约定画布才正立
 *  - 文案改 `HERO_SLAT_TITLE` / `HERO_SLAT_SUBTITLE`；版面比例改 `TITLE_LAYOUT`
 *  - 原件那套 px 数值（padding 24 / marginTop 100 / 行高 +10）是 CSS px，
 *    这里按 `画布宽 / 真实视口宽` 折算成画布像素，缩放后版面比例才不走样
 */
function createTitleTexture(aspect: number): THREE.CanvasTexture {
  const W = TITLE_TEX_WIDTH;
  const H = Math.max(1, Math.round(W / aspect));
  const cssToCanvas = W / Math.max(1, window.innerWidth);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const left = TITLE_LAYOUT.textLeftRatio * W;
    const maxW = TITLE_LAYOUT.textWidthRatio * W;
    const titleSize = TITLE_LAYOUT.titleSizeRatio * W;
    const lineH = titleSize + TITLE_LAYOUT.titleLineExtraCss * cssToCanvas;
    const subSize = TITLE_LAYOUT.subtitleSizeRatio * W;
    const gap = TITLE_LAYOUT.gapCss * cssToCanvas;

    const titleFont = `700 ${Math.round(titleSize)}px "Arial Black", Impact, system-ui, sans-serif`;
    const subFont = `400 ${Math.round(subSize)}px ui-monospace, Consolas, monospace`;

    // 折行
    ctx.font = titleFont;
    const titleLines = wrapText(ctx, HERO_SLAT_TITLE, maxW);
    ctx.font = subFont;
    const subLines = wrapText(ctx, HERO_SLAT_SUBTITLE, maxW);

    // 垂直位置：标题块自 (padding + marginTop) 起、高为画布高的一半，内容在块内垂直居中（原件版式）
    const blockTop = (TITLE_LAYOUT.padCss + TITLE_LAYOUT.leadCss) * cssToCanvas;
    const blockH = H * TITLE_LAYOUT.blockHeightRatio;
    const totalH = titleLines.length * lineH + gap + subLines.length * subSize;
    const titleTop = blockTop + (blockH - totalH) / 2;

    ctx.font = titleFont;
    titleLines.forEach((line, i) => ctx.fillText(line, left, titleTop + i * lineH));
    ctx.font = subFont;
    const subTop = titleTop + titleLines.length * lineH + gap;
    subLines.forEach((line, i) => ctx.fillText(line, left, subTop + i * subSize));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 生成百叶幕几何（原件同款索引重排 + UV 重映射）
 *
 * 功能：造 `BoxGeometry(shell, span, shell, 12, segments, 12)`，剔除上下底面、保留四个侧面，
 *      并把四个侧面在 UV 上重排成四段（+Z→0 / +X→0.25 / −Z→0.5 / −X→0.75）
 *
 * 参数：
 *  - shell    {number} 壳尺寸 s（横截面边长，绕轴旋转的就是它）
 *  - span     {number} 幕布跨度 o（盒体 Y 向长度，网格绕 Z 转 90° 后即屏幕横向跨度）
 *  - segments {number} 片数
 *
 * 返回值：THREE.BufferGeometry
 *
 * 异常：无（几何缺少 index/normal/uv 时原样返回）
 *
 * 注意事项：被剔除的上/下底面顶点仍然保留（与原件一致），只是不再进入索引
 */
function createSlatGeometry(shell: number, span: number, segments: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(shell, span, shell, 12, segments, 12);
  const position = geo.attributes.position;
  const normal = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const index = geo.index;
  if (index && position && normal && uv) {
    // ① 只保留 |normal.y| < 0.9 的面（四个侧面，剔除上下底面）
    const src = index.array as ArrayLike<number>;
    const kept: number[] = [];
    for (let i = 0; i + 2 < src.length; i += 3) {
      const a = src[i], b = src[i + 1], c = src[i + 2];
      if (Math.abs(normal.getY(a)) < 0.9 && Math.abs(normal.getY(b)) < 0.9 && Math.abs(normal.getY(c)) < 0.9) {
        kept.push(a, b, c);
      }
    }
    geo.setIndex(kept);

    // ② UV 重映射：四个侧面各占 uv.x 的 1/4
    for (let i = 0; i < position.count; i++) {
      const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
      if (Math.abs(ny) > 0.9) continue;
      let off = 0;
      if (nz > 0.5) off = 0;
      else if (nx > 0.5) off = 0.25;
      else if (nz < -0.5) off = 0.5;
      else if (nx < -0.5) off = 0.75;
      uv.setX(i, 0.25 * uv.getX(i) + off);
    }
    uv.needsUpdate = true;
  }
  return geo;
}

/**
 * 创建 24 片百叶标题幕
 *
 * 功能：按原件 `pp` 的几何/材质/弹簧配方造出百叶幕网格，并给出每帧驱动入口
 *
 * 参数：无（视口尺寸与相机参数从 window / HERO_CAMERA 取，与原件的取值口径一致）
 *
 * 返回值：{ mesh, update, dispose }
 *  - mesh   {THREE.Mesh}       百叶幕网格（调用方负责加进场景）
 *  - update {(dt, time, show) => void} 每帧推进弹簧并写 uniforms
 *  - dispose {() => void}      释放几何 / 材质 / 标题贴图
 *
 * 异常：无
 *
 * 注意事项：
 *  - `show` 为 true 时每片弹簧目标角 0（显形），false 时为 ∓π/2（侧立消失）；
 *    宽屏（宽度 > 1024）取 −π/2，窄屏取 +π/2 —— 原件在同一处用同一个分支，注意别搞反
 *  - 只有前 `segments` 片参与弹簧动画，其余片立即置为目标角（原件同款）
 */
export function createHeroSlats() {
  const viewportWidth = window.innerWidth;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);

  // 片数：原件 `Math.min(Math.round(width / 20), 24)`
  const segments = Math.min(Math.max(1, Math.round(viewportWidth / 20)), HERO_SLATS.segments);

  // 壳尺寸与跨度：原件 `s = 2·tan(fov/2)·d·(1/(1+tan(fov/2)))`、`o = s·aspect`
  const halfFov = (HERO_CAMERA.fov * Math.PI) / 180 / 2;
  const tanHalf = Math.tan(halfFov);
  const shell = 2 * tanHalf * HERO_SLATS.cameraDistance * (1 / (1 + tanHalf));
  const span = shell * aspect;

  const textTexture = createTitleTexture(aspect);
  const geometry = createSlatGeometry(shell, span, segments);

  // ---- uniforms（tTexture 直接引用真贴图；TSL 的 texture() 第一参必须是真 Texture）----
  const uTime = N.uniform(0);
  const uOpacity = N.uniform(0);
  const uSegments = N.uniform(segments);
  const uWidth = N.uniform(span);
  const uRotations: any[] = Array.from({ length: HERO_SLATS.segments }, () => N.uniform(0));

  /**
   * 标题取样坐标：原件 `d = vec2(1 − uv.y, 1 − fract(uv.x × 4))`
   *
   * 注意：这里的 `fract(uv.x × 4)` **不能省**。UV 重映射把四个侧面排成 uv.x 的四段，
   *  +Z 面的 uv.x 因此只剩 [0, 0.25]；直接用它当 v 会把取样挤到画布底部四分之一，
   *  标题就整块不见了（原件用 fract 把它还原成该面自身的 0~1）。
   */
  const sampleUv = N.vec2(N.oneMinus(N.uv().y), N.oneMinus(N.fract(N.uv().x.mul(4))));
  const texNode = N.texture(textTexture, sampleUv);

  /**
   * 由局部坐标求该处所属片号与插值角度（原件 positionNode 里 `d = mix(rot[seg], rot[seg+1], fract)`）
   *
   * 参数：
   *  - posLocal {any} TSL 节点：局部坐标（顶点阶段用 positionLocal 属性）
   *
   * 返回值：{ angle, i } —— angle 为该处的插值旋转角；i 为归一化片号（同时用于呼吸项）
   *
   * 异常：无
   *
   * 注意事项：片数最多 24，所以片号选择用 24 次 `select` 展开（原件同款，避免动态索引 uniform 数组）
   */
  const angleAt = (posLocal: any) => {
    const i = N.oneMinus(posLocal.y.add(uWidth.mul(0.5)).div(uWidth));
    const n = i.mul(uSegments);
    const last = uSegments.sub(1);
    const segIdx = N.clamp(N.floor(n), 0, last);
    const nextIdx = N.clamp(segIdx.add(1), 0, last);
    const frac = N.fract(n);
    const w = N.smoothstep(0, 1, frac);
    let a: any = N.float(0);
    let b: any = N.float(0);
    for (let k = 0; k < HERO_SLATS.segments; k++) {
      a = N.select(segIdx.equal(k), uRotations[k], a);
      b = N.select(nextIdx.equal(k), uRotations[k], b);
    }
    return { angle: N.mix(a, b, w), i };
  };

  /** 单片显形度：原件 `pow(1 − clamp(smoothstep(0,1, angle/(−π/2)), 0, 1), 2)` */
  const faceOpacityAt = (posLocal: any) => {
    const { angle } = angleAt(posLocal);
    const e = N.clamp(N.smoothstep(0, 1, angle.div(-Math.PI / 2)), 0, 1);
    return N.pow(N.oneMinus(e), 2);
  };

  const material = new THREE.MeshBasicNodeMaterial();
  material.toneMapped = false;
  material.depthTest = false;
  material.side = THREE.FrontSide;
  material.transparent = true;

  // 顶点位移：按片号绕局部 Y 轴旋转横截面 + 逐片呼吸（原件逐项照抄）
  (material as unknown as { positionNode: unknown }).positionNode = N.Fn(() => {
    const p = N.positionLocal;
    const { angle, i } = angleAt(p);
    const cosA = N.cos(angle);
    const sinA = N.sin(angle);
    const xr = p.x.mul(cosA).add(p.z.mul(sinA));
    const zr = p.x.mul(sinA).negate().add(p.z.mul(cosA));
    const wobX = N.sin(i.mul(10).add(uTime.mul(4))).mul(HERO_SLATS.wobbleX);
    const wobY = N.sin(i.mul(8).add(uTime.mul(3))).mul(HERO_SLATS.wobbleY);
    return N.vec3(xr, p.y.add(wobY), zr.add(wobX));
  })();

  // 颜色：只有 +Z 面（UV 段索引 0）贴标题，其余面透明；单片显形度 × 整幕不透明度
  (material as unknown as { colorNode: unknown }).colorNode = N.Fn(() => {
    const sideIdx = N.clamp(N.floor(N.uv().x.mul(4)), 0, 3);
    const texel = texNode.mul(1);
    const a = N.mix(N.vec4(0, 0, 0, 0), texel, sideIdx.equal(0).toFloat());
    const alpha = a.a.mul(faceOpacityAt(N.positionLocal)).mul(uOpacity);
    return N.vec4(a.rgb, alpha);
  })();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0, -2);
  mesh.rotation.z = Math.PI / 2;
  mesh.renderOrder = 9999;
  mesh.frustumCulled = false;

  // ---- 弹簧状态 ----
  const springs: SlatSpring[] = Array.from({ length: HERO_SLATS.segments }, () => ({ x: -Math.PI / 2, v: 0 }));
  const target: number[] = new Array(HERO_SLATS.segments).fill(-Math.PI / 2);
  const stiff: number[] = new Array(HERO_SLATS.segments).fill(HERO_SLATS.springStiffnessTo);
  const damp: number[] = new Array(HERO_SLATS.segments).fill(HERO_SLATS.springDampingTo);
  let lastShow = false;
  let opacity = 0;
  const tween = { from: 0, to: 0, t: 0, dur: 0.2, active: false };

  /**
   * 按 show 状态给每片分派弹簧目标与参数（原件在 show 翻转时重建动画）
   *
   * 参数：
   *  - show {boolean} 是否显形
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：宽屏（>1024）走 96→54 / 13.5→18，窄屏走 130→100 / 14→18 —— 原件在这里的分支
   *          容易被读反（值本身没问题，标签容易写错），此处按代码实际分支实现
   */
  const applyShow = (show: boolean) => {
    const wide = window.innerWidth > 1024;
    const stiffFrom = wide ? HERO_SLATS.springStiffnessFromWide : HERO_SLATS.springStiffnessFrom;
    const stiffTo = wide ? HERO_SLATS.springStiffnessToWide : HERO_SLATS.springStiffnessTo;
    const dampFrom = wide ? HERO_SLATS.springDampingFromWide : HERO_SLATS.springDampingFrom;
    const dampTo = wide ? HERO_SLATS.springDampingToWide : HERO_SLATS.springDampingTo;
    const goal = show ? HERO_SLATS.showAngle : wide ? HERO_SLATS.hideAngleWide : HERO_SLATS.hideAngleNarrow;
    const denom = Math.max(1, segments - 1);
    for (let i = 0; i < HERO_SLATS.segments; i++) {
      if (i < segments) {
        const r = i / denom;
        target[i] = goal;
        stiff[i] = stiffFrom - r * (stiffFrom - stiffTo);
        damp[i] = dampFrom + r * (dampTo - dampFrom);
      } else {
        // 超出的片不参与动画，直接落到目标角（原件同款）
        target[i] = goal;
        springs[i].x = goal;
        springs[i].v = 0;
      }
    }
    tween.from = opacity;
    tween.to = show ? 1 : 0;
    tween.t = 0;
    tween.dur = show ? 0.5 : 0.2;
    tween.active = true;
  };

  /**
   * 每帧驱动：推进弹簧与整幕不透明度，并写入 uniforms
   *
   * 参数：
   *  - dt   {number}  帧间隔（秒）
   *  - time {number}  场景时间（秒，驱动呼吸）
   *  - show {boolean} 当前是否显示标题（本页取相机进度 s ≤ 0.1）
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：弹簧用 1/120s 子步长积分，`stiffness` 最高 130 也不会发散
   */
  const update = (dt: number, time: number, show: boolean) => {
    if (show !== lastShow) {
      lastShow = show;
      applyShow(show);
    }

    // 弹簧积分（子步长防发散）
    const dtc = Math.min(Math.max(dt, 0), 0.05);
    const steps = Math.max(1, Math.ceil(dtc / (1 / 120)));
    const h = dtc / steps;
    for (let i = 0; i < segments; i++) {
      const s = springs[i];
      for (let k = 0; k < steps; k++) {
        const acc = -stiff[i] * (s.x - target[i]) - damp[i] * s.v;
        s.v += acc * h;
        s.x += s.v * h;
      }
    }

    // 整幕不透明度 tween（原件：show 0.5s / hide 0.2s，easeInOut）
    if (tween.active) {
      tween.t += dtc;
      const k = Math.min(1, tween.t / tween.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      opacity = tween.from + (tween.to - tween.from) * e;
      if (k >= 1) tween.active = false;
    }

    uTime.value = time;
    uOpacity.value = opacity;
    for (let i = 0; i < HERO_SLATS.segments; i++) uRotations[i].value = springs[i].x;
  };

  /**
   * 释放资源
   *
   * 功能：销毁几何、材质与标题贴图
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   * 注意事项：调用方需同时把 mesh 从场景里移除
   */
  const dispose = () => {
    geometry.dispose();
    material.dispose();
    textTexture.dispose();
  };

  return { mesh, update, dispose };
}
