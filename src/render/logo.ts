import { ensureContrast, type LogoColors } from './color';
import { closestWeight, FALLBACK_FONT, shapeText, type TextStyle } from './fonts';
import { getIcon, type IconNode } from './icons';
import type { LogoLayout, LogoSpec } from './logo-spec';
import { escapeXml } from './svg';

// Composition SVG du moteur A (§5.1) : même géométrie que l'aperçu du front
// (src/lib/render/logo.ts), mais avec les métriques réelles des polices et le texte en tracés.

export type LogoVariant = 'color' | 'black' | 'white';

export interface RenderOptions {
  variant?: LogoVariant;
  /** Remplace la disposition de la spec (variantes automatiques). */
  layout?: LogoLayout;
  /** Ajoute un filigrane (offre gratuite, LOGO-24). */
  watermark?: string | null;
  /** Fond plein derrière le logo (par défaut : transparent, sauf variante blanche). */
  withBackground?: boolean;
}

export interface RenderedLogo {
  svg: string;
  width: number;
  height: number;
}

const TEXT_SIZE = 64;
const TAGLINE_SIZE = 20;
const TAGLINE_SPACING = 0.18;
const PAD = 32;
const MARK_SIZE = 112;

/** Marge, côté du symbole et corps du nom, en unités du SVG (zone de protection de la charte). */
export const LOGO_METRICS = { pad: PAD, mark: MARK_SIZE, text: TEXT_SIZE } as const;

function variantColors(colors: LogoColors, variant: LogoVariant): LogoColors {
  if (variant === 'black') {
    return { primary: '#111111', secondary: '#111111', text: '#111111', background: '#ffffff' };
  }
  if (variant === 'white') {
    return { primary: '#ffffff', secondary: '#ffffff', text: '#ffffff', background: '#111111' };
  }
  // Contraste texte / fond d'au moins 4,5:1 (§5.5)
  return { ...colors, text: ensureContrast(colors.text, colors.background) };
}

/** Initiales du monogramme : mots de plus de 2 lettres ou commençant par une capitale. */
export function initials(value: string, max = 2) {
  return value
    .split(/[\s-]+/)
    .filter((word) => word.length > 2 || /^\p{Lu}/u.test(word))
    .map((word) => Array.from(word)[0].toUpperCase())
    .join('')
    .slice(0, max);
}

function renderIconNode(node: IconNode, ink: string) {
  return node
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .map(([key, value]) => `${key}="${escapeXml(value === 'currentColor' ? ink : value)}"`)
        .join(' ');
      return `<${tag} ${attributes}/>`;
    })
    .join('');
}

const path = (d: string, fill: string, extra = '') =>
  d ? `<path d="${d}" fill="${fill}"${extra}/>` : '';

/** Symbole (icône ou monogramme) dans un carré de côté `size`, coin supérieur gauche en (x, y). */
function renderMark(
  spec: LogoSpec,
  colors: LogoColors,
  x: number,
  y: number,
  size: number,
  variant: LogoVariant,
) {
  const parts: string[] = [];
  const framed = spec.iconFrame !== 'none';
  const cx = x + size / 2;
  const cy = y + size / 2;

  if (spec.iconFrame === 'circle') {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${size / 2}" fill="${colors.primary}"/>`);
  } else if (spec.iconFrame === 'rounded') {
    parts.push(
      `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.22}" fill="${colors.primary}"/>`,
    );
  } else if (spec.iconFrame === 'hexagon') {
    const r = size / 2;
    const points = Array.from({ length: 6 }, (_, i) => {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
    }).join(' ');
    parts.push(`<polygon points="${points}" fill="${colors.primary}"/>`);
  }

  const ink = framed ? (variant === 'white' ? '#111111' : '#ffffff') : colors.primary;
  const icon = spec.type !== 'MONOGRAM' && spec.iconId ? getIcon(spec.iconId) : undefined;

  if (!icon) {
    const letters = initials(spec.text, 2) || Array.from(spec.text)[0]?.toUpperCase() || '';
    const shaped = shapeText(letters, {
      fontId: spec.fontId,
      weight: closestWeight(spec.fontId, 800),
      size: size * (Array.from(letters).length > 1 ? 0.42 : 0.56),
    });
    parts.push(path(shaped.toPath(cx, cy + shaped.capHeight / 2, 'middle'), ink));
  } else {
    const inner = framed ? size * 0.56 * spec.iconScale : size * spec.iconScale;
    const scale = inner / 24;
    const ox = cx - inner / 2;
    const oy = cy - inner / 2;
    parts.push(
      `<g transform="translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${scale.toFixed(4)})" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${renderIconNode(icon.node, ink)}</g>`,
    );
  }
  return parts.join('');
}

function watermarkLayer(width: number, height: number, label: string) {
  const shaped = shapeText(label, { fontId: FALLBACK_FONT, weight: 700, size: 18 });
  const uses: string[] = [];
  for (let y = -height; y < height * 2; y += 90) {
    for (let x = -width; x < width * 2; x += 220) uses.push(`<use href="#wm" x="${x}" y="${y}"/>`);
  }
  return (
    `<defs><path id="wm" d="${shaped.toPath(0, 0)}"/></defs>` +
    `<g transform="rotate(-24 ${width / 2} ${height / 2})" fill="#000000" fill-opacity="0.12">${uses.join('')}</g>`
  );
}

export function renderLogoSvg(spec: LogoSpec, options: RenderOptions = {}): RenderedLogo {
  const variant = options.variant ?? 'color';
  const colors = variantColors(spec.colors, variant);
  let layout: LogoLayout = options.layout ?? spec.layout;
  if (spec.type === 'WORDMARK' && !options.layout) layout = 'text';

  const text = spec.uppercase ? spec.text.toUpperCase() : spec.text;
  const tagline = spec.tagline.trim().toUpperCase();
  const textStyle: TextStyle = {
    fontId: spec.fontId,
    weight: spec.fontWeight,
    size: TEXT_SIZE,
    letterSpacing: spec.letterSpacing * TEXT_SIZE,
  };
  const name = shapeText(text, textStyle);
  const taglineText = tagline
    ? shapeText(tagline, {
        fontId: FALLBACK_FONT,
        weight: 600,
        size: TAGLINE_SIZE,
        letterSpacing: TAGLINE_SPACING * TAGLINE_SIZE,
      })
    : null;
  const blockWidth = Math.max(name.width, taglineText?.width ?? 0);
  const textBlockHeight = TEXT_SIZE + (taglineText ? TAGLINE_SIZE + 14 : 0);
  const taglineColor =
    colors.secondary === colors.background
      ? colors.text
      : ensureContrast(colors.secondary, colors.background, 3);
  const taglineEl = (x: number, y: number, anchor: 'start' | 'middle') =>
    taglineText ? path(taglineText.toPath(x, y, anchor), taglineColor) : '';

  const body: string[] = [];
  let width: number;
  let height: number;

  if (spec.type === 'EMBLEM' && layout !== 'icon' && layout !== 'text') {
    // Badge : symbole et nom réunis dans un cercle à double filet
    const diameter = Math.max(320, blockWidth * 0.62 + 120);
    width = diameter + PAD * 2;
    height = diameter + PAD * 2;
    const cx = width / 2;
    const cy = height / 2;
    const r = diameter / 2;
    const ink = variant === 'white' ? '#111111' : '#ffffff';
    body.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colors.primary}"/>`);
    body.push(
      `<circle cx="${cx}" cy="${cy}" r="${r - 12}" fill="none" stroke="${colors.secondary}" stroke-width="3"/>`,
    );
    const inner = { ...spec, iconFrame: 'none' as const };
    body.push(renderMark(inner, { ...colors, primary: ink }, cx - 48, cy - r * 0.62, 96, variant));
    const fitted = Math.min(TEXT_SIZE, (TEXT_SIZE * (diameter - 80)) / Math.max(name.width, 1));
    const scaled = shapeText(text, {
      ...textStyle,
      size: fitted,
      letterSpacing: 0,
    });
    body.push(path(scaled.toPath(cx, cy + 30, 'middle'), ink));
    if (tagline) {
      const small = shapeText(tagline, {
        fontId: FALLBACK_FONT,
        weight: 600,
        size: 16,
        letterSpacing: 3,
      });
      body.push(path(small.toPath(cx, cy + 70, 'middle'), ink, ' fill-opacity="0.85"'));
    }
  } else if (layout === 'icon') {
    width = MARK_SIZE + PAD * 2;
    height = MARK_SIZE + PAD * 2;
    body.push(renderMark(spec, colors, PAD, PAD, MARK_SIZE, variant));
  } else if (layout === 'text') {
    width = blockWidth + PAD * 2;
    height = textBlockHeight + PAD * 2;
    body.push(path(name.toPath(width / 2, PAD + TEXT_SIZE * 0.8, 'middle'), colors.text));
    body.push(taglineEl(width / 2, PAD + TEXT_SIZE + TAGLINE_SIZE + 6, 'middle'));
  } else if (layout === 'vertical') {
    width = Math.max(blockWidth, MARK_SIZE) + PAD * 2;
    height = MARK_SIZE + 28 + textBlockHeight + PAD * 2;
    body.push(renderMark(spec, colors, (width - MARK_SIZE) / 2, PAD, MARK_SIZE, variant));
    const baseline = PAD + MARK_SIZE + 28 + TEXT_SIZE * 0.8;
    body.push(path(name.toPath(width / 2, baseline, 'middle'), colors.text));
    body.push(taglineEl(width / 2, baseline + TAGLINE_SIZE + 18, 'middle'));
  } else {
    const gap = 28;
    width = MARK_SIZE + gap + blockWidth + PAD * 2;
    height = Math.max(MARK_SIZE, textBlockHeight) + PAD * 2;
    body.push(renderMark(spec, colors, PAD, (height - MARK_SIZE) / 2, MARK_SIZE, variant));
    const textX = PAD + MARK_SIZE + gap;
    const baseline = (height - textBlockHeight) / 2 + TEXT_SIZE * 0.8;
    body.push(path(name.toPath(textX, baseline, 'start'), colors.text));
    body.push(taglineEl(textX, baseline + TAGLINE_SIZE + 18, 'start'));
  }

  width = Math.ceil(width);
  height = Math.ceil(height);
  const background =
    (options.withBackground ?? variant === 'white')
      ? `<rect width="${width}" height="${height}" fill="${colors.background}"/>`
      : '';
  const watermark = options.watermark ? watermarkLayer(width, height, options.watermark) : '';
  const label = escapeXml(spec.text);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${label}"><title>${label}</title>${background}${body.join('')}${watermark}</svg>`;
  return { svg, width, height };
}

export interface LogoVariantDef {
  /** Identifiant partagé avec le front. */
  id: string;
  /** Suffixe des fichiers exportés. */
  file: string;
  variant: LogoVariant;
  layout?: LogoLayout;
}

/** Variantes produites automatiquement (LOGO-20). */
export const LOGO_VARIANTS: LogoVariantDef[] = [
  { id: 'color', file: 'couleur', variant: 'color' },
  { id: 'black', file: 'noir', variant: 'black' },
  { id: 'white', file: 'blanc', variant: 'white' },
  { id: 'icon', file: 'icone', variant: 'color', layout: 'icon' },
  { id: 'horizontal', file: 'horizontal', variant: 'color', layout: 'horizontal' },
  { id: 'vertical', file: 'vertical', variant: 'color', layout: 'vertical' },
];
