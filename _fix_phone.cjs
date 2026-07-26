/**
 * 临时脚本：将 PhoneModel 从三个电话改回单个电话
 * 参照原版 shader.se/#contact：单个电话模型居中显示，缓慢自转
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'components', 'FilmScene.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. 替换注释中的"三个电话"描述
content = content.replace(
  '参照 shader.se/#contact 原版排版：渲染三个电话模型',
  '参照 shader.se/#contact 原版：单个电话模型居中显示，缓慢自转'
);

// 移除"中间正立 + 左右横向放置"行
content = content.replace(
  ' *    （中间正立 + 左右横向放置），整体居中偏下，占画面 40-50%\n',
  ''
);

// 替换"整个模型组"为"模型"
content = content.replace(
  '整个模型组绕 Y 轴微旋转跟随鼠标',
  '模型绕 Y 轴微旋转跟随鼠标'
);

// 替换"用 scene.clone(true) 创建三个克隆"注释
content = content.replace(
  '  - 用 scene.clone(true) 创建三个克隆，共享 geometry/material，独立 transform\n *  - 原始 phoneScene 仅作为模板用于克隆，不直接渲染\n *  - 中间电话正立，左右电话绕 Z 轴旋转 ±90° 横向放置\n *  - 整个组沿 Y 轴下移 -0.6，让模型位于画面中下部（参照原版）',
  '  - 单个模型直接渲染，居中显示\n *  - 整个组沿 Y 轴下移 -0.5，让模型位于画面中下部（参照原版）'
);

// 2. 替换加载注释
content = content.replace(
  '// 加载电话模型（作为克隆模板）',
  '// 加载电话模型'
);

// 3. 替换 setup useMemo 块：从三个克隆改为单个模型
const oldSetupBlock = `  // 居中 + 缩放 + 创建三个克隆（仅执行一次）
  // 原始 phoneScene 被用作"模板"，仅修改其 transform，clone 继承此 transform
  const setup = useMemo(() => {
    if (!phoneScene) return null;

    // 计算包围盒
    const box = new THREE.Box3().setFromObject(phoneScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // 统一缩放：单个电话最大维度 = 1.8，三个并排约 6-7 单位宽度（视口合适）
    const targetSize = 1.8;
    const scale = targetSize / maxDim;
    phoneScene.scale.setScalar(scale);

    // 抵消中心偏移，让模型中心位于原点
    phoneScene.position.x = -center.x * scale;
    phoneScene.position.y = -center.y * scale;
    phoneScene.position.z = -center.z * scale;

    // 创建三个克隆（深克隆 transform/子对象，共享 geometry/material 节省内存）
    // R3F 的 primitive 要求每个 object 唯一，所以必须 clone
    const centerPhone = phoneScene.clone(true);
    const leftPhone = phoneScene.clone(true);
    const rightPhone = phoneScene.clone(true);

    const scaledSize = size.clone().multiplyScalar(scale);
    return { scaledSize, scale, center, centerPhone, leftPhone, rightPhone };
  }, [phoneScene]);`;

const newSetupBlock = `  // 居中 + 缩放（仅执行一次）
  // 单个电话模型直接渲染，参照原版 shader.se/#contact
  const setup = useMemo(() => {
    if (!phoneScene) return null;

    // 计算包围盒
    const box = new THREE.Box3().setFromObject(phoneScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // 统一缩放：单个电话最大维度 = 3.0，占画面 40-50%（参照原版）
    const targetSize = 3.0;
    const scale = targetSize / maxDim;
    phoneScene.scale.setScalar(scale);

    // 抵消中心偏移，让模型中心位于原点
    phoneScene.position.x = -center.x * scale;
    phoneScene.position.y = -center.y * scale;
    phoneScene.position.z = -center.z * scale;

    const scaledSize = size.clone().multiplyScalar(scale);
    return { scaledSize, scale, center };
  }, [phoneScene]);`;

if (content.includes(oldSetupBlock)) {
  content = content.replace(oldSetupBlock, newSetupBlock);
  console.log('✓ setup block replaced');
} else {
  console.log('✗ setup block NOT found');
}

// 4. 替换 useFrame 参数
content = content.replace(
  'const autoRotateY = t * 0.12;',
  'const autoRotateY = t * 0.15;'
);

content = content.replace(
  'const parallaxY = smoothed.x * 0.3;  // ±0.3 rad ≈ ±17°',
  'const parallaxY = smoothed.x * 0.4;  // ±0.4 rad ≈ ±23°'
);

content = content.replace(
  'const parallaxX = smoothed.y * 0.12; // ±0.12 rad ≈ ±7°',
  'const parallaxX = smoothed.y * 0.15; // ±0.15 rad ≈ ±8.6°'
);

content = content.replace(
  'const floatY = Math.sin(t * 0.8) * 0.04;',
  'const floatY = Math.sin(t * 0.8) * 0.05;'
);

content = content.replace(
  'groupRef.current.position.y = -0.6 + floatY; // -0.6 让组居中偏下',
  'groupRef.current.position.y = -0.5 + floatY; // -0.5 让模型居中偏下'
);

content = content.replace(
  '让电话组持续转动展示多角度',
  '让电话持续转动展示多角度'
);

content = content.replace(
  '鼠标视差微旋转：水平移动鼠标 → 整组左右摆动；垂直移动 → 微仰俯',
  '鼠标视差微旋转：水平移动鼠标 → 模型左右摆动；垂直移动 → 微仰俯'
);

content = content.replace(
  '整组微微上下浮动（呼吸感），呼应电话"待接听"的呼吸节奏',
  '模型微微上下浮动（呼吸感），呼应电话"待接听"的呼吸节奏'
);

// 5. 替换 return JSX：从三个电话改为单个电话
const oldReturnBlock = `  if (!phoneScene || !setup) return null;

  // 三个电话的横向间距：单个模型宽度约 1.8，留 0.6 间距 → 中心间距 2.4
  const SIDE_OFFSET = 2.4;

  return (
    <group ref={groupRef}>
      {/* 中间电话：正立展示（主视觉） */}
      <primitive object={setup.centerPhone} position={[0, 0, 0]} />

      {/* 左侧电话：横向放置（绕 Z 轴 +90°，听筒朝右） */}
      <primitive
        object={setup.leftPhone}
        position={[-SIDE_OFFSET, -0.1, 0]}
        rotation={[0, 0, Math.PI / 2]}
      />

      {/* 右侧电话：横向放置（绕 Z 轴 -90°，听筒朝左，对称） */}
      <primitive
        object={setup.rightPhone}
        position={[SIDE_OFFSET, -0.1, 0]}
        rotation={[0, 0, -Math.PI / 2]}
      />
    </group>
  );
}`;

const newReturnBlock = `  if (!phoneScene || !setup) return null;

  return (
    <group ref={groupRef}>
      {/* 单个电话模型：居中显示，缓慢自转（参照原版 shader.se/#contact） */}
      <primitive object={phoneScene} />
    </group>
  );
}`;

if (content.includes(oldReturnBlock)) {
  content = content.replace(oldReturnBlock, newReturnBlock);
  console.log('✓ return block replaced');
} else {
  console.log('✗ return block NOT found');
}

// 写回文件
fs.writeFileSync(filePath, content, 'utf8');
console.log('✓ File written successfully');
