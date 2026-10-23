import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { FALLBACK_FONT, FONTS_DIR, fileHasGlyph, getFont, scriptFallbackFile } from './fonts';
import { svgSize } from './svg';

/** Points par millimètre (1 pt = 1/72 de pouce). */
export const MM = 72 / 25.4;

/**
 * PDF vectoriel d'un logo (LOGO-21) : une page à la taille du SVG (1 px = 1 pt). Le texte est
 * déjà converti en tracés, le fichier s'ouvre donc sans la police.
 */
export function svgToPdf(svg: string, meta: { title: string }): Promise<Buffer> {
  const { width, height } = svgSize(svg);
  const pdf = createPdf({ size: [width, height], title: meta.title });
  drawSvg(pdf.doc, svg, 0, 0, width, height);
  return pdf.done();
}

export interface PdfHandle {
  doc: PDFKit.PDFDocument;
  /** Termine le document et renvoie son contenu. */
  done(): Promise<Buffer>;
}

/** Document vierge, sans marges imposées : les gabarits placent tout en coordonnées absolues. */
export function createPdf(options: {
  size: [number, number] | string;
  title: string;
  author?: string;
}): PdfHandle {
  const doc = new PDFDocument({
    size: options.size,
    margin: 0,
    autoFirstPage: true,
    info: {
      Title: options.title,
      ...(options.author && { Author: options.author }),
      Producer: 'Moteur de rendu SVG',
    },
    pdfVersion: '1.7',
  });
  // Date figée : deux exports identiques produisent le même fichier.
  doc.info.CreationDate = new Date(0);
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return {
    doc,
    done: () => {
      doc.end();
      return result;
    },
  };
}

/**
 * Dessine un SVG dans un cadre, proportions conservées et centré par défaut ;
 * `fit: 'none'` le déforme pour remplir le cadre.
 */
export function drawSvg(
  doc: PDFKit.PDFDocument,
  svg: string,
  x: number,
  y: number,
  width: number,
  height: number,
  /** meet : centré, proportions gardées ; meet-left : calé à gauche ; stretch : étiré au cadre. */
  placement: 'meet' | 'meet-left' | 'stretch' = 'meet',
) {
  const ratio = { meet: 'xMidYMid meet', 'meet-left': 'xMinYMid meet', stretch: 'none' }[placement];
  SVGtoPDF(doc, svg, x, y, { width, height, assumePt: true, preserveAspectRatio: ratio });
}

/** Taille d'un SVG dessiné dans un cadre, proportions conservées. */
export function fitSize(svg: string, width: number, height: number) {
  const size = svgSize(svg);
  const scale = Math.min(width / size.width, height / size.height);
  return { width: size.width * scale, height: size.height * scale, scale };
}

// ─── Texte ───
// Les polices de la bibliothèque sont découpées en sous-ensembles latin et latin étendu : un
// texte est écrit par segments, chacun avec le fichier qui contient ses caractères. Le N'Ko est
// écrit avec sa police de secours ; PDFKit (fontkit) le façonne et l'écrit de droite à gauche.

export type PdfFont = 'regular' | 'medium' | 'bold';
const WEIGHTS: Record<PdfFont, number> = { regular: 400, medium: 600, bold: 700 };

/** Fichier de police d'un segment : latin, latin étendu ou police de secours N'Ko. */
export type TextFace = 'latin' | 'ext' | 'nko';

/** Enregistre la police de l'interface (Montserrat, OFL) dans ses sous-ensembles, et le N'Ko. */
export function registerTextFonts(doc: PDFKit.PDFDocument) {
  const nko = scriptFallbackFile('ߒ');
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const [latin, extended] = getFont(FALLBACK_FONT).files[String(weight)];
    doc.registerFont(name, join(FONTS_DIR, latin));
    doc.registerFont(`${name}-ext`, join(FONTS_DIR, extended ?? latin));
    if (nko) doc.registerFont(`${name}-nko`, join(FONTS_DIR, nko));
  }
}

function faceOf(char: string, latin: string, extended: string | undefined): TextFace {
  if (fileHasGlyph(latin, char)) return 'latin';
  if (extended && fileHasGlyph(extended, char)) return 'ext';
  return scriptFallbackFile(char) ? 'nko' : 'ext';
}

/**
 * Morceaux d'un segment N'Ko dans l'ordre d'affichage : PDFKit pose les mots de gauche à droite
 * et retourne les glyphes de chacun, espace final compris ; chaque mot est donc écrit seul, les
 * espaces avec la police latine. Un segment N'Ko qui passe à la ligne garde l'ordre logique de
 * ses lignes (limite acceptée : textes courts).
 */
export function nkoPieces(text: string): { text: string; face: TextFace }[] {
  const body = text.trim();
  if (!body) return [{ text, face: 'latin' }];
  const lead = text.slice(0, text.length - text.trimStart().length);
  const trail = text.slice(text.trimEnd().length);
  const words = body.split(/(\s+)/).reverse();
  return [lead, ...words, trail]
    .filter(Boolean)
    .map((piece) => ({ text: piece, face: /^\s+$/.test(piece) ? 'latin' : 'nko' }));
}

/** Segments d'un texte, chacun avec le fichier qui contient ses caractères. */
export function textRuns(text: string, font: PdfFont = 'regular') {
  const [latin, extended] = getFont(FALLBACK_FONT).files[String(WEIGHTS[font])];
  const runs: { text: string; face: TextFace }[] = [];
  for (const char of Array.from(text)) {
    // Espaces et retours à la ligne restent dans le segment en cours.
    const last = runs.at(-1);
    const face = /\s/.test(char) ? (last?.face ?? 'latin') : faceOf(char, latin, extended);
    if (last?.face === face) last.text += char;
    else runs.push({ text: char, face });
  }
  return runs;
}

export interface TextStyle {
  font?: PdfFont;
  size: number;
  color?: string;
  width?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  lineGap?: number;
  characterSpacing?: number;
  /** Une seule ligne, sans retour automatique. */
  lineBreak?: boolean;
}

/** Écrit un texte à la position donnée (ou à la suite du précédent). */
export function writeText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
) {
  const font = style.font ?? 'regular';
  const runs = textRuns(text, font);
  doc.fillColor(style.color ?? '#111827').fontSize(style.size);
  const options: PDFKit.Mixins.TextOptions = {
    width: style.width,
    align: style.align,
    lineGap: style.lineGap ?? 2,
    characterSpacing: style.characterSpacing,
    lineBreak: style.lineBreak,
  };
  const pieces = runs.flatMap((run) => (run.face === 'nko' ? nkoPieces(run.text) : [run]));
  pieces.forEach((piece, index) => {
    doc.font(piece.face === 'latin' ? font : `${font}-${piece.face}`);
    const continued = index < pieces.length - 1;
    if (index === 0) doc.text(piece.text, x, y, { ...options, continued });
    else doc.text(piece.text, { ...options, continued });
  });
  if (!runs.length) doc.text('', x, y, options);
}

/** Hauteur qu'occupera un texte (sous-ensemble latin : approximation suffisante). */
export function textHeight(doc: PDFKit.PDFDocument, text: string, style: TextStyle) {
  doc.font(style.font ?? 'regular').fontSize(style.size);
  return doc.heightOfString(text, {
    width: style.width,
    lineGap: style.lineGap ?? 2,
    characterSpacing: style.characterSpacing,
  });
}
