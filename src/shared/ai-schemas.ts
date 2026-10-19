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
