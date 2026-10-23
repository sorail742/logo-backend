import { z } from 'zod';
import { HEX_COLOR } from './color';
import { isLibraryFont } from './fonts';
import { ADJUST_RANGES } from './photo';

// Document du Studio de création (même contrat que le front, src/lib/studio/types.ts) : pages,
// éléments positionnés en px dans le repère de la page, rotation autour du centre.

export const MAX_PAGES = 30;
export const MAX_ELEMENTS_PER_PAGE = 300;
/** Taille d'une image intégrée (data URL), réduite par l'éditeur à l'import. */
export const MAX_IMAGE_BYTES = 4_000_000;
/** Taille d'un SVG intégré (logo, cachet, illustration). */
export const MAX_SVG_BYTES = 500_000;
/** Taille maximale d'un document sérialisé. */
export const MAX_DOC_BYTES = 14_000_000;

const color = z.string().regex(HEX_COLOR, 'Couleur attendue au format #rrggbb');
const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const coord = num(-100_000, 100_000);
const size = num(0.1, 100_000);

const stop = z.object({ offset: num(0, 1), color });
export const paintSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('solid'), color }),
  z.object({
    type: z.literal('linear'),
    angle: num(-360, 360),
    stops: z.array(stop).min(2).max(8),
  }),
  z.object({ type: z.literal('radial'), stops: z.array(stop).min(2).max(8) }),
]);
export type Paint = z.infer<typeof paintSchema>;

const strokeSchema = z.object({
  color,
  width: num(0, 1000),
  dash: z.enum(['solid', 'dashed', 'dotted']).optional(),
});
export type Stroke = z.infer<typeof strokeSchema>;

const shadowSchema = z.object({
  x: num(-2000, 2000),
  y: num(-2000, 2000),
  blur: num(0, 1000),
  color,
  opacity: num(0, 1),
});
export type Shadow = z.infer<typeof shadowSchema>;

/** Modes de fusion des calques (mix-blend-mode CSS, rendus aussi par resvg). */
export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

const base = {
  id: z.string().regex(/^[\w-]{1,40}$/),
  name: z.string().max(120).optional(),
  role: z
    .enum(['background', 'title', 'subtitle', 'body', 'logo', 'cta', 'photo', 'decor', 'info'])
    .optional(),
  x: coord,
  y: coord,
  width: size,
  height: size,
  rotation: num(-3600, 3600),
  opacity: num(0, 1),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  shadow: shadowSchema.nullable().optional(),
  blend: z.enum(BLEND_MODES).optional(),
};

const textSchema = z.object({
  ...base,
  type: z.literal('text'),
  text: z.string().max(5000),
  fontId: z.string().refine(isLibraryFont, 'Police absente de la bibliothèque'),
  fontWeight: num(100, 1000),
  fontSize: num(1, 5000),
  letterSpacing: num(-0.5, 2),
  lineHeight: num(0.5, 4),
  align: z.enum(['left', 'center', 'right']),
  uppercase: z.boolean(),
  fill: paintSchema,
  stroke: strokeSchema.nullable().optional(),
  curve: num(-100, 100).optional(),
  highlight: z
    .object({ color, padding: num(0, 1000), radius: num(0, 1000) })
    .nullable()
    .optional(),
  lines: z.array(z.string().max(5000)).max(500).optional(),
});

const shapeSchema = z.object({
  ...base,
  type: z.literal('shape'),
  shape: z.enum([
    'rect',
    'ellipse',
    'triangle',
    'polygon',
    'star',
    'line',
    'arrow',
    'blob',
    'arch',
  ]),
  fill: paintSchema,
  stroke: strokeSchema.nullable().optional(),
  radius: num(0, 100_000).optional(),
  sides: z.number().int().min(3).max(24).optional(),
  innerRatio: num(0.1, 0.95).optional(),
  seed: z.number().int().min(0).max(1_000_000).optional(),
});

const iconNode = z
  .array(
    z.tuple([
      z.enum(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']),
      z.record(z.string(), z.string().max(4000)),
    ]),
  )
  .max(40);

const iconSchema = z.object({
  ...base,
  type: z.literal('icon'),
  iconId: z.string().max(80),
  node: iconNode,
  color,
  strokeWidth: num(0.1, 12),
});

const IMAGE_DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

const curve = z.array(z.object({ x: num(0, 1), y: num(0, 1) })).max(16);
/** Réglages de retouche (src/render/photo.ts) : chaque valeur dans sa plage. */
const adjustSchema = z.object({
  ...(Object.fromEntries(
    Object.entries(ADJUST_RANGES).map(([key, [min, max]]) => [key, num(min, max).optional()]),
  ) as Record<keyof typeof ADJUST_RANGES, z.ZodOptional<z.ZodNumber>>),
  tone: z.enum(['color', 'mono', 'sepia', 'duotone']).optional(),
  duotone: z.tuple([color, color]).optional(),
  invert: z.boolean().optional(),
  curves: z
    .object({
      rgb: curve.optional(),
      r: curve.optional(),
      g: curve.optional(),
      b: curve.optional(),
    })
    .optional(),
});
export type ImageAdjust = z.infer<typeof adjustSchema>;

const cropSchema = z
  .object({ x: num(0, 1), y: num(0, 1), width: num(0.01, 1), height: num(0.01, 1) })
  .refine((c) => c.x + c.width <= 1.0001 && c.y + c.height <= 1.0001, 'Recadrage hors de l’image');
const imageSchema = z.object({
  ...base,
  type: z.literal('image'),
  src: z
    .string()
    .max(MAX_IMAGE_BYTES * 1.4)
    .regex(IMAGE_DATA_URL, 'Image attendue en PNG ou JPEG intégré'),
  naturalWidth: size,
  naturalHeight: size,
  fit: z.enum(['cover', 'contain']),
  focusX: num(0, 1).optional(),
  focusY: num(0, 1).optional(),
  mask: z.enum(['none', 'circle', 'rounded', 'arch', 'blob']),
  radius: num(0, 100_000).optional(),
  filters: z
    .object({
      brightness: num(0, 3),
      contrast: num(0, 3),
      saturation: num(0, 3),
      blur: num(0, 200),
    })
    .optional(),
  adjust: adjustSchema.optional(),
  crop: cropSchema.nullable().optional(),
  straighten: num(-45, 45).optional(),
  /** Masque de détourage (PNG en niveaux de gris, blanc = visible), aligné sur l'image entière. */
  cutout: z
    .string()
    .max(MAX_IMAGE_BYTES * 1.4)
    .regex(PNG_DATA_URL, 'Masque attendu en PNG intégré')
    .nullable()
    .optional(),
  outline: z
    .object({ color, width: num(0, 500) })
    .nullable()
    .optional(),
  glow: z
    .object({ color, size: num(0, 500), opacity: num(0, 1) })
    .nullable()
    .optional(),
});

const svgSchema = z.object({
  ...base,
  type: z.literal('svg'),
  svg: z.string().max(MAX_SVG_BYTES),
  source: z.enum(['logo', 'stamp', 'graphic']),
});

export const elementSchema = z.discriminatedUnion('type', [
  textSchema,
  shapeSchema,
  iconSchema,
  imageSchema,
  svgSchema,
]);

export const pageSchema = z.object({
  id: z.string().regex(/^[\w-]{1,40}$/),
  name: z.string().max(120).optional(),
  background: paintSchema,
  elements: z.array(elementSchema).max(MAX_ELEMENTS_PER_PAGE),
});

export const designDocSchema = z.object({
  version: z.literal(1),
  width: num(16, 20_000),
  height: num(16, 20_000),
  print: z
    .object({ widthMm: num(10, 5000), heightMm: num(10, 5000), bleedMm: num(0, 20) })
    .nullable()
    .optional(),
  pages: z.array(pageSchema).min(1).max(MAX_PAGES),
});

export type DesignDoc = z.infer<typeof designDocSchema>;
export type DesignPage = z.infer<typeof pageSchema>;
export type DesignElement = z.infer<typeof elementSchema>;
export type TextElement = z.infer<typeof textSchema>;
export type ShapeElement = z.infer<typeof shapeSchema>;
export type ImageElement = z.infer<typeof imageSchema>;
export type SvgElement = z.infer<typeof svgSchema>;
export type IconElement = z.infer<typeof iconSchema>;
