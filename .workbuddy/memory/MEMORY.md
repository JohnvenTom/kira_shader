# Kira Shader 项目长期备忘

## 验证/调试基础设施（复用）
- `scripts/ab.mjs`：CDP 交互驱动（会话间可能被清，缺了就按 2026-09-26 日志重建）。先起常驻 headless chrome：`"...\ms-playwright\chromium-1217\chrome-win64\chrome.exe" --headless=new --remote-debugging-port=9222 --user-data-dir=...`，再 `node scripts/ab.mjs goto|reload|eval|shot|mouse move|down|up|click|wheel|wait|waitfor|burst|burst-click`。支持分步 mouse down/move/up 模拟真实拖拽；burst-click 单连接内点击后连拍抓转场帧（SwiftShader 下每帧截图 ~1-2s，抓早期帧改用 evaluate 内 async IIFE click+延时读 getComputedStyle）。playwright-core 用 file:/// 绝对路径 import（ESM 不认 NODE_PATH），位置 `C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules`。
- 进钢琴页：kira-return {section:5,detail:true} → `/#film` → 滚轮推进运镜至 interactive（progress≥0.995）。进作品收藏柜：{section:1,detail:true} → `/#film` 等 1s。**通用规则：设置 kira-return 后必须 page.reload()——SPA 内 goto 只是 hash 导航不重 mount，initialRestore 不会重读**。
- three r169 渲染管线坑：EffectComposer 共享深度纹理 + autoClear=true → 深度被清；MSAA 深度 resolve 在 SwiftShader/ANGLE 静默失败。诊断法：shader 内临时输出 d0 灰度；uniform 冻结实验须兼容 value/accessor 描述符。
- WAAPI clamp 分发语义坑（通用）：滚动 scrubbing 按 `clamp(t, delay, delay+dur)` 写 currentTime 时，**t<delay 必须写 0（before 相位）而非 delay**——写 delay 会把 forwards 填充动画强制推进活动相位起点、from 帧生效（曾致 trace 页 ink from{opacity:.38} 在 0% 显示彩色底稿）。both 填充动画两种写法视觉一致。
- **EffectComposer 中段通道采样共享深度纹理 = 反馈环**（2026-09-27 computer 页踩坑）：往挂着深度纹理的 rt 里写、同时采样它读深度 → GL 静默拒绝（INVALID_OPERATION，零报错），整页画布全黑。症状特征：全黑+零 console 错误+gl.getError()=1282。修法：读深度的通道必须最终 renderToScreen（钢琴 Grade、computer DofPass 都放链尾），或写往未挂该纹理的目标。排障：先 getError()，git stash 做对照。另：SpotLight.map 锥角别扫到屏幕主体；灯贴脸时 decay 会平方级放大近场强度。
- **three WebGPU 页 RT 采样方向约定**（2026-10-23 转场颠倒踩坑）：WorkAboutExperience 的页 RT（pageRT 工厂）存储为**屏幕序**（第 0 行=屏幕顶部），TSL `screenUV`（y 向下）**直接采样即正确**；quad uv（y 向上）采样必须翻 V。heroCompose 的 baseUv 翻的是 quad uv（等效 screenUV）——与"screenUV 上再叠 oneMinus"不是同款约定，后者是双重翻转（曾致 #selected-work→office 转场画格内 office 颠倒）。定性工具：WorkAboutExperience 内置 `?debugRT=film|office|about` 分屏（左 quad uv / 右 screenUV），一图定 RT 存储方向。goldenTieReveal 的 `screenCoordinate/resolution` 直采是同款正确写法。
- **WebGPU 上传 canvas 纹理必须有渲染上下文**（2026-10-23）：`copyExternalImageToTexture` 对从未 getContext 的 canvas 抛 OperationError 且每帧 needsUpdate 时整帧渲染反复中断。兜底纹理画布（如 heroScene 的 1×1 boot canvas）必须 `getContext('2d')+fillRect` 一次。直链时若场景从未被渲染（scroll 边界外）则潜伏，回滚跨界后才爆——排查时注意"何时首次渲染"而非"何时创建"。
- **原站可直接当 1:1 复刻对照**：`https://shader.se/`（www）在 headless Chrome+SwiftShader 下可渲染；同段位滚轮+burst 连拍逐帧对照是转场/运镜类 bug 的金标准。本地进 work-about 系 hash 测试必须带 query 强制真导航（hash goto 不重 mount）。
- **原站 tie 人群素材管线**（2026-10-23）：人群 = Mux 签名 rendition 私有视频（`3hT3o009...` 10 人鼓掌图集 1518×1080，5×2 网格每人一格循环）；定位法 = 滚到 tie 段停住查 resource timing 增量（滚动过快会漏拉 manifest）。本地已烘焙 `public/videos/tie_crowd.mp4`（提亮+缩尺寸），goldenTieScene 用 VideoTexture + UV 裁窗 sprite；黑底不做亮度抠像（深色西装会被削半透明）+边缘 alpha 渐隐消接缝；crowdOpacity=1−handshake×4 握手退场。拉 HLS 用 `scripts/pull-hls.mjs`（curl 后端，node fetch 不走系统代理）+ `scripts/bin/ffmpeg.exe`（本地拼接后解，ffmpeg 直连 mux m3u8 会 Invalid NAL）。
- **WorkAboutExperience 的段边界**：about 以后按纸面高度动态算（shredStart=3.8+ctaY×scale/h）——本地纸页内容比原站长 3 倍（tieStart 33 屏 vs 原站 11.14），tie 段验收用 `?jump=tie` 直链；纸页长度对齐是独立待办。
- **CSS 动画要起跑，必须先有一次样式提交**（2026-09-27 磁带页踩坑）：layout effect 设置动画+类之后若同任务同步跑重 boot（编着色器），浏览器没机会提交样式 → 动画从未上合成器，醒来后直接 Snap 到终态。修法：boot 推迟到 double-rAF 之后（首帧画完+动画上合成器才交主线程）；"隐式起点 keyframes + delay + both 填充"可让展开完全在合成器线程跑。另：挂载首帧的姿态要用 useLayoutEffect 摆（useEffect 绘制后才跑，会闪一帧终态）。
- **StrictMode 双挂载在 SwiftShader/受限 GPU 环境下杀死 WebGL 上下文**（2026-10-23 首页踩坑）：main.tsx 首页/胶片页曾包 React.StrictMode，dev 双挂载让 R3F Canvas 在启动瞬间挂载→卸载(forceContextLoss)→重挂，SwiftShader 下频繁上下文创建销毁会连带杀死新上下文 → CanvasContextGuard 轮询兜底 reload → "丢失→刷新→再丢失"无限刷新循环（页面加载 5-6s 必丢，最小 WebGL 页面却稳定）。修法：去掉 StrictMode（TapePage/BadgePage 本就因双挂载副作用不套）；另给 Guard 加 canAutoReload 防死循环（15s 窗口最多自动刷新 2 次，超限显式报错停止刷新）。排障工具：`scripts/diag-boot.mjs`（新 page 收集 console/pageerror/requestfailed/404）、`scripts/webgl-soak.html`（最小 WebGL 稳定性对照）、`scripts/cleanup-pages.mjs`（清理 CDP 旧页面——多页面并存会放大软件渲染资源压力）。
- **main.tsx 已页面级懒加载**（2026-10-23）：入口曾静态 import 全部 7 个页面，首页被迫同时加载 three（WebGL）+ three/webgpu（WebGPU）双构建（控制台 "Multiple instances of Three.js" 警告、内存翻倍）。现 React.lazy + Suspense fallback=null 按路由分包；`FILM_SECTION_BY_HASH` 因懒加载无法同步引用，已抽到 `src/filmSectionMap.ts`（KiraFilmDemo re-export 保持兼容）。**注意：给 main.tsx 加新页面时用 lazy，别回退成静态 import**。
- 首页 ComputerScene GIF 解码的 compose canvas 已加 willReadFrequently（消除 Canvas2D getImageData 性能警告）；GIF 全帧 ImageData 驻留内存约 185MB（400x224x12 + 890x713x15 + 720x425x79 + 320x160x223），资源压力参考值。

## 用户偏好
- 修视觉问题要求浏览器交互式实测截图目检（拒绝一次性固化验证脚本）。
- 决策风格：给推荐项+讲清取舍，快速拍板（景深修复四轮、hover 修复一轮 grill 均选推荐项）。

## 既有问题备忘
- ~~`FilmPostProcessing.tsx` 有 5 个既有 TS 错误~~（2026-10-23 复查已消失，tsc -b 全绿）。
- 钢琴 HUD "三角面 0k" 计数没接对数据源（显示 bug，未修）。
- 磁带页 post.js 与钢琴页旧配置同款（共享深度+autoClear+MSAA）隐患，AO 通道后深度仍会被清，待统一修复。
- 收藏柜 `playFocusRing`（mouseenter 光圈）无拖拽守卫，拖拽经过卡片也会播光圈（既有行为，未修）。
