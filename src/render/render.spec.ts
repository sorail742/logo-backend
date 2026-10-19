import { contrastRatio } from '../shared/color';
import {
  generatedLogosSchema,
  logoGenerationInputSchema,
  LogoSpec,
  logoSpecSchema,
} from '../shared/logo-spec';
import { mockComposeLogos } from '../modules/ai/providers/mock-logos';
import { licences, zipFiles } from '../modules/logos/logo-export.service';
import { FONTS, iconExists, loadFont, searchIcons } from './assets';
import { composeLogo, initials } from './compose';
import {
  appIconPack,
  hammingDistance,
  optimizeSvg,
  perceptualHash,
  toIco,
  toPng,
  watermark,
} from './export';
import { sanitizeSvg, sniffImage, svgPalette } from './sanitize';
import { renderMockups, renderVariant, VARIANTS } from './variants';

const spec = (over: Partial<LogoSpec> = {}): LogoSpec =>
  logoSpecSchema.parse({
    type: 'ICON_TEXT',
    layout: 'horizontal',
    text: 'Leso',
    tagline: 'Jeunesse et avenir',
    font: { id: 'montserrat', weight: 800 },
    colors: { primary: '#0E7C66', secondary: '#F2A541', text: '#1F2937' },
    icon: { id: 'leaf', container: 'circle' },
    ...over,
  });

const colorsIn = (svg: string) =>
  new Set([...svg.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase()));

describe('bibliothèque', () => {
  it.each(FONTS.flatMap((f) => f.weights.map((w) => [f.id, w] as const)))(
    'police %s %i chargeable',
    (id, w) => {
      expect(loadFont(id, w).unitsPerEm).toBeGreaterThan(0);
    },
  );

  it('les polices couvrent les accents français', () => {
    const font = loadFont('montserrat', 700);
    for (const ch of 'éèêàçùôîÉÇ') expect(font.charToGlyph(ch).index).toBeGreaterThan(0);
  });

  it('recherche d’icônes par étiquette', () => {
    expect(searchIcons('leaf', 5).map((i) => i.id)).toContain('leaf');
    expect(iconExists('heart-handshake')).toBe(true);
  });
});

describe('composeLogo', () => {
  it('convertit tout le texte en tracés (§5.5)', () => {
    const { svg, width, height } = composeLogo(spec());
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/);
    expect(width).toBeGreaterThan(height);
  });

  it('rend chaque type et chaque disposition', () => {
    for (const type of ['WORDMARK', 'MONOGRAM', 'ICON_TEXT', 'EMBLEM'] as const) {
      for (const layout of ['horizontal', 'vertical', 'icon', 'text'] as const) {
        const s = spec({ type, layout, emblem: type === 'EMBLEM' ? { shape: 'shield' } : null });
        expect(() => toPng(composeLogo(s).svg, 64)).not.toThrow();
      }
    }
  });

  it('monogramme sans pastille', () => {
    const s = spec({
      type: 'MONOGRAM',
      acronym: 'AJA',
      icon: { id: 'leaf', container: 'none', scale: 1.4 },
    });
    expect(() => toPng(composeLogo(s).svg, 64)).not.toThrow();
  });

  it('corrige un texte trop peu contrasté (4,5:1)', () => {
    const { svg } = composeLogo(spec({ colors: { primary: '#0E7C66', text: '#DDDDDD' } }));
    const textColor = [...colorsIn(svg)].find((c) => c !== '#0E7C66' && c !== '#F2A541');
    expect(contrastRatio(textColor!, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('initiales : sigle, sinon premières lettres', () => {
    expect(initials({ text: 'Jeunesse Verte Guinée', acronym: null })).toBe('JVG');
    expect(initials({ text: 'Leso', acronym: 'ajl' })).toBe('AJL');
  });
});

describe('variantes (LOGO-20) et mises en situation (LOGO-05)', () => {
  it('noir et blanc sont strictement monochromes', () => {
    expect(colorsIn(renderVariant(spec(), 'black').svg)).toEqual(new Set(['#000000']));
    expect(colorsIn(renderVariant(spec(), 'white').svg)).toEqual(new Set(['#FFFFFF']));
  });

  it('produit les six variantes et les quatre mises en situation', () => {
    for (const v of VARIANTS) expect(renderVariant(spec(), v).svg).toContain('<svg');
    const m = renderMockups(spec());
    for (const svg of Object.values(m)) expect(() => toPng(svg, 100)).not.toThrow();
  });
});

describe('exports', () => {
  it('pack icônes : 7 PNG + favicon.ico multi-tailles (LOGO-22)', async () => {
    const pack = appIconPack(
      renderVariant({ ...spec(), layout: 'icon' }, 'white'),
      '#0E7C66',
    );
    expect(Object.keys(pack)).toHaveLength(8);
    const ico = pack['favicon.ico'];
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
  });

  it('ICO : en-tête et entrées cohérents', () => {
    const png = toPng(composeLogo(spec()).svg, 16);
    const ico = toIco([{ size: 16, data: png }]);
    expect(ico.readUInt32LE(6 + 8)).toBe(png.length);
    expect(ico.readUInt32LE(6 + 12)).toBe(22);
  });

  it('SVGO optimise sans planter, toutes icônes candidates (régression users-group)', () => {
    for (const icon of ['users-group', 'leaf', 'heart-handshake', 'school', 'device-mobile', 'building']) {
      for (const font of ['josefin-sans', 'montserrat', 'playfair-display']) {
        const logo = composeLogo(spec({ font: { id: font, weight: 700 }, icon: { id: icon, container: 'none', scale: 1.4 } }));
        const out = optimizeSvg(logo.svg);
        expect(out).toContain('viewBox');
        expect(out.length).toBeLessThanOrEqual(logo.svg.length);
      }
    }
  });

  it('filigrane ajouté (LOGO-24)', () => {
    const logo = composeLogo(spec());
    expect(watermark(logo).length).toBeGreaterThan(logo.svg.length);
  });

  it('LICENCES.txt liste police et icône', () => {
    const txt = licences(spec());
    expect(txt).toContain('Montserrat');
    expect(txt).toContain('OFL');
    expect(txt).toContain('Tabler Icons');
  });

  it('archive ZIP valide', async () => {
    const zip = await zipFiles({ 'a.txt': Buffer.from('x') });
    expect(zip.subarray(0, 2).toString()).toBe('PK');
  });
});

describe('empreinte perceptuelle (§5.5)', () => {
  it('stable pour un même logo, éloignée pour un logo différent', () => {
    const a = perceptualHash(composeLogo(spec()).svg);
    expect(perceptualHash(composeLogo(spec()).svg)).toBe(a);
    const b = perceptualHash(
      composeLogo(spec({ type: 'EMBLEM', emblem: { shape: 'shield' } })).svg,
    );
    expect(hammingDistance(a, b)).toBeGreaterThan(6);
  });

  it('proche pour une simple nuance de couleur', () => {
    const a = perceptualHash(composeLogo(spec()).svg);
    const b = perceptualHash(
      composeLogo(spec({ colors: { primary: '#0F806A', secondary: '#F2A541', text: '#1F2937' } }))
        .svg,
    );
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(6);
  });
});

describe('logos importés (§14.1)', () => {
  it('retire scripts, gestionnaires, liens externes et foreignObject', () => {
    const dirty = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject><div/></foreignObject><a href="javascript:alert(3)"><rect fill="#123456"/></a><image href="https://evil.example/x.png"/><use href="#ok"/><rect style="fill:url(https://evil.example/f)"/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/script|onload|foreignObject|javascript|evil\.example/i);
    expect(clean).toContain('href="#ok"');
  });

  it('refuse les entités XML', () => {
    expect(() => sanitizeSvg('<!DOCTYPE x [<!ENTITY a "b">]><svg></svg>')).toThrow();
  });

  it('identifie le type par signature binaire', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(sniffImage(toPng(composeLogo(spec()).svg, 16))).toBe('png');
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
  });

  it('extrait la palette d’un SVG', () => {
    expect(
      svgPalette(
        '<svg><rect fill="#0E7C66"/><rect fill="#0e7c66"/><path stroke="#F2A541"/><rect fill="#fff"/></svg>',
      ),
    ).toEqual(['#0E7C66', '#F2A541']);
  });
});

describe('fournisseur factice (moteur A)', () => {
  const input = logoGenerationInputSchema.parse({
    text: 'Jeunesse Verte',
    acronym: 'AJV',
    entityType: 'ASSOCIATION',
    brief: {
      sector: 'Environnement',
      mission: 'Planter des arbres avec les jeunes',
      values: ['écologie', 'solidarité'],
    },
    types: ['ICON_TEXT', 'MONOGRAM', 'WORDMARK', 'EMBLEM'],
    style: 'AFRICAN',
  });

  it('produit des spécifications valides et rendables, avec des icônes pertinentes', () => {
    const { logos } = generatedLogosSchema.parse({ logos: mockComposeLogos(input, 8) });
    expect(logos).toHaveLength(8);
    for (const l of logos) expect(() => composeLogo(l)).not.toThrow();
    const icons = logos.map((l) => l.icon?.id).filter(Boolean);
    expect(
      icons.some((i) => ['leaf', 'trees', 'recycle', 'heart-handshake', 'tree'].includes(i!)),
    ).toBe(true);
  });

  it('« mêmes couleurs » reprend la palette de référence', () => {
    const reference = spec({
      colors: { primary: '#AA0000', secondary: '#00AA00', text: '#111111' },
    });
    const logos = mockComposeLogos({ ...input, feedback: 'mêmes couleurs', reference }, 4);
    expect(logos.every((l) => l.colors.primary === '#AA0000')).toBe(true);
  });
});
