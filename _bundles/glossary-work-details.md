# shader.se /work/[slug] 详情页反编译对照表（work-details 专篇）

> 部署锁定：`dpl_AadA2KVJaJtKN5QXgQu1gAVrbmig`（2026-10-28 复核仍一致）
> 原文：`_bundles/raw/*.js` → 美化：`_bundles/full/*.js`（主 chunk 04kr 68383 行）
> 本文行号均指 `_bundles/full/` 下对应文件；先例见 `glossary.md`（contact 页）。
> 架构：Next.js + Turbopack + R3F + three r180（TSL 材质）+ framer-motion motionValue + Lenis。

---

## 1. 顶层：详情页是主 experience 的 **subPage**（非独立 canvas）

- 详情页路由 `/work/[slug]` 挂进**同一个引擎实例**，以 `subPage = {type:"project", project, pageCount}` 表示（0wb:4798 `subPage: d`）。
- 页配置不在 pagesConfig 里，而是 **subPageEffectsMap**（0wb:4684）：`{ project: a, "not-found": o, "accessibility-statement": l }`。
- **subPageTransition**（0wb:4801 `m`）：subPage 置位 → `animate(m, 1, spring {damping:20, stiffness:85, delay:0.1(异类型时)}, restDelta)`；归零后 `previousSubPage.set(null)`（0wb:4766-4785 b 函数）。`subPageTransitionIsDone` 完成置位。
- 首次进站（"main"）的 initialTransition spring 是 **damping 8 / stiffness 30**（0wb:4777-4779）——与本地 bootStore 逆向参数一致 ✓。

## 2. 全局后期参数（projectPageEffectsConfig，0wb:4609-4627，变量 a）

```js
{ noiseVelocity: 1, noiseIntensity: 0.9,
  sepiaIntensity: 0.1,
  bloomThreshold: 0.92, bloomIntensity: 0, bloomRadius: 0.8, bloomSmoothing: 0.2,   // bloom 关
  contrast: 1, brightness: 1, saturation: 1,
  motionBlur: 0.2,
  lensDistortion: 0.16, lensDistortionBorders: 0,
  pow: 1.4,
  chromaticAbberationStrength: 0.5,
  vignetteRadius: 0, vignetteSmoothness: 0, vignetteIntensity: 0 }                   // 无 vignette
```
对比 contact（noiseVelocity 3.5 / bloomIntensity 0.8 / sepia 0.5 / CA 1.15 / pow 1.14）——**差异巨大，这就是"后期不一样"的根源**。

## 3. 顶层组件 `p7`（04kr:63035+，项目页 experience 根）

- **三个场景**：
  1. `p9` × 2（**双实例**：当前项目 + 上一项目，供换页转场）
  2. 正交全屏合成场景：ortho camera（±1，z=1）+ 2×2 quad
- **换页转场**（p7 内 subPage change 监听）：uid 变化 → `isTransitioning=1`，`animate(h, 1, {duration: 2, ease:"easeInOut"})`，Lenis `scrollTo(0, immediate)`，实例指针 `d = 1-d` 翻转；2s 后 isTransitioning=0。
- **Escape 键** → `router.push(getMainPageHref("projects"), {scroll:false})`。
- 逐帧（imperativeHandle）：current/previous 两实例各渲 FBO → 合成 quad uniforms（projectSceneTexture / previousProjectSceneTexture / currentTexture=d / projectTransition=h / subPageTransition / progress=useScrollStore.projectPage.scrollProgress）。

## 4. 合成 quad 材质 `b`（04kr:63100+，TSL colorNode）

```js
e = vec2(uv.x, 1-uv.y)
// 非转场：内容亮度随入场渐起
A = texture(projectSceneTexture, e).rgb * (0.5 + 0.5 * subPageTransition)
// 转场：3D 卷页（n 函数，radius=0.15，π 弧）
s = curl(projectTransition, e, 1, vec3(1,1,1), pivot=vec2(-1, 0.5))
o = texture(previousProjectSceneTexture, e)
l = smoothstep(0,1,projectTransition) * 0.6          // 旧页压暗
u = mix(mix(o, vec4(0,0,0,1), l), s, s.a)
out = mix(A, u, isTransitioning)
```
卷页函数 `n`（04kr:63110-63190）：圆柱卷动 SDF——`h=1+0.15*4`（卷径放大 1.6），背面着色 `w*0.25 + tint*vec3(0.8,0.75,0.6)`，边缘 `smoothstep(0, 0.3, ...)` 软影。

## 5. ProjectScene 渲染句柄 `p9`（04kr:62575+）

- 相机：`nZ({pageType:"project", type:"perspective", fov:65, near/far 默认, basePosition:[0,0,5]})`
- **相机沿 X 平移**（landscape）：`position.x = t * viewportWidth`，`lookAt(t*vw, 0, 0)`；portrait 沿 Y（`position.y = -t*vh`）——t = projectPage.scrollProgress
- **相机 Z 飞入**：`B = pJ(subPageTransition, [0,1], [10,5])`（z: 10→5），速度弹簧跟随：
  `n = 1 - exp(-6*dt)`；`s = clamp(-0.2*vel, -0.35, 0.35)`；`p = B + 6*s`；`b += (p-b)*n`（Z 用 b）
  第二组：`v = pJ(subPageTransition, [0,1], [0, 0.2])`（GrainPass 相机 y 偏移），同弹簧（钳 ±0.03）
- GrainPass 相机：fov65 basePosition [0,0,10]，`position.x = 0.1*w.x`、`position.y = S - 0.1*w.y`（w = 鼠标视差 ref）
- 两个 hook：`n0({scene, camera, fbo, hookId:"ProjectScene"/"ProjectGrainPass"})`
- **pageCount 上报**：`pageCount = 内容宽 / viewportWidth`（landscape）/ `内容高 / viewportHeight`（portrait）→ 写回 subPage.pageCount

### 5.1 内容条（uikit 根，横屏）

- 背景板：`nf` mesh **50×50** @ **z=-10**，color `rgb(250,250,242)`（#FAFAF2）
- uikit 根 `uk`：横屏 `position.x = 7*vw*0.5 - 0.5*vw`，`sizeX = 7*viewportWidth`（**内容条总宽 = 7 个视口**），sizeY = vh；竖屏 sizeY = 7*vh
- 根样式：`gap:32, paddingTop:80(横)/160(竖>640)/130(竖), paddingLeft:120(横)/48(竖)/28(窄), paddingRight:100(横)/48/28, color:"#2B2B29", flexDirection:"row"(横)/column(竖), alignItems:"center", height:"100%", marginY:"auto"`
- 内层：`height:"100%", maxHeight: min(900, u.height-200)`（横屏）
- **文字块**：`width:750, paddingLeft:60, paddingRight:32, marginRight:60, flexShrink:0, flexDirection:column`
  - 顶部垫高 60
  - **标题 uP**：`fontSize:58/58px, sm:64/64px, lg:100/100px`（特例：SON 标题 <512px 宽断词 "Norrköpings Symfoni- orkester"）
  - **副标题 uP**：`fontSize:26, lg:32, maxWidth:"80%"`，内容 = `subtitle + (collaborator ? " with "+collaborator : "")`
  - **描述容器 uP**：`fontSize:16/24px, gap:20, marginTop:16, lg:{marginTop:32, fontSize:20, lineHeight:"28px"}, maxWidth:"80%"`，children = `description.split("\n")`（字面 \n 分段，`textBalance:false`）
  - **Visit site 行**：`marginTop:20(横)/32(lg), alignItems:center`，内含 `p8`
- **媒体条 `p2`**（04kr:62406）：`project_media.filter(p5 去重)` → uikit `flexDirection:row(横)/column(竖), gap:32, flexShrink:0, height:"100%"`
- **Next Project 面板 `pq`**（04kr:62023，project=下一项）：
  - label uP：`fontSize:20/20px, marginBottom:-8, lg:30/30px/-10`，外框 uk `borderColor:"#444", borderBottomWidth:1`
  - 标题 uP：`fontSize:60/60px, md:72/72px, lg:100/100px, marginTop:46(lg)/32, fontWeight:"medium", textAlign:"center"`
  - 副标题：`fontSize:32/32px`（另一处 26?——pq 内为 32），`with collaborator` 同规则
  - 横屏尺寸：`width:800`（`w = isPortrait ? "auto" : "100%"` 外层，`Q = m ? "100%" : 800`），paddingLeft 72 / paddingRight 28
- **`uG` 分隔线**：仅 portrait，`width:"130%", marginBottom:32, marginLeft/-Right:-32`

### 5.2 颗粒 quad（ProjectGrainPass 场景内容，04kr:62738-62752）

- mesh：`planeGeometry [2*viewportWidth, 2*viewportHeight]` + 材质 M（`MeshBasicNodeMaterial, toneMapped:false, transparent:true`）
- uniforms：`contentTexture`（ProjectScene FBO）、`dimensions`（像素）、`progress`、`isPortraitDisplay`
- 噪声源：`n7()` 噪声纹理 512 周期查表：`n(e) = texture(uNoiseTex, fract(e/512)).r`
- **TSL colorNode**（04kr:62714-62760 全文）：
  ```js
  e = texture(contentTexture, viewportUV)
  r = mix(vec3(1), e.rgb, e.a)                    // 内容按 alpha 盖到白底
  i = vec4(r, 1); s = i.rgb
  o = vec3(0.12,0.1,0.08)*0.5                     // 暗端
  l = vec3(0.99,0.97,0.93)                        // 亮端（纸色）
  u = clamp(s,0,1).pow(1)*0.8
  i.rgb = o + u*(l-o)                             // ★纸色映射
  A = vec2(uv.x, 1-uv.y)
  c = dimensions * 2
  d = vec2(progress*0.5*(1-portrait), progress*0.5*portrait)   // 颗粒随滚动平移
  h = A + d
  g = grainFn(h, c)                               // 三层颗粒（下）
  f = dot(i.rgb, vec3(1/3)); p = 1-f
  E = smoothstep(0.55, 0.98, f)                   // 亮区因子
  I = smoothstep(0.15, 0.9, p)                    // 暗区因子
  y = E*0.3 + 0.95 ; C = I*1.6 + 1 ; S = clamp(1 + E*(4-1) + I*(1-1), 0.05, 3)
  m = mix(1, 1.15, e.a)                           // 内容区颗粒略强
  x = 1 + g * 0.22 * y * C * m * S * 1            // ★主颗粒应用
  w = h * c
  Q = n(vec2(w.x*1.27 + w.y*0.81, w.x*(-0.73) + w.y*1.11))
  R = smoothstep(0.66,0.98,Q) * smoothstep(0.55,0.98,p) * 0.05  // ★纸张纤维（暗部）
  i.rgb = i.rgb * x + vec3(R)
  out = clamp(i, 0, 1)
  ```
  grainFn(a, c)（04kr:62706-62720）：
  ```js
  r = a*c
  a1 = n(floor(r*0.5))*0 + n(r*0.25)*0.05          // 低频 5%
  s1 = n(a*c*0.6)*0 + n(a*c*0.03)*0.05             // 超低频 5%
  u1 = smoothstep(0.52,0.92, n(r*vec2(1.43,0.77))*0.59 + n(r*vec2(0.61,1.31)+vec2(19.2,7.4))*0.41) * 0.25
  return a1 + s1 - u1*0                            // u1 乘 0（保留未启用）
  ```

## 6. 媒体卡 `p1`（04kr:62218-62405）

- **视频源**：`fq({src: https://stream.mux.com/{id}.m3u8?max_resolution={档位}, options:{autoplay:false, muted:true, loop:true}})`
  档位：reducedMemoryMode→480p；innerWidth<700→720p；否则 **1080p**
- 缩略图先行：`projectThumbnailTextures[id]`（预载的 mux 图）→ uImageOpacity 1 / uVideoOpacity 0
- 入视口播放：updateHandle 每帧把卡片世界坐标投到 NDC，`|x|<1 && |y|<1` → visible → 交叉淡入 `animate(h,1,{duration:0.5})` 后 `play()`；不可见 → `pause()`
- **宽比**：uAspectRatio = 实测 videoWidth/videoHeight（缺省 `p0 = 4/3` @62217），写回 aspectRatio 布局
- 清理：停播 + 1s 后 dispose（<700px 宽不 dispose）
- **TSL 材质**：盒 SDF（`i=(uv-0.5)*vec2(aspect,1)`，`a=max(|i.x|-aspect/2, |i.y|-0.5)`）
  `out = mix(vec4(mix(thumb, video, uVideoOpacity), step(a,0)), vec4(0,0,0,0.1), step(-0.002,a))`
  —— **0.002 软边 + 0.1 alpha 羽化边框**
- 节点：uk（aspectRatio 布局）→ uF（absolute inset 0）→ nf mesh（userData.color #fff）

## 7. Visit site `p8`（04kr:62513-62550）

- u5 按钮：`variant:"underline", size:"sm", textStyle:{fontWeight:"normal", fontSize:24, lineHeight:"24px"}, iconSrc:"/textures/icons/external_link.svg", iconPosition:"right", iconStyle:{marginBottom:0}, padding:2, borderWidth:2, borderRadius:4, borderColor:focus?"black":"transparent"`（a11y 聚焦描边，非聚焦透明）
- 仅 `project.site_link?.url` 存在才渲染；点击 → 打开外链

## 8. 入口（projects 页 → 详情）

- a11y 焦点映射（12vmxu4i7:25-31）：`"projects-view": "projects"`——按钮 id `projects-view`
- 原站交互实证：projects 页标题下 "View Project" → 客户端路由 /work/<slug>
- **转场**：subPage 置位 → subPageTransition spring(20/85, delay 0.1) → 合成层亮度 0.5→1 + 相机 z 10→5（§5）——**不是星星转场**，是亮度+推入的组合
- Local: 详情页 Close → `getMainPageHref("projects")` = `/#selected-work`（原站实证一致 ✓）

## 9. 本地复刻映射（WebGPU 栈）

| 原站构件 | 本地对应 |
|---|---|
| nZ 相机/场景工厂 | WorkAboutExperience 同款（本地已有） |
| uikit（uk/uP/uF/nf/uG/u5） | 本地 uikit（src/uikit/*，home 已用） |
| p9 双场景 FBO | heroCompose 多场景 FBO 合成链（已有） |
| 颗粒/合成 TSL | 新建 TSL 材质（§5.2 公式逐行移植） |
| projectPageEffectsConfig | 本地 post 链参数（heroCompose 可配） |
| subPage/subPageTransition | 本地 store（zustand 或 motion value） |
| p1 视频卡 | HLS→VideoTexture（本地 fq 等价物需查 hls.js 是否在依赖） |
| fq HLS 加载器 | 待确认：项目内是否已有 hls.js（tie_crowd 是本地 mp4；mux 直链需 hls.js） |

## 10. 待补取证

- [ ] `projectPage.scrollProgress` 精确映射（useScrollStore——y/length/页内进度换算）
- [ ] projects 页 View Project 按钮的 uikit 规格（projects 页组件区 66119-66455 附近）
- [ ] 噪声纹理 n7() 的来源（程序化 or 贴图——本地可用同 hash 生成 512²）
- [ ] detail 页导航条（Close 按钮的 uikit 规格 + navbar-close 行为）
- [ ] fq（HLS 加载器）实现确认（hls.js 依赖）
- [ ] reducedMemoryMode 阈值
