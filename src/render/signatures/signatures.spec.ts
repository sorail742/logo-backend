import { mockSlogans } from '../../modules/ai/providers/mock-slogans';
import { closestKnownSlogan, similarity } from '../../modules/slogans/known-slogans';
import { sloganGenerationInputSchema } from '../../shared/ai-schemas';
import { parseCsv } from '../../shared/csv';
import { wordCount } from '../../shared/text';
import { toPng } from '../export';
import {
  EmailBrand,
  EmailSignatureData,
  formatPhone,
  renderEmailSignatureHtml,
  renderEmailSignatureText,
  safeUrl,
} from './email';
import { chaikin, handwritingProposals, renderHandwriting } from './handwritten';
import { renderStamp, StampSpec, stampTexts } from './stamp';

const data: EmailSignatureData = {
  fullName: 'Aïssatou Camara',
  jobTitle: 'Présidente',
  organization: 'Association Jeunesse Verte',
  phones: ['+224620000000'],
  email: 'aissatou@exemple.org',
  website: 'jeunesseverte.org',
  address: 'Kaloum, Conakry',
  socials: { facebook: 'https://facebook.com/jv', linkedin: 'https://linkedin.com/company/jv' },
  legalNotice: 'Agrément n° 0123/MATD',
};
const brand: EmailBrand = {
  primary: '#0E7C66',
  text: '#1F2937',
  fontFamily: "'Montserrat', Arial, Helvetica, sans-serif",
  logo: {
    url: 'https://api.exemple.org/api/v1/public/signature-assets/x/logo-abcdefabcdef.png',
    width: 140,
    height: 56,
  },
  socialIcons: { facebook: 'https://api.exemple.org/f.png' },
};

describe('signature e-mail (SIG-10 à SIG-15)', () => {
  it.each(['logo-left', 'logo-top', 'text-only', 'inline'] as const)(
    'disposition %s : tableaux et styles en ligne uniquement',
    (layout) => {
      const html = renderEmailSignatureHtml(
        data,
        brand,
        { layout, divider: true, accentBar: true },
        null,
      );
      expect(html).toContain('Aïssatou Camara');
      expect(html).not.toMatch(/<style|class=|<script|<link/i);
      if (layout !== 'inline') expect(html).toMatch(/<table[^>]*role="presentation"/);
    },
  );

  it('images en URL HTTPS absolues, avec largeur et hauteur', () => {
    const html = renderEmailSignatureHtml(data, brand, { layout: 'logo-left' }, null);
    for (const m of html.matchAll(/<img ([^>]*)>/g)) {
      expect(m[1]).toMatch(/src="https:\/\//);
      expect(m[1]).toMatch(/width="\d+"/);
      expect(m[1]).toMatch(/height="\d+"/);
    }
  });

  it('échappe les champs saisis et neutralise les liens dangereux', () => {
    const evil = {
      ...data,
      fullName: '<img src=x onerror=alert(1)>',
      website: 'javascript:alert(1)',
      banner: { text: 'Adhérez', url: 'javascript:alert(2)' },
    };
    const html = renderEmailSignatureHtml(evil, brand, { layout: 'logo-left', banner: true }, null);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).not.toMatch(/javascript:/i);
  });

  it('mention de la plateforme pour l’offre gratuite seulement', () => {
    const platform = { name: 'Plateforme', url: 'https://exemple.org' };
    expect(renderEmailSignatureHtml(data, brand, { layout: 'text-only' }, platform)).toContain(
      'Signature créée avec',
    );
    expect(renderEmailSignatureHtml(data, brand, { layout: 'text-only' }, null)).not.toContain(
      'Signature créée avec',
    );
  });

  it('version texte brut (SIG-15)', () => {
    const text = renderEmailSignatureText(data, null);
    expect(text).toContain('Tél. : +224 620 00 00 00');
    expect(text).toContain('Agrément n° 0123/MATD');
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it('formats internationaux et URL', () => {
    expect(formatPhone('+224620000000')).toBe('+224 620 00 00 00');
    expect(formatPhone('+33612345678')).toBe('+33 6 12 34 56 78');
    expect(safeUrl('jeunesseverte.org')).toBe('https://jeunesseverte.org/');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('paraphe (SIG-20, SIG-21)', () => {
  it('plusieurs propositions à partir du nom, en tracés', () => {
    const props = handwritingProposals('Mamadou Diallo');
    expect(props.length).toBeGreaterThanOrEqual(6);
    expect(new Set(props.map((p) => p.text))).toEqual(
      new Set(['Mamadou Diallo', 'M. Diallo', 'MD']),
    );
    const { svg } = renderHandwriting(props[0], 'blue');
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).toContain('#1F3A93');
    expect(svg).not.toMatch(/<rect/); // fond transparent
  });

  it('tracé dessiné : lissé et vectorisé', () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 10],
      [20, 0],
    ];
    expect(chaikin(pts, 1)).toHaveLength(6);
    const { svg } = renderHandwriting(
      {
        mode: 'drawn',
        strokes: [
          pts,
          [
            [0, 20],
            [20, 20],
          ],
        ],
      },
      'black',
    );
    expect(svg).toMatch(/stroke="#111111"/);
    expect(() => toPng(svg, 200)).not.toThrow();
  });
});

describe('cachet (SIG-22 à SIG-24)', () => {
  const spec: StampSpec = {
    shape: 'round',
    topText: 'Association Jeunesse Verte',
    bottomText: 'Conakry · Guinée',
    center: { kind: 'acronym', text: 'AJV' },
    title: 'Le Président',
    ink: 'red',
    inkEffect: false,
    fontId: 'roboto-slab',
  };

  it.each(['round', 'oval', 'rect'] as const)('forme %s rendue en tracés', (shape) => {
    const { svg } = renderStamp({ ...spec, shape });
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).toContain('#B22222');
    expect(() => toPng(svg, 300)).not.toThrow();
  });

  it('effet d’encre optionnel', () => {
    expect(renderStamp({ ...spec, inkEffect: true }).svg).toContain('filter="url(#ink)"');
    expect(renderStamp(spec).svg).not.toContain('filter=');
  });

  it('centre avec icône de la bibliothèque', () => {
    expect(() =>
      toPng(renderStamp({ ...spec, center: { kind: 'icon', iconId: 'leaf' } }).svg, 200),
    ).not.toThrow();
  });

  it('textes soumis à la modération', () => {
    expect(stampTexts(spec)).toEqual([
      'Association Jeunesse Verte',
      'Conakry · Guinée',
      'Le Président',
      'AJV',
    ]);
  });
});

describe('slogans (SIG-01 à SIG-04)', () => {
  const input = sloganGenerationInputSchema.parse({
    name: 'Jeunesse Verte',
    entityType: 'ASSOCIATION',
    brief: {
      sector: 'Environnement',
      mission: 'Planter des arbres avec les jeunes',
      values: ['écologie', 'solidarité'],
      audience: 'les jeunes',
    },
    tone: 'INSPIRING',
    withMotto: true,
  });

  it('10 slogans de 8 mots au plus, plus devises et mission pour une association', () => {
    const out = mockSlogans(input);
    const slogans = out.filter((s) => s.kind === 'SLOGAN');
    expect(slogans).toHaveLength(10);
    expect(slogans.every((s) => wordCount(s.text) <= 8)).toBe(true);
    expect(
      out.filter((s) => s.kind === 'DEVISE').every((d) => d.text.split(' – ').length === 3),
    ).toBe(true);
    expect(out.some((s) => s.kind === 'MISSION')).toBe(true);
  });

  it.each([
    ['INSPIRING', 'fr'],
    ['INSTITUTIONAL', 'fr'],
    ['CATCHY', 'en'],
    ['COMMITTED', 'en'],
  ] as const)('ton %s (%s) : toujours 10 slogans, même avec une seule valeur', (tone, language) => {
    const out = mockSlogans({
      ...input,
      tone,
      language,
      withMotto: false,
      brief: { ...input.brief, values: ['écologie'] },
    });
    expect(out.filter((s) => s.kind === 'SLOGAN')).toHaveLength(10);
  });

  it('signale un slogan trop proche d’un slogan connu', () => {
    expect(closestKnownSlogan('Impossible is nothing!')).toBe('Impossible is nothing');
    expect(closestKnownSlogan('Liberté, égalité, fraternité')).toBe('Liberté Égalité Fraternité');
    expect(closestKnownSlogan('Semer la solidarité, récolter demain')).toBeNull();
    expect(similarity('Just do it', 'just DO it')).toBe(1);
  });
});

describe('CSV partagé', () => {
  it('séparateur ; et guillemets', () => {
    const { header, rows } = parseCsv('nom;fonction\n"Camara; Aïssatou";Présidente');
    expect(header).toEqual(['nom', 'fonction']);
    expect(rows[0]).toEqual({ nom: 'Camara; Aïssatou', fonction: 'Présidente' });
  });
});
