import * as THREE from 'three/webgpu';

/**
 * About 纸页内容全部用 Canvas2D 预烘焙成纹理：
 * 版式按 1440（桌面）/ 430（移动）设计宽度绘制，渲染时整体缩放到视口宽度。
 */

export interface PaperSheet {
  key: string;
  y: number;
  width: number;
  height: number;
  texture: THREE.CanvasTexture;
}

export interface PaperHotspot {
  id: string;
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AboutPaperResult {
  mobile: boolean;
  width: number;
  height: number;
  sheets: PaperSheet[];
  ctaSheet: PaperSheet;
  ctaY: number;
  hotspots: PaperHotspot[];
}

const INK = '#241f16';
const INK_SOFT = '#373025';
const PAPER_TOP = '#f5efdf';
const PAPER_BOTTOM = '#eee5d0';
const SERIF = '"STIX Two Text", "Times New Roman", serif';
const CALL_URL = 'mailto:hello@shader.se?subject=Book%20a%20call';

const COPY = {
  introHeading: 'Making Digital Storytelling More Playful, Powerful, and Alive',
  intro: [
    "Shader is a creative development studio specialized in building interactive 3D and AI solutions for the web. Serious about business, based in Sweden, and working with brands, agencies and designers worldwide.",
    "Plugged into the future. While we're a small team of creative engineers, we have a hand-picked network of collaborators: designers, 3D artists, copywriters, animators, and creative technologists, ready to plug in with an array of capabilities.",
    "This modular approach means we can scale and adapt to each challenge. Whether it's a WebGL experiment, an interactive product visualization, a mobile app, or an AI-driven experience, we help bold brands stand out across every screen.",
    "We build storytelling platforms that demand attention and reward curiosity. We push digital mediums to places you haven't seen before, and have fun doing it. Beyond code, we offer 3D design and animation, UI and motion design, concepts and digital strategy, full-stack development, and creative consulting.",
    "Whether it's prototyping an idea, launching an augmented reality experience, or bringing high-fidelity visuals to life, Shader bridges the gap between creative ambition and technical execution. Our process is hands-on, collaborative, and tailored for teams that value both craft and innovation. We combine technical expertise with a designer's eye, ensuring that every interaction feels natural and every pixel is perfectly placed. We're not your regular IT department. We don't troubleshoot printers.",
  ],
  clientsHeading: 'A Showcase of Valued Clients',
  clientsBody:
    'We have had the benefit of working with a large pool of great clients throughout the years. Our partnerships ranges from some of the most recognizable Swedish brands to international innovators.',
  clientsQuestion: "Are you curious about what we can do for your company? Let's Talk.",
  seriousHeading: 'For Companies Serious About Technology',
  serious: [
    "In today's fast-paced corporate landscape, you need a partner who understands the bottom line. At Shader, we engineer success through strategic alliances and mutual profitability. Our team is ready to synergize with your organization, unlock new verticals, and maximize your digital ROI. We don't just close deals; we deliver results that compound.",
    'We leverage state-of-the-art technology to give your brand a decisive competitive advantage. Whether disrupting the market with paradigm-shifting 3D experiences or streamlining operations with cutting-edge AI, we provide turnkey solutions that scale. We merge high-performance engineering with executive-level design to build assets that appreciate your brand value.',
    "Ready to take your enterprise to the next level? Don't waste valuable time. Review our portfolio, crunch the numbers, and you'll see the trajectory points one way: up. Pick up the phone, send a fax, or schedule a consultation. The future of your business is waiting. Let's execute.",
  ],
  cardTitle: 'Act now! Book a Consultation.',
  cardBody:
    'Cut along the dotted line and mail this to the post address below for a free 30 minute video call consultation.',
  cardAddress: ['Shader Sweden AB', 'Laxholmstorget 3', '602 21 Norrköping, Sweden'],
  cardClick: 'Or click below.',
  cardButton: 'Book a Call Today',
  ctaHeading: "Had Enough Reading? Let's Shred This Thing.",
  tagline: 'A High Tech Business Solutions Company',
};

interface Images {
  team: HTMLImageElement;
  jake: HTMLImageElement;
  jacob: HTMLImageElement;
  simon: HTMLImageElement;
  logos: HTMLImageElement;
  computer: HTMLImageElement;
  filip: HTMLImageElement;
  scissors: HTMLImageElement;
  logo: HTMLImageElement;
  logoLight: HTMLImageElement;
  phone: HTMLImageElement;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${src}`));
    img.src = src;
  });

function canvas2d(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}

let noiseTile: HTMLCanvasElement | null = null;
function getNoiseTile() {
  if (noiseTile) return noiseTile;
  const size = 192;
  const { canvas, ctx } = canvas2d(size, size);
  const data = ctx.createImageData(size, size);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = Math.random();
    data.data[i] = 60;
    data.data[i + 1] = 52;
    data.data[i + 2] = 38;
    data.data[i + 3] = v < 0.55 ? 0 : Math.floor((v - 0.55) * 46);
  }
  ctx.putImageData(data, 0, 0);
  noiseTile = canvas;
  return canvas;
}

function paintPaper(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, PAPER_TOP);
  grad.addColorStop(1, PAPER_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const rand = (() => {
    let s = seed * 16807 + 11;
    return () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  })();

  for (let i = 0; i < 16; i++) {
    const cx = rand() * w;
    const cy = rand() * h;
    const r = 120 + rand() * 420;
    const stain = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    stain.addColorStop(0, `rgba(133, 112, 66, ${0.022 + rand() * 0.02})`);
    stain.addColorStop(1, 'rgba(133, 112, 66, 0)');
    ctx.fillStyle = stain;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  const pattern = ctx.createPattern(getNoiseTile(), 'repeat')!;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.translate(rand() * 90, rand() * 90);
  ctx.fillStyle = pattern;
  ctx.fillRect(-90, -90, w + 180, h + 180);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.035;
  ctx.strokeStyle = '#8a784e';
  for (let i = 0; i < h; i += 7 + Math.floor(rand() * 12)) {
    ctx.beginPath();
    ctx.moveTo(0, i + rand());
    ctx.lineTo(w, i + rand() * 2);
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  ctx.restore();

  const edge = ctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(60, 45, 20, 0.06)');
  edge.addColorStop(0.035, 'rgba(60, 45, 20, 0)');
  edge.addColorStop(0.965, 'rgba(60, 45, 20, 0)');
  edge.addColorStop(1, 'rgba(60, 45, 20, 0.07)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
}

function setFont(ctx: CanvasRenderingContext2D, size: number, weight = 400, color = INK) {
  ctx.font = `${weight} ${size}px ${SERIF}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawParagraphs(
  ctx: CanvasRenderingContext2D,
  paragraphs: string[],
  x: number,
  y: number,
  width: number,
  size: number,
  lineHeight: number,
  gap: number,
  color = INK_SOFT
) {
  let cursor = y;
  setFont(ctx, size, 400, color);
  for (const paragraph of paragraphs) {
    for (const line of wrap(ctx, paragraph, width)) {
      ctx.fillText(line, x, cursor);
      cursor += size * lineHeight;
    }
    cursor += gap;
  }
  return cursor - gap;
}

function drawCenteredHeading(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  size: number,
  lineHeight: number,
  color = INK
) {
  setFont(ctx, size, 400, color);
  ctx.textAlign = 'center';
  const lines = text.split('\n');
  lines.forEach((line, i) => ctx.fillText(line, cx, y + i * size * lineHeight));
  ctx.textAlign = 'left';
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fx = 0.5,
  fy = 0.5
) {
  const ir = img.naturalWidth / img.naturalHeight;
  const r = w / h;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  let sx = 0;
  let sy = 0;
  if (ir > r) {
    sw = sh * r;
    sx = (img.naturalWidth - sw) * fx;
  } else {
    sh = sw / r;
    sy = (img.naturalHeight - sh) * fy;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawRainbow(ctx: CanvasRenderingContext2D, y: number, w: number) {
  const colors = [
    '#daa28f',
    '#e19583',
    '#e79c71',
    '#e8b861',
    '#c9c76d',
    '#92b98d',
    '#71b5a2',
    '#6da2c6',
    '#7b8ec6',
    '#927fc1',
    '#b982b1',
    '#d291a0',
    '#e3b49e',
  ];
  let cursor = y;
  ctx.fillStyle = '#231d14';
  ctx.fillRect(0, cursor, w, 2);
  cursor += 2;
  colors.forEach((color, i) => {
    const height = 4 + ((i * 5) % 5);
    ctx.fillStyle = color;
    ctx.fillRect(0, cursor, w, height);
    cursor += height;
    ctx.fillStyle = 'rgba(245, 240, 226, 0.8)';
    ctx.fillRect(0, cursor, w, 2);
    cursor += 2;
  });
  ctx.fillStyle = '#231d14';
  ctx.fillRect(0, cursor, w, 2);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawConsultationCard(
  ctx: CanvasRenderingContext2D,
  imgs: Images,
  x: number,
  y: number,
  w: number,
  h: number,
  mobile: boolean
) {
  const pad = mobile ? 26 : 34;
  const titleSize = mobile ? 23 : 28;
  const bodySize = mobile ? 15.5 : 18;
  const line = 1.42;

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = mobile ? 2 : 3;
  ctx.setLineDash(mobile ? [10, 8] : [15, 11]);
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.restore();

  const scW = mobile ? 40 : 54;
  const scH = scW * (imgs.scissors.naturalHeight / imgs.scissors.naturalWidth);
  ctx.save();
  ctx.translate(x - scW * 0.46, y + h * 0.3);
  ctx.rotate(-0.22);
  ctx.drawImage(imgs.scissors, 0, 0, scW, scH);
  ctx.restore();

  let cy = y + pad;
  setFont(ctx, titleSize, 700, INK);
  const titleLines = wrap(ctx, COPY.cardTitle, w - pad * 2);
  for (const l of titleLines) {
    ctx.fillText(l, x + pad, cy);
    cy += titleSize * 1.25;
  }
  cy += mobile ? 12 : 18;

  cy = drawParagraphs(ctx, [COPY.cardBody], x + pad, cy, w - pad * 2, bodySize, line, 0, INK_SOFT) + (mobile ? 24 : 34);

  setFont(ctx, bodySize, 400, INK_SOFT);
  ctx.fillText('Email: ____________________________', x + pad, cy);
  cy += bodySize * 2.5;

  for (const addressLine of COPY.cardAddress) {
    ctx.fillText(addressLine, x + pad, cy);
    cy += bodySize * 1.5;
  }

  cy += bodySize * 0.9;
  ctx.fillText(COPY.cardClick, x + pad, cy);

  const btnH = mobile ? 56 : 70;
  const btnW = w - pad * 2;
  const btnY = y + h - pad - btnH;
  const btnX = x + pad;
  ctx.fillStyle = '#191510';
  roundRect(ctx, btnX, btnY, btnW, btnH, 3);
  ctx.fill();

  const phoneSize = mobile ? 18 : 22;
  ctx.drawImage(imgs.phone, btnX + btnW * 0.18, btnY + btnH / 2 - phoneSize / 2, phoneSize, phoneSize);
  setFont(ctx, mobile ? 18 : 22, 700, '#f6f1e3');
  ctx.textAlign = 'center';
  ctx.fillText(COPY.cardButton, btnX + btnW / 2, btnY + btnH / 2 - (mobile ? 11 : 13) + 2);
  ctx.textAlign = 'left';

  return { x: btnX, y: btnY, w: btnW, h: btnH };
}

function drawLogos(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawSheetIntro(ctx: CanvasRenderingContext2D, imgs: Images, w: number, h: number, mobile: boolean) {
  paintPaper(ctx, w, h, 7);
  const photoH = mobile ? 300 : 620;
  drawCover(ctx, imgs.team, 0, 0, w, photoH, 0.5, mobile ? 0.55 : 0.92);

  const logoW = mobile ? 92 : 150;
  const logoH = logoW * (imgs.logoLight.naturalHeight / Math.max(1, imgs.logoLight.naturalWidth));
  ctx.globalAlpha = 0.92;
  ctx.drawImage(imgs.logoLight, w - logoW - (mobile ? 14 : 30), photoH - logoH - (mobile ? 14 : 26), logoW, logoH);
  ctx.globalAlpha = 1;

  if (mobile) {
    drawCenteredHeading(
      ctx,
      'Making Digital\nStorytelling More\nPlayful, Powerful,\nand Alive',
      w / 2,
      356,
      42,
      1.12
    );
    const end = drawParagraphs(
      ctx,
      [COPY.intro[0], COPY.intro[1], COPY.intro[2], COPY.intro[3], COPY.intro[4]],
      28,
      590,
      w - 56,
      16.5,
      1.56,
      16
    );
    const portraitW = 190;
    const portraitH = 252;
    ctx.drawImage(imgs.jake, w - portraitW - 18, end + 36, portraitW, portraitH);
    drawRainbow(ctx, h - 90, w);
    return;
  }

  drawCenteredHeading(
    ctx,
    'Making Digital\nStorytelling More Playful,\nPowerful, and Alive',
    w / 2,
    704,
    110,
    1.06
  );

  const colW = 330;
  const colX = [48, 438, 828];
  const bodyY = 1110;
  const colTexts = [
    [COPY.intro[0], COPY.intro[1]],
    [COPY.intro[2], COPY.intro[3]],
    [COPY.intro[4]],
  ];
  colTexts.forEach((paras, i) => {
    drawParagraphs(ctx, paras, colX[i], bodyY, colW, 20.5, 1.44, 16);
  });

  const portraitW = 300;
  const portraitH = portraitW * (imgs.jake.naturalHeight / imgs.jake.naturalWidth);
  ctx.drawImage(imgs.jake, w - portraitW - 6, 1040, portraitW, portraitH);

  drawRainbow(ctx, h - 130, w);
}

function drawSheetClients(ctx: CanvasRenderingContext2D, imgs: Images, w: number, h: number, mobile: boolean) {
  paintPaper(ctx, w, h, 23);
  if (mobile) {
    drawCenteredHeading(ctx, 'A Showcase of\nValued Clients', w / 2, 64, 41, 1.12);
    drawParagraphs(ctx, [COPY.clientsBody], 30, 202, w - 60, 15.5, 1.55, 0, INK_SOFT);

    const logoW = w - 40;
    const logoH = logoW * 0.89;
    drawLogos(ctx, imgs.logos, 20, 372, logoW, Math.min(logoH, 560));

    setFont(ctx, 15.5, 400, INK_SOFT);
    ctx.textAlign = 'center';
    const q = wrap(ctx, COPY.clientsQuestion, w - 70);
    q.forEach((line, i) => ctx.fillText(line, w / 2, 950 + i * 25));
    ctx.textAlign = 'left';

    const bannerY = 1030;
    const bannerH = 360;
    drawCover(ctx, imgs.computer, 0, bannerY, w, bannerH, 0.5, 0.5);
    return;
  }

  drawCenteredHeading(ctx, 'A Showcase of\nValued Clients', w / 2, 96, 110, 1.06);
  drawParagraphs(ctx, [COPY.clientsBody], (w - 760) / 2, 402, 760, 21, 1.5, 0, INK_SOFT);

  const figW = 400;
  const figH = figW * (imgs.jacob.naturalHeight / imgs.jacob.naturalWidth);
  ctx.drawImage(imgs.jacob, -26, 590, figW, figH);
  ctx.drawImage(imgs.simon, w - figW + 26, 590, figW, figH);

  const logoW = 680;
  drawLogos(ctx, imgs.logos, (w - logoW) / 2, 590, logoW, 540);

  setFont(ctx, 22, 400, INK_SOFT);
  ctx.textAlign = 'center';
  ctx.fillText(COPY.clientsQuestion, w / 2, 1252);
  ctx.textAlign = 'left';

  drawCover(ctx, imgs.computer, 0, 1330, w, h - 1330, 0.5, 0.5);
}

function drawSheetSerious(
  ctx: CanvasRenderingContext2D,
  imgs: Images,
  w: number,
  h: number,
  mobile: boolean,
  sheetY: number
): PaperHotspot[] {
  paintPaper(ctx, w, h, 41);
  if (mobile) {
    drawCenteredHeading(ctx, 'For Companies Serious\nAbout Technology', w / 2, 56, 39, 1.12);
    let cursor = drawParagraphs(ctx, COPY.serious, 28, 222, w - 56, 15.5, 1.5, 14, INK_SOFT);

    const cardX = 26;
    const cardW = w - 52;
    const cardH = 580;
    const cardY = Math.max(cursor + 32, 760);
    const btn = drawConsultationCard(ctx, imgs, cardX, cardY, cardW, cardH, true);

    const logoW = 250;
    const logoH = logoW * (imgs.logo.naturalHeight / Math.max(1, imgs.logo.naturalWidth));
    const logoY = cardY + cardH + 64;
    ctx.drawImage(imgs.logo, 28, logoY, logoW, logoH);
    setFont(ctx, 15, 400, INK_SOFT);
    ctx.fillText(COPY.tagline, 28, logoY + logoH + 8);

    drawRainbow(ctx, h - 86, w);
    return [
      { id: 'consultation', href: CALL_URL, x: btn.x, y: sheetY + btn.y, w: btn.w, h: btn.h },
    ];
  }

  setFont(ctx, 108, 400, INK);
  ctx.fillText('For Companies Serious', 90, 76);
  ctx.fillText('About Technology', 90, 190);
  drawParagraphs(ctx, COPY.serious, 90, 372, 690, 20.5, 1.45, 22, INK_SOFT);

  const cardX = 800;
  const cardY = 344;
  const cardW = 552;
  const cardH = 636;
  const btn = drawConsultationCard(ctx, imgs, cardX, cardY, cardW, cardH, false);

  const logoW = 360;
  const logoH = logoW * (imgs.logo.naturalHeight / Math.max(1, imgs.logo.naturalWidth));
  const logoY = 1050;
  ctx.drawImage(imgs.logo, 90, logoY, logoW, logoH);
  setFont(ctx, 18, 400, INK_SOFT);
  ctx.fillText(COPY.tagline, 92, logoY + logoH + 10);

  drawRainbow(ctx, h - 130, w);
  return [
    { id: 'consultation', href: CALL_URL, x: btn.x, y: sheetY + btn.y, w: btn.w, h: btn.h },
  ];
}

function drawSheetCta(ctx: CanvasRenderingContext2D, imgs: Images, w: number, h: number, mobile: boolean) {
  paintPaper(ctx, w, h, 61);
  if (mobile) {
    drawCenteredHeading(ctx, "Had Enough Reading?\nLet's Shred\nThis Thing.", w / 2, 116, 40, 1.14);
    const fw = 300;
    const fh = fw * (imgs.filip.naturalHeight / imgs.filip.naturalWidth);
    ctx.drawImage(imgs.filip, w - fw + 10, 408, fw, fh);
    return;
  }

  setFont(ctx, 110, 400, INK);
  const lines = ['Had Enough', "Reading? Let's", 'Shred This Thing.'];
  lines.forEach((line, i) => ctx.fillText(line, 112, 168 + i * 112));

  const fw = 610;
  const fh = fw * (imgs.filip.naturalHeight / imgs.filip.naturalWidth);
  ctx.drawImage(imgs.filip, w - fw + 6, 36, fw, fh);
}

function makeTexture(canvas: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 4;
  return tex;
}

export async function createAboutPaper(mobile: boolean): Promise<AboutPaperResult> {
  await Promise.all([
    document.fonts.load('400 110px "STIX Two Text"'),
    document.fonts.load('700 30px "STIX Two Text"'),
  ]).catch(() => undefined);

  const imgs: Images = {
    team: await loadImage('/textures/about/group_3x2.webp'),
    jake: await loadImage('/textures/about/jake_computer.webp'),
    jacob: await loadImage('/textures/about/jacob_presenting.webp'),
    simon: await loadImage('/textures/about/simon_presenting.webp'),
    logos: await loadImage('/textures/customers_logo_cloud.webp'),
    computer: await loadImage(mobile ? '/textures/about/computer_narrow.webp' : '/textures/about/computer.webp'),
    filip: await loadImage('/textures/about/filip_footer_5.webp'),
    scissors: await loadImage('/textures/scissors.png'),
    logo: await loadImage('/textures/logo_dark.svg'),
    logoLight: await loadImage('/logo-shader.svg'),
    phone: await loadImage('/textures/icons/old_phone.svg'),
  };

  const width = mobile ? 430 : 1440;
  const specs = mobile
    ? [
        { key: 'intro', h: 2360 },
        { key: 'clients', h: 1420 },
        { key: 'serious', h: 1900 },
        { key: 'cta', h: 1200 },
      ]
    : [
        { key: 'intro', h: 1830 },
        { key: 'clients', h: 1820 },
        { key: 'serious', h: 1450 },
        { key: 'cta', h: 1400 },
      ];

  const sheets: PaperSheet[] = [];
  const hotspots: PaperHotspot[] = [];
  let y = 0;
  for (const spec of specs) {
    const { canvas, ctx } = canvas2d(width, spec.h);
    if (spec.key === 'intro') drawSheetIntro(ctx, imgs, width, spec.h, mobile);
    else if (spec.key === 'clients') drawSheetClients(ctx, imgs, width, spec.h, mobile);
    else if (spec.key === 'serious') hotspots.push(...drawSheetSerious(ctx, imgs, width, spec.h, mobile, y));
    else drawSheetCta(ctx, imgs, width, spec.h, mobile);

    sheets.push({ key: spec.key, y, width, height: spec.h, texture: makeTexture(canvas) });
    y += spec.h;
  }

  const ctaSheet = sheets[sheets.length - 1];
  return {
    mobile,
    width,
    height: y,
    sheets,
    ctaSheet,
    ctaY: ctaSheet.y,
    hotspots,
  };
}

export function disposeAboutPaper(paper: AboutPaperResult | null) {
  if (!paper) return;
  for (const sheet of paper.sheets) sheet.texture.dispose();
}
