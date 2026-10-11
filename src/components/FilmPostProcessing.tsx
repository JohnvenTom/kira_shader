import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * 胶片后处理 —— shader.se 1:1 复刻版
 *
 * 来源：shader.se 线上 bundle 反编译（RenderPipeline b / MipMapBlurNode A$ /
 * ChromaticAberrationNode2 AZ / filmGrain / ApplySaturation / 闪烁公式）
 *
 * 管线（与原版同序）：
 *   场景 → sceneRT
 *   → Bloom(MipMapBlur 7 级 mip 链，亮度阈值预滤 + emulateInputMip1，
 *          ×强度 clamp 1，与原图 screen 混合 + 暖橙 10% 罩染) → bloomRT
 *   → 动态模糊(帧率无关 ping-pong mix) → motionRT
 *   → FilmShader: pow → sepia → 亮度 → 对比度 → 饱和度 → 垂直色差
 *      → 高斯颗粒 → 暗角
 *   → 体积雾(本站自有，原站无；默认参数关闭)
 *
 * 架构说明：bloom 与 motion blur 在 composer 外用独立 RT 链执行
 * （bloom 需要自有 mip 链；motion 的 tPrevious 若挂在 composer 的
 *  ping-pong 缓冲上会构成 WebGL 反馈环 —— 读写的同一个 RT，draw 被拒绝）。
 */

export interface FilmFXParams {
  bloomIntensity: number;
  bloomThreshold: number;
  bloomRadius: number;
  bloomSmoothing: number;
  pow: number;
  sepiaIntensity: number;
  brightness: number;
  contrast: number;
  /** 饱和度（REC709 亮度轴 mix，原版 compose 层参数） */
  saturation: number;
  chromaticAbberationStrength: number;
  lensDistortion: number;
  lensDistortionBorder: number;
  motionBlur: number;
  vignetteIntensity: number;
  vignetteRadius: number;
  vignetteSmoothness: number;
  noiseIntensity: number;
  noiseVelocity: number;
  /** 体积雾密度（0~1.5，越大雾越浓） */
  fogDensity: number;
  /** 体积雾最大不透明度（0~1，0 = 完全关闭雾效果） */
  fogOpacity: number;
}

/**
 * 默认参数 = shader.se pagesConfig 的 projects section 原值
 * （胶片卷所在 section 的线上观感来源）
 */
export const DEFAULT_FILM_PARAMS: FilmFXParams = {
  bloomIntensity: 0.77,
  bloomThreshold: 0.62,
  bloomRadius: 0.8,
  bloomSmoothing: 0.2,
  pow: 1.36,
  sepiaIntensity: 0.28,
  brightness: 1.08,
  contrast: 0.98,
  saturation: 0.92,
  chromaticAbberationStrength: 1.0,
  lensDistortion: 0.16,
  lensDistortionBorder: 1.0,
  motionBlur: 0.4,
  vignetteIntensity: 0.0,
  vignetteRadius: 0.0,
  vignetteSmoothness: 0.32,
  // 颗粒强度：shader.se projects 原值 0.87 是按其亮场景调的；
  // 原公式颗粒 ∝ (1-亮度)，在本站的深色胶片页暗部会被提亮 40%+
  // 糊成雪花。取旧版调好的 0.2（观感：细腻胶片颗粒、内容可读）。
  noiseIntensity: 0.2,
  noiseVelocity: 1.0,
  // 体积雾是本站自有功能（shader.se 无）；胶片页默认关闭，
  // 需要时把 fogOpacity 调回 0~1
  fogDensity: 0.22,
  fogOpacity: 0.0,
};

/* =========================================================================
 * MipMapBloomPass — shader.se 的 MipMapBlurNode A$ 逐行移植
 * ========================================================================= */
const BLOOM_LEVELS = 7;

const BloomQuadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BloomDown0Shader = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uSrcResolution;
  uniform float uThreshold;
  uniform float uSmoothing;
  varying vec2 vUv;
  vec3 prefilter(vec3 c) {
    float l = dot(c, vec3(0.2125, 0.7154, 0.0721));
    float s = smoothstep(uThreshold, uThreshold + uSmoothing, l);
    return c * s;
  }
  vec3 rowMix(vec3 r0, vec3 r1, vec3 r2, float e, float rx) {
    return mix(mix(r0, r1, e), mix(r1, r2, e), rx);
  }
  vec3 g9(vec3 h0, vec3 h1, vec3 h2, vec3 h3, vec3 h4, vec3 h5,
          vec3 h6, vec3 h7, vec3 h8, float fx, float fy, vec2 fr) {
    vec3 i0 = rowMix(h0, h1, h2, fx, fr.x);
    vec3 i1 = rowMix(h3, h4, h5, fx, fr.x);
    vec3 i2 = rowMix(h6, h7, h8, fx, fr.x);
    return mix(mix(i0, i1, fy), mix(i1, i2, fy), fr.y);
  }
  void main() {
    // emulateInputMip1：3×3 角点双线性模拟无 mip 纹理的 mip1 采样（原版 s()）
    vec2 texel = 1.0 / uSrcResolution;
    vec2 t = floor(uSrcResolution * 0.5);
    vec2 rmax = t - 1.0;
    vec2 halfTexel = texel * 0.5;
    vec2 s = (vUv - halfTexel) * t - 0.5;
    vec2 o = (vUv + halfTexel) * t - 0.5;
    vec2 ls = floor(s);
    vec2 lo = floor(o);
    vec2 A2 = s - ls;
    vec2 C2 = o - lo;
    vec2 D2 = lo - ls;
    vec3 h00 = prefilter(texture2D(tSrc, (clamp(ls + vec2(0.0, 0.0), vec2(0.0), rmax) + 0.5) / t).rgb);
    vec3 h01 = prefilter(texture2D(tSrc, (clamp(ls + vec2(1.0, 0.0), vec2(0.0), rmax) + 0.5) / t).rgb);
    vec3 h02 = prefilter(texture2D(tSrc, (clamp(ls + vec2(2.0, 0.0), vec2(0.0), rmax) + 0.5) / t).rgb);
    vec3 h10 = prefilter(texture2D(tSrc, (clamp(ls + vec2(0.0, 1.0), vec2(0.0), rmax) + 0.5) / t).rgb);
    vec3 h11 = prefilter(texture2D(tSrc, (clamp(ls + vec2(1.0, 1.0), vec2(0.0), rmax) + 0.5) / t).rgb);
    vec3 h12 = prefilter(texture2D(tSrc, (clamp(ls + vec2(2.0, 1.0), vec2(0.0), rmax) + 0.5) / t).rgb);
    vec3 h20 = prefilter(texture2D(tSrc, (clamp(ls + vec2(0.0, 2.0), vec2(0.0), rmax) + 0.5) / t).rgb);
    vec3 h21 = prefilter(texture2D(tSrc, (clamp(ls + vec2(1.0, 2.0), vec2(0.0), rmax) + 0.5) / t).rgb);
    vec3 h22 = prefilter(texture2D(tSrc, (clamp(ls + vec2(2.0, 2.0), vec2(0.0), rmax) + 0.5) / t).rgb);
    vec3 tl = g9(h00, h01, h02, h10, h11, h12, h20, h21, h22, 0.0, D2.y, vec2(A2.x, C2.y));
    vec3 tr = g9(h00, h01, h02, h10, h11, h12, h20, h21, h22, D2.x, D2.y, vec2(C2.x, C2.y));
    vec3 bl = g9(h00, h01, h02, h10, h11, h12, h20, h21, h22, 0.0, 0.0, vec2(A2.x, A2.y));
    vec3 br = g9(h00, h01, h02, h10, h11, h12, h20, h21, h22, D2.x, 0.0, vec2(C2.x, A2.y));
    gl_FragColor = vec4((tl + tr + bl + br) * 0.25, 1.0);
  }
`;

const BloomDownShader = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexelSize;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexelSize * 0.5;
    vec3 c = texture2D(tSrc, vUv + o * vec2(-1.0, 1.0)).rgb
           + texture2D(tSrc, vUv + o * vec2(1.0, 1.0)).rgb
           + texture2D(tSrc, vUv + o * vec2(-1.0, -1.0)).rgb
           + texture2D(tSrc, vUv + o * vec2(1.0, -1.0)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }
`;

const BloomUpShader = /* glsl */ `
  uniform sampler2D tInput;
  uniform sampler2D tSupport;
  uniform vec2 uTexelSize;
  uniform float uRadius;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexelSize * 0.5;
    vec3 c = texture2D(tInput, vUv + o * vec2(-1.0, 1.0)).rgb
           + texture2D(tInput, vUv + o * vec2(1.0, 1.0)).rgb
           + texture2D(tInput, vUv + o * vec2(-1.0, -1.0)).rgb
           + texture2D(tInput, vUv + o * vec2(1.0, -1.0)).rgb;
    gl_FragColor = vec4(mix(texture2D(tSupport, vUv).rgb, c * 0.25, uRadius), 1.0);
  }
`;

const BloomCompositeShader = /* glsl */ `
  uniform sampler2D tBase;
  uniform sampler2D tBloom;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    vec4 base = texture2D(tBase, vUv);
    vec3 bloom = texture2D(tBloom, vUv).rgb * uIntensity;
    vec3 p = min(bloom, vec3(1.0));
    // screen 混合 + 暖橙罩染（原版 m = blendScreen(p,h) + p·vec3(1,.8,0)·.1）
    vec3 screenBlend = 1.0 - (1.0 - p) * (1.0 - base.rgb);
    gl_FragColor = vec4(screenBlend + p * vec3(1.0, 0.8, 0.0) * 0.1, base.a);
  }
`;

class MipMapBloomPass {
  private downRTs: THREE.WebGLRenderTarget[] = [];
  private upRTs: THREE.WebGLRenderTarget[] = [];
  private down0Mat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private width = 1;
  private height = 1;

  constructor() {
    const mkRT = () => {
      const rt = new THREE.WebGLRenderTarget(1, 1, {
        depthBuffer: false,
        stencilBuffer: false,
        type: THREE.HalfFloatType,
      });
      rt.texture.generateMipmaps = false;
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      rt.texture.wrapS = THREE.ClampToEdgeWrapping;
      rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      return rt;
    };
    for (let i = 0; i < BLOOM_LEVELS; i++) this.downRTs.push(mkRT());
    this.upRTs.push(mkRT());
    for (let i = 1; i < BLOOM_LEVELS - 1; i++) this.upRTs.push(mkRT());

    this.down0Mat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null },
        uSrcResolution: { value: new THREE.Vector2(1, 1) },
        uThreshold: { value: 0.6 },
        uSmoothing: { value: 0.2 },
      },
      vertexShader: BloomQuadVertex,
      fragmentShader: BloomDown0Shader,
      depthTest: false,
      depthWrite: false,
    });
    this.downMat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: BloomQuadVertex,
      fragmentShader: BloomDownShader,
      depthTest: false,
      depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      uniforms: {
        tInput: { value: null },
        tSupport: { value: null },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: 0.85 },
      },
      vertexShader: BloomQuadVertex,
      fragmentShader: BloomUpShader,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tBase: { value: null },
        tBloom: { value: null },
        uIntensity: { value: 1 },
      },
      vertexShader: BloomQuadVertex,
      fragmentShader: BloomCompositeShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.down0Mat);
  }

  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    let w = this.width;
    let h = this.height;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      w = Math.round(w * 0.5);
      h = Math.round(h * 0.5);
      this.downRTs[i].setSize(Math.max(1, w), Math.max(1, h));
      if (i < this.upRTs.length) this.upRTs[i].setSize(Math.max(1, w), Math.max(1, h));
    }
  }

  setParams(threshold: number, smoothing: number, radius: number, intensity: number) {
    this.down0Mat.uniforms.uThreshold.value = threshold;
    this.down0Mat.uniforms.uSmoothing.value = smoothing;
    this.upMat.uniforms.uRadius.value = radius;
    this.compositeMat.uniforms.uIntensity.value = intensity;
  }

  dispose() {
    this.downRTs.forEach((rt) => rt.dispose());
    this.upRTs.forEach((rt) => rt.dispose());
    this.down0Mat.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
    this.compositeMat.dispose();
    this.quad.dispose();
  }

  render(
    gl: THREE.WebGLRenderer,
    base: THREE.Texture,
    target: THREE.WebGLRenderTarget | null
  ) {
    this.down0Mat.uniforms.tSrc.value = base;
    (this.down0Mat.uniforms.uSrcResolution.value as THREE.Vector2).set(this.width, this.height);
    gl.setRenderTarget(this.downRTs[0]);
    this.quad.material = this.down0Mat;
    this.quad.render(gl);

    for (let i = 1; i < BLOOM_LEVELS; i++) {
      const src = this.downRTs[i - 1];
      this.downMat.uniforms.tSrc.value = src.texture;
      (this.downMat.uniforms.uTexelSize.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      gl.setRenderTarget(this.downRTs[i]);
      this.quad.material = this.downMat;
      this.quad.render(gl);
    }

    let u = this.downRTs[BLOOM_LEVELS - 1];
    for (let i = this.upRTs.length - 1; i >= 0; i--) {
      const rt = this.upRTs[i];
      this.upMat.uniforms.tInput.value = u.texture;
      (this.upMat.uniforms.uTexelSize.value as THREE.Vector2).set(1 / u.width, 1 / u.height);
      this.upMat.uniforms.tSupport.value = this.downRTs[i].texture;
      gl.setRenderTarget(rt);
      this.quad.material = this.upMat;
      this.quad.render(gl);
      u = rt;
    }

    this.compositeMat.uniforms.tBase.value = base;
    this.compositeMat.uniforms.tBloom.value = this.upRTs[0].texture;
    gl.setRenderTarget(target);
    this.quad.material = this.compositeMat;
    this.quad.render(gl);
    gl.setRenderTarget(null);
  }
}

/* =========================================================================
 * 体积雾（本站自有，保持不变）
 * ========================================================================= */
const FOG_DRIFT_SPEED = 0.8;
const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const VEL_SIM_SIZE = 256;
const VEL_SIGMA = 0.032;
const VEL_SPLAT_GAIN = 23.0;
const VEL_MAX_SUBSTEPS = 24;

const FluidAdvShader = {
  uniforms: {
    tPrev: { value: null as THREE.Texture | null },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uMouseDelta: { value: new THREE.Vector2(0, 0) },
    uDt: { value: 0.016 },
    uDiss: { value: 0.85 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tPrev;
    uniform vec2 uMouse;
    uniform vec2 uMouseDelta;
    uniform float uDt;
    uniform float uDiss;
    uniform float uAspect;
    varying vec2 vUv;
    void main() {
      vec2 vel = texture2D(tPrev, vUv).xy;
      vec2 coord = clamp(vUv - vel * uDt, vec2(0.0), vec2(1.0));
      vec2 adv = texture2D(tPrev, coord).xy;
      adv *= exp(-uDiss * uDt);
      vec2 d = vUv - uMouse;
      d.x *= uAspect;
      float g = exp(-dot(d, d) / (2.0 * ${VEL_SIGMA.toFixed(3)} * ${VEL_SIGMA.toFixed(3)}));
      adv += uMouseDelta * g * ${VEL_SPLAT_GAIN.toFixed(1)};
      adv = clamp(adv, vec2(-3.5), vec2(3.5));
      gl_FragColor = vec4(adv, 0.0, 1.0);
    }
  `,
};

const VolumetricFogShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uProjInv: { value: new THREE.Matrix4() },
    uViewInv: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0.55, 0.52, 0.47) },
    uDensity: { value: 0.22 },
    uNoiseScale: { value: 0.35 },
    uDrift: { value: REDUCED_MOTION ? 0 : FOG_DRIFT_SPEED },
    uMaxDist: { value: 26.0 },
    uMaxOpacity: { value: 0.45 },
    uLightDir: { value: new THREE.Vector3(-0.45, 0.7, 0.35).normalize() },
    uSteps: { value: 12 },
    tVel: { value: null as THREE.Texture | null },
    uVP: { value: new THREE.Matrix4() },
    uVelStrength: { value: 2.2 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform mat4 uProjInv;
    uniform mat4 uViewInv;
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uDensity;
    uniform float uNoiseScale;
    uniform float uDrift;
    uniform float uMaxDist;
    uniform float uMaxOpacity;
    uniform vec3 uLightDir;
    uniform float uSteps;
    uniform sampler2D tVel;
    uniform mat4 uVP;
    uniform float uVelStrength;
    varying vec2 vUv;

    float hash13(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }
    float vnoise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash13(i);
      float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
      float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
      float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
      float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
      float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
      float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
      float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
      return mix(
        mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
        mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
        f.z
      );
    }
    float fbm(vec3 p) {
      return vnoise(p) * 0.8 + vnoise(p * 2.3) * 0.2;
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).x;

      vec4 cn = uProjInv * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
      vec3 vNear = cn.xyz / cn.w;
      vec4 cf = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec3 vFar = cf.xyz / cf.w;
      vec3 dirView = normalize(vFar - vNear);

      vec3 camWorld = (uViewInv * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 dirWorld = normalize((uViewInv * vec4(dirView, 0.0)).xyz);

      float dist = (depth >= 0.9999) ? uMaxDist : length(vFar);

      float stepLen = dist / uSteps;
      float densityScale = max(0.05, stepLen) * uDensity;
      float phase = 0.55 + 0.45 * max(0.0, dot(dirWorld, -uLightDir));

      float acc = 0.0;
      float wsum = 0.0;
      for (int i = 0; i < 12; i++) {
        if (float(i) >= uSteps) break;
        float t = (float(i) + 0.5) * stepLen;
        vec3 wp = camWorld + dirWorld * t;
        vec4 clipPos = uVP * vec4(wp, 1.0);
        vec2 suv = clipPos.xy / clipPos.w * 0.5 + 0.5;
        vec2 flow = texture2D(tVel, clamp(suv, vec2(0.0), vec2(1.0))).xy;
        vec3 np = wp * uNoiseScale
          + vec3(uTime * uDrift, uTime * uDrift * 0.35, -uTime * uDrift * 0.6)
          + vec3(flow * uVelStrength, 0.0);
        float w = smoothstep(0.6, 2.2, t);
        float n = smoothstep(0.44, 0.98, fbm(np));
        acc += n * w;
        wsum += w;
      }
      float fog = 1.0 - exp(-acc * densityScale * 3.0);
      fog = clamp(fog, 0.0, 1.0) * uMaxOpacity;

      float nAvg = wsum > 0.001 ? acc / wsum : 0.0;
      vec3 fogLit = uFogColor * (0.55 + 0.85 * phase) * (0.3 + 1.05 * nAvg);
      gl_FragColor = vec4(mix(base.rgb, fogLit, fog), base.a);
    }
  `,
};

/**
 * FilmShader —— shader.se 调色链 1:1（顺序与数学全部按原版）
 *
 * 顺序：桶形畸变(Aj: k=1+d·r³ + 缩放/偏移) → 采样
 *      → pow → sepia → 亮度 → 对比度 → 饱和度
 *      → 垂直色差(AZ: 0.001·dist·2·strength，对已调色图采样，
 *         偏移采样同样过整条调色链 —— 原版 CA 在调色后的 RTT 上)
 *      → 高斯颗粒(σ=0.49, 仅暗部提亮) → 暗角
 */
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uLensDistortion: { value: 0.16 },
    uLensDistortionBorder: { value: 1.0 },
    uChromaticAberration: { value: 1.0 },
    uAspect: { value: 1.0 },
    uPow: { value: 1.36 },
    uSepiaIntensity: { value: 0.28 },
    uBrightness: { value: 1.08 },
    uContrast: { value: 0.98 },
    uSaturation: { value: 0.92 },
    uNoiseIntensity: { value: 0.87 },
    uNoiseVelocity: { value: 1.0 },
    uTime: { value: 0.0 },
    uVignetteIntensity: { value: 0.0 },
    uVignetteRadius: { value: 0.0 },
    uVignetteSmoothness: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uLensDistortion;
    uniform float uLensDistortionBorder;
    uniform float uChromaticAberration;
    uniform float uAspect;
    uniform float uPow;
    uniform float uSepiaIntensity;
    uniform float uBrightness;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uNoiseIntensity;
    uniform float uNoiseVelocity;
    uniform float uTime;
    uniform float uVignetteIntensity;
    uniform float uVignetteRadius;
    uniform float uVignetteSmoothness;
    varying vec2 vUv;

    vec2 radialDistort(vec2 e, float distortion) {
      vec2 i = e - 0.5;
      float n = i.x * i.x + i.y * i.y;
      float a = 1.0 + n * (distortion * pow(n, 0.5));
      return vec2(i.x * a, i.y * a) + 0.5;
    }

    vec2 barrelDistort(vec2 uv, float distortion, float border) {
      float n = mix(0.3655, 0.0, border);
      float scale = 1.0 - distortion * n;
      vec2 offset = vec2(distortion * n * 0.5);
      return scale * radialDistort(uv, distortion) + offset;
    }

    float gauss(float x, float mean, float sigma) {
      float d = x - mean;
      return exp(-d * d / (2.0 * sigma * sigma)) / (sigma * 2.50662827463);
    }

    /** 调色链（pow→sepia→亮度→对比→饱和），CA 的偏移采样共用 */
    vec3 grade(vec3 c) {
      c = pow(max(c, vec3(0.0)), vec3(uPow));
      float sr = dot(c, vec3(0.393, 0.769, 0.189));
      float sg = dot(c, vec3(0.349, 0.686, 0.168));
      float sb = dot(c, vec3(0.272, 0.534, 0.131));
      c = mix(c, vec3(sr, sg, sb), uSepiaIntensity);
      c = clamp(c * uBrightness, 0.0, 1.0);
      c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      return mix(vec3(lum), c, uSaturation);
    }

    void main() {
      vec2 uv = vUv;

      vec2 distortedUV = barrelDistort(uv, uLensDistortion, uLensDistortionBorder);
      if (distortedUV.x < 0.0 || distortedUV.x > 1.0 ||
          distortedUV.y < 0.0 || distortedUV.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
      }

      vec4 base = texture2D(tDiffuse, distortedUV);
      if (base.a < 0.01) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
      }

      vec3 color = grade(base.rgb);

      // 垂直色差：偏移采样同样过调色链（原版在调色后的纹理上采样）
      vec2 asp = vec2(uAspect, 1.0) / max(uAspect, 1.0);
      float dist = length((uv - 0.5) * asp * 2.0);
      float caOffset = 0.001 * dist * 2.0 * uChromaticAberration;
      vec3 gradedDown = grade(texture2D(tDiffuse, distortedUV + vec2(0.0, -caOffset)).rgb);
      vec3 gradedUp = grade(texture2D(tDiffuse, distortedUV + vec2(0.0, caOffset)).rgb);
      vec3 shifted = vec3(gradedDown.r, color.g, gradedUp.b);
      float p = 0.005;
      float mx = min(smoothstep(0.0, p, uv.x), smoothstep(0.0, p, 1.0 - uv.x));
      float my = min(smoothstep(0.0, p, uv.y), smoothstep(0.0, p, 1.0 - uv.y));
      color = mix(color, shifted, mx * my);

      // 高斯颗粒（原版 filmGrain）
      float seed = uTime * uNoiseVelocity;
      float noiseHash = fract(
        sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453 + seed
      );
      float grain = gauss(noiseHash, 0.0, 0.7 * 0.7);
      color = color + vec3(grain) * (1.0 - color) * uNoiseIntensity;

      // 暗角（原版 compose 层同式）
      float vDist = uVignetteRadius - length(uv - 0.5);
      float vMask = smoothstep(-uVignetteSmoothness, uVignetteSmoothness, vDist);
      color = mix(color, clamp(color * vMask, 0.0, 1.0), uVignetteIntensity);

      gl_FragColor = vec4(color, base.a);
    }
  `,
};

/** Motion blur：帧率无关的 ping-pong mix（原版 A3） */
const MotionBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tPrevious: { value: null as THREE.Texture | null },
    uStrength: { value: 0.0 },
  },
  vertexShader: BloomQuadVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tPrevious;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 current = texture2D(tDiffuse, vUv);
      vec4 previous = texture2D(tPrevious, vUv);
      gl_FragColor = mix(current, previous, uStrength);
    }
  `,
};

export interface MousePathPoint {
  x: number;
  y: number;
  t: number;
}

interface FilmPostProcessingProps {
  params: FilmFXParams;
  enabled?: boolean;
  mouseRef?: React.MutableRefObject<{ x: number; y: number }>;
  mousePathRef?: React.MutableRefObject<MousePathPoint[]>;
  transparent?: boolean;
}

/**
 * 完整胶片后处理组件（shader.se 1:1 管线）
 */
export function FilmPostProcessing({ params, enabled = true, transparent = false, mouseRef, mousePathRef }: FilmPostProcessingProps) {
  const { gl, scene, camera, size } = useThree();
  // 全手动 quad 链（不走 EffectComposer/ShaderPass —— ShaderPass.render
  // 每帧会用 composer 的 readBuffer 覆盖外部传入的 tDiffuse，而本管线的
  // 场景在 composer 外部 RT 渲染，readBuffer 永远是空的 → 全屏黑）
  const filmQuadRef = useRef<FullScreenQuad | null>(null);
  const fogQuadRef = useRef<FullScreenQuad | null>(null);
  const depthTexRef = useRef<THREE.DepthTexture | null>(null);

  // 独立 RT 链
  const bloomRef = useRef<MipMapBloomPass | null>(null);
  const sceneRTRef = useRef<THREE.WebGLRenderTarget | null>(null);   // 场景（带深度）
  const bloomRTRef = useRef<THREE.WebGLRenderTarget | null>(null);   // bloom 合成
  const motionARTRef = useRef<THREE.WebGLRenderTarget | null>(null); // motion ping
  const motionBRTRef = useRef<THREE.WebGLRenderTarget | null>(null); // motion pong
  const filmRTRef = useRef<THREE.WebGLRenderTarget | null>(null);    // Film 调色输出
  const motionQuadRef = useRef<FullScreenQuad | null>(null);
  const renderPassRef = useRef<RenderPass | null>(null);

  const pathLastRef = useRef<MousePathPoint | null>(null);
  const velReadRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const velWriteRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const velQuadRef = useRef<FullScreenQuad | null>(null);
  const tmpVPRef = useRef(new THREE.Matrix4());

  // 流场模拟资源（体积雾交互，不变）
  useEffect(() => {
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(VEL_SIM_SIZE, VEL_SIM_SIZE, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      rt.texture.wrapS = THREE.ClampToEdgeWrapping;
      rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      return rt;
    };
    velReadRef.current = mk();
    velWriteRef.current = mk();
    velQuadRef.current = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(FluidAdvShader.uniforms),
        vertexShader: FluidAdvShader.vertexShader,
        fragmentShader: FluidAdvShader.fragmentShader,
        depthTest: false,
        depthWrite: false,
      })
    );
    return () => {
      velReadRef.current?.dispose();
      velWriteRef.current?.dispose();
      velQuadRef.current?.dispose();
      velReadRef.current = null;
      velWriteRef.current = null;
      velQuadRef.current = null;
    };
  }, []);

  useMemo(() => {
    try {
      const w = gl.domElement.width || 1;
      const h = gl.domElement.height || 1;
      const rtOpts = { depthBuffer: false, type: THREE.HalfFloatType } as const;

      // 场景 RT（带深度，雾 pass 读取）
      const depthTexture = new THREE.DepthTexture(w, h);
      depthTexture.type = THREE.UnsignedIntType;
      const sceneRT = new THREE.WebGLRenderTarget(w, h, {
        depthBuffer: true,
        depthTexture,
        type: THREE.HalfFloatType,
      });
      sceneRTRef.current = sceneRT;
      depthTexRef.current = depthTexture;

      bloomRTRef.current = new THREE.WebGLRenderTarget(w, h, rtOpts);
      motionARTRef.current = new THREE.WebGLRenderTarget(w, h, rtOpts);
      motionBRTRef.current = new THREE.WebGLRenderTarget(w, h, rtOpts);
      filmRTRef.current = new THREE.WebGLRenderTarget(w, h, rtOpts);

      bloomRef.current = new MipMapBloomPass();
      bloomRef.current.setSize(w, h);

      motionQuadRef.current = new FullScreenQuad(
        new THREE.ShaderMaterial({
          uniforms: THREE.UniformsUtils.clone(MotionBlurShader.uniforms),
          vertexShader: MotionBlurShader.vertexShader,
          fragmentShader: MotionBlurShader.fragmentShader,
          depthTest: false,
          depthWrite: false,
        })
      );

      renderPassRef.current = new RenderPass(scene, camera);

      // Film 调色 quad（畸变→pow→sepia→亮度→对比→饱和→色差→颗粒→暗角）
      filmQuadRef.current = new FullScreenQuad(
        new THREE.ShaderMaterial({
          uniforms: THREE.UniformsUtils.clone(FilmShader.uniforms),
          vertexShader: FilmShader.vertexShader,
          fragmentShader: FilmShader.fragmentShader,
          depthTest: false,
          depthWrite: false,
        })
      );

      // 体积雾 quad（链尾直绘屏幕：采样场景深度构成反馈环的唯一安全位置）
      if (!transparent) {
        fogQuadRef.current = new FullScreenQuad(
          new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.clone(VolumetricFogShader.uniforms),
            vertexShader: VolumetricFogShader.vertexShader,
            fragmentShader: VolumetricFogShader.fragmentShader,
            depthTest: false,
            depthWrite: false,
          })
        );
        (fogQuadRef.current.material as THREE.ShaderMaterial).uniforms.tDepth.value = depthTexture;
      }
    } catch (err) {
      console.error('[FilmPostProcessing] init ERROR:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, transparent]);

  // 同步 size（设备像素）
  useEffect(() => {
    const pr = gl.getPixelRatio();
    const effW = Math.max(1, Math.floor(size.width * pr));
    const effH = Math.max(1, Math.floor(size.height * pr));
    if (depthTexRef.current) {
      depthTexRef.current.image.width = effW;
      depthTexRef.current.image.height = effH;
      depthTexRef.current.dispose();
    }
    sceneRTRef.current?.setSize(effW, effH);
    bloomRTRef.current?.setSize(effW, effH);
    motionARTRef.current?.setSize(effW, effH);
    motionBRTRef.current?.setSize(effW, effH);
    filmRTRef.current?.setSize(effW, effH);
    bloomRef.current?.setSize(effW, effH);
    if (filmQuadRef.current) {
      ((filmQuadRef.current.material as THREE.ShaderMaterial).uniforms.uAspect.value as number) =
        size.width / size.height;
    }
  }, [size, gl]);

  // 同步 params
  useEffect(() => {
    if (!filmQuadRef.current) return;
    const u = (filmQuadRef.current.material as THREE.ShaderMaterial).uniforms;
    u.uLensDistortion.value = params.lensDistortion;
    u.uLensDistortionBorder.value = params.lensDistortionBorder;
    u.uChromaticAberration.value = params.chromaticAbberationStrength;
    u.uPow.value = params.pow;
    u.uSepiaIntensity.value = params.sepiaIntensity;
    u.uBrightness.value = params.brightness;
    u.uContrast.value = params.contrast;
    u.uSaturation.value = params.saturation;
    u.uNoiseIntensity.value = params.noiseIntensity;
    u.uNoiseVelocity.value = params.noiseVelocity;
    u.uVignetteIntensity.value = params.vignetteIntensity;
    u.uVignetteRadius.value = params.vignetteRadius;
    u.uVignetteSmoothness.value = params.vignetteSmoothness;

    if (fogQuadRef.current) {
      const fu = (fogQuadRef.current.material as THREE.ShaderMaterial).uniforms;
      fu.uDensity.value = params.fogDensity;
      fu.uMaxOpacity.value = params.fogOpacity;
    }
  }, [params]);

  // 卸载释放
  useEffect(() => {
    return () => {
      sceneRTRef.current?.dispose();
      bloomRTRef.current?.dispose();
      motionARTRef.current?.dispose();
      motionBRTRef.current?.dispose();
      filmRTRef.current?.dispose();
      bloomRef.current?.dispose();
      motionQuadRef.current?.dispose();
      filmQuadRef.current?.dispose();
      fogQuadRef.current?.dispose();
      renderPassRef.current?.dispose?.();
      bloomRef.current = null;
      depthTexRef.current = null;
      sceneRTRef.current = null;
      bloomRTRef.current = null;
      motionARTRef.current = null;
      motionBRTRef.current = null;
      filmRTRef.current = null;
      motionQuadRef.current = null;
      filmQuadRef.current = null;
      fogQuadRef.current = null;
      renderPassRef.current = null;
    };
  }, []);

  useFrame((state, delta) => {
    if (!enabled || !renderPassRef.current || !sceneRTRef.current || !filmQuadRef.current) {
      return;
    }
    const sceneRT = sceneRTRef.current;
    const bloomRT = bloomRTRef.current!;
    const motionA = motionARTRef.current!;
    const motionB = motionBRTRef.current!;
    const time = state.clock.elapsedTime;

    // 1. 场景 → sceneRT
    renderPassRef.current.render(gl, sceneRT, sceneRT, delta, false);

    // 2. bloom mip 链 + screen 合成
    //    闪烁（原版原式）：3 sin 波 × 0.03，强度 = 1.5·base + flicker
    const base = params.bloomIntensity;
    const flicker =
      (Math.sin(5.3 * time * 0.5) +
        Math.sin(11.7 * time * 0.5 + 2.4 * Math.sin(2.1 * time * 0.5) * 0.5) +
        Math.sin(23.9 * time * 0.5 + 1.3 * Math.cos(7.1 * time * 0.5) * 0.5)) *
      0.03 * base;
    if (bloomRef.current && !transparent) {
      bloomRef.current.setParams(
        params.bloomThreshold,
        params.bloomSmoothing,
        params.bloomRadius,
        Math.max(0, 1.5 * base + flicker)
      );
      bloomRef.current.render(gl, sceneRT.texture, bloomRT);
    }

    // 3. motion blur（ping-pong，帧率无关 strength）
    //    inputPass 的源纹理：透明模式直用 bloom 输出（屏幕）或场景
    let srcTex: THREE.Texture;
    if (transparent || !motionQuadRef.current) {
      srcTex = sceneRT.texture;
    } else {
      const mq = motionQuadRef.current.material as THREE.ShaderMaterial;
      let strength = 0;
      if (params.motionBlur > 0) {
        const targetDt = 1 / 120;
        let adjusted: number;
        if (delta > targetDt) {
          adjusted = params.motionBlur * (targetDt / delta);
        } else {
          adjusted = Math.pow(params.motionBlur, delta / targetDt);
        }
        strength = Math.min(1, 1.3 * adjusted);
      }
      mq.uniforms.uStrength.value = strength;
      mq.uniforms.tDiffuse.value = bloomRT.texture;
      mq.uniforms.tPrevious.value = motionA.texture;
      gl.setRenderTarget(motionB);
      motionQuadRef.current.render(gl);
      // ping-pong：motionB 是本帧结果，下一帧作为 previous
      const t = motionARTRef.current!;
      motionARTRef.current = motionBRTRef.current!;
      motionBRTRef.current = t;
      srcTex = motionARTRef.current.texture;
    }

    // 4. Film 调色 quad：srcTex → filmRT（有雾时）或直绘屏幕
    const filmMat = filmQuadRef.current.material as THREE.ShaderMaterial;
    filmMat.uniforms.tDiffuse.value = srcTex;
    filmMat.uniforms.uTime.value = time;

    // 5. 鼠标流场（体积雾交互，不变）
    if (velQuadRef.current && velReadRef.current && velWriteRef.current) {
      const dt = Math.min(Math.max(delta, 0.001), 0.05);
      const vu = (velQuadRef.current.material as THREE.ShaderMaterial).uniforms;
      const aspect = size.width / Math.max(1, size.height);
      vu.uAspect.value = aspect;

      const q = mousePathRef ? mousePathRef.current : null;
      const pts: MousePathPoint[] = [];
      if (q && q.length > 0) {
        if (pathLastRef.current) pts.push(pathLastRef.current);
        for (let i = 0; i < q.length; i++) pts.push(q[i]);
        q.length = 0;
        pathLastRef.current = pts[pts.length - 1];
      }

      const stepSim = (mux: number, muy: number, dx: number, dy: number, subDt: number) => {
        vu.uMouse.value.set(mux, muy);
        vu.uMouseDelta.value.set(dx, dy);
        vu.uDt.value = subDt;
        vu.tPrev.value = velReadRef.current!.texture;
        gl.setRenderTarget(velWriteRef.current!);
        velQuadRef.current!.render(gl);
        const t = velReadRef.current!;
        velReadRef.current = velWriteRef.current!;
        velWriteRef.current = t;
      };

      if (pts.length >= 2) {
        const segLen: number[] = [];
        let arc = 0;
        for (let i = 1; i < pts.length; i++) {
          const l =
            Math.hypot((pts[i].x - pts[i - 1].x) * aspect, pts[i].y - pts[i - 1].y) / 2;
          segLen.push(l);
          arc += l;
        }
        const n = Math.min(VEL_MAX_SUBSTEPS, Math.max(1, Math.ceil(arc / (VEL_SIGMA * 0.5))));
        const sx: number[] = [pts[0].x];
        const sy: number[] = [pts[0].y];
        let seg = 0;
        let consumed = 0;
        for (let k = 1; k < n; k++) {
          let need = arc / n;
          while (seg < segLen.length - 1 && need > segLen[seg] - consumed) {
            need -= segLen[seg] - consumed;
            seg++;
            consumed = 0;
          }
          consumed += need;
          const l = segLen[seg];
          const tt = l > 1e-9 ? Math.min(1, consumed / l) : 1;
          sx.push(pts[seg].x + (pts[seg + 1].x - pts[seg].x) * tt);
          sy.push(pts[seg].y + (pts[seg + 1].y - pts[seg].y) * tt);
        }
        sx.push(pts[pts.length - 1].x);
        sy.push(pts[pts.length - 1].y);
        const subDt = dt / n;
        for (let k = 1; k < sx.length; k++) {
          stepSim(
            (sx[k] + 1) / 2,
            (1 - sy[k]) / 2,
            (sx[k] - sx[k - 1]) / 2,
            -(sy[k] - sy[k - 1]) / 2,
            subDt
          );
        }
      } else {
        const m = mouseRef ? mouseRef.current : null;
        stepSim(m ? (m.x + 1) / 2 : 0.5, m ? (1 - m.y) / 2 : 0.5, 0, 0, dt);
      }
    }

    // 5. 渲染收尾：Film → filmRT → 雾 → 屏幕（或 Film 直绘屏幕）
    if (!transparent && fogQuadRef.current && filmRTRef.current) {
      gl.setRenderTarget(filmRTRef.current);
      filmQuadRef.current.render(gl);
      const fu = (fogQuadRef.current.material as THREE.ShaderMaterial).uniforms;
      fu.uTime.value = time;
      (fu.uProjInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
      (fu.uViewInv.value as THREE.Matrix4).copy(camera.matrixWorld);
      if (velReadRef.current) {
        fu.tVel.value = velReadRef.current.texture;
      }
      camera.updateMatrixWorld();
      (tmpVPRef.current as THREE.Matrix4)
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      (fu.uVP.value as THREE.Matrix4).copy(tmpVPRef.current);
      fu.tDiffuse.value = filmRTRef.current.texture;
      gl.setRenderTarget(null);
      fogQuadRef.current.render(gl);
    } else {
      gl.setRenderTarget(null);
      filmQuadRef.current.render(gl);
    }
  }, 1);

  return null;
}
