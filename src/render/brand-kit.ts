import { hexToRgb, normalizeHex, type LogoColors } from './color';
import { FALLBACK_FONT, getFont } from './fonts';
import { renderLogoSvg, type LogoVariant } from './logo';
import type { LogoSource } from './logo-assets';
import type { LogoLayout } from './logo-spec';
import { recolorSvg } from './svg';

// Contenu d'un kit de marque (§7.1) : palette, typographies et logo d'une version figée,
// partagés par la page du kit, la charte PDF, l'archive ZIP et les supports imprimables.

export type PaletteRole = 'primary' | 'secondary' | 'text' | 'background';

export interface KitPaletteColor {
  hex: string;
  /** « 15, 118, 110 » */
  rgb: string;
  /** « 87, 0, 7, 54 » (conversion indicative, sans profil ICC) */
  cmyk: string;
  role: PaletteRole;
}

export interface KitFont {
  id: string;
  name: string;
  license: string;
}

/** Instantané figé à la création d'une version (BrandKit.content). */
export interface KitContent {
  name: string;
  acronym: string | null;
  meaning: string | null;
  entityType: string;
  slogan: string | null;
  devise: string | null;
  mission: string | null;
}

export const PALETTE_ROLE_LABELS: Record<PaletteRole, string> = {
  primary: 'Principale',
  secondary: 'Secondaire',
  text: 'Texte',
  background: 'Fond',
};

export const OFL = 'SIL Open Font License 1.1';

export function hexToCmyk(hex: string): [number, number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return [0, 0, 0, 100];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((v) =>
    Math.round(v * 100),
  ) as [number, number, number, number];
}

/** Couleur de la palette, mêmes formats que le front (KIT-01). */
export function paletteColor(hex: string, role: PaletteRole): KitPaletteColor {
  return {
    hex: normalizeHex(hex).toUpperCase(),
    rgb: hexToRgb(hex).join(', '),
    cmyk: hexToCmyk(hex).join(', '),
    role,
  };
}

export function kitPalette(colors: LogoColors): KitPaletteColor[] {
  return (['primary', 'secondary', 'text', 'background'] as const).map((role) =>
    paletteColor(colors[role], role),
  );
}

/** Polices du kit : celle du nom (logo composé), puis celle du slogan et des textes. */
export function kitFonts(source: LogoSource): KitFont[] {
  const ids = source.kind === 'spec' ? [source.spec.fontId, FALLBACK_FONT] : [FALLBACK_FONT];
  return [...new Set(ids)].map((id) => {
    const font = getFont(id);
    return { id: font.id, name: font.name, license: OFL };
  });
}

/** Couleurs de la marque : celles de la spec (logo importé : palette extraite à l'import). */
export function sourceColors(source: LogoSource, fallback: LogoColors): LogoColors {
  return source.kind === 'spec' ? source.spec.colors : fallback;
}

/** SVG du logo pour une variante et une disposition, toujours sans fond. */
export function logoSvg(
  source: LogoSource,
  options: { variant?: LogoVariant; layout?: LogoLayout } = {},
) {
  const variant = options.variant ?? 'color';
  if (source.kind === 'spec') {
    return renderLogoSvg(source.spec, { variant, layout: options.layout, withBackground: false })
      .svg;
  }
  if (variant === 'color') return source.svg;
  return recolorSvg(source.svg, variant === 'black' ? '#111111' : '#ffffff');
}
