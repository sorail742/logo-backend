import type { BrandAssets } from './compose';
import { renderLogoSvg } from './logo';
import { DEFAULT_SPEC, type LogoSpec } from './logo-spec';
import { MOCKUP_HEIGHT, MOCKUP_SCENES, MOCKUP_WIDTH, mockupSvg } from './mockups';
import { svgToJpeg } from './raster';

function assets(colors: LogoSpec['colors']): BrandAssets {
  const spec: LogoSpec = { ...DEFAULT_SPEC, text: 'Kalossa', colors };
  const icon = { ...spec, iconFrame: 'circle' as const };
  return {
    logo: {
      color: renderLogoSvg(spec, { variant: 'color', withBackground: false }),
      white: renderLogoSvg(spec, { variant: 'white', withBackground: false }),
      black: renderLogoSvg(spec, { variant: 'black' }),
    },
    mark: {
      color: renderLogoSvg(icon, { layout: 'icon' }),
      white: renderLogoSvg(icon, { layout: 'icon', variant: 'white', withBackground: false }),
      black: renderLogoSvg(icon, { layout: 'icon', variant: 'black' }),
    },
    colors: { primary: colors.primary, secondary: colors.secondary, background: colors.background },
    name: spec.text,
  };
}

const dark = assets({
  primary: '#0f6b5c',
  secondary: '#f2b705',
  text: '#14281d',
  background: '#f6fbf4',
});
const light = assets({
  primary: '#f5d76e',
  secondary: '#c0392b',
  text: '#2c1a0e',
  background: '#fffaf0',
});

describe('mises en situation', () => {
  it('huit scènes, fichiers distincts', () => {
    expect(MOCKUP_SCENES.map((s) => s.id)).toEqual([
      'storefront',
      'tshirt',
      'mugs',
      'cards',
      'phone',
      'van',
      'bags',
      'stand',
    ]);
    expect(new Set(MOCKUP_SCENES.map((s) => s.file)).size).toBe(MOCKUP_SCENES.length);
  });

  it.each(MOCKUP_SCENES.map((s) => [s.id, s] as const))(
    '%s : SVG valide, identifiants uniques, tramé en JPG',
    (_id, scene) => {
      const svg = mockupSvg(dark, scene);
      expect(svg).toContain(`viewBox="0 0 ${MOCKUP_WIDTH} ${MOCKUP_HEIGHT}"`);
      const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      const jpg = svgToJpeg(svg, { size: 400 });
      expect(jpg.subarray(0, 2).toString('hex')).toBe('ffd8');
    },
  );

  it('logo blanc sur une couleur principale foncée, noir sur une couleur claire', () => {
    const tshirt = MOCKUP_SCENES.find((s) => s.id === 'tshirt')!;
    expect(mockupSvg(dark, tshirt)).toContain('fill="#ffffff"');
    expect(mockupSvg(light, tshirt)).toContain('fill="#111111"');
  });

  it('refuse une scène inconnue', () => {
    expect(() => mockupSvg(dark, { id: 'fusee', file: 'fusee' })).toThrow('inconnue');
  });
});
