import { readableOn } from './color';

// Composition de visuels de marque : des SVG de logo intégrés dans une image plus grande (kit
// réseaux sociaux, mises en situation). Même module côté front (src/lib/render/compose.ts).

export interface BrandAsset {
  svg: string;
  width: number;
  height: number;
}

export interface BrandAssets {
  /** Logo complet (disposition horizontale de préférence), en couleur, en blanc et en noir. */
  logo: { color: BrandAsset; white: BrandAsset; black: BrandAsset };
  /** Symbole seul, en couleur, en blanc et en noir. */
  mark: { color: BrandAsset; white: BrandAsset; black: BrandAsset };
  colors: { primary: string; secondary: string; background: string };
  /** Graine des motifs : même marque, mêmes visuels. */
  name: string;
}

export const n = (value: number) => Number(value.toFixed(2));

/** Identifiants d'un SVG intégré préfixés : plusieurs SVG cohabitent sans conflit. */
export function prefixIds(svg: string, prefix: string) {
  return svg
    .replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`)
    .replace(
      /(xlink:)?href="#([^"]+)"/g,
      (_m, xlink: string | undefined, id: string) => `${xlink ?? ''}href="#${prefix}${id}"`,
    );
}

/** SVG placé dans un rectangle, centré, proportions conservées. */
export function place(
  asset: BrandAsset,
  x: number,
  y: number,
  width: number,
  height: number,
  prefix: string,
) {
  const scale = Math.min(width / asset.width, height / asset.height);
  const w = asset.width * scale;
  const h = asset.height * scale;
  return prefixIds(asset.svg, prefix)
    .replace(/^<\?xml[^>]*>\s*/, '')
    .replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
      const kept = attrs.replace(/\s(x|y|width|height)="[^"]*"/g, '');
      const viewBox = /viewBox=/.test(kept) ? '' : ` viewBox="0 0 ${asset.width} ${asset.height}"`;
      return `<svg${kept}${viewBox} x="${n(x + (width - w) / 2)}" y="${n(y + (height - h) / 2)}" width="${n(w)}" height="${n(h)}">`;
    });
}

export function wrap(width: number, height: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
}

/** Logo ou symbole lisible sur un aplat de la couleur principale : blanc si elle est foncée, noir sinon. */
export function onPrimary(assets: BrandAssets, kind: 'logo' | 'mark') {
  return readableOn(assets.colors.primary) === '#ffffff' ? assets[kind].white : assets[kind].black;
}
