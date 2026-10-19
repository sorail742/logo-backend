import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { svgSize } from './svg';

/**
 * PDF vectoriel d'un logo (LOGO-21) : une page à la taille du SVG (1 px = 1 pt). Le texte est
 * déjà converti en tracés, le fichier s'ouvre donc sans la police.
 */
export function svgToPdf(svg: string, meta: { title: string }): Promise<Buffer> {
  const { width, height } = svgSize(svg);
  const doc = new PDFDocument({
    size: [width, height],
    margin: 0,
    autoFirstPage: true,
    info: { Title: meta.title, Producer: 'Moteur de rendu SVG' },
    pdfVersion: '1.7',
  });
  // Date figée : deux exports identiques produisent le même fichier.
  doc.info.CreationDate = new Date(0);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    SVGtoPDF(doc, svg, 0, 0, {
      width,
      height,
      assumePt: true,
      preserveAspectRatio: 'xMidYMid meet',
    });
    doc.end();
  });
}
