import { z } from 'zod';
import { HEX_COLOR, type LogoColors } from './color';
import { isLibraryFont } from './fonts';
import { getIcon } from './icons';

// Spécification déclarative d'un logo (LogoVersion.spec), partagée avec l'éditeur du front
// (type LogoSpec de src/lib/types.ts) : le serveur la valide puis en tire le SVG.

export const LOGO_TYPES = ['WORDMARK', 'MONOGRAM', 'ICON_TEXT', 'EMBLEM'] as const;
export const LOGO_STYLES = [
  'MINIMAL',
  'MODERN',
  'CLASSIC',
  'INSTITUTIONAL',
  'PLAYFUL',
  'AFRICAN',
] as const;
export const LOGO_LAYOUTS = ['horizontal', 'vertical', 'icon', 'text'] as const;
export const ICON_FRAMES = ['none', 'circle', 'rounded', 'hexagon'] as const;

export type LogoType = (typeof LOGO_TYPES)[number];
export type LogoLayout = (typeof LOGO_LAYOUTS)[number];
export type IconFrame = (typeof ICON_FRAMES)[number];

const hex = z
  .string()
  .regex(HEX_COLOR, 'Couleur attendue au format #rrggbb')
  .transform((v) => v.toLowerCase());

export const logoColorsSchema = z.object({
  primary: hex,
  secondary: hex,
  text: hex,
  background: hex,
});

export const logoSpecSchema = z.object({
  type: z.enum(LOGO_TYPES),
  text: z.string().trim().min(1).max(40),
  tagline: z.string().trim().max(60).default(''),
  fontId: z.string().refine(isLibraryFont, 'Police absente de la bibliothèque'),
  fontWeight: z.number().int().min(100).max(1000),
  letterSpacing: z.number().min(-0.1).max(0.5),
  uppercase: z.boolean(),
  iconId: z
    .string()
    .nullable()
    .refine((id) => id === null || !!getIcon(id), 'Icône absente de la bibliothèque'),
  iconScale: z.number().min(0.5).max(1.5),
  iconFrame: z.enum(ICON_FRAMES),
  layout: z.enum(LOGO_LAYOUTS),
  colors: logoColorsSchema,
});

export type LogoSpec = z.infer<typeof logoSpecSchema> & { colors: LogoColors };

export const DEFAULT_SPEC: LogoSpec = {
  type: 'ICON_TEXT',
  text: 'Ma marque',
  tagline: '',
  fontId: 'montserrat',
  fontWeight: 700,
  letterSpacing: 0,
  uppercase: false,
  iconId: 'leaf',
  iconScale: 1,
  iconFrame: 'circle',
  layout: 'horizontal',
  colors: { primary: '#0f766e', secondary: '#f59e0b', text: '#0f172a', background: '#ffffff' },
};
