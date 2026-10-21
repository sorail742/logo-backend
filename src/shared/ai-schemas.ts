import { EntityType, NameStyle } from '@prisma/client';
import { z } from 'zod';

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
export const generatedNamesSchema = z.object({
  names: z.array(generatedNameSchema).min(1).max(30),
});
export type GeneratedName = z.infer<typeof generatedNameSchema>;

// ─── Slogans (SIG-01 à SIG-03) ───

export const SLOGAN_TONES = ['INSPIRING', 'INSTITUTIONAL', 'CATCHY', 'COMMITTED'] as const;

export const sloganGenerationInputSchema = z.object({
  name: z.string().min(1).max(60),
  entityType: z.nativeEnum(EntityType),
  brief: z.object({
    sector: z.string(),
    mission: z.string(),
    values: z.array(z.string()),
    audience: z.string().nullish(),
  }),
  tone: z.enum(SLOGAN_TONES),
  language: z.enum(['fr', 'en']).default('fr'),
  /** Nombre de mots maximal (SIG-02), 8 par défaut. */
  maxWords: z.number().int().min(2).max(20).default(8),
  count: z.number().int().min(1).max(20).default(10),
  /** Association : devise en trois termes et phrase de mission (SIG-03). */
  withMotto: z.boolean().default(false),
  feedback: z.string().max(200).nullish(),
  exclude: z.array(z.string()).default([]),
});
export type SloganGenerationInput = z.infer<typeof sloganGenerationInputSchema>;

export const generatedSlogansSchema = z.object({
  slogans: z
    .array(
      z.object({
        text: z.string().trim().min(2).max(200),
        kind: z.enum(['SLOGAN', 'DEVISE', 'MISSION']).default('SLOGAN'),
      }),
    )
    .min(1)
    .max(40),
});
