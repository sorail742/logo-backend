import { inflateRawSync } from 'node:zlib';
import { contrastRatio, ensureContrast, extractPalette } from './color';
import { closestWeight, shapeText } from './fonts';
import { searchIcons } from './icons';
import { buildExportEntries, renderVariants } from './logo-assets';
import { initials, renderLogoSvg } from './logo';
import { DEFAULT_SPEC, logoSpecSchema, type LogoSpec } from './logo-spec';
import { svgToPdf } from './pdf';
import {
  buildIco,
  hammingDistance,
  perceptualHash,
  pngSize,
  svgToJpeg,
  svgToPixels,
  svgToPng,
} from './raster';
import { optimizeSvg, recolorSvg, sanitizeSvg, svgSize } from './svg';
import { createZip } from './zip';

const spec = (patch: Partial<LogoSpec> = {}): LogoSpec => ({
  ...DEFAULT_SPEC,
  text: 'Kalossa',
  ...patch,
});

describe('shapeText — texte en tracés', () => {
  it('mesure le texte avec les métriques réelles et l’espacement', () => {
    const tight = shapeText('Kalossa', { fontId: 'montserrat', weight: 700, size: 64 });
    const spaced = shapeText('Kalossa', {
      fontId: 'montserrat',
      weight: 700,
      size: 64,
      letterSpacing: 10,
    });
    expect(tight.width).toBeGreaterThan(200);
    expect(spaced.width).toBeCloseTo(tight.width + 60, 0);
  });

  it('centre le tracé sur le point d’ancrage', () => {
    const shaped = shapeText('AB', { fontId: 'oswald', weight: 700, size: 40 });
    const xs = [...shaped.toPath(100, 50, 'middle').matchAll(/M([\d.]+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(Math.min(...xs)).toBeGreaterThan(100 - shaped.width / 2 - 1);
    expect(Math.min(...xs)).toBeLessThan(100);
  });

  it('dessine les lettres d’Afrique de l’Ouest grâce au sous-ensemble latin étendu', () => {
    const shaped = shapeText('Ɓantal ŋ', { fontId: 'playfair', weight: 700, size: 64 });
    expect(shaped.toPath(0, 64).length).toBeGreaterThan(500);
  });

  it('choisit la graisse disponible la plus proche', () => {
    expect(closestWeight('bebas-neue', 800)).toBe(400);
    expect(closestWeight('montserrat', 750)).toBe(700);
  });
});

describe('renderLogoSvg — moteur A', () => {
  it.each(['horizontal', 'vertical', 'icon', 'text'] as const)(
    'disposition %s sans élément <text>',
    (layout) => {
      const { svg, width, height } = renderLogoSvg(spec({ layout, tagline: 'Ensemble' }));
      expect(svg).not.toContain('<text');
      expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
      expect(svg).toContain('<title>Kalossa</title>');
    },
  );

  it('dispose un emblème en badge rond et un logotype sans symbole', () => {
    const emblem = renderLogoSvg(spec({ type: 'EMBLEM' }));
    expect(emblem.width).toBe(emblem.height);
    const wordmark = renderLogoSvg(spec({ type: 'WORDMARK', layout: 'horizontal' }));
    expect(wordmark.svg).not.toContain('<circle');
  });

  it('corrige le contraste texte / fond à 4,5:1 (§5.5)', () => {
    const { svg } = renderLogoSvg(
      spec({
        colors: {
          primary: '#0f766e',
          secondary: '#f59e0b',
          text: '#dddddd',
          background: '#ffffff',
        },
      }),
    );
    const fills = [...svg.matchAll(/<path d="[^"]+" fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    expect(fills.length).toBeGreaterThan(0);
    expect(contrastRatio(fills[0], '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('ajoute le filigrane de l’offre gratuite', () => {
    expect(renderLogoSvg(spec(), { watermark: 'APERÇU' }).svg).toContain('<use href="#wm"');
  });

  it('forme les initiales du monogramme comme l’aperçu du front', () => {
    expect(initials('Kaloum Jeunesse Unie')).toBe('KJ');
    expect(initials('AS de Kaloum')).toBe('AK');
    expect(initials('Wouri Santé')).toBe('WS');
  });
});

describe('logoSpecSchema', () => {
  it('refuse une police ou une icône hors bibliothèque', () => {
    expect(logoSpecSchema.safeParse(spec({ fontId: 'comic-sans' })).success).toBe(false);
    expect(logoSpecSchema.safeParse(spec({ iconId: 'inconnue' })).success).toBe(false);
    expect(logoSpecSchema.safeParse(spec()).success).toBe(true);
  });
});

describe('couleurs', () => {
  it('assombrit une couleur trop claire', () => {
    expect(contrastRatio(ensureContrast('#fde68a', '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('extrait les couleurs dominantes en ignorant le fond blanc', () => {
    const { data } = svgToPixels(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="5" fill="#ce1126"/><rect y="5" width="10" height="5" fill="#ffffff"/></svg>',
      { size: 64 },
    );
    expect(extractPalette(data)[0]).toBe('#ce1126');
  });
});

describe('sanitizeSvg — import (§14.1)', () => {
  const evil =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="x()"><script>x()</script>' +
    '<foreignObject><iframe src="http://evil"/></foreignObject><a href="javascript:x()"><circle r="4" fill="#123456"/></a>' +
    '<image href="http://evil/p.png"/><use href="http://evil/s.svg#a"/><rect width="2" height="2" style="fill:url(http://evil);stroke:#00ff00"/></svg>';

  it('retire scripts, événements, liens et ressources externes en gardant le dessin', () => {
    const clean = sanitizeSvg(evil)!;
    expect(clean).not.toMatch(/script|onload|iframe|foreignObject|javascript|evil|<image|<use/i);
    expect(clean).toContain('<circle');
    expect(clean).toContain('stroke:#0f0');
  });

  it('refuse les DTD, le HTML et le texte quelconque', () => {
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "b">]><svg/>')).toBeNull();
    expect(sanitizeSvg('<html><body/></html>')).toBeNull();
    expect(sanitizeSvg('pas du SVG <<')).toBeNull();
  });

  it('recolore un logo importé pour les variantes noir et blanc', () => {
    const recolored = recolorSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h4v4z" fill="#ff0000" stroke="none"/></svg>',
      '#111111',
    );
    expect(recolored).toContain('fill="#111111"');
    expect(recolored).toContain('stroke="none"');
  });
});

describe('rendu matriciel et fichiers', () => {
  const { svg } = renderLogoSvg(spec());

  it('produit un PNG à la taille demandée, côté le plus long', () => {
    const size = pngSize(svgToPng(svg, { size: 1024 }))!;
    expect(Math.max(size.width, size.height)).toBe(1024);
    expect(pngSize(svgToPng(svg, { size: 180, square: true, padding: 0.08 }))).toEqual({
      width: 180,
      height: 180,
    });
  });

  it('produit un JPG', () => {
    expect(svgToJpeg(svg, { size: 256 }).subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });

  it('assemble un favicon.ico 16/32/48 (LOGO-22)', () => {
    const ico = buildIco(svg);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);
  });

  it('produit un PDF vectoriel sans police embarquée', async () => {
    const pdf = await svgToPdf(optimizeSvg(svg), { title: 'Kalossa' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).not.toContain('/FontFile');
  });

  it('écrit une archive ZIP lisible', () => {
    const zip = createZip([
      { path: 'a/LICENCES.txt', data: 'bonjour'.repeat(20) },
      { path: 'a/logo.png', data: Buffer.from([1, 2, 3]) },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const nameLength = zip.readUInt16LE(26);
    const compressed = zip.readUInt32LE(18);
    const body = zip.subarray(30 + nameLength, 30 + nameLength + compressed);
    expect(inflateRawSync(body).toString()).toBe('bonjour'.repeat(20));
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 12)).toBe(2);
  });

  it('lit la taille d’un SVG', () => {
    expect(svgSize('<svg viewBox="0 0 320 120"/>')).toEqual({ width: 320, height: 120 });
  });
});

describe('empreinte perceptuelle (§5.5)', () => {
  it('rapproche deux rendus identiques et distingue deux logos différents', () => {
    const a = perceptualHash(renderLogoSvg(spec()).svg);
    const same = perceptualHash(renderLogoSvg(spec()).svg);
    const other = perceptualHash(renderLogoSvg(spec({ type: 'EMBLEM', iconId: 'trophy' })).svg);
    expect(hammingDistance(a, same)).toBe(0);
    expect(hammingDistance(a, other)).toBeGreaterThan(10);
  });
});

describe('variantes et exports (§5.4)', () => {
  it('produit les 6 variantes d’un logo composé, 3 pour un logo importé', () => {
    expect(renderVariants({ kind: 'spec', spec: spec() }).map((v) => v.id)).toEqual([
      'color',
      'black',
      'white',
      'icon',
      'horizontal',
      'vertical',
    ]);
    const imported = {
      kind: 'svg' as const,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#123456"/></svg>',
      title: 'X',
      background: '#ffffff',
    };
    expect(renderVariants(imported).map((v) => v.id)).toEqual(['color', 'black', 'white']);
  });

  it('range un export complet : SVG, PDF, PNG, JPG, icônes d’app, réseaux sociaux, licences', async () => {
    const entries = await buildExportEntries(
      { kind: 'spec', spec: spec({ iconId: 'graduation-cap' }) },
      'kalossa',
      {
        formats: ['svg', 'pdf', 'png', 'jpg'],
        sizes: [512, 1024, 2048],
        iconPack: true,
        social: true,
        watermark: null,
      },
    );
    const paths = entries.map((e) => e.path);
    expect(paths).toHaveLength(6 * 5 + 3 + 5 + 3 + 1);
    expect(paths).toContain('kalossa/svg/kalossa-couleur.svg');
    expect(paths).toContain('kalossa/pdf/kalossa-vertical.pdf');
    expect(paths).toContain('kalossa/png/kalossa-blanc-2048.png');
    expect(paths).toContain('kalossa/jpg/kalossa-couleur-1024.jpg');
    expect(paths).toContain('kalossa/icones-app/favicon.ico');
    expect(paths).toContain('kalossa/reseaux-sociaux/linkedin-banniere-1584x396.png');
    const licences = String(entries.find((e) => e.path.endsWith('LICENCES.txt'))!.data);
    expect(licences).toMatch(/Montserrat — SIL Open Font License/);
    expect(licences).toMatch(/graduation-cap — Lucide, licence ISC/);
  });
});

describe('bibliothèque', () => {
  it('trouve une icône sans tenir compte des accents', () => {
    expect(searchIcons('ecole').map((i) => i.id)).toContain('graduation-cap');
    expect(searchIcons('').length).toBeGreaterThan(30);
  });
});
