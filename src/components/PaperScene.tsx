import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * 生成 512×512 的 hash 噪声 DataTexture
 *
 * 功能：在 CPU 端用 sin-hash 函数预生成一张 512×512 的单通道噪声纹理，
 *      作为纸张颗粒的源纹理（GPU 每帧只做采样，不重复计算 hash）。
 *
 * 参数：无
 * 返回值：THREE.DataTexture — 512×512 单通道（RedFormat）噪声纹理
 *
 * 异常：无
 *
 * 注意事项：
 *  - hash 公式：fract(sin(x*127.1 + y*311.7) * 43758.5453123)（经典 GLSL hash）
 *  - 用 RedFormat + UnsignedByteType，单字节精度足够做颗粒
 *  - RepeatWrapping 让纹理可以无缝平铺
 *  - 只生成一次（useMemo），全生命周期复用
 */
function createNoiseTexture(): THREE.DataTexture {
  const SIZE = 512;
  const data = new Uint8Array(SIZE * SIZE);

  /**
   * 二维 hash 函数
   *
   * 参数：x, y — 整数坐标
   * 返回值：0~1 的伪随机浮点数
   */
  const hash = (x: number, y: number): number => {
    const r = 43758.5453123 * Math.sin(127.1 * x + 311.7 * y);
    return r - Math.floor(r);
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      data[SIZE * y + x] = Math.round(255 * hash(x, y));
    }
  }

  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 做旧纸张 GLSL Shader（逆向自 shader.se 的 getPaperColor TSL 源码）
 *
 * 实现（按渲染顺序）：
 *  1. 采样内容纹理（文字层）
 *  2. 纸张色调映射：暗棕底 → 亮米色顶的色域压缩
 *  3. 多频纸张颗粒：多层不同频率 hash 噪声叠加成 FBM
 *  4. 亮度调制：颗粒强度随亮度/暗部修正变化
 *  5. 色调偏移：暖黄色调噪声叠加
 *  6. 水平暗角渐隐：左右边缘平滑过渡
 *
 * uniforms：
 *  - tContent      内容纹理（Canvas 2D 绘制的文字层）
 *  - tNoise        512×512 噪声纹理
 *  - uDimensions   画面尺寸（px，用于噪声频率计算）
 *  - uScroll       滚动进度 0~1（驱动内容纹理 UV 偏移）
 *  - uTime         时间（秒，驱动颗粒微动画）
 *  - uInkColor     墨水颜色（文字底色，默认暗棕）
 *  - uPaperColor   纸张颜色（高光色，默认亮米）
 *
 * 注意事项：
 *  - 顶点着色器直接输出 NDC 坐标（gl_Position = vec4(position.xy, 0, 1)），
 *    完全不依赖相机投影矩阵，确保 2×2 平面铺满全屏
 *  - 噪声用多层频率叠加
 *  - 边缘暗角用 smoothstep 硬化，避免渐变太柔
 */
const PaperShader = {
  uniforms: {
    tContent: { value: null as THREE.Texture | null },
    tNoise: { value: null as THREE.Texture | null },
    uDimensions: { value: new THREE.Vector2(1, 1) },
    // 纸张画布实际尺寸（px），用于做旧效果基于纸张坐标采样（跟随滚动）
    uPaperSize: { value: new THREE.Vector2(1024, 3072) },
    uContentAspect: { value: 1.0 },
    uScroll: { value: 0.0 },
    uTime: { value: 0.0 },
    uInkColor: { value: new THREE.Color(0.12, 0.10, 0.08) },
    uPaperColor: { value: new THREE.Color(0.96, 0.92, 0.78) },
    // 边缘色散强度（垂直方向 RGB 偏移，参考主页面 Dq class）
    uChromaticAberration: { value: 0.4 },
    // 镜头畸变强度（参考主页面，正值桶形）
    uDistortion: { value: 0.12 },
    // 镜头边缘畸变系数（0=主畸变最大，1=主畸变归零，参考主页面）
    uDistortionBorder: { value: 0.0 },
    // 屏幕宽高比（用于畸变和色散的 X 方向校正）
    uAspect: { value: 1.0 },
    // 粉碎进度（0=未粉碎，1=完全粉碎）：控制撕裂边缘位置和透明度
    uShredProgress: { value: 0.0 },
  },
  // 全屏 quad 顶点着色器：直接输出 NDC，不经过相机投影矩阵
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tContent;
    uniform sampler2D tNoise;
    uniform vec2 uDimensions;
    uniform vec2 uPaperSize;
    uniform float uContentAspect;
    uniform float uScroll;
    uniform float uTime;
    uniform vec3 uInkColor;
    uniform vec3 uPaperColor;
    uniform float uChromaticAberration;
    uniform float uDistortion;
    uniform float uDistortionBorder;
    uniform float uAspect;
    uniform float uShredProgress;
    varying vec2 vUv;

    /**
     * 旋转 UV（用于色调偏移噪声采样，避免规则纹理感）
     *
     * 参数：uv — 原始 UV
     * 返回值：旋转后的 UV
     */
    vec2 rotateUV(vec2 uv) {
      float c = 1.27;
      float s = -0.73;
      return vec2(uv.x * c + uv.y * 0.81, uv.x * s + uv.y * 1.11);
    }

    /**
     * 桶形畸变 + 边缘缩放（参考主页面 FilmPostProcessing 的 DH + DV 函数）
     *
     * 公式：
     *  - n = mix(0.3655, 0.0, border)   // border 越大主畸变越弱
     *  - scale = 1 - distortion × n     // 整体缩放避免溢出
     *  - offset = distortion × n × 0.5  // UV 平移
     *  - r² = (uv-0.5)²                  // 到中心距离平方
     *  - k = 1 + r² × distortion         // 径向畸变系数
     *  - distorted = scale × (i × k + 0.5) + offset
     *
     * 参数：
     *  - uv         原始 UV [0,1]
     *  - distortion 畸变强度
     *  - border     边缘系数（0=最大主畸变，1=主畸变归零）
     *
     * 返回值：畸变后的 UV
     */
    vec2 barrelDistort(vec2 uv, float distortion, float border) {
      float n = mix(0.3655, 0.0, border);
      float scale = 1.0 - distortion * n;
      float offset = distortion * n * 0.5;

      vec2 i = uv - 0.5;
      float r2 = dot(i, i);
      float k = 1.0 + r2 * distortion;

      return scale * (vec2(i.x * k, i.y * k) + 0.5) + offset;
    }

    /**
     * 多频纸张颗粒（FBM）— 强化版
     *
     * 功能：用多层不同频率的噪声纹理采样叠加，模拟纸张纤维颗粒
     *       包含粗纤维、细颗粒、微细粉尘三层
     *
     * 参数：paperCoord — 纸张像素坐标（contentUV × uPaperSize，跟随纸张滚动）
     * 返回值：float 颗粒值（约 -0.3 ~ 0.6）
     */
    float paperGrain(vec2 paperCoord) {
      // 中频纤维
      float n1 = texture2D(tNoise, paperCoord * 0.6 / 512.0).r * 0.3;
      float n2 = texture2D(tNoise, paperCoord * 0.02 / 512.0).r * 0.2;

      // 粗颗粒（旋转 UV 采样，避免规则感）
      float n3 = texture2D(tNoise, paperCoord * vec2(1.43, 0.77) / 512.0).r * 0.59;
      float n4 = texture2D(tNoise, paperCoord * vec2(0.61, 1.31) / 512.0 + vec2(19.2, 7.4)).r * 0.41;
      float darkMask = smoothstep(0.52, 0.92, n3 * 0.59 + n4 * 0.41) * 0.25;

      // 微细颗粒层（高频密集点状粉尘，加在做旧感）
      float fine1 = texture2D(tNoise, paperCoord * vec2(3.7, 2.9) / 512.0).r;
      float fine2 = texture2D(tNoise, paperCoord * vec2(5.3, 4.1) / 512.0 + vec2(3.1, 8.7)).r;
      float fineGrain = (fine1 - 0.5) * 0.35 + (fine2 - 0.5) * 0.25;

      // 叠加
      float grain = (n1 + n2) * 0.2 - darkMask + fineGrain;

      return grain;
    }

    void main() {
      // === 1. 屏幕桶形畸变（参考主页面 FilmPostProcessing）===
      // 对屏幕 UV 做桶形畸变 + 边缘缩放，让画面边缘产生凸面镜式扭曲
      // 使用主页面同款公式：scale + offset 防溢出，r² × distortion 径向系数
      vec2 distortedUV = barrelDistort(vUv, uDistortion, uDistortionBorder);

      // === 2. 采样内容纹理（文字层），带宽高比校正 ===
      // 计算可见区域比例：内容按宽度填满屏幕，仅显示部分高度
      // visibleYRange = uContentAspect / screenAspect（内容宽高比 / 屏幕宽高比）
      float screenAspect = uDimensions.x / max(uDimensions.y, 1.0);
      float visibleYRange = min(uContentAspect / max(screenAspect, 0.001), 1.0);
      float maxScroll = max(1.0 - visibleYRange, 0.0);
      float yOffset = uScroll * maxScroll;

      // X 直接映射，Y 映射到可见窗口：scroll=0 显示画布顶部（标题），scroll=1 显示底部（页脚）
      // flipY=false 的 CanvasTexture：UV (0,0)=画布左上角，UV (0,1)=画布左下角
      // vUv.y=1（屏幕顶部）→ contentUV.y=yOffset（画布顶部），随 scroll 增大下移
      vec2 baseContentUV = vec2(distortedUV.x, (1.0 - distortedUV.y) * visibleYRange + yOffset);

      // === 2.5 垂直方向 RGB 色散（参考主页面 Dq class）===
      // dist = 到中心距离（aspect 校正），caOffset = 0.001 × dist × 2 × strength
      // 仅在 Y 轴偏移（垂直方向），强度随径向距离增大，中心无色散
      vec2 aspectCorrect = vec2(uAspect, 1.0) / max(uAspect, 1.0);
      float dist = length((vUv - 0.5) * aspectCorrect * 2.0);
      float caOffset = 0.001 * dist * 2.0 * uChromaticAberration;

      // 边缘渐隐保护（参考主页面 ex × ey）：避免色散在屏幕极边缘溢出产生杂讯
      float edge = 0.005;
      float ex = smoothstep(0.0, edge, vUv.x) * smoothstep(0.0, edge, 1.0 - vUv.x);
      float ey = smoothstep(0.0, edge, vUv.y) * smoothstep(0.0, edge, 1.0 - vUv.y);
      float edgeMask = ex * ey;

      // R 通道向下偏移，B 通道向上偏移，G 通道不偏移（与主页面一致）
      float rC = texture2D(tContent, baseContentUV + vec2(0.0, -caOffset)).r;
      float gC = texture2D(tContent, baseContentUV).g;
      float bC = texture2D(tContent, baseContentUV + vec2(0.0, caOffset)).b;
      float aC = texture2D(tContent, baseContentUV).a;
      // 原始未偏移采样（用于边缘渐隐回退，避免边缘出现彩色镶边杂讯）
      vec4 originalContent = texture2D(tContent, baseContentUV);
      vec4 contentColor = mix(originalContent, vec4(rC, gC, bC, aC), edgeMask);

      // 纸张像素坐标：baseContentUV × 纸张画布尺寸
      // 关键：做旧效果基于纸张坐标采样，随 baseContentUV（即 uScroll）变化而滚动
      // 这样颗粒/污渍/划痕都"附着"在纸张上，纸张滚动时一起移动
      // 同时 paperCoord 也受桶形畸变影响，与文字层保持同步扭曲
      vec2 paperCoord = baseContentUV * uPaperSize;

      // === 2. 纸张色调映射 ===
      // 把内容颜色映射到暗棕底 → 亮米色顶的色域
      vec3 ink = uInkColor * 0.8;
      vec3 paper = uPaperColor;
      vec3 baseColor = ink + pow(clamp(contentColor.rgb, 0.0, 1.0), vec3(1.0)) * 0.8 * (paper - ink);

      // === 3. 多频纸张颗粒（基于纸张坐标，跟随滚动）===
      float grain = paperGrain(paperCoord);

      // === 3.5 大块褐色污渍（基于纸张坐标，跟随滚动）===
      // 用低频噪声生成大块的褐色斑驳，模拟纸张长期存放产生的污渍
      float stain1 = texture2D(tNoise, paperCoord * vec2(0.0035, 0.0048) + vec2(2.7, 1.3)).r;
      float stain2 = texture2D(tNoise, paperCoord * vec2(0.0021, 0.0029) + vec2(7.1, 4.8)).r;
      float stainMask = smoothstep(0.55, 0.85, stain1 * 0.6 + stain2 * 0.4);
      // 褐色污渍颜色（深棕偏黄）
      vec3 stainColor = vec3(0.45, 0.32, 0.18);
      // 污渍强度（中等浓度）
      float stainStrength = stainMask * 0.35;

      // === 3.6 中等斑点（基于纸张坐标，跟随滚动）===
      // 用中频噪声生成中等大小的茶色斑点
      float spot1 = texture2D(tNoise, paperCoord * vec2(0.015, 0.012) + vec2(5.3, 9.1)).r;
      float spot2 = texture2D(tNoise, paperCoord * vec2(0.019, 0.017) + vec2(1.7, 6.4)).r;
      float spotMask = smoothstep(0.68, 0.92, spot1 * 0.55 + spot2 * 0.45);
      float spotStrength = spotMask * 0.18;
      float totalSpot = stainStrength + spotStrength;

      // === 4. 亮度调制 ===
      float luminance = dot(baseColor, vec3(0.3333));
      float darkness = 1.0 - luminance;
      float brightnessFactor = mix(0.2, 0.98, luminance) * 0.3 + 0.95;
      float contrastFactor = mix(0.15, 0.6, darkness) * 1.6 + 1.0;
      float tintFactor = mix(1.0, 1.15, contentColor.a);

      // 颗粒驱动的亮度增强（颗粒强度加倍）
      float brightnessBoost = 1.0 + grain * 0.42 * brightnessFactor * contrastFactor * tintFactor * 1.2;

      // === 5. 色调偏移（基于纸张坐标，跟随滚动）===
      float tintNoise = texture2D(tNoise, rotateUV(paperCoord) / 512.0).r;
      tintNoise = smoothstep(0.55, 0.95, tintNoise) * smoothstep(0.40, 0.95, darkness) * 0.12 * tintFactor;

      // === 5.5 整体泛黄（纸张氧化变黄）===
      // 在纸张亮区叠加轻微的暖黄色调，模拟纸张老化泛黄
      float yellowing = smoothstep(0.4, 0.9, luminance) * 0.08;
      vec3 yellowTint = vec3(0.95, 0.82, 0.55);

      // 合成最终颜色（含污渍混合）
      vec3 stainedColor = mix(baseColor, stainColor, totalSpot * 0.6);
      vec3 finalColor = stainedColor * brightnessBoost + vec3(tintNoise);
      // 泛黄叠加（仅在亮区生效）
      finalColor = mix(finalColor, finalColor * yellowTint, yellowing);

      // === 6. 纸张边缘焦黄（基于纸张坐标，跟随纸张边缘滚动）===
      // 四个纸张边缘叠加焦黄色，模拟纸张被火烤或长期氧化的边缘
      // 用 baseContentUV 计算，这样只有滚到纸张顶部/底部时才看到焦黄边缘
      float paperEdgeDist = min(min(baseContentUV.x, 1.0 - baseContentUV.x), min(baseContentUV.y, 1.0 - baseContentUV.y));
      float burnMask = smoothstep(0.06, 0.0, paperEdgeDist);
      vec3 burnColor = vec3(0.62, 0.42, 0.20);
      finalColor = mix(finalColor, finalColor * burnColor * 1.4, burnMask * 0.5);

      // === 6.5 细密划痕（基于纸张坐标，跟随滚动）===
      // 用高频噪声模拟细密的横向/纵向划痕
      float scratch1 = texture2D(tNoise, vec2(paperCoord.x * 0.8, paperCoord.y * 0.003) / 512.0).r;
      float scratch2 = texture2D(tNoise, vec2(paperCoord.x * 0.003, paperCoord.y * 0.8) / 512.0 + vec2(11.3, 2.7)).r;
      float scratchMask = smoothstep(0.78, 0.95, scratch1 * scratch2);
      finalColor *= 1.0 - scratchMask * 0.15;

      // === 6.6 细微白色噪点（基于纸张坐标，跟随滚动）===
      // 用高频噪声提取少量亮像素作为白色粉尘/纸屑，在纸张上随机分布
      // 双层采样叠加，增加噪点的随机性，避免规则感
      float wn1 = texture2D(tNoise, paperCoord * vec2(6.3, 5.7) / 512.0).r;
      float wn2 = texture2D(tNoise, paperCoord * vec2(8.1, 7.3) / 512.0 + vec2(4.2, 9.6)).r;
      // 取两层噪声的较大值，用高阈值提取稀疏的亮点
      float wnMax = max(wn1, wn2);
      float whiteDust = smoothstep(0.82, 0.96, wnMax);
      // 白色噪点强度随时间微弱闪烁（呼吸感）
      float dustFlicker = 0.85 + 0.15 * sin(uTime * 1.3 + wnMax * 10.0);
      // 白色叠加：在纸张各处散布细微亮点，强度受暗部增强（暗区更显眼）
      finalColor += vec3(whiteDust * 0.18 * dustFlicker);

      // === 7. 屏幕镜头暗角（基于畸变后的 UV，跟随镜头畸变弯曲）===
      // 这是镜头暗角效果，固定在屏幕边缘，模拟相机/镜头的物理暗角
      // 关键：用 distortedUV 而非 vUv 计算，让黑边跟随桶形畸变弯曲，
      //       产生"镜头物理边框"的包裹感，而不是死板的矩形黑边
      float edgeFade = smoothstep(0.0, 0.25, 1.0 - abs(distortedUV.x - 0.5) * 2.0);
      edgeFade = smoothstep(0.0, 0.08, edgeFade);
      finalColor *= edgeFade;

      float vEdge = smoothstep(0.0, 0.15, distortedUV.y) * smoothstep(0.0, 0.15, 1.0 - distortedUV.y);
      finalColor *= mix(0.75, 1.0, vEdge);

      // 微弱时间动画（颗粒"呼吸"感）
      float breath = 0.02 * sin(uTime * 0.5);
      finalColor += vec3(breath);

      // === 8. 纸张竖直条状切割（被碎纸机竖着切碎，纸条保留飘动）===
      // 粉碎机从屏幕下方升起，撕裂线（粉碎机顶部）以下的纸张被竖直刀片切成条状
      // 关键：纸条不消失（不透明），而是：
      //   1. 每条边缘出现竖直缝隙（刀片切口），撕裂线以下缝隙扩大
      //   2. 每条纸条向外飘动（X 位移随时间 + 深度）
      //   3. 纸条略微下垂（Y 位移）
      //   4. 切割边缘有锯齿纤维
      // shredProgress=0：无切割；shredProgress=1：切割线到屏幕顶部
      float shredAlpha = 1.0;
      if (uShredProgress > 0.001) {
        // 粉碎机顶部 Y 位置（撕裂线）
        float tearLineY = uShredProgress;

        // 竖直条带切割：把纸张切成 N 条
        float stripCount = 16.0;
        float stripId = floor(distortedUV.x * stripCount);
        float stripCoord = fract(distortedUV.x * stripCount); // 0~1 每条内坐标

        // 每条独立的撕裂线位置（用条带 ID 作种子 + 噪声）
        // 不同条带的切割边缘高度不一，模拟刀片切割深浅差异
        float tearNoise = texture2D(tNoise, vec2(stripId * 7.3, 0.0) / 512.0).r;
        float actualTearY = tearLineY + (tearNoise - 0.5) * 0.14;

        // 距撕裂线的距离（正值=上方=未切割，负值=下方=被切碎的纸条）
        float distToTear = distortedUV.y - actualTearY;

        // 被切割的程度（0=未切，1=完全切开的纸条）
        // 撕裂线以下越深，切割越彻底，缝隙越大、飘动越明显
        float cutAmount = smoothstep(0.0, -0.3, distToTear);

        // === 竖直切割缝隙（刀片切口）===
        // stripCoord 在条带边缘（0 或 1）时为缝隙
        float gapWidth = 0.06;
        float gapMask = smoothstep(0.0, gapWidth, min(stripCoord, 1.0 - stripCoord));
        // 撕裂线以下：缝隙扩大（条带分离），模拟切碎后条带分开
        // 未切开区域 gapMask=1（无缝隙），切开区域 gapMask 减小
        shredAlpha = mix(1.0, gapMask, cutAmount);

        // === 纸条飘动位移（被切开的纸条向外飘）===
        // 只对撕裂线以下的纸条应用位移
        if (cutAmount > 0.01) {
          // 每条独立的飘动相位和幅度（用 stripId 作种子）
          float swayNoise = texture2D(tNoise, vec2(stripId * 3.7, 0.0) / 512.0).r;
          // 飘动方向：条带在屏幕左半部分向左飘，右半部分向右飘（向外分开）
          float swayDir = distortedUV.x > 0.5 ? 1.0 : -1.0;
          // 飘动相位：每条不同，时间驱动
          float swayPhase = uTime * 1.5 + swayNoise * 6.28;
          // 飘动幅度：随切割深度增加（越深飘得越远），随时间正弦摆动
          float swayAmp = cutAmount * 0.02 * (0.7 + swayNoise * 0.6);
          float swayOffset = sin(swayPhase) * swayAmp * swayDir;

          // 下垂位移：被切开的纸条因重力略微下垂
          float droopOffset = cutAmount * 0.015 * (0.5 + swayNoise * 0.5);

          // 应用位移到 UV（重新采样内容纹理，产生飘动效果）
          // 注意：这里位移影响 contentColor 和 finalColor 的后续计算
          // 由于位移在内容采样之后，我们用近似方法：在最终颜色上叠加位移产生的明暗变化
          // （完整重新采样成本高，用明暗模拟飘动产生的光影变化）
          float swayShade = sin(swayPhase + swayOffset * 50.0) * cutAmount * 0.1;
          finalColor *= 1.0 + swayShade - droopOffset * 2.0;
        }

        // === 切割边缘锯齿纤维 ===
        float edgeNoise = texture2D(tNoise, vec2(stripId * 3.1, distToTear * 60.0) / 512.0).r;
        float fiberMask = smoothstep(0.6, 0.9, edgeNoise)
          * smoothstep(0.0, 0.03, abs(distToTear))
          * smoothstep(0.05, 0.0, abs(distToTear));
        finalColor = mix(finalColor, vec3(0.2, 0.15, 0.1), fiberMask * 0.5);

        // === 撕裂边缘暗化（被粉碎机阴影影响）===
        float edgeDarken = smoothstep(0.0, -0.04, distToTear) * 0.3;
        finalColor *= 1.0 - edgeDarken;
      }

      gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), shredAlpha);
    }
  `,
};

/**
 * PaperScene — 做旧纸张全屏渲染场景
 *
 * 功能：全屏 quad + PaperShader，把 Canvas 2D 绘制的文字纹理
 *      处理成做旧纸张质感（多频颗粒 + 纸张色调 + 暗角 + 色调偏移）。
 *
 * 参数：
 *  - paperScrollProgress — 滚动进度 ref（0~1，驱动内容纹理 UV 偏移）
 *  - contentTexture      — Canvas 2D 绘制的文字纹理
 *
 * 返回值：React.ReactElement
 *
 * 异常：无
 *
 * 注意事项：
 *  - 顶点着色器直接输出 NDC 坐标，不依赖任何相机投影矩阵
 *  - 2×2 平面的顶点正好是 NDC 的四个角（±1, ±1），铺满全屏
 *  - contentTexture 由外部传入（PaperDetailPage 用 Canvas 2D 绘制文字生成）
 *  - 噪声纹理只生成一次（useMemo），全生命周期复用
 */
export function PaperScene({
  paperScrollProgress,
  contentTexture,
}: {
  paperScrollProgress: React.MutableRefObject<number>;
  contentTexture: THREE.Texture | null;
}) {
  const { size } = useThree();
  const meshRef = useRef<THREE.Mesh | null>(null);
  // 实际渲染用的滚动进度（lerp 插值后的平滑值）
  // wheel 事件是离散触发（每次 deltaY≈100px，progress 跳变≈0.09），
  // 直接用 target 会导致画面一卡一卡跳；每帧用 lerp 趋近 target 实现惯性丝滑滚动
  const smoothScrollRef = useRef(0);

  // 生成噪声纹理（只生成一次）
  const noiseTexture = useMemo(() => createNoiseTexture(), []);

  // 创建 shader 材质（contentTexture 变化时更新）
  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(PaperShader.uniforms),
      vertexShader: PaperShader.vertexShader,
      fragmentShader: PaperShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      // 开启透明：粉碎阶段 shredAlpha<1 的区域需要透明，露出下层粉碎机
      transparent: true,
    });
    mat.uniforms.tNoise.value = noiseTexture;
    if (contentTexture) {
      mat.uniforms.tContent.value = contentTexture;
    }
    return mat;
  }, [noiseTexture, contentTexture]);

  // 每帧更新 uniforms
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const mat = mesh.material as THREE.ShaderMaterial;
    if (mat && mat.uniforms) {
      // lerp 插值：每帧把当前值向目标值趋近（因子 0.12 ≈ 8 帧达到 60%）
      // 这样离散的 wheel 跳变被插值成连续平滑的滚动，产生惯性丝滑感
      // 因子越大跟随越紧（越接近原始离散），越小越柔顺（延迟越大）
      const target = paperScrollProgress.current;
      // 当 target 与当前值差距过大（>0.3），说明外部重置了滚动（如进入/退出详情页），
      // 立即 snap 到 target，避免从旧值缓慢插值产生明显延迟
      if (Math.abs(smoothScrollRef.current - target) > 0.3) {
        smoothScrollRef.current = target;
      } else {
        smoothScrollRef.current = THREE.MathUtils.lerp(
          smoothScrollRef.current,
          target,
          0.12
        );
        // 到达目标后清零避免无限插值浮点残留
        if (Math.abs(smoothScrollRef.current - target) < 0.0005) {
          smoothScrollRef.current = target;
        }
      }

      mat.uniforms.uDimensions.value.set(size.width, size.height);
      // 滚动进度：0~1 正常阅读，超过 1 的部分也传给 shader（用于内容 UV 偏移到底部后继续）
      // clamp 到 0~1 用于内容纹理偏移，避免 UV 超出 [0,1] 范围
      mat.uniforms.uScroll.value = Math.min(smoothScrollRef.current, 1.0);
      mat.uniforms.uTime.value = clock.getElapsedTime();
      // 粉碎进度：paperScrollProgress 超过 1.0 的部分映射到 0~1
      // 1.0~SHRED_MAX(1.4) → 0~1，驱动粉碎机升起和纸张撕裂
      const rawProgress = smoothScrollRef.current;
      const shredProgress = Math.max(0, Math.min(1, (rawProgress - 1.0) / 0.4));
      mat.uniforms.uShredProgress.value = shredProgress;
      // 屏幕宽高比，用于色散和畸变的 X 方向校正（与主页面 FilmPostProcessing 保持一致）
      mat.uniforms.uAspect.value = size.width / Math.max(size.height, 1);
      // 内容纹理宽高比（宽/高），用于 shader 中宽高比校正
      const tex = mat.uniforms.tContent.value as THREE.Texture | null;
      if (tex && tex.image) {
        const img = tex.image as HTMLCanvasElement;
        mat.uniforms.uContentAspect.value =
          img.width / Math.max(img.height, 1);
        // 同步纸张画布实际尺寸，供做旧效果基于纸张坐标采样
        mat.uniforms.uPaperSize.value.set(img.width, img.height);
      }
    }
  });

  // 全屏 quad：2×2 平面顶点 = NDC 四角（±1, ±1），顶点着色器直接输出 NDC
  // frustumCulled={false}：顶点着色器直接输出 NDC，与相机位置无关，
  //   Three.js 的默认视锥裁剪会误判 mesh 不可见而跳过渲染，必须禁用
  // material={material}：直接通过 prop 传入材质，避免 primitive attach 的问题
  return (
    <mesh ref={meshRef} frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
