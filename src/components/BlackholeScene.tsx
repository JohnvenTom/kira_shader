import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * 黑洞 Fragment Shader（移植自 refactorWeb/shaders/blackhole_main.frag）
 *
 * 功能：完整的光线步进（ray marching）黑洞渲染：
 *  - 引力透镜：用角动量守恒近似的引力加速度弯曲光线路径（Schwarzschild 度规简化）
 *  - 吸积盘：体积粒子云，fbm 噪声密度 + 颜色贴图映射 + 旋转
 *  - 星云背景：立方体贴图全景采样（skybox_nebula_dark）
 *  - 事件视界：光线落入 r<1 后返回黑色（黑洞本体）
 *
 * 注意事项：
 *  - 这是 WebGL2 GLSL3（#version 300 es）着色器，Three.js 需要 glslVersion: GLSL3
 *  - 变量命名与 uniform 名与原项目保持一致，便于后续对照调参
 *  - 300 步光线步进对 GPU 压力大，渲染 Canvas 应限制 DPR（见 BlackholeDetailPage）
 */
const BLACKHOLE_FRAG = /* glsl */ `
  precision highp float;

  out vec4 fragColor;

  uniform vec2 resolution;
  uniform float mouseX;
  uniform float mouseY;

  uniform float time;
  uniform samplerCube galaxy;
  uniform sampler2D colorMap;

  uniform float frontView;
  uniform float topView;
  uniform float cameraRoll;

  uniform float gravatationalLensing;
  uniform float renderBlackHole;
  uniform float mouseControl;
  uniform float fovScale;

  uniform float adiskEnabled;
  uniform float adiskParticle;
  uniform float adiskHeight;
  uniform float adiskLit;
  uniform float adiskDensityV;
  uniform float adiskDensityH;
  uniform float adiskNoiseScale;
  uniform float adiskNoiseLOD;
  uniform float adiskSpeed;

  struct Ring {
    vec3 center;
    vec3 normal;
    float innerRadius;
    float outerRadius;
    float rotateSpeed;
  };

  ///----
  /// Simplex 3D Noise
  /// by Ian McEwan, Ashima Arts
  vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1. + 3.0 * C.xxx;

    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y +
                             vec4(0.0, i1.y, i2.y, 1.0)) +
                     i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 1.0 / 7.0;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm =
        taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m =
        max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 *
           dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  ///----

  float ringDistance(vec3 rayOrigin, vec3 rayDir, Ring ring) {
    float denominator = dot(rayDir, ring.normal);
    float constant = -dot(ring.center, ring.normal);
    if (abs(denominator) < 0.0001) {
      return -1.0;
    } else {
      float t = -(dot(rayOrigin, ring.normal) + constant) / denominator;
      if (t < 0.0) {
        return -1.0;
      }

      vec3 intersection = rayOrigin + t * rayDir;

      float d = length(intersection - ring.center);
      if (d >= ring.innerRadius && d <= ring.outerRadius) {
        return t;
      }
      return -1.0;
    }
  }

  vec3 panoramaColor(sampler2D tex, vec3 dir) {
    vec2 uv = vec2(0.5 - atan(dir.z, dir.x) / 3.14159265359 * 0.5, 0.5 - asin(dir.y) / 3.14159265359);
    return texture(tex, uv).rgb;
  }

  vec3 accel(float h2, vec3 pos) {
    float r2 = dot(pos, pos);
    float r5 = pow(r2, 2.5);
    vec3 acc = -1.5 * h2 * pos / r5 * 1.0;
    return acc;
  }

  vec4 quadFromAxisAngle(vec3 axis, float angle) {
    vec4 qr;
    float half_angle = (angle * 0.5) * 3.14159 / 180.0;
    qr.x = axis.x * sin(half_angle);
    qr.y = axis.y * sin(half_angle);
    qr.z = axis.z * sin(half_angle);
    qr.w = cos(half_angle);
    return qr;
  }

  vec4 quadConj(vec4 q) { return vec4(-q.x, -q.y, -q.z, q.w); }

  vec4 quat_mult(vec4 q1, vec4 q2) {
    vec4 qr;
    qr.x = (q1.w * q2.x) + (q1.x * q2.w) + (q1.y * q2.z) - (q1.z * q2.y);
    qr.y = (q1.w * q2.y) - (q1.x * q2.z) + (q1.y * q2.w) + (q1.z * q2.x);
    qr.z = (q1.w * q2.z) + (q1.x * q2.y) - (q1.y * q2.x) + (q1.z * q2.w);
    qr.w = (q1.w * q2.w) - (q1.x * q2.x) - (q1.y * q2.y) - (q1.z * q2.z);
    return qr;
  }

  vec3 rotateVector(vec3 position, vec3 axis, float angle) {
    vec4 qr = quadFromAxisAngle(axis, angle);
    vec4 qr_conj = quadConj(qr);
    vec4 q_pos = vec4(position.x, position.y, position.z, 0);

    vec4 q_tmp = quat_mult(qr, q_pos);
    qr = quat_mult(q_tmp, qr_conj);

    return vec3(qr.x, qr.y, qr.z);
  }

  #define IN_RANGE(x, a, b) (((x) > (a)) && ((x) < (b)))

  void cartesianToSpherical(in vec3 xyz, out float rho, out float phi,
                            out float theta) {
    rho = sqrt((xyz.x * xyz.x) + (xyz.y * xyz.y) + (xyz.z * xyz.z));
    phi = asin(xyz.y / rho);
    theta = atan(xyz.z, xyz.x);
  }

  vec3 toSpherical(vec3 p) {
    float rho = sqrt((p.x * p.x) + (p.y * p.y) + (p.z * p.z));
    float theta = atan(p.z, p.x);
    float phi = asin(p.y / rho);
    return vec3(rho, theta, phi);
  }

  vec3 toSpherical2(vec3 pos) {
    vec3 radialCoords;
    radialCoords.x = length(pos) * 1.5 + 0.55;
    radialCoords.y = atan(-pos.x, -pos.z) * 1.5;
    radialCoords.z = abs(pos.y);
    return radialCoords;
  }

  void ringColor(vec3 rayOrigin, vec3 rayDir, Ring ring, inout float minDistance,
                 inout vec3 color) {
    float distance = ringDistance(rayOrigin, normalize(rayDir), ring);
    if (distance >= 0.0001 && distance < minDistance &&
        distance <= length(rayDir) + 0.0001) {
      minDistance = distance;

      vec3 intersection = rayOrigin + normalize(rayDir) * minDistance;
      vec3 ringColor;

      {
        float dist = length(intersection);

        float v = clamp((dist - ring.innerRadius) /
                            (ring.outerRadius - ring.innerRadius),
                        0.0, 1.0);

        vec3 base = cross(ring.normal, vec3(0.0, 0.0, 1.0));
        float angle = acos(dot(normalize(base), normalize(intersection)));
        if (dot(cross(base, intersection), ring.normal) < 0.0)
          angle = -angle;

        float u = 0.5 - 0.5 * angle / 3.14159265359;
        u += time * ring.rotateSpeed;

        vec3 color = vec3(0.0, 0.5, 0.0);
        float alpha = 0.5;
        ringColor = vec3(color);
      }

      color += ringColor;
    }
  }

  mat3 lookAt(vec3 origin, vec3 target, float roll) {
    vec3 rr = vec3(sin(roll), cos(roll), 0.0);
    vec3 ww = normalize(target - origin);
    vec3 uu = normalize(cross(ww, rr));
    vec3 vv = normalize(cross(uu, ww));

    return mat3(uu, vv, ww);
  }

  float sqrLength(vec3 a) { return dot(a, a); }

  void adiskColor(vec3 pos, inout vec3 color, inout float alpha) {
    float innerRadius = 2.6;
    float outerRadius = 12.0;

    float density = max(
        0.0, 1.0 - length(pos.xyz / vec3(outerRadius, adiskHeight, outerRadius)));
    if (density < 0.001) {
      return;
    }

    density *= pow(1.0 - abs(pos.y) / adiskHeight, adiskDensityV);

    density *= smoothstep(innerRadius, innerRadius * 1.1, length(pos));

    if (density < 0.001) {
      return;
    }

    vec3 sphericalCoord = toSpherical(pos);

    sphericalCoord.y *= 2.0;
    sphericalCoord.z *= 4.0;

    density *= 1.0 / pow(sphericalCoord.x, adiskDensityH);
    density *= 16000.0;

    if (adiskParticle < 0.5) {
      color += vec3(0.0, 1.0, 0.0) * density * 0.02;
      return;
    }

    float noise = 1.0;
    const int MAX_NOISE_LOD = 12;
    for (int i = 0; i < MAX_NOISE_LOD; i++) {
      if (i >= int(adiskNoiseLOD)) break;
      noise *= 0.5 * snoise(sphericalCoord * pow(float(i), 2.0) * adiskNoiseScale) + 0.5;
      if (i % 2 == 0) {
        sphericalCoord.y += time * adiskSpeed;
      } else {
        sphericalCoord.y -= time * adiskSpeed;
      }
    }

    vec3 dustColor =
        texture(colorMap, vec2(sphericalCoord.x / outerRadius, 0.5)).rgb;

    color += density * adiskLit * dustColor * alpha * abs(noise);
  }

  vec3 traceColor(vec3 pos, vec3 dir) {
    vec3 color = vec3(0.0);
    float alpha = 1.0;

    float STEP_SIZE = 0.1;
    dir *= STEP_SIZE;

    vec3 h = cross(pos, dir);
    float h2 = dot(h, h);

    for (int i = 0; i < 300; i++) {
      if (renderBlackHole > 0.5) {
        if (gravatationalLensing > 0.5) {
          vec3 acc = accel(h2, pos);
          dir += acc;
        }

        if (dot(pos, pos) < 1.0) {
          return color;
        }

        float minDistance = 1000000.0;

        if (adiskEnabled > 0.5) {
          adiskColor(pos, color, alpha);
        }
      }

      pos += dir;
    }

    dir = rotateVector(dir, vec3(0.0, 1.0, 0.0), time);
    // skybox_nebula_dark 是暗版星云（六面平均亮度仅 4~17/255），
    // 原始值进 ACES 后几乎不可见。提高倍率让背景星云层次显现，
    // 亮点（吸附在吸积盘上的星云亮斑）则提得更高形成星点。
    color += texture(galaxy, dir).rgb * 5.0 * alpha;
    return color;
  }

  ///----
  /// Narkowicz 2015, "ACES Filmic Tone Mapping Curve"
  ///（与原项目 tonemapping.frag 一致，输出线性 LDR，由 renderer 做 sRGB 编码完成 gamma）
  vec3 aces(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }
  ///----

  void main() {
    mat3 view;

    vec3 cameraPos;
    if (mouseControl > 0.5) {
      vec2 mouse = clamp(vec2(mouseX, mouseY) / resolution.xy, 0.0, 1.0) - 0.5;
      cameraPos = vec3(-cos(mouse.x * 10.0) * 15.0, mouse.y * 30.0,
                       sin(mouse.x * 10.0) * 15.0);

    } else if (frontView > 0.5) {
      cameraPos = vec3(10.0, 1.0, 10.0);
    } else if (topView > 0.5) {
      cameraPos = vec3(15.0, 15.0, 0.0);
    } else {
      cameraPos = vec3(-cos(time * 0.1) * 15.0, sin(time * 0.1) * 15.0,
                       sin(time * 0.1) * 15.0);
    }

    vec3 target = vec3(0.0, 0.0, 0.0);
    view = lookAt(cameraPos, target, radians(cameraRoll));

    vec2 uv = gl_FragCoord.xy / resolution.xy - vec2(0.5);
    uv.x *= resolution.x / resolution.y;

    vec3 dir = normalize(vec3(-uv.x * fovScale, uv.y * fovScale, 1.0));
    vec3 pos = cameraPos;
    dir = view * dir;

    vec3 color = traceColor(pos, dir);
    // ACES Filmic tonemapping：把线性 HDR 压缩到 [0,1] LDR，
    // 避免吸积盘亮区过曝、星云暗背景被后续 sRGB 编码提亮成灰
    color = aces(color);
    // === 鲜艳度增强 ===
    // ACES 曲线会压低暗部并略微降饱和，这里补回：轻微曝光 + 饱和度提升，
    // 让吸积盘的橙金、星云的蓝紫更浓烈
    color *= 1.12;
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, 1.4);
    fragColor.rgb = clamp(color, 0.0, 1.0);
    fragColor.a = 1.0;
  }
`;

/** 黑洞顶点着色器（GLSL3，全屏三角形带 UV） */
const BLACKHOLE_VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

interface BlackholeSceneProps {
  /** 鼠标归一化坐标 ref（0~1，相对窗口），驱动相机轨道（mouseControl 模式） */
  mouseRef?: React.MutableRefObject<{ x: number; y: number }>;
  /** 是否启用鼠标控制（默认 true，鼠标移动时接管相机；静止后平滑退回自动轨道） */
  mouseControl?: boolean;
  /** 吸积盘亮度倍率（默认 0.25，随详情页滚动可增强） */
  adiskLit?: number;
  /** 滚动缩放进度 ref（0~1），滚动时平滑拉近镜头（fovScale 缩小 → 画面放大） */
  zoomProgressRef?: React.MutableRefObject<number>;
}

/**
 * BlackholeScene — Three.js 移植的实时黑洞渲染器
 *
 * 功能：
 *  - 全屏四边形 + GLSL3 ShaderMaterial 执行 300 步光线步进黑洞渲染
 *  - 加载立方体星云天空盒（galaxy）与吸积盘颜色贴图（colorMap）
 *  - 鼠标控制：移动鼠标时相机沿大圆弧轨道跟随（mouseControl 平滑插值）
 *  - 静止时自动恢复时间驱动的轨道绕飞，保证画面持续有动态
 *  - 每帧更新 time / resolution / mouse / 各渲染参数 uniform
 *
 * 参数：
 *  - mouseRef       外部鼠标归一化坐标 ref（可选，不传则内部自行监听）
 *  - mouseControl   是否启用鼠标控制（默认 true）
 *  - adiskLit       吸积盘亮度倍率
 *
 * 返回值：React.ReactElement（R3F 场景内容，需放入 <Canvas>）
 *
 * 异常：纹理加载失败时 useLoader 抛出，由外层 Suspense 兜底
 *
 * 注意事项：
 *  - 必须使用 WebGL2 上下文（GLSL3 着色器）
 *  - 300 步步进对低端 GPU 压力大，外层 Canvas 应设 dpr≤0.75 保证流畅
 *  - 黑洞事件视界为纯黑，与项目深色背景融合良好
 */
export function BlackholeScene({
  mouseRef,
  mouseControl = true,
  adiskLit = 0.25,
  zoomProgressRef,
}: BlackholeSceneProps) {
  const { size, gl } = useThree();
  // 内部鼠标位置（像素坐标，shader 直接用它除以 resolution）
  const pixelMouseRef = useRef({ x: 0, y: 0 });
  // 鼠标移动时间戳（用于判断是否静止 → 平滑切回自动轨道）
  const lastMoveRef = useRef(-10);
  // mouseControl uniform 平滑值（0 自动轨道 / 1 鼠标控制）
  const controlSmoothRef = useRef(0);

  // 加载立方体星云天空盒（顺序：px,nx,py,ny,pz,nz = right,left,top,bottom,front,back）
  // 与吸积盘颜色贴图：用 loader.load() 同步返回纹理对象（图片异步上传，
  // 数据就绪后 Three.js 自动上传 GPU），避免 useLoader 的泛型推断问题。
  // 注意：colorSpace 保持 LinearSRGBColorSpace（默认）——与原项目 stb_image
  // 加载贴图直接当线性值用一致。若设 SRGBColorSpace，GPU 会做 sRGB→线性解码，
  // 暗部像素（星云 0.1）被压到线性 0.006，导致背景几乎全黑。
  const { galaxy, colorMap } = useMemo(() => {
    const cubeLoader = new THREE.CubeTextureLoader();
    const galaxyTex = cubeLoader.load([
      '/asset/textures/blackhole/skybox_nebula_dark/right.png',
      '/asset/textures/blackhole/skybox_nebula_dark/left.png',
      '/asset/textures/blackhole/skybox_nebula_dark/top.png',
      '/asset/textures/blackhole/skybox_nebula_dark/bottom.png',
      '/asset/textures/blackhole/skybox_nebula_dark/front.png',
      '/asset/textures/blackhole/skybox_nebula_dark/back.png',
    ]);
    const mapTex = new THREE.TextureLoader().load(
      '/asset/textures/blackhole/color_map.png'
    );
    return { galaxy: galaxyTex, colorMap: mapTex };
  }, []);

  // 材质：fullscreen quad + 黑洞 shader
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: BLACKHOLE_VERT,
        fragmentShader: BLACKHOLE_FRAG,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          resolution: { value: new THREE.Vector2(1, 1) },
          mouseX: { value: 0 },
          mouseY: { value: 0 },
          time: { value: 0 },
          galaxy: { value: galaxy },
          colorMap: { value: colorMap },
          frontView: { value: 0 },
          topView: { value: 0 },
          cameraRoll: { value: 0 },
          gravatationalLensing: { value: 1 },
          renderBlackHole: { value: 1 },
          mouseControl: { value: 0 },
          fovScale: { value: 1.0 },
          adiskEnabled: { value: 1 },
          adiskParticle: { value: 1 },
          adiskHeight: { value: 0.55 },
          adiskLit: { value: adiskLit },
          adiskDensityV: { value: 2.0 },
          adiskDensityH: { value: 4.0 },
          adiskNoiseScale: { value: 0.8 },
          adiskNoiseLOD: { value: 5.0 },
          adiskSpeed: { value: 0.5 },
        },
      }),
    [galaxy, colorMap, adiskLit]
  );

  // 鼠标监听：更新像素坐标与移动时间戳
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pixelMouseRef.current.x = e.clientX;
      pixelMouseRef.current.y = e.clientY;
      lastMoveRef.current = performance.now();
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // 每帧更新 uniforms
  useFrame(({ clock }) => {
    const mat = material;
    const u = mat.uniforms;
    u.time.value = clock.getElapsedTime();

    // === 关键：resolution 必须用 drawing buffer 物理像素尺寸 ===
    // gl_FragCoord 是设备像素（= CSS 尺寸 × dpr），若用 CSS 尺寸（size.width）
    // 作 divisor，UV 中心会偏移（dpr≠1 时黑洞不在画面正中）。
    // canvas 的 width/height 即 drawing buffer 尺寸，与 gl_FragCoord 完全一致。
    const dw = gl.domElement.width || Math.max(size.width, 1);
    const dh = gl.domElement.height || Math.max(size.height, 1);
    u.resolution.value.set(dw, dh);

    // 鼠标控制平滑插值：有鼠标移动 → 平滑切到 1；静止 2.5s 后平滑退回 0（自动轨道）
    const target = mouseControl && performance.now() - lastMoveRef.current < 2500 ? 1 : 0;
    controlSmoothRef.current = THREE.MathUtils.lerp(controlSmoothRef.current, target, 0.04);
    u.mouseControl.value = controlSmoothRef.current;

    // 鼠标坐标（统一转成 drawing buffer 物理像素，shader 内 mouse/resolution 即 0~1）
    if (mouseRef) {
      // mouseRef 为 -1~1 归一化（屏幕中心 = 0）：映射回 0~1 再乘物理分辨率
      u.mouseX.value = ((mouseRef.current.x + 1) / 2) * dw;
      u.mouseY.value = ((mouseRef.current.y + 1) / 2) * dh;
    } else {
      // 内部监听：clientX/clientY 为 CSS 像素，按窗口比例映射到物理分辨率
      u.mouseX.value = (pixelMouseRef.current.x / Math.max(window.innerWidth, 1)) * dw;
      u.mouseY.value = (pixelMouseRef.current.y / Math.max(window.innerHeight, 1)) * dh;
    }

    // 滚动缩放：progress 0→1 时 fovScale 从 1 平滑缩到 0.4（画面拉近约 2.5 倍），
    // 模拟"向黑洞坠落"的推进感
    if (zoomProgressRef) {
      const zoom = Math.max(0, Math.min(1, zoomProgressRef.current));
      u.fovScale.value = THREE.MathUtils.lerp(u.fovScale.value, 1.0 - 0.6 * zoom, 0.06);
    }
  });

  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
