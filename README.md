# Kira Shader

对 [shader.se](https://shader.se) 的 1:1 复刻：一根全局滚动轴（0 → 22.16 屏）串起 hero、Selected Work、About、golden-tie 与 Contact，全站只有一块画布、一个渲染器（WebGPU + TSL），页面切换靠逐页渲染目标（RT）在合成链里做转场，而不是换路由换场景。

## 路由

| URL | 内容 |
| --- | --- |
| `/` | experience hero（boot 屏首载播放） |
| `/#hero` | 同上（显式锚点） |
| `/#selected-work` | Selected Work 胶片页停驻点 |
| `/#about-us` | About（纸卷 / 碎纸机 / golden-tie） |
| `/#contact` | Contact（电话 3D + 联系页脚） |
| `/work/<slug>` | 项目详情子页（同一 experience，胶片在底下、详情作为 subPage 叠加） |

hash 只决定 experience 的初始轴位与主题，组件在路由之间不重挂载。旧锚点（`#film`、`#home`、`#work`、`#about` 等）不做兼容重定向，统一按未知 hash 落到 hero。

## 运行

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc -b + vite build
npm run preview
```

- 默认走 `WebGPURenderer`；不支持 WebGPU 时自动回退 WebGL，也可以用 `?gl=webgl` 强制回退。
- `/` 等入口的 boot 屏点击后起播 BGM（首次手势自动播放，boot 第 5 行切到 `AUDIO: ON`）。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 框架 | React 19.3、TypeScript 5.6、Vite 5.4 |
| 3D | Three.js 0.169（`three/webgpu` + `three/tsl`） |
| 滚动 | Lenis（阻尼追随） |
| UI 排版 | yoga-layout（Canvas 内 UI 布局） |
| 资源 | GLB（Draco 压缩）、HLS 抽帧视频、WebP/PNG 纹理、WOFF2 字体 |

## 项目结构

```
src/
├── main.tsx                 # 唯一入口：pathname + hash → experience 初始模式
├── work-about/
│   ├── WorkAboutExperience.tsx  # 全站主轴：逐页 RT、合成转场、UI 时序
│   ├── paperScene / shredderScene / goldenTieScene / goldenTieRevealScene
│   ├── navUiScene.ts / uiCanvas.ts  # Canvas 内导航与 HUD
│   └── AboutUI.tsx / about.css
├── hero/                    # hero 场景：机体、屏幕循环、灯光、boot 屏（TSL）
├── selected-work/           # Selected Work 胶片场景与标题纹理
├── work-detail/             # /work/<slug> 子页：数据、视频纹理、boot 覆盖层
├── about/                   # Contact（电话机）与旧 office 场景资源
├── uikit/                   # WebGPU 2D UI 内核（MSDF 文字、面板、导航条）
├── boot/                    # boot 状态机 + BIOS 屏着色器 + 字体图集
├── components/tape/tapeAudioStore.ts  # BGM 单例（歌单 / 播放态）
└── styles.css               # 全局基础样式（字体 / 重置 / 根令牌）
public/
├── asset/                   # hero/模型/纹理/字体/Draco/BGM 音频
├── textures/                # 站点贴图（about / projects / icons …）
├── videos/                  # golden-tie 人群视频与预烘焙 handshake 帧
└── work-media/              # /work/<slug> 项目视频（mux mp4）
```

根目录另有 5 个开发/诊断入口：`starlab.html`、`uikitlab.html`、`uikitlab-nav.html`、`wd-textlab.html`、`wgpu-smoke.html`。

## 关键实现

- **单轴滚动 + 逐页 RT**：每页场景渲染到自己的 render target，合成链按原站 `sceneMode` 的四种转场（fade / direct / overlay / below）采样当前页与下一页，转场长度与页面边界按原站 `renderOffset.beforeStart` 复现。
- **boot 屏**：`heroBootPass` 用轻量 WebGL 渲染同一段 BIOS 着色器；boot 只在本页首次加载播放，路由进入其他段时 `skipBoot()` 直接收敛。
- **About 纸卷 + 碎纸机**：纸张内容由 Canvas 2D 排版后贴到纸面，折页用 alpha 覆盖度驱动；碎纸机是独立 Verlet 模拟（192×64 sim RT），宿主在每帧重新绑定 aboutRT 后合成。
- **Canvas 内 UI**：导航、Book a call、箭头与 hint 均由 uikit 渲染器绘制进合成层，命中区域按主题分层维护；它直接调用导航 API，不写 hash。
- **项目子页**：`/work/<slug>` 复用同一渲染循环，视频纹理经 mux 转码后本地播放；打开/关闭走 subPage spring，主画布不卸载。

## License

本项目为个人技术展示项目，参考 [shader.se](https://shader.se) 的视觉与交互风格；模型、字体、视频等资源版权归原作者所有，请勿用于商业用途。
