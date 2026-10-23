import { Resvg } from '@resvg/resvg-js';
import { renderDesignPage, pageNeedsRaster } from './design';
import { designDocSchema, type DesignDoc, type ImageElement } from './design-doc';
import {
  adjustFilter,
  curveFunction,
  effectsFilter,
  isNeutral,
  lightTable,
  LUT_SIZE,
  PHOTO_PRESETS,
  photoPlacement,
  toneTables,
} from './photo';
import { svgToPng } from './raster';

const W = 64;
const H = 48;

/** Image unie (PNG) produite par resvg. */
function solid(color: string, width = W, height = H) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`;
  return `data:image/png;base64,${svgToPng(svg, { size: Math.max(width, height) }).toString('base64')}`;
}

function photo(patch: Partial<ImageElement> = {}): ImageElement {
  return {
    id: 'photo',
    type: 'image',
    x: 0,
    y: 0,
    width: W,
    height: H,
    rotation: 0,
    opacity: 1,
    src: solid('#cc3322'),
    naturalWidth: W,
    naturalHeight: H,
    fit: 'cover',
    mask: 'none',
    ...patch,
  };
}

function page(el: ImageElement): DesignDoc {
  return {
    version: 1,
    width: W,
    height: H,
    pages: [{ id: 'p', background: { type: 'solid', color: '#ffffff' }, elements: [el] }],
  };
}

/** Couleur du pixel (x, y) de la page rendue. */
function pixel(el: ImageElement, x = W / 2, y = H / 2) {
  const image = new Resvg(renderDesignPage(page(el), 0), {
    font: { loadSystemFonts: false },
  }).render();
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [...image.pixels.subarray(i, i + 3)];
}

describe('retouche photo', () => {
  it('courbes monotones passant par leurs points', () => {
    const curve = curveFunction([
      { x: 0, y: 0 },
      { x: 0.25, y: 0.1 },
      { x: 0.75, y: 0.95 },
      { x: 1, y: 1 },
    ]);
    expect(curve(0.25)).toBeCloseTo(0.1, 5);
    expect(curve(0.75)).toBeCloseTo(0.95, 5);
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const y = curve(i / 100);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(y).toBeLessThanOrEqual(1);
      previous = y;
    }
    expect(curveFunction(undefined)(0.4)).toBe(0.4);
  });

  it('réglages neutres : aucun filtre', () => {
    expect(isNeutral({})).toBe(true);
    expect(isNeutral({ tone: 'color', exposure: 0 })).toBe(true);
    expect(adjustFilter('f', {}, 100)).toBeNull();
    expect(toneTables({})).toBeNull();
    expect(lightTable({})).toBeNull();
    expect(isNeutral({ curves: { rgb: [{ x: 0, y: 0.1 }] } })).toBe(false);
  });

  it('tables de tons croissantes, exposition qui éclaircit', () => {
    const tables = toneTables({ exposure: 1, contrast: 40, fade: 20 })!;
    expect(tables.r).toHaveLength(LUT_SIZE);
    for (let i = 1; i < LUT_SIZE; i++) expect(tables.r[i]).toBeGreaterThanOrEqual(tables.r[i - 1]);
    expect(tables.r[16]).toBeGreaterThan(16 / (LUT_SIZE - 1));
  });

  it('rendu serveur fidèle : négatif, noir et blanc, exposition, ombres sans virage', () => {
    expect(pixel(photo())).toEqual([204, 51, 34]);
    const [r, g, b] = pixel(photo({ adjust: { invert: true } }));
    expect([r, g, b].map((v) => Math.round(v / 4))).toEqual([13, 51, 55]);
    const mono = pixel(photo({ adjust: { tone: 'mono' } }));
    expect(Math.max(...mono) - Math.min(...mono)).toBeLessThanOrEqual(1);
    const bright = pixel(photo({ adjust: { exposure: 1 } }));
    expect(bright[0]).toBeGreaterThan(240);
    // Ombres relevées sur un gris : la couleur reste neutre.
    const gray = pixel(photo({ src: solid('#404040'), adjust: { shadows: 80 } }));
    expect(gray[0]).toBeGreaterThan(70);
    expect(Math.max(...gray) - Math.min(...gray)).toBeLessThanOrEqual(2);
  });

  it('flou et netteté sans halo sur les bords de l’image', () => {
    const blurred = photo({ adjust: { blur: 20, sharpen: 100 } });
    for (const [x, y] of [
      [0, 0],
      [W - 1, H - 1],
      [W / 2, 0],
    ]) {
      const [r, g, b] = pixel(blurred, x, y);
      // Sans normalisation, un coin flou tirerait vers le blanc du fond (écart > 300) ; il ne reste
      // que l'arrondi des calculs sur 8 bits.
      expect(Math.abs(r - 204) + Math.abs(g - 51) + Math.abs(b - 34)).toBeLessThanOrEqual(24);
    }
  });

  it('détourage : masque appliqué, contour autour de la forme visible', () => {
    const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#000"/><rect x="16" y="12" width="32" height="24" fill="#fff"/></svg>`;
    const cutout = `data:image/png;base64,${svgToPng(mask, { size: W, background: '#000000' }).toString('base64')}`;
    expect(pixel(photo({ cutout }), 4, 4)).toEqual([255, 255, 255]);
    expect(pixel(photo({ cutout }))).toEqual([204, 51, 34]);
    const outlined = photo({ cutout, outline: { color: '#0000ff', width: 3 } });
    const edge = pixel(outlined, 14, 24);
    expect(edge[2]).toBeGreaterThan(200);
    expect(edge[0]).toBeLessThan(60);
  });

  it('recadrage et redressement : le cadre reste couvert', () => {
    const cropped = photoPlacement({
      width: 100,
      height: 100,
      naturalWidth: 400,
      naturalHeight: 200,
      fit: 'cover',
      crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
    });
    expect(cropped.region).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(cropped.image.x).toBe(-100);
    expect(cropped.image.width).toBe(200);

    const tilted = photoPlacement({
      width: 300,
      height: 200,
      naturalWidth: 300,
      naturalHeight: 200,
      fit: 'cover',
      straighten: 10,
    });
    // Agrandissement minimal pour une image aux proportions du cadre : cos θ + sin θ × rapport.
    const a = (10 * Math.PI) / 180;
    expect(tilted.zoom).toBeCloseTo(Math.cos(a) + Math.sin(a) * 1.5, 3);
  });

  it('effets : région de filtre explicite autour de la forme', () => {
    const filter = effectsFilter(
      'fx',
      { color: '#fff', width: 6 },
      { color: '#f00', size: 10, opacity: 0.5 },
      {
        width: 200,
        height: 100,
      },
    )!;
    expect(filter).toContain('filterUnits="userSpaceOnUse"');
    expect(filter).toContain('feMorphology');
    expect(effectsFilter('fx', null, null, { width: 1, height: 1 })).toBeNull();
  });

  it('préréglages : tous valides et tous rendus', () => {
    for (const preset of PHOTO_PRESETS) {
      const el = photo({ adjust: preset.adjust });
      expect(designDocSchema.safeParse(page(el)).success).toBe(true);
      expect(() => renderDesignPage(page(el), 0)).not.toThrow();
    }
  });

  it('schéma : bornes, recadrage dans l’image, masque PNG', () => {
    const ok = photo({
      adjust: {
        exposure: 1.5,
        curves: { rgb: [{ x: 0.5, y: 0.6 }] },
        duotone: ['#000000', '#ffffff'],
      },
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      straighten: -12,
      blend: 'luminosity',
      outline: { color: '#ffffff', width: 4 },
    });
    expect(designDocSchema.safeParse(page(ok)).success).toBe(true);
    const bad = [
      photo({ adjust: { exposure: 5 } }),
      photo({ crop: { x: 0.5, y: 0, width: 0.8, height: 1 } }),
      photo({ straighten: 60 }),
      photo({ cutout: solid('#000').replace('image/png', 'image/jpeg') }),
    ];
    for (const el of bad) expect(designDocSchema.safeParse(page(el)).success).toBe(false);
  });

  it('PDF : une photo retouchée fait tramer la page', () => {
    expect(pageNeedsRaster(page(photo()).pages[0])).toBe(false);
    expect(pageNeedsRaster(page(photo({ adjust: { contrast: 10 } })).pages[0])).toBe(true);
    expect(
      pageNeedsRaster(page(photo({ crop: { x: 0, y: 0, width: 0.5, height: 1 } })).pages[0]),
    ).toBe(false);
  });
});
