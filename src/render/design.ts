import type {
  DesignDoc,
  DesignElement,
  DesignPage,
  IconElement,
  ImageElement,
  Paint,
  Shadow,
  ShapeElement,
  Stroke,
  SvgElement,
  TextElement,
} from './design-doc';
import { closestWeight, getFont, shapeText, type TextStyle } from './fonts';
import { hasEffects, letteringLayers } from './lettering';
import { adjustFilter, effectsFilter, isNeutral, photoPlacement, vignetteGradient } from './photo';
import { escapeXml } from './svg';

// Rendu serveur d'une page du Studio (même géométrie que le front, src/lib/studio/render.ts) :
// le texte est converti en tracés à partir des lignes calculées par l'éditeur, le fichier
// s'affiche et s'imprime donc sans les polices.

const n = (value: number) => Math.round(value * 100) / 100;

// ─── Peintures, contours, ombres ───

function stops(paint: Extract<Paint, { stops: unknown }>) {
  return paint.stops
    .map((stop) => `<stop offset="${n(stop.offset)}" stop-color="${stop.color}"/>`)
    .join('');
}

export function paintValue(paint: Paint, id: string, defs: string[]) {
  switch (paint.type) {
    case 'none':
      return 'none';
    case 'solid':
      return paint.color;
    case 'linear': {
      const rad = (paint.angle * Math.PI) / 180;
      const dx = Math.cos(rad) / 2;
      const dy = Math.sin(rad) / 2;
      defs.push(
        `<linearGradient id="${id}" x1="${n(0.5 - dx)}" y1="${n(0.5 - dy)}" x2="${n(0.5 + dx)}" y2="${n(0.5 + dy)}">${stops(paint)}</linearGradient>`,
      );
      return `url(#${id})`;
    }
    case 'radial':
      defs.push(
        `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stops(paint)}</radialGradient>`,
      );
      return `url(#${id})`;
  }
}

function strokeAttrs(stroke: Stroke | null | undefined, extraWidth = 1) {
  if (!stroke || stroke.width <= 0) return '';
  const width = stroke.width * extraWidth;
  const dashes: Record<string, string> = {
    dashed: ` stroke-dasharray="${n(width * 3)} ${n(width * 2)}"`,
    dotted: ` stroke-dasharray="0 ${n(width * 2)}" stroke-linecap="round"`,
  };
  const dash = (stroke.dash && dashes[stroke.dash]) ?? '';
  return ` stroke="${stroke.color}" stroke-width="${n(width)}" stroke-linejoin="round"${dash}`;
}

function shadowFilter(id: string, shadow: Shadow) {
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feDropShadow dx="${n(shadow.x)}" dy="${n(shadow.y)}" stdDeviation="${n(shadow.blur / 2)}" flood-color="${shadow.color}" flood-opacity="${n(shadow.opacity)}"/></filter>`;
}

// ─── Formes ───

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function blobPath(width: number, height: number, seed = 1) {
  const random = mulberry32(seed);
  const count = 7;
  const points = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const radius = 0.72 + random() * 0.28;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
  });
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const fit = points.map(
    ([x, y]) =>
      [((x - minX) / (maxX - minX)) * width, ((y - minY) / (maxY - minY)) * height] as const,
  );
  let d = `M${n(fit[0][0])} ${n(fit[0][1])}`;
  for (let i = 0; i < count; i++) {
    const p0 = fit[(i - 1 + count) % count];
    const p1 = fit[i];
    const p2 = fit[(i + 1) % count];
    const p3 = fit[(i + 2) % count];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p2[0])} ${n(p2[1])}`;
  }
  return `${d}Z`;
}

function regularPoints(width: number, height: number, count: number, inner?: number) {
  const total = inner === undefined ? count : count * 2;
  return Array.from({ length: total }, (_, i) => {
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
    const r = inner !== undefined && i % 2 === 1 ? inner : 1;
    return `${n(width / 2 + (Math.cos(angle) * r * width) / 2)},${n(height / 2 + (Math.sin(angle) * r * height) / 2)}`;
  }).join(' ');
}

export function archPath(width: number, height: number) {
  const r = Math.min(width / 2, height);
  return `M0 ${n(height)}V${n(r)}A${n(width / 2)} ${n(r)} 0 0 1 ${n(width)} ${n(r)}V${n(height)}Z`;
}

/** Ancre SVG et abscisse du texte selon son alignement. */
function textAnchor(el: { align?: string; width: number }) {
  if (el.align === 'center') return { anchor: 'middle' as const, x: el.width / 2 };
  if (el.align === 'right') return { anchor: 'end' as const, x: el.width };
  return { anchor: 'start' as const, x: 0 };
}

const sign = (flipped?: boolean) => (flipped ? -1 : 1);

function renderShape(el: ShapeElement, pid: string, defs: string[]) {
  const { width: w, height: h } = el;
  const fillId = `${pid}-f`;
  const paint = `fill="${paintValue(el.fill, fillId, defs)}"${strokeAttrs(el.stroke)}`;
  switch (el.shape) {
    case 'rect': {
      const r = Math.min(el.radius ?? 0, w / 2, h / 2);
      const radius = r > 0 ? ` rx="${n(r)}"` : '';
      return `<rect width="${n(w)}" height="${n(h)}"${radius} ${paint}/>`;
    }
    case 'ellipse':
      return `<ellipse cx="${n(w / 2)}" cy="${n(h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${paint}/>`;
    case 'triangle':
      return `<polygon points="${n(w / 2)},0 ${n(w)},${n(h)} 0,${n(h)}" ${paint}/>`;
    case 'polygon':
      return `<polygon points="${regularPoints(w, h, Math.max(3, el.sides ?? 6))}" ${paint}/>`;
    case 'star':
      return `<polygon points="${regularPoints(w, h, Math.max(3, el.sides ?? 5), el.innerRatio ?? 0.5)}" ${paint}/>`;
    case 'blob':
      return `<path d="${blobPath(w, h, el.seed)}" ${paint}/>`;
    case 'arch':
      return `<path d="${archPath(w, h)}" ${paint}/>`;
    case 'line':
    case 'arrow': {
      const color = el.stroke?.color ?? (el.fill.type === 'solid' ? el.fill.color : '#111827');
      const width = el.stroke?.width ?? Math.max(2, h / 4);
      const dash = strokeAttrs({ color, width, dash: el.stroke?.dash ?? 'solid' });
      const head = el.shape === 'arrow' ? Math.min(w / 3, width * 4) : 0;
      const line = `<line x1="0" y1="${n(h / 2)}" x2="${n(w - head * 0.8)}" y2="${n(h / 2)}"${dash} stroke-linecap="round"/>`;
      if (!head) return line;
      return `${line}<polygon points="${n(w - head)},${n(h / 2 - head / 2)} ${n(w)},${n(h / 2)} ${n(w - head)},${n(h / 2 + head / 2)}" fill="${color}"/>`;
    }
  }
}

// ─── Texte en tracés ───

export function displayText(el: Pick<TextElement, 'text' | 'uppercase'>) {
  return el.uppercase ? el.text.toLocaleUpperCase('fr') : el.text;
}

export function lineMetrics(el: Pick<TextElement, 'fontId' | 'fontSize' | 'lineHeight'>) {
  const font = getFont(el.fontId);
  const box = el.fontSize * el.lineHeight;
  const baseline =
    (box - (font.ascent + font.descent) * el.fontSize) / 2 + font.ascent * el.fontSize;
  return { box, baseline };
}

export function curveGeometry(el: TextElement) {
  const bend = Math.max(-100, Math.min(100, el.curve ?? 0)) / 100;
  const theta = Math.max(0.0001, Math.abs(bend) * Math.PI);
  const radius = el.width / (2 * Math.sin(theta / 2));
  const sagitta = radius * (1 - Math.cos(theta / 2));
  return { bend, theta, radius, sagitta };
}

function textStyle(el: TextElement): TextStyle {
  return {
    fontId: el.fontId,
    weight: closestWeight(el.fontId, el.fontWeight),
    size: el.fontSize,
    letterSpacing: el.letterSpacing * el.fontSize,
  };
}

/**
 * Texte en courbe : chaque retour à la ligne, avec les blancs qui l'entourent, devient une espace
 * (découpage linéaire, sans expression régulière à retour arrière).
 */
export function singleLine(text: string) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  return parts
    .map((part, i) => {
      const start = i > 0 ? part.trimStart() : part;
      return i < last ? start.trimEnd() : start;
    })
    .filter((part, i) => part !== '' || i === 0 || i === last)
    .join(' ');
}

/** Lignes du texte : celles de l'éditeur, sinon un retour à la ligne à la largeur de la boîte. */
export function textLines(el: TextElement) {
  if (el.lines?.length) return el.lines;
  const text = displayText(el);
  if (el.curve) return [singleLine(text)];
  const style = textStyle(el);
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && shapeText(candidate, style).width > el.width) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Glyphe d'un texte : tracé, et position sur l'arc pour un texte en courbe. */
export interface PlacedGlyph {
  d: string;
  at?: { x: number; y: number; deg: number };
}

/** Glyphes d'un texte dans le repère de sa boîte (même géométrie pour l'affichage et la découpe). */
export function textGlyphs(el: TextElement): PlacedGlyph[] {
  const style = textStyle(el);
  const { box, baseline } = lineMetrics(el);
  if (el.curve) {
    // Chaque glyphe est posé sur l'arc, tangent au cercle.
    const { bend, radius, sagitta } = curveGeometry(el);
    // Angle de chaque glyphe depuis le sommet de l'arc, texte centré sur l'arc.
    const shaped = shapeText(textLines(el).join(' '), style);
    const cx = el.width / 2;
    return shaped
      .glyphs()
      .filter((g) => g.d)
      .map((g) => {
        const phi = (g.x - shaped.width / 2) / radius;
        const deg = (phi * 180) / Math.PI;
        if (bend > 0) {
          // Arc bombé vers le haut : centre sous le sommet, glyphes à l'extérieur.
          const cy = baseline + radius;
          return {
            d: g.d,
            at: { x: cx + radius * Math.sin(phi), y: cy - radius * Math.cos(phi), deg },
          };
        }
        // Arc en creux : centre au-dessus, glyphes à l'intérieur.
        const cy = baseline + sagitta - radius;
        return {
          d: g.d,
          at: { x: cx + radius * Math.sin(phi), y: cy + radius * Math.cos(phi), deg: -deg },
        };
      });
  }
  const { anchor, x } = textAnchor(el);
  return textLines(el)
    .map((line, i) => shapeText(line, style).toPath(x, i * box + baseline, anchor))
    .filter(Boolean)
    .map((d) => ({ d }));
}

/** Largeur naturelle d'un texte (ligne la plus longue) : ajustement d'un nom à sa zone. */
export function shapeTextWidth(el: TextElement) {
  const style = textStyle(el);
  return Math.max(0, ...textLines(el).map((line) => shapeText(line, style).width));
}

// Nombres d'opentype : séparés par une espace ou par le signe moins, sans exposant.
const PATH_TOKEN = /[MLQCZ]|-?[\d.]+/gi;

/**
 * Tracé d'un glyphe posé : rotation puis translation appliquées aux coordonnées (commandes
 * absolues M, L, Q, C, Z d'opentype, toutes par paires x y).
 */
function placePath(d: string, at: { x: number; y: number; deg: number }) {
  const a = (at.deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const out: string[] = [];
  let x: number | null = null;
  for (const token of d.match(PATH_TOKEN) ?? []) {
    if (/[MLQCZ]/i.test(token)) {
      out.push(token);
    } else if (x === null) {
      x = Number(token);
    } else {
      const y = Number(token);
      out.push(`${n(at.x + x * cos - y * sin)} ${n(at.y + x * sin + y * cos)}`);
      x = null;
    }
  }
  return out.join(' ');
}

function renderText(el: TextElement, pid: string, defs: string[]) {
  const fill = paintValue(el.fill, `${pid}-f`, defs);
  const stroke =
    el.stroke && el.stroke.width > 0 ? `${strokeAttrs(el.stroke, 2)} paint-order="stroke"` : '';
  const parts: string[] = [];
  if (el.highlight) {
    const pad = el.highlight.padding;
    parts.push(
      `<rect x="${n(-pad)}" y="${n(-pad)}" width="${n(el.width + pad * 2)}" height="${n(el.height + pad * 2)}" rx="${n(el.highlight.radius)}" fill="${el.highlight.color}"/>`,
    );
  }
  // Un seul tracé pour tout le texte, glyphes de l'arc déjà posés : les dégradés et bandes de
  // couleurs s'étendent sur tout le texte, comme sur l'élément <text> du navigateur.
  const d = textGlyphs(el)
    .map((glyph) => (glyph.at ? placePath(glyph.d, glyph.at) : glyph.d))
    .join('');
  const glyphs = d ? `<path d="${d}"/>` : '';
  parts.push(paintGlyphs(el, glyphs, { fill, stroke, pid, defs }));
  return parts.join('');
}

/** Glyphes peints : simplement, ou en calques d'effets de lettrage. */
function paintGlyphs(
  el: TextElement,
  glyphs: string,
  paint: { fill: string; stroke: string; pid: string; defs: string[] },
) {
  if (!hasEffects(el.effects)) return `<g fill="${paint.fill}"${paint.stroke}>${glyphs}</g>`;
  return letteringLayers({
    glyphs,
    pid: paint.pid,
    fill: paint.fill,
    stroke: el.stroke,
    effects: el.effects,
    box: { x: 0, y: 0, width: el.width, height: el.height },
    size: el.fontSize,
    defs: paint.defs,
  });
}

// ─── Images, icônes, SVG ───

function imageMaskShape(el: ImageElement) {
  const { width: w, height: h } = el;
  switch (el.mask) {
    case 'circle':
      return `<ellipse cx="${n(w / 2)}" cy="${n(h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}"/>`;
    case 'rounded':
      return `<rect width="${n(w)}" height="${n(h)}" rx="${n(el.radius ?? Math.min(w, h) * 0.12)}"/>`;
    case 'arch':
      return `<path d="${archPath(w, h)}"/>`;
    case 'blob':
      return `<path d="${blobPath(w, h, 7)}"/>`;
    default:
      return `<rect width="${n(w)}" height="${n(h)}"/>`;
  }
}

/** Image entière dans le repère de l'élément (recadrage compris, avant redressement). */
export function imagePlacement(el: ImageElement) {
  return photoPlacement(el).image;
}

function imageFilter(id: string, el: ImageElement) {
  const f = el.filters;
  if (!f || (f.brightness === 1 && f.contrast === 1 && f.saturation === 1 && !f.blur)) return null;
  const slope = f.brightness * f.contrast;
  const intercept = 0.5 - 0.5 * f.contrast;
  const channel = (c: string) =>
    `<feFunc${c} type="linear" slope="${n(slope)}" intercept="${n(intercept)}"/>`;
  const blur = f.blur ? `<feGaussianBlur stdDeviation="${n(f.blur)}"/>` : '';
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="${n(f.saturation)}"/><feComponentTransfer>${channel('R')}${channel('G')}${channel('B')}</feComponentTransfer>${blur}</filter>`;
}

function renderImage(el: ImageElement, pid: string, defs: string[]) {
  const place = photoPlacement(el);
  const { image, region } = place;
  defs.push(`<clipPath id="${pid}-clip">${imageMaskShape(el)}</clipPath>`);
  // Réglages de retouche ; à défaut, les anciens filtres simples (documents existants).
  const filter = el.adjust
    ? adjustFilter(`${pid}-img`, el.adjust, Math.max(region.width, region.height))
    : imageFilter(`${pid}-img`, el);
  if (filter) defs.push(filter);
  const filterAttr = filter ? ` filter="url(#${pid}-img)"` : '';
  const box = `x="${n(image.x)}" y="${n(image.y)}" width="${n(image.width)}" height="${n(image.height)}"`;
  let body = `<image href="${el.src}" xlink:href="${el.src}" ${box} preserveAspectRatio="none"${filterAttr}/>`;
  const vignette = el.adjust?.vignette ?? 0;
  if (vignette) {
    defs.push(vignetteGradient(`${pid}-vig`, vignette, region));
    body += `<rect x="${n(region.x)}" y="${n(region.y)}" width="${n(region.width)}" height="${n(region.height)}" fill="url(#${pid}-vig)"/>`;
  }
  if (el.cutout) {
    defs.push(
      `<mask id="${pid}-cut" maskUnits="userSpaceOnUse" ${box}><image href="${el.cutout}" xlink:href="${el.cutout}" ${box} preserveAspectRatio="none"/></mask>`,
    );
    body = `<g mask="url(#${pid}-cut)">${body}</g>`;
  }
  if (el.crop) {
    defs.push(
      `<clipPath id="${pid}-crop"><rect x="${n(region.x)}" y="${n(region.y)}" width="${n(region.width)}" height="${n(region.height)}"/></clipPath>`,
    );
    body = `<g clip-path="url(#${pid}-crop)">${body}</g>`;
  }
  if (place.transform) body = `<g transform="${place.transform}">${body}</g>`;
  const framed = `<g clip-path="url(#${pid}-clip)">${body}</g>`;
  const effects = effectsFilter(`${pid}-fx`, el.outline, el.glow, el);
  if (!effects) return framed;
  defs.push(effects);
  return `<g filter="url(#${pid}-fx)">${framed}</g>`;
}

export function svgParts(svg: string) {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const viewBox = /viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(root);
  const width = Number(/\bwidth="([\d.]+)/.exec(root)?.[1] ?? 100);
  const height = Number(/\bheight="([\d.]+)/.exec(root)?.[1] ?? 100);
  const box = viewBox ? viewBox.slice(1, 5).map(Number) : [0, 0, width, height];
  const inner = svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '');
  return { minX: box[0], minY: box[1], width: box[2], height: box[3], inner };
}

export function prefixIds(markup: string, prefix: string) {
  return markup
    .replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${prefix}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${prefix}-${id})`)
    .replace(/(href)="#([^"]+)"/g, (_m, attr: string, id: string) => `${attr}="#${prefix}-${id}"`);
}

function renderSvg(el: SvgElement, pid: string) {
  const parts = svgParts(el.svg);
  const scale = Math.min(el.width / parts.width, el.height / parts.height);
  const ox = (el.width - parts.width * scale) / 2 - parts.minX * scale;
  const oy = (el.height - parts.height * scale) / 2 - parts.minY * scale;
  return `<g transform="translate(${n(ox)} ${n(oy)}) scale(${n(scale * 10000) / 10000})">${prefixIds(parts.inner, pid)}</g>`;
}

function renderIcon(el: IconElement) {
  const nodes = el.node
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .filter(([key]) => key !== 'key' && /^[a-z-]+$/i.test(key))
        .map(([key, value]) => `${key}="${escapeXml(value === 'currentColor' ? el.color : value)}"`)
        .join(' ');
      return `<${tag} ${attributes}/>`;
    })
    .join('');
  return `<g transform="scale(${n(el.width / 24)} ${n(el.height / 24)})" fill="none" stroke="${el.color}" stroke-width="${n(el.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${nodes}</g>`;
}

// ─── Éléments et pages ───

export function elementTransform(el: DesignElement) {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const rotate = el.rotation ? ` rotate(${n(el.rotation)})` : '';
  const flip = el.flipX || el.flipY ? ` scale(${sign(el.flipX)} ${sign(el.flipY)})` : '';
  return `translate(${n(cx)} ${n(cy)})${rotate}${flip} translate(${n(-el.width / 2)} ${n(-el.height / 2)})`;
}

export function svgId(id: string) {
  return `s${id.replace(/[^\w-]/g, '')}`;
}

export function renderElement(el: DesignElement) {
  if (el.hidden) return '';
  const pid = svgId(el.id);
  const defs: string[] = [];
  let body: string;
  switch (el.type) {
    case 'text':
      body = renderText(el, pid, defs);
      break;
    case 'shape':
      body = renderShape(el, pid, defs);
      break;
    case 'icon':
      body = renderIcon(el);
      break;
    case 'image':
      body = renderImage(el, pid, defs);
      break;
    case 'svg':
      body = renderSvg(el, pid);
      break;
  }
  const outer: string[] = [];
  if (el.shadow && el.shadow.opacity > 0) {
    defs.push(shadowFilter(`${pid}-sh`, el.shadow));
    outer.push(`filter="url(#${pid}-sh)"`);
  }
  if (el.opacity < 1) outer.push(`opacity="${n(el.opacity)}"`);
  if (el.blend && el.blend !== 'normal') outer.push(`style="mix-blend-mode:${el.blend}"`);
  const defsMarkup = defs.length ? `<defs>${defs.join('')}</defs>` : '';
  const attrs = outer.map((attr) => ` ${attr}`).join('');
  return `<g${attrs}>${defsMarkup}<g transform="${elementTransform(el)}">${body}</g></g>`;
}

export function renderBackground(
  page: DesignPage,
  doc: Pick<DesignDoc, 'width' | 'height'>,
  bleed = 0,
) {
  const defs: string[] = [];
  const fill = paintValue(page.background, `bg-${svgId(page.id)}`, defs);
  if (fill === 'none') return '';
  const defsMarkup = defs.length ? `<defs>${defs.join('')}</defs>` : '';
  return `${defsMarkup}<rect x="${n(-bleed)}" y="${n(-bleed)}" width="${n(doc.width + bleed * 2)}" height="${n(doc.height + bleed * 2)}" fill="${fill}"/>`;
}

function imageNeedsRaster(el: ImageElement) {
  const legacy =
    !!el.filters &&
    (el.filters.brightness !== 1 ||
      el.filters.contrast !== 1 ||
      el.filters.saturation !== 1 ||
      el.filters.blur > 0);
  return (
    legacy ||
    !isNeutral(el.adjust) ||
    !!el.cutout ||
    !!el.outline?.width ||
    !!(el.glow && el.glow.size > 0 && el.glow.opacity > 0)
  );
}

/** Effets qu'un PDF vectoriel ne sait pas reproduire : la page est alors tramée à 300 dpi. */
export function pageNeedsRaster(page: DesignPage) {
  return page.elements.some(
    (el) =>
      !el.hidden &&
      ((el.shadow && el.shadow.opacity > 0) ||
        (el.blend && el.blend !== 'normal') ||
        (el.type === 'image' && imageNeedsRaster(el)) ||
        (el.type === 'svg' && /<filter\b|mix-blend-mode/.test(el.svg))),
  );
}

/** Page complète en SVG autonome ; `bleed` ajoute le fond perdu autour de la page (px). */
export function renderDesignPage(
  doc: DesignDoc,
  pageIndex: number,
  options: { bleed?: number } = {},
) {
  const page = doc.pages[pageIndex] ?? doc.pages[0];
  const bleed = options.bleed ?? 0;
  const width = doc.width + bleed * 2;
  const height = doc.height + bleed * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${n(-bleed)} ${n(-bleed)} ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}">${renderBackground(page, doc, bleed)}${page.elements.map(renderElement).join('')}</svg>`;
}
