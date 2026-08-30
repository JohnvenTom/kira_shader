// NPGS 黑洞 shader 移植转换脚本（一次性的自动化文本移植）
// 功能：
//  - 读取 Vulkan GLSL 的 BlackHole_common.glsl 与两个 include
//  - 内联 #include、清除 #extension/#pragma/#version/layout set-binding
//  - 把命名 uniform 块拍平成普通 uniform
//  - 替换 textureQueryLod -> 固定 LOD 1.0
//  - 输出净化后的 common 文本 + uniform 字段清单（JSON）
// 参数：无
// 返回值：无
// 异常：源文件缺失时直接退出
// 注意事项：输出文件覆盖写入 src/blackholeNpgs/npgsCommonText.ts 便于核对
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, '..', 'public', 'asset', 'shaders', 'npgs');

// ---- 1. 读取源文件 ----
const common = readFileSync(join(repo, 'BlackHole_common.glsl'), 'utf8');
const coord = readFileSync(join(repo, 'Common', 'CoordConverter.glsl'), 'utf8');
const num = readFileSync(join(repo, 'Common', 'NumericConstants.glsl'), 'utf8');

let s = common;

// ---- 2. 清除 Vulkan 头部语法 ----
s = s.replace(/^\s*#version\s+450.*$/gm, '');
s = s.replace(/^\s*#pragma\s+shader_stage\([a-z]+\)\s*$/gm, '');
s = s.replace(/^\s*#extension\s+\S+\s*:\s*\S+\s*$/gm, '');
// 删除独立的 layout(set = N, binding = N) 行（可能在 uniform 块前独占一行）
s = s.replace(/^\s*layout\s*\(\s*set\s*=\s*\d+\s*,\s*binding\s*=\s*\d+\s*\)\s*$/gm, '');

// ---- 3. 内联 #include（去掉 include guard，因为合成单文件不需要）----
const stripGuard = (txt) =>
  txt
    .replace(/^#ifndef\s+\w+\s*$/gm, '')
    .replace(/^#define\s+\w+\s*$/gm, '')
    .replace(/^#endif.*$/gm, '')
    .trim();
s = s.replace(/^\s*#include "Common\/CoordConverter\.glsl"\s*$/gm, stripGuard(coord));
s = s.replace(/^\s*#include "Common\/NumericConstants\.glsl"\s*$/gm, stripGuard(num));

// ---- 4. 拍平命名 uniform 块（Vulkan UBO -> 普通 uniform）----
// 提取所有 `uniform Xxx { ... };` 块，逐成员映射为 `uniform <type> <name>;`
// 返回值：{ clean, uniStr } —— clean 是移除块后的剩余文本，uniStr 是拍平的 uniform 声明
function flattenBlocks(src) {
  const blocks = [];
  const clean = src.replace(/uniform\s+(\w+)\s*\{([\s\S]*?)\};/g, (m, name, body) => {
    blocks.push({ name, body });
    return '';
  });
  let uniStr = '';
  for (const b of blocks) {
    const members = b.body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//'));
    for (const line of members) {
      const m = line.match(/^(vec\d|mat\d(?:\s*[xX]\s*\d)?|float|int|uint|bool|ivec\d|uvec\d)\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/);
      if (m) {
        uniStr += `uniform ${m[1]} ${m[2]};\n`;
      }
    }
  }
  return { clean, uniStr };
}

// ---- 5. 采样器声明去 layout ----
s = s.replace(/layout\s*\([^)]*\)\s*uniform\s+samplerCube\s+(\w+)\s*;/g, 'uniform samplerCube $1;');
s = s.replace(/layout\s*\([^)]*\)\s*uniform\s+sampler2D\s+(\w+)\s*;/g, 'uniform sampler2D $1;');
s = s.replace(/layout\s*\([^)]*\)\s*uniform\s+texture2D\s+(\w+)\s*;/g, 'uniform sampler2D $1;');

// ---- 6. textureQueryLod 替换为固定 LOD ----
s = s.replace(/textureQueryLod\s*\([^)]*\)\s*\.x/g, '1.0');
s = s.replace(/min\(1\.0,\s*1\.0\)/g, '1.0');

// ---- 6.5 GLSL ES 3.00 float/int 类型修正 ----
// ES 3.00 禁止 float 与 int 直接比较/赋值，补充 .0 后缀（原为 Vulkan GLSL 4 隐式转换）
s = s.replace(/if\s*\(V_sq\s*(<|>)\s*0\)/g, 'if (V_sq $1 0.0)');
s = s.replace(/if\s*\(finalSign\s*(>|>=|<|<=)\s*0\)/g, 'if(finalSign $1 0.0)');
s = s.replace(/float ThetaInShell=0;/g, 'float ThetaInShell=0.0;');
// 3) float 变量赋整数字面量（MaxStep 是 float）
s = s.replace(/MaxStep\s*=\s*1145;?/g, 'MaxStep=1145.0;');
s = s.replace(/MaxStep\s*=\s*450;?/g, 'MaxStep=450.0;');

// ---- 7. 拍平块 ----
// 注意：uniform 声明必须放在文件开头（GLSL 先声明后使用），
// 不能追加到末尾，否则函数内引用报 undeclared identifier。
const { clean: cleanText, uniStr } = flattenBlocks(s);
let out = uniStr + cleanText;
// 拍平后删除残留的 layout(...)（原 layout 行与 uniform 块同行，flatten 后才暴露）
out = out.replace(/layout\s*\(\s*set\s*=\s*\d+\s*,\s*binding\s*=\s*\d+\s*\)\s*/g, '');

// 检查残留 Vulkan 语法
const leftovers = [];
for (const pat of ['layout(', 'textureQueryLod', '#include', '#extension', '#pragma', '#version', 'imageStore', 'gl_GlobalInvocationID']) {
  if (out.includes(pat)) leftovers.push(pat);
}

// ---- 8. 提取 uniform 字段清单（默认值占位）----
const uniformDefs = [];
// 不要求行首（拍平的 uniform 可能粘连在 `}` 后），类型支持 mat4x4/mat4
const uniformRegex = /\buniform\s+(float|int|uint|bool|ivec\d|vec2|vec3|vec4|mat3|mat4x4|mat4|samplerCube|sampler2D)\s+(\w+)\s*;/g;
let um;
while ((um = uniformRegex.exec(out)) !== null) {
  uniformDefs.push({ type: um[1], name: um[2] });
}
const jsUniforms = {};
for (const u of uniformDefs) {
  const t = u.type;
  if (t === 'float') jsUniforms[u.name] = 0;
  else if (t === 'int' || t === 'uint' || t === 'bool') jsUniforms[u.name] = 0;
  else if (t === 'ivec2') jsUniforms[u.name] = [0, 0];
  else if (t === 'vec2') jsUniforms[u.name] = [0, 0];
  else if (t === 'vec3') jsUniforms[u.name] = [0, 0, 0];
  else if (t === 'vec4') jsUniforms[u.name] = [0, 0, 0, 0];
  else if (t === 'mat4' || t === 'mat4x4') jsUniforms[u.name] = [];
  else if (t === 'mat3') jsUniforms[u.name] = [];
  else jsUniforms[u.name] = null;
}

// ---- 9. 写输出 ----
const outDir = join(__dirname, '..', 'src', 'blackholeNpgs');
mkdirSync(outDir, { recursive: true });
const escaped = out.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const ts = `// 由 scripts/npgs-port.mjs 自动生成的 NPGS 黑洞 shader（GLSL ES 3.00 兼容净化版文本）
export const NPGS_COMMON = \`${escaped}\`;
`;
writeFileSync(join(outDir, 'npgsCommonText.ts'), ts, 'utf8');
writeFileSync(
  join(outDir, 'npgsUniforms.json'),
  JSON.stringify({ fields: uniformDefs, defaults: jsUniforms, leftovers }, null, 2),
  'utf8'
);
console.log('DONE. lines=', out.split('\n').length, 'uniforms=', uniformDefs.length);
console.log('LEFTOVERS=', JSON.stringify(leftovers));
console.log(JSON.stringify(uniformDefs.map((u) => u.name)));

