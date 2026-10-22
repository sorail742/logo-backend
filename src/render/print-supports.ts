import { logoSvg, type KitContent } from './brand-kit';
import { mix, readableOn, type LogoColors } from './color';
import { letterheadDocx } from './docx';
import type { LogoSource } from './logo-assets';
import { createPdf, drawSvg, fitSize, MM, registerTextFonts, writeText } from './pdf';
import { qrSvg, vcard } from './qr';
import { svgToPng } from './raster';

// Supports prêts à imprimer (KIT-04) : carte de visite et carte de membre avec fond perdu de
// 3 mm (TrimBox renseignée pour l'imprimeur), papier à en-tête A4 en PDF et en Word.

export interface ContactDetails {
  fullName?: string;
  jobTitle?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
}

export interface SupportsInput {
  content: KitContent;
  logo: LogoSource;
  colors: LogoColors;
  /** Coordonnées reprises de la signature e-mail du projet, s'il y en a une. */
  contact: ContactDetails | null;
}

const BLEED = 3 * MM;
const INK = '#111827';
const MUTED = '#6b7280';

/** Déclare la zone de coupe et le fond perdu de la page courante (coordonnées PDF). */
function setPrintBoxes(doc: PDFKit.PDFDocument, width: number, height: number) {
  const data = (doc.page as unknown as { dictionary: { data: Record<string, unknown> } }).dictionary
    .data;
  data.BleedBox = [0, 0, width, height];
  data.TrimBox = [BLEED, BLEED, width - BLEED, height - BLEED];
}

/** Logo lisible sur une couleur de fond ; null si un logo importé doit garder un fond clair. */
function logoOn(source: LogoSource, background: string) {
  if (source.kind !== 'spec') return null;
  return logoSvg(source, { variant: readableOn(background) === '#ffffff' ? 'white' : 'black' });
}

function contactLines(contact: ContactDetails | null) {
  if (!contact) return [];
  return [contact.phone, contact.email, contact.website, contact.address]
    .map((line) => line?.trim())
    .filter((line): line is string => !!line);
}

/**
 * QR code de la fiche contact (vCard) : un scan ajoute la personne au répertoire. Niveau L et
 * marge d'un module (la carte est blanche autour) : des modules d'au moins 0,35 mm à 20 mm.
 */
function contactQr(input: SupportsInput) {
  const { contact } = input;
  if (!contact || !(contact.phone || contact.email || contact.website)) return null;
  return qrSvg(
    vcard({
      fullName: contact.fullName?.trim() || input.content.name,
      organization: input.content.name,
      title: contact.jobTitle,
      phone: contact.phone,
      email: contact.email,
      website: contact.website,
    }),
    { level: 'L', margin: 1, color: INK },
  );
}

/** Format de la carte de visite : 85 × 55 mm au rognage, fond perdu compris. */
const CARD = (() => {
  const trimW = 85 * MM;
  const trimH = 55 * MM;
  return {
    trimW,
    trimH,
    width: trimW + BLEED * 2,
    height: trimH + BLEED * 2,
    safe: BLEED + 5 * MM,
  };
})();

/** Recto : logo, nom et fonction à gauche ; QR code de contact et coordonnées à droite. */
function cardFront(doc: PDFKit.PDFDocument, input: SupportsInput) {
  const { width, height, safe, trimW, trimH } = CARD;
  const { colors, contact } = input;
  setPrintBoxes(doc, width, height);
  doc.rect(0, 0, width, height).fill('#ffffff');
  doc.rect(0, height - BLEED - 2.5 * MM, width, BLEED + 2.5 * MM).fill(colors.primary);
  const lines = contactLines(contact);
  if (!contact?.fullName && !lines.length) {
    drawSvg(doc, logoSvg(input.logo), safe, safe, trimW - 10 * MM, trimH - 14 * MM);
    return;
  }
  drawSvg(doc, logoSvg(input.logo), safe, safe, 38 * MM, 16 * MM, 'meet-left');
  const identity = [
    contact?.fullName && { text: contact.fullName, font: 'bold' as const, size: 9, color: INK },
    contact?.jobTitle && { text: contact.jobTitle, size: 7, color: MUTED },
  ].filter((item) => !!item);
  identity.forEach(({ text, ...style }, index) => {
    writeText(doc, text, safe, safe + 21 * MM + index * 12, {
      ...style,
      width: 40 * MM,
      lineBreak: false,
    });
  });
  const right = width - safe;
  const qr = contactQr(input);
  if (qr) drawSvg(doc, qr, right - 20 * MM, safe, 20 * MM, 20 * MM);
  lines.slice(0, 4).forEach((line, index) => {
    writeText(doc, line, right - 36 * MM, safe + 22 * MM + index * 10, {
      size: 6.5,
      color: INK,
      width: 36 * MM,
      align: 'right',
      lineBreak: false,
    });
  });
}

/** Verso : logo sur la couleur de la marque, slogan s'il n'est pas déjà sous le logo. */
function cardBack(doc: PDFKit.PDFDocument, input: SupportsInput) {
  const { width, height, safe, trimW, trimH } = CARD;
  const { colors } = input;
  doc.addPage({ size: [width, height], margin: 0 });
  setPrintBoxes(doc, width, height);
  const onPrimary = logoOn(input.logo, colors.primary);
  doc.rect(0, 0, width, height).fill(onPrimary ? colors.primary : '#ffffff');
  if (!onPrimary)
    doc.rect(0, height - BLEED - 2.5 * MM, width, BLEED + 2.5 * MM).fill(colors.primary);
  // Pas de doublon si le logo porte déjà le slogan sous le nom.
  const tagline = input.logo.kind === 'spec' ? input.logo.spec.tagline.trim().toLowerCase() : '';
  const slogan =
    input.content.slogan && input.content.slogan.trim().toLowerCase() !== tagline
      ? input.content.slogan
      : null;
  drawSvg(
    doc,
    onPrimary ?? logoSvg(input.logo),
    safe,
    safe,
    trimW - 10 * MM,
    trimH - (slogan ? 20 : 12) * MM,
  );
  if (slogan) {
    writeText(doc, slogan, safe, height - safe - 6 * MM, {
      size: 7,
      color: onPrimary ? readableOn(colors.primary) : INK,
      width: trimW - 10 * MM,
      align: 'center',
      lineBreak: false,
    });
  }
}

/** Carte de visite 85 × 55 mm, recto (logo et coordonnées) et verso (couleur de la marque). */
export function businessCardPdf(input: SupportsInput): Promise<Buffer> {
  const pdf = createPdf({
    size: [CARD.width, CARD.height],
    title: `${input.content.name} — Carte de visite`,
  });
  registerTextFonts(pdf.doc);
  cardFront(pdf.doc, input);
  cardBack(pdf.doc, input);
  return pdf.done();
}

/** Papier à en-tête A4 : logo, coordonnées, filet et pied de page aux couleurs de la marque. */
export function letterheadPdf(input: SupportsInput): Promise<Buffer> {
  const width = 210 * MM;
  const height = 297 * MM;
  const pdf = createPdf({ size: 'A4', title: `${input.content.name} — Papier à en-tête` });
  const { doc } = pdf;
  registerTextFonts(doc);
  const margin = 20 * MM;
  doc.rect(0, 0, width, 3 * MM).fill(input.colors.primary);
  drawSvg(doc, logoSvg(input.logo), margin, 12 * MM, 70 * MM, 22 * MM, 'meet-left');
  const lines = contactLines(input.contact);
  lines.forEach((line, index) => {
    writeText(doc, line, width - margin - 70 * MM, 15 * MM + index * 11, {
      size: 8,
      color: MUTED,
      width: 70 * MM,
      align: 'right',
      lineBreak: false,
    });
  });
  const footerY = height - 18 * MM;
  doc
    .lineWidth(0.6)
    .moveTo(margin, footerY)
    .lineTo(width - margin, footerY)
    .stroke(input.colors.secondary);
  writeText(doc, footerText(input), margin, footerY + 4 * MM, {
    size: 7.5,
    color: MUTED,
    width: width - margin * 2,
    align: 'center',
    lineBreak: false,
  });
  return pdf.done();
}

function footerText(input: SupportsInput) {
  return [input.content.name, input.contact?.address, input.contact?.website]
    .filter(Boolean)
    .join(' · ');
}

/** Papier à en-tête Word : même logo et mêmes coordonnées, corps libre. */
export function letterheadWordDocx(input: SupportsInput): Buffer {
  const svg = logoSvg(input.logo);
  const size = fitSize(svg, 70, 18);
  const logoPng = svgToPng(svg, { size: 900 });
  return letterheadDocx({
    title: `${input.content.name} — Papier à en-tête`,
    logoPng,
    logoWidthMm: size.width,
    logoHeightMm: size.height,
    footer: [footerText(input), ...contactLines(input.contact).slice(0, 2)].filter(Boolean),
    accent: input.colors.primary,
  });
}

/** Carte de membre d'association, format carte bancaire 85,6 × 54 mm, recto et verso. */
export function memberCardPdf(input: SupportsInput): Promise<Buffer> {
  const trimW = 85.6 * MM;
  const trimH = 54 * MM;
  const width = trimW + BLEED * 2;
  const height = trimH + BLEED * 2;
  const pdf = createPdf({
    size: [width, height],
    title: `${input.content.name} — Carte de membre`,
  });
  const { doc } = pdf;
  registerTextFonts(doc);
  const { colors } = input;
  const safe = BLEED + 4 * MM;
  const band = BLEED + 26 * MM;

  // Recto : bandeau à la couleur de la marque, champs à remplir.
  setPrintBoxes(doc, width, height);
  doc.rect(0, 0, width, height).fill('#ffffff');
  doc.rect(0, 0, band, height).fill(colors.primary);
  const mark =
    input.logo.kind === 'spec'
      ? logoSvg(input.logo, {
          layout: 'icon',
          variant: readableOn(colors.primary) === '#ffffff' ? 'white' : 'black',
        })
      : null;
  if (mark) {
    drawSvg(doc, mark, BLEED + 3 * MM, height / 2 - 10 * MM, 20 * MM, 20 * MM);
  } else {
    doc.roundedRect(BLEED + 3 * MM, height / 2 - 10 * MM, 20 * MM, 20 * MM, 2 * MM).fill('#ffffff');
    drawSvg(doc, logoSvg(input.logo), BLEED + 4 * MM, height / 2 - 9 * MM, 18 * MM, 18 * MM);
  }
  const x = band + 4 * MM;
  const fieldW = width - BLEED - 4 * MM - x;
  writeText(doc, 'CARTE DE MEMBRE', x, safe, {
    font: 'medium',
    size: 6,
    color: mix(colors.primary, INK, 0.2),
    characterSpacing: 1.2,
    width: fieldW,
    lineBreak: false,
  });
  writeText(doc, input.content.name, x, safe + 9, {
    font: 'bold',
    size: 10,
    color: INK,
    width: fieldW,
    lineBreak: false,
  });
  ['Nom et prénom', 'N° de membre', 'Valable jusqu’au'].forEach((label, index) => {
    const y = safe + 14 * MM + index * 8.5 * MM;
    writeText(doc, label, x, y, { size: 5.5, color: MUTED, width: fieldW, lineBreak: false });
    doc
      .lineWidth(0.4)
      .moveTo(x, y + 5.5 * MM)
      .lineTo(x + fieldW, y + 5.5 * MM)
      .stroke('#9ca3af');
  });

  // Verso : devise, mission, signature du titulaire.
  doc.addPage({ size: [width, height], margin: 0 });
  setPrintBoxes(doc, width, height);
  doc.rect(0, 0, width, height).fill('#ffffff');
  doc.rect(0, height - BLEED - 2 * MM, width, BLEED + 2 * MM).fill(colors.primary);
  let y = safe;
  const text = [input.content.devise, input.content.mission].filter((t): t is string => !!t);
  for (const [index, value] of text.entries()) {
    writeText(doc, value, safe, y, {
      font: index === 0 && input.content.devise ? 'bold' : 'regular',
      size: index === 0 && input.content.devise ? 8 : 6.5,
      color: INK,
      width: trimW - 8 * MM,
      align: 'center',
    });
    y = doc.y + 6;
  }
  writeText(
    doc,
    'Cette carte est personnelle. Elle doit être présentée à toute demande des responsables de l’association.',
    safe,
    height - safe - 16 * MM,
    {
      size: 5.5,
      color: MUTED,
      width: trimW - 8 * MM,
      align: 'center',
    },
  );
  const signY = height - safe - 6 * MM;
  writeText(doc, 'Signature du titulaire', safe, signY - 7, {
    size: 5.5,
    color: MUTED,
    width: 30 * MM,
    lineBreak: false,
  });
  doc
    .lineWidth(0.4)
    .moveTo(safe, signY + 3 * MM)
    .lineTo(safe + 30 * MM, signY + 3 * MM)
    .stroke('#9ca3af');
  writeText(doc, 'Pour le bureau', width - safe - 30 * MM, signY - 7, {
    size: 5.5,
    color: MUTED,
    width: 30 * MM,
    align: 'right',
    lineBreak: false,
  });
  doc
    .lineWidth(0.4)
    .moveTo(width - safe - 30 * MM, signY + 3 * MM)
    .lineTo(width - safe, signY + 3 * MM)
    .stroke('#9ca3af');
  return pdf.done();
}
