import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { FALLBACK_FONT, FONTS_DIR, fileHasGlyph, getFont } from './fonts';
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
// texte est écrit par segments, chacun avec le fichier qui contient ses caractères.

export type PdfFont = 'regular' | 'medium' | 'bold';
const WEIGHTS: Record<PdfFont, number> = { regular: 400, medium: 600, bold: 700 };

/** Enregistre la police de l'interface (Montserrat, OFL) dans ses deux sous-ensembles. */
export function registerTextFonts(doc: PDFKit.PDFDocument) {
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const [latin, extended] = getFont(FALLBACK_FONT).files[String(weight)];
    doc.registerFont(name, join(FONTS_DIR, latin));
    doc.registerFont(`${name}-ext`, join(FONTS_DIR, extended ?? latin));
  }
}

/** Segments d'un texte : `ext` si le caractère manque au sous-ensemble latin. */
export function textRuns(text: string, font: PdfFont = 'regular') {
  const latin = getFont(FALLBACK_FONT).files[String(WEIGHTS[font])][0];
  const runs: { text: string; ext: boolean }[] = [];
  for (const char of Array.from(text)) {
    // Espaces et retours à la ligne restent dans le segment en cours.
    const last = runs.at(-1);
    const ext = /\s/.test(char) ? (last?.ext ?? false) : !fileHasGlyph(latin, char);
    if (last?.ext === ext) last.text += char;
    else runs.push({ text: char, ext });
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
  runs.forEach((run, index) => {
    doc.font(run.ext ? `${font}-ext` : font);
    const continued = index < runs.length - 1;
    if (index === 0) doc.text(run.text, x, y, { ...options, continued });
    else doc.text(run.text, { ...options, continued });
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
