# Kira Shader 项目长期备忘

## 验证/调试基础设施（复用）
- `scripts/ab.mjs`：CDP 交互驱动（会话间可能被清，缺了就按 2026-09-26 日志重建）。先起常驻 headless chrome：`"...\ms-playwright\chromium-1217\chrome-win64\chrome.exe" --headless=new --remote-debugging-port=9222 --user-data-dir=...`，再 `node scripts/ab.mjs goto|reload|eval|shot|mouse move|down|up|click|wheel|wait|waitfor|burst|burst-click`。支持分步 mouse down/move/up 模拟真实拖拽；burst-click 单连接内点击后连拍抓转场帧（SwiftShader 下每帧截图 ~1-2s，抓早期帧改用 evaluate 内 async IIFE click+延时读 getComputedStyle）。playwright-core 用 file:/// 绝对路径 import（ESM 不认 NODE_PATH），位置 `C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules`。
- 进钢琴页：kira-return {section:5,detail:true} → `/#film` → 滚轮推进运镜至 interactive（progress≥0.995）。进作品收藏柜：{section:1,detail:true} → `/#film` 等 1s。**通用规则：设置 kira-return 后必须 page.reload()——SPA 内 goto 只是 hash 导航不重 mount，initialRestore 不会重读**。
- three r169 渲染管线坑：EffectComposer 共享深度纹理 + autoClear=true → 深度被清；MSAA 深度 resolve 在 SwiftShader/ANGLE 静默失败。诊断法：shader 内临时输出 d0 灰度；uniform 冻结实验须兼容 value/accessor 描述符。

## 用户偏好
- 修视觉问题要求浏览器交互式实测截图目检（拒绝一次性固化验证脚本）。
- 决策风格：给推荐项+讲清取舍，快速拍板（景深修复四轮、hover 修复一轮 grill 均选推荐项）。

## 既有问题备忘
- `FilmPostProcessing.tsx` 有 5 个既有 TS 错误（阻塞 tsc -b，与钢琴页无关）。
- 钢琴 HUD "三角面 0k" 计数没接对数据源（显示 bug，未修）。
- 磁带页 post.js 与钢琴页旧配置同款（共享深度+autoClear+MSAA）隐患，AO 通道后深度仍会被清，待统一修复。
- 收藏柜 `playFocusRing`（mouseenter 光圈）无拖拽守卫，拖拽经过卡片也会播光圈（既有行为，未修）。
