/**
 * Moteur A — composition SVG (§5.1). Rend une LogoSpec en SVG autonome :
 * texte converti en tracés (s'affiche sans police installée, §5.5), icônes vectorielles,
 * pastilles et emblèmes évidés par masque pour des variantes monochromes exactes.
 */
import { createHash } from 'node:crypto';
import * as opentype from 'opentype.js';
import { contrastRatio, ensureContrast } from '../shared/color';
import type { LogoSpec } from '../shared/logo-spec';
import { escapeAttr, iconMarkup, loadFont } from './assets';

export interface RenderedLogo {
  svg: string;
  width: number;
  height: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fragment positionné : `markup` dessiné dans le repère de `box`. */
interface Piece {
  box: Box;
  markup: string;
  defs?: string;
}

const MAIN_SIZE = 100;
const TAGLINE_RATIO = 0.3;

// ─── Texte en tracés ───

export interface TextShape {
  d: string;
  box: Box;
}

export function textToPath(
  text: string,
  fontId: string,
  weight: number,
  size: number,
  letterSpacing = 0,
): TextShape {
  const font = loadFont(fontId, weight);
  const glyphs = font.stringToGlyphs(text);
  const scale = size / font.unitsPerEm;
  const path = new opentype.Path();
  let x = 0;
  glyphs.forEach((g, i) => {
    path.extend(g.getPath(x, 0, size));
    x += (g.advanceWidth ?? 0) * scale;
    if (i < glyphs.length - 1) {
      x += font.getKerningValue(g, glyphs[i + 1]) * scale + letterSpacing * size;
    }
  });
  const bb = path.getBoundingBox();
  const empty = !Number.isFinite(bb.x1) || bb.x2 <= bb.x1;
  return {
    d: path.toPathData(2),
    box: empty
      ? { x: 0, y: -size * 0.7, w: x, h: size * 0.7 }
      : { x: bb.x1, y: bb.y1, w: bb.x2 - bb.x1, h: bb.y2 - bb.y1 },
  };
}

/** Pièce de texte normalisée : son coin haut-gauche à l'origine. */
function textPiece(shape: TextShape, color: string): Piece {
  return {
    box: { x: 0, y: 0, w: shape.box.w, h: shape.box.h },
    markup: `<path transform="translate(${r(-shape.box.x)} ${r(-shape.box.y)})" fill="${color}" d="${shape.d}"/>`,
  };
}

export function initials(spec: Pick<LogoSpec, 'acronym' | 'text'>): string {
  if (spec.acronym) return spec.acronym.toUpperCase().slice(0, 3);
  const words = spec.text.split(/[\s-]+/).filter((w) => w.length > 0);
  const letters = words.length > 1 ? words.slice(0, 3).map((w) => w[0]) : [spec.text[0]];
  return letters.join('').toUpperCase();
}

// ─── Icônes et pastilles ───

function iconStroke(id: string, size: number, color: string): string {
  const k = size / 24;
  return `<g transform="scale(${r(k, 4)})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(id)}</g>`;
}

function containerShape(
  kind: 'circle' | 'rounded' | 'hexagon' | 'shield' | 'badge',
  w: number,
  h: number,
): string {
  switch (kind) {
    case 'circle':
      return `<ellipse cx="${r(w / 2)}" cy="${r(h / 2)}" rx="${r(w / 2)}" ry="${r(h / 2)}"/>`;
    case 'rounded':
      return `<rect width="${r(w)}" height="${r(h)}" rx="${r(w * 0.22)}"/>`;
    case 'hexagon': {
      const pts = [0, 1, 2, 3, 4, 5].map((i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return `${r(w / 2 + (w / 2) * Math.cos(a))},${r(h / 2 + (h / 2) * Math.sin(a))}`;
      });
      return `<polygon points="${pts.join(' ')}"/>`;
    }
    case 'shield':
      return `<path d="M0 0H${r(w)}V${r(h * 0.55)}C${r(w)} ${r(h * 0.8)} ${r(w * 0.72)} ${r(h * 0.93)} ${r(w / 2)} ${r(h)}C${r(w * 0.28)} ${r(h * 0.93)} 0 ${r(h * 0.8)} 0 ${r(h * 0.55)}Z"/>`;
    case 'badge': {
      const n = 16;
      const pts = Array.from({ length: n * 2 }, (_, i) => {
        const a = (Math.PI / n) * i - Math.PI / 2;
        const rad = i % 2 ? 0.92 : 1;
        return `${r(w / 2 + (w / 2) * rad * Math.cos(a))},${r(h / 2 + (h / 2) * rad * Math.sin(a))}`;
      });
      return `<polygon points="${pts.join(' ')}"/>`;
    }
  }
}

/**
 * Forme pleine évidée par son contenu (masque) : en monochrome, le contenu reste
 * transparent au lieu d'une seconde couleur.
 */
function knockout(
  id: string,
  shape: string,
  inner: string,
  w: number,
  h: number,
  fill: string,
): Piece {
  return {
    box: { x: 0, y: 0, w, h },
    defs: `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${r(w)}" height="${r(h)}"><g fill="#fff">${shape}</g><g fill="#000" stroke="#000">${inner}</g></mask>`,
    markup: `<g mask="url(#${id})" fill="${fill}">${shape}</g>`,
  };
}

// ─── Assemblage ───

function place(piece: Piece, x: number, y: number, scale = 1): string {
  const t =
    scale === 1 ? `translate(${r(x)} ${r(y)})` : `translate(${r(x)} ${r(y)}) scale(${r(scale, 4)})`;
  return `<g transform="${t}">${piece.markup}</g>`;
}

function group(pieces: { piece: Piece; x: number; y: number; scale?: number }[]): Piece {
  const xs = pieces.flatMap((p) => [p.x, p.x + p.piece.box.w * (p.scale ?? 1)]);
  const ys = pieces.flatMap((p) => [p.y, p.y + p.piece.box.h * (p.scale ?? 1)]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  return {
    box: { x: 0, y: 0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 },
    defs: pieces.map((p) => p.piece.defs ?? '').join(''),
    markup: pieces.map((p) => place(p.piece, p.x - x0, p.y - y0, p.scale)).join(''),
  };
}

/** Bloc nom + signature éventuelle, centré. */
function textBlock(
  spec: LogoSpec,
  color: string,
  taglineColor: string,
): { block: Piece; mainHeight: number } {
  const text = spec.uppercase ? spec.text.toUpperCase() : spec.text;
  const main = textPiece(
    textToPath(text, spec.font.id, spec.font.weight, MAIN_SIZE, spec.letterSpacing),
    color,
  );
  if (!spec.tagline) return { block: main, mainHeight: main.box.h };

  const tf = spec.taglineFont ?? { id: spec.font.id, weight: 400 };
  const tag = textPiece(
    textToPath(spec.tagline, tf.id, tf.weight, MAIN_SIZE * TAGLINE_RATIO, 0.04),
    taglineColor,
  );
  // La signature peut déborder du nom (noms courts), dans la limite de 1,6 fois sa largeur.
  const maxTag = main.box.w * 1.6;
  const scale = tag.box.w > maxTag ? maxTag / tag.box.w : 1;
  const gap = MAIN_SIZE * 0.18;
  const w = Math.max(main.box.w, tag.box.w * scale);
  return {
    block: group([
      { piece: main, x: (w - main.box.w) / 2, y: 0 },
      { piece: tag, x: (w - tag.box.w * scale) / 2, y: main.box.h + gap, scale },
    ]),
    mainHeight: main.box.h,
  };
}

/** Symbole : icône (avec ou sans pastille) ou monogramme. */
function symbol(spec: LogoSpec, size: number, uid: string, color: string): Piece {
  const container = spec.icon?.container ?? 'circle';
  const useIcon = spec.type !== 'MONOGRAM' && spec.icon;

  if (container === 'none') {
    if (useIcon) {
      return {
        box: { x: 0, y: 0, w: size, h: size },
        markup: iconStroke(spec.icon!.id, size, color),
      };
    }
    // Monogramme sans pastille : lettres seules, pleines.
    const letters = textToPath(initials(spec), spec.font.id, spec.font.weight, MAIN_SIZE);
    const k = size / letters.box.h;
    return {
      box: { x: 0, y: 0, w: letters.box.w * k, h: size },
      markup: `<path transform="scale(${r(k, 4)}) translate(${r(-letters.box.x)} ${r(-letters.box.y)})" fill="${color}" d="${letters.d}"/>`,
    };
  }

  const inner = size * 0.56;
  const offset = (size - inner) / 2;
  let content: string;
  if (useIcon) {
    content = `<g transform="translate(${r(offset)} ${r(offset)})">${iconStroke(spec.icon!.id, inner, '#000')}</g>`;
  } else {
    const letters = textToPath(initials(spec), spec.font.id, spec.font.weight, MAIN_SIZE);
    const k = Math.min(inner / letters.box.w, inner / letters.box.h);
    const tx = (size - letters.box.w * k) / 2 - letters.box.x * k;
    const ty = (size - letters.box.h * k) / 2 - letters.box.y * k;
    content = `<path transform="translate(${r(tx)} ${r(ty)}) scale(${r(k, 4)})" d="${letters.d}"/>`;
  }
  return knockout(`${uid}-sym`, containerShape(container, size, size), content, size, size, color);
}

/** Emblème : forme pleine contenant symbole et nom, évidés (LOGO-01). */
function emblem(spec: LogoSpec, uid: string, color: string): Piece {
  const shape = spec.emblem?.shape ?? 'circle';
  const w = 400;
  const h = shape === 'shield' ? 460 : 400;
  const parts: string[] = [];

  const iconSize = 130;
  const iconY = shape === 'shield' ? 70 : 85;
  if (spec.icon) {
    parts.push(
      `<g transform="translate(${r((w - iconSize) / 2)} ${iconY})">${iconStroke(spec.icon.id, iconSize, '#000')}</g>`,
    );
  } else {
    const l = textToPath(initials(spec), spec.font.id, spec.font.weight, MAIN_SIZE);
    const k = Math.min(iconSize / l.box.w, iconSize / l.box.h);
    parts.push(
      `<path transform="translate(${r((w - l.box.w * k) / 2 - l.box.x * k)} ${r(iconY - l.box.y * k)}) scale(${r(k, 4)})" d="${l.d}"/>`,
    );
  }

  if (spec.layout !== 'icon') {
    const text = textToPath(
      spec.text.toUpperCase(),
      spec.font.id,
      spec.font.weight,
      MAIN_SIZE,
      spec.letterSpacing,
    );
    const maxW = w * (shape === 'shield' ? 0.72 : 0.66);
    const k = Math.min(maxW / text.box.w, 60 / text.box.h);
    const ty = iconY + iconSize + 30;
    parts.push(
      `<path transform="translate(${r((w - text.box.w * k) / 2 - text.box.x * k)} ${r(ty - text.box.y * k)}) scale(${r(k, 4)})" d="${text.d}"/>`,
    );
  }

  // Filet intérieur, évidé lui aussi.
  const inset = 16;
  const ring = `<g transform="translate(${inset} ${inset})" fill="none" stroke-width="6">${containerShape(shape, w - inset * 2, h - inset * 2).replace('/>', ' fill="none"/>')}</g>`;
  return knockout(`${uid}-emb`, containerShape(shape, w, h), ring + parts.join(''), w, h, color);
}

// ─── Point d'entrée ───

export interface ComposeOptions {
  /**
   * Corrige les couleurs de texte trop peu contrastées (4,5:1, §5.5). Désactivé pour les
   * variantes monochromes, dont la couleur est voulue.
   */
  enforceContrast?: boolean;
}

export function composeLogo(spec: LogoSpec, opts: ComposeOptions = {}): RenderedLogo {
  const enforce = opts.enforceContrast ?? true;
  const uid = 'l' + createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 8);
  const bg = spec.colors.background ?? null;
  const surface = bg ?? '#FFFFFF';
  const textColor = enforce ? ensureContrast(spec.colors.text, surface) : spec.colors.text;
  const taglineColor = enforce
    ? ensureContrast(spec.colors.secondary ?? spec.colors.text, surface, 3)
    : (spec.colors.secondary ?? spec.colors.text);
  const symbolColor =
    !enforce || contrastRatio(spec.colors.primary, surface) >= 1.5
      ? spec.colors.primary
      : textColor;

  let content: Piece;
  if (spec.type === 'EMBLEM') {
    content = emblem(spec, uid, symbolColor);
  } else {
    const { block, mainHeight } = textBlock(spec, textColor, taglineColor);
    const hasSymbol = spec.type !== 'WORDMARK' || spec.layout === 'icon';
    const layout = !hasSymbol ? 'text' : spec.layout;

    if (layout === 'text') {
      content = block;
    } else if (layout === 'icon') {
      content = symbol(spec, MAIN_SIZE * 2, uid, symbolColor);
    } else if (layout === 'horizontal') {
      const s = Math.max(mainHeight * (spec.icon?.scale ?? 1.4), block.box.h);
      const sym = symbol(spec, s, uid, symbolColor);
      const gap = s * 0.28;
      content = group([
        { piece: sym, x: 0, y: (Math.max(s, block.box.h) - s) / 2 },
        { piece: block, x: s + gap, y: (Math.max(s, block.box.h) - block.box.h) / 2 },
      ]);
    } else {
      const s = mainHeight * (spec.icon?.scale ?? 1.4) * 1.5;
      const sym = symbol(spec, s, uid, symbolColor);
      const w = Math.max(s, block.box.w);
      content = group([
        { piece: sym, x: (w - s) / 2, y: 0 },
        { piece: block, x: (w - block.box.w) / 2, y: s + s * 0.22 },
      ]);
    }
  }

  // Zone de protection : marge égale à 12 % de la plus grande dimension.
  const pad = Math.max(content.box.w, content.box.h) * 0.12;
  const width = r(content.box.w + pad * 2);
  const height = r(content.box.h + pad * 2);
  const background = bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : '';
  const title = `<title>${escapeAttr(spec.text)}</title>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    title +
    (content.defs ? `<defs>${content.defs}</defs>` : '') +
    background +
    place(content, pad, pad) +
    `</svg>`;
  return { svg, width, height };
}

function r(v: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
