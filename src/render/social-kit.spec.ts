import { renderLogoSvg } from './logo';
import { DEFAULT_SPEC, type LogoSpec } from './logo-spec';
import { svgToPng } from './raster';
import type { BrandAssets } from './compose';
import { SOCIAL_KIT, socialKitSvg } from './social-kit';

const spec: LogoSpec = {
  ...DEFAULT_SPEC,
  text: 'Kalossa',
  colors: { primary: '#0f6b5c', secondary: '#f2b705', text: '#14281d', background: '#f6fbf4' },
};

function brandInput(): BrandAssets {
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
    colors: spec.colors,
    name: spec.text,
  };
}

describe('kit réseaux sociaux', () => {
  it('couvre profils, bannières des réseaux et story, aux dimensions attendues', () => {
    expect(SOCIAL_KIT.map((f) => `${f.width}x${f.height}`)).toEqual([
      '1080x1080',
      '1080x1080',
      '1640x624',
      '1584x396',
      '1128x191',
      '1500x500',
      '2560x1440',
      '1080x1920',
    ]);
  });

  it('rend chaque format en SVG tramable, sans identifiant en double', () => {
    const kit = brandInput();
    for (const format of SOCIAL_KIT) {
      const svg = socialKitSvg(kit, format);
      expect(svg).toMatch(new RegExp(`^<svg [^>]*viewBox="0 0 ${format.width} ${format.height}"`));
      const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(svgToPng(svg, { size: 320 }).subarray(1, 4).toString()).toBe('PNG');
    }
  });

  it('place le logo dans la zone sûre de la bannière YouTube', () => {
    const youtube = SOCIAL_KIT.find((f) => f.id === 'youtube')!;
    const svg = socialKitSvg(brandInput(), youtube);
    const placed = [
      ...svg.matchAll(/<svg[^>]* x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g),
    ].at(-1)!;
    const [x, y, w, h] = placed.slice(1).map(Number);
    // Bande visible sur tous les appareils : 1546 × 423 px au centre.
    expect(x).toBeGreaterThanOrEqual((2560 - 1546) / 2);
    expect(x + w).toBeLessThanOrEqual((2560 + 1546) / 2);
    expect(y).toBeGreaterThanOrEqual((1440 - 423) / 2);
    expect(y + h).toBeLessThanOrEqual((1440 + 423) / 2);
  });
});
