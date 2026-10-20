import { pageNeedsRaster, renderDesignPage, textLines } from './design';
import { designDocSchema, type DesignDoc, type TextElement } from './design-doc';
import { designToPdf } from './design-pdf';
import { svgToPng } from './raster';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function text(patch: Partial<TextElement> = {}): TextElement {
  return {
    id: 'title',
    type: 'text',
    x: 80,
    y: 120,
    width: 900,
    height: 120,
    rotation: 0,
    opacity: 1,
    text: 'Journée portes ouvertes',
    fontId: 'anton',
    fontWeight: 400,
    fontSize: 96,
    letterSpacing: 0.02,
    lineHeight: 1.1,
    align: 'center',
    uppercase: true,
    fill: {
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: '#0b3d91' },
        { offset: 1, color: '#ce1126' },
      ],
    },
    lines: ['JOURNÉE PORTES', 'OUVERTES'],
    ...patch,
  };
}

function doc(patch: Partial<DesignDoc> = {}): DesignDoc {
  return {
    version: 1,
    width: 1080,
    height: 1080,
    pages: [
      {
        id: 'p1',
        background: { type: 'solid', color: '#fdf6ec' },
        elements: [
          {
            id: 'bg',
            type: 'shape',
            shape: 'blob',
            seed: 4,
            x: -100,
            y: 600,
            width: 700,
            height: 600,
            rotation: 12,
            opacity: 0.9,
            fill: { type: 'solid', color: '#f4b400' },
          },
          text(),
          text({
            id: 'arc',
            text: 'Kaloum · Conakry',
            y: 420,
            height: 160,
            curve: 40,
            lines: undefined,
            fontId: 'montserrat',
            fontWeight: 700,
            fontSize: 48,
            uppercase: false,
            fill: { type: 'solid', color: '#111827' },
          }),
          {
            id: 'icon',
            type: 'icon',
            iconId: 'heart',
            node: [
              [
                'path',
                {
                  d: 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5',
                },
              ],
            ],
            x: 480,
            y: 640,
            width: 120,
            height: 120,
            rotation: 0,
            opacity: 1,
            color: '#ce1126',
            strokeWidth: 2,
          },
          {
            id: 'photo',
            type: 'image',
            src: PNG_1PX,
            naturalWidth: 1,
            naturalHeight: 1,
            x: 760,
            y: 700,
            width: 240,
            height: 240,
            rotation: 0,
            opacity: 1,
            fit: 'cover',
            mask: 'circle',
          },
        ],
      },
    ],
    ...patch,
  };
}

describe('rendu serveur des créations du Studio', () => {
  it('valide le document partagé avec l’éditeur', () => {
    expect(designDocSchema.safeParse(doc()).success).toBe(true);
    const bad = doc();
    (bad.pages[0].elements[1] as TextElement).fontId = 'comic-sans';
    expect(designDocSchema.safeParse(bad).success).toBe(false);
  });

  it('convertit le texte en tracés, y compris en arc', () => {
    const svg = renderDesignPage(doc(), 0);
    expect(svg).not.toContain('<text');
    expect(svg.match(/<path transform="translate\([^)]+\) rotate\(/g)?.length).toBeGreaterThan(10);
    expect(svg).toContain('<linearGradient id="stitle-f"');
    expect(svg).toContain('clip-path="url(#sphoto-clip)"');
    // Le rendu se trame sans erreur.
    expect(svgToPng(svg, { size: 540 }).subarray(1, 4).toString()).toBe('PNG');
  });

  it('reprend les lignes de l’éditeur, ou coupe à la largeur sinon', () => {
    expect(textLines(text())).toEqual(['JOURNÉE PORTES', 'OUVERTES']);
    const wrapped = textLines(text({ lines: undefined, width: 300 }));
    expect(wrapped.length).toBeGreaterThan(1);
  });

  it('PDF d’impression : taille réelle, fond perdu, zone de coupe et traits de coupe', async () => {
    const a5 = doc({
      width: 874,
      height: 1240,
      print: { widthMm: 148, heightMm: 210, bleedMm: 3 },
    });
    const pdf = (await designToPdf(a5, { title: 'Flyer', cropMarks: true })).toString('latin1');
    const mm = 72 / 25.4;
    const width = (148 + 2 * 3 + 2 * 8) * mm;
    expect(pdf).toMatch(new RegExp(`/MediaBox \\[0 0 ${width.toFixed(2).slice(0, -1)}`));
    expect(pdf).toMatch(/\/TrimBox \[31\.18\d* 31\.18\d*/);
  });

  it('trame à 300 dpi seulement les pages avec des effets que le PDF ne rend pas', async () => {
    const plain = doc();
    expect(pageNeedsRaster(plain.pages[0])).toBe(false);
    const shadowed = doc();
    shadowed.pages[0].elements[1].shadow = { x: 0, y: 8, blur: 16, color: '#000000', opacity: 0.3 };
    expect(pageNeedsRaster(shadowed.pages[0])).toBe(true);
    const pdf = await designToPdf(shadowed, { title: 'Post' });
    expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  });
});
