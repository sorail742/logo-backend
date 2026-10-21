declare module 'svg-to-pdfkit' {
  function SVGtoPDF(
    doc: PDFKit.PDFDocument,
    svg: string,
    x?: number,
    y?: number,
    options?: { width?: number; height?: number; assumePt?: boolean; preserveAspectRatio?: string },
  ): void;
  export = SVGtoPDF;
}
