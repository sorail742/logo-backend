import { EntityType, NameStyle } from '@prisma/client';
import { z } from 'zod';
import { HEX_COLOR } from '../render/color';
import {
  ICON_FRAMES,
  LOGO_LAYOUTS,
  LOGO_STYLES,
  LOGO_TYPES,
  logoColorsSchema,
  logoSpecSchema,
} from '../render/logo-spec';

/** Entrée de génération de noms, figée dans GenerationJob.input. */
export const nameGenerationInputSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  brief: z.object({
    sector: z.string(),
    mission: z.string(),
    values: z.array(z.string()),
    audience: z.string().nullish(),
    languages: z.array(z.string()),
    nameStyles: z.array(z.nativeEnum(NameStyle)),
    maxLength: z.number().int().nullish(),
    mustInclude: z.array(z.string()),
    mustAvoid: z.array(z.string()),
    tone: z.string().nullish(),
  }),
  count: z.number().int().min(1).max(20).default(10),
  /** Retour libre : « plus court », « plus sérieux »… (NOM-13) */
  feedback: z.string().max(200).optional(),
  /** « Plus proche de celui-ci » */
  likeName: z.string().max(60).optional(),
  /** Noms déjà proposés ou refusés, à ne pas reproposer (NOM-15). */
  exclude: z.array(z.string()).default([]),
});
export type NameGenerationInput = z.infer<typeof nameGenerationInputSchema>;

/** Sortie attendue du fournisseur IA, validée avant tout enregistrement (§11.4, §14.1). */
export const generatedNameSchema = z.object({
  value: z.string().trim().min(2).max(40),
  acronym: z.string().trim().max(12).nullish(),
  expandedForm: z.string().trim().max(160).nullish(),
  meaning: z.string().trim().min(1).max(400),
  style: z.nativeEnum(NameStyle),
  pronunciation: z.string().trim().max(80).nullish(),
});
export const generatedNamesSchema = z.object({ names: z.array(generatedNameSchema).min(1).max(30) });
export type GeneratedName = z.infer<typeof generatedNameSchema>;

/** Entrée de composition de logos, moteur A (§5.1), figée dans GenerationJob.input. */
export const logoGenerationInputSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  /** Nom retenu (ou titre du projet), repris tel quel dans chaque proposition (LOGO-04). */
  text: z.string().trim().min(1).max(40),
  /** Slogan choisi, proposé sous le nom. */
  tagline: z.string().trim().max(60).default(''),
  type: z.enum(LOGO_TYPES),
  style: z.enum(LOGO_STYLES),
  /** 2 à 4 couleurs imposées ; sinon palette proposée selon le style (LOGO-03). */
  palette: z.array(z.string().regex(HEX_COLOR)).min(2).max(4).optional(),
  brief: z
    .object({
      sector: z.string(),
      mission: z.string(),
      values: z.array(z.string()),
      mustInclude: z.array(z.string()),
    })
    .nullable(),
  count: z.number().int().min(1).max(16).default(8),
  /** Retour libre : « plus simple », « autre icône », « mêmes couleurs » (LOGO-06). */
  feedback: z.string().max(200).optional(),
  /** Proposition de référence pour une relance. */
  reference: logoSpecSchema.optional(),
});
export type LogoGenerationInput = z.infer<typeof logoGenerationInputSchema>;

/** Choix de composition renvoyé par l'IA : icône, police, palette et disposition (§5.1). */
export const logoCompositionSchema = z.object({
  iconId: z.string().nullable(),
  fontId: z.string(),
  fontWeight: z.number().int().min(100).max(1000),
  letterSpacing: z.number().min(-0.1).max(0.5),
  uppercase: z.boolean(),
  iconFrame: z.enum(ICON_FRAMES),
  layout: z.enum(LOGO_LAYOUTS),
  colors: logoColorsSchema,
  withTagline: z.boolean().default(false),
  rationale: z.string().max(300).optional(),
});
export const logoCompositionsSchema = z.object({
  compositions: z.array(logoCompositionSchema).min(1).max(20),
});
export type LogoComposition = z.infer<typeof logoCompositionSchema>;

export const SLOGAN_TONES = ['INSPIRING', 'INSTITUTIONAL', 'CATCHY', 'ENGAGED'] as const;
export const SLOGAN_KINDS = ['SLOGAN', 'DEVISE', 'MISSION'] as const;

/** Entrée de génération de slogans, devises ou phrases de mission (§6.1). */
export const sloganGenerationInputSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  /** Nom retenu ou titre du projet. */
  name: z.string().trim().min(1).max(60),
  brief: z
    .object({
      sector: z.string(),
      mission: z.string(),
      values: z.array(z.string()),
      audience: z.string().nullish(),
    })
    .nullable(),
  kind: z.enum(SLOGAN_KINDS),
  tone: z.enum(SLOGAN_TONES),
  /** SIG-02 : 8 mots par défaut. */
  maxWords: z.number().int().min(3).max(20).default(8),
  language: z.enum(['fr', 'en']).default('fr'),
  count: z.number().int().min(1).max(20).default(10),
  /** Propositions déjà faites dans le projet, à ne pas répéter. */
  exclude: z.array(z.string()).default([]),
});
export type SloganGenerationInput = z.infer<typeof sloganGenerationInputSchema>;

export const generatedSlogansSchema = z.object({
  slogans: z.array(z.object({ text: z.string().trim().min(2).max(300) })).min(1).max(30),
});

// ─── Images du Studio ───

export const IMAGE_STYLES = [
  'abstract',
  'gradient',
  'geometric',
  'waves',
  'wax',
  'bogolan',
  'confetti',
] as const;
export const IMAGE_ASPECTS = ['square', 'portrait', 'landscape'] as const;

/** Demande d'images : description libre (donnée, jamais instruction), style, format, couleurs. */
export const imageGenerationInputSchema = z.object({
  prompt: z.string().trim().min(3).max(300),
  /** « auto » : style suggéré par la description. */
  style: z.enum(['auto', ...IMAGE_STYLES]),
  aspect: z.enum(IMAGE_ASPECTS),
  palette: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
    .min(2)
    .max(6),
  count: z.number().int().min(1).max(4),
});
export type ImageGenerationInput = z.infer<typeof imageGenerationInputSchema>;
