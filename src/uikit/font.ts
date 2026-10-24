/**
 * BMFont(MSDF) 字体解析 —— 1:1 对照原站 uikit 字体类（_bundles/full/04kr7kd5riobb.js:26797 o5）。
 * 字形度量按 info.size 归一化（em 单位），yoffset 平移 (lineHeight - size)。
 */
export interface GlyphInfo {
  char: string;
  /** em 单位（已除以烘焙字号 48） */
  xadvance: number;
  xoffset: number;
  yoffset: number;
  width: number;
  height: number;
  uvX: number;
  uvY: number;
  uvWidth: number;
  uvHeight: number;
  renderSolid: boolean;
}

export interface UIKitFont {
  face: string;
  /** 图集像素尺寸 */
  pageWidth: number;
  pageHeight: number;
  /** MSDF distanceRange（本站为 4） */
  distanceRange: number;
  /** 字体自身行高（em）——仅供诊断，uikit 行高默认用 120% */
  lineHeightFont: number;
  glyph(char: string): GlyphInfo;
  kerning(a: string, b: string): number;
  /** MSDF 图集 URL（渲染层用） */
  pageUrl: string;
}

/** 原站缺字回退（04kr:26778 o4） */
export const FALLBACK_GLYPH: GlyphInfo = {
  char: '',
  xadvance: 0.6,
  xoffset: 0,
  yoffset: 0.3,
  width: 0.5,
  height: 0.5,
  uvX: 0,
  uvY: 0,
  uvWidth: 0,
  uvHeight: 0,
  renderSolid: true,
};

export function parseBMFont(json: any, pageUrlOverride?: string): UIKitFont {
  const size = json.info.size;
  const { scaleW, scaleH, lineHeight } = json.common;
  const map = new Map<string, GlyphInfo>();
  for (const c of json.chars as any[]) {
    map.set(c.char, {
      char: c.char,
      xadvance: c.xadvance / size,
      xoffset: c.xoffset / size,
      yoffset: (c.yoffset - (lineHeight - size)) / size,
      width: c.width / size,
      height: c.height / size,
      uvX: c.x / scaleW,
      uvY: c.y / scaleH,
      uvWidth: c.width / scaleW,
      uvHeight: c.height / scaleH,
      renderSolid: false,
    });
  }
  const kern = new Map<string, number>();
  for (const k of json.kernings ?? []) kern.set(`${k.first}/${k.second}`, k.amount / size);
  return {
    face: json.info.face,
    pageWidth: scaleW,
    pageHeight: scaleH,
    distanceRange: json.distanceField.distanceRange,
    lineHeightFont: lineHeight / size,
    glyph(char: string) {
      const g = map.get(char);
      if (g) return g;
      if (char === '\n') {
        const sp = map.get(' ');
        if (sp) return sp;
      }
      return FALLBACK_GLYPH;
    },
    kerning(a: string, b: string) {
      return kern.get(`${a}/${b}`) ?? 0;
    },
    pageUrl: pageUrlOverride ?? json.pages[0],
  };
}

/** 原站字体表（04kr:26752 o0/o1）：weight 名 → 字体文件 */
export const STIX_FAMILIES = {
  stix: {
    normal: '/fonts/stix_regular.json',
    medium: '/fonts/stix_medium.json',
    bold: '/fonts/stix_bold.json',
  },
} as const;

export type FontWeight = keyof (typeof STIX_FAMILIES)['stix'];

const cache = new Map<string, Promise<UIKitFont>>();

export function loadFont(url: string): Promise<UIKitFont> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.json())
      .then((json) => parseBMFont(json, url.replace(/\.json$/, '.webp')));
    cache.set(url, p);
  }
  return p;
}

/** weight 名解析：数字取最近档（04kr:29253） */
export function resolveWeight(families: typeof STIX_FAMILIES.stix, weight: number | string): UIKitFontUrl {
  const keys = Object.keys(families) as FontWeight[];
  const w = typeof weight === 'string' && isNaN(parseFloat(weight)) ? NaN : parseFloat(String(weight));
  if (isNaN(w)) throw new Error(`invalid font weight "${weight}"`);
  let best: FontWeight = keys[0];
  let bestDist = Infinity;
  for (const k of keys) {
    const d = Math.abs(w - parseFloat(k === 'normal' ? '400' : k === 'medium' ? '500' : '700'));
    if (d === 0) return { url: families[k], weightKey: k };
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  return { url: families[best], weightKey: best };
}
type UIKitFontUrl = { url: string; weightKey: FontWeight };
