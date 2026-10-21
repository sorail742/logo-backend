import { MockAiProvider } from '../modules/ai/providers/mock.provider';
import { imageGenerationInputSchema } from '../shared/ai-schemas';
import { ARTWORK_STYLES, hashSeed, renderArtwork, styleFromPrompt } from './artwork';
import { svgToPng } from './raster';

const palette = ['#0f6b5c', '#f2b705', '#14281d', '#f6fbf4'];

describe('visuels génératifs du Studio', () => {
  it('rend chaque style en SVG valide et tramable, aux dimensions demandées', () => {
    for (const style of ARTWORK_STYLES) {
      const svg = renderArtwork({ style, palette, width: 320, height: 400, seed: 42 });
      expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 320 400"/);
      expect(svgToPng(svg, { size: 160 }).subarray(1, 4).toString()).toBe('PNG');
    }
  });

  it('est déterministe : même graine, même image ; autre graine, autre image', () => {
    const a = renderArtwork({ style: 'wax', palette, width: 200, height: 200, seed: hashSeed('fête') });
    const b = renderArtwork({ style: 'wax', palette, width: 200, height: 200, seed: hashSeed('fête') });
    const c = renderArtwork({ style: 'wax', palette, width: 200, height: 200, seed: hashSeed('fêtes') });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('suggère un style à partir de la description', () => {
    expect(styleFromPrompt('Motif de pagne pour un défilé')).toBe('wax');
    expect(styleFromPrompt('Campagne sur l’eau potable')).toBe('waves');
    expect(styleFromPrompt('Une affiche sobre')).toBeNull();
  });

  it('fournisseur de démonstration : 4 PNG au format portrait, marqués comme démonstration', async () => {
    const input = imageGenerationInputSchema.parse({
      prompt: 'Fond festif pour un festival',
      style: 'auto',
      aspect: 'portrait',
      palette,
      count: 4,
    });
    const result = await new MockAiProvider().generateImages(input);
    expect(result.demo).toBe(true);
    expect(result.images).toHaveLength(4);
    expect(result.images[0]).toMatchObject({ width: 1280, height: 1600 });
    expect(result.images[0].data.subarray(1, 4).toString()).toBe('PNG');
    expect(result.images[0].data.equals(result.images[1].data)).toBe(false);
  });
});
