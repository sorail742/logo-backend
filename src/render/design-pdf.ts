import { renderDesignPage, pageNeedsRaster } from './design';
import type { DesignDoc } from './design-doc';
import { createPdf, drawSvg, MM } from './pdf';
import { svgToPng } from './raster';

// PDF d'une création du Studio. Format imprimé : taille réelle en mm, fond perdu (BleedBox),
// zone de coupe (TrimBox) et traits de coupe facultatifs. Format écran : 1 px = 0,75 pt.
// Les pages sont vectorielles ; une page portant des effets que le PDF ne reproduit pas
// (ombres, modes de fusion, filtres d'image) est tramée à 300 dpi pour rester fidèle.

export interface DesignPdfOptions {
  title: string;
  /** Pages à exporter (indices) ; toutes par défaut. */
  pages?: number[];
  /** Traits de coupe dans une marge de 8 mm autour du fond perdu (formats imprimés). */
  cropMarks?: boolean;
}

const PRINT_DPI = 300;
const MARK_SLUG = 8 * MM;
const MARK_LENGTH = 5 * MM;
const MARK_GAP = 1.5 * MM;

function setBoxes(doc: PDFKit.PDFDocument, boxes: Record<string, number[]>) {
  const data = (doc.page as unknown as { dictionary: { data: Record<string, unknown> } }).dictionary
    .data;
  Object.assign(data, boxes);
}

function drawCropMarks(
  doc: PDFKit.PDFDocument,
  trim: { x: number; y: number; width: number; height: number },
  bleed: number,
) {
  doc.save().lineWidth(0.25).strokeColor('#000000');
  const offset = bleed + MARK_GAP;
  const xs = [trim.x, trim.x + trim.width];
  const ys = [trim.y, trim.y + trim.height];
  for (const x of xs) {
    for (const y of ys) {
      const sx = x === trim.x ? -1 : 1;
      const sy = y === trim.y ? -1 : 1;
      // Trait horizontal et trait vertical, hors du fond perdu, dans le prolongement des bords.
      doc
        .moveTo(x + sx * offset, y)
        .lineTo(x + sx * (offset + MARK_LENGTH), y)
        .stroke();
      doc
        .moveTo(x, y + sy * offset)
        .lineTo(x, y + sy * (offset + MARK_LENGTH))
        .stroke();
    }
  }
  doc.restore();
}

export function designToPdf(design: DesignDoc, options: DesignPdfOptions): Promise<Buffer> {
  const print = design.print ?? null;
  const trimW = print ? print.widthMm * MM : design.width * 0.75;
  const trimH = print ? print.heightMm * MM : design.height * 0.75;
  const scale = trimW / design.width;
  const bleed = print ? print.bleedMm * MM : 0;
  const slug = print && options.cropMarks ? MARK_SLUG : 0;
  const pageW = trimW + 2 * (bleed + slug);
  const pageH = trimH + 2 * (bleed + slug);
  const indices = (options.pages?.length ? options.pages : design.pages.map((_, i) => i)).filter(
    (i) => i >= 0 && i < design.pages.length,
  );

  const pdf = createPdf({ size: [pageW, pageH], title: options.title });
  indices.forEach((pageIndex, i) => {
    if (i > 0) pdf.doc.addPage({ size: [pageW, pageH], margin: 0 });
    const svg = renderDesignPage(design, pageIndex, { bleed: bleed / scale });
    const x = slug;
    const y = slug;
    const width = trimW + 2 * bleed;
    const height = trimH + 2 * bleed;
    if (pageNeedsRaster(design.pages[pageIndex])) {
      const px = Math.min(12_000, Math.round((width / 72) * PRINT_DPI));
      pdf.doc.image(svgToPng(svg, { size: px }), x, y, { width, height });
    } else {
      drawSvg(pdf.doc, svg, x, y, width, height, 'none');
    }
    if (print) {
      // Coordonnées PDF : origine en bas à gauche.
      setBoxes(pdf.doc, {
        BleedBox: [slug, slug, pageW - slug, pageH - slug],
        TrimBox: [slug + bleed, slug + bleed, pageW - slug - bleed, pageH - slug - bleed],
      });
      if (slug) {
        drawCropMarks(
          pdf.doc,
          { x: slug + bleed, y: slug + bleed, width: trimW, height: trimH },
          bleed,
        );
      }
    }
  });
  return pdf.done();
}
