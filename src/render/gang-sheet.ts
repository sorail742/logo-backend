import { pieceMarkup, type PrintPiece } from './apparel-print';

// Planche de transfert (« gang sheet ») : les pièces imbriquées sur une feuille (A4, A3, A3+) ou
// un rouleau (film DTF, papier sublimation, flex), en rangées, avec l'espace de coupe conseillé
// par les ateliers (1 cm entre deux visuels, marges aux bords). Unités : millimètres.

const n = (value: number) => Math.round(value * 100) / 100;

export const SHEET_FORMATS = {
  A4: { widthMm: 210, heightMm: 297, roll: false },
  A3: { widthMm: 297, heightMm: 420, roll: false },
  A3_PLUS: { widthMm: 329, heightMm: 483, roll: false },
  ROLL: { widthMm: 580, heightMm: 1000, roll: true },
} as const;
export type SheetFormatKey = keyof typeof SHEET_FORMATS;

export interface SheetOptions {
  format: SheetFormatKey;
  /** Laize d'un rouleau (mm) : 300, 330, 580, 600… */
  rollWidthMm?: number;
  /** Longueur d'une page de rouleau (mm). */
  rollPageMm?: number;
  marginMm?: number;
  gapMm?: number;
}

export interface Placement {
  piece: PrintPiece;
  x: number;
  y: number;
  /** Pièce tournée d'un quart de tour pour tenir dans la largeur. */
  rotated: boolean;
}

export interface SheetPage {
  widthMm: number;
  heightMm: number;
  placements: Placement[];
}

export interface PackResult {
  pages: SheetPage[];
  /** Pièces plus grandes que la feuille, même tournées. */
  oversized: PrintPiece[];
}

export function sheetSize(options: SheetOptions) {
  const format = SHEET_FORMATS[options.format];
  if (!format.roll) return { widthMm: format.widthMm, heightMm: format.heightMm };
  return {
    widthMm: options.rollWidthMm ?? format.widthMm,
    heightMm: options.rollPageMm ?? format.heightMm,
  };
}

interface PackItem {
  piece: PrintPiece;
  w: number;
  h: number;
  rotated: boolean;
}

/** Exemplaires à poser (tournés s'ils ne tiennent qu'ainsi), du plus haut au plus bas. */
function packItems(pieces: PrintPiece[], usableW: number, usableH: number) {
  const items: PackItem[] = [];
  const oversized: PrintPiece[] = [];
  for (const piece of pieces) {
    const fits = piece.widthMm <= usableW && piece.heightMm <= usableH;
    const turned = piece.heightMm <= usableW && piece.widthMm <= usableH;
    if (!fits && !turned) {
      oversized.push(piece);
      continue;
    }
    const item: PackItem = fits
      ? { piece, w: piece.widthMm, h: piece.heightMm, rotated: false }
      : { piece, w: piece.heightMm, h: piece.widthMm, rotated: true };
    for (let i = 0; i < piece.quantity; i++) items.push(item);
  }
  items.sort((a, b) => b.h - a.h || b.w - a.w);
  return { items, oversized };
}

/**
 * Imbrication en rangées (pièces triées par hauteur) ; une pièce trop large est tournée si elle
 * tient ainsi. Chaque exemplaire est posé (quantité de la pièce).
 */
export function packPieces(pieces: PrintPiece[], options: SheetOptions): PackResult {
  const { widthMm, heightMm } = sheetSize(options);
  const margin = options.marginMm ?? 8;
  const gap = options.gapMm ?? 10;
  const usableW = widthMm - margin * 2;
  const usableH = heightMm - margin * 2;
  const { items, oversized } = packItems(pieces, usableW, usableH);

  const pages: SheetPage[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const item of items) {
    if (x > 0 && x + item.w > usableW) {
      // Rangée suivante.
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    if (!pages.length || y + item.h > usableH) {
      pages.push({ widthMm, heightMm, placements: [] });
      x = 0;
      y = 0;
      rowH = 0;
    }
    pages[pages.length - 1].placements.push({
      piece: item.piece,
      x: margin + x,
      y: margin + y,
      rotated: item.rotated,
    });
    x += item.w + gap;
    rowH = Math.max(rowH, item.h);
  }
  return { pages, oversized };
}

/** Repères de coupe en coin autour d'une pièce (dans l'espace entre les pièces). */
function cutMarks(x: number, y: number, w: number, h: number) {
  const o = 1.5;
  const l = 3;
  const corners: [number, number, number, number][] = [
    [x, y, -1, -1],
    [x + w, y, 1, -1],
    [x, y + h, -1, 1],
    [x + w, y + h, 1, 1],
  ];
  return corners
    .map(
      ([cx, cy, sx, sy]) =>
        `M${n(cx + sx * o)} ${n(cy)}h${n(sx * l)}M${n(cx)} ${n(cy + sy * o)}v${n(sy * l)}`,
    )
    .join('');
}

/**
 * Page de planche en SVG (mm) : pièces placées, repères de coupe facultatifs, miroir de toute la
 * page pour les supports posés face contre le tissu (papier transfert, sublimation, flex).
 */
export function sheetSvg(
  sheet: SheetPage,
  options: { mirror?: boolean; cutMarks?: boolean; background?: string | null } = {},
) {
  const parts = sheet.placements.map((p, i) => {
    const h = p.piece.heightMm;
    const transform = p.rotated
      ? `translate(${n(p.x + h)} ${n(p.y)}) rotate(90)`
      : `translate(${n(p.x)} ${n(p.y)})`;
    const prefix = `pl${i}`;
    return `<g transform="${transform}">${pieceMarkup(p.piece, prefix)}</g>`;
  });
  const markPath = sheet.placements
    .map(({ x, y, rotated, piece }) =>
      rotated
        ? cutMarks(x, y, piece.heightMm, piece.widthMm)
        : cutMarks(x, y, piece.widthMm, piece.heightMm),
    )
    .join('');
  const marks = options.cutMarks
    ? `<path d="${markPath}" fill="none" stroke="#000000" stroke-width="0.2"/>`
    : '';
  const W = sheet.widthMm;
  const H = sheet.heightMm;
  const body = parts.join('') + marks;
  const content = options.mirror
    ? `<g transform="translate(${W} 0) scale(-1 1)">${body}</g>`
    : body;
  const background = options.background
    ? `<rect width="${W}" height="${H}" fill="${options.background}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">${background}${content}</svg>`;
}

/** Règle de contrôle de 10 cm (graduée tous les 1 cm) : vérifier l'échelle à l'impression. */
export function rulerSvg(x: number, y: number, label = '10 cm — vérifier à l’impression') {
  const ticks = Array.from(
    { length: 11 },
    (_, i) => `M${x + i * 10} ${y}v${i % 5 === 0 ? 4 : 2.5}`,
  ).join('');
  return `<g fill="none" stroke="#000000" stroke-width="0.25"><path d="M${x} ${y}h100${ticks}"/></g><text x="${x + 102}" y="${y + 3}" font-size="3" font-family="sans-serif" fill="#000000">${label}</text>`;
}
