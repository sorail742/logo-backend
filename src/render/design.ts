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
  const dash =
    stroke.dash === 'dashed'
      ? ` stroke-dasharray="${n(width * 3)} ${n(width * 2)}"`
      : stroke.dash === 'dotted'
        ? ` stroke-dasharray="0 ${n(width * 2)}" stroke-linecap="round"`
        : '';
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

function renderShape(el: ShapeElement, pid: string, defs: string[]) {
  const { width: w, height: h } = el;
  const paint = `fill="${paintValue(el.fill, `${pid}-f`, defs)}"${strokeAttrs(el.stroke)}`;
  switch (el.shape) {
    case 'rect': {
      const r = Math.min(el.radius ?? 0, w / 2, h / 2);
      return `<rect width="${n(w)}" height="${n(h)}"${r > 0 ? ` rx="${n(r)}"` : ''} ${paint}/>`;
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

/** Lignes du texte : celles de l'éditeur, sinon un retour à la ligne à la largeur de la boîte. */
export function textLines(el: TextElement) {
  if (el.lines?.length) return el.lines;
  const text = displayText(el);
  if (el.curve) return [text.replace(/\s*\n\s*/g, ' ')];
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

function renderText(el: TextElement, pid: string, defs: string[]) {
  const style = textStyle(el);
  const fill = paintValue(el.fill, `${pid}-f`, defs);
  const stroke =
    el.stroke && el.stroke.width > 0 ? `${strokeAttrs(el.stroke, 2)} paint-order="stroke"` : '';
  const { box, baseline } = lineMetrics(el);
  const parts: string[] = [];
  if (el.highlight) {
    const pad = el.highlight.padding;
    parts.push(
      `<rect x="${n(-pad)}" y="${n(-pad)}" width="${n(el.width + pad * 2)}" height="${n(el.height + pad * 2)}" rx="${n(el.highlight.radius)}" fill="${el.highlight.color}"/>`,
    );
  }

  if (el.curve) {
    // Chaque glyphe est posé sur l'arc, tangent au cercle.
    const { bend, radius, sagitta } = curveGeometry(el);
    // Angle de chaque glyphe depuis le sommet de l'arc, texte centré sur l'arc.
    const shaped = shapeText(textLines(el).join(' '), style);
    const cx = el.width / 2;
    const glyphs = shaped
      .glyphs()
      .filter((g) => g.d)
      .map((g) => {
        const phi = (g.x - shaped.width / 2) / radius;
        const deg = (phi * 180) / Math.PI;
        if (bend > 0) {
          // Arc bombé vers le haut : centre sous le sommet, glyphes à l'extérieur.
          const cy = baseline + radius;
          const x = cx + radius * Math.sin(phi);
          const y = cy - radius * Math.cos(phi);
          return `<path transform="translate(${n(x)} ${n(y)}) rotate(${n(deg)})" d="${g.d}"/>`;
        }
        // Arc en creux : centre au-dessus, glyphes à l'intérieur.
        const cy = baseline + sagitta - radius;
        const x = cx + radius * Math.sin(phi);
        const y = cy + radius * Math.cos(phi);
        return `<path transform="translate(${n(x)} ${n(y)}) rotate(${n(-deg)})" d="${g.d}"/>`;
      });
    parts.push(`<g fill="${fill}"${stroke}>${glyphs.join('')}</g>`);
    return parts.join('');
  }

  const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
  const x = el.align === 'center' ? el.width / 2 : el.align === 'right' ? el.width : 0;
  const paths = textLines(el)
    .map((line, i) => shapeText(line, style).toPath(x, i * box + baseline, anchor))
    .filter(Boolean)
    .map((d) => `<path d="${d}"/>`)
    .join('');
  parts.push(`<g fill="${fill}"${stroke}>${paths}</g>`);
  return parts.join('');
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

export function imagePlacement(el: ImageElement) {
  const scale =
    el.fit === 'cover'
      ? Math.max(el.width / el.naturalWidth, el.height / el.naturalHeight)
      : Math.min(el.width / el.naturalWidth, el.height / el.naturalHeight);
  const width = el.naturalWidth * scale;
  const height = el.naturalHeight * scale;
  const fx = el.fit === 'cover' ? (el.focusX ?? 0.5) : 0.5;
  const fy = el.fit === 'cover' ? (el.focusY ?? 0.5) : 0.5;
  return { x: (el.width - width) * fx, y: (el.height - height) * fy, width, height };
}

function imageFilter(id: string, el: ImageElement) {
  const f = el.filters;
  if (!f || (f.brightness === 1 && f.contrast === 1 && f.saturation === 1 && !f.blur)) return null;
  const slope = f.brightness * f.contrast;
  const intercept = 0.5 - 0.5 * f.contrast;
  const channel = (c: string) =>
    `<feFunc${c} type="linear" slope="${n(slope)}" intercept="${n(intercept)}"/>`;
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="${n(f.saturation)}"/><feComponentTransfer>${channel('R')}${channel('G')}${channel('B')}</feComponentTransfer>${f.blur ? `<feGaussianBlur stdDeviation="${n(f.blur)}"/>` : ''}</filter>`;
}

function renderImage(el: ImageElement, pid: string, defs: string[]) {
  const place = imagePlacement(el);
  defs.push(`<clipPath id="${pid}-clip">${imageMaskShape(el)}</clipPath>`);
  const filter = imageFilter(`${pid}-img`, el);
  if (filter) defs.push(filter);
  return `<g clip-path="url(#${pid}-clip)"><image href="${el.src}" xlink:href="${el.src}" x="${n(place.x)}" y="${n(place.y)}" width="${n(place.width)}" height="${n(place.height)}" preserveAspectRatio="none"${filter ? ` filter="url(#${pid}-img)"` : ''}/></g>`;
}

export function svgParts(svg: string) {
  const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
  const viewBox = root.match(
    /viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/,
  );
  const width = Number(root.match(/\bwidth="([\d.]+)/)?.[1] ?? 100);
  const height = Number(root.match(/\bheight="([\d.]+)/)?.[1] ?? 100);
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
  const flip = el.flipX || el.flipY ? ` scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})` : '';
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
  return `<g${outer.length ? ` ${outer.join(' ')}` : ''}>${defsMarkup}<g transform="${elementTransform(el)}">${body}</g></g>`;
}

export function renderBackground(
  page: DesignPage,
  doc: Pick<DesignDoc, 'width' | 'height'>,
  bleed = 0,
) {
  const defs: string[] = [];
  const fill = paintValue(page.background, `bg-${svgId(page.id)}`, defs);
  if (fill === 'none') return '';
  return `${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<rect x="${n(-bleed)}" y="${n(-bleed)}" width="${n(doc.width + bleed * 2)}" height="${n(doc.height + bleed * 2)}" fill="${fill}"/>`;
}

/** Effets qu'un PDF vectoriel ne sait pas reproduire : la page est alors tramée à 300 dpi. */
export function pageNeedsRaster(page: DesignPage) {
  return page.elements.some(
    (el) =>
      !el.hidden &&
      ((el.shadow && el.shadow.opacity > 0) ||
        (el.blend && el.blend !== 'normal') ||
        (el.type === 'image' &&
          el.filters &&
          (el.filters.brightness !== 1 ||
            el.filters.contrast !== 1 ||
            el.filters.saturation !== 1 ||
            el.filters.blur > 0)) ||
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
