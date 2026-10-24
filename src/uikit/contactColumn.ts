/**
 * contact 内容列布局树 —— 1:1 对照原站 cp 组件（_bundles/full/04kr7kd5riobb.js:38175-38352）与
 * ci/cn/cg/cl/cA（37462-38081）。所有数值出自 _bundles/glossary.md §3/§4/§8。
 *
 * 页长语义：contentCol 高度 / viewportHeight = setPageLength("contact", t) 的 t（04kr:38241-38245）。
 * 离线验证：scripts/uikit-core-test.mjs —— 1600×1200 时与原站静态注册值 3.3238571052836656 偏差 −0.12%。
 *
 * M4 扩展：buildContactRoot 包 uk 根/外框（38247-38255），link() 记录 key → 元素
 * （hitRegions 投影用），cl 遮罩锚点 = goodbuyHead 布局矩形。
 */
import { UIElement } from './element.ts';
import type { UIKitFont } from './font.ts';

export const CONTACT_LENGTH_STATIC = 3.3238571052836656;

export interface ContactFonts {
  regular: UIKitFont;
  medium: UIKitFont;
  bold: UIKitFont;
}

/** 原站文案（module 57781 / 10840） */
export const CONTACT_CONTENT = {
  intro: "Contact us about your digital project idea or general enquires. Let's interface, call us today!",
  emails: { general: 'hello@shader.se', ceo: 'ceo@shader.se' },
  address: { street: 'Laxholmstorget 3', postalCode: '602 21', city: 'Norrköping', country: 'Sweden' },
} as const;

const IMG_ASPECT = {
  'footer_certificate.png': 285 / 429,
  'copyright_footer.png': 288 / 1032,
  'a11y.png': 156 / 406,
} as const;

export interface ContactColumnHandles {
  /** 根内容列（height auto）——uN 页长测量目标 */
  contentCol: UIElement;
  /** Hello 块 —— 黑幕 fade 锚点 s.current = height/viewportHeight */
  helloBlock: UIElement;
  /** Good buy 标题块（cl 遮罩锚点：absolute top0 → bottom −50 盖住本块） */
  goodbuyHead: UIElement;
  /** 链接 key → 外框元素（hitRegions 投影） */
  links: Map<string, UIElement>;
}

export function buildContactContentColumn(fonts: ContactFonts, viewportWidth: number, viewportHeight: number): ContactColumnHandles {
  const W = viewportWidth;
  const H = viewportHeight;
  const lg = W >= 1024;
  const xl = W >= 1280;
  const heroSize = lg ? 200 : W >= 768 ? 140 : W >= 640 ? 100 : 80;
  const links = new Map<string, UIElement>();

  // ---- 通用小组件（对照 ci 内的样式） ----
  // uJ 断点表（32277）：width>800 时 {fontSize:24, marginBottom:4}
  const title = (text: string) =>
    UIElement.text(text, { font: fonts.bold, fontSize: W > 800 ? 24 : 18 }, { marginBottom: W > 800 ? 4 : 2 });

  // A7 链接（37348）：外框 px2 border2；内框 borderBottom1 mb6 pt4；文本 mb-6，18/lg20
  const link = (text: string, key?: string) => {
    const outer = UIElement.container({ paddingX: 2, borderWidth: 2 });
    const inner = UIElement.container({ borderBottomWidth: 1, marginBottom: 6, paddingTop: 4 });
    inner.add(UIElement.text(text, { font: fonts.regular, fontSize: lg ? 20 : 18 }, { marginBottom: -6 }));
    outer.add(inner);
    if (key) links.set(key, outer);
    return outer;
  };

  const addressLine = (text: string) => UIElement.text(text, { font: fonts.regular, fontSize: lg ? 20 : 18 });

  // ---- ci：intro + 三卡 + CEO 卡 ----
  const generalCol = UIElement.container({
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
    ...(lg ? { width: 240 } : {}),
  });
  generalCol.add(title('General Enquiries'), link(CONTACT_CONTENT.emails.general, 'ctEmail'), link('Book a call', 'ctBook'));

  const visitCol = UIElement.container({
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
    ...(lg ? { width: 240 } : {}),
  });
  visitCol.add(
    title('Visit us'),
    addressLine(CONTACT_CONTENT.address.street),
    addressLine(`${CONTACT_CONTENT.address.postalCode} ${CONTACT_CONTENT.address.city}`),
    addressLine(CONTACT_CONTENT.address.country),
  );

  const socialCol = UIElement.container({
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
    ...(lg ? { width: 240 } : {}),
  });
  socialCol.add(title('Social'), link('LinkedIn', 'ctLi'), link('Instagram', 'ctIg'), link('X (Twitter)', 'ctX'));

  const visitSocialRow = UIElement.container({
    gap: 50, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
  });
  visitSocialRow.add(visitCol, socialCol);

  const cards = UIElement.container({
    maxWidth: 1400, paddingY: 40, marginTop: lg ? 40 : 16, gap: 50,
    flexDirection: lg ? 'row' : 'column',
    alignItems: lg ? 'flex-start' : 'center',
  });
  cards.add(generalCol, visitSocialRow);

  // cn CEO 卡（37700）：外框 padding8 border2 + lg marginTop80；内框 lg 固定高 180
  const ceoOuter = UIElement.container({ padding: 8, borderWidth: 2, ...(lg ? { marginTop: 80 } : {}) });
  const ceoInner = UIElement.container(lg ? { height: 180, width: 640, gap: 24, flexDirection: 'row', alignItems: 'center' } : { gap: 18, flexDirection: 'row', alignItems: 'center' });
  ceoOuter.add(ceoInner);
  // 内容（dashed 背景/simon 图/文案）为渲染层（M3）职责，布局上内框定高即可
  // simon 150/lg200 mL8 my6（lg 200×200 mL16）——布局占位（渲染层以 map 面板呈现）
  const simonSize = lg ? 200 : 150;
  const simon = UIElement.container({ width: simonSize, height: simonSize, ...(lg ? { marginLeft: 16 } : { marginLeft: 8 }), marginTop: 6, marginBottom: 6 });
  ceoInner.add(simon);
  const ceoTextCol = UIElement.container({ flexDirection: 'column', maxWidth: 380 });
  ceoTextCol.add(
    UIElement.text('New business', { font: fonts.bold, fontSize: lg ? 32 : W >= 640 ? 24 : 19 }),
    UIElement.text('Reach out today to our CEO for new business enquiries at ceo@shader.se', {
      font: fonts.regular,
      fontSize: lg ? 24 : W >= 640 ? 18 : 13,
      lineHeight: '120%',
    }, { marginTop: 6 }),
  );
  ceoInner.add(ceoTextCol);
  links.set('ctCeo', ceoTextCol);

  const ci = UIElement.container({
    flexDirection: 'column', alignItems: 'center',
    paddingBottom: lg ? 60 : 32,
    paddingLeft: lg ? 0 : 30, paddingRight: lg ? 0 : 30,
  });
  const intro = UIElement.text(
    CONTACT_CONTENT.intro,
    { font: fonts.regular, fontSize: lg ? 24 : W >= 768 ? 20 : 18, textAlign: 'center' },
    { maxWidth: 480, renderOrder: 1002 },
  );
  ci.add(intro, cards, ceoOuter);

  // ---- cg footer（37972） ----
  const certW = xl ? 232 : lg ? 160 : 144;
  const copyW = xl ? 384 : lg ? 320 : 256;
  const a11yW = xl ? 232 : lg ? 160 : 144;

  const certCol = UIElement.container({ display: lg ? 'flex' : 'none', width: certW, padding: 16 });
  certCol.add(UIElement.image(certW, IMG_ASPECT['footer_certificate.png'], { map: '/textures/footer_certificate.png' }, '/textures/footer_certificate.png'));
  const copyrightCol = UIElement.container({ width: copyW });
  copyrightCol.add(UIElement.image(copyW, IMG_ASPECT['copyright_footer.png'], { map: '/textures/copyright_footer.png' }, '/textures/copyright_footer.png'));
  const certCol2 = UIElement.container({ display: lg ? 'none' : 'flex', width: 144, padding: 16 });
  certCol2.add(UIElement.image(144, IMG_ASPECT['footer_certificate.png'], { map: '/textures/footer_certificate.png' }, '/textures/footer_certificate.png'));
  const a11yCard = UIElement.container({ width: a11yW, borderWidth: 2, justifyContent: 'flex-end' });
  a11yCard.add(UIElement.image(a11yW, IMG_ASPECT['a11y.png'], { map: '/textures/a11y.png' }, '/textures/a11y.png'));

  const a11yRow = UIElement.container({
    marginBottom: lg ? 0 : 48, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 32,
  });
  a11yRow.add(certCol2, a11yCard);

  const footer = UIElement.container({
    flexDirection: lg ? 'row' : 'column-reverse',
    justifyContent: 'center', alignItems: 'center',
    paddingLeft: 64, paddingRight: 64,
    paddingTop: lg ? 96 : 64, paddingBottom: lg ? 96 : 64,
    borderTopWidth: 1,
  });
  footer.add(certCol, copyrightCol, a11yRow);

  // ---- Good buy 组（cp 树 38303-38339）：Good buy. renderOrder 1001（盖 cl 遮罩 1000） ----
  const goodbuyHead = UIElement.container({ flexDirection: 'column', paddingTop: 200 });
  goodbuyHead.add(
    UIElement.text('Good buy.', { font: fonts.medium, fontSize: heroSize, textAlign: 'center' }, { renderOrder: 1001 }),
  );

  const blackBox = UIElement.container({ flexDirection: 'column' }); // 黑幕容器（zIndex2 渲染层职责）
  blackBox.add(ci);

  const goodbuyGroup = UIElement.container({ flexDirection: 'column' });
  goodbuyGroup.add(
    UIElement.container({ flexDirection: 'column' }).add(goodbuyHead, blackBox),
    footer,
  );

  // ---- Hello 块（cp 树 38279-38302）：内层 paddingTop = pageHeight（=viewportHeight，uU 实证） ----
  const helloInner = UIElement.container({ flexDirection: 'column', width: W, paddingTop: H });
  helloInner.add(
    UIElement.text('“Hello”', { font: fonts.medium, fontSize: heroSize, textAlign: 'center' }),
    UIElement.container({ height: 0.95 * H, width: W }),
  );
  const helloBlock = UIElement.container({ flexDirection: 'column' });
  helloBlock.add(helloInner);

  // ---- 内容列（uN 页长测量目标） ----
  const contentCol = UIElement.container({ flexDirection: 'column', width: W });
  contentCol.add(helloBlock, goodbuyGroup);

  contentCol.applyViewport(W);
  return { contentCol, helloBlock, goodbuyHead, links };
}

/**
 * cp 树外层（04kr:38247-38255）：uk 根（黑幕 backgroundColor 挂点）+ 外框，包内容列。
 * 根/外框定高 = viewportHeight × 页长（g_state），内容列 auto。
 * 列居中（38250-38255）在渲染层：group position = [0, −vh·len·0.5 + 0.5·vh, 0]。
 */
export function buildContactRoot(handles: ContactColumnHandles, viewportWidth: number, viewportHeight: number, lengthScreens: number): UIElement {
  const H = viewportHeight * Math.max(1, lengthScreens);
  const root = UIElement.container({
    flexDirection: 'column', width: viewportWidth, height: H,
    // 黑幕 f 由 contactScene 每帧写 backgroundColor（原站 ref=r 根上的 rgba(0,0,0,f)）
    backgroundColor: 'rgba(0, 0, 0, 0)',
    renderOrder: 1,
  });
  const outerFrame = UIElement.container({ flexDirection: 'column', width: viewportWidth, height: H });
  root.add(outerFrame);
  outerFrame.add(handles.contentCol);
  return root;
}
