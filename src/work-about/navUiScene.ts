/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import { UIKitRenderer } from '../uikit/renderer.ts';
import { buildNavBar, loadNavBarFonts, type NavBarKit, type NavBarTickState, type NavItemId } from '../uikit/navBar.ts';

/**
 * navbar UiScene（原件 EP 的 1:1 结构）：uikit 导航树 → 独立场景 → light/dark 两张全屏
 * RT → 合成器 setUiTextures 槽位（uiMode mix / hover 区域提亮 / 畸变采样全在合成器，复用）。
 *
 * 相机/坐标（原件 EP）：fov65、相机 [0,0,5] → 视口世界高 VH = 2·5·tan(32.5°) ≈ 6.371；
 * uikit pixelSize = VH / viewportHeight（z=0 平面 1 CSS px = VH/vh 世界，与 contactScene 同款）。
 *
 * 命中：P1 由区域表（CSS px）承担——布局后从 uikit 世界矩形反推 CSS 表，
 * 注入 uiCanvas 的 regions（键名与现有分发 switch 对齐：logo/navHome/.../burger/book/menuXxx）。
 */

const FOV = 65;
const CAM_Z = 5;
const VH = 2 * CAM_Z * Math.tan(((FOV / 2) * Math.PI) / 180);

export interface NavRegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NavRegionKey =
  | 'logo' | 'navHome' | 'navWork' | 'navAbout' | 'navContact'
  | 'book' | 'burger' | 'menuHome' | 'menuWork' | 'menuAbout' | 'menuContact';

export interface NavUiSceneHandle {
  lightTexture: THREE.Texture;
  darkTexture: THREE.Texture;
  /** 布局后导出的命中区域（CSS px；menu 项仅 menuT>0 时有效） */
  regions: Partial<Record<NavRegionKey, NavRegionRect>>;
  /** 每帧驱动：状态推进 → yoga 重排 → 镜像更新 → 双 RT 渲染 */
  update(state: NavTickInput, dt: number, renderer: THREE.WebGPURenderer): Promise<void>;
  setSize(w: number, h: number): void;
  dispose(): void;
}

export interface NavTickInput {
  activeNav: NavItemId | '';
  menuT: number;
  logoHover: number;
  actionHover: number;
  /** 主题阻尼值 0..1（合成器 uiMode 已做 mix，此处仅决定 hit 表取哪层：≥0.5 用 dark） */
  uiMode: number;
}

export async function createNavUiScene(width: number, height: number): Promise<NavUiSceneHandle> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, Math.max(1, width) / Math.max(1, height), 0.1, 100);
  camera.position.set(0, 0, CAM_Z);
  camera.lookAt(0, 0, 0);

  const lightGroup = new THREE.Group();
  const darkGroup = new THREE.Group();
  scene.add(lightGroup, darkGroup);

  const fonts = await loadNavBarFonts();
  let vw = Math.max(1, width);
  let vh = Math.max(1, height);
  const ps = () => VH / Math.max(1, vh);

  const lightUikit = new UIKitRenderer({ pixelSize: ps(), color: '#FDFDF5' });
  const darkUikit = new UIKitRenderer({ pixelSize: ps(), color: '#171310' });
  lightGroup.add(lightUikit.rootObject);
  darkGroup.add(darkUikit.rootObject);

  let lightKit: NavBarKit | null = null;
  let darkKit: NavBarKit | null = null;
  const rebuild = () => {
    lightKit = buildNavBar(fonts, vw, vh, false);
    darkKit = buildNavBar(fonts, vw, vh, true);
    // 挂载前解析断点样式 + 文字 measure（否则 __textResolved 缺失，renderer 建镜像抛错）
    lightKit.root.applyViewport(vw);
    darkKit.root.applyViewport(vw);
    lightUikit.mount(lightKit.root);
    darkUikit.mount(darkKit.root);
    lightKit.relayout(vw);
    darkKit.relayout(vw);
    lightUikit.update();
    darkUikit.update();
  };
  rebuild();

  // ---- RT（全屏，透明底，dpr ≤1.5 与 uiCanvas 一致）----
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let rtW = Math.max(1, Math.floor(width * dpr));
  let rtH = Math.max(1, Math.floor(height * dpr));
  const makeRT = () => {
    const rt = new THREE.WebGLRenderTarget(rtW, rtH, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.SRGBColorSpace,
    });
    return rt;
  };
  let lightRT = makeRT();
  let darkRT = makeRT();

  const regions: Partial<Record<NavRegionKey, NavRegionRect>> = {};

  /** uikit 世界矩形 → CSS px（UiScene 相机 z=0 平面；x/y 已换算，w/h 也必须乘 CSS/世界比） */
  const worldToCss = (r: { cx: number; cy: number; w: number; h: number }): NavRegionRect => {
    const worldW = VH * (vw / Math.max(1, vh));
    const scale = vh / VH; // CSS px / 世界单位（= 1 / pixelSize）
    return {
      x: ((r.cx - r.w / 2) / worldW + 0.5) * vw,
      y: (0.5 - (r.cy + r.h / 2) / VH) * vh,
      w: r.w * scale,
      h: r.h * scale,
    };
  };

  const exportRegions = () => {
    for (const k of Object.keys(regions) as NavRegionKey[]) delete regions[k];
    if (lightKit == null) return;
    const h = lightKit.handles;
    const put = (key: NavRegionKey, el: Parameters<UIKitRenderer['getElementWorldRect']>[0]) => {
      const r = lightUikit.getElementWorldRect(el);
      if (r && r.w > 0 && r.h > 0) regions[key] = worldToCss(r);
    };
    put('logo', h.logoBtn);
    // 水平导航项仅在 lg 布局（>0 尺寸时导出）
    const navKeys: NavRegionKey[] = ['navHome', 'navWork', 'navAbout', 'navContact'];
    h.navItemCols.forEach((it, i) => put(navKeys[i], it.col));
    put('book', h.bookBtn);
    put('burger', h.burgerBtn);
    // 菜单项（menuT>0 时面板可见；仍常驻导出——hit 层按 menuOpen 门控）
    const menuKeys: NavRegionKey[] = ['menuHome', 'menuWork', 'menuAbout', 'menuContact'];
    h.menuItems.forEach((it, i) => put(menuKeys[i], it.el));
  };

  const api: NavUiSceneHandle = {
    lightTexture: lightRT.texture,
    darkTexture: darkRT.texture,
    regions,
    async update(state, dt, renderer) {
      const st: NavBarTickState = {
        menuT: state.menuT,
        activeNav: state.activeNav,
        logoHover: state.logoHover,
        actionHover: state.actionHover,
        dark: state.uiMode >= 0.5,
      };
      lightKit?.tick(st, dt);
      darkKit?.tick(st, dt);
      lightKit?.relayout(vw);
      darkKit?.relayout(vw);
      lightUikit.setPixelSize(ps());
      darkUikit.setPixelSize(ps());
      lightUikit.update();
      darkUikit.update();
      exportRegions();
      // 双 RT 渲染（透明清屏；uikit 面板自身 alpha 决定覆盖）
      lightGroup.visible = true;
      darkGroup.visible = false;
      renderer.setClearColor(new THREE.Color(0, 0, 0), 0);
      renderer.setRenderTarget(lightRT);
      await (renderer as any).renderAsync(scene, camera);
      lightGroup.visible = false;
      darkGroup.visible = true;
      renderer.setRenderTarget(darkRT);
      await (renderer as any).renderAsync(scene, camera);
      renderer.setRenderTarget(null);
    },
    setSize(w, h) {
      vw = Math.max(1, w);
      vh = Math.max(1, h);
      rtW = Math.max(1, Math.floor(w * dpr));
      rtH = Math.max(1, Math.floor(h * dpr));
      lightRT.setSize(rtW, rtH);
      darkRT.setSize(rtW, rtH);
      camera.aspect = vw / Math.max(1, vh);
      camera.updateProjectionMatrix();
      rebuild();
    },
    dispose() {
      lightUikit.dispose();
      darkUikit.dispose();
      lightRT.dispose();
      darkRT.dispose();
    },
  };
  return api;
}
