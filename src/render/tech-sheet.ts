import { escapeXml } from './svg';
import {
  createPdf,
  drawSvg,
  MM,
  registerTextFonts,
  textHeight,
  writeText,
  type PdfHandle,
} from './pdf';
import { qrSvg } from './qr';

// Fiche technique du pack atelier (cahier des charges §16.8) et gabarit de positionnement à
// l'échelle 1:1 : tout ce qu'il faut à l'atelier pour imprimer et poser les transferts sans
// retouche. Chaque page porte une règle de 10 cm pour vérifier l'échelle à l'impression.

const n = (value: number) => Math.round(value * 100) / 100;

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_W = PAGE.width - MARGIN * 2;
const FOOTER = 46;
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

export interface PlacementPiece {
  /** Coin et dimensions dans le repère du vêtement (mm) : X depuis l'axe, Y sous le col. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Dessin de la pièce (SVG, repère de la pièce en mm), estompé sur le gabarit 1:1. */
  artwork?: string;
}

export interface PlacementZone extends PlacementPiece {
  label: string;
  pieces: PlacementPiece[];
}

export interface TechSheetData {
  title: string;
  template: string;
  technique: string;
  support: string;
  mirror: boolean;
  garmentColor: string;
  size: string;
  generatedAt: string;
  proof: { url: string; approvedAt?: string | null } | null;
  pieces: {
    key: string;
    zone: string;
    sizes: string;
    widthMm: number;
    heightMm: number;
    placement: string;
    quantity: number;
  }[];
  views: { label: string; zones: PlacementZone[] }[];
  colors: { hex: string; usage: string }[];
  fonts: { name: string; license: string }[];
  players: {
    number?: string | null;
    name: string;
    size: string;
    quantity: number;
    role?: string | null;
  }[];
  sizes: { label: string; count: number }[];
  instructions: string[];
  warnings: string[];
}

/** État du BAT, en clair. */
function proofStatus(proof: TechSheetData['proof']) {
  if (proof?.approvedAt) return `BAT approuvé le ${proof.approvedAt}`;
  return proof ? 'BAT envoyé, en attente d’approbation' : 'BAT non envoyé';
}

/** Règle de 10 cm graduée, posée en bas de page. */
function ruler(doc: PDFKit.PDFDocument, x: number, y: number) {
  doc.save().lineWidth(0.6).strokeColor('#000000');
  doc
    .moveTo(x, y)
    .lineTo(x + 100 * MM, y)
    .stroke();
  for (let i = 0; i <= 10; i++) {
    const len = i % 5 === 0 ? 4 * MM : 2.5 * MM;
    doc
      .moveTo(x + i * 10 * MM, y)
      .lineTo(x + i * 10 * MM, y + len)
      .stroke();
  }
  doc.restore();
  writeText(
    doc,
    '10 cm : mesurez cette règle après impression (échelle 100 %)',
    x + 104 * MM,
    y - 1,
    {
      size: 7,
      color: MUTED,
      lineBreak: false,
    },
  );
}

class Cursor {
  y = MARGIN;
  constructor(private readonly pdf: PdfHandle) {}

  get doc() {
    return this.pdf.doc;
  }

  /** Passe à la page suivante si `height` ne tient pas. */
  ensure(height: number) {
    if (this.y + height <= PAGE.height - FOOTER) return;
    ruler(this.doc, MARGIN, PAGE.height - 28);
    this.doc.addPage({ size: 'A4', margin: 0 });
    this.y = MARGIN;
  }

  /** Titre de section ; `keep` : hauteur du contenu qui doit le suivre sur la même page. */
  heading(text: string, keep = 40) {
    this.ensure(keep);
    this.y += 10;
    writeText(this.doc, text, MARGIN, this.y, { font: 'bold', size: 12, color: INK });
    this.y += 18;
    this.doc
      .save()
      .lineWidth(0.5)
      .strokeColor(LINE)
      .moveTo(MARGIN, this.y)
      .lineTo(PAGE.width - MARGIN, this.y)
      .stroke()
      .restore();
    this.y += 6;
  }

  paragraph(text: string, size = 9, color = INK) {
    const height = textHeight(this.doc, text, { size, width: CONTENT_W });
    this.ensure(height + 4);
    writeText(this.doc, text, MARGIN, this.y, { size, color, width: CONTENT_W });
    this.y += height + 4;
  }

  /** Tableau simple : colonnes en proportion de la largeur utile. */
  table(columns: { label: string; width: number; align?: 'left' | 'right' }[], rows: string[][]) {
    const xs = columns.reduce<number[]>(
      (acc, _c, i) => [...acc, i ? acc[i - 1] + columns[i - 1].width * CONTENT_W : MARGIN],
      [],
    );
    const row = (cells: string[], font: 'regular' | 'bold') => {
      const height =
        Math.max(
          ...cells.map((cell, i) =>
            textHeight(this.doc, cell, { size: 8, width: columns[i].width * CONTENT_W - 6 }),
          ),
        ) + 6;
      this.ensure(height);
      cells.forEach((cell, i) =>
        writeText(this.doc, cell, xs[i] + 3, this.y + 3, {
          font,
          size: 8,
          color: font === 'bold' ? MUTED : INK,
          width: columns[i].width * CONTENT_W - 6,
          align: columns[i].align,
        }),
      );
      this.y += height;
      this.doc
        .save()
        .lineWidth(0.4)
        .strokeColor(LINE)
        .moveTo(MARGIN, this.y)
        .lineTo(PAGE.width - MARGIN, this.y)
        .stroke()
        .restore();
    };
    row(
      columns.map((c) => c.label),
      'bold',
    );
    for (const cells of rows) row(cells, 'regular');
    this.y += 4;
  }
}

/** Plan de placement d'une vue : axe, bas du col, zones (pointillés) et pièces, cotes en mm. */
function placementSvg(view: { label: string; zones: PlacementZone[] }) {
  const xs = view.zones.flatMap((z) => [z.x, z.x + z.width]);
  const ys = view.zones.flatMap((z) => [z.y, z.y + z.height]);
  const pad = 40;
  const minX = Math.min(-60, ...xs) - pad;
  const maxX = Math.max(60, ...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  const minY = -30;
  const w = maxX - minX;
  const h = maxY - minY;
  const label = (x: number, y: number, text: string, anchor = 'middle', size = 9) =>
    `<text x="${n(x)}" y="${n(y)}" font-size="${size}" font-family="Helvetica" text-anchor="${anchor}" fill="#374151">${escapeXml(text)}</text>`;
  const parts: string[] = [
    `<line x1="0" y1="${n(minY)}" x2="0" y2="${n(maxY)}" stroke="#9ca3af" stroke-width="0.6" stroke-dasharray="6 4"/>`,
    `<path d="M-45 0Q0 28 45 0" fill="none" stroke="#111827" stroke-width="1.2"/>`,
    label(52, 4, 'bas du col', 'start', 8),
  ];
  for (const zone of view.zones) {
    parts.push(
      `<rect x="${n(zone.x)}" y="${n(zone.y)}" width="${n(zone.width)}" height="${n(zone.height)}" fill="none" stroke="#9ca3af" stroke-width="0.8" stroke-dasharray="4 3"/>`,
    );
    for (const p of zone.pieces) {
      parts.push(
        `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.width)}" height="${n(p.height)}" fill="#dbeafe" stroke="#1d4ed8" stroke-width="0.8"/>`,
        label(
          p.x + p.width / 2,
          p.y + p.height / 2 + 3,
          `${Math.round(p.width)} × ${Math.round(p.height)}`,
        ),
        // Cote verticale : distance entre le bas du col et le haut de la pièce.
        `<line x1="${n(p.x - 6)}" y1="0" x2="${n(p.x - 6)}" y2="${n(p.y)}" stroke="#dc2626" stroke-width="0.6"/>`,
        label(p.x - 9, p.y / 2 + 3, `${Math.round(p.y)}`, 'end', 8),
      );
    }
    parts.push(label(zone.x + zone.width / 2, zone.y - 4, zone.label, 'middle', 8));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(minX)} ${n(minY)} ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}">${parts.join('')}</svg>`;
}

/** Fiche technique PDF (A4). */
export async function techSheetPdf(data: TechSheetData): Promise<Buffer> {
  const pdf = createPdf({ size: 'A4', title: `Fiche technique — ${data.title}` });
  registerTextFonts(pdf.doc);
  const c = new Cursor(pdf);
  const doc = pdf.doc;

  writeText(doc, 'Fiche technique — pack atelier', MARGIN, c.y, { size: 9, color: MUTED });
  c.y += 14;
  writeText(doc, data.title, MARGIN, c.y, {
    font: 'bold',
    size: 18,
    color: INK,
    width: CONTENT_W - 110,
  });
  c.y += 26;
  const facts = [
    `Support : ${data.template} — tissu ${data.garmentColor.toUpperCase()}`,
    `Technique : ${data.technique} · ${data.support}`,
    `Miroir : ${data.mirror ? 'oui (à presser face contre le tissu)' : 'non (lecture normale)'}`,
    `Taille de référence : ${data.size} · généré le ${data.generatedAt}`,
    proofStatus(data.proof),
  ];
  const top = c.y;
  for (const fact of facts) c.paragraph(fact, 9.5);
  doc
    .save()
    .rect(PAGE.width - MARGIN - 34, top - 30, 30, 30)
    .fillColor(data.garmentColor)
    .fill()
    .restore();
  doc
    .save()
    .rect(PAGE.width - MARGIN - 34, top - 30, 30, 30)
    .lineWidth(0.5)
    .strokeColor(LINE)
    .stroke()
    .restore();
  if (data.proof) {
    drawSvg(doc, qrSvg(data.proof.url, { margin: 1 }), PAGE.width - MARGIN - 70, top + 6, 66, 66);
    writeText(doc, 'BAT en ligne', PAGE.width - MARGIN - 70, top + 74, {
      size: 7,
      color: MUTED,
      width: 66,
      align: 'center',
    });
  }
  c.y = Math.max(c.y, top + 86);

  c.heading('Pièces à imprimer');
  c.table(
    [
      { label: 'Fichier', width: 0.27 },
      { label: 'Zone', width: 0.15 },
      { label: 'Tailles', width: 0.1 },
      { label: 'Dimensions (mm)', width: 0.13, align: 'right' },
      { label: 'Position', width: 0.29 },
      { label: 'Qté', width: 0.06, align: 'right' },
    ],
    data.pieces.map((p) => [
      p.key,
      p.zone,
      p.sizes,
      `${Math.round(p.widthMm)} × ${Math.round(p.heightMm)}`,
      p.placement,
      String(p.quantity),
    ]),
  );

  if (data.views.length) {
    c.heading(`Plan de placement (taille ${data.size}, cotes en mm depuis le bas du col)`, 300);
    for (const view of data.views) {
      const svg = placementSvg(view);
      const box = { width: CONTENT_W, height: 250 };
      c.ensure(box.height + 20);
      writeText(doc, view.label, MARGIN, c.y, { font: 'bold', size: 9, color: INK });
      c.y += 14;
      drawSvg(doc, svg, MARGIN, c.y, box.width, box.height);
      c.y += box.height + 8;
    }
  }

  c.heading('Couleurs');
  c.table(
    [
      { label: 'HEX', width: 0.2 },
      { label: 'Usage', width: 0.8 },
    ],
    data.colors.map((color) => [color.hex.toUpperCase(), color.usage]),
  );
  c.paragraph(
    'Les couleurs à l’écran diffèrent du textile imprimé : demandez la référence Pantone ou de film la plus proche à votre fournisseur et faites un essai sur une pièce.',
    8,
    MUTED,
  );

  if (data.fonts.length) {
    c.heading('Polices');
    c.table(
      [
        { label: 'Police', width: 0.5 },
        { label: 'Licence', width: 0.5 },
      ],
      data.fonts.map((f) => [f.name, f.license]),
    );
    c.paragraph(
      'Le texte est déjà converti en tracés dans les fichiers : aucune police à installer.',
      8,
      MUTED,
    );
  }

  if (data.players.length) {
    c.heading(`Effectif (${data.players.length} joueurs)`);
    c.table(
      [
        { label: 'N°', width: 0.08, align: 'right' },
        { label: 'Nom imprimé', width: 0.42 },
        { label: 'Taille', width: 0.14 },
        { label: 'Qté', width: 0.1, align: 'right' },
        { label: 'Poste', width: 0.26 },
      ],
      data.players.map((p) => [p.number ?? '—', p.name, p.size, String(p.quantity), p.role ?? '']),
    );
  }

  c.heading('Récapitulatif par taille (commande des vêtements)');
  c.table(
    [
      { label: 'Taille', width: 0.5 },
      { label: 'Vêtements', width: 0.5, align: 'right' },
    ],
    [
      ...data.sizes.map((s) => [s.label, String(s.count)]),
      ['Total', String(data.sizes.reduce((sum, s) => sum + s.count, 0))],
    ],
  );

  c.heading('Consignes');
  for (const line of data.instructions) c.paragraph(`• ${line}`);
  if (data.warnings.length) {
    c.heading('Points à vérifier');
    for (const line of data.warnings) c.paragraph(`• ${line}`, 9, '#b45309');
  }

  ruler(doc, MARGIN, PAGE.height - 28);
  return pdf.done();
}

/**
 * Gabarit de positionnement à l'échelle 1:1 d'une zone : contour de la zone, pièces, axe du
 * vêtement et distance au col ; découpé en feuilles A4 numérotées s'il est plus grand.
 */
export async function placementTemplatePdf(input: {
  title: string;
  zone: PlacementZone;
  size: string;
}): Promise<Buffer> {
  const { zone } = input;
  const margin = 12; // mm de blanc autour du dessin
  const totalW = zone.width + margin * 2;
  const totalH = zone.height + margin * 2;
  const printable = { width: 186, height: 260 }; // A4 moins les marges d'une imprimante de bureau
  const cols = Math.ceil(totalW / printable.width);
  const rows = Math.ceil(totalH / printable.height);
  const ox = zone.x - margin;
  const oy = zone.y - margin;
  const axisX = -ox;
  const pieces = zone.pieces
    .map((p) => {
      const x = n(p.x - ox);
      const y = n(p.y - oy);
      const frame = `<rect x="${x}" y="${y}" width="${n(p.width)}" height="${n(p.height)}" fill="none" stroke="#1d4ed8" stroke-width="0.5"/>`;
      if (!p.artwork) return frame;
      return `<g transform="translate(${x} ${y})" opacity="0.3">${p.artwork}</g>${frame}`;
    })
    .join('');
  const drawing = `<rect x="${margin}" y="${margin}" width="${n(zone.width)}" height="${n(zone.height)}" fill="none" stroke="#6b7280" stroke-width="0.4" stroke-dasharray="3 2"/>${pieces}<line x1="${n(axisX)}" y1="0" x2="${n(axisX)}" y2="${n(totalH)}" stroke="#dc2626" stroke-width="0.3" stroke-dasharray="4 2"/>`;

  const pdf = createPdf({ size: 'A4', title: `Gabarit 1:1 — ${input.title}` });
  registerTextFonts(pdf.doc);
  const doc = pdf.doc;
  const left = (210 - printable.width) / 2;
  const top = 18;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      if (r || col) doc.addPage({ size: 'A4', margin: 0 });
      const vx = col * printable.width;
      const vy = r * printable.height;
      const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vx)} ${n(vy)} ${printable.width} ${printable.height}" width="${printable.width}" height="${printable.height}">${drawing}</svg>`;
      drawSvg(
        doc,
        tile,
        left * MM,
        top * MM,
        printable.width * MM,
        printable.height * MM,
        'stretch',
      );
      // Cadre et repères d'assemblage des feuilles.
      doc
        .save()
        .lineWidth(0.3)
        .strokeColor('#9ca3af')
        .rect(left * MM, top * MM, printable.width * MM, printable.height * MM)
        .stroke()
        .restore();
      const name = `${String.fromCharCode(65 + r)}${col + 1}`;
      writeText(
        doc,
        `${input.title} — ${zone.label}, taille ${input.size} — feuille ${name} (${rows * cols} au total). Imprimer à 100 %, assembler bord à bord. Pointillés rouges : axe du vêtement ; haut de la zone à ${Math.round(zone.y)} mm sous le col.`,
        left * MM,
        6 * MM,
        { size: 7, color: MUTED, width: printable.width * MM },
      );
      ruler(doc, left * MM, (top + printable.height + 8) * MM);
    }
  }
  return pdf.done();
}
