/**
 * lusion 卡片 GLSL —— 从 lusion.co 反混淆移植（Featured Work 卡片）
 *
 * 渲染模型（详见 .lusion_analysis/lusion-card-effect.ts）：
 *  - 每张卡片是 DOM 矩形同步的 WebGL 平面（u_domXY/u_domWH 逐帧写入）
 *  - 深度图（R 通道，0=最近 1=最远）承担两个职责：
 *      ① 视差 raymarch：鼠标 = 虚拟相机光心，12 步前向 POM 求交采样坐标
 *      ② DOF 散景：|像素深度 - 焦平面| 超出清晰带 → 黄金角螺旋盘采样模糊
 *  - 悬停 = 缩放弹簧(0.975→1) + 焦平面(-1→0.5 对焦呼吸) + 清晰带扩宽(0→-0.5)
 */

/** 蓝噪声 chunk（对应 lusion getBlueNoiseShader）：128px LUT，每帧随机平铺偏移 */
const BLUE_NOISE_GLSL = /* glsl */ `
uniform sampler2D u_blueNoiseTexture;
uniform vec2 u_blueNoiseTexelSize;
uniform vec2 u_blueNoiseCoordOffset;
vec3 getBlueNoise(vec2 coord) {
  return texture2D(u_blueNoiseTexture, coord * u_blueNoiseTexelSize + u_blueNoiseCoordOffset).rgb;
}
`;

/**
 * 顶点着色器：单位平面 → DOM 像素矩形（含入场侧移/旋转/缩放）
 *
 * 坐标系约定（与 JS 侧的正交相机配套）：
 *  - 相机为 left=0,right=w,top=0,bottom=-h 的 y 向下正交（屏幕像素坐标系）
 *  - shader 内先把 y 翻成向上摆完旋转再翻回，保证 rotation.z 语义直觉
 */
export const LUSION_CARD_VERT = /* glsl */ `
uniform vec3 u_position;      // 入场侧移（mesh.position 引用）
uniform vec4 u_quaternion;    // 入场倾斜（mesh.quaternion 引用）
uniform vec3 u_scale;         // mesh.scale 引用
uniform vec2 u_domXY;         // DOM 矩形左上角（视口像素，逐帧同步）
uniform vec2 u_domWH;         // DOM 矩形宽高（像素）
uniform vec2 u_domPivot;      // 旋转/缩放轴心（矩形中心）
varying vec2 v_uv;

vec3 qrotate(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
  vec3 basePos = vec3(position.xy * u_domWH - u_domPivot, position.z);
  vec3 screenPos = qrotate(u_quaternion, basePos * u_scale) + vec3(u_domPivot, 0.0);
  screenPos = (screenPos + vec3(u_domXY, 0.0) + u_position) * vec3(1.0, -1.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(screenPos, 1.0);
  // y 翻转不可省：本管线的世界系 y 向下（正交相机 top=0），而纹理 v 向上
  // （flipY 上传），不翻则整图上下颠倒（lusion padUv 同款处理）
  v_uv = vec2(uv.x, 1.0 - uv.y);
}
`;

/**
 * 片元着色器：视差 raymarch + DOF 散景 + 圆角遮罩 + 入场 + 雾化（完整移植）
 *
 * defines：
 *  - PARALLAX_SAMPLES 12  视差步数
 *  - BLUR_SAMPLES     6   散景采样数
 */
export const LUSION_CARD_FRAG = /* glsl */ `
uniform sampler2D u_texture;        // home.webp 颜色（sRGB，mipmap）
uniform sampler2D u_depthTexture;   // home_depth.webp 深度（Linear，R 通道 0..1）
uniform vec3  u_colorBg;
uniform float u_showRatio;          // 入场进度（侧滑+圆角长成+内容放大）
uniform float u_activeRatio;        // 选中过渡（本实现恒 0，保留接口）
uniform vec2  u_textureSize;
uniform vec2  u_domWH;
uniform vec2  u_shiftXY;            // 悬停甩动
uniform vec3  u_focusPos;           // (xy=视差相机, z=焦平面深度)
uniform float u_time;
uniform float u_zoomRatio;          // 悬停缩放弹簧
uniform float u_dofRangeOffset;     // 悬停 → -0.5（清晰带扩宽）
uniform float u_saturation;
uniform float u_brightness;
uniform float u_borderRatio;
uniform float u_rippleStrength;     // 滚动果冻波（本实现恒 0，保留接口）
uniform vec2  u_resolution;
uniform float u_globalRadius;       // 圆角半径（px）
varying vec2 v_uv;

${BLUE_NOISE_GLSL}

float linearStep(float edge0, float edge1, float x) {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}

/* 圆角矩形 SDF */
float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

/* 入场时遮罩从"圆/胶囊"收敛为圆角矩形（ratio: 1→0） */
float getRoundedCornerMask(vec2 uv, vec2 size, float radius, float ratio) {
  vec2 halfSize = size * 0.5;
  float maxDist = length(halfSize);
  float minSize = min(halfSize.x, halfSize.y);
  float maxSize = max(halfSize.x, halfSize.y);
  float t = ratio * maxDist;
  radius = mix(minSize * linearStep(0.0, minSize, t), radius, linearStep(maxSize, maxDist, t));
  halfSize = min(halfSize, vec2(t));
  float d = sdRoundedBox((uv - 0.5) * u_domWH, halfSize, radius);
  return smoothstep(0.0, 0.0 - fwidth(d), d);
}

void main() {
  vec2 screenUv = gl_FragCoord.xy / u_resolution;
  vec2 baseUv = v_uv;

  /* 滚动果冻波（保留接口，当前恒 0） */
  baseUv.x -= (screenUv.x - 0.5) * (1.0 - sin(screenUv.y * 3.141592)) * u_rippleStrength;

  float radiusRatio = 1.0;
  vec3 noise = getBlueNoise(gl_FragCoord.xy + vec2(5.0, 28.0));

  float imageAlpha = getRoundedCornerMask(
    baseUv, u_domWH * mix(0.7, 1.0, u_showRatio), u_globalRadius, radiusRatio);

  /* 颜色纹理 cover 适配 */
  vec2 toUvSpace = 1.0 / (u_textureSize *
    max(u_domWH.x / u_textureSize.x, u_domWH.y / u_textureSize.y));

  /* ---- 伪 3D 场景 + 视差 raymarch（前向 POM）---- */
  vec2 uv = baseUv - 0.5;
  uv *= u_domWH * mix(0.75, 1.0, u_showRatio);  // 入场：内容从 75% 放大
  uv *= mix(0.975, 1.0, u_zoomRatio);           // 悬停：再放大 2.5%
  float zMultiplier = u_domWH.y * (0.15 + u_activeRatio * 15.0);  // 深度挤出量
  vec3 pos = vec3(uv, -zMultiplier);

  float cameraDepth = u_domWH.y * mix(10.0, 5.0, u_zoomRatio);    // 悬停拉近
  vec3 rayOri = vec3(u_focusPos.xy, cameraDepth);
  float dist = length(pos - rayOri);
  vec3 rayDir = (pos - rayOri) / dist;
  float skipDist = cameraDepth / -rayDir.z;      // 透视修正：直达 z=0 平面
  dist -= skipDist;
  float stepDist = dist / float(PARALLAX_SAMPLES);
  vec3 rayStep = rayDir * stepDist;
  vec3 rayPos = rayOri + rayDir * (skipDist + stepDist * noise.x); // 蓝噪声去带状
  for (int i = 0; i < PARALLAX_SAMPLES; i++) {
    float currZ = -texture2D(u_depthTexture, rayPos.xy * toUvSpace + 0.5).r * zMultiplier;
    if (currZ > rayPos.z) break;                 // 射线钻入深度表面 → 命中
    rayPos += rayStep;
  }
  uv = rayPos.xy;
  uv *= toUvSpace;
  uv += u_shiftXY * 0.015;                       // 悬停甩动

  /* ---- DOF 散景（深度图第二用途）---- */
  float depth = texture2D(u_depthTexture, uv + 0.5).r;
  float blurriness = mix(0.0, 0.01, u_zoomRatio)
    * linearStep(0.0, 0.5, abs(depth - u_focusPos.z) + u_dofRangeOffset);

  /* 黄金角(2πφ)螺旋 + sqrt 均匀圆盘 + 蓝噪声初始角 → 无结构散景 */
  float angle = 6.2831853 * noise.y;
  float textureAspectInv = u_textureSize.y / u_textureSize.x;
  float numSampleInv = 1.0 / float(BLUR_SAMPLES);
  vec3 color = vec3(0.0);
  for (int i = 0; i < BLUR_SAMPLES; i++) {
    float fI = float(i);
    float r = sqrt((fI + 0.5) * numSampleInv) * blurriness;
    angle += 10.16640738;
    vec2 uvOffset = r * vec2(cos(angle) * textureAspectInv, sin(angle));
    color += texture2D(u_texture, uv + uvOffset + 0.5).rgb;
  }
  color *= numSampleInv;

  /* 调色 */
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, 1.0 + u_saturation);
  color += u_brightness;

  /* 选中雾化（接口保留，当前恒 0） */
  float fogThickness = 0.75;
  color = mix(color, u_colorBg,
    linearStep(0.0, fogThickness,
      u_activeRatio * (1.0 + fogThickness * 2.0) - fogThickness - (1.0 - depth)));

  gl_FragColor = vec4(color, imageAlpha);
  #include <colorspace_fragment>
}
`;
