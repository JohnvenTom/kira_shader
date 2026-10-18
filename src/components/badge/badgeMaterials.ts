/**
 * 薄胶膜菲涅尔材质（站点最核心的一处自定义着色器）
 *
 * 站点并不使用 MeshTransmissionMaterial，而是拿 MeshPhysicalMaterial
 * 通过 onBeforeCompile 注入了三段代码，把"透明 PVC 卡套"做出来：
 *
 *  1. 顶点：把对象空间坐标传给片元（vFilmPosition），硬件件变体额外做边缘"啃痕"位移
 *  2. 片元法线：加一层低频 sin/cos 微扰（塑料表面的微小不平整）
 *  3. 片元输出：用菲涅尔（视线与法线夹角）算反射率，直接当作 alpha
 *     → 正对时几乎全透明，掠射角边缘泛白泛光，等于真实胶片的观感
 *
 * 注意事项：
 *  - `filteredCapture` 为真时把结果夹到 1.0：后处理链路（滤镜/绘图仪）开启时，
 *    HDR 影棚灯条会在合成前把整张卡糊掉，夹一下更稳
 *  - `customProgramCacheKey` 必须区分两套变体，否则 three 会复用错误的编译产物
 *  - 三个 uniform 用共享对象（每帧回写），保证所有胶膜件反应一致
 */

import * as THREE from 'three';

/** 薄胶膜共享 uniform（每帧由场景回写，所有胶膜材质共用同一份） */
export interface BadgeFilmUniforms {
  /** 是否走后处理采集（true 时夹住 HDR 反射） */
  filtered: { value: boolean };
  /** 胶膜"透明度"（接进菲涅尔 alpha 的混合系数） */
  clarity: { value: number };
  /** 胶膜厚度（参与反射增益） */
  thickness: { value: number };
  /** 边缘啃痕强度 */
  damage: { value: number };
}

/**
 * 创建薄胶膜共享 uniform 集合
 *
 * 功能：生成一份被所有胶膜材质引用的 uniform 对象，初值与站点一致
 *      （filtered=false、clarity=1、thickness=.006、damage=.55）。
 *
 * 参数：无
 * 返回值：{BadgeFilmUniforms} 共享 uniform 集合
 * 异常：无
 */
export function createFilmUniforms(): BadgeFilmUniforms {
  return {
    filtered: { value: false },
    clarity: { value: 1 },
    thickness: { value: 0.006 },
    damage: { value: 0.55 },
  };
}

/** 边缘啃痕顶点注入（仅在硬件件变体里启用，作用于 |x| 超过 1.20 的部分） */
const EDGE_NICK_CHUNK = /* glsl */ `
        float edgeMask=smoothstep(1.20,1.30,abs(position.x));
        float nick=exp(-pow((position.y+1.72)*19.0,2.0)) + .6*exp(-pow((position.y-.7)*28.0,2.0));
        transformed.x -= sign(position.x)*nick*edgeMask*.014*filmEdgeDamage;
`;

/**
 * 生成菲涅尔输出注入片段
 *
 * 功能：拼出 opaque_fragment 之后追加的 GLSL。反射率 =
 *      pow(1 - |dot(normal, view)|, 5) × 1.0，再取下限（胶膜 .035 / 硬件 .18）、
 *      乘厚度增益、并与"亮灯条高光"取最大值，最后用它当 alpha。
 *
 * 参数：
 *  - hardware {boolean} 是否硬件件变体（决定下限与高光保留系数）
 *
 * 返回值：{string} 注入用的 GLSL 片段
 * 异常：无
 *
 * 注意事项：站点里 `0.18 + 0.82` 与 `0.035 + 0.965` 展开后都是 1.0，
 *          这里直接写成 1.0 并保留注释，避免后人误以为存在可调系数
 */
function buildFresnelChunk(hardware: boolean): string {
  const floor = hardware ? '0.18' : '0.035';
  const strip = hardware ? '.65' : '.34';
  return /* glsl */ `
        float facing = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
        float reflection = 1.0 * pow(1.0 - facing, 5.0);
        reflection = max(reflection, ${floor});
        reflection = clamp(reflection * (1.0 + filmThickness * 3.0), 0.0, 1.0);
        // 保留教室灯条的高光：透明薄膜直接把 HDR 反射合成上去会丢亮点，这里兜一下
        float energy=max(max(outgoingLight.r,outgoingLight.g),outgoingLight.b);
        reflection=max(reflection,smoothstep(.9,4.0,energy)*${strip});
        gl_FragColor.a = mix(1.0, reflection, filmClarity);
        // 后处理链路里先夹住 HDR：否则一条亮灯就能把整张卡压成白色
        if(filteredCapture) gl_FragColor.rgb=min(gl_FragColor.rgb,vec3(1.0));
      `;
}

/**
 * 创建薄胶膜材质
 *
 * 功能：构造 MeshPhysicalMaterial（金属度 1、颜色白、透明、不写深度、单面），
 *      再通过 onBeforeCompile 注入 vFilmPosition / 边缘啃痕 / 法线微扰 / 菲涅尔 alpha。
 *
 * 参数：
 *  - roughness {number} 粗糙度（胶膜 .008，硬件 .018）
 *  - hardware  {boolean} 是否硬件件变体（开启边缘啃痕 + 更高的反射下限）
 *  - uniforms  {BadgeFilmUniforms} 共享 uniform（会挂到 shader.uniforms 上）
 *
 * 返回值：{THREE.MeshPhysicalMaterial} 可直接赋给 Mesh
 * 异常：无
 *
 * 注意事项：
 *  - depthWrite=false 是必须的：多层半透明胶膜互相覆盖时不能互相挡深度
 *  - 静态/动态光照下 three 的再编译会重新走 onBeforeCompile，uniform 引用依然有效
 */
export function createThinVinylMaterial(
  roughness: number,
  hardware: boolean,
  uniforms: BadgeFilmUniforms
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 1,
    roughness,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    envMapIntensity: 1,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.filmClarity = uniforms.clarity;
    shader.uniforms.filteredCapture = uniforms.filtered;
    shader.uniforms.filmEdgeDamage = uniforms.damage;

    shader.vertexShader = `varying vec3 vFilmPosition; uniform float filmEdgeDamage;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n        vFilmPosition=position;\n` +
        (hardware ? EDGE_NICK_CHUNK : '') +
        `\n      `
    );

    shader.uniforms.filmThickness = uniforms.thickness;
    shader.fragmentShader =
      `uniform bool filteredCapture; varying vec3 vFilmPosition; uniform float filmClarity; uniform float filmThickness;\n` +
      shader.fragmentShader;

    if (!hardware) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n        normal=normalize(normal + vec3(.018*sin(vFilmPosition.y*3.1 + vFilmPosition.x*1.4), .011*cos(vFilmPosition.x*4.2-vFilmPosition.y*1.3),0.0));\n      `
      );
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>\n` + buildFresnelChunk(hardware)
    );
  };

  // 两套变体必须给不同的缓存键，否则 three 会把胶膜的程序错误地复用给硬件件
  material.customProgramCacheKey = () => `thin-vinyl-fresnel-v3-${hardware}`;
  return material;
}
