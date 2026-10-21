import type { KitContent } from './brand-kit';
import { getFont } from './fonts';
import { buildExportEntries, licencesText, type LogoSource } from './logo-assets';
import { svgToPng } from './raster';
import type { ZipEntry } from './zip';

// Archive du kit de marque (KIT-03), rangée par usage : logo/svg, logo/png, logo/pdf,
// icones-app, reseaux-sociaux, signatures, supports, charte.pdf, LICENCES.txt.

export interface KitArchiveSignatures {
  email?: { html: string; text: string } | null;
  stampSvg?: string | null;
  handwritten?: { svg: string; fontId: string | null } | null;
}

export interface KitArchiveSupports {
  businessCard?: Buffer;
  letterheadPdf?: Buffer;
  letterheadDocx?: Buffer;
  memberCard?: Buffer;
}

export interface KitArchiveInput {
  slug: string;
  version: number;
  content: KitContent;
  logo: LogoSource;
  /** Offre gratuite : PNG 512 px filigranés seulement, sans charte ni supports (§7.4). */
  watermark: string | null;
  charterPdf: Buffer | null;
  signatures: KitArchiveSignatures;
  supports: KitArchiveSupports | null;
}

const LOGO_FOLDERS: Record<string, string> = {
  'svg/': 'logo/svg/',
  'pdf/': 'logo/pdf/',
  'png/': 'logo/png/',
  'jpg/': 'logo/jpg/',
};

/** Signature e-mail en page HTML autonome, à ouvrir puis copier dans la messagerie. */
function emailHtmlPage(html: string, name: string) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Signature e-mail — ${name.replace(/[<>&"]/g, '')}</title></head><body>${html}</body></html>`;
}

function brandText(content: KitContent) {
  const lines = [
    content.slogan && `Slogan : ${content.slogan}`,
    content.devise && `Devise : ${content.devise}`,
    content.mission && `Mission : ${content.mission}`,
  ].filter(Boolean);
  return lines.length ? `${lines.join('\n')}\n` : null;
}

function readme(input: KitArchiveInput, paths: string[]) {
  const has = (prefix: string) => paths.some((p) => p.startsWith(prefix));
  const lines = [
    `KIT DE MARQUE — ${input.content.name} (version ${input.version})`,
    '',
    has('logo/svg/') && 'logo/svg        Logos vectoriels : site web, impression, agrandissements',
    has('logo/pdf/') && 'logo/pdf        Logos vectoriels pour l’imprimeur',
    has('logo/png/') && 'logo/png        Logos sur fond transparent : documents, présentations',
    has('logo/jpg/') && 'logo/jpg        Logo sur fond plein',
    has('icones-app/') && 'icones-app      Favicon et icônes d’application (iOS, Android)',
    has('reseaux-sociaux/') && 'reseaux-sociaux Photo de profil et bannières',
    has('signatures/') && 'signatures      Signature e-mail, slogan, cachet et paraphe',
    has('supports/') && 'supports        Carte de visite et papier à en-tête prêts à imprimer',
    has('charte.pdf') && 'charte.pdf      Règles d’utilisation de la marque',
    'LICENCES.txt    Licences des polices et icônes utilisées',
    '',
    input.watermark &&
      'Offre gratuite : logos en PNG 512 px filigranés. Les formats vectoriels, la charte et les supports sont inclus dans les offres payantes.',
    has('supports/') &&
      'Cartes : fond perdu de 3 mm de chaque côté, zone de coupe indiquée dans le PDF (TrimBox).',
  ].filter((line): line is string => typeof line === 'string');
  return `${lines.join('\n')}\n`;
}

/** Fichiers de l'archive, rangés sous un dossier racine `<nom>-kit-v<n>`. */
export async function buildKitArchive(input: KitArchiveInput): Promise<ZipEntry[]> {
  const restricted = input.watermark !== null;
  const logoEntries = await buildExportEntries(input.logo, input.slug, {
    formats: restricted ? ['png'] : ['svg', 'pdf', 'png', 'jpg'],
    sizes: restricted ? [512] : [512, 1024, 2048],
    iconPack: !restricted,
    social: !restricted,
    watermark: input.watermark,
  });
  const entries: ZipEntry[] = [];
  for (const entry of logoEntries) {
    const path = entry.path.slice(input.slug.length + 1);
    if (path === 'LICENCES.txt') continue;
    const folder = Object.keys(LOGO_FOLDERS).find((prefix) => path.startsWith(prefix));
    entries.push({
      path: folder ? LOGO_FOLDERS[folder] + path.slice(folder.length) : path,
      data: entry.data,
    });
  }

  const { email, stampSvg, handwritten } = input.signatures;
  if (email) {
    entries.push({
      path: 'signatures/signature-email.html',
      data: emailHtmlPage(email.html, input.content.name),
    });
    entries.push({ path: 'signatures/signature-email.txt', data: email.text });
  }
  const brand = brandText(input.content);
  if (brand) entries.push({ path: 'signatures/slogan.txt', data: brand });
  if (stampSvg) {
    entries.push({ path: 'signatures/cachet.svg', data: stampSvg });
    entries.push({ path: 'signatures/cachet.png', data: svgToPng(stampSvg, { size: 2048 }) });
  }
  if (handwritten) {
    entries.push({ path: 'signatures/paraphe.svg', data: handwritten.svg });
    entries.push({
      path: 'signatures/paraphe.png',
      data: svgToPng(handwritten.svg, { size: 2048 }),
    });
  }

  const supports = input.supports;
  if (supports?.businessCard)
    entries.push({ path: 'supports/carte-de-visite.pdf', data: supports.businessCard });
  if (supports?.letterheadPdf)
    entries.push({ path: 'supports/papier-a-en-tete.pdf', data: supports.letterheadPdf });
  if (supports?.letterheadDocx)
    entries.push({ path: 'supports/papier-a-en-tete.docx', data: supports.letterheadDocx });
  if (supports?.memberCard)
    entries.push({ path: 'supports/carte-de-membre.pdf', data: supports.memberCard });
  if (input.charterPdf) entries.push({ path: 'charte.pdf', data: input.charterPdf });

  // Licences : logo, puis polices de la charte, des supports et du paraphe (§14.2).
  const extra = ['', 'Charte et supports : Montserrat — SIL Open Font License 1.1'];
  if (handwritten?.fontId) {
    extra.push(`Paraphe : ${getFont(handwritten.fontId).name} — SIL Open Font License 1.1`);
  }
  entries.push({
    path: 'LICENCES.txt',
    data: `${licencesText(input.logo)}\n${extra.join('\n')}\n`,
  });
  entries.push({
    path: 'LISEZMOI.txt',
    data: readme(
      input,
      entries.map((e) => e.path),
    ),
  });

  const root = `${input.slug}-kit-v${input.version}`;
  return entries.map((entry) => ({ ...entry, path: `${root}/${entry.path}` }));
}
