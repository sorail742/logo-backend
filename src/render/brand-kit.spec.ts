import { renderBrandGuidePdf } from './brand-guide';
import { hexToCmyk, kitFonts, kitPalette, paletteColor, type KitContent } from './brand-kit';
import { letterheadDocx } from './docx';
import { buildKitArchive } from './kit-archive';
import type { LogoSource } from './logo-assets';
import { DEFAULT_SPEC, type LogoSpec } from './logo-spec';
import { textRuns } from './pdf';
import { businessCardPdf, memberCardPdf } from './print-supports';
import { renderHandwrittenSvg, renderStampSvg } from './stamp';

const spec: LogoSpec = { ...DEFAULT_SPEC, text: 'Kolabo', fontId: 'playfair' };
const source: LogoSource = { kind: 'spec', spec };
const content: KitContent = {
  name: 'Kolabo',
  acronym: 'KLB',
  meaning: 'De « kola » et « collaboration ».',
  entityType: 'ASSOCIATION',
  slogan: 'Ensemble plus loin',
  devise: 'Unité – Travail – Partage',
  mission: 'Accompagner les jeunes vers l’emploi.',
};

/** Nombre de pages d'un PDF produit par pdfkit. */
function pageCount(pdf: Buffer) {
  return pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
}

describe('palette et polices du kit (KIT-01)', () => {
  it('convertit en RGB et CMJN comme le front', () => {
    expect(hexToCmyk('#000000')).toEqual([0, 0, 0, 100]);
    expect(hexToCmyk('#ffffff')).toEqual([0, 0, 0, 0]);
    expect(paletteColor('#0f766e', 'primary')).toEqual({
      hex: '#0F766E',
      rgb: '15, 118, 110',
      cmyk: '87, 0, 7, 54',
      role: 'primary',
    });
    expect(kitPalette(spec.colors).map((c) => c.role)).toEqual([
      'primary',
      'secondary',
      'text',
      'background',
    ]);
  });

  it('liste la police du nom puis celle des textes, sans doublon', () => {
    expect(kitFonts(source).map((f) => f.id)).toEqual(['playfair', 'montserrat']);
    expect(kitFonts({ kind: 'spec', spec: DEFAULT_SPEC }).map((f) => f.id)).toEqual(['montserrat']);
    expect(kitFonts(source).every((f) => f.license === 'SIL Open Font License 1.1')).toBe(true);
  });
});

describe('texte des PDF', () => {
  it('bascule sur le sous-ensemble latin étendu pour les seuls caractères absents', () => {
    expect(textRuns('Café « Ɓuuɗe »')).toEqual([
      { text: 'Café « ', ext: false },
      { text: 'Ɓ', ext: true },
      { text: 'uu', ext: false },
      { text: 'ɗ', ext: true },
      { text: 'e »', ext: false },
    ]);
  });
});

describe('charte graphique PDF (KIT-02)', () => {
  it('produit couverture et sections, avec les valeurs de la palette', async () => {
    const pdf = await renderBrandGuidePdf({
      content,
      version: 2,
      date: new Date('2026-10-20T10:00:00Z'),
      logo: source,
      palette: kitPalette(spec.colors),
      fonts: kitFonts(source),
      signatures: {
        stampSvg: renderStampSvg({
          shape: 'round',
          ringText: 'Association Kolabo',
          bottomText: 'Conakry',
          centerText: 'KLB',
          centerMode: 'acronym',
          ink: 'blue',
          inkEffect: true,
        }),
        handwrittenSvg: renderHandwrittenSvg({
          text: 'A. Diallo',
          fontId: 'great-vibes',
          ink: 'blue',
        }),
        email: { template: 'Classique', text: 'Aminata Diallo\nPrésidente' },
      },
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(9);
    // Le texte est écrit en codes de glyphes : le titre se lit dans les métadonnées.
    expect(pdf.toString('latin1')).toContain('Charte graphique');
  });

  it('accepte un logo importé sans symbole ni signatures', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#0b3d91"/></svg>';
    const pdf = await renderBrandGuidePdf({
      content: {
        ...content,
        acronym: null,
        meaning: null,
        slogan: null,
        devise: null,
        mission: null,
      },
      version: 1,
      date: new Date(),
      logo: { kind: 'svg', svg, title: 'Import', background: '#ffffff' },
      palette: kitPalette(spec.colors),
      fonts: kitFonts({ kind: 'svg', svg, title: 'Import', background: '#ffffff' }),
      signatures: {},
    });
    expect(pageCount(pdf)).toBe(9);
  });
});

describe('supports imprimables (KIT-04)', () => {
  const supports = {
    content,
    logo: source,
    colors: spec.colors,
    contact: { fullName: 'Aminata Diallo', jobTitle: 'Présidente', phone: '+224 620 00 00 00' },
  };

  it('carte de visite recto verso, fond perdu de 3 mm déclaré', async () => {
    const pdf = await businessCardPdf(supports);
    const text = pdf.toString('latin1');
    expect(pageCount(pdf)).toBe(2);
    // 85 × 55 mm + 2 × 3 mm, en points ; zone de coupe à 3 mm (8,5 pt) du bord.
    expect(text).toMatch(/\/MediaBox \[0 0 257\.95\d* 172\.91\d*\]/);
    expect(text).toMatch(/\/TrimBox \[8\.50\d* 8\.50\d* 249\.44\d* 164\.40\d*\]/);
  });

  it('carte de membre au format carte bancaire', async () => {
    const pdf = await memberCardPdf(supports);
    expect(pageCount(pdf)).toBe(2);
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 259\.6\d* 170\.07\d*\]/);
  });

  it('papier à en-tête Word : paquet OOXML avec logo en en-tête', () => {
    const docx = letterheadDocx({
      title: 'Kolabo — Papier à en-tête',
      logoPng: Buffer.from('89504e47', 'hex'),
      logoWidthMm: 60,
      logoHeightMm: 15,
      footer: ['Kolabo · Conakry'],
      accent: '#0b3d91',
    });
    const text = docx.toString('latin1');
    for (const part of [
      '[Content_Types].xml',
      'word/document.xml',
      'word/header1.xml',
      'word/footer1.xml',
      'word/media/logo.png',
    ]) {
      expect(text).toContain(part);
    }
  });
});

describe('archive du kit (KIT-03)', () => {
  it('range les fichiers par usage sous un dossier racine', async () => {
    const entries = await buildKitArchive({
      slug: 'kolabo',
      version: 3,
      content,
      logo: source,
      watermark: null,
      charterPdf: Buffer.from('%PDF-'),
      signatures: {
        email: { html: '<table></table>', text: 'Aminata' },
        stampSvg: renderStampSvg({
          shape: 'oval',
          ringText: 'Association Kolabo',
          bottomText: '',
          centerText: 'KLB',
          centerMode: 'acronym',
          ink: 'violet',
          inkEffect: false,
        }),
        handwritten: {
          svg: renderHandwrittenSvg({ text: 'A. D.', fontId: 'allura', ink: 'black' }),
          fontId: 'allura',
        },
      },
      supports: { businessCard: Buffer.from('%PDF-') },
    });
    const paths = entries.map((e) => e.path);
    expect(paths.every((p) => p.startsWith('kolabo-kit-v3/'))).toBe(true);
    for (const expected of [
      'logo/svg/kolabo-couleur.svg',
      'logo/pdf/kolabo-icone.pdf',
      'logo/png/kolabo-blanc-2048.png',
      'logo/jpg/kolabo-couleur-512.jpg',
      'icones-app/favicon.ico',
      'reseaux-sociaux/photo-de-profil-400.png',
      'signatures/signature-email.html',
      'signatures/slogan.txt',
      'signatures/cachet.png',
      'signatures/paraphe.svg',
      'supports/carte-de-visite.pdf',
      'charte.pdf',
      'LICENCES.txt',
      'LISEZMOI.txt',
    ]) {
      expect(paths).toContain(`kolabo-kit-v3/${expected}`);
    }
    const licences = String(entries.find((e) => e.path.endsWith('LICENCES.txt'))!.data);
    expect(licences).toContain('Playfair Display');
    expect(licences).toContain('Paraphe : Allura');
  });

  it('offre gratuite : PNG 512 px filigranés, sans vectoriel, charte ni supports', async () => {
    const entries = await buildKitArchive({
      slug: 'kolabo',
      version: 1,
      content,
      logo: source,
      watermark: 'APERÇU',
      charterPdf: null,
      signatures: {},
      supports: null,
    });
    const paths = entries.map((e) => e.path.replace('kolabo-kit-v1/', ''));
    expect(
      paths.filter((p) => p.startsWith('logo/')).every((p) => /^logo\/png\/.+-512\.png$/.test(p)),
    ).toBe(true);
    expect(paths.some((p) => /icones-app|reseaux-sociaux|supports|charte/.test(p))).toBe(false);
    expect(String(entries.find((e) => e.path.endsWith('LISEZMOI.txt'))!.data)).toContain(
      'Offre gratuite',
    );
  });
});
