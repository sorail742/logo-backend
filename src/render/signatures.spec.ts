import { DEFAULT_SPEC } from './logo-spec';
import { markSvg } from './logo-assets';
import {
  emailSignatureDataSchema,
  EMAIL_TEMPLATE_KEYS,
  renderEmailSignature,
  renderEmailSignatureText,
  type SignatureBrand,
} from './email-signature';
import { svgToPixels } from './raster';
import {
  findOfficialTerms,
  handwrittenDataSchema,
  renderHandwrittenSvg,
  renderStampSvg,
  stampDataSchema,
  type StampData,
} from './stamp';
import { recolorSvg } from './svg';

const stamp = (patch: Partial<StampData> = {}): StampData =>
  stampDataSchema.parse({
    shape: 'round',
    ringText: 'Association Kaloum Jeunesse',
    bottomText: 'Conakry · Guinée',
    centerText: 'AKJ',
    centerMode: 'acronym',
    ink: 'violet',
    ...patch,
  });

/** Pixels opaques d'un rendu, pour vérifier que le dessin n'est pas vide. */
function inkedPixels(svg: string) {
  const { data } = svgToPixels(svg, { size: 256 });
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
  return count;
}

describe('cachet (SIG-22 à 24)', () => {
  it.each(['round', 'oval', 'rectangle'] as const)(
    'forme %s : tout le texte en tracés',
    (shape) => {
      const svg = renderStampSvg(stamp({ shape }));
      expect(svg).not.toContain('<text');
      expect(svg).toContain('fill="#5b2a86"');
      expect(inkedPixels(svg)).toBeGreaterThan(2000);
    },
  );

  it('un texte circulaire long est réduit sans déborder du cadre', () => {
    const svg = renderStampSvg(
      stamp({ ringText: 'Union des coopératives agricoles de Basse-Guinée' }),
    );
    const { data, width, height } = svgToPixels(svg, { size: 200 });
    // Coin supérieur gauche transparent : rien ne sort du cercle.
    expect(data[3]).toBe(0);
    expect(width).toBe(height);
  });

  it('effet d’encre : filtre déclaré et appliqué', () => {
    const svg = renderStampSvg(stamp({ inkEffect: true }));
    expect(svg).toContain('<filter id="ink"');
    expect(svg).toContain('filter="url(#ink)"');
  });

  it('mode logo : symbole du logo inséré à l’encre du cachet', () => {
    const mark = recolorSvg(
      markSvg({ kind: 'spec', spec: { ...DEFAULT_SPEC, text: 'Kaloum' } }),
      '#1d3f9e',
    );
    const svg = renderStampSvg(stamp({ centerMode: 'logo', ink: 'blue' }), { logoSvg: mark });
    expect(svg.match(/<svg\b/g)).toHaveLength(2);
    expect(svg).not.toMatch(/fill="#(?!1d3f9e)[0-9a-f]{6}"/i);
  });

  it('les textes sont échappés dans le titre accessible', () => {
    const svg = renderStampSvg(stamp({ ringText: 'A & B <script>' }));
    expect(svg).toContain('A &amp; B &lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });

  it('termes officiels détectés sans accents ni casse (§6.4)', () => {
    expect(findOfficialTerms('RÉPUBLIQUE DE GUINÉE', '', 'Le Président')).toEqual(['republique']);
    expect(findOfficialTerms('Ministère de la Santé')).toEqual(['ministere']);
    expect(findOfficialTerms('Association Kaloum', 'Conakry')).toEqual([]);
    // Un mot qui contient un terme n'est pas un terme officiel.
    expect(findOfficialTerms('Courtage immobilier')).toEqual([]);
  });

  it('schéma : texte circulaire obligatoire, encre connue', () => {
    expect(stampDataSchema.safeParse({ ...stamp(), ringText: ' ' }).success).toBe(false);
    expect(stampDataSchema.safeParse({ ...stamp(), ink: 'green' }).success).toBe(false);
  });
});

describe('paraphe (SIG-20, SIG-21)', () => {
  it('texte en police manuscrite converti en tracés', () => {
    const svg = renderHandwrittenSvg(
      handwrittenDataSchema.parse({ text: 'A. Diallo', fontId: 'great-vibes', ink: 'blue' }),
    );
    expect(svg).not.toContain('<text');
    expect(inkedPixels(svg)).toBeGreaterThan(500);
  });

  it('tracé dessiné conservé, contenu filtré', () => {
    const data = handwrittenDataSchema.parse({
      text: '',
      fontId: 'allura',
      ink: 'black',
      strokes: 'M 10 10 Q 50 80 120 40 L 200 60',
    });
    expect(renderHandwrittenSvg(data)).toContain('d="M 10 10 Q 50 80 120 40 L 200 60"');
    expect(
      handwrittenDataSchema.safeParse({
        text: '',
        fontId: 'allura',
        ink: 'black',
        strokes: 'M0 0"/><script>',
      }).success,
    ).toBe(false);
  });

  it('police hors bibliothèque refusée', () => {
    expect(
      handwrittenDataSchema.safeParse({ text: 'X', fontId: 'comic-sans', ink: 'blue' }).success,
    ).toBe(false);
  });
});

describe('signature e-mail (SIG-10 à 17)', () => {
  const data = emailSignatureDataSchema.parse({
    fullName: 'Aïssatou <Diallo>',
    jobTitle: 'Présidente',
    phones: ['+224 620 00 00 00'],
    email: 'aissatou@example.org',
    website: 'kaloum.org',
    socials: [{ network: 'facebook', url: 'facebook.com/kaloum' }],
    legal: 'Agrément n° 123',
    bannerUrl: 'https://kaloum.org/banniere.png',
    bannerLink: 'https://kaloum.org/adhesion',
  });
  const brand: SignatureBrand = {
    name: 'Kaloum',
    slogan: 'Agir ensemble',
    logoUrl: 'https://api.example.org/logo.png',
    primary: '#0f766e',
    secondary: '#f59e0b',
    poweredBy: 'Signature créée avec Marka',
  };

  it.each(EMAIL_TEMPLATE_KEYS)('modèle %s : tableaux, styles en ligne, contenu échappé', (key) => {
    const html = renderEmailSignature(key, data, brand);
    expect(html.startsWith('<table')).toBe(true);
    expect(html).not.toMatch(/<(style|script|link)\b/);
    expect(html).toContain('Aïssatou &lt;Diallo&gt;');
    expect(html).toContain('href="tel:+224620000000"');
    expect(html).toContain('Signature créée avec Marka');
  });

  it('six modèles distincts', () => {
    const outputs = new Set(
      EMAIL_TEMPLATE_KEYS.map((key) => renderEmailSignature(key, data, brand)),
    );
    expect(outputs.size).toBe(6);
  });

  it('version texte brut', () => {
    const text = renderEmailSignatureText(data, { ...brand, poweredBy: null });
    expect(text).toContain('Aïssatou <Diallo>');
    expect(text).toContain('+224 620 00 00 00');
    expect(text).not.toContain('Marka');
  });

  it('schéma : nom obligatoire, e-mail valide, 3 téléphones au plus', () => {
    expect(emailSignatureDataSchema.safeParse({ fullName: '' }).success).toBe(false);
    expect(
      emailSignatureDataSchema.safeParse({ fullName: 'A', email: 'pas-un-email' }).success,
    ).toBe(false);
    expect(
      emailSignatureDataSchema.safeParse({ fullName: 'A', phones: ['1', '2', '3', '4'] }).success,
    ).toBe(false);
    expect(emailSignatureDataSchema.parse({ fullName: 'A' }).phones).toEqual([]);
  });
});
