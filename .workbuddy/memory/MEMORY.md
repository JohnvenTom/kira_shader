# Kira Shader 项目长期备忘

## 验证/调试基础设施（复用）
- `scripts/ab.mjs`：CDP 交互驱动。先起常驻 headless chrome：`"...\ms-playwright\chromium-1217\chrome-win64\chrome.exe" --headless=new --remote-debugging-port=9222 --user-data-dir=...`，再 `node scripts/ab.mjs goto|eval|shot|mouse|click|wheel|key|reload`。浏览器跨步骤常驻，逐步观察。
- `scripts/sharpness.py`：纯 stdlib PNG 解码 + Laplacian 方差局部清晰度（pip 不可用时）。
- 进钢琴页直达：`sessionStorage['kira-return']=JSON.stringify({section:5,detail:true})` → `/#film` → 等 detailOpen（1s）→ 滚轮推进运镜至 interactive（progress≥0.995）。**必须 page.reload()（goto 加新 query 会拿到上一个构建的 index.html）**。
- three r169 渲染管线坑：EffectComposer 共享深度纹理 + autoClear=true → 深度被清；MSAA 深度 resolve 在 SwiftShader/ANGLE 静默失败。诊断法：shader 内临时输出 d0 灰度；uniform 冻结实验须兼容 value/accessor 描述符。

## 用户偏好
- 修视觉问题要求浏览器交互式实测截图目检（拒绝一次性固化验证脚本）。
- 决策风格：给推荐项+讲清取舍，快速拍板（景深修复中四轮 grill 均选推荐项）。

## 既有问题备忘
- `FilmPostProcessing.tsx` 有 5 个既有 TS 错误（阻塞 tsc -b，与钢琴页无关）。
- 钢琴 HUD "三角面 0k" 计数没接对数据源（显示 bug，未修）。
- 磁带页 post.js 与钢琴页旧配置同款（共享深度+autoClear+MSAA）隐患，AO 通道后深度仍会被清，待统一修复。
