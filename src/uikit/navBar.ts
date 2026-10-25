/**
 * navbar uikit 组件树 —— shader.se 导航栏 1:1 反编译还原（P1）。
 *
 * 反编译来源（_bundles/full/04kr7kd5riobb.js + raw 01dicf，全值见 .workbuddy/memory/2026-10-25.md）：
 *   EB 容器（66768）   ：height 64/sm100、paddingX 8/sm20、marginTop 6、borderBottomWidth 2、
 *                        borderColor light rgba(255,255,255,.14) / dark rgba(0,0,0,.05)、color #FDFDF5
 *   logo（Ev，66803）  ：u_ 图宽 160/sm190、按钮框 2 圆角 4 padding 3、hover 边框亮 0.1s
 *   导航项（Ed，66438）：ED=[hero,projects,about-us,contact]、文案 ER={Home/Selected Work/About Us/Contact}、
 *                        文字 18/lg20 medium mb-6/lg-8 + 下划线条(width 100%, height 2)；
 *                        **下划线 = 非当前项显示**（opacity = 1 − spring(active?1:0, damping25 stiffness200)，
 *                        1600/1440 实测：当前项（Home）无下划线、其余有——反编译与实测互证）
 *   Book a call（Ep）  ：lg 显示；按钮 gap16 框2圆角4 + old_phone 图标 28×28 + 文字 18 medium opacity .95 underline
 *   汉堡菜单（Ew，66886）：<1280 显示（实测修正：1280 视口原站为汉堡、1440 为水平项——uikit lg 样式
 *                        在原站根宽语义下实际生效 ≥1280）；按钮 64×64 padding8 + menu 图标 24；
 *                        面板 absolute top60(+4·t) right8 width200 黑底框1(rgba(255,255,255,.3)) 圆角4
 *                        overflow hidden；项 padding16 borderBottom(rgba(255,255,255,.3)，末项无) +
 *                        文字 18 mb-8；开合 0.3s：opacity 0↔1、top 60↔64、罩 rgba(0,0,0,.25) 同步
 *
 * 主题：light/dark 两份树同时构建（原站两个 UiScene），由合成器按 uiMode mix。
 * 命中：P1 复用 uiCanvas 区域表（布局同源反编译值），本文件导出元素引用供 rect 校验。
 */
import YGPackage from 'yoga-layout';
import { UIElement } from './element.ts';
import { loadFont, type UIKitFont } from './font.ts';

const YG = (YGPackage as any).default ?? YGPackage;

export const NAV_ITEMS = [
  { id: 'hero', label: 'Home' },
  { id: 'projects', label: 'Selected Work' },
  { id: 'about-us', label: 'About Us' },
  { id: 'contact', label: 'Contact' },
] as const;

export type NavItemId = (typeof NAV_ITEMS)[number]['id'];

const LOGO = { light: '/logo-shader.svg', dark: '/textures/logo_dark.svg' };
const MENU_ICON = { light: '/textures/icons/menu.svg', dark: '/textures/icons/menu_dark.svg' };
const PHONE_ICON = { light: '/textures/icons/old_phone.svg', dark: '/textures/icons/old_phone_dark.svg' };
/** logo svg 纵横比（viewBox 1285×173 / 306×41，两者 ≈7.43） */
const LOGO_ASPECT = 173 / 1285;
/** Book a call 外链（P2 跳转状态机用） */
export const BOOK_URL = 'https://cal.com/filip-kantedal-hd30xa/30min';
/** 主题墨色：light=亮字（深场景）/ dark=纸页深字（对齐 uiCanvas INK） */
const INK = { light: '#FDFDF5', dark: '#171310' };

export interface NavBarElementHandles {
  root: UIElement;
  /** 命中/动效目标元素 */
  logoBtn: UIElement;
  logoImg: UIElement;
  navItemCols: { id: NavItemId; col: UIElement; underline: UIElement }[];
  bookBtn: UIElement;
  burgerBtn: UIElement;
  menuPanel: UIElement;
  menuOverlay: UIElement;
  menuItems: { id: NavItemId | 'book'; el: UIElement }[];
}

export interface NavBarTickState {
  /** 菜单开合 0..1（0.3s easeInOut 由调用方推进） */
  menuT: number;
  /** 当前页（下划线 spring 目标） */
  activeNav: NavItemId | '';
  /** hover 阻尼值（调用方由 hitTest 驱动） */
  logoHover: number;
  actionHover: number;
  /** 主题（换图标 url；重建树之外的轻量切换） */
  dark: boolean;
}

/** 下划线 spring（原站 useSpring damping25 stiffness200 的欧拉近似） */
class Spring {
  x: number;
  v = 0;
  constructor(public target: number, initial?: number) {
    this.x = initial ?? target;
  }
  tick(dt: number): number {
    const stiffness = 200;
    const damping = 25;
    const a = stiffness * (this.target - this.x) - damping * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export interface NavBarKit {
  /** 全屏 uikit 根（外部 mount 到 UIKitRenderer） */
  root: UIElement;
  handles: NavBarElementHandles;
  /** 每帧推进 spring/hover/菜单动画（改元素 style；外部随后调 renderer.update() 应用） */
  tick(state: NavBarTickState, dt: number): void;
  /** 视口变化重排（yoga） */
  relayout(vw: number): void;
}

export function buildNavBar(fonts: { medium: UIKitFont; bold: UIKitFont }, vw: number, vh: number, dark: boolean): NavBarKit {
  const sm = vw >= 640;
  const lg = vw >= 1280; // 实测修正断点（1280 汉堡 / 1440 水平）
  const ink = dark ? INK.dark : INK.light;
  const borderColor = dark ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.14)';
  const logoUrl = dark ? LOGO.dark : LOGO.light;
  const logoW = sm ? 190 : 160;

  // ---- 全屏根 ----
  const root = UIElement.container({ width: vw, height: vh, flexDirection: 'column' });

  // ---- 菜单全屏罩（menuT 驱动 opacity；渲染序在 bar 之下） ----
  const menuOverlay = UIElement.container({
    positionType: 'absolute',
    positionTop: 0,
    positionLeft: 0,
    width: vw,
    height: vh,
    backgroundColor: 'rgba(0,0,0,0.25)',
    opacity: 0,
  });

  // ---- EB navbar 容器 ----
  // 注意：不写 width:'100%' —— element 是 content-box（原站 DOM 语义），'100%'+padding 会溢出 2×padding；
  // column 父下默认 cross stretch 已把宽度拉满（含 padding 内缩）
  const bar = UIElement.container({
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: sm ? 100 : 64,
    paddingX: sm ? 20 : 8,
    marginTop: 6,
    borderBottomWidth: 2,
    borderColor,
    color: ink,
  });

  // ---- logo（Ev）----
  const logoBtn = UIElement.container({
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 4,
    padding: 3,
    borderColor: 'transparent',
  });
  const logoImg = UIElement.image(logoW, LOGO_ASPECT, { marginLeft: 4, marginRight: 4 }, logoUrl);
  logoBtn.add(logoImg);

  // ---- 水平导航项（Ed ×4，lg 显示）----
  // gap 实测：原站 1600 截图逐列扫描，项间净空恒 45px（早先记的 24 是误值）
  const navItemCols: NavBarElementHandles['navItemCols'] = [];
  const navRow = UIElement.container({
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 45,
    display: lg ? 'flex' : 'none',
  });
  for (const item of NAV_ITEMS) {
    const col = UIElement.container({ flexDirection: 'column' });
    const txt = UIElement.text(item.label, { font: fonts.medium, fontSize: lg ? 20 : 18 }, { marginBottom: lg ? -8 : -6 });
    const underline = UIElement.container({
      width: '100%',
      height: 2,
      backgroundColor: ink,
      opacity: 1,
    });
    col.add(txt, underline);
    navRow.add(col);
    navItemCols.push({ id: item.id, col, underline });
  }

  // ---- 右侧组（Book a call / 汉堡）----
  // yoga 默认 flexDirection=column（与 DOM CSS 的 row 默认不同），必须显式 row
  const right = UIElement.container({
    flexDirection: 'row',
    width: sm ? 198 : 90,
    justifyContent: 'flex-end',
    alignItems: 'center',
    positionType: 'relative',
  });

  // Book a call（Ep，lg 显示）
  const bookWrap = UIElement.container({ display: lg ? 'flex' : 'none', ...(lg ? { gap: 24 } : {}) });
  const bookBtn = UIElement.container({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderWidth: 2,
    borderRadius: 4,
    padding: 6,
    borderColor: 'transparent',
  });
  const phoneImg = UIElement.image(28, 1, {}, dark ? PHONE_ICON.dark : PHONE_ICON.light);
  const bookTextWrap = UIElement.container({ borderBottomWidth: 1, paddingBottom: 4 });
  bookTextWrap.add(UIElement.text('Book a call', { font: fonts.medium, fontSize: 18 }, { opacity: 0.95 }));
  bookBtn.add(phoneImg, bookTextWrap);
  bookWrap.add(bookBtn);

  // 汉堡（<lg 显示）
  const burgerWrap = UIElement.container({
    display: lg ? 'none' : 'flex',
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
    positionType: 'relative',
  });
  const burgerBtn = UIElement.container({
    padding: 8,
    borderWidth: 2,
    borderRadius: 4,
    borderColor: 'transparent',
  });
  const menuImg = UIElement.image(24, 1, {}, dark ? MENU_ICON.dark : MENU_ICON.light);
  burgerBtn.add(menuImg);

  // 菜单面板（Ew 面板：absolute top60(+4t) right8 width200 黑底）
  const menuPanel = UIElement.container({
    positionType: 'absolute',
    positionTop: 60,
    positionRight: 8,
    width: 200,
    flexDirection: 'column',
    backgroundColor: 'black',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
    opacity: 0,
    display: 'none',
  });
  const menuItems: NavBarElementHandles['menuItems'] = [];
  NAV_ITEMS.forEach((item, i) => {
    const row = UIElement.container({
      padding: 16,
      borderColor: 'rgba(255,255,255,0.3)',
      borderBottomWidth: i < NAV_ITEMS.length - 1 ? 1 : 0,
    });
    row.add(UIElement.text(item.label, { font: fonts.medium, fontSize: 18 }, { marginBottom: -8 }));
    menuPanel.add(row);
    menuItems.push({ id: item.id, el: row });
  });
  // 菜单第 5 项 Book a call（原站菜单面板只列 4 页导航项——Ep 独立；但 a11y 表有 menuBook。
  // 反编译 Ew navItems=ED 仅 4 项 → 不加第 5 项，menuBook 命中键由 book 按钮承担）
  burgerWrap.add(burgerBtn);
  right.add(bookWrap, burgerWrap);
  bar.add(logoBtn, navRow, right);
  // 面板挂 root 级（top60/right8 相对视口）：yoga absolute 相对父节点，
  // 挂在 64 宽的 burgerWrap 下会错位成 top60/left−146
  root.add(menuOverlay, bar, menuPanel);

  // ---- 动效状态 ----
  const springs = new Map<NavItemId, Spring>(
    NAV_ITEMS.map((it) => [it.id, new Spring(1)] as const),
  );
  let menuT = 0;
  let lastDark = dark;

  const kit: NavBarKit = {
    root,
    handles: {
      root,
      logoBtn,
      logoImg,
      navItemCols,
      bookBtn,
      burgerBtn,
      menuPanel,
      menuOverlay,
      menuItems,
    },
    tick(state, dt) {
      // 主题切换（图标 url 换引用；文字色/边框由重建承担——轻量做法：url 与色同步换）
      if (state.dark !== lastDark) {
        lastDark = state.dark;
        logoImg.__image = { url: state.dark ? LOGO.dark : LOGO.light };
        menuImg.__image = { url: state.dark ? MENU_ICON.dark : MENU_ICON.light };
        phoneImg.__image = { url: state.dark ? PHONE_ICON.dark : PHONE_ICON.light };
      }
      // 菜单开合（0.3s easeInOut 由调用方推进 menuT）
      // 注意：display 必须同步写 yoga node——updateRecursive 按 style 判可见性，
      // 但布局尺寸来自 yoga（node 仍 NONE 时 computed 宽高=0，面板/字形全部不可见）
      menuT = Math.max(0, Math.min(1, state.menuT));
      const shown = menuT > 0.005;
      menuPanel.style.display = shown ? 'flex' : 'none';
      menuPanel.style.opacity = menuT;
      menuPanel.node.setDisplay(shown ? YG.DISPLAY_FLEX : YG.DISPLAY_NONE);
      menuOverlay.style.display = shown ? 'flex' : 'none';
      menuOverlay.style.opacity = menuT;
      menuOverlay.node.setDisplay(shown ? YG.DISPLAY_FLEX : YG.DISPLAY_NONE);
      // positionTop = 60 + 4·menuT（yoga setPosition 在 relayout 中统一应用）
      // hover 边框（0.1s 阻尼由调用方给 0..1 值）
      logoBtn.style.borderColor =
        state.logoHover > 0.01
          ? withAlpha(dark ? '#171310' : '#ffffff', state.logoHover)
          : 'transparent';
      const actionColor = dark ? '#171310' : '#ffffff';
      bookBtn.style.borderColor =
        state.actionHover > 0.01 && lg ? withAlpha(actionColor, state.actionHover) : 'transparent';
      burgerBtn.style.borderColor =
        state.actionHover > 0.01 && !lg ? withAlpha(actionColor, state.actionHover) : 'transparent';
      // 下划线 spring（opacity = 1 − v：非当前项显示、当前项隐藏——实测+反编译互证）
      for (const item of navItemCols) {
        const sp = springs.get(item.id)!;
        sp.target = state.activeNav === item.id ? 1 : 0;
        const v = sp.tick(dt);
        item.underline.style.opacity = Math.max(0, Math.min(1, 1 - v));
      }
    },
    relayout(v) {
      // positionTop 每帧变化需要 yoga 重排（树小，开销可忽略）
      menuPanel.node.setPosition(YG.EDGE_TOP, 60 + 4 * menuT);
      menuPanel.node.setPosition(YG.EDGE_RIGHT, 8);
      root.node.setWidth(v);
      root.node.setHeight(vh);
      root.calculateLayout(v, undefined);
    },
  };
  return kit;
}

/** rgba(hex, a) —— uikit 面板边框的动态 alpha */
function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/** 字体加载（与 contact 同一套 stix） */
export function loadNavBarFonts(): Promise<{ medium: UIKitFont; bold: UIKitFont }> {
  return Promise.all([loadFont('/fonts/stix_medium.json'), loadFont('/fonts/stix_bold.json')]).then(
    ([medium, bold]) => ({ medium, bold }),
  );
}
