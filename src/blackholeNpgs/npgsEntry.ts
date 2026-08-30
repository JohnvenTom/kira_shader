// NPGS 黑洞物理级 shader 的 WebGL2 入口文件
// 功能：
//  - 提供 GLSL ES 3.00 fragment 入口（#version 300 es 开头）
//  - main() 调用 common 的 TraceRay/SampleBackground/ApplyToneMapping
// 参数：无
// 返回值：导出组合后的完整 fragment shader 字符串（NPGS_FRAG）
// 异常：无
// 注意事项：
//  - common 尾部已含全部 uniform 声明，入口只补 #version/precision/out/main
//  - TAA（iHistoryTex）在 WebGL2 单帧 pass 中略去，直接输出 tonemap 结果
import { NPGS_COMMON } from './npgsCommonText';

// 注意：RawShaderMaterial 下 Three.js 会注入 `#version 300 es` 到第一行，
// 因此这里不能重复写 #version（否则报 "must occur before anything else"）
export const NPGS_VERT = /* glsl */ `
precision highp float;
in vec3 position;
void main() {
    gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

/**
 * 完整 fragment shader = 头部 + 净化后的 common 函数库 + main 入口
 * （不含 #version，因为 Three.js RawShaderMaterial 会自动注入）
 */
export const NPGS_FRAG = `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;

out vec4 FragColor;

${NPGS_COMMON}

void main() {
    vec2 Uv = gl_FragCoord.xy / iResolution.xy;

    // 逐像素抖动抗锯齿（固定抖动，避免闪烁）
    vec2 Jitter = vec2(RandomStep(Uv, fract(iTime * 1.0 + 0.5)),
                       RandomStep(Uv, fract(iTime * 1.0))) / iResolution;

    TraceResult res = TraceRay(Uv + 0.5 * Jitter, iResolution);

    vec4 FinalColor    = res.AccumColor;
    float CurrentStatus = res.Status;
    vec3  CurrentDir    = res.EscapeDir;
    float CurrentShift  = res.FreqShift;

    // 射线逸出（Status 1=Sky, 2=Antiverse）：叠加上频移后的背景天空盒
    if (CurrentStatus > 0.5 && CurrentStatus < 2.5) {
        // Magnification=1.0（不做立体角点光源放大，保持简单）
        // ScreenSolidAngle=0.0001（估算单个屏幕像素立体角）
        vec4 Bg = SampleBackground(CurrentDir, CurrentShift, CurrentStatus, 1.0, 0.0001);
        FinalColor += 0.9999 * Bg * vec4(
            pow(max(1.0 - FinalColor.a, 0.0), 1.0),
            pow(max(1.0 - FinalColor.a, 0.0), 1.6),
            pow(max(1.0 - FinalColor.a, 0.0), 2.5),
            1.0);
    }

    // 频移感知的 HDR 色调映射
    FinalColor = ApplyToneMapping(FinalColor, CurrentShift);

    FragColor = FinalColor;
}
`;