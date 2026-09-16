import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * 运动模糊后期通道（MotionBlurPass）
 *
 * 功能：
 *  - 用帧间累积混合（Temporal Accumulation）实现运动模糊：
 *    每帧把"当前组合帧 tCur"与"上一帧历史帧 tPrev"按比例 uPrevMix 混合输出，
 *    并把混合结果写回私有 RenderTarget 作为下一帧的历史
 *  - 静止像素逐帧收敛后保持不变；运动像素（相机推进、烟雾、粒子、屏幕 GIF）
 *    沿运动轨迹留下残影拖尾，产生电影感运动模糊
 *  - 作为 EffectComposer 的最后一个 Pass 使用（最后一帧输出到屏幕），
 *    同一次混合结果既画到输出目标又写回历史缓冲，两步渲染共用同一组 uniform
 *
 * 参数：
 *  - width    {number} 历史缓冲初始宽度（像素，一般取 gl.domElement.width）
 *  - height   {number} 历史缓冲初始高度（像素）
 *  - strength {number} 运动模糊强度 0~1（内部 clamp 到 0~0.95），0 = 完全关闭
 *
 * 返回值：无（类实例）
 *
 * 异常：无
 *
 * 注意事项：
 *  - 每帧渲染前需先调用 update(delta)：把帧间隔 dt（秒）换算成帧率无关的
 *    混合系数 uPrevMix = 1 - (1 - strength)^(dt * 60)，
 *    即 60fps 下等效强度为 strength，高刷/低帧率下拖影长度一致；
 *    dt 上限 0.05s，防止后台标签页切回时大步长产生整屏残影跳变
 *  - Resize 时由 EffectComposer.setSize 自动回调 setSize()，
 *    内部重置历史缓冲并清空首帧标志
 *  - 首帧历史缓冲为空（黑），自动以混合系数 0（纯当前帧）初始化历史，
 *    避免开场画面闪黑
 *  - 历史缓冲只保留颜色（depth/stencil 关闭），UnsignedByte 精度与项目
 *    其余通道一致，避免高分屏下 GL_OUT_OF_MEMORY 触发上下文丢失
 */
export class MotionBlurPass extends Pass {
  /** 用户设定的运动模糊强度（0~1，构造后仍可运行期直接修改） */
  strength: number;

  /** 帧率无关混合系数（update() 每帧重算） */
  readonly uniforms: { uPrevMix: { value: number } };

  /** 历史帧 RenderTarget 双缓冲（ping-pong）：避免"采样与渲染同一纹理"引发
   *  GL feedback loop（glDrawArrays 被拒绝 → 画面黑屏） */
  private historyRTs: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];

  /** 当前作为"上一帧历史"的缓冲索引（另一块作为本帧写回目标） */
  private currentIdx = 0;

  /** 全屏四边形（执行混合 Shader 的绘制载体） */
  private fsQuad: FullScreenQuad;

  /** 是否已有一帧历史（首帧用纯当前帧初始化） */
  private hasHistory = false;

  constructor(width: number, height: number, strength = 0) {
    super();
    this.strength = Math.min(0.95, Math.max(0, strength));
    this.uniforms = { uPrevMix: { value: 0 } };

    // 双历史缓冲：一块读（上一帧）、一块写（本帧结果），下一帧互换
    this.historyRTs = [this.createHistoryRT(width, height, 'A'), this.createHistoryRT(width, height, 'B')];

    // 混合 Shader：vUv 由全屏三角形的 position 映射（position.xy ∈ [-1,1]）
    this.fsQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: {
          tCur: { value: null as THREE.Texture | null },
          tPrev: { value: null as THREE.Texture | null },
          uPrevMix: this.uniforms.uPrevMix,
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = position.xy * 0.5 + 0.5;
            gl_Position = vec4(position.xy, 1.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D tCur;
          uniform sampler2D tPrev;
          uniform float uPrevMix;
          varying vec2 vUv;
          void main() {
            vec3 cur = texture2D(tCur, vUv).rgb;
            vec3 prev = texture2D(tPrev, vUv).rgb;
            gl_FragColor = vec4(mix(cur, prev, uPrevMix), 1.0);
          }
        `,
        depthTest: false,
        depthWrite: false,
      })
    );
  }

  /**
   * 创建历史缓冲 RenderTarget
   *
   * 功能：构建只含颜色缓冲的离屏渲染目标（depth/stencil 关闭），
   *      UnsignedByte 精度与项目其余通道一致，避免高分屏下
   *      GL_OUT_OF_MEMORY 触发上下文丢失
   *
   * 参数：
   *  - width  {number} 宽度（像素）
   *  - height {number} 高度（像素）
   *  - suffix {string} 纹理名后缀（区分 ping-pong 两块缓冲，便于调试）
   *
   * 返回值：{THREE.WebGLRenderTarget} 新创建的渲染目标
   *
   * 异常：无
   */
  private createHistoryRT(width: number, height: number, suffix: string): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.name = `MotionBlurHistory${suffix}`;
    return rt;
  }

  /**
   * 每帧更新混合系数（帧率无关）
   *
   * 功能：把帧间隔 dt 换算成混合系数 uPrevMix：
   *       60fps 下 uPrevMix = strength；帧率越高单帧混合比例越低，
   *       保证不同刷新率屏幕上拖影"长度"一致
   *
   * 参数：
   *  - delta {number} 上一帧到本帧的时间间隔（秒）
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：调用方（PostProcessing 的 useFrame）在 composer.render() 之前调用
   */
  update(delta: number): void {
    const dt = Math.min(0.05, Math.max(0, delta));
    this.uniforms.uPrevMix.value = 1 - Math.pow(1 - this.strength, dt * 60);
  }

  /**
   * 通道渲染入口（EffectComposer 每帧调用）
   *
   * 功能：
   *  1. 绑定当前帧（readBuffer）与历史帧（currentIdx 指向的缓冲）纹理
   *  2. 首帧以混合系数 0 用纯当前帧初始化历史，避免开场闪黑
   *  3. 混合结果输出：renderToScreen（composer 每帧按"是否最后一个有效
   *     pass"写入本属性）为 true 时直接画到屏幕，否则画到 writeBuffer
   *  4. 相同结果写回另一块历史缓冲（写回目标 ≠ 采样目标，无 feedback
   *     loop），最后互换历史缓冲索引
   *
   * 参数：
   *  - renderer    {THREE.WebGLRenderer} 渲染器
   *  - writeBuffer {THREE.WebGLRenderTarget | null} 输出目标（中间 pass 时有效）
   *  - readBuffer  {THREE.WebGLRenderTarget} 当前组合帧（前一通道的输出）
   *
   * 返回值：无
   *
   * 异常：无
   *
   * 注意事项：
   *  - r169 版 EffectComposer 不再代理"最后一帧上屏"，最后一个 pass 必须
   *    在 renderToScreen=true 时自行 setRenderTarget(null) 渲染，否则画面
   *    永远留在离屏缓冲（表现为全黑画布）
   *  - 输出与写回两次绘制共用同一组 uniform，结果严格一致；
   *    写回目标始终与 readBuffer、历史读取缓冲三者互不相同
   */
  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget | null,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    const mat = this.fsQuad.material as THREE.ShaderMaterial;
    const historyRead = this.historyRTs[this.currentIdx];
    const historyWrite = this.historyRTs[1 - this.currentIdx];

    mat.uniforms.tCur.value = readBuffer.texture;
    mat.uniforms.tPrev.value = historyRead.texture;
    mat.uniforms.uPrevMix.value = this.hasHistory ? this.uniforms.uPrevMix.value : 0;
    this.hasHistory = true;

    // 1) 输出：最后一帧直接上屏，中间帧写 composer 的写缓冲
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
    // 2) 相同结果写回另一块历史缓冲，供下一帧混合（读写目标分离，无 feedback loop）
    renderer.setRenderTarget(historyWrite);
    this.fsQuad.render(renderer);

    // 互换历史缓冲索引
    this.currentIdx = 1 - this.currentIdx;
  }

  /**
   * 重建历史缓冲（Resize 时由 EffectComposer.setSize 自动回调）
   *
   * 功能：按新尺寸重置两块 ping-pong 历史 RenderTarget，并清空首帧标志
   *      （新缓冲为空，下一帧会以纯当前帧重新初始化）
   *
   * 参数：
   *  - width  {number} 新宽度（像素）
   *  - height {number} 新高度（像素）
   *
   * 返回值：无
   *
   * 异常：无
   */
  setSize(width: number, height: number): void {
    this.historyRTs[0].setSize(width, height);
    this.historyRTs[1].setSize(width, height);
    this.hasHistory = false;
  }

  /**
   * 释放 GPU 资源
   *
   * 功能：销毁双历史 RenderTarget、全屏四边形几何与 ShaderMaterial，
   *      由 PostProcessing 组件卸载时调用，防止显存泄漏
   *
   * 参数：无
   * 返回值：无
   * 异常：无
   */
  dispose(): void {
    this.historyRTs[0].dispose();
    this.historyRTs[1].dispose();
    this.fsQuad.dispose();
    (this.fsQuad.material as THREE.Material).dispose();
  }
}