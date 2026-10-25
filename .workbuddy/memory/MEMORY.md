# Kira Shader 项目长期备忘

## 导航 P1（2026-10-25 完成，tsc 全绿；P2 未开工）
- **架构**：uikit 渲独立 UiScene（fov65 [0,0,5]，pixelSize=VH/vh）出 light/dark 双 RT → heroCompose.setUiTextures 第 3/4 参 → 合成器 mix 后叠加吃后期。navBar.ts（NavBarKit）+ navUiScene.ts（双树/双 RT/regions 命中表）。WorkAboutExperience：uiHit 优先 nav.regions、canvas 区域表兜底、uiCanvas headerless。详见 2026-10-25.md P1 节。
- **uikit 集成五坑**：①mount 前必须 root.applyViewport(vw)（否则 __textResolved 缺失 → buildRecord 抛错 → nav 整体失败）；②yoga 默认 flexDirection=column（用 justifyContent 必显式 row）；③content-box 下 width:'100%'+padding 溢出（column 父 stretch 即可）；④display:none 不沿子树继承（updateRecursive 有 inheritedVisible）；⑤tick 改 style.display 必须同步 node.setDisplay（否则布局尺寸 0 全隐形）。
- **其他**：menuPanel 挂 root（yoga absolute 相对父）；SVG 光栅化 canvas 用自然尺寸（512×固定 → logo 糊暗）；navRow gap 实测 45；worldToCss 的 w/h 要乘 vh/VH；hero 段 lens 应为 0。
- **ab.mjs 坑**：每条命令独立 CDP 连接，mouse down/up 分开丢位置——点击用 `click x y` 单命令；eval 仅单表达式。
- **P2 状态机**（v2 星星转场完成 2026-10-25）：navNavigate 统一入口——URL 立即 replaceState；相邻 hero↔projects=0.8s bezier 缓动（帧循环直驱轴）；跨段=1.25s **星星阵列飞掠**（原站 TransitionScene cb/cv 复刻：8 颗金色 10 角星队列横穿+领头星内芯透出目标页画面+跳轴落点，starTransitionScene.ts **画布 overlay 直渲**）+ 输入锁 + 帧循环 hash 门。详见 2026-10-25.md P2 v2 节。v2 待办：领头星内芯画面时序、灯光精调。
- **★WebGPU backend RT 渲染硬坑（SwiftShader 实证）**：①renderAsync-to-RT 不画内容（直出画布正常、RT 全空零报错）→ **画布 overlay（autoClear=false）是唯一可靠叠加路径**；②RT alpha 通道不可靠（clearAlpha 0 读出 1）→ 用 rgb 亮度掩码替代；③采样未渲染的 RT → pipeline invalid 整帧弃零报错 → 强渲成功才喂纹理；④renderAsync 未 await 就解绑 RT=竞态黑。
- **★cx 星星阵列=共享工厂 starArray.ts（2026-10-25 晚重构）**：goldenTieRevealScene（页内挂载 [-0.025,1.6,3.98]×0.2）与 starTransitionScene（转场挂载 [0,8,0]+fov50）共用一份 cv/cb/cS 实现——几何/材质/内芯/灯光/公式改一处两处生效。**flat 星是原站调试残留（opacity 恒 0），正确=7 颗 3D**；领头星 scale.set(n,n,1)（z 恒 1）；**尾段全屏接管=领头星贴脸相机进星内部→内芯(目标页纹理)撑满全屏**，内芯黑=纹理没喂上；点光在转场 scale 1 下照不到远星（亮度主力=PMREM env）。
- **★WebGPU CanvasTexture resize 坑**：canvas 尺寸变化后 GPU 纹理**不重分配**（uiCanvas/titleTextures 900→1600 实证越界黑屏）→ 尺寸变化时 `tex.dispose()`，同一 Texture 对象复用按新尺寸重建，槽位引用无需动。
- **★dev 环境衰败两兄弟**：①vite 模块图长跑中间态（症状：__nav/__hero 句柄全 false、boot 死、lazyInitializer "Cannot convert object to primitive value"——React 渲染错误对象不可字符串化+console.error 转换它时二次崩）→ 重启 dev server 即愈；②Chrome headless 每 3-5 页衰败（createBuffer(32) too large=device 资源耗尽、WASM OOM）→ diag-boot2 每页自关是正确姿势，ab.mjs 常驻页面长会话不可持续。
- **遗留**：MSDF 笔画偏细；navbar 下移 2px。~~boot 状态机卡死~~ **已澄清为假警报**（2026-10-25 下午）：vite HMR 的 `?t=` 模块实例分裂——eval `import('/src/boot/bootStore.ts')` 裸 URL 拿到的是静态副本，与页面 ?t= 实例不同，读数恒为 loading/0；页面实例 boot 一直正常走完。**教训：dev 下 CDP eval 读模块状态不可信，用行为验证（点击/截图）**。清脏缓存的正规姿势：杀 vite → 删 kira-vite-cache → 重启 dev。诊断脚本 scripts/diag-boot2.mjs（5173 正确端口+console/pageerror 收集+参数化视口/resize，替代过时的 diag-boot.mjs）。

## 调试基础设施（复用）
- `scripts/ab.mjs`：CDP 交互驱动。先起常驻 headless chrome（`...\ms-playwright\chromium-1217\chrome-win64\chrome.exe --headless=new --remote-debugging-port=9222 --user-data-dir=...`），再 goto|reload|eval|shot|mouse|click|wheel|wait|burst。playwright-core 用 file:/// 绝对路径 import，位置 `C:/Users/tom/.workbuddy/binaries/node/workspace/node_modules`。
- 进钢琴页：kira-return {section:5,detail:true} → `/#film` 滚轮推进至 interactive；收藏柜：{section:1,detail:true}。**设 kira-return 后必须 page.reload()（SPA hash goto 不重 mount）**。
- 原站 `https://shader.se/` 在 headless Chrome+SwiftShader 可渲染，逐帧对照金标准；本地 work-about hash 测试须带 query 强制真导航。
- **Chrome 反复 goto 后全黑/白/光池硬边梯形 = SwiftShader 上下文污染（非代码 bug），重启 Chrome 即愈**。多页面并存放大软件渲染压力→scripts/cleanup-pages.mjs。
- 排障工具：diag-boot.mjs（console/error 收集）、webgl-soak.html、probe-origin-store.mjs（React fiber 挖原站 zustand store，运行时取证利器）。

## three r169 WebGPU 渲染坑（可复用）
- **EffectComposer 中段通道采样共享深度纹理=反馈环**：写+读同一 RT 深度 → GL 静默拒绝（INVALID_OPERATION=1282，零 console 错误，整页全黑）。读深度的通道必须 renderToScreen 或写往别处。
- **RT 采样方向**：WorkAboutExperience 页 RT 存储为屏幕序（第0行=屏顶），TSL screenUV（y向下）直采正确；quad uv（y向上）须翻 V。`?debugRT=` 分屏工具可定性。
- **上传 canvas 纹理必须有渲染上下文**：copyExternalImageToTexture 对从未 getContext 的 canvas 抛错且每帧中断。兜底 canvas 须 getContext+fillRect 一次；注意"何时首次渲染"（scroll 边界外潜伏）。
- **StrictMode 双挂载杀 WebGL 上下文**（SwiftShader 下无限刷新循环）：已去掉 StrictMode；CanvasContextGuard 有 canAutoReload（15s 最多 2 次）。
- **r169 无 T.uniformTexture**：T.texture(tex) 可运行时换 .value；T.atan 双参 WGSL 报错→T.atan2。
- WAAPI clamp 分发：t<delay 必须写 0（before 相位）而非 delay，否则 forwards 填充动画被推进活动相位。
- CSS 动画起跑需先有一次样式提交：boot（编 shader）推迟到 double-rAF 后；挂载首帧姿态用 useLayoutEffect。
- main.tsx 页面级懒加载（React.lazy）：加新页面用 lazy，勿回退静态 import。
- metallic/black 材质无 envMap 场景须降 metalness（0.9→0.35/0.4→0.15）。
- GLB 负 scale（房间内壁）：r169 下环绕序不翻+法线不翻 → 修=索引三角序翻转+normal 取负。**贴图采样 RAW 直采正确，勿加 flipY 补偿**；GLTF 贴图 mipmap 自动生成路径是好的，勿手动 generateMipmaps；GLB binStart=20+jsonLen+8。

## hero 屏幕光（2026-10-24 完成重构）
- 终局方案=GoboSpotLightNode（fork IESSpotLightNode，gobo 乘进 lightColor 走完整 PBR）；注册挂载点=`renderer.nodes.library.addLight(Node, Light)`。TS：Light 真类型 extends，Node 类 mixin (ctor as any)。
- **angle 单位坑：原站 `angle:20` 是弧度直传**（等效 66° 半角），按 20° 解读锥立体角缩 20 倍。
- 配方：双 Mux 视频（灯光版=重度模糊+垂直翻转）+ gobo 聚光灯（intensity 5+三频闪烁，decay 0，penumbra 0.4）+ 键盘纯黑 + GLB 烘焙光池 + bloom(0.54/2/0.78)。gobo 模糊标准：糊到文字不可辨（两级降采样 128→32→blur→放大）。调试口 `#hero?gobo=0`。文件：heroGoboLight.ts/heroConfig/heroScreenLoop/heroScene；heroSpill.ts 已废弃。遗留：键盘亮度略低于原站。

## contact/tie 要点（2026-10-24 完成，commit 系 6dce276→1b0e1e9）
- uikit 断点 sm640/md768/lg1024/xl1280；pixelSize=VH/vh≈0.00708；官方 uikit 必死（GLSL onBeforeCompile），本地自研 TSL uikit。
- uikit 渲染坑：①InterleavedBuffer 多视图偏移≥12 错位→用独立 InstancedBufferAttribute；②vertex buffer 槽上限 8，超限=全黑无报错；③未 ready 纹理进材质=全黑，须白纹理门控；④裁剪=单 vec4 instanceClipRect；⑤字形 quad 左上锚 writeUV=[uvX,uvY+uvH,w,−h]；⑥renderOrder 全靠显式分层（depthTest:false）。
- **cf（话机+壳+灯）必须与 uk 列同级、同滚动居中组**（挂 scene 根高出 9.14 世界单位）。相机 pos y=−p、p=h·VH·(d−1)、phones y=0.55p−6。
- tie→contact 火花转场：握手 AVIF 图集+窗口 SDF（fbm 噪声采样 uv×0.005 藏在 n() 内部，漏乘=高频噪点）；tp=nM(progress,end−1.6,end+0.5)。
- tie 人群=Mux 视频→本地烘焙 public/videos/tie_crowd.mp4；黑底不抠像+边缘 alpha 渐隐。
- 遗留：about-us 纸页原站 8.61 屏 vs 本地 ~29；话机亮度略高；1600×1200 残差 1.99%。

## 用户偏好
- 修视觉问题要求浏览器交互式实测截图目检（拒绝一次性固化验证脚本）。
- 决策风格：给推荐项+讲清取舍，快速拍板。

## 既有问题备忘
- 钢琴 HUD "三角面 0k" 计数没接对数据源（显示 bug，未修）。
- 磁带页 post.js 与钢琴页旧配置同款（共享深度+autoClear+MSAA）隐患，待统一修复。
- 收藏柜 playFocusRing 无拖拽守卫（既有行为，未修）。
