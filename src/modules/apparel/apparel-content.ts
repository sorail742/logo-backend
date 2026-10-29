import { z } from 'zod';
import { invalidInput, type FieldErrors } from '../../common/validation/validation-problem';
import { HEX_COLOR } from '../../render/color';
import {
  adjustSchema,
  cropSchema,
  IMAGE_DATA_URL,
  MAX_IMAGE_BYTES,
  MAX_SVG_BYTES,
  PNG_DATA_URL,
} from '../../render/design-doc';
import { isLibraryFont } from '../../render/fonts';
import { textEffectsSchema } from '../../render/lettering';
import { sanitizeSvg } from '../../render/svg';

// Contenu d'un élément textile (même contrat que le front, src/lib/apparel/types.ts) : liste
// blanche des champs, valeurs bornées, logo SVG nettoyé et photos intégrées seulement. Le contenu
// est renvoyé tel quel sur le BAT public : rien d'autre n'y est enregistré.

const color = z.string().regex(HEX_COLOR, 'Couleur au format #RRGGBB attendue');
const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const dataUrl = (pattern: RegExp, message: string) =>
  z
    .string()
    .max(MAX_IMAGE_BYTES * 1.4)
    .regex(pattern, message);

const photoFields = {
  src: dataUrl(IMAGE_DATA_URL, 'Image attendue en PNG ou JPEG intégré'),
  naturalWidth: num(1, 20_000),
  naturalHeight: num(1, 20_000),
  adjust: adjustSchema.optional(),
  crop: cropSchema.nullable().optional(),
  straighten: num(-45, 45).optional(),
  cutout: dataUrl(PNG_DATA_URL, 'Masque attendu en PNG intégré').nullable().optional(),
  outline: z
    .object({ color, width: num(0, 500) })
    .nullable()
    .optional(),
  glow: z
    .object({ color, size: num(0, 500), opacity: num(0, 1) })
    .nullable()
    .optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
};

const photoSchema = z.object({ ...photoFields, original: z.object(photoFields).optional() });

export const apparelContentSchema = z.object({
  colors: z.array(color).max(16).optional(),
  edgeColors: z.array(color).max(4).optional(),
  source: z.enum(['library', 'brand-kit', 'upload']).optional(),
  rightsAttested: z.boolean().optional(),
  strokeMm: num(0, 1000).optional(),
  gradient: z.boolean().optional(),
  pixelWidth: z.number().int().min(0).max(100_000).optional(),
  style: z.string().max(40).optional(),
  svg: z.string().max(MAX_SVG_BYTES).optional(),
  logoId: z.string().uuid().optional(),
  logoVariant: z.string().max(40).optional(),
  assetId: z.string().uuid().optional(),
  text: z.string().max(200).optional(),
  fontId: z.string().refine(isLibraryFont, 'Police hors bibliothèque').optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  fill: color.optional(),
  textOutline: z
    .object({ color, widthMm: num(0, 50) })
    .nullable()
    .optional(),
  curve: num(-100, 100).optional(),
  letterSpacing: num(-0.5, 2).optional(),
  /** Forme du lettrage (second contour, liseré, relief, trame), en mm. */
  effects: textEffectsSchema.nullable().optional(),
  photo: photoSchema.optional(),
  spotColors: z.number().int().min(1).max(16).optional(),
});

export type ApparelContent = z.infer<typeof apparelContentSchema>;

/**
 * Contenus validés et nettoyés, dans l'ordre des éléments. Les champs inconnus sont retirés ;
 * une valeur hors contrat ou un SVG inexploitable refuse l'enregistrement (400, par champ).
 */
export function parseElementContents(contents: unknown[]): ApparelContent[] {
  const fields: FieldErrors = {};
  const parsed = contents.map((raw, i) => {
    const prefix = `elements.${i}.content`;
    const result = apparelContentSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues.slice(0, 10)) {
        const path = [prefix, ...issue.path].join('.');
        fields[path] = [...(fields[path] ?? []), issue.message];
      }
      return {};
    }
    const content = result.data;
    if (content.svg !== undefined) {
      const clean = sanitizeSvg(content.svg);
      if (clean) content.svg = clean;
      else fields[`${prefix}.svg`] = ['Logo SVG non pris en charge'];
    }
    return content;
  });
  if (Object.keys(fields).length) throw invalidInput(fields, 'Contenu d’élément invalide');
  return parsed;
}
