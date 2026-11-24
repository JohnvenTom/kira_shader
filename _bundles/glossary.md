# shader.se 反编译对照表（contact 电话页面专项）

> 部署锁定：`dpl_AadA2KVJaJtKN5QXgQu1gAVrbmig`（2026-10-24 抓取）
> 原文：`_bundles/raw/*.js`（16 chunks）→ 美化：`_bundles/full/*.js`（18.6 万行）
> 站点架构：Next.js + Turbopack + R3F + three r180（魔改，TSL 材质）+ framer-motion motionValue + Lenis
> 本文行号均指 `_bundles/full/` 下对应文件。

---

## 1. 文件索引（本仓库相关 chunk）

| 文件 | 行数 | 内容 |
|---|---|---|
| 04kr7kd5riobb.js | 68383 | **主 chunk**：uikit 全套 + contact 页组件 + 字体管线 + post 管线 |
| 0wb~eqgmow_3x.js | 4843 | usePagesStore（页注册表/页长/页范围）+ 设置 store |
| 01dicf21ljb9q.js | 5251 | 站点配置（module 57781）+ CMS markdown 内容 |

## 2. 页面注册表与滚动架构（0wb:4374-4587, 4694-4713）

页序（length 单位 = 屏）：hero(1) → projects(1) → office(1.8) → about-us(7.3367) → golden-tie-reveal(1.7) → golden-tie(6) → **contact(3.3238571052836656)**

**contact 页配置**（0wb:4556-4586）：
- `renderOffset: {beforeStart: 1.25}`、`pageOffset: {start: -0.9}`、`uiMode: "light"`
- `transition: "fade"`、`transitionLength: 0.3`、`effectOffset: -0.2`、`effectTransitionLength: 0.5`
- effects: noiseVelocity 3.5, noiseIntensity 0.7, bloomThreshold 0.56, bloomIntensity 0.8, bloomRadius 0.72, bloomSmoothing 0.3, sepia 0.5, contrast 0.92, saturation 0.85, lensDistortion 0.16, motionBlur 0.05, pow 1.14, chromaticAberration 1.15, vignette 全 0

**range 累积**（0wb:4694 `h(pages)`）：
```js
range = { start: Σ前页length, end: start + length }
renderRange = { start: range.start - max(renderOffset.beforeStart ?? 0, transitionLength), end: range.end + renderOffset.afterEnd ?? 0 }
```
contact: range.start≈18.8367, end≈22.1606；renderRange.start = 18.8367 - max(1.25, 0.3) = 17.5867。
页激活判定在帧循环逐页套 pageOffset（04kr:67859）：`range.start + (pageOffset?.start ?? 0) <= scroll && range.end + (pageOffset?.end ?? 0) > scroll`。

**setPageLength**（0wb:4813）：`setPageLength(id, t)` 重建 pages 数组与 pagesMap，重算 range。

## 3. contact 页组件 `cp`（04kr:38175-38352）——滚动映射圣经

相机：`nZ({pageType:"contact", type:"perspective", fov:65, near:0.1, far:100, basePosition:[0,0,5]})`

**渲染句柄**（每帧，`e`=page 对象，`o`=全局 scroll motionValue，单位=屏）：
```js
d = e.length                                            // 3.3238
h = clamp(nM(scroll, e.range.start - 1.12, e.range.end - 1, 0, 1), 0, 1)   // 进场相位（-1.12 提前量！）
g = clamp(nM(scroll, e.range.start - 1, e.range.end - 1, 0, 1), 0, 1) * (d - 1)  // 列进度 p（-1 起）
f = clamp(nM(g, s.current - (width>640 ? 120 : 80)/height, s.current + 100/height, 0, 1), 0, 1)
uikitRoot.backgroundColor = `rgba(0,0,0,${f})`          // 黑幕=列背景（挂在 uk 根上）
p = h * viewportHeight * (d - 1)                        // 世界坐标位移量
phonesGroup.position.y = 0.55 * p - 6                   // （t.current = -(-0.55p)-6）
camera.position.set(0.25*mouse.x, 0.25*mouse.y - p, 5)  // 鼠标视差 0.25
camera.lookAt(0, -p, 0)
render scene → fbo (nv({depthBuffer:true})) → 返回 fbo.texture   // = contactRT，火花转场采样它
```
- `s.current` = Hello 块实测高度/viewportHeight（`o` 钩子：`(e.height + 0*A.height)/A.height`）
- 黑幕窗口锚点：`[s − 120px/height, s + 100px/height]`（宽度>640 用 120，否则 80）

**页长上报**（04kr:38235-38246）：内容列容器（height auto, flexGrow 0）挂 `uN` 钩子，`onSizeChange: e => setPageLength("contact", e.height / viewportHeight)`。初始值取 store 里的 3.3238。

**列的居中**（04kr:38250-38255）：外层 group `position = [0, -viewportHeight*g_state*0.5 + 0.5*viewportHeight, 0]`（g_state = 当前 length state）。

**uikit 组件树**（04kr:38247-38351）：
```
uO (group 包裹)
└ group position(见上)
  ├ uk 根：flexDirection column, sizeY=viewportHeight*g, sizeX=viewportWidth,
  │        pixelSize, fontFamilies=o1(stix), color=lightTextColor, depthTest=false,
  │        renderOrder=1, ref=r(黑幕 backgroundColor setProperty), dynamic=true
  │ └ uk 外框：同尺寸, column
  │   └ uk 内容列：column, height "auto", width "100%", flexGrow 0, ref=m(页长测量)
  │     ├ uk Hello 块：column, ref=o(黑幕锚点测量)
  │     │ └ uk column width 100% paddingTop=pageHeight(=100px 折算)
  │     │   ├ uP "“Hello”" fontSize 80/sm100/md140/lg200, center, medium
  │     │   └ uk spacer height=0.95*viewportHeight width 100%
  │     └ uk Good buy 组：column
  │       ├ uk column
  │       │ ├ uk column paddingTop=200 positionType relative
  │       │ │ ├ uP "Good buy." fontSize 80/sm100/md140/lg200 center medium zIndex4 renderOrder1001
  │       │ │ └ cl（遮罩）
  │       │ └ uk backgroundColor black width100% column zIndex2
  │       │   └ ci（三卡+CEO 卡）
  │       └ cg（footer）
  └ cf ref=t（话机群，渲染句柄里的 t.current）
```

## 4. contact 子组件参数

**ci 卡片组**（04kr:37462-37698）：
- 卡标题样式 `uJ({default:{fontSize:18, marginBottom:2, fontWeight:"bold"}, 800:{fontSize:24, marginBottom:4}})`（uJ=视口宽度断点解析，>800 应用第二档）
- intro 文案（`contactMd.intro`，见 §8）：fontSize 18/sm20/md20/lg24, center, maxWidth 480, textBalance, renderOrder 1002
- 卡片容器：maxWidth 1400, paddingY 40, marginTop 16, gap 50, column, center；lg 断点：{gap 50, marginTop 40, row, paddingY 40, alignItems flex-start}
- color = A9（i(53985) 调色板）
- General 卡：lg width 240；标题 "General Enquiries" + mailto hello@shader.se + "Book a call"（cal.com 链接），gap 4 center
- lg 布局：General 独行，下方 row space-between [Visit us, Social]（各 width 240）
- Visit us：street / postalCode+city / country，fontSize 18/lg20
- Social：LinkedIn / Instagram / X (Twitter)
- 容器 lg：paddingBottom 60, paddingX 0；默认 paddingBottom 32, paddingX 30

**cn CEO 卡**（04kr:37700-37835）：marginTop 80(lg)；外框 padding 8 borderWidth 2 radius 4 borderColor transparent（a11y 聚焦时 white）；内框 maxWidth 640, gap 18, row, alignItems center；lg {gap 24, width 640, height 180}；背景 dashed_frame.svg（absolute 100%×100%）；simon_calling.webp 150×150 mL8 my6（lg 200×200 mL16）；"New business" fontSize 19/sm24/lg32 bold；"Reach out today to our CEO for new business enquiries at ceo@shader.se" fontSize 13/sm18/lg24 zIndex10 renderOrder3 depthTest false
- a11y 定位：`setElementPosition(id, contact.range.start + rect.centerY / viewportHeight)`

**cg footer**（04kr:37972-38081）：backgroundColor black, borderTop 1px rgba(245,235,216,0.05), column-reverse, center, paddingX 64 paddingY 64；lg {paddingY 96, row, space-between}；子项：footer_certificate.png（144/lg160/xl232 宽, padding16, xl 前 display none→flex）；copyright_footer.png（256/lg320/xl384 宽）；a11y 卡行（marginBottom 48(lg0), gap 32, center）

**cl 遮罩**（04kr:37845-37890）：uF 容器 absolute top0 left0 right0 bottom:-50 zIndex2 renderOrder1000，内含 1×1 plane + MeshBasicNodeMaterial（transparent, depthTest/Write false, renderOrder 1000），colorNode：
```js
e = pow(smoothstep(0, 0.8, oneMinus(uv.y)), 0.6)
t = mix(1, e, step(0.2, uv.y))
alpha = t   // vec4(0,0,0,t)：底部 20% 全黑，向上 0.8 处淡出
```

**cf 话机群**（04kr:38083-38174）：`nA("/models/phones.glb", nP)`（GLB 原样使用）+ dirt.jpg（RepeatWrapping）
- 材质覆写：green→emissive #0f0×1；red→emissive #f00×1；metallic→rough.4 metal.9 #fff；white→rough.5 metal.0 #fff；black→rough.5 metal.4 #000；shader-logo→rough.0 metal.0；其余 mesh side=FrontSide
- background 材质：MeshStandardNodeMaterial rough.7 metal.6，colorNode = min(bg.map.rgb × (0.5 + dirt(uv×(6.5,5)).g × 1.6 × ?), 1)，再乘 `1 − smoothstep(13, 26, distance(positionWorld, (0,0,-24)))`（距离雾化）
- group：position [0.9, 0, -3.5]；primitive scale 1.1 rotation [0.3, π, 0] position [0, -4, -3]；ambientLight 2.4；pointLight intensity 300 color #fcd position [0,5,0]
- name 含 "background" 的 mesh → 用上面的 background 材质

## 5. uikit React 层（04kr:31648-32330）

| 名称 | 行 | 语义 |
|---|---|---|
| uO | 31901 | 根 group 包裹 |
| uk | 31731 `ux(lW)` | Container（lW extends lT extends THREE.Mesh, 27558/28275） |
| uF | 31732 `ux(l1)` | absolute 容器变体（28552） |
| uP | 31837 | Text（vanillaText + uM props 绑定） |
| u_ | 31790 `ux(l6)` | Image（28795） |
| uN | 31845 | 测量钩子：订阅 component.size 信号 → onSizeChange({width,height}) |
| uU | 31885 | pixelSize = viewportWidth/width；pageHeight = 100*viewportHeight*(0.01/pixelSize)（=100 CSS px 的世界单位） |
| uM | 31674 | vanilla props 绑定：resetProperties、classList、handlers、透明排序 ol |
| uQ | 31648 | renderContext = R3F invalidate（requestFrame） |
| uJ | 32277 | 数字键=视口宽度断点的样式解析（width > key 则应用） |

**组件基类 lT**（27558）：properties 信号、yogaNode、orderInfo/zIndex 排序、4 平面裁剪（`st(this)` → clippingPlanes + customDepth/DistanceMaterial）、frustumCulled=false。
**断点**（04kr:21681）：`{sm:640, md:768, lg:1024, xl:1280, "2xl":1536}`。
**样式层优先级**（oK/oW, 26424/26585-26612）：default < sm/md/lg/xl/2xl < hover/active/focus < class < star-inheritance。

## 6. 布局引擎 = yoga-layout@3.2.1（wasm base64 内嵌）

- 加载（04kr:~2xxx 区）：`yoga-wasm-base64-esm.js`，`file://node_modules/.pnpm/yoga-layout@3.2.1/...` 路径仅为调试标记
- 组件类 o_：`{component, children, yogaNode, layoutChangeListeners, customLayouting, active}`；measureFunc 属性变化 → requestCalculateLayout
- **M2 决策：直接 `npm i yoga-layout@3.2.1`（或 layout 的移植），不自研 flexbox**

## 7. 文字渲染管线（MSDF 位图字体，非 troika）

**资产**（已下载 `_bundles/fonts/`）：
- stix_{regular,medium,bold}.json：BMFont 格式，face "STIX Two Text"/"STIX-Bold"，size 48，atlas 512×512，lineHeight 60/60/77.136，base 36.576/36.576/50.64，**distanceField: {type:"msdf", distanceRange:4}**，89 字符，kerning：regular/medium 0 条、bold 543 条
- stix_{regular,medium,bold}.webp：MSDF 图集（白字+RGB 边缘）

**加载**（oX/oZ, 26727-26758）：fetch JSON → loadAsync(pages[0]) → **texture.flipY=false** → `new o5(json, texture)`；字体表 `o0={normal,medium:bold 路径}`，`o1={stix:o0}`

**实例化**（oB, 25609-25830）：每 (page, depthTest, depthWrite) 一组；InstancedBufferAttribute instanceMatrix(16) + InterleavedBufferAttribute instanceData(25 floats/glyph)：instanceUV(4)+instanceRGBA(4)+instanceClipping0..3(16)+instanceRenderSolid(1)；激活/洞回收/1.5×扩容/decimate(1s 计时, 阈值 count<capacity/3)

**MSDF 材质 oI**（25516-25566，extends MeshBasicNodeMaterial，transparent, depthWrite false, toneMapped false）：
```js
uv = instanceUVOffset.xy + uv() * instanceUVOffset.zw
msdf = texture(page, uv).rgb
dist = (median3(msdf) - 0.5) * distanceRange          // median3 = max(min(r,g), min(max(r,g), b))
screenPx = clamp(length(fwidth(uv * pagePx)) * 0.5, 0, distanceRange*0.5)
alpha = smoothstep(-screenPx, screenPx, dist)
opacity = renderSolid > 0.5 ? 1 : pow(alpha, 1/1.3)    // 锐化 1.3
colorNode = instanceRGBA.xyz
opacityNode = instanceRGBA.w * clip4 * opacity         // clip4 = 4 平面 fwidth smoothstep 连乘
alphaTestNode = 0.001
```

**面板材质**：TSL 函数族 sV（instanced/uniform 裁剪, 24596）、sj（圆角 SDF, 24513）、sz（边框权重, 24534）、sG/sH/sO（边框 SDF 辅助, ~24400-24512）——lT/lW 内创建。**M3 需照此复刻 TSL 面板材质**（backgroundColor/borderColor/borderWidth/radius）。

## 8. 内容常量（01dicf21ljb9q.js module 57781 / 10840）

- address：Laxholmstorget 3, 602 21 Norrköping, Sweden
- emails：general hello@shader.se / ceo ceo@shader.se / secretary@shader.se
- links.bookACall：https://cal.com/filip-kantedal-hd30xa/30min
- social：linkedin.com/company/shadersweden / instagram.com/shadersweden / x.com/shadersweden
- contactMd.intro："Contact us about your digital project idea or general enquires. Let's interface, call us today!"

## 9. 数学助手（04kr:20562-20585）

- nL=clamp(e,t,r)；nM=线性重映射 i+(e−t)(n−i)/(r−t)；nk=lerp；nF=smoothstep；n_=smoothstep 变体
- **实证：滚动窗口 nM 均为线性映射+clamp，无缓动**（与既有备忘一致）

## 10. 待查项（M2/M3 时按需）

- u$（04kr:32300）：按视口宽度的 fontSize 因子表（1600/1500/1400…），消费方未定位
- o5 字体类（26797）的字形布局细节（wordBreak/letterSpacing/lineHeight 实现）
- lW 容器的 yoga 属性全映射（paddingTop→yoga、height:"auto" 等）
- 面板材质 sj/sz 完整读通（圆角/边框几何）
- nZ 场景创建器（20720）：scene.environment 是否有全局 HDR（影响 cf 金属材质表现——原站 metalness 0.9 直出的前提）
- 全局 scroll motionValue 的 Lenis 映射（wheel 0.78 屏/格，备忘既有）
