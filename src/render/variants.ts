import type { LogoSpec } from '../shared/logo-spec';
import { composeLogo, RenderedLogo } from './compose';

export const VARIANTS = ['color', 'black', 'white', 'icon', 'horizontal', 'vertical'] as const;
export type Variant = (typeof VARIANTS)[number];

function mono(spec: LogoSpec, color: string): LogoSpec {
  return {
    ...spec,
    colors: { primary: color, secondary: color, text: color, background: null },
  };
}

/** Variantes automatiques (LOGO-20) dérivées d'une même spécification. */
export function variantSpec(spec: LogoSpec, variant: Variant): LogoSpec {
  switch (variant) {
    case 'color':
      return spec;
    case 'black':
      return mono(spec, '#000000');
    case 'white':
      return mono(spec, '#FFFFFF');
    case 'icon':
      return { ...spec, layout: 'icon' };
    case 'horizontal':
      return { ...spec, layout: spec.type === 'WORDMARK' ? 'text' : 'horizontal' };
    case 'vertical':
      return { ...spec, layout: spec.type === 'WORDMARK' ? 'text' : 'vertical' };
  }
}

export function renderVariant(spec: LogoSpec, variant: Variant): RenderedLogo {
  // Noir et blanc sont des choix voulus : pas de correction de contraste.
  const monochrome = variant === 'black' || variant === 'white';
  return composeLogo(variantSpec(spec, variant), { enforceContrast: !monochrome });
}

// ─── Mises en situation (LOGO-05) ───

/** Insère un SVG rendu dans un cadre (x, y, w, h), centré et proportionné. */
function embed(logo: RenderedLogo, x: number, y: number, w: number, h: number): string {
  const inner = logo.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${logo.width} ${logo.height}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

const wrap = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

export interface Mockups {
  businessCard: string;
  darkBackground: string;
  socialAvatar: string;
  appIcon: string;
}

export function renderMockups(spec: LogoSpec): Mockups {
  const color = renderVariant({ ...spec, colors: { ...spec.colors, background: null } }, 'color');
  const white = renderVariant(spec, 'white');
  const iconWhite = renderVariant(variantSpec(spec, 'icon'), 'white');
  const brand = spec.colors.primary;

  return {
    // Carte de visite 85 × 55 mm (×10).
    businessCard: wrap(
      850,
      550,
      `<rect width="850" height="550" rx="16" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="2"/>` +
        embed(color, 125, 125, 600, 300) +
        `<rect y="530" width="850" height="20" fill="${brand}"/>`,
    ),
    darkBackground: wrap(
      800,
      450,
      `<rect width="800" height="450" fill="#111827"/>` + embed(white, 100, 75, 600, 300),
    ),
    socialAvatar: wrap(
      400,
      400,
      `<circle cx="200" cy="200" r="200" fill="${brand}"/>` + embed(iconWhite, 70, 70, 260, 260),
    ),
    appIcon: wrap(
      400,
      400,
      `<rect width="400" height="400" rx="88" fill="${brand}"/>` +
        embed(iconWhite, 60, 60, 280, 280),
    ),
  };
}

export { embed as embedSvg };
