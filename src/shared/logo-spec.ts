import { z } from 'zod';

/**
 * Spécification d'un logo (LogoVersion.spec) : source unique du rendu SVG.
 * Produite par l'IA (moteur A, §5.1), modifiée par l'éditeur (LOGO-10 à LOGO-12),
 * puis rendue côté serveur (aperçu, variantes, exports).
 */
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur HEX attendue (#RRGGBB)');

export const LOGO_LAYOUTS = ['horizontal', 'vertical', 'icon', 'text'] as const;
export const ICON_CONTAINERS = ['none', 'circle', 'rounded', 'hexagon'] as const;
export const EMBLEM_SHAPES = ['circle', 'shield', 'badge'] as const;

export const logoSpecSchema = z.object({
  type: z.enum(['WORDMARK', 'MONOGRAM', 'ICON_TEXT', 'EMBLEM']),
  layout: z.enum(LOGO_LAYOUTS),
  text: z.string().trim().min(1).max(40),
  /** Sigle (monogramme, emblème) ; à défaut, initiales du texte. */
  acronym: z.string().trim().max(6).nullish(),
  tagline: z.string().trim().max(80).nullish(),
  font: z.object({
    id: z.string().min(1),
    weight: z.number().int().min(100).max(900).default(700),
  }),
  taglineFont: z.object({ id: z.string().min(1), weight: z.number().int().default(400) }).nullish(),
  /** Espacement des lettres en fraction de la taille de police (LOGO-10). */
  letterSpacing: z.number().min(-0.1).max(0.5).default(0),
  uppercase: z.boolean().default(false),
  colors: z.object({
    primary: hex,
    secondary: hex.nullish(),
    text: hex,
    /** Fond de présentation ; absent = transparent. */
    background: hex.nullish(),
  }),
  icon: z
    .object({
      id: z.string().min(1),
      container: z.enum(ICON_CONTAINERS).default('none'),
      /** Taille de l'icône relative à la hauteur du texte. */
      scale: z.number().min(0.5).max(3).default(1.4),
    })
    .nullish(),
  emblem: z.object({ shape: z.enum(EMBLEM_SHAPES) }).nullish(),
});

export type LogoSpec = z.infer<typeof logoSpecSchema>;
export type LogoSpecInput = z.input<typeof logoSpecSchema>;

/** Entrée de génération d'un lot de logos (GenerationJob.input). */
export const logoGenerationInputSchema = z.object({
  text: z.string().min(1).max(40),
  acronym: z.string().max(12).nullish(),
  /** Signature sous le nom (facultative). */
  tagline: z.string().max(80).nullish(),
  entityType: z.string(),
  brief: z.object({
    sector: z.string(),
    mission: z.string(),
    values: z.array(z.string()),
    tone: z.string().nullish(),
  }),
  types: z.array(z.enum(['WORDMARK', 'MONOGRAM', 'ICON_TEXT', 'EMBLEM'])).min(1),
  style: z.enum(['MINIMALIST', 'MODERN', 'CLASSIC', 'INSTITUTIONAL', 'PLAYFUL', 'AFRICAN']),
  palette: z.array(hex).min(2).max(4).nullish(),
  count: z.number().int().min(1).max(12).default(8),
  /** Retour : « plus simple », « autre icône », « mêmes couleurs » (LOGO-06). */
  feedback: z.string().max(200).nullish(),
  /** Spécification de référence pour une relance « dans le même esprit ». */
  reference: logoSpecSchema.nullish(),
  /** Icônes déjà proposées dans le projet, à éviter si possible. */
  avoidIcons: z.array(z.string()).default([]),
});
export type LogoGenerationInput = z.infer<typeof logoGenerationInputSchema>;

export const generatedLogosSchema = z.object({ logos: z.array(logoSpecSchema).min(1).max(20) });
