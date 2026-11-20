import { createPdf, drawSvg, MM, registerTextFonts } from './pdf';
import { qrSvg } from './qr';

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPriceGnf: bigint | number;
  totalGnf: bigint | number;
}

export interface InvoiceData {
  number: string;
  issuedAt: Date;
  paidAt: Date;
  customer: {
    name: string;
    email?: string;
    phone?: string;
    workspaceName: string;
  };
  seller?: {
    name: string;
    address: string;
    taxId: string;
    email?: string;
    phone?: string;
  };
  items: InvoiceItem[];
  subtotalGnf: bigint | number;
  taxGnf: bigint | number;
  totalGnf: bigint | number;
  paymentMethod: string;
  paymentReference?: string;
  verificationUrl?: string;
}

const DEFAULT_SELLER = {
  name: 'BrandID Guinée SARL',
  address: 'Immeuble Al-Iman, 4e étage, Boulevard du Commerce, Kaloum, Conakry, Guinée',
  taxId: 'NIF : 108492049 · RCCM : GN.TCC.2026.B.0491',
  email: 'facturation@brandid.gn',
  phone: '+224 620 00 00 00',
};

function formatGnf(amount: bigint | number): string {
  const n = typeof amount === 'bigint' ? Number(amount) : amount;
  return new Intl.NumberFormat('fr-GN', {
    style: 'currency',
    currency: 'GNF',
    maximumFractionDigits: 0,
  })
    .format(n)
    .replace('GNF', 'GNF');
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Africa/Conakry',
  }).format(date);
}

/**
 * Génère le PDF vectoriel de facture (PAY-04) au format A4.
 */
export async function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const pdf = createPdf({
    size: 'A4',
    title: `Facture ${data.number}`,
    author: data.seller?.name ?? DEFAULT_SELLER.name,
  });
  const doc = pdf.doc;
  registerTextFonts(doc);

  const seller = data.seller ?? DEFAULT_SELLER;
  const left = 20 * MM;
  const right = (210 - 20) * MM;
  const width = right - left;

  let y = 20 * MM;

  // ─── En-tête : Titre & Numéro ───
  doc.rect(left, y, width, 4 * MM).fill('#1e293b');
  y += 10 * MM;

  doc.font('bold').fontSize(22).fillColor('#0f172a');
  doc.text('FACTURE', left, y);

  doc.font('bold').fontSize(12).fillColor('#3b82f6');
  doc.text(data.number, left, y + 8 * MM);

  // Étiquette "PAYÉ"
  const badgeX = right - 35 * MM;
  doc.roundedRect(badgeX, y, 35 * MM, 10 * MM, 2 * MM).fillAndStroke('#dcfce7', '#22c55e');
  doc.font('bold').fontSize(10).fillColor('#15803d');
  doc.text('PAYÉ', badgeX, y + 3 * MM, { width: 35 * MM, align: 'center' });

  y += 24 * MM;

  // ─── Dates & Références ───
  doc.font('regular').fontSize(9).fillColor('#64748b');
  doc.text(`Date d'émission : `, left, y, { continued: true });
  doc.font('medium').fillColor('#1e293b').text(formatDate(data.issuedAt));

  doc
    .font('regular')
    .fillColor('#64748b')
    .text(`Date de règlement : `, left, y + 4.5 * MM, { continued: true });
  doc.font('medium').fillColor('#1e293b').text(formatDate(data.paidAt));

  if (data.paymentReference) {
    doc
      .font('regular')
      .fillColor('#64748b')
      .text(`Réf. transaction : `, left, y + 9 * MM, { continued: true });
    doc.font('medium').fillColor('#1e293b').text(data.paymentReference);
  }

  y += 18 * MM;

  // ─── Émetteur et Client (2 colonnes) ───
  const colW = (width - 10 * MM) / 2;

  // Colonne Gauche : Émetteur
  doc.font('bold').fontSize(10).fillColor('#0f172a').text('ÉMIS PAR', left, y);
  doc
    .font('bold')
    .fontSize(10)
    .fillColor('#1e293b')
    .text(seller.name, left, y + 5 * MM);
  doc.font('regular').fontSize(8.5).fillColor('#475569');
  doc.text(seller.address, left, y + 10 * MM, { width: colW });
  doc.text(seller.taxId, left, y + 18 * MM, { width: colW });
  if (seller.email) doc.text(seller.email, left, y + 23 * MM);

  // Colonne Droite : Client / Espace
  const colRightX = left + colW + 10 * MM;
  doc.font('bold').fontSize(10).fillColor('#0f172a').text('FACTURÉ À', colRightX, y);
  doc
    .font('bold')
    .fontSize(10)
    .fillColor('#1e293b')
    .text(data.customer.workspaceName, colRightX, y + 5 * MM);
  doc.font('regular').fontSize(8.5).fillColor('#475569');
  doc.text(`Client : ${data.customer.name}`, colRightX, y + 10 * MM);
  if (data.customer.email) doc.text(`Email : ${data.customer.email}`, colRightX, y + 15 * MM);
  if (data.customer.phone) doc.text(`Tél : ${data.customer.phone}`, colRightX, y + 20 * MM);

  y += 35 * MM;

  // ─── Tableau des prestations ───
  // Entête du tableau
  doc.rect(left, y, width, 8 * MM).fill('#f1f5f9');
  doc.font('bold').fontSize(9).fillColor('#334155');
  doc.text('Désignation', left + 3 * MM, y + 2.5 * MM);
  doc.text('Qté', left + 100 * MM, y + 2.5 * MM, { width: 15 * MM, align: 'center' });
  doc.text('Prix unitaire', left + 118 * MM, y + 2.5 * MM, { width: 25 * MM, align: 'right' });
  doc.text('Montant', left + 145 * MM, y + 2.5 * MM, { width: 25 * MM, align: 'right' });

  y += 8 * MM;

  // Lignes
  doc.font('regular').fontSize(9);
  for (const item of data.items) {
    doc
      .rect(left, y, width, 9 * MM)
      .strokeColor('#e2e8f0')
      .lineWidth(0.5)
      .stroke();
    doc.fillColor('#1e293b').text(item.description, left + 3 * MM, y + 3 * MM, { width: 95 * MM });
    doc.fillColor('#64748b').text(String(item.quantity), left + 100 * MM, y + 3 * MM, {
      width: 15 * MM,
      align: 'center',
    });
    doc.fillColor('#1e293b').text(formatGnf(item.unitPriceGnf), left + 118 * MM, y + 3 * MM, {
      width: 25 * MM,
      align: 'right',
    });
    doc
      .font('medium')
      .fillColor('#0f172a')
      .text(formatGnf(item.totalGnf), left + 145 * MM, y + 3 * MM, {
        width: 25 * MM,
        align: 'right',
      });
    doc.font('regular');
    y += 9 * MM;
  }

  y += 6 * MM;

  // ─── Totaux ───
  const totX = left + 100 * MM;
  const totW = width - 100 * MM;

  doc.font('regular').fontSize(9).fillColor('#475569').text('Sous-total HT :', totX, y);
  doc
    .font('medium')
    .fillColor('#1e293b')
    .text(formatGnf(data.subtotalGnf), totX, y, { width: totW, align: 'right' });

  y += 5.5 * MM;
  doc.font('regular').fillColor('#475569').text('TVA / Taxes :', totX, y);
  doc
    .font('medium')
    .fillColor('#1e293b')
    .text(formatGnf(data.taxGnf), totX, y, { width: totW, align: 'right' });

  y += 7 * MM;
  doc.rect(totX - 2 * MM, y - 2 * MM, totW + 4 * MM, 9 * MM).fill('#f8fafc');
  doc.font('bold').fontSize(11).fillColor('#0f172a').text('Total TTC :', totX, y);
  doc
    .font('bold')
    .fontSize(11)
    .fillColor('#2563eb')
    .text(formatGnf(data.totalGnf), totX, y, { width: totW, align: 'right' });

  y += 20 * MM;

  // ─── Règlement & QR Code de vérification ───
  const payBlockW = 110 * MM;
  doc
    .rect(left, y, payBlockW, 28 * MM)
    .strokeColor('#e2e8f0')
    .lineWidth(0.5)
    .stroke();
  doc
    .font('bold')
    .fontSize(9)
    .fillColor('#0f172a')
    .text('Mode de règlement', left + 4 * MM, y + 4 * MM);
  doc.font('regular').fontSize(8.5).fillColor('#475569');
  doc.text(`Moyen : ${data.paymentMethod}`, left + 4 * MM, y + 10 * MM);
  if (data.paymentReference) {
    doc.text(`Identifiant : ${data.paymentReference}`, left + 4 * MM, y + 15 * MM);
  }
  doc.text('Statut : Transaction confirmée et acquittée.', left + 4 * MM, y + 20 * MM);

  if (data.verificationUrl) {
    const qrSize = 28 * MM;
    const qrX = right - qrSize;
    const qr = qrSvg(data.verificationUrl, { level: 'M' });
    drawSvg(doc, qr, qrX, y, qrSize, qrSize);
    doc
      .font('regular')
      .fontSize(7)
      .fillColor('#94a3b8')
      .text('Vérification facture', qrX, y + qrSize + 1 * MM, { width: qrSize, align: 'center' });
  }

  // ─── Pied de page ───
  const footerY = 280 * MM;
  doc.rect(left, footerY - 4 * MM, width, 0.5).fill('#cbd5e1');
  doc.font('regular').fontSize(7.5).fillColor('#94a3b8');
  doc.text(
    `${seller.name} · ${seller.taxId} · Facture acquittée générée automatiquement par la plateforme.`,
    left,
    footerY,
    { width, align: 'center' },
  );

  return pdf.done();
}
