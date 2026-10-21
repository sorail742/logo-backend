import {
  contrastRatio,
  ensureContrast,
  hexToRgb,
  luminance,
  mix,
  readableOn,
  type LogoColors,
} from './color';
import {
  logoSvg,
  PALETTE_ROLE_LABELS,
  type KitContent,
  type KitFont,
  type KitPaletteColor,
} from './brand-kit';
import { closestWeight, FALLBACK_FONT, shapeText } from './fonts';
import { LOGO_METRICS, renderLogoSvg } from './logo';
import { markSvg, type LogoSource } from './logo-assets';
import { createPdf, drawSvg, fitSize, MM, registerTextFonts, textHeight, writeText } from './pdf';
import { svgToPng } from './raster';
import { escapeXml, recolorSvg, svgSize } from './svg';

// Charte graphique PDF (KIT-02) : couverture, origine du nom, logo et variantes, zone de
// protection, taille minimale, usages interdits, couleurs, typographies, signatures et exemples.
// Rendu vectoriel (pdfkit) : logos et spécimens de polices en tracés, textes en Montserrat.

export interface BrandGuideSignatures {
  stampSvg?: string | null;
  handwrittenSvg?: string | null;
  email?: { template: string; text: string } | null;
}

export interface BrandGuideInput {
  content: KitContent;
  version: number;
  date: Date;
  logo: LogoSource;
  palette: KitPaletteColor[];
  fonts: KitFont[];
  signatures: BrandGuideSignatures;
}

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const SOFT = '#f3f4f6';
const DARK = '#111827';
const FORBIDDEN = '#dc2626';

export const ENTITY_LABELS: Record<string, string> = {
  ASSOCIATION: 'Association',
  APPLICATION: 'Application',
  PLATFORM: 'Plateforme',
  COMPANY: 'Entreprise',
  EVENT: 'Événement',
  OTHER: 'Autre',
};

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Africa/Conakry' }).format(
    date,
  );
}

/** Couleur de la palette par rôle. */
function role(palette: KitPaletteColor[], name: KitPaletteColor['role'], fallback: string) {
  return palette.find((c) => c.role === name)?.hex.toLowerCase() ?? fallback;
}

/** Enveloppe le contenu d'un SVG dans un groupe (opacité, contour). */
function wrapSvg(svg: string, attributes: string) {
  return svg.replace(/(<svg\b[^>]*>)/, `$1<g ${attributes}>`).replace(/<\/svg>\s*$/, '</g></svg>');
}

/** Spécimen d'une police en tracés : grand « Aa », alphabet, chiffres et accents. */
function specimenSvg(font: KitFont, weight: number) {
  const lines = [
    { text: 'Aa Bb Cc 123', size: 44 },
    { text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', size: 18 },
    { text: 'abcdefghijklmnopqrstuvwxyz 0123456789 éèàçô', size: 18 },
  ];
  let y = 0;
  let width = 0;
  const paths = lines.map(({ text, size }) => {
    const shaped = shapeText(text, {
      fontId: font.id,
      weight: closestWeight(font.id, weight),
      size,
    });
    y += size * 1.25;
    width = Math.max(width, shaped.width);
    return `<path d="${shaped.toPath(0, y - size * 0.25)}" fill="${INK}"/>`;
  });
  const height = Math.ceil(y + 4);
  width = Math.ceil(width + 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${paths.join('')}</svg>`;
}

/** Couleur hors palette la plus éloignée de la couleur principale (usage interdit). */
function offPaletteColor(primary: string) {
  const [r, g, b] = hexToRgb(primary);
  const distance = (hex: string) => {
    const [r2, g2, b2] = hexToRgb(hex);
    return (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
  };
  const candidates = ['#e11d48', '#16a34a', '#7c3aed', '#f97316'];
  return candidates.reduce(
    (best, color) => (distance(color) > distance(best) ? color : best),
    candidates[0],
  );
}

class GuideWriter {
  readonly doc: PDFKit.PDFDocument;
  private pageNumber = 1;
  readonly primary: string;
  /** Principale assez contrastée pour du texte sur fond blanc. */
  readonly accent: string;
  readonly colors: LogoColors;

  constructor(
    private readonly input: BrandGuideInput,
    doc: PDFKit.PDFDocument,
  ) {
    this.doc = doc;
    this.primary = role(input.palette, 'primary', '#0f766e');
    this.accent = ensureContrast(this.primary, '#ffffff', 3);
    this.colors = {
      primary: this.primary,
      secondary: role(input.palette, 'secondary', '#f59e0b'),
      text: role(input.palette, 'text', INK),
      background: role(input.palette, 'background', '#ffffff'),
    };
  }

  get name() {
    return this.input.content.name;
  }

  text(value: string, x: number, y: number, style: Parameters<typeof writeText>[4]) {
    writeText(this.doc, value, x, y, style);
  }

  /** Nouvelle page de section : en-tête, numéro, titre et filet ; renvoie l'ordonnée libre. */
  section(number: number, title: string) {
    this.doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
    this.pageNumber += 1;
    this.text(`${this.name} — Charte graphique`, MARGIN, 30, {
      size: 8,
      color: MUTED,
      width: CONTENT_WIDTH,
      lineBreak: false,
    });
    this.text(`v${this.input.version} · ${this.pageNumber}`, MARGIN, PAGE.height - 36, {
      size: 8,
      color: MUTED,
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });
    this.text(String(number).padStart(2, '0'), MARGIN, 62, {
      font: 'bold',
      size: 11,
      color: this.accent,
      lineBreak: false,
    });
    this.text(title, MARGIN, 78, { font: 'bold', size: 24, color: INK, width: CONTENT_WIDTH });
    this.doc.rect(MARGIN, 114, 40, 3).fill(this.primary);
    return 140;
  }

  /** Paragraphe sur toute la largeur ; renvoie l'ordonnée sous le texte. */
  paragraph(
    value: string,
    y: number,
    style: { size?: number; color?: string; font?: 'regular' | 'medium' | 'bold' } = {},
  ) {
    const textStyle = {
      size: style.size ?? 10.5,
      color: style.color ?? INK,
      font: style.font,
      width: CONTENT_WIDTH,
      lineGap: 3,
    };
    this.text(value, MARGIN, y, textStyle);
    return y + textHeight(this.doc, value, textStyle);
  }

  label(value: string, x: number, y: number, width = CONTENT_WIDTH) {
    this.text(value.toUpperCase(), x, y, {
      font: 'medium',
      size: 8,
      color: MUTED,
      characterSpacing: 0.8,
      width,
      lineBreak: false,
    });
  }

  box(x: number, y: number, width: number, height: number, fill = SOFT, stroke?: string) {
    this.doc.roundedRect(x, y, width, height, 8);
    if (stroke) this.doc.lineWidth(0.75).fillAndStroke(fill, stroke);
    else this.doc.fill(fill);
  }

  /** Logo centré dans un cadre, avec une marge intérieure. */
  logo(svg: string, x: number, y: number, width: number, height: number, padding = 16) {
    drawSvg(this.doc, svg, x + padding, y + padding, width - padding * 2, height - padding * 2);
  }

  forbiddenBadge(x: number, y: number) {
    const r = 9;
    this.doc.circle(x, y, r).fill('#ffffff');
    this.doc.lineWidth(2).circle(x, y, r).stroke(FORBIDDEN);
    this.doc
      .moveTo(x - r * 0.7, y + r * 0.7)
      .lineTo(x + r * 0.7, y - r * 0.7)
      .stroke(FORBIDDEN);
  }
}

export async function renderBrandGuidePdf(input: BrandGuideInput): Promise<Buffer> {
  const { content } = input;
  const pdf = createPdf({
    size: [PAGE.width, PAGE.height],
    title: `${content.name} — Charte graphique`,
  });
  registerTextFonts(pdf.doc);
  const w = new GuideWriter(input, pdf.doc);

  cover(w, input);
  origin(w, input);
  logoPage(w, input);
  clearSpace(w, input);
  forbidden(w, input);
  colors(w, input);
  typography(w, input);
  signatures(w, input);
  examples(w, input);

  return pdf.done();
}

function cover(w: GuideWriter, input: BrandGuideInput) {
  const { doc } = w;
  const fg = readableOn(w.primary);
  const soft = mix(fg, w.primary, 0.3);
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(w.primary);

  if (input.logo.kind === 'spec') {
    w.logo(
      logoSvg(input.logo, { variant: fg === '#ffffff' ? 'white' : 'black' }),
      MARGIN,
      150,
      CONTENT_WIDTH,
      300,
      0,
    );
  } else {
    // Logo importé : il garde ses couleurs, sur une carte claire.
    w.box(MARGIN + 60, 170, CONTENT_WIDTH - 120, 260, '#ffffff');
    w.logo(input.logo.svg, MARGIN + 60, 170, CONTENT_WIDTH - 120, 260, 32);
  }

  w.text('CHARTE GRAPHIQUE', MARGIN, 520, {
    font: 'medium',
    size: 10,
    color: soft,
    characterSpacing: 3,
    width: CONTENT_WIDTH,
  });
  w.text(input.content.name, MARGIN, 540, {
    font: 'bold',
    size: 34,
    color: fg,
    width: CONTENT_WIDTH,
  });
  let y =
    540 + textHeight(doc, input.content.name, { font: 'bold', size: 34, width: CONTENT_WIDTH }) + 8;
  if (input.content.slogan) {
    const style = { size: 14, color: fg, width: CONTENT_WIDTH };
    w.text(input.content.slogan, MARGIN, y, style);
    y += textHeight(doc, input.content.slogan, style);
  }
  w.text(`Version ${input.version} · ${formatDate(input.date)}`, MARGIN, PAGE.height - 80, {
    size: 9,
    color: soft,
    width: CONTENT_WIDTH,
    lineBreak: false,
  });
}

function origin(w: GuideWriter, input: BrandGuideInput) {
  const { content } = input;
  let y = w.section(1, 'Origine du nom');
  y = w.paragraph(
    `Ce document décrit les règles d’utilisation de l’identité visuelle de ${content.name}. Il accompagne les fichiers du kit de marque : en les respectant, vous gardez une marque reconnaissable sur tous les supports.`,
    y,
    { color: MUTED },
  );
  y += 28;
  w.label('Nom', MARGIN, y);
  w.text(content.name, MARGIN, y + 14, {
    font: 'bold',
    size: 30,
    color: INK,
    width: CONTENT_WIDTH,
  });
  y += 14 + textHeight(w.doc, content.name, { font: 'bold', size: 30, width: CONTENT_WIDTH }) + 10;
  if (content.acronym && content.acronym !== content.name) {
    w.label('Sigle', MARGIN, y);
    w.text(content.acronym, MARGIN, y + 14, {
      font: 'bold',
      size: 16,
      color: INK,
      width: CONTENT_WIDTH,
    });
    y += 52;
  }
  w.label('Origine et signification', MARGIN, y);
  y = w.paragraph(content.meaning?.trim() || '—', y + 14, { size: 12 }) + 22;
  w.label('Type de structure', MARGIN, y);
  y =
    w.paragraph(ENTITY_LABELS[content.entityType] ?? content.entityType, y + 14, { size: 12 }) + 22;
  if (content.slogan) {
    w.label('Signature de marque', MARGIN, y);
    w.doc.rect(MARGIN, y + 14, 3, 30).fill(w.primary);
    w.text(`« ${content.slogan} »`, MARGIN + 14, y + 18, {
      font: 'medium',
      size: 16,
      color: INK,
      width: CONTENT_WIDTH - 14,
    });
  }
}

/** Variantes présentées dans la charte (un logo importé n'a ni icône ni dispositions). */
function variants(source: LogoSource) {
  // Une image matricielle importée ne change pas de couleur : version couleur seule.
  if (source.kind === 'svg' && /<image\b/i.test(source.svg)) {
    return [{ label: 'Couleur', svg: source.svg, dark: false }];
  }
  const all = [
    { label: 'Couleur', svg: logoSvg(source), dark: false },
    { label: 'Noir', svg: logoSvg(source, { variant: 'black' }), dark: false },
    { label: 'Blanc', svg: logoSvg(source, { variant: 'white' }), dark: true },
  ];
  if (source.kind !== 'spec') return all;
  return [
    ...all,
    { label: 'Icône seule', svg: logoSvg(source, { layout: 'icon' }), dark: false },
    { label: 'Horizontale', svg: logoSvg(source, { layout: 'horizontal' }), dark: false },
    { label: 'Verticale', svg: logoSvg(source, { layout: 'vertical' }), dark: false },
  ];
}

function logoPage(w: GuideWriter, input: BrandGuideInput) {
  let y = w.section(2, 'Le logo');
  w.box(MARGIN, y, CONTENT_WIDTH, 220);
  w.logo(logoSvg(input.logo), MARGIN, y, CONTENT_WIDTH, 220, 36);
  y += 232;
  w.label('Version principale', MARGIN, y);
  y += 30;

  const gap = 12;
  const tileW = (CONTENT_WIDTH - gap * 2) / 3;
  const tileH = 104;
  variants(input.logo).forEach((variant, index) => {
    const x = MARGIN + (index % 3) * (tileW + gap);
    const top = y + Math.floor(index / 3) * (tileH + 30);
    w.box(x, top, tileW, tileH, variant.dark ? DARK : '#ffffff', variant.dark ? undefined : LINE);
    w.logo(variant.svg, x, top, tileW, tileH, 14);
    w.text(variant.label, x, top + tileH + 6, {
      size: 9,
      color: MUTED,
      width: tileW,
      align: 'center',
      lineBreak: false,
    });
  });
  const rows = Math.ceil(variants(input.logo).length / 3);
  y += rows * (tileH + 30) + 8;
  w.paragraph(
    'Utilisez la version couleur sur fond clair, la version blanche sur fond sombre ou sur une photo, la version noire pour les impressions en une couleur (tampons, fax, gravure). L’icône seule sert aux petits formats : favicon, avatar, icône d’application.',
    y,
    { color: MUTED },
  );
}

function clearSpace(w: GuideWriter, input: BrandGuideInput) {
  const { doc } = w;
  let y = w.section(3, 'Zone de protection');
  const source = input.logo;
  const svg = logoSvg(source);
  const size = svgSize(svg);
  // Unité x : moitié de la hauteur du symbole (moitié du corps du nom pour un logotype).
  let pad = 0;
  let unit = Math.min(size.width, size.height) * 0.15;
  if (source.kind === 'spec') {
    pad = LOGO_METRICS.pad;
    const textOnly = source.spec.type === 'WORDMARK' || source.spec.layout === 'text';
    unit = (textOnly ? LOGO_METRICS.text : LOGO_METRICS.mark) / 2;
  }
  const art = { width: size.width - pad * 2, height: size.height - pad * 2 };
  const boxH = 230;
  w.box(MARGIN, y, CONTENT_WIDTH, boxH);
  const zone = { width: art.width + unit * 2, height: art.height + unit * 2 };
  const scale = Math.min((CONTENT_WIDTH - 60) / zone.width, (boxH - 50) / zone.height);
  const zx = MARGIN + (CONTENT_WIDTH - zone.width * scale) / 2;
  const zy = y + (boxH - zone.height * scale) / 2;
  doc.save();
  doc
    .lineWidth(1)
    .dash(4, { space: 3 })
    .rect(zx, zy, zone.width * scale, zone.height * scale)
    .stroke(w.accent);
  doc.undash();
  doc
    .lineWidth(0.5)
    .rect(zx + unit * scale, zy + unit * scale, art.width * scale, art.height * scale)
    .stroke(mix(w.accent, '#ffffff', 0.5));
  doc.restore();
  drawSvg(
    doc,
    svg,
    zx + (unit - pad) * scale,
    zy + (unit - pad) * scale,
    size.width * scale,
    size.height * scale,
  );
  for (const [lx, ly] of [
    [zx + (zone.width * scale) / 2, zy + (unit * scale) / 2],
    [zx + (unit * scale) / 2, zy + (zone.height * scale) / 2],
  ]) {
    w.text('x', lx - 6, ly - 6, {
      font: 'bold',
      size: 10,
      color: w.accent,
      width: 12,
      align: 'center',
      lineBreak: false,
    });
  }
  y += boxH + 14;
  y = w.paragraph(
    'Laissez autour du logo un espace libre au moins égal à x, la moitié de la hauteur du symbole. Aucun texte, aucune image ni aucun bord de page ne doit y pénétrer.',
    y,
    { color: MUTED },
  );

  // 4. Taille minimale, sur la même page
  y += 40;
  w.text('04', MARGIN, y, { font: 'bold', size: 11, color: w.accent, lineBreak: false });
  w.text('Taille minimale', MARGIN, y + 16, {
    font: 'bold',
    size: 24,
    color: INK,
    width: CONTENT_WIDTH,
  });
  doc.rect(MARGIN, y + 52, 40, 3).fill(w.primary);
  y += 78;
  w.box(MARGIN, y, CONTENT_WIDTH, 120);
  const fullW = 30 * MM;
  const full = fitSize(svg, fullW, 80);
  drawSvg(doc, svg, MARGIN + 40, y + (120 - full.height) / 2 - 8, fullW, full.height);
  w.text('30 mm · 120 px', MARGIN + 40, y + 96, {
    size: 9,
    color: MUTED,
    width: fullW + 40,
    lineBreak: false,
  });
  if (source.kind === 'spec') {
    const icon = markSvg(source);
    const iconW = 6 * MM;
    drawSvg(doc, icon, MARGIN + 240, y + 50, iconW, iconW);
    w.text('Icône : 6 mm · 16 px', MARGIN + 240, y + 96, {
      size: 9,
      color: MUTED,
      width: 160,
      lineBreak: false,
    });
  }
  y += 134;
  w.paragraph(
    source.kind === 'spec'
      ? 'Version complète : 30 mm (120 px) de large au minimum. En dessous, utilisez l’icône seule, jamais à moins de 6 mm (16 px).'
      : 'Version complète : 30 mm (120 px) de large au minimum, pour que chaque détail reste lisible.',
    y,
    { color: MUTED },
  );
}

function forbidden(w: GuideWriter, input: BrandGuideInput) {
  const { doc } = w;
  let y = w.section(5, 'Usages interdits');
  y =
    w.paragraph('Le logo ne se modifie pas. Voici les erreurs les plus courantes à éviter :', y, {
      color: MUTED,
    }) + 18;
  const source = input.logo;
  const svg = logoSvg(source);
  const off = offPaletteColor(w.primary);
  const recolored =
    source.kind === 'spec'
      ? renderLogoSvg(
          {
            ...source.spec,
            colors: {
              ...source.spec.colors,
              primary: off,
              secondary: mix(off, '#ffffff', 0.4),
              text: off,
            },
          },
          { withBackground: false },
        ).svg
      : recolorSvg(svg, off);
  const faded = recolorSvg(svg, mix(w.primary, '#ffffff', 0.45));

  const gap = 14;
  const tileW = (CONTENT_WIDTH - gap * 2) / 3;
  const tileH = 130;
  const pad = 18;
  const tiles: { caption: string; draw: (x: number, y: number) => void; background?: string }[] = [
    {
      caption: 'Déformer ou étirer le logo',
      draw: (x, top) => {
        const meet = fitSize(svg, tileW - pad * 2, tileH - pad * 2);
        const stretchedW = Math.min(tileW - pad * 2, meet.width * 1.5);
        const stretchedH = meet.height * 0.7;
        drawSvg(
          doc,
          svg,
          x + (tileW - stretchedW) / 2,
          top + (tileH - stretchedH) / 2,
          stretchedW,
          stretchedH,
          'none',
        );
      },
    },
    {
      caption: 'Faire pivoter le logo',
      draw: (x, top) => {
        doc.save();
        doc.rotate(-14, { origin: [x + tileW / 2, top + tileH / 2] });
        w.logo(svg, x, top, tileW, tileH, pad + 6);
        doc.restore();
      },
    },
    {
      caption: 'Placer le logo sur un fond peu contrasté',
      background: mix(w.primary, '#ffffff', 0.62),
      draw: (x, top) => w.logo(faded, x, top, tileW, tileH, pad),
    },
    {
      caption: 'Changer les couleurs hors palette',
      draw: (x, top) => w.logo(recolored, x, top, tileW, tileH, pad),
    },
    {
      caption: 'Ajouter des ombres ou des effets',
      draw: (x, top) => {
        w.logo(
          wrapSvg(recolorSvg(svg, '#000000'), 'opacity="0.35"'),
          x + 4,
          top + 4,
          tileW,
          tileH,
          pad,
        );
        w.logo(svg, x, top, tileW, tileH, pad);
      },
    },
    {
      caption: 'Ajouter un contour',
      draw: (x, top) =>
        w.logo(
          wrapSvg(
            svg,
            `stroke="${escapeXml(w.colors.secondary)}" stroke-width="5" stroke-linejoin="round"`,
          ),
          x,
          top,
          tileW,
          tileH,
          pad,
        ),
    },
  ];

  tiles.forEach((tile, index) => {
    const x = MARGIN + (index % 3) * (tileW + gap);
    const top = y + Math.floor(index / 3) * (tileH + 44);
    w.box(x, top, tileW, tileH, tile.background ?? '#ffffff', tile.background ? undefined : LINE);
    doc.save();
    doc.roundedRect(x, top, tileW, tileH, 8).clip();
    tile.draw(x, top);
    doc.restore();
    w.forbiddenBadge(x + tileW - 14, top + 14);
    w.text(tile.caption, x, top + tileH + 8, { size: 9, color: INK, width: tileW });
  });
}

function colors(w: GuideWriter, input: BrandGuideInput) {
  const { doc } = w;
  let y = w.section(6, 'Couleurs');
  y =
    w.paragraph(
      'Ces couleurs sont les seules à utiliser avec le logo. Les valeurs HEX et RGB servent aux écrans, les valeurs CMJN à l’impression.',
      y,
      { color: MUTED },
    ) + 18;
  const gap = 14;
  const cardW = (CONTENT_WIDTH - gap) / 2;
  const cardH = 190;
  input.palette.forEach((color, index) => {
    const x = MARGIN + (index % 2) * (cardW + gap);
    const top = y + Math.floor(index / 2) * (cardH + gap);
    w.box(x, top, cardW, cardH, '#ffffff', LINE);
    doc.save();
    doc.roundedRect(x, top, cardW, 100, 8).clip();
    doc.rect(x, top, cardW, 100).fill(color.hex);
    doc.restore();
    if (luminance(color.hex) > 0.9)
      doc
        .lineWidth(0.5)
        .moveTo(x, top + 100)
        .lineTo(x + cardW, top + 100)
        .stroke(LINE);
    w.text(PALETTE_ROLE_LABELS[color.role], x + 14, top + 112, {
      font: 'bold',
      size: 12,
      color: INK,
      width: cardW - 28,
      lineBreak: false,
    });
    const lines = [`HEX   ${color.hex}`, `RGB   ${color.rgb}`, `CMJN  ${color.cmyk}`];
    lines.forEach((line, i) =>
      w.text(line, x + 14, top + 134 + i * 15, {
        size: 9.5,
        color: INK,
        width: cardW - 28,
        lineBreak: false,
      }),
    );
  });
  y += Math.ceil(input.palette.length / 2) * (cardH + gap) + 10;
  const ratio = contrastRatio(w.colors.text, w.colors.background);
  y = w.paragraph(
    `Contraste du texte sur le fond : ${ratio.toFixed(1).replace('.', ',')}:1${ratio >= 4.5 ? ' — conforme au niveau AA des règles d’accessibilité (4,5:1 minimum).' : ' — insuffisant pour du texte courant : réservez cette combinaison aux grands titres.'}`,
    y,
  );
  w.paragraph(
    'La conversion CMJN est indicative : demandez une épreuve à votre imprimeur avant un grand tirage.',
    y + 8,
    { color: MUTED, size: 9.5 },
  );
}

function typography(w: GuideWriter, input: BrandGuideInput) {
  let y = w.section(7, 'Typographies');
  const brandFont = input.logo.kind === 'spec' ? input.logo.spec.fontId : null;
  const weight = input.logo.kind === 'spec' ? input.logo.spec.fontWeight : 400;
  for (const font of input.fonts) {
    const usages = [
      font.id === brandFont ? 'Nom de la marque' : null,
      font.id === FALLBACK_FONT ? 'Slogan et textes' : null,
    ].filter(Boolean);
    const cardH = 190;
    w.box(MARGIN, y, CONTENT_WIDTH, cardH, '#ffffff', LINE);
    w.text(font.name, MARGIN + 18, y + 16, {
      font: 'bold',
      size: 14,
      color: INK,
      width: CONTENT_WIDTH - 36,
      lineBreak: false,
    });
    w.label(usages.join(' · ') || 'Typographie', MARGIN + 18, y + 36, CONTENT_WIDTH - 36);
    drawSvg(
      w.doc,
      specimenSvg(font, font.id === brandFont ? weight : 400),
      MARGIN + 18,
      y + 54,
      CONTENT_WIDTH - 36,
      100,
      'meet',
      'xMinYMid',
    );
    w.text(
      `Licence : ${font.license} — usage commercial autorisé, gratuite sur Google Fonts.`,
      MARGIN + 18,
      y + cardH - 24,
      {
        size: 8.5,
        color: MUTED,
        width: CONTENT_WIDTH - 36,
        lineBreak: false,
      },
    );
    y += cardH + 16;
  }
  w.paragraph(
    'Le texte des fichiers du logo est converti en tracés : ils s’affichent correctement même sans la police installée.',
    y,
    { color: MUTED },
  );
}

function signatures(w: GuideWriter, input: BrandGuideInput) {
  const { doc } = w;
  const { content } = input;
  const { stampSvg, handwrittenSvg, email } = input.signatures;
  let y = w.section(8, 'Signatures');
  const brandLines = [
    content.slogan && { label: 'Slogan', text: `« ${content.slogan} »` },
    content.devise && { label: 'Devise', text: content.devise },
    content.mission && { label: 'Mission', text: content.mission },
  ].filter((line): line is { label: string; text: string } => !!line);
  const empty = !brandLines.length && !stampSvg && !handwrittenSvg && !email;
  if (empty) {
    w.paragraph('Aucune signature n’a encore été créée pour ce projet.', y, { color: MUTED });
    return;
  }
  for (const line of brandLines) {
    w.label(line.label, MARGIN, y);
    y = w.paragraph(line.text, y + 14, { size: 13, font: 'medium' }) + 16;
  }

  const visuals = [
    stampSvg && { label: 'Cachet', svg: stampSvg, width: 170, height: 170 },
    handwrittenSvg && { label: 'Paraphe', svg: handwrittenSvg, width: 240, height: 96 },
  ].filter((v): v is { label: string; svg: string; width: number; height: number } => !!v);
  if (visuals.length) {
    let x = MARGIN;
    const rowH = Math.max(...visuals.map((v) => v.height)) + 24;
    for (const visual of visuals) {
      w.box(x, y, visual.width + 24, rowH, '#ffffff', LINE);
      // Image matricielle : l'effet d'encre du cachet n'a pas d'équivalent vectoriel en PDF.
      const png = svgToPng(visual.svg, { size: 900 });
      const fit = fitSize(visual.svg, visual.width, visual.height);
      doc.image(png, x + 12 + (visual.width - fit.width) / 2, y + (rowH - fit.height) / 2, {
        width: fit.width,
        height: fit.height,
      });
      w.text(visual.label, x, y + rowH + 6, {
        size: 9,
        color: MUTED,
        width: visual.width + 24,
        align: 'center',
        lineBreak: false,
      });
      x += visual.width + 24 + 16;
    }
    y += rowH + 24;
    y =
      w.paragraph(
        'Fichiers haute définition dans le dossier « signatures » du kit. Le cachet et le paraphe sont réservés aux personnes habilitées à représenter la structure.',
        y,
        { color: MUTED, size: 9.5 },
      ) + 16;
  }

  if (email) {
    w.label(`Signature e-mail — modèle ${email.template}`, MARGIN, y);
    y += 16;
    const style = { size: 9.5, color: INK, width: CONTENT_WIDTH - 28, lineGap: 2 };
    const height = Math.min(textHeight(doc, email.text, style), PAGE.height - 90 - y);
    w.box(MARGIN, y, CONTENT_WIDTH, height + 24);
    w.text(email.text, MARGIN + 14, y + 12, { ...style });
    y += height + 34;
    w.paragraph(
      'La version HTML à coller dans votre messagerie est dans le dossier « signatures » du kit.',
      y,
      { color: MUTED, size: 9.5 },
    );
  }
}

function examples(w: GuideWriter, input: BrandGuideInput) {
  const { doc } = w;
  const y = w.section(9, 'Exemples d’application');
  const source = input.logo;
  const fg = readableOn(w.primary);
  const gap = 18;
  const tileW = (CONTENT_WIDTH - gap) / 2;
  const tileH = 200;

  const tile = (index: number, caption: string, draw: (x: number, top: number) => void) => {
    const x = MARGIN + (index % 2) * (tileW + gap);
    const top = y + Math.floor(index / 2) * (tileH + 36);
    w.box(x, top, tileW, tileH);
    draw(x, top);
    w.text(caption, x, top + tileH + 8, {
      size: 9,
      color: MUTED,
      width: tileW,
      align: 'center',
      lineBreak: false,
    });
  };
  const card = (
    x: number,
    top: number,
    fill: string,
    draw: (cx: number, cy: number, cw: number, ch: number) => void,
  ) => {
    const cw = tileW - 70;
    const ch = (cw * 55) / 85;
    const cx = x + 35;
    const cy = top + (tileH - ch) / 2;
    doc.roundedRect(cx + 3, cy + 4, cw, ch, 4).fill('#d1d5db');
    doc.roundedRect(cx, cy, cw, ch, 4).fill(fill);
    draw(cx, cy, cw, ch);
  };

  tile(0, 'Carte de visite — recto', (x, top) =>
    card(x, top, '#ffffff', (cx, cy, cw, ch) => w.logo(logoSvg(source), cx, cy, cw, ch, 22)),
  );
  tile(1, 'Carte de visite — verso', (x, top) =>
    card(x, top, w.primary, (cx, cy, cw, ch) => {
      const variant =
        source.kind === 'spec'
          ? logoSvg(source, { variant: fg === '#ffffff' ? 'white' : 'black' })
          : logoSvg(source, { variant: 'white' });
      w.logo(variant, cx, cy, cw, ch - (input.content.slogan ? 26 : 0), 24);
      if (input.content.slogan) {
        w.text(input.content.slogan, cx + 12, cy + ch - 30, {
          size: 8,
          color: fg,
          width: cw - 24,
          align: 'center',
          lineBreak: false,
        });
      }
    }),
  );
  tile(2, 'Icône d’application et avatar', (x, top) => {
    const mark = markSvg(source);
    const side = 96;
    const ix = x + tileW / 2 - side - 20;
    const iy = top + (tileH - side) / 2;
    doc.roundedRect(ix, iy, side, side, side * 0.22).fillAndStroke(w.colors.background, LINE);
    drawSvg(doc, mark, ix + 10, iy + 10, side - 20, side - 20);
    const ax = x + tileW / 2 + 20 + side / 2;
    doc.circle(ax, top + tileH / 2, side / 2).fillAndStroke('#ffffff', LINE);
    drawSvg(doc, mark, ax - side * 0.34, top + tileH / 2 - side * 0.34, side * 0.68, side * 0.68);
  });
  tile(3, 'Sur fond sombre', (x, top) => {
    doc.save();
    doc.roundedRect(x, top, tileW, tileH, 8).clip();
    doc.rect(x, top, tileW, tileH).fill(DARK);
    doc.restore();
    w.logo(logoSvg(source, { variant: 'white' }), x, top, tileW, tileH, 36);
  });
}
